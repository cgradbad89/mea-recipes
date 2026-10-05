// @vitest-environment jsdom

// Actual browser-SDK writers and page handlers, isolated to synthetic emulator
// fixtures. The production Firebase initializer is never imported. The transaction
// wrapper only controls read overlap; Firestore itself commits/conflicts/retries.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { startFirestoreEmulator } from './helpers/firestoreEmulator'
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app'
import {
  connectFirestoreEmulator, doc, getDocFromServer, getDocsFromServer, getFirestore,
  setDoc, terminate, writeBatch, type DocumentReference, type DocumentSnapshot,
  type Firestore, type Transaction, type TransactionOptions,
} from 'firebase/firestore'
import type { GroceryItem, RecipeMeta, WeekPlan } from '@/lib/userdata'
import type { Recipe } from '@/types/recipe'
import { parseRecipeContent } from '@/lib/recipeContent'

const sdk = vi.hoisted(() => ({
  db: undefined as Firestore | undefined,
  context: undefined as AsyncLocalStorage<Firestore> | undefined,
  afterRead: undefined as undefined | ((db: Firestore, ref: DocumentReference, snapshot: DocumentSnapshot) => Promise<void>),
  attempts: [] as Firestore[],
  user: {
    uid: 'synthetic-pending', email: 'synthetic@example.test', emailVerified: true,
    displayName: 'Synthetic viewer', photoURL: '',
    getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
  },
  recipes: [] as Recipe[], metas: {} as Record<string, RecipeMeta>,
  plan: null as WeekPlan | null,
  add: vi.fn(), rebuild: vi.fn(),
}))
vi.mock('@/lib/firebase', () => ({ get db() { return sdk.context?.getStore() ?? sdk.db } }))
vi.mock('firebase/firestore', async importOriginal => {
  const original = await importOriginal<typeof import('firebase/firestore')>()
  return {
    ...original,
    runTransaction: (db: Firestore, run: (tx: Transaction) => Promise<unknown>, options?: TransactionOptions) =>
      original.runTransaction(db, async tx => {
        sdk.attempts.push(db)
        const controlled = {
          get: async (ref: DocumentReference) => {
            const snapshot = await tx.get(ref)
            await sdk.afterRead?.(db, ref, snapshot)
            return snapshot
          },
          set: tx.set.bind(tx), update: tx.update.bind(tx), delete: tx.delete.bind(tx),
        }
        return run(controlled as Transaction)
      }, options),
  }
})
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: sdk.user }) }))
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'recipe-a' }), useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/components/AppDataProvider', () => ({ useAppData: () => ({
  recipes: sdk.recipes, recipesLoading: false, recipesError: null,
  metas: sdk.metas, metasLoading: false, metasError: null, favoritesError: null,
  cookingHistoryError: null, refetchMetas: vi.fn(), refetchRecipes: vi.fn(),
  refetchFavorites: vi.fn(), refetchCookingHistory: vi.fn(),
  toggleFavorite: vi.fn(), isFavorite: () => false,
  toggleWantToTry: vi.fn(), isWantToTry: () => false,
}) }))
vi.mock('@/lib/userdata', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/userdata')>(),
  addRecipeIngredientsToGrocery: sdk.add, rebuildGroceryFromPlan: sdk.rebuild,
  getWeekPlan: vi.fn(async () => sdk.plan),
  getSavedGroceryItems: vi.fn(async () => []),
  subscribeWeekPlan: (_uid: string, _week: string, onData: (plan: WeekPlan | null) => void) => {
    onData(sdk.plan); return vi.fn()
  },
  subscribeSharedWeekPlans: (_week: string, _uid: string, onData: (plans: unknown[]) => void) => {
    onData([]); return vi.fn()
  },
  subscribeSharedPlanPublication: (_uid: string, _week: string, onData: (plan: null) => void) => {
    onData(null); return vi.fn()
  },
}))
vi.mock('@/lib/recipes', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/recipes')>(),
  getRecipeById: async (id: string) => sdk.recipes.find(recipe => recipe.id === id) ?? null,
}))
vi.mock('@/lib/consumptionLog', () => ({
  logCookEvent: vi.fn(), undoCookEvent: vi.fn(),
  getTodayCookEventForRecipe: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/googleCalendar', () => ({ runCalendarPush: vi.fn() }))
vi.mock('@/components/RecipeImage', () => ({ default: () => <div /> }))
vi.mock('@/components/NutritionSection', () => ({ default: () => null }))
vi.mock('@/components/CookingMode', () => ({ default: () => null }))

import DetailPage from '@/app/recipes/[id]/page'
import PlanPage from '@/app/plan/page'
import GroceryPage from '@/app/grocery/page'

const projectID = 'demo-mea-grocery-correctness'
const apps: FirebaseApp[] = []
const databases: Firestore[] = []
let emulator: Awaited<ReturnType<typeof startFirestoreEmulator>> | undefined
let writers: typeof import('@/lib/userdata')

beforeAll(async () => {
  // Node's native storage must not shadow this suite's actual browser storage.
  const browser = (globalThis as unknown as { jsdom: { window: Window } }).jsdom.window
  expect(window.localStorage).toBe(browser.localStorage)
  expect(window.sessionStorage).toBe(browser.sessionStorage)
  emulator = await startFirestoreEmulator(projectID)
  const { port } = emulator
  // Two independent SDK clients; no shared Firestore cache or local write queue.
  for (let index = 0; index < 2; index++) {
    const app = initializeApp({ projectId: projectID }, `grocery-${randomUUID()}`)
    apps.push(app)
    const db = getFirestore(app)
    connectFirestoreEmulator(db, '127.0.0.1', port)
    expect(db.app.options.projectId).toBe(projectID)
    databases.push(db)
  }
  sdk.db = databases[0]
  sdk.context = new AsyncLocalStorage<Firestore>()
  writers = await vi.importActual<typeof import('@/lib/userdata')>('@/lib/userdata')
}, 45_000)

afterAll(async () => {
  try {
    await Promise.all(databases.map(db => terminate(db)))
    await Promise.all(apps.map(app => deleteApp(app)))
  } finally {
    await emulator?.stop()
  }
}, 15_000)
afterEach(() => { cleanup(); sdk.afterRead = undefined })

const fixture = [
  '1 cup flour', '1 can black beans', 'garlic', '½ cup milk', '1 tbsp olive oil',
  'For the sauce:', '2 tbsp olive oil', '1 cup green chile sauce',
  '1 onion, diced', '2 tomatoes', 'https://example.com/not-an-ingredient',
]
const content = (lines: string[]) => `INGREDIENTS\n${lines.join('\n')}\n\nINSTRUCTIONS\nCook it.`
function recipe(id: string, lines: string[]): Recipe {
  return {
    id, recipeID: id, title: id === 'recipe-a' ? 'Recipe A' : 'Recipe B',
    content: content(lines), category: 'Seafood', cuisine: 'test', imageURL: '',
    sourceURL: '', sourceFile: '', labels: '', hasImage: 'false', created: '', modified: '',
  }
}
beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  sdk.user.uid = `synthetic-${randomUUID()}`
  sdk.recipes = [recipe('recipe-a', fixture)]
  sdk.metas = {}
  sdk.plan = {
    weekID: '2026-10-05', weekStartISO: '2026-10-05',
    plannedRecipeIDs: [{ recipeID: 'recipe-a', day: null, role: 'main' }], cookedRecipeIDs: [],
  }
  sdk.attempts = []
  sdk.afterRead = undefined
  sdk.add.mockReset().mockImplementation(writers.addRecipeIngredientsToGrocery)
  sdk.rebuild.mockReset().mockImplementation(writers.rebuildGroceryFromPlan)
})

it('uses real jsdom storage with browser round-trip and clear semantics', () => {
  window.localStorage.setItem('storage-regression', 'persisted')
  expect(localStorage.getItem('storage-regression')).toBe('persisted')
  window.localStorage.clear()
  expect(localStorage.getItem('storage-regression')).toBeNull()
  window.sessionStorage.setItem('storage-regression', 'session')
  expect(sessionStorage.getItem('storage-regression')).toBe('session')
  window.sessionStorage.clear()
  expect(sessionStorage.length).toBe(0)
})

function item(id: string, extra: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id, name: 'flour', quantity: '7', unit: 'cups', isChecked: true,
    isManual: true, manualSection: 'Other', sourceRecipeIDs: [], needThisTrip: true,
    ...extra,
  }
}
async function seedItem(data: GroceryItem) {
  await setDoc(doc(writers.groceryPath(sdk.user.uid), data.id), data)
}
async function list(): Promise<GroceryItem[]> {
  const snapshot = await getDocsFromServer(writers.groceryPath(sdk.user.uid))
  return snapshot.docs.map(document => ({ ...document.data(), id: document.id } as GroceryItem))
}
async function automatic() { return (await list()).filter(item => !item.isManual) }
async function rebuild(planned = sdk.plan!.plannedRecipeIDs, metas = sdk.metas, parse = parseRecipeContent) {
  await writers.rebuildGroceryFromPlan(
    sdk.user.uid, planned, async id => sdk.recipes.find(recipe => recipe.id === id) ?? null, parse, metas,
  )
}
async function persistedMetas(overrides: RecipeMeta['overrides']) {
  await writers.saveRecipeMeta(sdk.user.uid, 'recipe-a', { overrides })
  const snapshot = await getDocsFromServer(writers.metaPath(sdk.user.uid))
  sdk.metas = Object.fromEntries(snapshot.docs.map(document => [document.id, document.data() as RecipeMeta]))
}

describe('direct grocery writer → real persisted state', () => {
  it.each([
    [['1 tbsp olive oil', '2 tbsp olive oil'], 'olive oil', '3', 'tbsp'],
    [['1 cup stock', '8 tbsp stock'], 'stock', '1.5', 'cup'],
    [['1 can black beans', '2 cans black beans'], 'black beans', '3', 'can'],
    [['1 tomato', '2 tomatoes'], 'tomato', '3', ''],
  ] as const)('accounts for every contribution in %j before request idempotency', async (lines, name, quantity, unit) => {
    await writers.addRecipeIngredientsToGrocery(sdk.user.uid, 'recipe-a', [...lines])
    expect(await automatic()).toMatchObject([{ name, quantity, unit, sourceRecipeIDs: ['recipe-a'] }])
  })

  it('repeated unchanged requests stay idempotent while different recipes add their complete contribution', async () => {
    const lines = ['1 tbsp olive oil', '2 tbsp olive oil']
    await writers.addRecipeIngredientsToGrocery(sdk.user.uid, 'recipe-a', lines)
    const first = await automatic()
    await writers.addRecipeIngredientsToGrocery(sdk.user.uid, 'recipe-a', lines)
    expect(await automatic()).toEqual(first)
    await writers.addRecipeIngredientsToGrocery(sdk.user.uid, 'recipe-b', ['1 tbsp olive oil'])
    expect(await automatic()).toMatchObject([{ quantity: '4', unit: 'tbsp', sourceRecipeIDs: ['recipe-a', 'recipe-b'] }])
  })

  it('retains incompatible same-recipe quantities side by side', async () => {
    await writers.addRecipeIngredientsToGrocery(sdk.user.uid, 'recipe-a', ['1 cup flour', '200 g flour'])
    expect(await automatic()).toMatchObject([{ quantity: '1 cup + 200 g', unit: '', sourceRecipeIDs: ['recipe-a'] }])
  })

  it('direct Add keeps prior contributions after an edit and adds only missing identities', async () => {
    await writers.addRecipeIngredientsToGrocery(sdk.user.uid, 'recipe-a', ['1 cup flour', '1 cup milk'])
    await writers.addRecipeIngredientsToGrocery(sdk.user.uid, 'recipe-a', ['3 cups flour', '1 tbsp butter'])
    expect(await automatic()).toMatchObject([
      { name: 'butter', quantity: '1' }, { name: 'flour', quantity: '1' }, { name: 'milk', quantity: '1' },
    ])
  })

  it.each(['flour-manual', 'flour'])('preserves every manual field at %s and keeps its quantity separate', async id => {
    const manual = item(id)
    await seedItem(manual)
    await writers.addRecipeIngredientsToGrocery(sdk.user.uid, 'recipe-a', ['1 cup flour'])
    await writers.addRecipeIngredientsToGrocery(sdk.user.uid, 'recipe-a', ['1 cup flour'])
    expect((await getDocFromServer(doc(writers.groceryPath(sdk.user.uid), id))).data()).toEqual(manual)
    expect(await automatic()).toMatchObject([{ quantity: '1', unit: 'cup', sourceRecipeIDs: ['recipe-a'] }])
    expect((await automatic())[0].id).toBe(id === 'flour' ? 'flour-recipe' : 'flour')
  })

  it('skips occupied fallback IDs deterministically and preserves checked/trip state during subsequent merges', async () => {
    await seedItem(item('flour'))
    await seedItem(item('flour-recipe', { name: 'unrelated manual item' }))
    await writers.addRecipeIngredientsToGrocery(sdk.user.uid, 'recipe-a', ['1 cup flour'])
    const [created] = await automatic()
    expect(created.id).toBe('flour-recipe-2')
    await seedItem({ ...created, needThisTrip: true, isChecked: true })
    await writers.addRecipeIngredientsToGrocery(sdk.user.uid, 'recipe-b', ['2 cups flour'])
    expect(await automatic()).toMatchObject([{
      quantity: '3', unit: 'cup', isChecked: true, needThisTrip: true, sourceRecipeIDs: ['recipe-a', 'recipe-b'],
    }])
    expect((await list()).filter(item => item.isManual)).toEqual([item('flour'), item('flour-recipe', { name: 'unrelated manual item' })])
  })

  it('retains a collision suffix for identities longer than the ID limit in both writers', async () => {
    const name = 'x'.repeat(120)
    const manual = item('x'.repeat(100), { name })
    await seedItem(manual)
    await writers.addRecipeIngredientsToGrocery(sdk.user.uid, 'recipe-a', [`1 cup ${name}`])
    expect((await automatic())[0].id).toBe(`${'x'.repeat(93)}-recipe`)
    sdk.recipes = [recipe('recipe-a', [`1 cup ${name}`])]
    await rebuild()
    expect((await automatic())[0].id).toBe(`${'x'.repeat(93)}-recipe`)
    expect((await getDocFromServer(doc(writers.groceryPath(sdk.user.uid), manual.id))).data()).toEqual(manual)
  })

  it.each(['missing destination', 'legacy destination'] as const)(
    'retries safely if a %s becomes manual after the transaction read', async mode => {
      const id = mode === 'legacy destination' ? 'recipe-old-flour' : 'flour'
      if (mode === 'legacy destination') {
        await seedItem(item(id, { isManual: false, sourceRecipeIDs: ['recipe-old'] }))
      }
      const manual = item(id)
      let introduced = false
      sdk.afterRead = async (_db, ref) => {
        if (ref.id !== id || introduced) return
        introduced = true
        await setDoc(doc(databases[1], 'users', sdk.user.uid, 'pantry', 'root', 'groceryItems', id), manual)
      }
      await writers.addRecipeIngredientsToGrocery(sdk.user.uid, 'recipe-a', ['1 cup flour'])
      expect(introduced).toBe(true)
      expect(sdk.attempts.length).toBeGreaterThanOrEqual(2)
      expect((await getDocFromServer(doc(writers.groceryPath(sdk.user.uid), id))).data()).toEqual(manual)
      expect(await automatic()).toMatchObject([{ quantity: '1', unit: 'cup', sourceRecipeIDs: ['recipe-a'] }])
    },
  )
})

describe('controlled overlap across independent Firestore clients', () => {
  it.each(['empty', 'existing', 'legacy', 'manual collision', 'same request'] as const)(
    '%s: both callers read the old destination before either writes, and Firestore retries safely', async mode => {
      let target = 'flour'
      if (mode === 'existing' || mode === 'legacy') {
        target = mode === 'legacy' ? 'recipe-old-flour' : 'flour'
        await seedItem(item(target, { isManual: false, quantity: '4', unit: 'cup', sourceRecipeIDs: ['recipe-old'] }))
      }
      if (mode === 'manual collision') {
        await seedItem(item('flour'))
        target = 'flour-recipe'
      }
      let release!: () => void
      const overlap = new Promise<void>(resolve => { release = resolve })
      const readClients = new Set<Firestore>()
      const observedQuantities: Array<string | undefined> = []
      const timeout = setTimeout(release, 8000)
      sdk.afterRead = async (db, ref, snapshot) => {
        if (ref.id !== target || readClients.has(db)) return
        readClients.add(db)
        observedQuantities.push(snapshot.data()?.quantity)
        if (readClients.size === 2) release()
        await overlap
      }
      try {
        await Promise.all(databases.map((db, index) => sdk.context!.run(db, () =>
          writers.addRecipeIngredientsToGrocery(
            sdk.user.uid, mode === 'same request' || index === 0 ? 'recipe-a' : 'recipe-b',
            [index === 0 || mode === 'same request' ? '1 cup flour' : '2 cups flour'],
          ),
        )))
      } finally {
        clearTimeout(timeout)
        sdk.afterRead = undefined
      }
      expect(readClients.size).toBe(2)
      expect(observedQuantities).toEqual(mode === 'existing' || mode === 'legacy' ? ['4', '4'] : [undefined, undefined])
      expect(sdk.attempts.length).toBeGreaterThanOrEqual(3)
      expect(new Set(sdk.attempts)).toEqual(new Set(databases))
      const [stored] = await automatic()
      expect((await automatic()).length).toBe(1)
      expect(stored.quantity).toBe(mode === 'same request' ? '1' : mode === 'existing' || mode === 'legacy' ? '7' : '3')
      // Either caller may commit first; the established surface unit stays stable.
      expect(['cup', 'cups']).toContain(stored.unit)
      expect([...stored.sourceRecipeIDs].sort()).toEqual(mode === 'same request' ? ['recipe-a'] :
        mode === 'existing' || mode === 'legacy' ? ['recipe-a', 'recipe-b', 'recipe-old'] : ['recipe-a', 'recipe-b'])
      if (mode === 'manual collision') {
        expect((await getDocFromServer(doc(writers.groceryPath(sdk.user.uid), 'flour'))).data()).toEqual(item('flour'))
      }
    }, 20_000,
  )
})

describe('rebuild → real persisted replacement', () => {
  it('aggregates same-recipe and cross-recipe lines, replaces stale auto rows, and preserves manual/trip identity', async () => {
    sdk.recipes = [recipe('recipe-a', ['1 tbsp olive oil', '2 tbsp olive oil']), recipe('recipe-b', ['1 tbsp olive oil'])]
    const manual = item('olive-oil', { name: 'olive oil' })
    await seedItem(manual)
    await seedItem(item('old-oil', { name: 'Olive oils', isManual: false, needThisTrip: true }))
    await seedItem(item('stale', { name: 'stale ingredient', isManual: false }))
    await rebuild(['recipe-a', { recipeID: 'recipe-b', day: '2026-10-06', role: 'side' }, 'recipe-a'])
    expect(await automatic()).toMatchObject([{
      id: 'olive-oil-recipe', quantity: '4', unit: 'tbsp', sourceRecipeIDs: ['recipe-a', 'recipe-b'], needThisTrip: true,
    }])
    expect((await list()).length).toBe(2)
    expect((await getDocFromServer(doc(writers.groceryPath(sdk.user.uid), manual.id))).data()).toEqual(manual)
    await rebuild(['recipe-a', 'recipe-b'])
    expect(await automatic()).toMatchObject([{ quantity: '4', sourceRecipeIDs: ['recipe-a', 'recipe-b'] }])
  })

  it.each([true, false])('uses personal effective content when supplied (%s), otherwise shared content', async personal => {
    sdk.recipes = [recipe('recipe-a', ['1 cup flour', '1 cup milk'])]
    await persistedMetas({ content: content(['3 cups flour', '1 tbsp butter']) })
    await rebuild(undefined, personal ? sdk.metas : {})
    expect(await automatic()).toMatchObject(personal ? [
      { name: 'butter', quantity: '1', unit: 'tbsp' }, { name: 'flour', quantity: '3', unit: 'cups' },
    ] : [{ name: 'flour', quantity: '1', unit: 'cup' }, { name: 'milk', quantity: '1', unit: 'cup' }])
    expect(sdk.recipes[0].content).toBe(content(['1 cup flour', '1 cup milk']))
  })

  it.each(['missing', 'load failure', 'parse failure', 'zero usable'] as const)('%s aborts with the entire persisted list unchanged', async failure => {
    await seedItem(item('manual'))
    await seedItem(item('existing-auto', { isManual: false }))
    const before = await list()
    const getRecipe = vi.fn(async (id: string) => {
      if (id === 'recipe-b' && failure === 'load failure') throw new Error('load failed')
      return id === 'recipe-b' && failure === 'missing' ? null : sdk.recipes[0]
    })
    const parse = (text: string) => {
      if (failure === 'parse failure') throw new Error('bad parse')
      return failure === 'zero usable' ? { ingredients: ['For the sauce:', 'https://example.test'], instructions: [], description: '' } : parseRecipeContent(text)
    }
    await expect(writers.rebuildGroceryFromPlan(sdk.user.uid, ['recipe-a', 'recipe-b'], getRecipe, parse)).rejects.toThrow()
    expect(getRecipe).toHaveBeenCalledTimes(2)
    expect(await list()).toEqual(before)
  })

  it('rejects an oversized atomic replacement before deleting any stale rows', async () => {
    const batch = writeBatch(sdk.db!)
    for (let index = 0; index < 450; index++) {
      const data = item(`old-${index}`, { isManual: false, name: `old item ${index}` })
      batch.set(doc(writers.groceryPath(sdk.user.uid), data.id), data)
    }
    await batch.commit()
    const before = await list()
    sdk.recipes = [recipe('recipe-a', ['1 cup flour'])]
    await expect(rebuild()).rejects.toThrow('above the safe atomic limit')
    expect(await list()).toEqual(before)
  })
})

type Pathway = 'Recipe Detail Add all' | 'Plan single Add' | 'Plan bulk Add' | 'Plan rebuild' | 'Grocery rebuild'
async function runPathway(pathway: Pathway) {
  render(pathway === 'Recipe Detail Add all' ? <DetailPage /> : pathway === 'Grocery rebuild' ? <GroceryPage /> : <PlanPage />)
  if (pathway === 'Plan single Add') {
    fireEvent.click(await screen.findByRole('button', { name: 'Recipe A — open actions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add ingredients to grocery' }))
  } else if (pathway === 'Plan rebuild' || pathway === 'Grocery rebuild') {
    fireEvent.click(await screen.findByRole('button', { name: 'Rebuild grocery list' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild' }))
  } else {
    fireEvent.click(await screen.findByRole('button', { name: 'Add all to grocery' }))
  }
  const writer = pathway.endsWith('rebuild') ? sdk.rebuild : sdk.add
  await waitFor(() => expect(writer).toHaveBeenCalledTimes(1))
  // Await the actual handler's SDK persistence, not only its invocation.
  await writer.mock.results[0].value
  await waitFor(() => expect(screen.queryByText(/^(Adding…|Adding\.\.\.|Rebuilding…)$/)).toBeNull())
}

describe('all five actual component handlers → real grocery persistence', () => {
  it.each<Pathway>(['Recipe Detail Add all', 'Plan single Add', 'Plan bulk Add', 'Plan rebuild', 'Grocery rebuild'])(
    '%s preserves the representative ingredient fixture and all olive-oil quantities', async pathway => {
      await runPathway(pathway)
      expect((await automatic()).map(({ name, quantity, unit, sourceRecipeIDs }) => ({ name, quantity, unit, sourceRecipeIDs }))).toEqual([
        { name: 'black beans', quantity: '1', unit: 'can', sourceRecipeIDs: ['recipe-a'] },
        { name: 'flour', quantity: '1', unit: 'cup', sourceRecipeIDs: ['recipe-a'] },
        { name: 'garlic', quantity: '', unit: '', sourceRecipeIDs: ['recipe-a'] },
        { name: 'green chile sauce', quantity: '1', unit: 'cup', sourceRecipeIDs: ['recipe-a'] },
        { name: 'milk', quantity: '½', unit: 'cup', sourceRecipeIDs: ['recipe-a'] },
        { name: 'olive oil', quantity: '3', unit: 'tbsp', sourceRecipeIDs: ['recipe-a'] },
        { name: 'onion, diced', quantity: '1', unit: '', sourceRecipeIDs: ['recipe-a'] },
        { name: 'tomatoes', quantity: '2', unit: '', sourceRecipeIDs: ['recipe-a'] },
      ])
    },
  )

  it('Plan bulk still visits a partially represented recipe, adds butter, and never doubles flour or visits cooked entries', async () => {
    sdk.recipes = [recipe('recipe-a', ['1 cup flour', '1 cup milk']), recipe('recipe-b', ['1 cup stock'])]
    sdk.plan!.plannedRecipeIDs.push('recipe-b')
    sdk.plan!.cookedRecipeIDs.push('recipe-b')
    await persistedMetas({ content: content(['1 cup flour', '1 tbsp butter']) })
    await writers.addRecipeIngredientsToGrocery(sdk.user.uid, 'recipe-a', ['1 cup flour'])
    await runPathway('Plan bulk Add')
    expect(sdk.add).toHaveBeenCalledWith(sdk.user.uid, 'recipe-a', ['1 cup flour', '1 tbsp butter'])
    expect(await automatic()).toMatchObject([{ name: 'butter', quantity: '1' }, { name: 'flour', quantity: '1' }])
  })

  it.each<Pathway>(['Recipe Detail Add all', 'Plan single Add', 'Plan bulk Add', 'Plan rebuild', 'Grocery rebuild'])(
    '%s consumes persisted personal content without restoring shared-only milk', async pathway => {
      sdk.recipes = [recipe('recipe-a', ['1 cup flour', '1 cup milk'])]
      await persistedMetas({ content: content(['3 cups flour', '1 tbsp butter']) })
      if (pathway.endsWith('rebuild')) {
        await writers.addRecipeIngredientsToGrocery(sdk.user.uid, 'recipe-a', ['1 cup flour', '1 cup milk'])
      }
      await runPathway(pathway)
      if (pathway.endsWith('rebuild')) expect(sdk.rebuild.mock.calls[0][4]).toEqual(sdk.metas)
      expect(await automatic()).toMatchObject([
        { name: 'butter', quantity: '1', unit: 'tbsp' }, { name: 'flour', quantity: '3', unit: 'cups' },
      ])
      expect((await automatic()).some(item => item.name === 'milk')).toBe(false)
    },
  )
})
