export type ApiRequestErrorCode =
  | 'INVALID_JSON'
  | 'INVALID_REQUEST'
  | 'PAYLOAD_TOO_LARGE'

export class ApiRequestError extends Error {
  readonly status: 400 | 413
  readonly code: ApiRequestErrorCode

  constructor(
    status: 400 | 413,
    code: ApiRequestErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
  }
}

export function safeErrorLogDetails(error: unknown): {
  type: 'Error' | 'NonError'
  stack?: string
} {
  if (!(error instanceof Error)) return { type: 'NonError' }

  const stack = error.stack
    ?.split('\n')
    .filter(line => /^\s*at\s/.test(line))
    .slice(0, 12)
    .join('\n')

  return {
    type: 'Error',
    ...(stack ? { stack } : {}),
  }
}

function invalidJson(): ApiRequestError {
  return new ApiRequestError(400, 'INVALID_JSON', 'Invalid request.')
}

function payloadTooLarge(): ApiRequestError {
  return new ApiRequestError(413, 'PAYLOAD_TOO_LARGE', 'Request payload is too large.')
}

export async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  const declaredLength = request.headers.get('content-length')
  if (declaredLength && /^\d+$/.test(declaredLength)) {
    const parsedLength = Number(declaredLength)
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      throw payloadTooLarge()
    }
  }

  if (!request.body) throw invalidJson()

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue

      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw payloadTooLarge()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  if (totalBytes === 0) throw invalidJson()

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw invalidJson()
  }
}
