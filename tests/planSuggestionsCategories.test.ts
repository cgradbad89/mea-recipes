import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import { RECIPE_CATEGORIES } from '@/lib/recipeCategories'

const mocks = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  generateAIObject: vi.fn(),
  getComplementaryIngredients: vi.fn(),
}))

vi.mock('@/lib/firebaseAdmin', () => ({ verifyAuthToken: mocks.verifyAuthToken }))
vi.mock('@/lib/ai', () => ({ generateAIObject: mocks.generateAIObject }))
vi.mock('@/lib/flavorPairings', () => ({
  getComplementaryIngredients: mocks.getComplementaryIngredients,
}))

import { POST, PLAN_SUGGESTIONS_SCHEMA } from '@/app/api/plan-suggestions/route'

describe('POST /api/plan-suggestions canonical categories', () => {
  beforeEach(() => {
    mocks.verifyAuthToken.mockResolvedValue('user-123')
    mocks.getComplementaryIngredients.mockReturnValue([])
    mocks.generateAIObject.mockResolvedValue({ existing: [], new: [] })
  })

  it('uses the exact taxonomy and validates new suggestions with the canonical enum', async () => {
    const request = new NextRequest('http://localhost/api/plan-suggestions', {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'new',
        plannedRecipes: [{ title: 'Dinner', category: 'Chicken' }],
        existingRecipeTitles: ['Dinner'],
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(200)
    const prompt = mocks.generateAIObject.mock.calls[0][0].prompt as string
    RECIPE_CATEGORIES.forEach(category => expect(prompt).toContain(category))
    expect(prompt).not.toContain('Pasta Noodles & Rice')
    expect(prompt).not.toContain('Breakfast Snacks & Sides')

    const base = { existing: [], new: [{ title: 'Test', cuisine: 'test', reason: 'Because.' }] }
    expect(PLAN_SUGGESTIONS_SCHEMA.safeParse({
      ...base,
      new: [{ ...base.new[0], category: 'Sides' }],
    }).success).toBe(true)
    expect(PLAN_SUGGESTIONS_SCHEMA.safeParse({
      ...base,
      new: [{ ...base.new[0], category: 'Pasta Noodles & Rice' }],
    }).success).toBe(false)
  })
})
