import { beforeEach, describe, expect, it, vi } from 'vitest'

// Regression coverage for addRecipeIngredientsToGrocery (lib/userdata.ts) after
// the 2026-08-23 shared prepareGroceryItem consolidation — see
// docs/audits/shared-grocery-preparation-pipeline-2026-08-23.md. Verifies the
// recipe-add orchestration around the shared helper (identity lookup, quantity
// merge/unit conversion, sourceRecipeIDs, idempotency, manual/recipe pool
// separation) still behaves exactly as before. No live Firestore is used.

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

function mockExisting(items: Array<{ id: string; data: Record<string, unknown> }>) {
  firestore.getDocs.mockResolvedValue({
    docs: items.map(({ id, data }) => ({ id, data: () => data })),
  })
}

beforeEach(() => {
  firestore.batch.set.mockClear()
  firestore.batch.update.mockClear()
  firestore.batch.commit.mockClear()
  mockExisting([])
})

describe('addRecipeIngredientsToGrocery — same-unit merge (Case B, unchanged)', () => {
  it('sums identical units and appends sourceRecipeIDs', async () => {
    mockExisting([{
      id: 'flour',
      data: { id: 'flour', name: 'flour', quantity: '2', unit: 'cups', isManual: false, sourceRecipeIDs: ['recipe-0'] },
    }])

    await addRecipeIngredientsToGrocery('user-1', 'recipe-1', ['1 cup flour'])

    expect(firestore.batch.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ quantity: '3', unit: 'cups', sourceRecipeIDs: ['recipe-0', 'recipe-1'] }),
    )
    expect(firestore.batch.commit).toHaveBeenCalledOnce()
  })
})

describe('addRecipeIngredientsToGrocery — compatible-unit merge (Case C)', () => {
  it('converts the incoming quantity into the existing item unit and sums', async () => {
    mockExisting([{
      id: 'chicken-broth',
      data: { id: 'chicken-broth', name: 'chicken broth', quantity: '1', unit: 'cup', isManual: false, sourceRecipeIDs: ['recipe-0'] },
    }])

    await addRecipeIngredientsToGrocery('user-1', 'recipe-1', ['8 tbsp chicken broth'])

    expect(firestore.batch.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ quantity: '1.5', unit: 'cup' }),
    )
  })
})

describe('addRecipeIngredientsToGrocery — incompatible-unit merge (Case D, side-by-side)', () => {
  it('never converts weight into volume', async () => {
    mockExisting([{
      id: 'flour',
      data: { id: 'flour', name: 'flour', quantity: '1', unit: 'cup', isManual: false, sourceRecipeIDs: ['recipe-0'] },
    }])

    await addRecipeIngredientsToGrocery('user-1', 'recipe-1', ['200 g flour'])

    expect(firestore.batch.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ quantity: '1 cup + 200 g', unit: '' }),
    )
  })
})

describe('addRecipeIngredientsToGrocery — idempotency', () => {
  it('skips a recipe that already contributed to this grocery identity', async () => {
    mockExisting([{
      id: 'flour',
      data: { id: 'flour', name: 'flour', quantity: '2', unit: 'cups', isManual: false, sourceRecipeIDs: ['recipe-1'] },
    }])

    await addRecipeIngredientsToGrocery('user-1', 'recipe-1', ['1 cup flour'])

    expect(firestore.batch.update).not.toHaveBeenCalled()
    expect(firestore.batch.set).not.toHaveBeenCalled()
    expect(firestore.batch.commit).not.toHaveBeenCalled()
  })
})

describe('addRecipeIngredientsToGrocery — manual/recipe pool separation', () => {
  it('never merges a recipe-add into a manual item of the same identity', async () => {
    mockExisting([{
      id: 'garlic-manual',
      data: { id: 'garlic-manual', name: 'garlic', quantity: '3', unit: 'cloves', isManual: true, sourceRecipeIDs: [] },
    }])

    await addRecipeIngredientsToGrocery('user-1', 'recipe-1', ['garlic'])

    // A NEW recipe-sourced item is created instead of updating the manual one.
    expect(firestore.batch.update).not.toHaveBeenCalled()
    expect(firestore.batch.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'garlic', isManual: false, sourceRecipeIDs: ['recipe-1'] }),
    )
  })
})

describe('addRecipeIngredientsToGrocery — new item creation', () => {
  it('creates a new recipe-sourced item with sourceRecipeIDs and no manualSection', async () => {
    await addRecipeIngredientsToGrocery('user-1', 'recipe-1', ['2 cups rice'])

    expect(firestore.batch.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: 'rice', quantity: '2', unit: 'cups', isManual: false, sourceRecipeIDs: ['recipe-1'],
      }),
    )
    const [, written] = firestore.batch.set.mock.calls[0]
    expect(written).not.toHaveProperty('manualSection')
  })
})
