// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  updateDoc: vi.fn(),
  rebuild: vi.fn(),
  delaySnapshot: false,
  onData: null as null | ((items: unknown[]) => void),
  user: { uid: 'user-1' },
}))

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user }),
}))

vi.mock('@/lib/firebase', () => ({ db: {} }))

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  updateDoc: mocks.updateDoc,
  deleteDoc: vi.fn(),
  setDoc: vi.fn(),
  serverTimestamp: vi.fn(() => 'timestamp'),
}))

vi.mock('@/lib/userdata', () => ({
  subscribeGroceryItems: (_uid: string, onData: (items: unknown[]) => void) => {
    mocks.onData = onData
    if (!mocks.delaySnapshot) onData([{
      id: 'milk',
      name: 'Milk',
      quantity: '',
      unit: '',
      isChecked: false,
      isManual: true,
      manualSection: 'Dairy & Eggs',
      sourceRecipeIDs: [],
    }])
    return vi.fn()
  },
  weekIDFromDate: () => '2026-08-17',
  getWeekPlan: vi.fn().mockResolvedValue(null),
  rebuildGroceryFromPlan: mocks.rebuild,
  getSavedGroceryItems: vi.fn().mockResolvedValue([]),
  upsertSavedGroceryItem: vi.fn().mockResolvedValue(undefined),
  setGroceryItemNeedThisTrip: vi.fn().mockResolvedValue(undefined),
  setSavedGroceryItemUsuallyOnHand: vi.fn().mockResolvedValue(undefined),
  deleteSavedGroceryItem: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/recipes', () => ({
  getRecipeById: vi.fn(),
  parseRecipeContent: vi.fn(() => ({ ingredients: [] })),
}))

vi.mock('@/lib/firestoreBatch', () => ({
  commitFirestoreBatches: vi.fn(),
}))

import GroceryPage from '@/app/grocery/page'

beforeEach(() => {
  mocks.delaySnapshot = false
  mocks.onData = null
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() },
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('grocery write errors', () => {
  it('renders an inline message when toggling an item fails', async () => {
    mocks.updateDoc.mockRejectedValueOnce(new Error('offline'))
    render(<GroceryPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Mark Milk checked' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Couldn’t update “Milk”')
  })
})


it('reports a failed rebuild and re-enables the control', async () => {
  mocks.rebuild.mockRejectedValueOnce(new Error('Rebuild stopped; grocery list was not changed.'))
  render(<GroceryPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Rebuild grocery list' }))
  fireEvent.click(screen.getByRole('button', { name: 'Rebuild' }))
  expect((await screen.findByRole('alert')).textContent).toContain('grocery list was not changed')
  expect(screen.getByRole('button', { name: 'Rebuild grocery list' }).hasAttribute('disabled')).toBe(false)
})


it('shows loading until the first owner snapshot instead of an empty list', () => {
  mocks.delaySnapshot = true
  render(<GroceryPage />)
  expect(screen.getByText('Loading grocery list…')).toBeTruthy()
  expect(screen.queryByText('List is empty')).toBeNull()
  act(() => mocks.onData?.([]))
  expect(screen.getByText('List is empty')).toBeTruthy()
})
