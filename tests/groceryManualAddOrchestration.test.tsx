// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// Regression coverage for the manual grocery-add path (app/grocery/page.tsx's
// handleAddItem) after the 2026-08-23 shared prepareGroceryItem consolidation
// — see docs/audits/shared-grocery-preparation-pipeline-2026-08-23.md. Drives
// the real rendered form so the orchestration around the shared helper
// (explicit-field overrides, category override, exact-noun merge into manual
// items only, manual flag, quantity merge/unit conversion) is exercised
// end-to-end. No live Firestore is used.

const mocks = vi.hoisted(() => ({
  setDoc: vi.fn().mockResolvedValue(undefined),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  user: { uid: 'user-1' },
  items: [] as unknown[],
}))

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user }),
}))

vi.mock('@/lib/firebase', () => ({ db: {} }))

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((...parts: unknown[]) => ({ kind: 'doc', parts })),
  updateDoc: mocks.updateDoc,
  deleteDoc: vi.fn(),
  setDoc: mocks.setDoc,
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

async function openAddForm() {
  render(<GroceryPage />)
  fireEvent.click(await screen.findByRole('button', { name: /add item manually/i }))
}

function fillAndSubmit(opts: { name: string; qty?: string; unit?: string; category?: string }) {
  fireEvent.change(screen.getByPlaceholderText('Item name'), { target: { value: opts.name } })
  if (opts.qty !== undefined) fireEvent.change(screen.getByPlaceholderText('Qty'), { target: { value: opts.qty } })
  if (opts.unit !== undefined) fireEvent.change(screen.getByPlaceholderText('Unit'), { target: { value: opts.unit } })
  if (opts.category !== undefined) fireEvent.change(screen.getByRole('combobox'), { target: { value: opts.category } })
  fireEvent.click(screen.getByRole('button', { name: /add to list/i }))
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() },
  })
  mocks.setDoc.mockClear()
  mocks.updateDoc.mockClear()
  mocks.items = []
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('manual add — normal item preparation', () => {
  it('parses inline quantity/unit from the typed name with default category', async () => {
    await openAddForm()
    fillAndSubmit({ name: '2 cups rice' })

    await waitFor(() => expect(mocks.setDoc).toHaveBeenCalled())
    const [, written] = mocks.setDoc.mock.calls[0]
    expect(written).toMatchObject({ name: 'rice', quantity: '2', unit: 'cups', isManual: true, manualSection: 'Other' })
  })
})

describe('manual add — explicit category override', () => {
  it('uses the selected category, not automatic classification', async () => {
    await openAddForm()
    fillAndSubmit({ name: 'oat milk', category: 'Dairy & Eggs' })

    await waitFor(() => expect(mocks.setDoc).toHaveBeenCalled())
    const [, written] = mocks.setDoc.mock.calls[0]
    expect(written).toMatchObject({ name: 'oat milk', manualSection: 'Dairy & Eggs' })
  })
})

describe('manual add — same-unit merge', () => {
  it('sums into an existing manual item of the same identity', async () => {
    mocks.items = [{
      id: 'flour', name: 'flour', quantity: '2', unit: 'cups', isChecked: false, isManual: true, manualSection: 'Pantry & Dry Goods', sourceRecipeIDs: [],
    }]
    await openAddForm()
    fillAndSubmit({ name: '1 cup flour' })

    await waitFor(() => expect(mocks.updateDoc).toHaveBeenCalled())
    const [, written] = mocks.updateDoc.mock.calls[0]
    expect(written).toMatchObject({ quantity: '3', unit: 'cups' })
    expect(mocks.setDoc).not.toHaveBeenCalled()
  })
})

describe('manual add — compatible-unit merge', () => {
  it('converts the incoming quantity into the existing item unit', async () => {
    mocks.items = [{
      id: 'chicken-broth', name: 'chicken broth', quantity: '1', unit: 'cup', isChecked: false, isManual: true, manualSection: 'Pantry & Dry Goods', sourceRecipeIDs: [],
    }]
    await openAddForm()
    fillAndSubmit({ name: '8 tbsp chicken broth' })

    await waitFor(() => expect(mocks.updateDoc).toHaveBeenCalled())
    const [, written] = mocks.updateDoc.mock.calls[0]
    expect(written).toMatchObject({ quantity: '1.5', unit: 'cup' })
  })

  it('preserves Need This Trip while merging compatible quantities', async () => {
    mocks.items = [{
      id: 'chicken-broth', name: 'chicken broth', quantity: '1', unit: 'cup', isChecked: false,
      isManual: true, manualSection: 'Pantry & Dry Goods', sourceRecipeIDs: [], needThisTrip: true,
    }]
    await openAddForm()
    fillAndSubmit({ name: '8 tbsp chicken broth' })

    await waitFor(() => expect(mocks.updateDoc).toHaveBeenCalled())
    const [, written] = mocks.updateDoc.mock.calls[0]
    expect(written).toMatchObject({ quantity: '1.5', unit: 'cup', needThisTrip: true })
  })
})

describe('manual add — incompatible-unit merge', () => {
  it('lists side by side instead of converting weight into volume', async () => {
    mocks.items = [{
      id: 'flour', name: 'flour', quantity: '1', unit: 'cup', isChecked: false, isManual: true, manualSection: 'Pantry & Dry Goods', sourceRecipeIDs: [],
    }]
    await openAddForm()
    fillAndSubmit({ name: '200 g flour' })

    await waitFor(() => expect(mocks.updateDoc).toHaveBeenCalled())
    const [, written] = mocks.updateDoc.mock.calls[0]
    expect(written).toMatchObject({ quantity: '1 cup + 200 g', unit: '' })
  })
})

describe('manual add — manual flag preserved', () => {
  it('always writes isManual: true for a new manual item', async () => {
    await openAddForm()
    fillAndSubmit({ name: 'ground beef', qty: '8', unit: 'oz' })

    await waitFor(() => expect(mocks.setDoc).toHaveBeenCalled())
    const [, written] = mocks.setDoc.mock.calls[0]
    expect(written).toMatchObject({ isManual: true, quantity: '8', unit: 'oz', name: 'ground beef' })
  })
})

describe('manual add — manual/recipe pool separation', () => {
  it('never merges a manual add into a recipe-sourced item of the same identity', async () => {
    mocks.items = [{
      id: 'garlic', name: 'garlic', quantity: '', unit: '', isChecked: false, isManual: false, sourceRecipeIDs: ['recipe-1'],
    }]
    await openAddForm()
    fillAndSubmit({ name: 'garlic' })

    await waitFor(() => expect(mocks.setDoc).toHaveBeenCalled())
    expect(mocks.updateDoc).not.toHaveBeenCalled()
    const [, written] = mocks.setDoc.mock.calls[0]
    expect(written).toMatchObject({ name: 'garlic', isManual: true })
  })
})
