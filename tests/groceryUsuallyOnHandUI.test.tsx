// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  updateDoc: vi.fn().mockResolvedValue(undefined),
  setNeedThisTrip: vi.fn().mockResolvedValue(undefined),
  setPreference: vi.fn(),
  getSaved: vi.fn(),
  user: { uid: 'user-1' },
  items: [] as Array<Record<string, unknown>>,
  saved: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user }),
}))

vi.mock('@/lib/firebase', () => ({ db: {} }))

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((...parts: unknown[]) => ({ kind: 'doc', parts })),
  updateDoc: mocks.updateDoc,
  deleteDoc: vi.fn(),
  setDoc: vi.fn(),
  serverTimestamp: vi.fn(() => 'timestamp'),
}))

vi.mock('@/lib/userdata', () => ({
  subscribeGroceryItems: (_uid: string, onData: (items: unknown[]) => void) => {
    onData(mocks.items)
    return vi.fn()
  },
  weekIDFromDate: () => '2026-08-17',
  getWeekPlan: vi.fn().mockResolvedValue(null),
  rebuildGroceryFromPlan: vi.fn(),
  getSavedGroceryItems: mocks.getSaved,
  upsertSavedGroceryItem: vi.fn().mockResolvedValue(undefined),
  setGroceryItemNeedThisTrip: mocks.setNeedThisTrip,
  setSavedGroceryItemUsuallyOnHand: mocks.setPreference,
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

function activeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'olive-oil',
    name: 'olive oil',
    quantity: '2',
    unit: 'tbsp',
    isChecked: false,
    isManual: false,
    sourceRecipeIDs: ['recipe-1'],
    ...overrides,
  }
}

function savedItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'olive-oil',
    name: 'olive oil',
    defaultCategory: 'Sauces & Condiments',
    timesUsed: 3,
    lastUsed: null,
    usuallyOnHand: true,
    ...overrides,
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() },
  })
  mocks.items = []
  mocks.saved = []
  mocks.getSaved.mockImplementation(async () => mocks.saved)
  mocks.setPreference.mockImplementation(async (
    _uid: string,
    name: string,
    defaultCategory: string,
    usuallyOnHand: boolean,
  ) => ({
    id: name.replaceAll(' ', '-'),
    name,
    defaultCategory,
    timesUsed: 0,
    lastUsed: null,
    usuallyOnHand,
  }))
  mocks.setNeedThisTrip.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Usually On Hand section UI', () => {
  it('does not render an empty section', async () => {
    mocks.items = [activeItem()]
    render(<GroceryPage />)

    await waitFor(() => expect(mocks.getSaved).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /^Usually On Hand \(\d+\)$/ })).toBeNull()
    expect(screen.getByText('Sauces & Condiments')).toBeTruthy()
  })

  it('shows the count, starts collapsed, expands, and preserves quantity/unit text', async () => {
    mocks.items = [activeItem()]
    mocks.saved = [savedItem()]
    render(<GroceryPage />)

    const header = await screen.findByRole('button', { name: 'Usually On Hand (1)' })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('2 tbsp olive oil')).toBeNull()

    fireEvent.click(header)

    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('2 tbsp olive oil')).toBeTruthy()
  })

  it('marks an active item, clears trip intent, and moves it without changing other active fields', async () => {
    mocks.items = [activeItem()]
    render(<GroceryPage />)
    const mark = await screen.findByRole('button', { name: 'Mark olive oil as Usually On Hand' })

    fireEvent.click(mark)

    await screen.findByRole('button', { name: 'Usually On Hand (1)' })
    expect(mocks.setPreference).toHaveBeenCalledWith(
      'user-1', 'olive oil', 'Sauces & Condiments', true,
    )
    expect(mocks.setNeedThisTrip).toHaveBeenCalledWith('user-1', 'olive-oil', false)
    expect(screen.queryByText('Sauces & Condiments')).toBeNull()
    expect(mocks.updateDoc).not.toHaveBeenCalled()
  })

  it('moves a preferred item into its normal category for this trip and exposes the reverse action', async () => {
    mocks.items = [activeItem()]
    mocks.saved = [savedItem()]
    render(<GroceryPage />)

    const header = await screen.findByRole('button', { name: 'Usually On Hand (1)' })
    fireEvent.click(header)
    fireEvent.click(screen.getByRole('button', { name: 'Need olive oil This Trip' }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Usually On Hand (1)' })).toBeNull())
    expect(screen.getByText('Sauces & Condiments')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Usually Have olive oil' })).toBeTruthy()
    expect(mocks.setNeedThisTrip).toHaveBeenCalledWith('user-1', 'olive-oil', true)
    expect(mocks.setPreference).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Usually Have olive oil' }))
    await screen.findByRole('button', { name: 'Usually On Hand (1)' })
    expect(mocks.setNeedThisTrip).toHaveBeenLastCalledWith('user-1', 'olive-oil', false)
    expect(mocks.setPreference).not.toHaveBeenCalled()
  })

  it('removes the persistent preference before clearing an overridden item’s inert trip marker', async () => {
    mocks.items = [activeItem({ needThisTrip: true })]
    mocks.saved = [savedItem()]
    render(<GroceryPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Remove olive oil from Usually On Hand' }))

    await waitFor(() => expect(mocks.setPreference).toHaveBeenCalledWith(
      'user-1', 'olive oil', 'Sauces & Condiments', false,
    ))
    expect(mocks.setNeedThisTrip).toHaveBeenCalledWith('user-1', 'olive-oil', false)
    expect(mocks.setPreference.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.setNeedThisTrip.mock.invocationCallOrder[0])
    expect(screen.getByText('Sauces & Condiments')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Usually Have olive oil' })).toBeNull()
  })

  it('restores a manual category and leaves checked state untouched', async () => {
    mocks.items = [activeItem({
      id: 'oat-milk',
      name: 'oat milk',
      isChecked: true,
      isManual: true,
      manualSection: 'Dairy & Eggs',
      sourceRecipeIDs: [],
    })]
    mocks.saved = [savedItem({ name: 'oat milk', defaultCategory: 'Beverages' })]
    render(<GroceryPage />)

    const showCheckedButtons = await screen.findAllByRole('button', { name: /Show checked/ })
    fireEvent.click(showCheckedButtons[0])
    const header = await screen.findByRole('button', { name: 'Usually On Hand (1)' })
    fireEvent.click(header)
    fireEvent.click(screen.getByRole('button', { name: 'Need oat milk This Trip' }))

    await screen.findByText('Dairy & Eggs')
    expect(screen.getByRole('button', { name: 'Mark oat milk unchecked' })).toBeTruthy()
    expect(mocks.updateDoc).not.toHaveBeenCalled()
  })

  it('unmarks into the preserved manual category and keeps checked state independent', async () => {
    mocks.items = [activeItem({
      id: 'oat-milk',
      name: 'oat milk',
      quantity: '1',
      unit: 'carton',
      isManual: true,
      manualSection: 'Dairy & Eggs',
      sourceRecipeIDs: [],
    })]
    mocks.saved = [savedItem({
      id: 'oat-milk',
      name: 'oat milk',
      defaultCategory: 'Dairy & Eggs',
    })]
    render(<GroceryPage />)

    const header = await screen.findByRole('button', { name: 'Usually On Hand (1)' })
    fireEvent.click(header)
    fireEvent.click(screen.getByRole('button', { name: 'Mark oat milk checked' }))

    expect(mocks.updateDoc.mock.calls[0][1]).toEqual({ isChecked: true })
    expect(mocks.setPreference).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Remove oat milk from Usually On Hand' }))

    await waitFor(() => expect(
      screen.queryByRole('button', { name: /^Usually On Hand \(\d+\)$/ }),
    ).toBeNull())
    expect(screen.getByText('Dairy & Eggs')).toBeTruthy()
    expect(screen.getByText('1 carton oat milk')).toBeTruthy()
    expect(mocks.setPreference).toHaveBeenCalledWith('user-1', 'oat milk', 'Dairy & Eggs', false)
  })
})
