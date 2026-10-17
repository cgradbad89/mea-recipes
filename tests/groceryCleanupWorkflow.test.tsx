// @vitest-environment jsdom

// Exercise the page and real cleanup planner with synthetic subscription data.
// Network and persistence are isolated: no Firebase initializer or AI call runs.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GroceryItem, RecipeMeta } from '@/lib/userdata'
import type { Recipe } from '@/types/recipe'

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
  recipes: [] as Recipe[],
  metas: {} as Record<string, RecipeMeta>,
  recipesLoading: false,
  recipesError: null as string | null,
  getRecipeById: vi.fn(),
  getAllRecipes: vi.fn(),
}))

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('@/components/AppDataProvider', () => ({ useAppData: () => ({
  metas: mocks.metas,
  recipes: mocks.recipes,
  recipesLoading: mocks.recipesLoading,
  recipesError: mocks.recipesError,
}) }))
vi.mock('@/lib/firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  updateDoc: mocks.updateDoc,
  deleteDoc: mocks.deleteDoc,
  setDoc: mocks.setDoc,
  serverTimestamp: vi.fn(),
}))
vi.mock('@/lib/firestoreBatch', () => ({ commitFirestoreBatches: mocks.commitFirestoreBatches }))
vi.mock('@/lib/recipes', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/recipes')>(),
  getRecipeById: mocks.getRecipeById,
  getAllRecipes: mocks.getAllRecipes,
  parseRecipeContent: vi.fn(),
}))
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
import { recipeUrl } from '@/lib/recipes'

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

function recipe(id: string, overrides: Partial<Recipe> = {}): Recipe {
  return {
    id, recipeID: id, title: `Recipe ${id}`,
    content: '', category: 'Seafood', cuisine: 'test', imageURL: '',
    sourceURL: '', sourceFile: '', labels: '', hasImage: 'false', created: '', modified: '',
    ...overrides,
  }
}

function expectNoSourceRequests() {
  expect(mocks.getRecipeById).not.toHaveBeenCalled()
  expect(mocks.getAllRecipes).not.toHaveBeenCalled()
  expect(mocks.fetch).not.toHaveBeenCalled()
  expect(mocks.user.getIdToken).not.toHaveBeenCalled()
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
  mocks.recipes = []
  mocks.metas = {}
  mocks.recipesLoading = false
  mocks.recipesError = null
  mocks.user.getIdToken.mockReset().mockResolvedValue('synthetic-token')
  mocks.fetch.mockReset()
  mocks.applyGroceryCleanup.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('fetch', mocks.fetch)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('grocery recipe provenance integration', () => {
  it('deduplicates source identities in stored order without mutating grocery data', async () => {
    mocks.recipes = ['a', 'b', 'c'].map(id => recipe(id))
    mocks.items = [item(0, { sourceRecipeIDs: ['b', 'a', 'b', 'c', 'a'] })]
    const before = structuredClone(mocks.items)
    render(<GroceryPage />)

    await screen.findByRole('link', { name: /Recipe b/ })
    expect(screen.getAllByRole('link').map(link => link.textContent)).toEqual(['Recipe b', 'Recipe a'])
    fireEvent.click(screen.getByRole('button', { name: /Show 1 more recipe for Ingredient number0/i }))
    expect(screen.getAllByRole('link').map(link => link.textContent)).toEqual(['Recipe b', 'Recipe a', 'Recipe c'])
    expect(mocks.items).toEqual(before)
    expectNoChangesApplied()
    expectNoSourceRequests()
  })

  it('uses authoritative catalog document IDs even when legacy recipeID and recipe titles collide', async () => {
    const secondDocumentID = 'document b?#'
    mocks.recipes = [
      recipe('document-a', { recipeID: 'legacy-id', title: 'Shared recipe title' }),
      recipe(secondDocumentID, { recipeID: 'document-a', title: 'Shared recipe title' }),
    ]
    mocks.items = [item(0, { sourceRecipeIDs: ['document-a', secondDocumentID, 'legacy-id'] })]
    render(<GroceryPage />)

    await screen.findAllByRole('link', { name: /Shared recipe title/ })
    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
      recipeUrl('document-a'), recipeUrl(encodeURIComponent(secondDocumentID)),
    ])
    expect(screen.getByText('+1 recipe unavailable')).toBeTruthy()
    expect(screen.queryByText('legacy-id')).toBeNull()
    expectNoSourceRequests()
  })

  it('updates effective titles and references from existing provider state without requesting data', async () => {
    mocks.recipes = [recipe('a', { title: 'Original canonical title' })]
    mocks.items = [item(0, { sourceRecipeIDs: ['a', 'b'] })]
    const view = render(<GroceryPage />)
    expect(await screen.findByRole('link', { name: /Original canonical title/ })).toBeTruthy()

    mocks.metas = { a: { overrides: { title: 'My preferred title' } } as RecipeMeta }
    view.rerender(<GroceryPage />)
    expect(screen.getByRole('link', { name: /My preferred title/ }).getAttribute('href')).toBe(recipeUrl('a'))
    expect(screen.queryByRole('link', { name: /Original canonical title/ })).toBeNull()

    mocks.metas = {}
    mocks.recipes = [recipe('a', { title: 'Updated canonical title' }), recipe('b')]
    view.rerender(<GroceryPage />)
    expect(screen.getByRole('link', { name: /Updated canonical title/ }).getAttribute('href')).toBe(recipeUrl('a'))
    expect(screen.getByRole('link', { name: /Recipe b/ })).toBeTruthy()
    expect(screen.queryByText(/recipe unavailable/i)).toBeNull()
    expectNoChangesApplied()
    expectNoSourceRequests()
  })

  it('tolerates legacy absent arrays while keeping manual and recipe-derived fallbacks distinct', async () => {
    const legacy = item(0)
    delete (legacy as Partial<GroceryItem>).sourceRecipeIDs
    mocks.items = [legacy, item(1, { isManual: true, sourceRecipeIDs: [] })]
    render(<GroceryPage />)

    expect(await screen.findByText('No recipe linked')).toBeTruthy()
    expect(screen.getByText('Added manually')).toBeTruthy()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(Object.hasOwn(legacy, 'sourceRecipeIDs')).toBe(false)
    expectNoChangesApplied()
    expectNoSourceRequests()
  })

  it('keeps groceries usable during catalog loading and renders only one catalog error notice', async () => {
    mocks.recipesLoading = true
    mocks.recipesError = 'A previous catalog failure is retained during retry'
    mocks.items = [item(0), item(1)]
    const view = render(<GroceryPage />)
    expect(await screen.findAllByText('Loading recipes…')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Mark Ingredient number0 checked' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Mark Ingredient number1 checked' })).toBeTruthy()
    expect(screen.queryByText(/Recipe unavailable/i)).toBeNull()
    expect(screen.queryByText('Recipe links are temporarily unavailable. Your grocery list is still usable.')).toBeNull()
    expect(screen.queryByText('Recipe links unavailable')).toBeNull()

    mocks.recipesLoading = false
    mocks.recipesError = 'Synthetic catalog failure'
    view.rerender(<GroceryPage />)
    expect(screen.getAllByText('Recipe links are temporarily unavailable. Your grocery list is still usable.')).toHaveLength(1)
    expect(screen.getAllByText('Recipe links unavailable')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Mark Ingredient number0 checked' }))
    await waitFor(() => expect(mocks.updateDoc).toHaveBeenCalledTimes(1))
    expect(mocks.updateDoc.mock.calls[0][1]).toMatchObject({ isChecked: true })
    expectNoSourceRequests()
  })

  it('shows source links for checked groceries and keeps source interactions independent of grocery operations', async () => {
    mocks.recipes = ['a', 'b', 'c'].map(id => recipe(id))
    mocks.items = [item(0, { isChecked: true, sourceRecipeIDs: ['a', 'b', 'c'] })]
    render(<GroceryPage />)
    fireEvent.click((await screen.findAllByRole('button', { name: /Show checked/ }))[0])
    expect(await screen.findByRole('button', { name: 'Mark Ingredient number0 unchecked' })).toBeTruthy()

    fireEvent.click(screen.getByRole('link', { name: /Recipe a/ }))
    fireEvent.click(screen.getByRole('button', { name: /Show 1 more recipe for Ingredient number0/i }))
    fireEvent.click(screen.getByRole('link', { name: /Recipe c/ }))
    expect(screen.getByRole('button', { name: 'Mark Ingredient number0 unchecked' })).toBeTruthy()
    expect(mocks.items[0].isChecked).toBe(true)
    expect(screen.queryByPlaceholderText('qty')).toBeNull()
    expectNoChangesApplied()
    expectNoSourceRequests()
  })

  // This verifies bounded access and control behavior, not a timing benchmark.
  // Leave room for the full suite's parallel jsdom/emulator workers.
  it('resolves 250 groceries and 100 catalog references in memory while preserving existing edit and checkbox controls', async () => {
    mocks.recipes = Array.from({ length: 100 }, (_, index) => recipe(`catalog-${index}`))
    mocks.items = Array.from({ length: 250 }, (_, index) => item(index, {
      sourceRecipeIDs: [`catalog-${index % 100}`, `catalog-${(index + 1) % 100}`, `catalog-${index % 100}`, `missing-${index % 3}`],
    }))
    const before = structuredClone(mocks.items)
    render(<GroceryPage />)
    const checkbox = await screen.findByRole('button', { name: 'Mark Ingredient number0 checked' })
    expect(screen.getAllByRole('link')).toHaveLength(500)
    expect(screen.getAllByText('+1 recipe unavailable')).toHaveLength(250)
    expectNoChangesApplied()
    expectNoSourceRequests()

    const row = within(checkbox.parentElement!)
    fireEvent.click(row.getByTitle('Edit name'))
    const quantityInput = row.getByPlaceholderText('qty')
    expect(quantityInput).toBeTruthy()
    fireEvent.keyDown(quantityInput, { key: 'Escape' })
    expect(row.queryByPlaceholderText('qty')).toBeNull()
    fireEvent.click(checkbox)
    await waitFor(() => expect(mocks.updateDoc).toHaveBeenCalledTimes(1))
    expect(mocks.updateDoc.mock.calls[0][1]).toMatchObject({ isChecked: true })
    expect(mocks.items).toEqual(before)
    expectNoSourceRequests()
  }, 20_000)

  it('refreshes source links from persisted subscription updates without requesting or mutating recipes', async () => {
    mocks.recipes = ['a', 'b', 'c'].map(id => recipe(id))
    mocks.items = [item(0, { sourceRecipeIDs: ['a'] })]
    render(<GroceryPage />)
    expect(await screen.findByRole('link', { name: /Recipe a/ })).toBeTruthy()

    const reloaded = item(0, { sourceRecipeIDs: ['a', 'b', 'c'], quantity: '3' })
    await act(async () => { mocks.onItems!([reloaded]) })
    expect(screen.getByRole('link', { name: /Recipe b/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Show 1 more recipe for Ingredient number0/i }))
    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['a', 'b', 'c'].map(recipeUrl))
    expect(reloaded.sourceRecipeIDs).toEqual(['a', 'b', 'c'])
    expectNoChangesApplied()
    expectNoSourceRequests()
  })
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
