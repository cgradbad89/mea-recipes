import { beforeEach, describe, expect, it, vi } from 'vitest'

const firestore = vi.hoisted(() => ({
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
    runTransaction: firestore.runTransaction,
    serverTimestamp: firestore.serverTimestamp,
  }
})

vi.mock('@/lib/firebase', () => ({ db: {} }))

import { publishQueuedRecipe, publishQueuedRecipeInTransaction } from '@/lib/queue'
import { RecipeAlreadyExistsError, type SharedRecipeWrite } from '@/lib/recipes'

const recipe: SharedRecipeWrite = {
  recipeID: '',
  title: 'Queue Collision',
  content: 'INGREDIENTS\n1 test ingredient',
  category: 'Sides',
  cuisine: 'test',
  imageURL: '',
  sourceURL: '',
  sourceFile: '',
  labels: 'Recipes',
  hasImage: 'false',
  created: '',
  modified: '',
}

function snapshot(exists: boolean, data: Record<string, unknown> = {}) {
  return { exists: () => exists, data: () => data }
}

function transactionWith(states: Record<string, ReturnType<typeof snapshot>>) {
  return {
    get: vi.fn(async (ref: { path: string }) => states[ref.path] || snapshot(false)),
    set: vi.fn(),
    update: vi.fn(),
  }
}

describe('atomic queue publication', () => {
  beforeEach(() => firestore.runTransaction.mockReset())

  it('creates the recipe and marks the queue item published in one transaction', async () => {
    const transaction = transactionWith({
      'users/user-1/recipeQueue/queue-1': snapshot(true, { status: 'pending' }),
    })
    await expect(publishQueuedRecipeInTransaction(transaction as never, 'user-1', 'queue-1', recipe, 'user-1')).resolves.toEqual({
      recipeId: 'queue-collision',
      created: true,
    })
    expect(transaction.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'recipes/queue-collision' }),
      expect.objectContaining({ title: 'Queue Collision', recipeID: 'queue-collision', addedBy: 'user-1' }),
    )
    expect(transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/user-1/recipeQueue/queue-1' }),
      expect.objectContaining({ status: 'published', publishedRecipeId: 'queue-collision' }),
    )
  })

  it('leaves the pending queue item and existing recipe untouched on collision', async () => {
    const existing = { title: 'Original', content: 'original bytes' }
    const transaction = transactionWith({
      'users/user-1/recipeQueue/queue-1': snapshot(true, { status: 'pending' }),
      'recipes/queue-collision': snapshot(true, existing),
    })
    await expect(publishQueuedRecipeInTransaction(transaction as never, 'user-1', 'queue-1', recipe, 'user-1'))
      .rejects.toBeInstanceOf(RecipeAlreadyExistsError)
    expect(transaction.set).not.toHaveBeenCalled()
    expect(transaction.update).not.toHaveBeenCalled()
    expect(existing).toEqual({ title: 'Original', content: 'original bytes' })
  })

  it('recognizes a completed publication retry without writing again', async () => {
    const transaction = transactionWith({
      'users/user-1/recipeQueue/queue-1': snapshot(true, {
        status: 'published',
        publishedRecipeId: 'queue-collision',
      }),
      'recipes/queue-collision': snapshot(true, { title: 'Queue Collision' }),
    })
    await expect(publishQueuedRecipeInTransaction(transaction as never, 'user-1', 'queue-1', recipe, 'user-1')).resolves.toEqual({
      recipeId: 'queue-collision',
      created: false,
    })
    expect(transaction.set).not.toHaveBeenCalled()
    expect(transaction.update).not.toHaveBeenCalled()
  })

  it('does not report published status when the recipe write transaction fails', async () => {
    firestore.runTransaction.mockRejectedValueOnce(new Error('simulated commit failure'))

    await expect(publishQueuedRecipe('user-1', 'queue-1', recipe, 'user-1'))
      .rejects.toThrow('simulated commit failure')
  })
})
