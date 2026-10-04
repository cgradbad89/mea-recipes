// @vitest-environment jsdom

// Actual page handlers, controlled auth/catalog/plan services, and real metadata
// persistence. Captured page payloads go directly to saveRecipeMeta, then a fresh
// server read proves preservation; no hand-written merge mock stands in for it.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  updateRecipeServings: vi.fn(), metasError: null as string | null,
  setServingsOverride: vi.fn(),
}))
vi.mock('@/lib/firebase', () => ({ get db() { return mocks.db } }))
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: mocks.recipe.id }), useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/components/AppDataProvider', () => ({ useAppData: () => ({
  recipes: [mocks.recipe], recipesLoading: false, recipesError: null,
  metas: { [mocks.recipe.id]: mocks.meta }, metasError: mocks.metasError, favoritesError: null,
  cookingHistoryError: null, refetchMetas: mocks.refetchMetas,
  refetchRecipes: vi.fn(), refetchFavorites: vi.fn(), refetchCookingHistory: vi.fn(),
  toggleFavorite: vi.fn(), isFavorite: () => false,
  toggleWantToTry: vi.fn(), isWantToTry: () => false,
}) }))
vi.mock('@/lib/userdata', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/userdata')>(),
  saveRecipeMeta: mocks.saveRecipeMeta,
  setServingsOverride: mocks.setServingsOverride,
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
  updateRecipeServings: mocks.updateRecipeServings,
}))
vi.mock('@/lib/consumptionLog', () => ({
  logCookEvent: vi.fn(), undoCookEvent: vi.fn(),
  getTodayCookEventForRecipe: vi.fn().mockResolvedValue({ id: 'synthetic-existing-cook' }),
}))
vi.mock('@/lib/googleCalendar', () => ({ runCalendarPush: vi.fn() }))
vi.mock('@/components/RecipeImage', () => ({ default: () => <div /> }))
vi.mock('@/components/NutritionSection', () => ({ default: ({ onSetOverrideServings }: {
  onSetOverrideServings: (servings: number) => void
}) => <button onClick={() => onSetOverrideServings(6)}>Set personal servings</button> }))
vi.mock('@/components/CookingMode', () => ({ default: () => null }))

import DetailPage from '@/app/recipes/[id]/page'
import PlanPage from '@/app/plan/page'
import RecipeEditModal from '@/components/RecipeEditModal'

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
  mocks.metasError = null
  mocks.refetchMetas.mockReset().mockResolvedValue(undefined)
  mocks.updateRecipeServings.mockReset()
  mocks.saveRecipeMeta.mockReset().mockImplementation(metadata.saveRecipeMeta)
  mocks.setServingsOverride.mockReset().mockImplementation(metadata.setServingsOverride)
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

async function persistedMeta() {
  return (await getDocFromServer(doc(metadata.metaPath(mocks.user.uid), mocks.recipe.id))).data()!
}
async function saveDetailNote() {
  const note = await screen.findByPlaceholderText('Add your notes, modifications, tips...')
  fireEvent.change(note, { target: { value: 'New saved note' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Notes' }))
}
async function openPlanRating() {
  fireEvent.click(await screen.findByRole('button', { name: 'Caller Recipe — open actions' }))
  fireEvent.click(screen.getByRole('button', { name: 'Mark cooked' }))
  const note = await screen.findByPlaceholderText('Any notes? (optional)')
  fireEvent.click(within(note.parentElement!).getAllByRole('button')[3])
}

describe('actual Detail metadata write/readback boundaries', () => {
  it('shows success only after the required readback completes', async () => {
    let finish!: () => void
    const readback = new Promise<void>(resolve => { finish = resolve })
    mocks.refetchMetas.mockReturnValueOnce(readback)
    render(<DetailPage />)
    await saveDetailNote()
    await waitFor(() => expect(mocks.refetchMetas).toHaveBeenCalledOnce())
    expect(screen.queryByText('Saved!')).toBeNull()
    expect((await persistedMeta()).note).toBe('New saved note')
    await act(async () => { finish(); await readback })
    expect(await screen.findByText('Saved!')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save Notes' }).hasAttribute('disabled')).toBe(false)
  })

  it('reports failed writes without readback or success and allows another save', async () => {
    mocks.saveRecipeMeta.mockRejectedValueOnce(new Error('write offline'))
    render(<DetailPage />)
    await saveDetailNote()
    expect((await screen.findByRole('alert')).textContent).toContain('write offline')
    expect(mocks.refetchMetas).not.toHaveBeenCalled()
    expect(screen.queryByText('Saved!')).toBeNull()
    expect((await persistedMeta()).note).toBe('Existing note')
    fireEvent.click(screen.getByRole('button', { name: 'Save Notes' }))
    await screen.findByText('Saved!')
  })

  it('accurately reports persisted notes with failed readback and retries without another write', async () => {
    mocks.refetchMetas.mockRejectedValueOnce(new Error('read offline'))
    render(<DetailPage />)
    await saveDetailNote()
    expect((await screen.findByRole('alert')).textContent).toContain('Saved, but couldn’t refresh')
    expect(screen.queryByText('Saved!')).toBeNull()
    expect(await persistedMeta()).toMatchObject({ note: 'New saved note', overrides })
    fireEvent.click(screen.getByRole('button', { name: 'Retry refresh' }))
    await screen.findByText('Saved!')
    expect(mocks.saveRecipeMeta).toHaveBeenCalledOnce()
    expect(mocks.refetchMetas).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the actual editor mounted during provider readback errors and retries only refresh', async () => {
    const view = render(<DetailPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit recipe' }))
    fireEvent.change(screen.getByDisplayValue('Personal title'), { target: { value: 'Saved editor title' } })
    mocks.refetchMetas.mockRejectedValueOnce(new Error('read offline'))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText('Saved, but couldn’t refresh the latest recipe data. Please try again.')
    mocks.metasError = 'read offline'
    view.rerender(<DetailPage />)
    expect(screen.getByText('Edit Recipe')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save changes' }).hasAttribute('disabled')).toBe(false)
    expect((await persistedMeta()).overrides).toEqual({ ...overrides, title: 'Saved editor title' })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText('Saved!')
    expect(mocks.saveRecipeMeta).toHaveBeenCalledOnce()
  })

  it('keeps a persisted reset distinct from failed readback and retries without repeating reset', async () => {
    render(<DetailPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit recipe' }))
    mocks.refetchMetas.mockRejectedValueOnce(new Error('reset read offline'))
    fireEvent.click(screen.getByRole('button', { name: 'Reset to original' }))
    fireEvent.click(screen.getByRole('button', { name: 'Click again to reset' }))
    await screen.findByText('Reset saved, but couldn’t refresh the latest recipe data. Please retry the refresh.')
    expect(await persistedMeta()).toMatchObject({ note: 'Existing note', rating: 0 })
    expect(await persistedMeta()).not.toHaveProperty('overrides')
    expect(screen.getByText('Edit Recipe')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry refresh' }))
    await waitFor(() => expect(screen.queryByText('Edit Recipe')).toBeNull())
    expect(mocks.saveRecipeMeta).toHaveBeenCalledOnce()
  })
})

describe('actual Plan metadata write/readback boundaries', () => {
  it('keeps the rating prompt open until write and readback both succeed', async () => {
    let finish!: () => void
    const readback = new Promise<void>(resolve => { finish = resolve })
    mocks.refetchMetas.mockReturnValueOnce(readback)
    render(<PlanPage />)
    await openPlanRating()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.refetchMetas).toHaveBeenCalledOnce())
    expect(screen.getByPlaceholderText('Any notes? (optional)')).toBeTruthy()
    expect(await persistedMeta()).toMatchObject({ rating: 4, note: 'Existing note', overrides })
    await act(async () => { finish(); await readback })
    await waitFor(() => expect(screen.queryByPlaceholderText('Any notes? (optional)')).toBeNull())
  })

  it('reports rating readback failure and retries only the read, preserving notes and overrides', async () => {
    mocks.refetchMetas.mockRejectedValueOnce(new Error('read offline'))
    render(<PlanPage />)
    await openPlanRating()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Rating saved, but couldn’t refresh')
    expect(await persistedMeta()).toMatchObject({ rating: 4, note: 'Existing note', overrides })
    fireEvent.click(screen.getByRole('button', { name: 'Retry refresh' }))
    await waitFor(() => expect(screen.queryByPlaceholderText('Any notes? (optional)')).toBeNull())
    expect(mocks.saveRecipeMeta).toHaveBeenCalledOnce()
    expect(mocks.refetchMetas).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reports rating write failure and keeps existing persisted metadata', async () => {
    mocks.saveRecipeMeta.mockRejectedValueOnce(new Error('write offline'))
    render(<PlanPage />)
    await openPlanRating()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Couldn’t save your rating')
    expect(mocks.refetchMetas).not.toHaveBeenCalled()
    expect(await persistedMeta()).toMatchObject({ note: 'Existing note', rating: 0, overrides })
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false)
  })
})

describe('private persistence during second-boundary failures', () => {
  it('retains real private edits when shared servings fails and retries without replaying stale metadata', async () => {
    const macros = { calories: 100, protein_g: 10, carbs_g: 10, fat_g: 2, fiber_g: 1, sugar_g: 1 }
    const recipe = { ...mocks.recipe, nutrition: { ...macros, servings: 4, total: macros } }
    mocks.updateRecipeServings.mockRejectedValueOnce(new Error('shared offline'))
      .mockResolvedValueOnce({ ...recipe.nutrition, servings: 8 })
    const onSaved = vi.fn().mockImplementation(() => mocks.refetchMetas())
    const onClose = vi.fn()
    const view = render(<RecipeEditModal recipe={recipe} meta={mocks.meta} onClose={onClose} onSaved={onSaved} />)
    fireEvent.change(screen.getAllByRole('textbox').find(control => control.tagName === 'TEXTAREA')!,
      { target: { value: 'Persisted personal content' } })
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Recipe edits were saved, but the shared servings update failed')
    expect(await persistedMeta()).toMatchObject({ note: 'Existing note', overrides: { ...overrides, content: 'Persisted personal content' } })
    expect(onClose).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.queryByText('Saved!')).toBeNull()
    // Fresh sibling values must survive the retry; no private write is needed.
    await metadata.saveRecipeMeta(mocks.user.uid, recipe.id, { note: 'Fresh note', rating: 5, overrides: { servings: 7 } })
    const fresh = await persistedMeta()
    view.rerender(<RecipeEditModal recipe={recipe} meta={fresh} onClose={onClose} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText('Saved!')
    expect(mocks.saveRecipeMeta).toHaveBeenCalledOnce()
    expect(mocks.updateRecipeServings).toHaveBeenCalledTimes(2)
    expect(await persistedMeta()).toEqual(fresh)
    expect(onSaved).toHaveBeenCalledWith(fresh)
  })

  it('reports persisted personal servings separately from failed readback', async () => {
    mocks.refetchMetas.mockRejectedValueOnce(new Error('read offline'))
    render(<DetailPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Set personal servings' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Serving size saved, but couldn’t refresh')
    expect(await persistedMeta()).toMatchObject({ overrides: { ...overrides, servings: 6 } })
    expect(mocks.saveRecipeMeta).not.toHaveBeenCalled()
  })

  it('reports a personal servings write rejection without pretending it persisted', async () => {
    mocks.setServingsOverride.mockRejectedValueOnce(new Error('write offline'))
    render(<DetailPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Set personal servings' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Couldn’t save your serving size')
    expect(mocks.refetchMetas).not.toHaveBeenCalled()
    expect(await persistedMeta()).toMatchObject({ overrides })
  })
})

describe('metadata caller owner transitions', () => {
  it('clears unsaved Detail notes when switching between owners without metadata', async () => {
    mocks.meta = null
    const view = render(<DetailPage />)
    const note = await screen.findByPlaceholderText('Add your notes, modifications, tips...')
    fireEvent.change(note, { target: { value: 'Owner A private draft' } })
    mocks.user.uid = `synthetic-b-${randomUUID()}`
    view.rerender(<DetailPage />)
    expect((screen.getByPlaceholderText('Add your notes, modifications, tips...') as HTMLTextAreaElement).value).toBe('')
  })

  it('does not show A save completion or initiate A readback under B', async () => {
    let finish!: () => void
    const write = new Promise<void>(resolve => { finish = resolve })
    mocks.saveRecipeMeta.mockReturnValueOnce(write)
    const view = render(<DetailPage />)
    await saveDetailNote()
    mocks.user.uid = `synthetic-b-${randomUUID()}`
    mocks.meta = null
    view.rerender(<DetailPage />)
    await act(async () => { finish(); await write })
    expect(screen.queryByText('Saved!')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(mocks.refetchMetas).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save Notes' }).hasAttribute('disabled')).toBe(false)
  })

  it('retires an A rating prompt when B takes over during readback', async () => {
    let fail!: (error: Error) => void
    const readback = new Promise<void>((_resolve, reject) => { fail = reject })
    mocks.refetchMetas.mockReturnValueOnce(readback)
    const view = render(<PlanPage />)
    await openPlanRating()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.refetchMetas).toHaveBeenCalledOnce())
    mocks.user.uid = `synthetic-b-${randomUUID()}`
    mocks.meta = null
    view.rerender(<PlanPage />)
    await act(async () => { fail(new Error('retired read')); await readback.catch(() => {}) })
    expect(screen.queryByPlaceholderText('Any notes? (optional)')).toBeNull()
    expect(screen.queryByText(/Rating saved, but/)).toBeNull()
  })
})
