import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  generateAIObject: vi.fn(),
  recipeData: {
    content: 'INGREDIENTS\n2 tablespoons olive oil\nINSTRUCTIONS\nMix well.',
    servings: 2,
  },
}))

vi.mock('@/lib/ai', () => ({ generateAIObject: mocks.generateAIObject }))
vi.mock('@/lib/firebaseAdmin', () => ({
  getAdminDb: () => ({
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: true, data: () => mocks.recipeData }),
      }),
    }),
  }),
}))

import { AI_PROVENANCE } from '@/lib/aiConfig'
import { computeRecipeNutrition, lookupFoodByName, parseIngredientLine } from '@/lib/nutritionEngine'

const AI_FOOD_RESULT = {
  calories: 240,
  protein_g: 12,
  carbs_g: 30,
  fat_g: 8,
  fiber_g: 4,
  sugar_g: 3,
  serving_grams: 180,
}

function jsonResponse(status: number, value: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(value),
  } as unknown as Response
}

function usdaFood(overrides: Record<string, unknown> = {}) {
  return {
    fdcId: 123,
    description: 'Apple, raw',
    dataType: 'Survey (FNDDS)',
    servingSize: 100,
    servingSizeUnit: 'g',
    foodNutrients: [
      { nutrientId: 1008, value: 52 },
      { nutrientId: 1003, value: 0.3 },
      { nutrientId: 1005, value: 13.8 },
      { nutrientId: 1004, value: 0.2 },
      { nutrientId: 1079, value: 2.4 },
      { nutrientId: 2000, value: 10.4 },
    ],
    ...overrides,
  }
}

async function lookupWithRetryTimers(name: string) {
  vi.useFakeTimers()
  const pending = lookupFoodByName(name)
  await vi.runAllTimersAsync()
  return pending
}

describe('nutrition migration behavior', () => {
  beforeEach(() => {
    mocks.generateAIObject.mockReset()
  })

  afterEach(() => {
    mocks.recipeData.content = 'INGREDIENTS\n2 tablespoons olive oil\nINSTRUCTIONS\nMix well.'
    delete process.env.USDA_API_KEY
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps deterministic ingredient parsing independent of AI', () => {
    expect(parseIngredientLine('2 tablespoons olive oil')).toEqual(expect.objectContaining({
      name: 'olive oil',
      grams: expect.closeTo(27.21, 1),
    }))
    expect(mocks.generateAIObject).not.toHaveBeenCalled()
  })

  it('normalizes nested parentheticals without leaking an orphan delimiter', () => {
    const parsed = parseIngredientLine('1 serrano (optional (or jalapeño))')
    expect(parsed?.name).toBe('serrano')
    expect(parsed?.name).not.toContain(')')
  })

  it('supports the Unicode fraction slash used by copied recipes', () => {
    expect(parseIngredientLine('1 ⁄ 2 cup olive oil')).toEqual(expect.objectContaining({
      name: 'olive oil',
      grams: expect.closeTo(108.831, 1),
    }))
  })

  it('uses the primary package size when alternatives appear in parentheses', () => {
    expect(parseIngredientLine('1 (15 oz) can chickpeas (or 2 8 oz cans)')).toEqual(expect.objectContaining({
      name: 'chickpeas',
      grams: expect.closeTo(425.25, 1),
    }))
  })

  it('keeps the core food noun when comma segments are preparation alternatives', () => {
    expect(parseIngredientLine('2 cups tomatoes, diced or crushed')).toEqual(expect.objectContaining({
      name: 'tomatoes',
    }))
  })

  it('does not resolve explicit plant-based meat as canonical beef', async () => {
    mocks.recipeData.content = 'INGREDIENTS\n1 pound plant-based vegan ground beef\nINSTRUCTIONS\nCook.'
    mocks.generateAIObject.mockResolvedValueOnce({
      calories: 180, protein_g: 18, carbs_g: 8, fat_g: 8, fiber_g: 4, sugar_g: 1,
    })
    const result = await computeRecipeNutrition('plant-based-test')
    expect(result.canonicalHits).toEqual([])
    expect(result.resolutions[0]?.resolvedBy).toBe('ai')
  })

  it('keeps canonical staples ahead of USDA and AI fallbacks', async () => {
    const result = await computeRecipeNutrition('olive-oil-test')

    expect(result.canonicalHits).toEqual([
      expect.objectContaining({ name: 'olive oil', fdcId: 171413 }),
    ])
    expect(result.nutrition).toEqual(expect.objectContaining({
      source: 'usda+canonical',
      confidence: 'high',
    }))
    expect(result.nutrition).not.toHaveProperty('ai_provenance')
    expect(mocks.generateAIObject).not.toHaveBeenCalled()
  })

  it('records provider/model/prompt provenance only on AI-derived food nutrition', async () => {
    delete process.env.USDA_API_KEY
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.generateAIObject.mockResolvedValueOnce(AI_FOOD_RESULT)

    const result = await lookupFoodByName('mystery protein bowl xyzq')

    expect(result).toEqual(expect.objectContaining({
      source: 'ai_estimate',
      aiProvenance: AI_PROVENANCE,
      servingGrams: 180,
    }))
    expect(mocks.generateAIObject).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'nutrition-food-estimate',
      schema: expect.anything(),
    }))
    expect(log).toHaveBeenCalledWith('[nutrition-usda]', expect.objectContaining({
      code: 'invalid_response', operation: 'food-search', errorName: 'MissingUsdaApiKey',
    }))
  })
})

describe('USDA operational failure observability', () => {
  beforeEach(() => {
    mocks.generateAIObject.mockReset()
    mocks.generateAIObject.mockResolvedValue(AI_FOOD_RESULT)
    process.env.USDA_API_KEY = 'test-usda-key'
  })

  afterEach(() => {
    delete process.env.USDA_API_KEY
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('logs USDA 429 responses and preserves AI fallback', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(429, {})))

    const result = await lookupWithRetryTimers('rate limited food')

    expect(result?.source).toBe('ai_estimate')
    expect(log).toHaveBeenCalledWith('[nutrition-usda]', expect.objectContaining({
      code: 'http_error', operation: 'food-search', status: 429, willFallbackToAI: true,
    }))
  })

  it('logs USDA 500 responses and preserves AI fallback', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, {})))

    const result = await lookupWithRetryTimers('server failure food')

    expect(result?.source).toBe('ai_estimate')
    expect(log).toHaveBeenCalledWith('[nutrition-usda]', expect.objectContaining({
      code: 'http_error', operation: 'food-search', status: 500,
    }))
  })

  it('logs fetch rejections as network errors and preserves AI fallback', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('provider unavailable')))

    const result = await lookupWithRetryTimers('network failure food')

    expect(result?.source).toBe('ai_estimate')
    expect(log).toHaveBeenCalledWith('[nutrition-usda]', expect.objectContaining({
      code: 'network_error', operation: 'food-search', errorName: 'TypeError',
    }))
  })

  it('logs timeout and abort failures distinctly from network errors', async () => {
    const timeout = new Error('request timed out')
    timeout.name = 'TimeoutError'
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout))

    const result = await lookupWithRetryTimers('timeout food')

    expect(result?.source).toBe('ai_estimate')
    expect(log).toHaveBeenCalledWith('[nutrition-usda]', expect.objectContaining({
      code: 'timeout', operation: 'food-search', errorName: 'TimeoutError',
    }))
  })

  it('logs malformed USDA JSON distinctly and preserves AI fallback', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const malformed = {
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new SyntaxError('malformed provider JSON')),
    } as unknown as Response
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(malformed))

    const result = await lookupWithRetryTimers('malformed json food')

    expect(result?.source).toBe('ai_estimate')
    expect(log).toHaveBeenCalledWith('[nutrition-usda]', expect.objectContaining({
      code: 'invalid_json', operation: 'food-search', status: 200, errorName: 'SyntaxError',
    }))
  })

  it('logs structurally unusable successful USDA responses', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: [] })))

    const result = await lookupFoodByName('invalid response food')

    expect(result?.source).toBe('ai_estimate')
    expect(log).toHaveBeenCalledWith('[nutrition-usda]', expect.objectContaining({
      code: 'invalid_response', operation: 'food-search', status: 200,
    }))
  })

  it('does not log a valid zero-result USDA response', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { foods: [] })))

    const result = await lookupFoodByName('genuine no match food')

    expect(result?.source).toBe('ai_estimate')
    expect(log).not.toHaveBeenCalled()
  })

  it('does not log candidates rejected by semantic validation', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      foods: [usdaFood({ description: 'Unrelated result' })],
    })))

    const result = await lookupFoodByName('quasar meal')

    expect(result?.source).toBe('ai_estimate')
    expect(log).not.toHaveBeenCalled()
  })

  it('preserves successful USDA food resolution without failure logs', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { foods: [usdaFood()] })))

    const result = await lookupFoodByName('apple')

    expect(result).toEqual(expect.objectContaining({
      source: 'usda', confidence: 'high', servingGrams: 100,
      nutrition: expect.objectContaining({ calories: 52, fiber_g: 2.4 }),
    }))
    expect(mocks.generateAIObject).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  it('rejects a prepared dish that only weakly overlaps a simple food query', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.generateAIObject.mockResolvedValueOnce(AI_FOOD_RESULT)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      foods: [usdaFood({ description: 'OLIVE GARDEN, cheese ravioli with marinara sauce' })],
    })))

    const result = await lookupFoodByName('marinara sauce')
    expect(result?.source).toBe('ai_estimate')
    expect(log).not.toHaveBeenCalled()
  })

  it('logs USDA detail failures while preserving the selected USDA result', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, {
        foods: [usdaFood({ servingSize: undefined, servingSizeUnit: undefined })],
      }))
      .mockResolvedValueOnce(jsonResponse(500, {}))
    vi.stubGlobal('fetch', fetchMock)

    const result = await lookupFoodByName('apple')

    expect(result).toEqual(expect.objectContaining({
      source: 'usda', confidence: 'medium', servingGrams: null,
    }))
    expect(mocks.generateAIObject).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('[nutrition-usda]', expect.objectContaining({
      code: 'http_error', operation: 'food-detail', status: 500, fdcId: 123,
      willFallbackToAI: false,
    }))
  })

  it('never serializes the USDA API key or credential-bearing URL in failure logs', async () => {
    const sentinel = 'USDA-SECRET-SENTINEL-DO-NOT-LOG'
    process.env.USDA_API_KEY = sentinel
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(400, {})))

    await lookupWithRetryTimers('safe preview query')

    const serializedLogs = JSON.stringify(log.mock.calls)
    expect(serializedLogs).toContain('[nutrition-usda]')
    expect(serializedLogs).not.toContain(sentinel)
    expect(serializedLogs).not.toContain('api_key')
    expect(serializedLogs).not.toContain('provider unavailable')
  })
})
