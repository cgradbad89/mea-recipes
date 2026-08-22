import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  generateAIObject: vi.fn(),
}))

vi.mock('@/lib/firebaseAdmin', () => ({ verifyAuthToken: mocks.verifyAuthToken }))
vi.mock('@/lib/ai', () => ({ generateAIObject: mocks.generateAIObject }))

import { POST } from '@/app/api/recommendations/route'

const validBody = {
  recipes: [{ id: 'cacio-e-pepe', title: 'Cacio e Pepe', cuisine: 'italian', category: 'Pasta' }],
  cookCounts: { 'cacio-e-pepe': 3 },
  ratings: { 'cacio-e-pepe': 5 },
  favorites: ['cacio-e-pepe'],
}

function request(body: BodyInit = JSON.stringify(validBody)) {
  return new NextRequest('http://localhost/api/recommendations', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body,
  })
}

function jsonRequest(body: unknown) {
  return request(JSON.stringify(body))
}

describe('POST /api/recommendations', () => {
  beforeEach(() => {
    mocks.verifyAuthToken.mockResolvedValue('user-123')
  })

  it('preserves the auth guard', async () => {
    mocks.verifyAuthToken.mockResolvedValueOnce(null)

    const response = await POST(request())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mocks.generateAIObject).not.toHaveBeenCalled()
  })

  it('preserves the three-bucket success contract and ignores unknown fields', async () => {
    const recommendations = {
      cookAgain: [{ title: 'Cacio e Pepe', reason: 'A favorite.' }],
      tryNew: [],
      longTime: [],
    }
    mocks.generateAIObject.mockResolvedValueOnce(recommendations)

    const response = await POST(jsonRequest({ ...validBody, promptOverride: 'INJECTED_UNKNOWN_FIELD' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(recommendations)
    expect(mocks.generateAIObject).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'recommendations',
      userId: 'user-123',
      schema: expect.anything(),
    }))
    expect(mocks.generateAIObject.mock.calls[0][0].prompt).not.toContain('INJECTED_UNKNOWN_FIELD')
  })

  it('rejects malformed JSON before invoking AI', async () => {
    const response = await POST(request('{'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid request.' })
    expect(mocks.generateAIObject).not.toHaveBeenCalled()
  })

  it('rejects invalid top-level, missing, and wrong-type request shapes', async () => {
    const invalidBodies = [
      null,
      [],
      {},
      { ...validBody, recipes: [{ ...validBody.recipes[0], title: 42 }] },
      { ...validBody, cookCounts: [] },
      { ...validBody, favorites: [false] },
    ]

    for (const body of invalidBodies) {
      const response = await POST(jsonRequest(body))
      expect(response.status).toBe(400)
    }
    expect(mocks.generateAIObject).not.toHaveBeenCalled()
  })

  it('rejects oversized collections, maps, and recipe text', async () => {
    const tooManyRecipes = Array.from({ length: 501 }, (_, index) => ({
      id: `recipe-${index}`,
      title: 'Recipe',
      cuisine: 'italian',
      category: 'Pasta',
    }))
    const tooManyRatings = Object.fromEntries(
      Array.from({ length: 501 }, (_, index) => [`recipe-${index}`, 5]),
    )
    const invalidBodies = [
      { ...validBody, recipes: tooManyRecipes },
      { ...validBody, ratings: tooManyRatings },
      { ...validBody, recipes: [{ ...validBody.recipes[0], cuisine: 'x'.repeat(2_001) }] },
    ]

    for (const body of invalidBodies) {
      const response = await POST(jsonRequest(body))
      expect(response.status).toBe(400)
    }
    expect(mocks.generateAIObject).not.toHaveBeenCalled()
  })

  it('returns 413 for a raw body over 256,000 bytes', async () => {
    const response = await POST(request(JSON.stringify({ padding: 'x'.repeat(256_000) })))

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: 'Request payload is too large.' })
    expect(mocks.generateAIObject).not.toHaveBeenCalled()
  })

  it('sanitizes AI provider failures', async () => {
    mocks.generateAIObject.mockRejectedValueOnce(new Error('AI_GATEWAY_API_KEY rejected: secret-detail'))

    const response = await POST(request())
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'AI request failed or could not parse response' })
    expect(JSON.stringify(data)).not.toContain('secret-detail')
    expect(JSON.stringify(data)).not.toContain('AI_GATEWAY_API_KEY')
  })
})
