import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  generateAIArray: vi.fn(),
}))

vi.mock('@/lib/firebaseAdmin', () => ({ verifyAuthToken: mocks.verifyAuthToken }))
vi.mock('@/lib/ai', () => ({ generateAIArray: mocks.generateAIArray }))

import { POST, NEW_SUGGESTION_SCHEMA } from '@/app/api/new-recipe-suggestions/route'
import { RECIPE_CATEGORIES } from '@/lib/recipeCategories'

const validBody = {
  topCuisines: ['italian'],
  topCategories: ['Pasta, Noodles & Rice'],
  recentTitles: ['Cacio e Pepe'],
}

function request(body: BodyInit = JSON.stringify(validBody)) {
  return new NextRequest('http://localhost/api/new-recipe-suggestions', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body,
  })
}

function jsonRequest(body: unknown) {
  return request(JSON.stringify(body))
}

describe('POST /api/new-recipe-suggestions', () => {
  beforeEach(() => {
    mocks.verifyAuthToken.mockResolvedValue('user-123')
  })

  it('preserves the auth guard', async () => {
    mocks.verifyAuthToken.mockResolvedValueOnce(null)

    const response = await POST(request())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mocks.generateAIArray).not.toHaveBeenCalled()
  })

  it('preserves the successful response envelope and passes auth context', async () => {
    const suggestions = [{
      title: 'Pasta alla Norma',
      cuisine: 'italian',
      category: 'Pasta, Noodles & Rice',
      description: 'A classic Sicilian pasta.',
      searchQuery: 'pasta alla norma recipe',
    }]
    mocks.generateAIArray.mockResolvedValueOnce(suggestions)

    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(suggestions)
    expect(mocks.generateAIArray).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'new-recipe-suggestions',
      userId: 'user-123',
      element: expect.anything(),
    }))
  })

  it('preserves the route error envelope when Gateway generation fails', async () => {
    mocks.generateAIArray.mockRejectedValueOnce(new Error('gateway unavailable'))

    const response = await POST(request())

    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data).toEqual({
      error: 'AI request failed or could not parse response',
    })
    expect(JSON.stringify(data)).not.toContain('gateway unavailable')
  })

  it('builds the prompt from all exact canonical category values', async () => {
    mocks.generateAIArray.mockResolvedValueOnce([])
    await POST(request())
    const prompt = mocks.generateAIArray.mock.calls[0][0].prompt as string

    RECIPE_CATEGORIES.forEach(category => expect(prompt).toContain(category))
    expect(prompt).not.toContain('Pasta Noodles & Rice')
    expect(prompt).not.toContain('Breakfast Snacks & Sides')
  })

  it('validates new suggestions with the canonical enum', () => {
    const suggestion = {
      title: 'Test', cuisine: 'test', description: 'Test.', searchQuery: 'test recipe',
    }
    expect(NEW_SUGGESTION_SCHEMA.safeParse({ ...suggestion, category: 'Sides' }).success).toBe(true)
    expect(NEW_SUGGESTION_SCHEMA.safeParse({ ...suggestion, category: 'Soups, Stews & Chili' }).success).toBe(true)
    expect(NEW_SUGGESTION_SCHEMA.safeParse({ ...suggestion, category: 'Soups Stews & Chili' }).success).toBe(false)
  })

  it('rejects malformed JSON before invoking AI', async () => {
    const response = await POST(request('{'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid request.' })
    expect(mocks.generateAIArray).not.toHaveBeenCalled()
  })

  it('rejects invalid top-level, missing, and wrong-type request shapes', async () => {
    for (const body of [null, [], {}, { ...validBody, topCuisines: [42] }]) {
      const response = await POST(jsonRequest(body))
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'Invalid request.' })
    }
    expect(mocks.generateAIArray).not.toHaveBeenCalled()
  })

  it('rejects oversized collections and free-text fields', async () => {
    const invalidBodies = [
      { ...validBody, recentTitles: Array.from({ length: 501 }, () => 'Recipe') },
      { ...validBody, topCuisines: ['x'.repeat(2_001)] },
    ]

    for (const body of invalidBodies) {
      const response = await POST(jsonRequest(body))
      expect(response.status).toBe(400)
    }
    expect(mocks.generateAIArray).not.toHaveBeenCalled()
  })

  it('returns 413 for a raw body over 256,000 bytes', async () => {
    const response = await POST(request(JSON.stringify({ padding: 'x'.repeat(256_000) })))

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: 'Request payload is too large.' })
    expect(mocks.generateAIArray).not.toHaveBeenCalled()
  })
})
