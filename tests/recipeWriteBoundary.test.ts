import { beforeEach, describe, expect, it, vi } from 'vitest'

const firestore = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  setDoc: vi.fn(),
  runTransaction: vi.fn(),
}))

vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>()
  return {
    ...actual,
    doc: vi.fn(() => ({ path: 'recipes/test-recipe' })),
    runTransaction: firestore.runTransaction,
    setDoc: firestore.setDoc,
  }
})

vi.mock('@/lib/firebase', () => ({ db: {} }))

import { createRecipe, RecipeAlreadyExistsError, setRecipeDefaultRole } from '@/lib/recipes'
import { RECIPE_CATEGORIES } from '@/lib/recipeCategories'

const baseRecipe = {
  recipeID: '',
  title: 'Test Recipe',
  content: 'INGREDIENTS\n1 test',
  cuisine: 'test',
  imageURL: '',
  sourceURL: '',
  sourceFile: '',
  labels: 'Recipes',
  hasImage: 'false',
  created: '',
  modified: '',
}

describe('shared recipe category write boundary', () => {
  beforeEach(() => {
    firestore.get.mockReset().mockResolvedValue({ exists: () => false })
    firestore.set.mockReset()
    firestore.setDoc.mockReset().mockResolvedValue(undefined)
    firestore.runTransaction.mockReset().mockImplementation(async (_db, callback) => callback({
      get: firestore.get,
      set: firestore.set,
    }))
  })

  it('accepts every canonical category', async () => {
    for (const category of RECIPE_CATEGORIES) {
      await expect(createRecipe({ ...baseRecipe, category })).resolves.toBe('test-recipe')
    }
    expect(firestore.set).toHaveBeenCalledTimes(RECIPE_CATEGORIES.length)
  })

  it.each([
    '',
    'Chicken',
    'Breakfast, Snacks & Sides',
    'Other',
    'Some Random Category',
  ])('rejects noncanonical new shared category %j before Firestore', async category => {
    await expect(createRecipe({ ...baseRecipe, category } as never))
      .rejects.toThrow('Choose a valid recipe category')
    expect(firestore.set).not.toHaveBeenCalled()
  })

  it('fails closed when the normalized title already exists and never writes', async () => {
    const existing = { title: 'Original', content: 'do not replace' }
    firestore.get.mockResolvedValueOnce({ exists: () => true, data: () => existing })

    await expect(createRecipe({ ...baseRecipe, category: 'Sides', content: 'replacement' }))
      .rejects.toEqual(expect.objectContaining<Partial<RecipeAlreadyExistsError>>({
        code: 'recipe-already-exists',
        recipeId: 'test-recipe',
      }))
    expect(firestore.set).not.toHaveBeenCalled()
    expect(existing).toEqual({ title: 'Original', content: 'do not replace' })
  })

  it('keeps existing updates targeted to the explicit recipe id', async () => {
    await setRecipeDefaultRole('test-recipe', 'side')
    expect(firestore.setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'recipes/test-recipe' }),
      { defaultRole: 'side' },
      { merge: true },
    )
  })
})
