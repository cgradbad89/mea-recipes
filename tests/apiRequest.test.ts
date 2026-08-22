import { describe, expect, it, vi } from 'vitest'

import { ApiRequestError, readBoundedJson } from '@/lib/apiRequest'

function expectApiRequestError(
  error: unknown,
  status: 400 | 413,
  code: ApiRequestError['code'],
) {
  expect(error).toBeInstanceOf(ApiRequestError)
  expect(error).toMatchObject({ status, code })
}

describe('readBoundedJson', () => {
  it('parses valid JSON below the byte limit', async () => {
    const request = new Request('https://example.test/api', {
      method: 'POST',
      body: JSON.stringify({ ok: true }),
    })

    await expect(readBoundedJson(request, 100)).resolves.toEqual({ ok: true })
  })

  it('rejects malformed JSON without including the body in the error', async () => {
    const request = new Request('https://example.test/api', { method: 'POST', body: '{secret' })

    await expect(readBoundedJson(request, 100)).rejects.toSatisfy((error: unknown) => {
      expectApiRequestError(error, 400, 'INVALID_JSON')
      expect((error as Error).message).toBe('Invalid request.')
      expect((error as Error).message).not.toContain('secret')
      return true
    })
  })

  it('rejects an empty body deterministically', async () => {
    const request = new Request('https://example.test/api', { method: 'POST' })

    await expect(readBoundedJson(request, 100)).rejects.toSatisfy((error: unknown) => {
      expectApiRequestError(error, 400, 'INVALID_JSON')
      return true
    })
  })

  it('accepts a body exactly at the byte boundary', async () => {
    const body = JSON.stringify({ value: 'é' })
    const byteLength = new TextEncoder().encode(body).byteLength
    const request = new Request('https://example.test/api', { method: 'POST', body })

    await expect(readBoundedJson(request, byteLength)).resolves.toEqual({ value: 'é' })
  })

  it('rejects a streamed body as soon as it exceeds the byte boundary', async () => {
    const request = new Request('https://example.test/api', {
      method: 'POST',
      body: JSON.stringify({ value: 'too large' }),
    })

    await expect(readBoundedJson(request, 5)).rejects.toSatisfy((error: unknown) => {
      expectApiRequestError(error, 413, 'PAYLOAD_TOO_LARGE')
      expect((error as Error).message).toBe('Request payload is too large.')
      return true
    })
  })

  it('does not call Request.json before enforcing the limit', async () => {
    const request = new Request('https://example.test/api', {
      method: 'POST',
      body: JSON.stringify({ value: 'too large' }),
    })
    const jsonSpy = vi.spyOn(request, 'json')

    await expect(readBoundedJson(request, 5)).rejects.toMatchObject({
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
    })
    expect(jsonSpy).not.toHaveBeenCalled()
  })
})
