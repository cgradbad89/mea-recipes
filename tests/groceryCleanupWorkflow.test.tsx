// @vitest-environment jsdom

// Exercise the page and real cleanup planner with synthetic subscription data.
// Network and persistence are isolated: no Firebase initializer or AI call runs.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GroceryItem } from '@/lib/userdata'

const mocks = vi.hoisted(() => ({
  items: [] as GroceryItem[],
  onItems: undefined as undefined | ((items: GroceryItem[]) => void),
  user: { uid: 'synthetic-cleanup-user', getIdToken: vi.fn() },
  fetch: vi.fn(),
  applyGroceryCleanup: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  setDoc: vi.fn(),
  commitFirestoreBatches: vi.fn(),
}))

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('@/components/AppDataProvider', () => ({ useAppData: () => ({ metas: {} }) }))
vi.mock('@/lib/firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  updateDoc: mocks.updateDoc,
  deleteDoc: mocks.deleteDoc,
  setDoc: mocks.setDoc,
  serverTimestamp: vi.fn(),
}))
vi.mock('@/lib/firestoreBatch', () => ({ commitFirestoreBatches: mocks.commitFirestoreBatches }))
vi.mock('@/lib/recipes', () => ({ getRecipeById: vi.fn(), parseRecipeContent: vi.fn() }))
vi.mock('@/lib/userdata', () => ({
  weekIDFromDate: vi.fn(),
  getWeekPlan: vi.fn(),
  rebuildGroceryFromPlan: vi.fn(),
  getSavedGroceryItems: vi.fn().mockResolvedValue([]),
  upsertSavedGroceryItem: vi.fn(),
  deleteSavedGroceryItem: vi.fn(),
  setGroceryItemNeedThisTrip: vi.fn(),
  setSavedGroceryItemUsuallyOnHand: vi.fn(),
  applyGroceryCleanup: mocks.applyGroceryCleanup,
  GroceryCleanupApplyError: class extends Error {},
  subscribeGroceryItems: (_uid: string, onItems: (items: GroceryItem[]) => void) => {
    mocks.onItems = onItems
    onItems(mocks.items)
    return vi.fn()
  },
}))

import GroceryPage from '@/app/grocery/page'

const lastCleanedKey = 'mea-grocery-last-cleaned'

function item(index: number, overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id: `synthetic-item-${index}`,
    name: `Ingredient number${index}`,
    quantity: '1', unit: '', isChecked: false, isManual: false,
    sourceRecipeIDs: [`synthetic-recipe-${index}`], manualSection: 'Other',
    ...overrides,
  }
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}

function normalization(originalIndex = 0) {
  return {
    originalIndex, name: 'garlic', quantity: '1', unit: '', category: 'Produce',
    action: 'normalize', mergedWith: [],
  }
}

async function startCleanup() {
  fireEvent.click(await screen.findByRole('button', { name: 'AI Clean Up List' }))
}

function expectNoChangesApplied() {
  expect(mocks.applyGroceryCleanup).not.toHaveBeenCalled()
  expect(mocks.updateDoc).not.toHaveBeenCalled()
  expect(mocks.deleteDoc).not.toHaveBeenCalled()
  expect(mocks.setDoc).not.toHaveBeenCalled()
  expect(mocks.commitFirestoreBatches).not.toHaveBeenCalled()
  expect(screen.queryByText('AI Suggestions')).toBeNull()
}

beforeEach(() => {
  localStorage.clear()
  mocks.items = [item(0, { name: 'Garlic', manualSection: 'Produce' })]
  mocks.onItems = undefined
  mocks.user.getIdToken.mockReset().mockResolvedValue('synthetic-token')
  mocks.fetch.mockReset()
  mocks.applyGroceryCleanup.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('fetch', mocks.fetch)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('AI grocery cleanup page workflow', () => {
  it('reviews only the 70 unchecked items in a 103-item list and applies their captured identities after subscription reorder', async () => {
    const eligible = Array.from({ length: 70 }, (_, index) => item(index, index === 0
      ? { name: 'Garlic', manualSection: 'Produce' }
      : {}))
    const checked = Array.from({ length: 33 }, (_, index) => item(70 + index, { isChecked: true }))
    const checkedBefore = structuredClone(checked)
    mocks.items = eligible.flatMap((value, index) => index < checked.length ? [checked[index], value] : [value])
    mocks.fetch.mockResolvedValueOnce(response([normalization()]))
    let finishApply!: () => void
    mocks.applyGroceryCleanup.mockReturnValueOnce(new Promise<void>(resolve => { finishApply = resolve }))
    render(<GroceryPage />)

    await startCleanup()
    await screen.findByText('AI Suggestions')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = mocks.fetch.mock.calls[0]
    expect(url).toBe('/api/grocery-cleanup')
    expect(init.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer synthetic-token' }))
    const payload = JSON.parse(init.body as string)
    expect(payload.items).toHaveLength(70)
    expect(payload.items.map((value: GroceryItem) => value.name)).toEqual(eligible.map(value => value.name))
    expect(payload.items.every((value: GroceryItem) => value.isChecked !== true)).toBe(true)
    expect(localStorage.getItem(lastCleanedKey)).toBeNull()

    await act(async () => { mocks.onItems!([...mocks.items].reverse()) })
    // The preview's original-name row must also use the captured snapshot.
    expect(screen.getAllByText('Garlic').some(element => element.className.includes('line-through'))).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    await waitFor(() => expect(mocks.applyGroceryCleanup).toHaveBeenCalledTimes(1))
    const [uid, plan, rejected] = mocks.applyGroceryCleanup.mock.calls[0]
    expect(uid).toBe('synthetic-cleanup-user')
    expect(plan.items).toEqual(eligible)
    expect(plan.changes).toEqual([normalization()])
    expect(rejected).toEqual(new Set())
    expect(checked).toEqual(checkedBefore)
    expect(localStorage.getItem(lastCleanedKey)).toBeNull()

    await act(async () => { finishApply() })
    await waitFor(() => expect(localStorage.getItem(lastCleanedKey)).not.toBeNull())
    expect(Number(localStorage.getItem(lastCleanedKey))).toBeGreaterThan(0)
    expect(screen.queryByText('AI Suggestions')).toBeNull()
    expect(screen.getByText(/Last cleaned/)).toBeTruthy()
  })

  it('skips authentication, AI, persistence, and timestamp updates when all items are checked', async () => {
    mocks.items = Array.from({ length: 33 }, (_, index) => item(index, { isChecked: true }))
    render(<GroceryPage />)
    await startCleanup()

    expect(await screen.findByText(/No items need cleanup/i)).toBeTruthy()
    expect(mocks.user.getIdToken).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
    expectNoChangesApplied()
    expect(localStorage.getItem(lastCleanedKey)).toBeNull()
  })

  it('discards successful first-batch proposals if a later batch fails and preserves the previous cleanup timestamp', async () => {
    mocks.items = Array.from({ length: 101 }, (_, index) => item(index, index === 0
      ? { name: 'Garlic', manualSection: 'Produce' }
      : {}))
    localStorage.setItem(lastCleanedKey, '1720000000000')
    mocks.fetch.mockResolvedValueOnce(response([normalization()]))
      .mockResolvedValueOnce(response({ error: 'private provider diagnostic' }, 503))
    render(<GroceryPage />)
    await startCleanup()

    expect((await screen.findByRole('alert')).textContent).toMatch(/temporarily unavailable/i)
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(mocks.fetch.mock.calls.every(([, init]) => JSON.parse(init.body as string).items.length <= 100)).toBe(true)
    expectNoChangesApplied()
    expect(localStorage.getItem(lastCleanedKey)).toBe('1720000000000')
    expect(screen.queryByText(/private provider diagnostic/)).toBeNull()
  })

  it('rejects invalid merge indices before displaying an actionable preview', async () => {
    mocks.fetch.mockResolvedValueOnce(response([{ ...normalization(), action: 'merge', mergedWith: [999] }]))
    render(<GroceryPage />)
    await startCleanup()

    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be completed safely/i)
    expectNoChangesApplied()
    expect(localStorage.getItem(lastCleanedKey)).toBeNull()
  })

  it('shows actionable bounded-request, authentication, rate-limit, and service errors without revealing server details', async () => {
    const cases: Array<[number, string | undefined, RegExp]> = [
      [400, 'TOO_MANY_ITEMS', /too many items for one cleanup request/i],
      [400, undefined, /check.*names and quantities/i],
      [401, undefined, /sign in again/i],
      [429, undefined, /(?:later|rate limit)/i],
      [503, undefined, /temporarily unavailable/i],
    ]
    for (const [status, code, expected] of cases) {
      mocks.fetch.mockResolvedValueOnce(response({ error: 'private provider diagnostic', code }, status))
      render(<GroceryPage />)
      await startCleanup()
      expect((await screen.findByRole('alert')).textContent).toMatch(expected)
      expect(screen.queryByText(/private provider diagnostic/)).toBeNull()
      expectNoChangesApplied()
      expect(localStorage.getItem(lastCleanedKey)).toBeNull()
      cleanup()
    }

    mocks.fetch.mockClear()
    mocks.user.getIdToken.mockRejectedValueOnce(new Error('private auth diagnostic'))
    render(<GroceryPage />)
    await startCleanup()
    expect((await screen.findByRole('alert')).textContent).toMatch(/sign in again/i)
    expect(screen.queryByText(/private auth diagnostic/)).toBeNull()
    expect(mocks.fetch).not.toHaveBeenCalled()
    expectNoChangesApplied()
    expect(localStorage.getItem(lastCleanedKey)).toBeNull()
  })

  it('does not record successful cleanup when persistence fails', async () => {
    mocks.fetch.mockResolvedValueOnce(response([normalization()]))
    mocks.applyGroceryCleanup.mockRejectedValueOnce(new Error('private Firestore diagnostic'))
    render(<GroceryPage />)
    await startCleanup()
    await screen.findByText('AI Suggestions')
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/(?:couldn.t|could not).*(?:sav|apply)/i)
    expect(mocks.applyGroceryCleanup).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/private Firestore diagnostic/)).toBeNull()
    expect(localStorage.getItem(lastCleanedKey)).toBeNull()
  })
})
