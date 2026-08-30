import { beforeEach, describe, expect, it, vi } from 'vitest'

const firestore = vi.hoisted(() => ({
  getDocs: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
}))

vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>()
  return {
    ...actual,
    collection: vi.fn((_db, ...segments: string[]) => ({ path: segments.join('/') })),
    doc: vi.fn((root: { path?: string }, ...segments: string[]) => ({
      path: root?.path ? [root.path, ...segments].join('/') : segments.join('/'),
    })),
    getDocs: firestore.getDocs,
    query: vi.fn((path: unknown) => path),
    where: vi.fn(),
    orderBy: vi.fn(),
    runTransaction: firestore.runTransaction,
    serverTimestamp: firestore.serverTimestamp,
  }
})

vi.mock('@/lib/firebase', () => ({ db: {} }))

import {
  CookEventNutritionError,
  cookEventDocumentId,
  logCookEvent,
  undoCookEvent,
} from '@/lib/consumptionLog'

type Stored = Record<string, unknown>

function memoryTransaction(store: Map<string, Stored>) {
  return {
    get: vi.fn(async (ref: { path: string }) => ({
      exists: () => store.has(ref.path),
      data: () => store.get(ref.path),
    })),
    set: vi.fn((ref: { path: string }, data: Stored) => store.set(ref.path, data)),
    update: vi.fn((ref: { path: string }, data: Stored) => {
      store.set(ref.path, { ...(store.get(ref.path) || {}), ...data })
    }),
    delete: vi.fn((ref: { path: string }) => store.delete(ref.path)),
  }
}

const macros = {
  calories: 400,
  protein_g: 20,
  carbs_g: 50,
  fat_g: 12,
  fiber_g: 6,
  sugar_g: 4,
}

const occurredAt = new Date('2026-08-25T18:30:00')
const planPath = 'users/user-1/pantry/root/weekPlans/2026-08-24'
const entryId = 'cook-2026-08-25-recipe-1'
const logDocumentPath = `users/user-1/nutrition/root/log/${entryId}`

describe('atomic cook-event transition', () => {
  beforeEach(() => {
    firestore.getDocs.mockReset().mockResolvedValue({ docs: [] })
    firestore.runTransaction.mockReset()
  })

  it('atomically creates one plan state and one nutrition snapshot', async () => {
    const store = new Map<string, Stored>()
    const transaction = memoryTransaction(store)
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback(transaction))

    await expect(logCookEvent('user-1', {
      recipeId: 'recipe-1',
      recipeName: 'Recipe One',
      perServing: macros,
      servingsEaten: 1.5,
      weekID: '2026-08-24',
      role: 'side',
      occurredAt,
    })).resolves.toEqual({ loggedEntryId: entryId, duplicate: false })

    expect(store.get(planPath)).toEqual(expect.objectContaining({
      plannedRecipeIDs: [{ recipeID: 'recipe-1', day: null, role: 'side' }],
      cookedRecipeIDs: ['recipe-1'],
    }))
    expect(store.get(logDocumentPath)).toEqual(expect.objectContaining({
      cook_event_key: entryId,
      servings_eaten: 1.5,
      nutrition: { calories: 600, protein_g: 30, carbs_g: 75, fat_g: 18, fiber_g: 9, sugar_g: 6 },
    }))
  })

  it('deduplicates repeat clicks and network retries by persisted document identity', async () => {
    const store = new Map<string, Stored>()
    const transaction = memoryTransaction(store)
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback(transaction))

    const params = {
      recipeId: 'recipe-1', recipeName: 'Recipe One', perServing: macros,
      servingsEaten: 1, weekID: '2026-08-24', occurredAt,
    }
    await logCookEvent('user-1', params)
    await expect(logCookEvent('user-1', params)).resolves.toEqual({ loggedEntryId: null, duplicate: true })

    expect(transaction.set.mock.calls.filter(([ref]) => ref.path === logDocumentPath)).toHaveLength(1)
  })

  it('recognizes a legacy same-day random-ID cook log without creating a second entry', async () => {
    const legacyPath = 'users/user-1/nutrition/root/log/legacy-random-id'
    const store = new Map<string, Stored>([
      [planPath, {
        weekID: '2026-08-24', plannedRecipeIDs: ['recipe-1'], cookedRecipeIDs: [],
      }],
      [legacyPath, { is_cook_event: true, recipe_id: 'recipe-1' }],
    ])
    const transaction = memoryTransaction(store)
    firestore.getDocs.mockResolvedValueOnce({
      docs: [{
        id: 'legacy-random-id',
        data: () => ({ is_cook_event: true, recipe_id: 'recipe-1', created_at: null }),
      }],
    })
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback(transaction))

    await expect(logCookEvent('user-1', {
      recipeId: 'recipe-1', recipeName: 'Recipe One', perServing: null,
      servingsEaten: 1, weekID: '2026-08-24', occurredAt,
    })).resolves.toEqual({ loggedEntryId: null, duplicate: true })

    expect(store.has(logDocumentPath)).toBe(false)
    expect(store.get(planPath)).toEqual(expect.objectContaining({ cookedRecipeIDs: ['recipe-1'] }))
  })

  it('converges after a committed response is reported as uncertain', async () => {
    const store = new Map<string, Stored>()
    const transaction = memoryTransaction(store)
    let first = true
    firestore.runTransaction.mockImplementation(async (_db, callback) => {
      const result = await callback(transaction)
      if (first) {
        first = false
        throw new Error('response lost after commit')
      }
      return result
    })
    const params = {
      recipeId: 'recipe-1', recipeName: 'Recipe One', perServing: macros,
      servingsEaten: 1, weekID: '2026-08-24', occurredAt,
    }

    await expect(logCookEvent('user-1', params)).rejects.toThrow('response lost')
    await expect(logCookEvent('user-1', params)).resolves.toEqual({ loggedEntryId: null, duplicate: true })
    expect(transaction.set.mock.calls.filter(([ref]) => ref.path === logDocumentPath)).toHaveLength(1)
  })

  it('allows the same recipe to produce a new event on another local day', () => {
    expect(cookEventDocumentId('recipe-1', occurredAt)).not.toBe(
      cookEventDocumentId('recipe-1', new Date('2026-08-26T18:30:00')),
    )
  })

  it('fails before any write when nutrition is unavailable', async () => {
    const transaction = memoryTransaction(new Map())
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback(transaction))

    await expect(logCookEvent('user-1', {
      recipeId: 'recipe-1', recipeName: 'Recipe One', perServing: null,
      servingsEaten: 1, weekID: '2026-08-24', occurredAt,
    })).rejects.toBeInstanceOf(CookEventNutritionError)

    expect(transaction.set).not.toHaveBeenCalled()
    expect(transaction.update).not.toHaveBeenCalled()
  })

  it('atomically removes the plan cooked flag and associated deterministic log on undo', async () => {
    const store = new Map<string, Stored>([
      [planPath, {
        weekID: '2026-08-24', plannedRecipeIDs: ['recipe-1'], cookedRecipeIDs: ['recipe-1', 'other'],
      }],
      [logDocumentPath, { is_cook_event: true, recipe_id: 'recipe-1' }],
    ])
    const transaction = memoryTransaction(store)
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback(transaction))

    await expect(undoCookEvent('user-1', {
      recipeId: 'recipe-1', weekID: '2026-08-24', occurredAt,
    })).resolves.toEqual({ removedLogCount: 1 })

    expect(store.get(planPath)).toEqual(expect.objectContaining({ cookedRecipeIDs: ['other'] }))
    expect(store.has(logDocumentPath)).toBe(false)
  })
})
