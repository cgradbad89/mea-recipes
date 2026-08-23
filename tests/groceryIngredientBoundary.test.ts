import { beforeEach, describe, expect, it, vi } from 'vitest'
import { categorizeIngredient } from '@/lib/groceryCategories'

const firestore = vi.hoisted(() => {
  const batch = {
    set: vi.fn(),
    update: vi.fn(),
    commit: vi.fn(async () => undefined),
  }
  return {
    batch,
    getDocs: vi.fn(),
    writeBatch: vi.fn(() => batch),
  }
})

vi.mock('@/lib/firebase', () => ({ db: { kind: 'mock-db' } }))

vi.mock('@/lib/ingredientParser', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ingredientParser')>()
  return {
    ...actual,
    parseIngredient: vi.fn((raw: string) => raw === 'EMPTY_PARSED_NAME'
      ? { quantity: '1', unit: 'cup', name: '', confidence: 'high' as const }
      : actual.parseIngredient(raw)),
  }
})

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((...parts: unknown[]) => ({ kind: 'collection', parts })),
  doc: vi.fn((...parts: unknown[]) => ({ kind: 'doc', parts, id: String(parts.at(-1) ?? '') })),
  getDocs: firestore.getDocs,
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
  updateDoc: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  serverTimestamp: vi.fn(() => 'mock-timestamp'),
  onSnapshot: vi.fn(),
  writeBatch: firestore.writeBatch,
  deleteField: vi.fn(),
  runTransaction: vi.fn(),
}))

import { addRecipeIngredientsToGrocery } from '@/lib/userdata'

beforeEach(() => {
  firestore.getDocs.mockResolvedValue({ docs: [] })
})

describe('addRecipeIngredientsToGrocery final boundary', () => {
  it.each([
    ['recognized subheader', 'For the Chicken'],
    ['explicit URL', 'https://example.com/recipe'],
    ['empty parsed name', 'EMPTY_PARSED_NAME'],
  ])('does not write a %s', async (_case, line) => {
    await addRecipeIngredientsToGrocery('user-1', 'recipe-1', [line])

    expect(firestore.batch.set).not.toHaveBeenCalled()
    expect(firestore.batch.update).not.toHaveBeenCalled()
    expect(firestore.batch.commit).not.toHaveBeenCalled()
  })

  it('accepts a real no-quantity ingredient', async () => {
    await addRecipeIngredientsToGrocery('user-1', 'recipe-1', ['garlic'])

    expect(firestore.batch.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'garlic', quantity: '', unit: '' }),
    )
    expect(firestore.batch.commit).toHaveBeenCalledOnce()
  })

  it('accepts a real ingredient even when its category is Other', async () => {
    expect(categorizeIngredient('brusselsprouts')).toBe('Other')

    await addRecipeIngredientsToGrocery('user-1', 'recipe-1', ['brusselsprouts'])

    expect(firestore.batch.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'brusselsprouts' }),
    )
    expect(firestore.batch.commit).toHaveBeenCalledOnce()
  })

  it('keeps normal parsed quantity/unit/name behavior unchanged', async () => {
    await addRecipeIngredientsToGrocery('user-1', 'recipe-1', ['2 cups rice'])

    expect(firestore.batch.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'rice', quantity: '2', unit: 'cups' }),
    )
    expect(firestore.batch.commit).toHaveBeenCalledOnce()
  })
})
