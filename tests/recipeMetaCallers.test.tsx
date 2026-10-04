// @vitest-environment jsdom

// Actual page handlers, controlled auth/catalog/plan services, and real metadata
// persistence. Captured page payloads go directly to saveRecipeMeta, then a fresh
// server read proves preservation; no hand-written merge mock stands in for it.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, openSync, closeSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app'
import { connectFirestoreEmulator, doc, getDocFromServer, getFirestore, terminate, type Firestore } from 'firebase/firestore'
import type { RecipeMeta } from '@/lib/userdata'

const mocks = vi.hoisted(() => ({
  db: undefined as Firestore | undefined,
  user: {
    uid: 'synthetic-pending', email: 'synthetic@example.test', emailVerified: true,
    displayName: 'Synthetic viewer', photoURL: '',
    getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
  },
  recipe: {
    id: 'caller-recipe', recipeID: 'caller-recipe', title: 'Caller Recipe',
    content: 'INGREDIENTS\n1 shared ingredient\n\nINSTRUCTIONS\nCook it.',
    category: 'Seafood', cuisine: 'test', imageURL: '', sourceURL: '',
    sourceFile: '', labels: '', hasImage: 'false', created: '', modified: '',
  },
  meta: null as RecipeMeta | null,
  saveRecipeMeta: vi.fn(), refetchMetas: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/firebase', () => ({ get db() { return mocks.db } }))
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: mocks.recipe.id }), useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/components/AppDataProvider', () => ({ useAppData: () => ({
  recipes: [mocks.recipe], recipesLoading: false, recipesError: null,
  metas: { [mocks.recipe.id]: mocks.meta }, metasError: null, favoritesError: null,
  cookingHistoryError: null, refetchMetas: mocks.refetchMetas,
  refetchRecipes: vi.fn(), refetchFavorites: vi.fn(), refetchCookingHistory: vi.fn(),
  toggleFavorite: vi.fn(), isFavorite: () => false,
  toggleWantToTry: vi.fn(), isWantToTry: () => false,
}) }))
vi.mock('@/lib/userdata', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/userdata')>(),
  saveRecipeMeta: mocks.saveRecipeMeta,
  weekIDFromDate: () => '2026-08-17', getWeekPlan: vi.fn().mockResolvedValue(null),
  subscribeWeekPlan: (_uid: string, _week: string, onData: (plan: unknown) => void) => {
    onData({ weekID: '2026-08-17', plannedRecipeIDs: [{ recipeID: mocks.recipe.id, day: null, role: 'main' }], cookedRecipeIDs: [] })
    return vi.fn()
  },
  subscribeSharedWeekPlans: (_week: string, _uid: string, onData: (plans: unknown[]) => void) => {
    onData([]); return vi.fn()
  },
  subscribeSharedPlanPublication: (_uid: string, _week: string, onData: (plan: unknown) => void) => {
    onData(null); return vi.fn()
  },
  markRecipeCooked: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/recipes', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/recipes')>(),
  getRecipeById: vi.fn(async () => mocks.recipe),
}))
vi.mock('@/lib/consumptionLog', () => ({
  logCookEvent: vi.fn(), undoCookEvent: vi.fn(),
  getTodayCookEventForRecipe: vi.fn().mockResolvedValue({ id: 'synthetic-existing-cook' }),
}))
vi.mock('@/lib/googleCalendar', () => ({ runCalendarPush: vi.fn() }))
vi.mock('@/components/RecipeImage', () => ({ default: () => <div /> }))
vi.mock('@/components/NutritionSection', () => ({ default: () => null }))
vi.mock('@/components/CookingMode', () => ({ default: () => null }))

import DetailPage from '@/app/recipes/[id]/page'
import PlanPage from '@/app/plan/page'

const projectID = 'demo-mea-meta-callers'
let app: FirebaseApp | undefined
let emulator: ChildProcess | undefined
let directory = ''
let metadata: typeof import('@/lib/userdata')

beforeAll(async () => {
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Cannot allocate caller emulator port')))
        return
      }
      server.close(error => error ? reject(error) : resolve(address.port))
    })
  })
  directory = mkdtempSync(join(tmpdir(), 'mea-meta-callers-'))
  const config = join(directory, 'firebase.json')
  const log = join(directory, 'emulator.log')
  writeFileSync(config, JSON.stringify({ emulators: {
    firestore: { host: '127.0.0.1', port }, ui: { enabled: false },
  } }))
  const logFD = openSync(log, 'w')
  emulator = spawn('firebase', [
    'emulators:start', '--only', 'firestore', '--project', projectID,
    '--config', config, '--log-verbosity', 'QUIET',
  ], { cwd: directory, stdio: ['ignore', logFD, logFD] })
  closeSync(logFD)
  let spawnError: Error | undefined
  emulator.once('error', error => { spawnError = error })
  let ready = false
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (spawnError || emulator.exitCode !== null) break
    try {
      const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) })
      if (response.ok) { ready = true; break }
    } catch { /* wait for the synthetic emulator */ }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  if (!ready) throw new Error(`Caller persistence isolation failed: ${spawnError?.message ?? ''}\n${readFileSync(log, 'utf8').slice(-6000)}`)
  app = initializeApp({ projectId: projectID }, `callers-${randomUUID()}`)
  mocks.db = getFirestore(app)
  connectFirestoreEmulator(mocks.db, '127.0.0.1', port)
  expect(mocks.db.app.options.projectId).toBe(projectID)
  metadata = await vi.importActual<typeof import('@/lib/userdata')>('@/lib/userdata')
}, 45_000)

afterAll(async () => {
  if (mocks.db) await terminate(mocks.db)
  if (app) await deleteApp(app)
  if (emulator && emulator.exitCode === null) {
    const stopped = new Promise(resolve => emulator!.once('exit', resolve))
    emulator.kill('SIGINT')
    await Promise.race([stopped, new Promise(resolve => setTimeout(resolve, 5000))])
    if (emulator.exitCode === null) emulator.kill('SIGKILL')
  }
  if (directory) rmSync(directory, { recursive: true, force: true })
}, 15_000)
afterEach(cleanup)

const overrides = {
  content: 'INGREDIENTS\n2 personal ingredients\n\nINSTRUCTIONS\nPersonal method.',
  title: 'Personal title', servings: 2, imageURL: 'https://example.test/image.jpg',
  prepTime: '5 min', cookTime: '10 min',
}
beforeEach(async () => {
  sessionStorage.clear()
  mocks.user.uid = `synthetic-${randomUUID()}`
  mocks.meta = { note: 'Existing note', rating: 0, overrides }
  mocks.refetchMetas.mockClear()
  mocks.saveRecipeMeta.mockReset().mockImplementation(metadata.saveRecipeMeta)
  await metadata.saveRecipeMeta(mocks.user.uid, mocks.recipe.id, mocks.meta)
})

async function assertPersisted(patch: Partial<RecipeMeta>) {
  await waitFor(() => expect(mocks.refetchMetas).toHaveBeenCalledTimes(1))
  expect(mocks.saveRecipeMeta).toHaveBeenCalledExactlyOnceWith(mocks.user.uid, mocks.recipe.id, patch)
  const [uid, recipeID, captured] = mocks.saveRecipeMeta.mock.calls[0]
  expect(captured).not.toHaveProperty('overrides')
  const stored = (await getDocFromServer(doc(metadata.metaPath(uid), recipeID))).data()
  expect(stored).toMatchObject({
    ...patch, note: patch.note ?? 'Existing note', overrides,
  })
}

describe('actual RecipeMeta page callers → real persisted state', () => {
  it('detail sends {note, rating} and preserves personal content/title/servings', async () => {
    render(<DetailPage />)
    const note = await screen.findByPlaceholderText('Add your notes, modifications, tips...')
    fireEvent.change(note, { target: { value: 'Detail note' } })
    const section = note.closest('section')!
    fireEvent.click(within(section).getAllByRole('button')[3])
    fireEvent.click(screen.getByRole('button', { name: 'Save Notes' }))
    await assertPersisted({ note: 'Detail note', rating: 4 })
  })

  it.each([
    ['rating only', '', { rating: 4 }],
    ['rating/note', 'Plan note', { rating: 4, note: 'Plan note' }],
  ] as const)('Plan sends %s and preserves overrides and any omitted existing note', async (_name, note, patch) => {
    render(<PlanPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Caller Recipe — open actions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mark cooked' }))
    const noteControl = await screen.findByPlaceholderText('Any notes? (optional)')
    if (note) fireEvent.change(noteControl, { target: { value: note } })
    fireEvent.click(within(noteControl.parentElement!).getAllByRole('button')[3])
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await assertPersisted(patch)
  })
})
