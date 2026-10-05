// Real browser-SDK persistence in a synthetic, localhost-only project. Allow-all
// emulator results prove merge behavior, not production security-rule access.
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { startFirestoreEmulator } from './helpers/firestoreEmulator'
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app'
import {
  connectFirestoreEmulator, doc, getDocFromServer, getFirestore,
  terminate, Timestamp, type Firestore,
} from 'firebase/firestore'
const sdk = vi.hoisted(() => ({ db: undefined as Firestore | undefined }))
vi.mock('@/lib/firebase', () => ({ get db() { return sdk.db } }))
import { addToQueue, getQueue, updateQueueItem, publishQueuedRecipe, buildRecipeContent } from '@/lib/queue'
import { getRecipeById } from '@/lib/recipes'
import { parseRecipeContent } from '@/lib/recipeContent'
import { nachosQueue } from './helpers/bookmarkletFixture'

const projectID = 'demo-mea-bookmarklet-persistence'
let app: FirebaseApp | undefined
let emulator: Awaited<ReturnType<typeof startFirestoreEmulator>> | undefined

beforeAll(async () => {
  emulator = await startFirestoreEmulator(projectID)
  const { port } = emulator
  app = initializeApp({ projectId: projectID }, `bookmarklet-${randomUUID()}`)
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

it('persists and reads all 13/7 rows using real isolated Firestore SDK queue/edit/publication operations', async () => {
  const uid = `synthetic-${randomUUID()}`
  const { status: _status, ...capture } = nachosQueue
  const id = await addToQueue(uid, capture)
  const before = await getQueue(uid)
  expect(before).toHaveLength(1)
  expect(before[0].createdAt).toBeInstanceOf(Timestamp)
  expect(before[0].ingredients).toEqual(nachosQueue.ingredients)
  expect(before[0].instructions).toEqual(nachosQueue.instructions)
  await updateQueueItem(uid, id, { ingredients: nachosQueue.ingredients, instructions: nachosQueue.instructions })
  const reviewed = (await getQueue(uid))[0]
  const content = buildRecipeContent(reviewed)
  const publication = await publishQueuedRecipe(uid, id, {
    title: nachosQueue.title, recipeID: '', content, category: 'Snacks', cuisine: 'mexican',
    imageURL: nachosQueue.imageURL, sourceURL: nachosQueue.sourceURL, sourceFile: '', labels: 'Recipes', hasImage: 'true', created: '', modified: '',
  }, uid)
  const stored = (await getDocFromServer(doc(sdk.db!, 'recipes', publication.recipeId))).data()!
  expect(stored.content).toBe(content)
  const loaded = await getRecipeById(publication.recipeId)
  const parsed = parseRecipeContent(loaded!.content)
  expect(parsed.ingredients).toEqual(nachosQueue.ingredients)
  expect(parsed.instructions).toEqual(nachosQueue.instructions)
  expect(parsed.ingredients).toHaveLength(13)
  expect(parsed.instructions).toHaveLength(7)
  expect(parsed.ingredients.at(-1)).toBe('scallions')
  expect(parsed.instructions.at(-1)).toContain('Garnish with avocado, queso fresco and scallions')
  expect((await getQueue(uid))[0].status).toBe('published')
}, 15_000)
