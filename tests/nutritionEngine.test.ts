import { afterEach, describe, expect, it, vi } from 'vitest'

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

describe('nutrition migration behavior', () => {
  afterEach(() => {
    delete process.env.USDA_API_KEY
  })

  it('keeps deterministic ingredient parsing independent of AI', () => {
    expect(parseIngredientLine('2 tablespoons olive oil')).toEqual(expect.objectContaining({
      name: 'olive oil',
      grams: expect.closeTo(27.21, 1),
    }))
    expect(mocks.generateAIObject).not.toHaveBeenCalled()
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
    mocks.generateAIObject.mockResolvedValueOnce({
      calories: 240,
      protein_g: 12,
      carbs_g: 30,
      fat_g: 8,
      fiber_g: 4,
      sugar_g: 3,
      serving_grams: 180,
    })

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
  })
})
