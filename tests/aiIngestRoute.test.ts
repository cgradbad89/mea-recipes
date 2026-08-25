import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  generateAIObject: vi.fn(),
  getComplementaryIngredients: vi.fn(),
  safeFetchText: vi.fn(),
}))

vi.mock('@/lib/firebaseAdmin', () => ({ verifyAuthToken: mocks.verifyAuthToken }))
vi.mock('@/lib/ai', () => ({ generateAIObject: mocks.generateAIObject }))
vi.mock('@/lib/flavorPairings', () => ({
  getComplementaryIngredients: mocks.getComplementaryIngredients,
}))
vi.mock('@/lib/safeFetch', () => ({ safeFetchText: mocks.safeFetchText }))

import { POST, RECIPE_SCHEMA, SYSTEM_PROMPT } from '@/app/api/ai-ingest/route'
import { RECIPE_CATEGORIES } from '@/lib/recipeCategories'

const parsedRecipe = {
  title: 'Cacio e Pepe',
  cuisine: 'italian',
  category: 'Pasta, Noodles & Rice',
  ingredients: ['8 oz spaghetti', '1 cup pecorino'],
  instructions: ['Boil pasta.', 'Toss with cheese and pepper.'],
  imageURL: 'https://images.example/parsed.jpg',
  description: 'A Roman pasta.',
  servings: '2',
  prepTime: '5 min',
  cookTime: '15 min',
}

function request(body: BodyInit = JSON.stringify({ text: 'Recipe text' })) {
  return new NextRequest('http://localhost/api/ai-ingest', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body,
  })
}

function jsonRequest(body: unknown) {
  return request(JSON.stringify(body))
}

describe('POST /api/ai-ingest', () => {
  beforeEach(() => {
    mocks.verifyAuthToken.mockResolvedValue('user-123')
    mocks.getComplementaryIngredients.mockReturnValue([])
  })

  it('uses the exact canonical category vocabulary in the prompt', () => {
    RECIPE_CATEGORIES.forEach(category => expect(SYSTEM_PROMPT).toContain(category))
    expect(SYSTEM_PROMPT).not.toContain('Pasta Noodles & Rice')
    expect(SYSTEM_PROMPT).not.toContain('Breakfast Snacks & Sides')
  })

  it('accepts canonical punctuated/Sides output and rejects legacy AI categories', () => {
    expect(RECIPE_SCHEMA.safeParse({ ...parsedRecipe, category: 'Sides' }).success).toBe(true)
    expect(RECIPE_SCHEMA.safeParse({ ...parsedRecipe, category: 'Sauces & Condiments' }).success).toBe(true)
    expect(RECIPE_SCHEMA.safeParse({ ...parsedRecipe, category: 'Pasta, Noodles & Rice' }).success).toBe(true)
    expect(RECIPE_SCHEMA.safeParse({ ...parsedRecipe, category: 'Pasta Noodles & Rice' }).success).toBe(false)
    expect(RECIPE_SCHEMA.safeParse({ ...parsedRecipe, category: 'Breakfast, Snacks & Sides' }).success).toBe(false)
  })

  it('preserves the auth guard', async () => {
    mocks.verifyAuthToken.mockResolvedValueOnce(null)

    const response = await POST(request())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mocks.generateAIObject).not.toHaveBeenCalled()
    expect(mocks.safeFetchText).not.toHaveBeenCalled()
  })

  it('accepts dish generation and preserves FlavorGraph-informed generation output', async () => {
    mocks.getComplementaryIngredients.mockReturnValueOnce(['black pepper'])
    mocks.generateAIObject.mockResolvedValueOnce({ ...parsedRecipe, title: '' })

    const response = await POST(jsonRequest({ generate: 'Cacio e Pepe' }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ ...parsedRecipe, title: 'Cacio e Pepe', sourceURL: '' })
    expect(mocks.getComplementaryIngredients).toHaveBeenCalled()
    expect(mocks.generateAIObject).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'recipe-generation',
      userId: 'user-123',
      schema: expect.anything(),
    }))
    expect(mocks.generateAIObject.mock.calls[0][0].prompt).toContain('black pepper')
  })

  it('routes URL import through the SSRF-safe fetcher and preserves metadata precedence', async () => {
    mocks.safeFetchText.mockResolvedValueOnce({
      ok: true,
      text: '<html><title>Fetched Recipe | Site</title><script>ignore()</script><body>Recipe body</body></html>',
    })
    mocks.generateAIObject.mockResolvedValueOnce({ ...parsedRecipe, title: '' })
    const body = {
      url: 'https://recipes.example/cacio',
      imageURL: 'https://images.example/provided.jpg',
      prepTime: '10 min',
      cookTime: '20 min',
    }

    const response = await POST(jsonRequest(body))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.safeFetchText).toHaveBeenCalledWith(body.url, expect.objectContaining({
      headers: expect.objectContaining({ Accept: 'text/html' }),
    }))
    expect(mocks.generateAIObject.mock.calls[0][0].prompt).not.toContain('ignore()')
    expect(data).toEqual({
      ...parsedRecipe,
      title: 'Fetched Recipe',
      sourceURL: body.url,
      imageURL: body.imageURL,
      prepTime: body.prepTime,
      cookTime: body.cookTime,
    })
  })

  it('accepts direct HTML import', async () => {
    mocks.generateAIObject.mockResolvedValueOnce(parsedRecipe)

    const response = await POST(jsonRequest({ html: '<article>Cacio e Pepe recipe</article>' }))

    expect(response.status).toBe(200)
    expect(mocks.safeFetchText).not.toHaveBeenCalled()
    expect(mocks.generateAIObject).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'recipe-ingest',
      prompt: expect.stringContaining('<article>Cacio e Pepe recipe</article>'),
    }))
  })

  it('accepts pasted text import', async () => {
    mocks.generateAIObject.mockResolvedValueOnce(parsedRecipe)

    const response = await POST(jsonRequest({ text: 'Cacio e Pepe\n8 oz spaghetti' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ...parsedRecipe,
      sourceURL: '',
    })
    expect(mocks.safeFetchText).not.toHaveBeenCalled()
  })

  it('rejects invalid top-level, missing, and wrong-type request shapes', async () => {
    const invalidBodies = [null, [], {}, { text: 42 }, { text: 'Recipe', prepTime: false }]

    for (const body of invalidBodies) {
      const response = await POST(jsonRequest(body))
      expect(response.status).toBe(400)
    }
    expect(mocks.safeFetchText).not.toHaveBeenCalled()
    expect(mocks.generateAIObject).not.toHaveBeenCalled()
  })

  it('rejects conflicting ingestion modes before fetch or AI work', async () => {
    const response = await POST(jsonRequest({
      url: 'https://recipes.example/cacio',
      text: 'Recipe text',
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid request.' })
    expect(mocks.safeFetchText).not.toHaveBeenCalled()
    expect(mocks.generateAIObject).not.toHaveBeenCalled()
  })

  it('rejects oversized mode and metadata strings before fetch or AI work', async () => {
    const invalidBodies = [
      { url: `https://example.test/${'x'.repeat(2_030)}` },
      { generate: 'x'.repeat(501) },
      { text: 'x'.repeat(250_001) },
      { html: 'x'.repeat(1_500_001) },
      { text: 'Recipe', imageURL: 'x'.repeat(2_049) },
    ]

    for (const body of invalidBodies) {
      const response = await POST(jsonRequest(body))
      expect(response.status).toBe(400)
    }
    expect(mocks.safeFetchText).not.toHaveBeenCalled()
    expect(mocks.generateAIObject).not.toHaveBeenCalled()
  })

  it('returns 413 for a raw body over 2,000,000 bytes', async () => {
    const response = await POST(request(JSON.stringify({ padding: 'x'.repeat(2_000_000) })))

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: 'Request payload is too large.' })
    expect(mocks.safeFetchText).not.toHaveBeenCalled()
    expect(mocks.generateAIObject).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON before fetch or AI work', async () => {
    const response = await POST(request('{'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid request.' })
    expect(mocks.safeFetchText).not.toHaveBeenCalled()
    expect(mocks.generateAIObject).not.toHaveBeenCalled()
  })

  it('sanitizes generation and parsing provider failures', async () => {
    const internalError = new Error('gateway response exposed secret-detail')
    mocks.generateAIObject.mockRejectedValueOnce(internalError)

    const generationResponse = await POST(jsonRequest({ generate: 'Cacio e Pepe' }))
    const generationData = await generationResponse.json()

    expect(generationResponse.status).toBe(500)
    expect(generationData).toEqual({ error: 'AI generation failed or could not parse response' })
    expect(JSON.stringify(generationData)).not.toContain('secret-detail')

    mocks.generateAIObject.mockRejectedValueOnce(internalError)
    const parsingResponse = await POST(jsonRequest({ text: 'Recipe text' }))
    const parsingData = await parsingResponse.json()

    expect(parsingResponse.status).toBe(500)
    expect(parsingData).toEqual({ error: 'AI parsing failed or could not parse response' })
    expect(JSON.stringify(parsingData)).not.toContain('secret-detail')
  })

  it('preserves the stable URL-fetch failure response without exposing internals', async () => {
    mocks.safeFetchText.mockRejectedValueOnce(new Error('DNS credential secret-detail'))

    const response = await POST(jsonRequest({ url: 'https://recipes.example/cacio' }))
    const data = await response.json()

    expect(response.status).toBe(422)
    expect(data).toEqual({
      error: 'Could not fetch URL. Try the bookmarklet or paste text instead.',
    })
    expect(JSON.stringify(data)).not.toContain('secret-detail')
    expect(mocks.generateAIObject).not.toHaveBeenCalled()
  })
})
