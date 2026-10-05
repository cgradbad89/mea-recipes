// Real browser-SDK persistence in a synthetic, localhost-only project. Allow-all
// emulator results prove merge behavior, not production security-rule access.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { startFirestoreEmulator } from './helpers/firestoreEmulator'
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app'
import {
  connectFirestoreEmulator, doc, getDocFromServer, getFirestore,
  setDoc, terminate, Timestamp, type Firestore,
} from 'firebase/firestore'
import type { RecipeMeta } from '@/lib/userdata'

const sdk = vi.hoisted(() => ({ db: undefined as Firestore | undefined, write: vi.fn() }))
vi.mock('@/lib/firebase', () => ({ get db() { return sdk.db } }))
vi.mock('firebase/firestore', async importOriginal => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  setDoc: sdk.write,
}))
import { getRecipeMeta, metaPath, saveRecipeMeta, setServingsOverride } from '@/lib/userdata'

const projectID = 'demo-mea-meta-persistence'
let app: FirebaseApp | undefined
let emulator: Awaited<ReturnType<typeof startFirestoreEmulator>> | undefined

beforeAll(async () => {
  emulator = await startFirestoreEmulator(projectID)
  const { port } = emulator
  app = initializeApp({ projectId: projectID }, `meta-${randomUUID()}`)
  sdk.db = getFirestore(app)
  // Must precede every read/write; the production firebase module is never loaded.
  connectFirestoreEmulator(sdk.db, '127.0.0.1', port)
  expect(sdk.db.app.options.projectId).toBe(projectID)
}, 45_000)

afterAll(async () => {
  try {
    if (sdk.db) await terminate(sdk.db)
    if (app) await deleteApp(app)
  } finally {
    await emulator?.stop()
  }
}, 15_000)

beforeEach(async () => {
  const actual = await vi.importActual<typeof import('firebase/firestore')>('firebase/firestore')
  sdk.write.mockReset().mockImplementation(actual.setDoc)
})

const overrides = {
  content: 'Personal ingredients and instructions', title: 'Personal title',
  cuisine: 'personal', category: 'Other', imageURL: 'https://example.test/personal.jpg',
  prepTime: '5 min', cookTime: '10 min', servings: 2,
}
function identity() { return { uid: `synthetic-${randomUUID()}`, recipeID: `recipe-${randomUUID()}` } }
async function seed() {
  const ids = identity()
  // The original failure sequence: persist edits first, then ordinary metadata.
  await saveRecipeMeta(ids.uid, ids.recipeID, { note: 'Existing note', rating: 3, overrides })
  return ids
}
async function freshRead(uid: string, recipeID: string) {
  const ref = doc(metaPath(uid), recipeID.replace(/\//g, '_').replace(/\s+/g, '-'))
  return (await getDocFromServer(ref)).data()!
}

describe('RecipeMeta real persistence', () => {
  // Exact forms captured from actual page handlers in recipeMetaCallers.test.tsx;
  // those tests also forward their captured arguments into this real writer.
  it.each([
    ['detail note/rating', { note: 'Detail note', rating: 4 }],
    ['Plan rating only', { rating: 4 }],
    ['Plan rating/note', { rating: 4, note: 'Plan note' }],
  ])('%s preserves all personal edits in the original failure sequence', async (_name, patch) => {
    const { uid, recipeID } = await seed()
    await saveRecipeMeta(uid, recipeID, patch)
    const stored = await freshRead(uid, recipeID)
    expect(stored.overrides).toEqual(overrides)
    expect(stored.note).toBe('note' in patch ? patch.note : 'Existing note')
    expect(stored.rating).toBe(4)
  })

  it('note-only and undefined top-level values preserve rating and overrides', async () => {
    const { uid, recipeID } = await seed()
    await saveRecipeMeta(uid, recipeID, { note: 'New note', rating: undefined })
    expect(await freshRead(uid, recipeID)).toMatchObject({ note: 'New note', rating: 3, overrides })
  })

  it('a nested patch changes only supplied fields and preserves unknown siblings', async () => {
    const { uid, recipeID } = await seed()
    await setDoc(doc(metaPath(uid), recipeID), {
      unknownMeta: { retained: true }, overrides: { unknownOverride: 'retained' },
    }, { merge: true })
    await saveRecipeMeta(uid, recipeID, { overrides: { content: 'New content', cookTime: '20 min' } })
    expect(await freshRead(uid, recipeID)).toMatchObject({
      note: 'Existing note', rating: 3, unknownMeta: { retained: true },
      overrides: { ...overrides, content: 'New content', cookTime: '20 min', unknownOverride: 'retained' },
    })
  })

  it.each([
    ['omitted overrides', { rating: 3 }], ['empty patch', {}], ['empty override object', { overrides: {} }],
  ] as const)('%s is non-destructive', async (_name, patch) => {
    const { uid, recipeID } = await seed()
    await saveRecipeMeta(uid, recipeID, patch)
    expect(await freshRead(uid, recipeID)).toMatchObject({ note: 'Existing note', rating: 3, overrides })
  })

  it.each([undefined, null])('explicit full reset %j removes all overrides, preserving notes/ratings', async value => {
    const { uid, recipeID } = await seed()
    // Null is a runtime legacy input, never a nullable persisted interface.
    await saveRecipeMeta(uid, recipeID, { overrides: value } as Partial<RecipeMeta>)
    const stored = await freshRead(uid, recipeID)
    expect(stored).not.toHaveProperty('overrides')
    expect(stored).toMatchObject({ note: 'Existing note', rating: 3 })
  })

  it('explicit content removal preserves title, image, time, category, and servings', async () => {
    const { uid, recipeID } = await seed()
    await saveRecipeMeta(uid, recipeID, { overrides: { content: undefined } })
    const { content: _removed, ...siblings } = overrides
    expect((await freshRead(uid, recipeID)).overrides).toEqual(siblings)
  })

  it('removing the final nested field removes that field', async () => {
    const { uid, recipeID } = identity()
    await saveRecipeMeta(uid, recipeID, { overrides: { content: 'Only override' } })
    await saveRecipeMeta(uid, recipeID, { overrides: { content: undefined } })
    expect((await freshRead(uid, recipeID)).overrides ?? {}).not.toHaveProperty('content')
  })

  it('servings set/clear preserves content and later metadata/editor patches preserve fresh servings', async () => {
    const { uid, recipeID } = await seed()
    await setServingsOverride(uid, recipeID, 6)
    await saveRecipeMeta(uid, recipeID, { note: 'Later note' })
    await saveRecipeMeta(uid, recipeID, { overrides: { title: 'Editor title' } })
    expect((await freshRead(uid, recipeID)).overrides).toEqual({ ...overrides, title: 'Editor title', servings: 6 })
    await setServingsOverride(uid, recipeID, null)
    const { servings: _removed, ...siblings } = overrides
    expect((await freshRead(uid, recipeID)).overrides).toEqual({ ...siblings, title: 'Editor title' })
  })

  it('creates an absent metadata document with an ordinary partial save', async () => {
    const { uid, recipeID } = identity()
    expect(await getRecipeMeta(uid, recipeID)).toBeNull()
    await saveRecipeMeta(uid, recipeID, { note: 'First note' })
    expect(await getRecipeMeta(uid, recipeID)).toMatchObject({ recipeID, note: 'First note' })
    expect(await freshRead(uid, recipeID)).not.toHaveProperty('overrides')
  })

  it('sanitizes IDs, isolates uids, stamps canonical identity/time, and leaves shared recipes untouched', async () => {
    const { uid } = identity()
    const otherUid = `synthetic-${randomUUID()}`
    const recipeID = 'folder/recipe with\tspaces'
    await setDoc(doc(sdk.db!, 'recipes', 'shared-sentinel'), { content: 'Shared catalog' })
    const start = Date.now()
    await saveRecipeMeta(uid, recipeID, { recipeID: 'stale-id', updatedAt: 'stale-time', overrides })
    await saveRecipeMeta(otherUid, recipeID, { note: 'Other user' })
    const stored = await freshRead(uid, recipeID)
    expect(doc(metaPath(uid), 'folder_recipe-with-spaces').path).toBe(`users/${uid}/recipes/root/meta/folder_recipe-with-spaces`)
    expect(stored.recipeID).toBe(recipeID)
    expect(stored.updatedAt).toBeInstanceOf(Timestamp)
    expect(stored.updatedAt.toMillis()).toBeGreaterThanOrEqual(start - 1000)
    expect(stored.updatedAt.toMillis()).toBeLessThanOrEqual(Date.now() + 1000)
    expect(await getRecipeMeta(uid, recipeID)).toMatchObject({ overrides })
    expect(await freshRead(otherUid, recipeID)).toMatchObject({ note: 'Other user' })
    expect(await freshRead(otherUid, recipeID)).not.toHaveProperty('overrides')
    expect((await getDocFromServer(doc(sdk.db!, 'recipes', 'shared-sentinel'))).data()).toEqual({ content: 'Shared catalog' })
  })

  it('persists valid falsy values instead of treating them as deletions', async () => {
    const { uid, recipeID } = await seed()
    await saveRecipeMeta(uid, recipeID, { note: '', rating: 0, overrides: { content: '', prepTime: '' } })
    expect(await freshRead(uid, recipeID)).toMatchObject({
      note: '', rating: 0, overrides: { ...overrides, content: '', prepTime: '' },
    })
  })
})

describe('RecipeMeta controlled write failures/completion (SDK test doubles)', () => {
  it('rejects with the original write error', async () => {
    const failure = new Error('injected metadata write failure')
    sdk.write.mockRejectedValueOnce(failure)
    const { uid, recipeID } = identity()
    await expect(saveRecipeMeta(uid, recipeID, { note: 'Unsaved' })).rejects.toBe(failure)
    expect(await getRecipeMeta(uid, recipeID)).toBeNull()
  })

  it('does not resolve before the SDK write completes', async () => {
    let finish!: () => void
    sdk.write.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve }))
    const { uid, recipeID } = identity()
    let completed = false
    const pending = saveRecipeMeta(uid, recipeID, { rating: 4 }).then(() => { completed = true })
    await Promise.resolve()
    expect(completed).toBe(false)
    finish()
    await pending
    expect(completed).toBe(true)
  })
})
