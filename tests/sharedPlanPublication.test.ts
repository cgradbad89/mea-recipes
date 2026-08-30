import { beforeEach, describe, expect, it, vi } from 'vitest'

const firestore = vi.hoisted(() => ({
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
}))

vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>()
  return {
    ...actual,
    doc: vi.fn((_db, ...segments: string[]) => ({ path: segments.join('/') })),
    setDoc: firestore.setDoc,
    deleteDoc: firestore.deleteDoc,
    serverTimestamp: firestore.serverTimestamp,
  }
})

vi.mock('@/lib/firebase', () => ({ db: {} }))

import { publishSharedPlan, unpublishSharedPlan } from '@/lib/userdata'

describe('explicit shared-plan publication boundary', () => {
  beforeEach(() => {
    firestore.setDoc.mockReset().mockResolvedValue(undefined)
    firestore.deleteDoc.mockReset().mockResolvedValue(undefined)
  })

  it('publishes a reduced snapshot with only bare recipe IDs', async () => {
    await publishSharedPlan('owner-1', 'Owner', 'photo', '2026-08-24', [
      { recipeID: 'main-1', day: '2026-08-25', role: 'main' },
      { recipeID: 'side-1', day: null, role: 'side' },
    ])

    expect(firestore.setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'sharedWeekPlans/2026-08-24/users/owner-1' }),
      {
        uid: 'owner-1',
        displayName: 'Owner',
        photoURL: 'photo',
        plannedRecipeIDs: ['main-1', 'side-1'],
        updatedAt: 'SERVER_TIMESTAMP',
      },
    )
    const sharedPayload = firestore.setDoc.mock.calls[0][1]
    expect(JSON.stringify(sharedPayload)).not.toMatch(/day|role/)
  })

  it('unpublishes exactly the caller mirror for the selected week', async () => {
    await unpublishSharedPlan('owner-1', '2026-08-24')

    expect(firestore.deleteDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'sharedWeekPlans/2026-08-24/users/owner-1' }),
    )
  })
})
