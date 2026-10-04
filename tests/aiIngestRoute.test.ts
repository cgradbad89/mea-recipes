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

import { POST } from '@/app/api/ai-ingest/route'
import { RECIPE_SCHEMA, SYSTEM_PROMPT, IMPORT_SYSTEM_PROMPT, MAX_IMPORT_EVIDENCE_LENGTH } from '@/lib/aiIngestContract'
import { AIAbuseControlError } from '@/lib/aiAbuseControl'
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

const parsedEvidence = ['Cacio e Pepe', 'Ingredients', ...parsedRecipe.ingredients, 'Instructions', ...parsedRecipe.instructions].join('\n')

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

function recipeHtml(recipe: Record<string, unknown>) {
  return `<script type="application/ld+json">${JSON.stringify(recipe)}</script><article>${parsedEvidence}</article>`
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
    expect(RECIPE_SCHEMA.safeParse({
      ...parsedRecipe,
      ingredients: Array.from({ length: 201 }, () => 'ingredient'),
    }).success).toBe(false)
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
      text: `<html><title>Fetched Recipe | Site</title><script>ignore()</script><body>${parsedEvidence}</body></html>`,
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

  it('uses complete publisher nutrition and structured image before AI guesses', async () => {
    mocks.safeFetchText.mockResolvedValueOnce({
      ok: true,
      text: `<script type="application/ld+json">${JSON.stringify({
        '@type': 'Recipe', image: { url: 'https://images.example/source.jpg' }, recipeYield: '4 servings',
        nutrition: {
          calories: '420 calories', proteinContent: '28 g', carbohydrateContent: '36 g',
          fatContent: '18 g', fiberContent: '6 g', sugarContent: '7 g',
        },
      })}</script><title>Publisher Recipe | Site</title><body>${parsedEvidence}</body>`,
    })
    mocks.generateAIObject.mockResolvedValueOnce(parsedRecipe)

    const response = await POST(jsonRequest({ url: 'https://recipes.example/publisher' }))
    const data = await response.json()

    expect(data.imageURL).toBe('https://images.example/source.jpg')
    expect(data.sourceNutrition).toEqual(expect.objectContaining({
      source: 'source_site', servings: 4, total: expect.objectContaining({ calories: 1680, protein_g: 112 }),
    }))
  })

  it('prefers valid bookmarklet facts over AI image guesses when the source fetch has none', async () => {
    mocks.safeFetchText.mockResolvedValueOnce({ ok: true, text: `<title>Recipe | Site</title><body>${parsedEvidence}</body>` })
    mocks.generateAIObject.mockResolvedValueOnce(parsedRecipe)

    const response = await POST(jsonRequest({
      url: 'https://recipes.example/bookmarklet',
      imageURL: 'https://images.example/bookmarklet.jpg',
      sourceNutrition: {
        calories: 420, proteinContent: '28 grams', carbohydrateContent: '36 g', fatContent: '18 g',
        fiberContent: '6 g', sugarContent: '7 g', recipeYield: 4,
      },
    }))
    const data = await response.json()

    expect(data.imageURL).toBe('https://images.example/bookmarklet.jpg')
    expect(data.sourceNutrition).toEqual(expect.objectContaining({ source: 'source_site', total: expect.objectContaining({ calories: 1680 }) }))
  })

  it('accepts direct HTML import', async () => {
    mocks.generateAIObject.mockResolvedValueOnce(parsedRecipe)

    const response = await POST(jsonRequest({ html: `<article>${parsedEvidence}</article>` }))

    expect(response.status).toBe(200)
    expect(mocks.safeFetchText).not.toHaveBeenCalled()
    expect(mocks.generateAIObject).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'recipe-ingest',
      prompt: expect.stringContaining('Cacio e Pepe'),
    }))
  })

  it('extracts complete publisher facts from direct HTML imports too', async () => {
    mocks.generateAIObject.mockResolvedValueOnce(parsedRecipe)
    const html = recipeHtml({
      '@type': 'Recipe', image: '/direct-html.jpg', recipeYield: '2 servings',
      nutrition: {
        calories: '300 calories', proteinContent: '15 g', carbohydrateContent: '20 g',
        fatContent: '10 g', fiberContent: '4 g', sugarContent: '2 g',
      },
    })

    const response = await POST(jsonRequest({ html }))
    const data = await response.json()

    // No page URL was supplied, so a relative source image is not usable; the
    // complete nutrition remains a deterministic publisher fact.
    expect(data.imageURL).toBe(parsedRecipe.imageURL)
    expect(data.sourceNutrition).toEqual(expect.objectContaining({ servings: 2, total: expect.objectContaining({ calories: 600 }) }))
  })

  it('accepts pasted text import', async () => {
    mocks.generateAIObject.mockResolvedValueOnce(parsedRecipe)

    const response = await POST(jsonRequest({ text: parsedEvidence }))

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

  it('returns the stable sanitized limiter response', async () => {
    mocks.generateAIObject.mockRejectedValueOnce(new AIAbuseControlError('daily', 3_600))

    const response = await POST(jsonRequest({ generate: 'Cacio e Pepe' }))

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('3600')
    await expect(response.json()).resolves.toEqual({
      error: 'AI request limit reached. Try again later.',
      code: 'ai-request-limited',
    })
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


import { nachosHtml, nachosSource, nachosIngredients, nachosInstructions } from './helpers/bookmarkletFixture'
const nachosAI = { ...parsedRecipe, ingredients: nachosIngredients, instructions: nachosInstructions }

describe('complete browser and public URL ingestion', () => {
  beforeEach(() => {
    mocks.verifyAuthToken.mockResolvedValue('user-123')
    mocks.getComplementaryIngredients.mockReturnValue([])
  })

  it.each([
    ['omitted/reordered', { ...parsedRecipe, ingredients: nachosIngredients.slice(0, 4).reverse(), instructions: nachosInstructions.slice(0, 2).reverse() }],
    ['plausible different dish', parsedRecipe],
  ])('preserves captured 13/7 rows despite %s AI output and never fetches sourceURL', async (_name, ai) => {
    mocks.generateAIObject.mockResolvedValueOnce(ai)
    const response = await POST(jsonRequest({ html: nachosHtml, sourceURL: 'https://recipes.example/authenticated/nachos' }))
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.ingredients).toEqual(nachosIngredients)
    expect(data.instructions).toEqual(nachosInstructions)
    expect(data.sourceURL).toBe('https://recipes.example/authenticated/nachos')
    expect(data.imageURL).toBe(nachosSource.image)
    expect(data.prepTime).toBe('PT20M')
    expect(data.cookTime).toBe('PT40M')
    expect(mocks.safeFetchText).not.toHaveBeenCalled()
    expect(mocks.generateAIObject.mock.calls[0][0].system).toBe(IMPORT_SYSTEM_PROMPT)
  })

  it('preserves JSON-LD-only URL recipe facts before removing scripts', async () => {
    mocks.safeFetchText.mockResolvedValueOnce({ ok: true, text: recipeHtml(nachosSource).replace(/<article>[\s\S]*?<\/article>/, '') })
    mocks.generateAIObject.mockResolvedValueOnce({ ...parsedRecipe, ingredients: [], instructions: [] })
    const response = await POST(jsonRequest({ url: 'https://recipes.example/nachos' }))
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.ingredients).toEqual(nachosIngredients)
    expect(data.instructions).toEqual(nachosInstructions)
    expect(mocks.safeFetchText).toHaveBeenCalledTimes(1)
    expect(mocks.generateAIObject.mock.calls[0][0].prompt).toContain('scallions')
  })

  it('passes the complete long visible URL source including tail beyond 15,000 characters', async () => {
    const visible = nachosHtml.replace(/<script[\s\S]*?<\/script>/, '')
    mocks.safeFetchText.mockResolvedValueOnce({ ok: true, text: `<body><p>${'Introduction '.repeat(2000)}</p>${visible}</body>` })
    mocks.generateAIObject.mockResolvedValueOnce(nachosAI)
    const response = await POST(jsonRequest({ url: 'https://recipes.example/long' }))
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.ingredients).toEqual(nachosIngredients)
    expect(data.instructions).toEqual(nachosInstructions)
    const prompt = mocks.generateAIObject.mock.calls[0][0].prompt
    expect(prompt.indexOf(nachosInstructions[6])).toBeGreaterThan(15_000)
  })

  it('reduces oversized page chrome only when a complete structured recipe remains', async () => {
    mocks.safeFetchText.mockResolvedValueOnce({ ok: true, text: `<p>${'x'.repeat(100_000)}</p>${nachosHtml}` })
    mocks.generateAIObject.mockResolvedValueOnce(parsedRecipe)
    const response = await POST(jsonRequest({ url: 'https://recipes.example/chrome' }))
    expect(response.status).toBe(200)
    expect((await response.json()).instructions).toEqual(nachosInstructions)
    expect(mocks.generateAIObject.mock.calls[0][0].prompt.length).toBeLessThan(MAX_IMPORT_EVIDENCE_LENGTH)
  })

  it('rejects model-capacity and structured-row overflows explicitly instead of returning truncated success', async () => {
    for (const html of [
      `<main>${'x'.repeat(MAX_IMPORT_EVIDENCE_LENGTH + 1)}scallions</main>`,
      recipeHtml({ ...nachosSource, recipeIngredient: Array.from({ length: 201 }, () => 'salt') }),
      recipeHtml({ ...nachosSource, recipeInstructions: [{ '@type': 'HowToStep', text: 'x'.repeat(4001) }] }),
    ]) {
      mocks.safeFetchText.mockResolvedValueOnce({ ok: true, text: html })
      const response = await POST(jsonRequest({ url: 'https://recipes.example/oversized' }))
      expect(response.status).toBe(413)
      expect((await response.json()).error).toContain('No content was trimmed')
    }
    expect(mocks.generateAIObject).not.toHaveBeenCalled()
  })

  it('rejects insufficient source evidence and ungrounded replacements in capture mode without URL fallback', async () => {
    mocks.generateAIObject.mockResolvedValueOnce(parsedRecipe)
    const response = await POST(jsonRequest({ html: '<main>Sign in to read the recipe.</main>', sourceURL: 'https://recipes.example/blocked' }))
    expect(response.status).toBe(422)
    expect((await response.json()).error).toContain('complete recipe')
    expect(mocks.safeFetchText).not.toHaveBeenCalled()
  })

  it('uses complete visible fallback for malformed/ambiguous structured evidence', async () => {
    const html = nachosHtml.replace('</head>', `<script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', recipeIngredient: ['beans'], recipeInstructions: null })}</script></head>`)
    mocks.generateAIObject.mockResolvedValueOnce(nachosAI)
    const response = await POST(jsonRequest({ html, sourceURL: 'https://recipes.example/nachos' }))
    expect(response.status).toBe(200)
    expect((await response.json()).ingredients).toEqual(nachosIngredients)
    expect(mocks.generateAIObject.mock.calls[0][0].prompt).not.toContain('beans')
  })

  it('preserves client image/time/nutrition precedence over captured source and AI', async () => {
    mocks.generateAIObject.mockResolvedValueOnce(parsedRecipe)
    const response = await POST(jsonRequest({ html: nachosHtml, sourceURL: 'https://recipes.example/nachos', imageURL: '/client.jpg', prepTime: '10 min', cookTime: '50 min', sourceNutrition: {
      calories: 420, proteinContent: 28, carbohydrateContent: 36, fatContent: 18, fiberContent: 6, sugarContent: 7, recipeYield: 4,
    } }))
    const data = await response.json()
    expect(data.imageURL).toBe('https://recipes.example/client.jpg')
    expect(data.prepTime).toBe('10 min')
    expect(data.cookTime).toBe('50 min')
    expect(data.sourceNutrition).toMatchObject({ source: 'source_site', servings: 4, total: { calories: 1680 } })
  })

  it('rejects invalid attribution and url + html ambiguity before fetch or model work', async () => {
    for (const body of [
      { html: nachosHtml, sourceURL: 'javascript:bad' },
      { html: nachosHtml, sourceURL: 'https://user:secret@recipes.example/x' },
      { url: 'https://recipes.example/x', html: nachosHtml },
      { generate: 'nachos', sourceURL: 'https://recipes.example/x' },
    ]) expect((await POST(jsonRequest(body))).status).toBe(400)
    expect(mocks.safeFetchText).not.toHaveBeenCalled()
    expect(mocks.generateAIObject).not.toHaveBeenCalled()
  })
})
