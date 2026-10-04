// Real browser-SDK persistence in a synthetic, localhost-only project. Allow-all
// emulator results prove merge behavior, not production security-rule access.
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, openSync, closeSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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
let emulator: ChildProcess | undefined
let directory = ''

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Cannot allocate isolated emulator port')))
        return
      }
      server.close(error => error ? reject(error) : resolve(address.port))
    })
  })
}

beforeAll(async () => {
  const port = await freePort()
  directory = mkdtempSync(join(tmpdir(), 'mea-bookmarklet-persistence-'))
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
    } catch { /* wait for the isolated emulator */ }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  if (!ready) throw new Error(`Synthetic Firestore isolation failed: ${spawnError?.message ?? ''}\n${readFileSync(log, 'utf8').slice(-6000)}`)

  app = initializeApp({ projectId: projectID }, `bookmarklet-${randomUUID()}`)
  sdk.db = getFirestore(app)
  // Must precede every read/write; the production firebase module is never loaded.
  connectFirestoreEmulator(sdk.db, '127.0.0.1', port)
  expect(sdk.db.app.options.projectId).toBe(projectID)
}, 45_000)

afterAll(async () => {
  if (sdk.db) await terminate(sdk.db)
  if (app) await deleteApp(app)
  if (emulator && emulator.exitCode === null) {
    const stopped = new Promise(resolve => emulator!.once('exit', resolve))
    emulator.kill('SIGINT')
    await Promise.race([stopped, new Promise(resolve => setTimeout(resolve, 5000))])
    if (emulator.exitCode === null) emulator.kill('SIGKILL')
  }
  if (directory) rmSync(directory, { recursive: true, force: true })
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
