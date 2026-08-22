import { checkRateLimit } from '@vercel/firewall'
import { NextResponse } from 'next/server'

/**
 * These IDs are Vercel Firewall rule IDs, not secrets. Each must be configured
 * as an `@vercel/firewall` rate-limit condition before production traffic is
 * allowed through the corresponding expensive route.
 */
export const ABUSE_LIMITS = {
  publicFetch: 'mea-public-fetch-v1',
  aiExpensive: 'mea-ai-expensive-v1',
  aiStandard: 'mea-ai-standard-v1',
  externalLookup: 'mea-external-lookup-v1',
  writeHeavy: 'mea-write-heavy-v1',
} as const

export type AbuseLimitClass = keyof typeof ABUSE_LIMITS

const LIMIT_RESPONSE = { error: 'Too many requests. Please try again later.' }
const UNAVAILABLE_RESPONSE = { error: 'Service temporarily unavailable.' }

function isVercelProduction(): boolean {
  return process.env.VERCEL === '1' && process.env.VERCEL_ENV === 'production'
}

/**
 * Use Vercel's distributed Firewall counters instead of process-local state.
 * Authenticated callers are keyed by a Firebase uid obtained after token
 * verification. Public callers deliberately omit a key so Firewall uses the
 * Vercel-provided client IP; no client-controlled forwarding header is parsed.
 *
 * A missing Firewall rule is fail-closed in Vercel production. Local and other
 * non-Vercel runtimes remain usable because the SDK cannot enforce a distributed
 * counter there.
 */
export async function enforceAbuseLimit(
  request: Request,
  limitClass: AbuseLimitClass,
  verifiedUid?: string,
): Promise<NextResponse | null> {
  if (process.env.VERCEL !== '1') return null

  try {
    const result = await checkRateLimit(ABUSE_LIMITS[limitClass], {
      request,
      ...(verifiedUid ? { rateLimitKey: verifiedUid } : {}),
    })

    if (result.rateLimited) {
      return NextResponse.json(LIMIT_RESPONSE, { status: 429 })
    }

    if (result.error === 'not-found' && isVercelProduction()) {
      console.error('[api-abuse] missing production firewall rule', { limitClass })
      return NextResponse.json(UNAVAILABLE_RESPONSE, { status: 503 })
    }
    return null
  } catch {
    if (isVercelProduction()) {
      console.error('[api-abuse] firewall rate-limit check unavailable', { limitClass })
      return NextResponse.json(UNAVAILABLE_RESPONSE, { status: 503 })
    }
    return null
  }
}
