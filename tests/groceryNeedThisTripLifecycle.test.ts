import { beforeEach, describe, expect, it, vi } from 'vitest'

const firestore = vi.hoisted(() => {
  const batch = {
    delete: vi.fn(),
    set: vi.fn(),
    update: vi.fn(),
    commit: vi.fn(async () => undefined),
  }
  return {
    batch,
    getDocs: vi.fn(),
    updateDoc: vi.fn().mockResolvedValue(undefined),
    setDoc: vi.fn().mockResolvedValue(undefined),
    onSnapshot: vi.fn(),
  }
})

vi.mock('@/lib/firebase', () => ({ db: { kind: 'mock-db' } }))

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((...parts: unknown[]) => ({ kind: 'collection', parts })),
  doc: vi.fn((...parts: unknown[]) => ({ kind: 'doc', parts, id: String(parts.at(-1) ?? '') })),
  getDocs: firestore.getDocs,
  getDoc: vi.fn(),
  setDoc: firestore.setDoc,
  deleteDoc: vi.fn(),
  updateDoc: firestore.updateDoc,
  query: vi.fn(),
  orderBy: vi.fn(),
  serverTimestamp: vi.fn(() => 'mock-timestamp'),
  onSnapshot: firestore.onSnapshot,
  writeBatch: vi.fn(() => firestore.batch),
  deleteField: vi.fn(),
  runTransaction: vi.fn(),
}))

vi.mock('@/lib/firestoreBatch', () => ({
  commitFirestoreBatches: vi.fn(async (_db: unknown, operations: Array<(batch: typeof firestore.batch) => void>) => {
    if (operations.length === 0) return
    operations.forEach(operation => operation(firestore.batch))
    await firestore.batch.commit()
  }),
}))

import {
  clearAllGroceryItems,
  rebuildGroceryFromPlan,
  setGroceryItemNeedThisTrip,
  subscribeGroceryItems,
} from '@/lib/userdata'

function document(id: string, data: Record<string, unknown>) {
  return { id, ref: { kind: 'ref', id }, data: () => data }
}

beforeEach(() => {
  vi.clearAllMocks()
  firestore.updateDoc.mockResolvedValue(undefined)
  firestore.setDoc.mockResolvedValue(undefined)
  firestore.batch.commit.mockResolvedValue(undefined)
})

describe('Need This Trip active-item persistence', () => {
  it.each([true, false])('sets %s using a narrow owner-scoped partial update', async needThisTrip => {
    await setGroceryItemNeedThisTrip('user-1', 'olive-oil', needThisTrip)

    expect(firestore.updateDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [{ kind: 'collection', parts: [{ kind: 'mock-db' }, 'users', 'user-1', 'pantry', 'root', 'groceryItems'] }, 'olive-oil'],
      }),
      { needThisTrip, updatedAt: 'mock-timestamp' },
    )
    expect(firestore.setDoc).not.toHaveBeenCalled()
  })

  it('leaves historical absence absent on read so it behaves as false without a backfill', () => {
    firestore.onSnapshot.mockImplementation((_path, onData: (snapshot: unknown) => void) => {
      onData({
        docs: [document('salt', {
          id: 'salt', name: 'salt', quantity: '1', unit: 'tsp', isChecked: false,
          isManual: false, sourceRecipeIDs: ['recipe-1'],
        })],
      })
      return vi.fn()
    })
    const received = vi.fn()

    subscribeGroceryItems('user-1', received)

    expect(received).toHaveBeenCalledWith([
      expect.not.objectContaining({ needThisTrip: expect.anything() }),
    ])
    expect(firestore.updateDoc).not.toHaveBeenCalled()
    expect(firestore.setDoc).not.toHaveBeenCalled()
  })

  it('expires overrides naturally when the active list is cleared', async () => {
    const active = document('olive-oil', {
      id: 'olive-oil', name: 'olive oil', needThisTrip: true, isManual: false,
    })
    firestore.getDocs.mockResolvedValue({ docs: [active] })

    await clearAllGroceryItems('user-1')

    expect(firestore.batch.delete).toHaveBeenCalledWith(active.ref)
    expect(firestore.updateDoc).not.toHaveBeenCalled()
    expect(firestore.setDoc).not.toHaveBeenCalled()
  })
})

describe('Need This Trip plan-rebuild lifecycle', () => {
  const recipe = {
    recipeID: 'recipe-1',
    content: 'INGREDIENTS\n1 tbsp olive oil\nINSTRUCTIONS\nCook',
  }
  const parseContent = () => ({ ingredients: ['1 tbsp olive oil'], instructions: [], description: '' })

  it('reapplies an override to a recreated exact normalized identity', async () => {
    const oldItem = document('old-oil', {
      id: 'old-oil', name: 'Olive oils', isManual: false, needThisTrip: true,
    })
    const rebuiltItem = document('olive-oil', {
      id: 'olive-oil', name: 'olive oil', isManual: false, sourceRecipeIDs: ['recipe-1'],
    })
    firestore.getDocs
      .mockResolvedValueOnce({ docs: [oldItem] })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [rebuiltItem] })

    await rebuildGroceryFromPlan(
      'user-1', ['recipe-1'], async () => recipe as never, parseContent,
    )

    expect(firestore.batch.delete).toHaveBeenCalledWith(oldItem.ref)
    expect(firestore.batch.update).toHaveBeenCalledWith(
      rebuiltItem.ref,
      { needThisTrip: true, updatedAt: 'mock-timestamp' },
    )
  })

  it('does not resurrect an overridden identity missing from the rebuilt list', async () => {
    const oldItem = document('old-oil', {
      id: 'old-oil', name: 'olive oil', isManual: false, needThisTrip: true,
    })
    firestore.getDocs
      .mockResolvedValueOnce({ docs: [oldItem] })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] })

    await rebuildGroceryFromPlan(
      'user-1', ['recipe-1'], async () => recipe as never, () => ({ ingredients: [], instructions: [], description: '' }),
    )

    expect(firestore.batch.update).not.toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ needThisTrip: true }),
    )
    expect(firestore.batch.set).not.toHaveBeenCalled()
  })

  it('never transfers the override to a different or fuzzy identity', async () => {
    const oldItem = document('old-oil', {
      id: 'old-oil', name: 'olive oil', isManual: false, needThisTrip: true,
    })
    const differentItem = document('extra-virgin-olive-oil', {
      id: 'extra-virgin-olive-oil', name: 'extra-virgin olive oil', isManual: false,
    })
    firestore.getDocs
      .mockResolvedValueOnce({ docs: [oldItem] })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [differentItem] })

    await rebuildGroceryFromPlan(
      'user-1', ['recipe-1'], async () => recipe as never, parseContent,
    )

    expect(firestore.batch.update).not.toHaveBeenCalledWith(
      differentItem.ref, expect.objectContaining({ needThisTrip: true }),
    )
  })

  it('keeps manual overridden items in place without rebuild reapplication', async () => {
    const manualItem = document('manual-oil', {
      id: 'manual-oil', name: 'olive oil', isManual: true, needThisTrip: true,
    })
    firestore.getDocs
      .mockResolvedValueOnce({ docs: [manualItem] })
      .mockResolvedValueOnce({ docs: [manualItem] })

    await rebuildGroceryFromPlan(
      'user-1', ['recipe-1'], async () => recipe as never, parseContent,
    )

    expect(firestore.batch.delete).not.toHaveBeenCalledWith(manualItem.ref)
    expect(firestore.batch.update).not.toHaveBeenCalledWith(
      manualItem.ref, expect.objectContaining({ needThisTrip: true }),
    )
  })
})
