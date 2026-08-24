import { beforeEach, describe, expect, it, vi } from 'vitest'

const firestore = vi.hoisted(() => ({
  getDocs: vi.fn(),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  setDoc: vi.fn().mockResolvedValue(undefined),
  timestamp: { kind: 'server-timestamp' },
}))

vi.mock('@/lib/firebase', () => ({ db: { kind: 'mock-db' } }))

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((...parts: unknown[]) => ({ kind: 'collection', parts })),
  doc: vi.fn((...parts: unknown[]) => ({ kind: 'doc', parts })),
  getDocs: firestore.getDocs,
  getDoc: vi.fn(),
  setDoc: firestore.setDoc,
  deleteDoc: vi.fn(),
  updateDoc: firestore.updateDoc,
  query: vi.fn(),
  orderBy: vi.fn(),
  serverTimestamp: vi.fn(() => firestore.timestamp),
  onSnapshot: vi.fn(),
  writeBatch: vi.fn(),
  deleteField: vi.fn(),
  runTransaction: vi.fn(),
}))

import {
  getSavedGroceryItems,
  setSavedGroceryItemUsuallyOnHand,
  upsertSavedGroceryItem,
} from '@/lib/userdata'

function document(id: string, data: Record<string, unknown>) {
  return { id, data: () => data }
}

beforeEach(() => {
  firestore.getDocs.mockReset()
  firestore.updateDoc.mockClear()
  firestore.setDoc.mockClear()
})

describe('saved grocery preference reads', () => {
  it('keeps historical documents compatible and preserves explicit boolean values', async () => {
    firestore.getDocs.mockResolvedValue({
      docs: [
        document('salt', { id: 'salt', name: 'salt', defaultCategory: 'Spices & Seasonings', timesUsed: 3, lastUsed: null }),
        document('pepper', { id: 'pepper', name: 'black pepper', defaultCategory: 'Spices & Seasonings', timesUsed: 2, lastUsed: null, usuallyOnHand: false }),
        document('oil', { id: 'oil', name: 'olive oil', defaultCategory: 'Sauces & Condiments', timesUsed: 1, lastUsed: null, usuallyOnHand: true }),
      ],
    })

    const result = await getSavedGroceryItems('user-1')

    expect(result[0].usuallyOnHand).toBeUndefined()
    expect(result[1].usuallyOnHand).toBe(false)
    expect(result[2].usuallyOnHand).toBe(true)
  })
})

describe('saved grocery preference writes', () => {
  it('updates only the preference on an existing identity and preserves saved metadata', async () => {
    const existing = {
      id: 'olive-oil',
      name: 'olive oil',
      defaultCategory: 'Sauces & Condiments',
      timesUsed: 7,
      lastUsed: 'original-last-used',
      usuallyOnHand: false,
    }
    firestore.getDocs.mockResolvedValue({ docs: [document('olive-oil', existing)] })

    const result = await setSavedGroceryItemUsuallyOnHand(
      'user-1', 'Olive oils', 'Sauces & Condiments', true,
    )

    expect(firestore.updateDoc).toHaveBeenCalledOnce()
    expect(firestore.updateDoc.mock.calls[0][1]).toEqual({ usuallyOnHand: true })
    expect(result).toMatchObject({
      name: 'olive oil',
      defaultCategory: 'Sauces & Condiments',
      timesUsed: 7,
      lastUsed: 'original-last-used',
      usuallyOnHand: true,
    })
  })

  it('ordinary saved-item upserts preserve an existing true preference', async () => {
    firestore.getDocs.mockResolvedValue({
      docs: [document('olive-oil', {
        id: 'olive-oil', name: 'olive oil', defaultCategory: 'Other', timesUsed: 4,
        lastUsed: 'old-timestamp', usuallyOnHand: true,
      })],
    })

    await upsertSavedGroceryItem('user-1', 'olive oils', 'Sauces & Condiments')

    const update = firestore.updateDoc.mock.calls[0][1]
    expect(update).toMatchObject({ timesUsed: 5, defaultCategory: 'Sauces & Condiments' })
    expect(update).not.toHaveProperty('usuallyOnHand')
    expect(update).not.toHaveProperty('name')
  })

  it('creates preference-only identity memory with zero uses and the active category', async () => {
    firestore.getDocs.mockResolvedValue({ docs: [] })

    const result = await setSavedGroceryItemUsuallyOnHand(
      'user-1', 'rice', 'Pantry & Dry Goods', true,
    )

    expect(firestore.setDoc).toHaveBeenCalledOnce()
    expect(firestore.setDoc.mock.calls[0][1]).toMatchObject({
      name: 'rice', defaultCategory: 'Pantry & Dry Goods', timesUsed: 0, usuallyOnHand: true,
    })
    expect(result.timesUsed).toBe(0)
    expect(firestore.updateDoc).not.toHaveBeenCalled()
  })

  it('updates all historical duplicate documents for one normalized identity, but no distinct identity', async () => {
    firestore.getDocs.mockResolvedValue({
      docs: [
        document('olive-oil', { id: 'olive-oil', name: 'olive oil', defaultCategory: 'Sauces & Condiments', timesUsed: 2, lastUsed: null }),
        document('olive-oils', { id: 'olive-oils', name: 'olive oils', defaultCategory: 'Sauces & Condiments', timesUsed: 1, lastUsed: null }),
        document('extra-virgin-olive-oil', { id: 'extra-virgin-olive-oil', name: 'extra-virgin olive oil', defaultCategory: 'Sauces & Condiments', timesUsed: 1, lastUsed: null }),
      ],
    })

    await setSavedGroceryItemUsuallyOnHand('user-1', 'olive oil', 'Sauces & Condiments', false)

    expect(firestore.updateDoc).toHaveBeenCalledTimes(2)
    expect(firestore.updateDoc.mock.calls.every(([, value]) => value.usuallyOnHand === false)).toBe(true)
  })
})
