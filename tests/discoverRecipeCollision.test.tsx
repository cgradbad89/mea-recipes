// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createRecipe: vi.fn(),
  prepareCookingStepIngredientMap: vi.fn(),
  computeAndStoreNutrition: vi.fn(),
  triggerCookingModeMappingGeneration: vi.fn(),
  invalidateRecipeCache: vi.fn(),
  getIdToken: vi.fn(),
  refetchRecipes: vi.fn(),
  refetchCookingHistory: vi.fn(),
  recipes: [] as unknown[],
  metas: {},
  favorites: new Set<string>(),
  cookingHistory: [] as unknown[],
  user: { uid: 'user-1', getIdToken: vi.fn() },
}))

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user }),
}))

vi.mock('@/components/AppDataProvider', () => ({
  useAppData: () => ({
    recipes: mocks.recipes,
    metas: mocks.metas,
    favorites: mocks.favorites,
    cookingHistory: mocks.cookingHistory,
    refetchRecipes: mocks.refetchRecipes,
    refetchCookingHistory: mocks.refetchCookingHistory,
  }),
}))

vi.mock('@/lib/recipes', () => ({
  createRecipe: mocks.createRecipe,
  invalidateRecipeCache: mocks.invalidateRecipeCache,
  computeAndStoreNutrition: mocks.computeAndStoreNutrition,
  prepareCookingStepIngredientMap: mocks.prepareCookingStepIngredientMap,
  triggerCookingModeMappingGeneration: mocks.triggerCookingModeMappingGeneration,
  getTotalTime: () => ({ minutes: 0, display: '' }),
}))

vi.mock('@/lib/queue', () => ({
  addToQueue: vi.fn(),
  buildRecipeContent: (recipe: { ingredients?: string[]; instructions?: string[] }) =>
    `INGREDIENTS\n${(recipe.ingredients || []).join('\n')}\n\nINSTRUCTIONS\n${(recipe.instructions || []).join('\n')}`,
}))

vi.mock('@/lib/userdata', () => ({
  weekIDFromDate: (date: Date) => date.toISOString().slice(0, 10),
  getWeekPlan: vi.fn().mockResolvedValue(null),
  addRecipeToWeekPlan: vi.fn(),
  resolveRecipeRole: () => 'main',
  plannedRecipeIDList: () => [],
}))

vi.mock('@/components/RecipeCard', () => ({ default: () => null }))
vi.mock('@/components/RecipeImage', () => ({ default: () => null }))

import DiscoverPage from '@/app/discover/page'

describe('Discover recipe title collision', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    })
    mocks.createRecipe.mockReset().mockRejectedValue(new Error(
      'A recipe with this title already exists. Change the title, or open the existing recipe to edit it intentionally.',
    ))
    mocks.prepareCookingStepIngredientMap.mockReset().mockResolvedValue({
      schemaVersion: 1,
      parserVersion: 'recipe-content-v1',
      engineVersion: 'deterministic-v5',
      sourceHash: 'a'.repeat(64),
      steps: [],
    })
    mocks.computeAndStoreNutrition.mockReset()
    mocks.triggerCookingModeMappingGeneration.mockReset()
    mocks.invalidateRecipeCache.mockReset()
    mocks.getIdToken.mockReset().mockResolvedValue('token')
    mocks.user.getIdToken = mocks.getIdToken
    mocks.refetchRecipes.mockReset()
    mocks.refetchCookingHistory.mockReset()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      title: 'Existing Title',
      cuisine: 'Italian',
      category: 'Pasta, Noodles & Rice',
      ingredients: ['1 cup pasta'],
      instructions: ['Cook the pasta.'],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('preserves the generated draft, shows the conflict, and never enriches the existing recipe', async () => {
    render(<DiscoverPage />)
    fireEvent.change(screen.getByPlaceholderText(/classic vegetable stir fry/i), {
      target: { value: 'Existing Title' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate Recipe' }))

    expect(await screen.findByRole('heading', { name: 'Existing Title' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save to My Recipes' }))

    await waitFor(() => expect(screen.getByText(/already exists/i)).toBeTruthy())
    expect(screen.getByRole('heading', { name: 'Existing Title' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save to My Recipes' })).toBeTruthy()
    expect(mocks.computeAndStoreNutrition).not.toHaveBeenCalled()
    expect(mocks.triggerCookingModeMappingGeneration).not.toHaveBeenCalled()
    expect(mocks.refetchRecipes).not.toHaveBeenCalled()
  })
})
