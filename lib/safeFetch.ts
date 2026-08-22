import type { LookupAddress } from 'node:dns'
import { lookup } from 'node:dns/promises'
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'

const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_REDIRECTS = 3

const blockedIpv4Addresses = new BlockList()
const blockedIpv6Addresses = new BlockList()

// Non-public IPv4 space: unspecified, private, carrier-grade NAT, loopback,
// link-local, benchmarking, documentation, multicast, and reserved ranges.
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedIpv4Addresses.addSubnet(network, prefix, 'ipv4')
}

// Non-public/special IPv6 space, including IPv4-mapped and transition ranges
// that could otherwise conceal a blocked IPv4 destination.
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  blockedIpv6Addresses.addSubnet(network, prefix, 'ipv6')
}

export type SafeFetchErrorCode =
  | 'INVALID_URL'
  | 'BLOCKED_ADDRESS'
  | 'DNS_FAILURE'
  | 'TIMEOUT'
  | 'TOO_LARGE'
  | 'TOO_MANY_REDIRECTS'
  | 'NETWORK_FAILURE'

export class SafeFetchError extends Error {
  constructor(
    public readonly code: SafeFetchErrorCode,
    message: string,
    public readonly status = 502,
  ) {
    super(message)
    this.name = 'SafeFetchError'
  }
}

export interface SafeFetchResponse {
  url: string
  status: number
  ok: boolean
  headers: IncomingHttpHeaders
  text: string
}

export interface SafeFetchOptions {
  headers?: Record<string, string>
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
}

function withoutIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
}

/** Exported for deterministic security regression tests. */
export function isBlockedIpAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return blockedIpv4Addresses.check(address, 'ipv4')
  if (family === 6) return blockedIpv6Addresses.check(address, 'ipv6')
  return true
}

/** Parse and validate the URL shape before any DNS or network activity. */
export function parsePublicHttpUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new SafeFetchError('INVALID_URL', 'Invalid URL', 400)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SafeFetchError('INVALID_URL', 'Only http and https URLs are allowed', 400)
  }
  if (!url.hostname || url.username || url.password) {
    throw new SafeFetchError('INVALID_URL', 'URL credentials are not allowed', 400)
  }

  const literalAddress = withoutIpv6Brackets(url.hostname)
  if (isIP(literalAddress) && isBlockedIpAddress(literalAddress)) {
    throw new SafeFetchError('BLOCKED_ADDRESS', 'URL resolves to a non-public address', 400)
  }

  return url
}

function remainingMs(deadline: number): number {
  return Math.max(0, deadline - Date.now())
}

async function withDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  const remaining = remainingMs(deadline)
  if (!remaining) throw new SafeFetchError('TIMEOUT', 'Upstream request timed out')

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new SafeFetchError('TIMEOUT', 'Upstream request timed out')),
          remaining,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function resolvePublicAddress(url: URL, deadline: number) {
  const hostname = withoutIpv6Brackets(url.hostname)
  if (isIP(hostname)) {
    return { address: hostname, family: isIP(hostname) as 4 | 6 }
  }

  let addresses: LookupAddress[]
  try {
    addresses = await withDeadline(lookup(hostname, { all: true, verbatim: true }), deadline)
  } catch (error) {
    if (error instanceof SafeFetchError) throw error
    throw new SafeFetchError('DNS_FAILURE', 'Could not resolve URL host')
  }

  if (!addresses.length) {
    throw new SafeFetchError('DNS_FAILURE', 'Could not resolve URL host')
  }
  if (addresses.some(result => isBlockedIpAddress(result.address))) {
    throw new SafeFetchError('BLOCKED_ADDRESS', 'URL resolves to a non-public address', 400)
  }

  return {
    address: addresses[0].address,
    family: addresses[0].family === 6 ? 6 as const : 4 as const,
  }
}

function readResponseBody(
  url: URL,
  address: string,
  family: 4 | 6,
  headers: Record<string, string>,
  maxBytes: number,
  deadline: number,
): Promise<SafeFetchResponse> {
  return new Promise((resolve, reject) => {
    const timeout = remainingMs(deadline)
    if (!timeout) {
      reject(new SafeFetchError('TIMEOUT', 'Upstream request timed out'))
      return
    }

    const request = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = request({
      protocol: url.protocol,
      hostname: address,
      family,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        ...headers,
        Host: url.host,
      },
      servername: url.protocol === 'https:' ? withoutIpv6Brackets(url.hostname) : undefined,
    }, response => {
      const status = response.statusCode || 0
      const location = response.headers.location
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        response.resume()
        resolve({ url: url.toString(), status, ok: false, headers: response.headers, text: '' })
        return
      }

      const declaredSize = Number(response.headers['content-length'])
      if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
        response.destroy()
        reject(new SafeFetchError('TOO_LARGE', 'Upstream response exceeds the 2 MB limit'))
        return
      }

      const chunks: Buffer[] = []
      let received = 0
      response.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        received += buffer.length
        if (received > maxBytes) {
          response.destroy(new SafeFetchError('TOO_LARGE', 'Upstream response exceeds the 2 MB limit'))
          return
        }
        chunks.push(buffer)
      })
      response.on('end', () => {
        resolve({
          url: url.toString(),
          status,
          ok: status >= 200 && status < 300,
          headers: response.headers,
          text: Buffer.concat(chunks).toString('utf8'),
        })
      })
      response.on('error', reject)
    })

    req.setTimeout(timeout, () => {
      req.destroy(new SafeFetchError('TIMEOUT', 'Upstream request timed out'))
    })
    req.on('error', error => {
      reject(error instanceof SafeFetchError
        ? error
        : new SafeFetchError('NETWORK_FAILURE', 'Could not fetch URL'))
    })
    req.end()
  })
}

/**
 * Fetch public HTML without exposing server-side network access. Every hop is
 * DNS-resolved and validated, then the request is pinned to that exact address
 * so a DNS rebinding cannot swap in a private target between validation/use.
 */
export async function safeFetchText(value: string, options: SafeFetchOptions = {}): Promise<SafeFetchResponse> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const deadline = Date.now() + timeoutMs
  let current = parsePublicHttpUrl(value)

  for (let redirectCount = 0; ; redirectCount += 1) {
    const resolved = await resolvePublicAddress(current, deadline)
    const response = await readResponseBody(
      current,
      resolved.address,
      resolved.family,
      options.headers || {},
      maxBytes,
      deadline,
    )

    const location = response.headers.location
    const isRedirect = [301, 302, 303, 307, 308].includes(response.status) && !!location
    if (!isRedirect) return response
    if (redirectCount >= maxRedirects) {
      throw new SafeFetchError('TOO_MANY_REDIRECTS', 'Too many redirects')
    }

    current = parsePublicHttpUrl(new URL(location!, current).toString())
  }
}
