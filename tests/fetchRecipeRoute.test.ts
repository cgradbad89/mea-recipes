import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  safeFetchText: vi.fn(),
}))

vi.mock('@/lib/firebaseAdmin', () => ({ verifyAuthToken: mocks.verifyAuthToken }))
vi.mock('@/lib/safeFetch', () => ({
  SafeFetchError: class SafeFetchError extends Error {
    constructor(public code: string, message: string, public status = 502) { super(message) }
  },
  safeFetchText: mocks.safeFetchText,
}))

import { GET } from '@/app/api/fetch-recipe/route'

function request(url = 'https://recipes.example/cacio', authorization?: string) {
  return new NextRequest(`https://mea-recipes.vercel.app/api/fetch-recipe?url=${encodeURIComponent(url)}`, {
    headers: authorization ? { Authorization: authorization } : undefined,
  })
}

describe('GET /api/fetch-recipe', () => {
  beforeEach(() => {
    mocks.verifyAuthToken.mockReset()
    mocks.verifyAuthToken.mockResolvedValue('verified-uid')
    mocks.safeFetchText.mockReset()
  })

  it('rejects a request without a bearer token before outbound work', async () => {
    mocks.verifyAuthToken.mockResolvedValueOnce(null)

    const response = await GET(request())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mocks.safeFetchText).not.toHaveBeenCalled()
  })

  it('rejects an invalid bearer token before outbound work', async () => {
    mocks.verifyAuthToken.mockResolvedValueOnce(null)

    const response = await GET(request('https://recipes.example/cacio', 'Bearer forged-token'))

    expect(response.status).toBe(401)
    expect(mocks.safeFetchText).not.toHaveBeenCalled()
  })

  it('uses the shared safe fetcher after authentication and returns a title', async () => {
    mocks.safeFetchText.mockResolvedValueOnce({ ok: true, text: '<title>Cacio e Pepe | Recipes</title><p>Recipe</p>' })

    const response = await GET(request('https://recipes.example/cacio', 'Bearer id-token'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ html: '<title>Cacio e Pepe | Recipes</title><p>Recipe</p>', title: 'Cacio e Pepe' })
    expect(mocks.verifyAuthToken).toHaveBeenCalledBefore(mocks.safeFetchText)
    expect(mocks.safeFetchText).toHaveBeenCalledWith('https://recipes.example/cacio', expect.any(Object))
  })

  it('preserves safe-fetch rejection of an authenticated private URL', async () => {
    const { SafeFetchError } = await import('@/lib/safeFetch')
    mocks.safeFetchText.mockRejectedValueOnce(new SafeFetchError('BLOCKED_ADDRESS', 'Private address', 400))

    const response = await GET(request('http://127.0.0.1/internal', 'Bearer id-token'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Could not fetch URL.' })
  })

  it('sanitizes safe-fetch failures', async () => {
    mocks.safeFetchText.mockRejectedValueOnce(new Error('internal fetch failure'))

    const response = await GET(request('https://recipes.example/cacio', 'Bearer id-token'))

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'Could not fetch URL.' })
  })
})
