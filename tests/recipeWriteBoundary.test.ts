import { beforeEach, describe, expect, it, vi } from 'vitest'

const firestore = vi.hoisted(() => ({ setDoc: vi.fn() }))

vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>()
  return {
    ...actual,
    doc: vi.fn(() => ({ path: 'recipes/test-recipe' })),
    setDoc: firestore.setDoc,
  }
})

vi.mock('@/lib/firebase', () => ({ db: {} }))

import { saveRecipe } from '@/lib/recipes'
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
  beforeEach(() => firestore.setDoc.mockReset().mockResolvedValue(undefined))

  it('accepts every canonical category', async () => {
    for (const category of RECIPE_CATEGORIES) {
      await expect(saveRecipe({ ...baseRecipe, category })).resolves.toBe('test-recipe')
    }
    expect(firestore.setDoc).toHaveBeenCalledTimes(RECIPE_CATEGORIES.length)
  })

  it.each([
    '',
    'Chicken',
    'Breakfast, Snacks & Sides',
    'Other',
    'Some Random Category',
  ])('rejects noncanonical new shared category %j before Firestore', async category => {
    await expect(saveRecipe({ ...baseRecipe, category } as never))
      .rejects.toThrow('Choose a valid recipe category')
    expect(firestore.setDoc).not.toHaveBeenCalled()
  })
})
