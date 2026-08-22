import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  enforceAbuseLimit: vi.fn(),
  safeFetchText: vi.fn(),
}))

vi.mock('@/lib/apiAbuse', () => ({ enforceAbuseLimit: mocks.enforceAbuseLimit }))
vi.mock('@/lib/safeFetch', () => ({
  SafeFetchError: class SafeFetchError extends Error {},
  safeFetchText: mocks.safeFetchText,
}))

import { GET } from '@/app/api/fetch-recipe/route'

function request(url = 'https://recipes.example/cacio') {
  return new NextRequest(`https://mea-recipes.vercel.app/api/fetch-recipe?url=${encodeURIComponent(url)}`)
}

describe('GET /api/fetch-recipe', () => {
  beforeEach(() => {
    mocks.enforceAbuseLimit.mockReset()
    mocks.enforceAbuseLimit.mockResolvedValue(null)
    mocks.safeFetchText.mockReset()
  })

  it('returns 429 before outbound fetching when the public limit is exceeded', async () => {
    mocks.enforceAbuseLimit.mockResolvedValueOnce(NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 }))

    const response = await GET(request())

    expect(response.status).toBe(429)
    expect(mocks.safeFetchText).not.toHaveBeenCalled()
  })

  it('uses the shared safe fetcher and returns a title for permitted requests', async () => {
    mocks.safeFetchText.mockResolvedValueOnce({ ok: true, text: '<title>Cacio e Pepe | Recipes</title><p>Recipe</p>' })

    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ html: '<title>Cacio e Pepe | Recipes</title><p>Recipe</p>', title: 'Cacio e Pepe' })
    expect(mocks.safeFetchText).toHaveBeenCalledWith('https://recipes.example/cacio', expect.any(Object))
  })

  it('sanitizes safe-fetch failures', async () => {
    mocks.safeFetchText.mockRejectedValueOnce(new Error('internal fetch failure'))

    const response = await GET(request())

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'Could not fetch URL.' })
  })
})
