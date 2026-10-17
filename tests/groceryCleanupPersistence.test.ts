// Real browser-SDK writes against synthetic demo fixtures only. The production
// Firebase initializer is mocked; the emulator exercises commit/retry semantics.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app'
import {
  collection, connectFirestoreEmulator, deleteDoc, doc, getDocFromServer,
  getDocsFromServer, getFirestore, setDoc, terminate, Timestamp, updateDoc, writeBatch,
  type DocumentReference, type Firestore, type Transaction, type TransactionOptions,
} from 'firebase/firestore'
import { startFirestoreEmulator } from './helpers/firestoreEmulator'
import type { GroceryItem } from '@/lib/userdata'
import type { GroceryCleanupChange, GroceryCleanupPlan } from '@/lib/groceryCleanup'

const sdk = vi.hoisted(() => ({
  db: undefined as Firestore | undefined,
  beforeTransaction: undefined as undefined | ((call: number) => Promise<void>),
  afterRead: undefined as undefined | ((ref: DocumentReference) => Promise<void>),
  transactionCalls: 0,
  transactionAttempts: 0,
  committedSizes: [] as number[],
}))
const api = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  generateAIArray: vi.fn(),
  generateAIObject: vi.fn(),
}))
vi.mock('@/lib/firebaseAdmin', () => ({ verifyAuthToken: api.verifyAuthToken }))
vi.mock('@/lib/ai', () => ({
  generateAIArray: api.generateAIArray,
  generateAIObject: api.generateAIObject,
}))
vi.mock('@/lib/firebase', () => ({ get db() { return sdk.db } }))
vi.mock('firebase/firestore', async importOriginal => {
  const original = await importOriginal<typeof import('firebase/firestore')>()
  return {
    ...original,
    runTransaction: async (db: Firestore, run: (tx: Transaction) => Promise<unknown>, options?: TransactionOptions) => {
      sdk.transactionCalls++
      await sdk.beforeTransaction?.(sdk.transactionCalls)
      let writes = 0
      const result = await original.runTransaction(db, async tx => {
        sdk.transactionAttempts++
        writes = 0
        const controlled = {
          get: async (ref: DocumentReference) => {
            expect(writes).toBe(0)
            const snapshot = await tx.get(ref)
            await sdk.afterRead?.(ref)
            return snapshot
          },
          update: (ref: DocumentReference, data: Record<string, unknown>) => {
            writes++; return tx.update(ref, data)
          },
          delete: (ref: DocumentReference) => { writes++; return tx.delete(ref) },
          set: tx.set.bind(tx),
        }
        return run(controlled as Transaction)
      }, options)
      sdk.committedSizes.push(writes)
      return result
    },
  }
})

import { applyGroceryCleanup, GroceryCleanupApplyError, subscribeGroceryItems } from '@/lib/userdata'
import { requestGroceryCleanup } from '@/lib/groceryCleanup'
import { POST } from '@/app/api/grocery-cleanup/route'

const projectID = 'demo-mea-grocery-cleanup'
const apps: FirebaseApp[] = []
const databases: Firestore[] = []
let emulator: Awaited<ReturnType<typeof startFirestoreEmulator>> | undefined
let uid = ''

beforeAll(async () => {
  emulator = await startFirestoreEmulator(projectID)
  for (let index = 0; index < 2; index++) {
    const app = initializeApp({ projectId: projectID }, `cleanup-${randomUUID()}`)
    apps.push(app)
    const db = getFirestore(app)
    connectFirestoreEmulator(db, '127.0.0.1', emulator.port)
    expect(db.app.options.projectId).toBe(projectID)
    databases.push(db)
  }
  sdk.db = databases[0]
}, 45_000)

afterAll(async () => {
  try {
    await Promise.all(databases.map(db => terminate(db)))
    await Promise.all(apps.map(app => deleteApp(app)))
  } finally {
    await emulator?.stop()
  }
}, 15_000)

beforeEach(() => {
  uid = `synthetic-${randomUUID()}`
  sdk.beforeTransaction = undefined
  sdk.afterRead = undefined
  sdk.transactionCalls = 0
  sdk.transactionAttempts = 0
  sdk.committedSizes = []
  api.verifyAuthToken.mockReset().mockResolvedValue(uid)
  api.generateAIArray.mockReset()
  api.generateAIObject.mockReset()
})

function ref(id: string, client = 0) {
  return doc(databases[client], 'users', uid, 'pantry', 'root', 'groceryItems', id)
}

function item(id: string, extra: Partial<GroceryItem> & Record<string, unknown> = {}): GroceryItem {
  return {
    id, name: 'flour', quantity: '1', unit: 'cup', isChecked: false,
    isManual: false, sourceRecipeIDs: ['recipe-a'],
    createdAt: new Timestamp(1_700_000_000, 123_000),
    updatedAt: new Timestamp(1_700_000_001, 456_000),
    ...extra,
  }
}

async function seed(items: GroceryItem[]) {
  for (let offset = 0; offset < items.length; offset += 450) {
    const batch = writeBatch(databases[0])
    for (const value of items.slice(offset, offset + 450)) batch.set(ref(value.id), value)
    await batch.commit()
  }
}

async function capture(): Promise<GroceryItem[]> {
  return new Promise((resolve, reject) => {
    const stop = subscribeGroceryItems(uid, values => { stop(); resolve(values) }, reject)
  })
}

function normalize(items: GroceryItem[], id: string): GroceryCleanupChange {
  const originalIndex = items.findIndex(value => value.id === id)
  const original = items[originalIndex]
  return {
    originalIndex, action: 'normalize', mergedWith: [], name: original.name.trim().toLowerCase(),
    quantity: original.quantity, unit: original.unit, category: original.manualSection ?? 'Other',
  }
}

async function persisted() {
  const snapshot = await getDocsFromServer(collection(databases[0], 'users', uid, 'pantry', 'root', 'groceryItems'))
  return new Map(snapshot.docs.map(value => [value.id, value.data()]))
}

describe('safe grocery cleanup persistence', () => {
  it('cleans the reported 70-unchecked/33-checked fixture through the real client, route and persistence boundaries', async () => {
    const unchecked = [
      item('tomato-a', { name: 'Tomato', quantity: '1', unit: '', sourceRecipeIDs: ['recipe-a'] }),
      item('tomato-b', { name: 'Tomatoes', quantity: '2', unit: '', sourceRecipeIDs: ['recipe-b'] }),
      ...Array.from({ length: 68 }, (_, index) => item(`eligible-${index}`, { name: `Fixture${index}` })),
    ]
    const checked = Array.from({ length: 33 }, (_, index) => item(`checked-${index}`, {
      name: index === 0 ? 'Tomato' : `Checked${index}`, isChecked: true,
      quantity: '7', sourceRecipeIDs: [`checked-recipe-${index}`], needThisTrip: true,
      shoppingNote: { keep: `checked metadata ${index}` },
    }))
    await seed([...unchecked, ...checked])
    const before = await persisted()
    const snapshot = await capture()
    expect(snapshot).toHaveLength(103)
    const batchSizes: number[] = []

    const plan = await requestGroceryCleanup(snapshot, async batch => {
      batchSizes.push(batch.length)
      expect(batch).toHaveLength(70)
      expect(batch.filter(value => value.name === 'Tomato')).toHaveLength(1)
      expect(batch.some(value => value.name.startsWith('Checked'))).toBe(false)
      api.generateAIArray.mockResolvedValueOnce([{
        originalIndex: batch.findIndex(value => value.name === 'Tomato'),
        name: 'tomato', quantity: '3', unit: '', category: 'Produce', action: 'merge',
        mergedWith: [batch.findIndex(value => value.name === 'Tomatoes')],
      }])
      const response = await POST(new NextRequest('http://localhost/api/grocery-cleanup', {
        method: 'POST',
        headers: { Authorization: 'Bearer synthetic-test-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: batch }),
      }))
      expect(response.status).toBe(200)
      return response.json()
    })
    expect(batchSizes).toEqual([70])
    expect(api.verifyAuthToken).toHaveBeenCalledOnce()
    expect(api.generateAIArray).toHaveBeenCalledOnce()
    expect(api.generateAIObject).not.toHaveBeenCalled()
    const invocation = api.generateAIArray.mock.calls[0][0]
    expect(invocation).toMatchObject({ feature: 'grocery-cleanup', userId: uid, maxRetries: 0 })
    const modelItems = (invocation.prompt as string).split('GROCERY ITEMS:\n')[1].split('\n\nTASKS:')[0].split('\n')
    expect(modelItems).toHaveLength(70)
    expect(modelItems.some(line => line.includes('Checked'))).toBe(false)
    expect(plan.items).toHaveLength(70)

    await applyGroceryCleanup(uid, plan)

    const after = await persisted()
    expect(after.size).toBe(102)
    for (const original of checked) expect(after.get(original.id)).toEqual(before.get(original.id))
    for (const original of unchecked.slice(2)) expect(after.get(original.id)).toEqual(before.get(original.id))
    expect(after.get('tomato-a')).toMatchObject({
      name: 'tomato', quantity: '3', unit: '', manualSection: 'Produce',
      sourceRecipeIDs: ['recipe-a', 'recipe-b'], isChecked: false, isManual: false,
    })
    expect(after.has('tomato-b')).toBe(false)
    expect(sdk.committedSizes).toEqual([2])
  })

  it('uses authoritative document IDs and the same legacy-category read projection for conflict checks', async () => {
    const original = { ...item('wrong-stored-id', { name: ' Tomatoes ', isManual: true }), manualSection: 'Staples' }
    await setDoc(ref('actual-document'), original)
    const items = await capture()
    expect(items[0].id).toBe('actual-document')
    expect(items[0].manualSection).toBe('Produce')

    await applyGroceryCleanup(uid, { items, changes: [normalize(items, 'actual-document')] })

    const saved = await persisted()
    expect(saved.size).toBe(1)
    expect(saved.get('actual-document')).toMatchObject({
      id: 'wrong-stored-id', name: 'tomatoes', manualSection: 'Produce', quantity: '1', unit: 'cup', isManual: true,
    })
    expect(saved.has('wrong-stored-id')).toBe(false)
  })

  it('atomically merges sources and trip flags while preserving checked, rejected, unrelated metadata and owner isolation', async () => {
    const metadata = { shoppingNote: { aisle: 4, tags: ['baking'] } }
    await seed([
      item('survivor', { ...metadata, name: 'Flour', sourceRecipeIDs: ['recipe-a'] }),
      item('peer', { ...metadata, sourceRecipeIDs: ['recipe-b', 'recipe-a'], needThisTrip: true }),
      item('checked', { name: 'flour', isChecked: true, needThisTrip: true }),
      item('rejected', { name: ' SUGAR ' }),
    ])
    const otherOwner = doc(databases[0], 'users', 'synthetic-other-owner', 'pantry', 'root', 'groceryItems', 'survivor')
    await setDoc(otherOwner, item('survivor', { quantity: '99' }))
    const before = await persisted()
    const items = (await capture()).filter(value => value.isChecked === false)
    const merge: GroceryCleanupChange = {
      ...normalize(items, 'survivor'), action: 'merge', quantity: '2',
      mergedWith: [items.findIndex(value => value.id === 'peer')],
    }
    await applyGroceryCleanup(uid, { items, changes: [merge, normalize(items, 'rejected')] }, new Set([1]))

    const saved = await persisted()
    expect(saved.get('survivor')).toMatchObject({
      ...metadata, name: 'flour', quantity: '2', unit: 'cup', isManual: false, isChecked: false,
      sourceRecipeIDs: ['recipe-a', 'recipe-b'], needThisTrip: true,
      createdAt: before.get('survivor')!.createdAt,
    })
    expect(saved.get('survivor')!.updatedAt).not.toEqual(before.get('survivor')!.updatedAt)
    expect(saved.has('peer')).toBe(false)
    expect(saved.get('checked')).toEqual(before.get('checked'))
    expect(saved.get('rejected')).toEqual(before.get('rejected'))
    expect((await getDocFromServer(otherOwner)).data()!.quantity).toBe('99')
    expect(sdk.committedSizes).toEqual([2])
  })

  it('persists the complete deduplicated source union from three contributors on the original survivor', async () => {
    const metadata = { shoppingNote: { aisle: 4, tags: ['baking'] } }
    await seed([
      item('a-survivor', { ...metadata, sourceRecipeIDs: ['recipe-a', 'recipe-a'] }),
      item('b-peer', { ...metadata, quantity: '2', sourceRecipeIDs: ['recipe-b', 'recipe-a'] }),
      item('c-peer', { ...metadata, quantity: '3', sourceRecipeIDs: ['recipe-c', 'recipe-b'], needThisTrip: true }),
    ])
    const before = await persisted()
    const plan = await requestGroceryCleanup(await capture(), async () => [])
    expect(plan.changes).toHaveLength(1)
    expect(plan.items[plan.changes[0].originalIndex].id).toBe('a-survivor')

    await applyGroceryCleanup(uid, plan)

    const saved = await persisted()
    expect([...saved.keys()]).toEqual(['a-survivor'])
    expect(saved.get('a-survivor')).toMatchObject({
      ...metadata, id: 'a-survivor', name: 'flour', quantity: '6', unit: 'cup',
      sourceRecipeIDs: ['recipe-a', 'recipe-b', 'recipe-c'],
      isManual: false, isChecked: false, needThisTrip: true,
      createdAt: before.get('a-survivor')!.createdAt,
    })
    expect((await capture())[0].sourceRecipeIDs).toEqual(['recipe-a', 'recipe-b', 'recipe-c'])
    expect(sdk.committedSizes).toEqual([3])
  })

  it.each(['absent', 'empty'] as const)(
    'retains recorded sources when a peer has an %s source array and during later normalization', async sourceState => {
      const peer = item('b-peer', { name: 'Flour', sourceRecipeIDs: [] })
      if (sourceState === 'absent') delete (peer as Partial<GroceryItem>).sourceRecipeIDs
      await seed([
        item('a-survivor', { name: 'Flour', sourceRecipeIDs: ['recipe-a', 'recipe-b'] }),
        peer,
      ])
      const snapshot = await capture()
      expect(Object.hasOwn(snapshot.find(value => value.id === 'b-peer')!, 'sourceRecipeIDs'))
        .toBe(sourceState !== 'absent')
      const plan = await requestGroceryCleanup(snapshot, async () => [])

      await applyGroceryCleanup(uid, plan)

      // Refresh the client cache before observing the subscription's first event.
      // A newly attached listener may otherwise deliver its older cached query.
      expect((await persisted()).size).toBe(1)
      const reloaded = await capture()
      expect(reloaded).toHaveLength(1)
      expect(reloaded[0]).toMatchObject({
        id: 'a-survivor', quantity: '2', unit: 'cup', sourceRecipeIDs: ['recipe-a', 'recipe-b'],
      })
      await applyGroceryCleanup(uid, {
        items: reloaded,
        changes: [normalize(reloaded, 'a-survivor')],
      })

      const saved = await persisted()
      expect(saved.size).toBe(1)
      expect(saved.get('a-survivor')).toMatchObject({
        id: 'a-survivor', name: 'flour', quantity: '2', unit: 'cup',
        sourceRecipeIDs: ['recipe-a', 'recipe-b'],
      })
      expect(sdk.committedSizes).toEqual([2, 1])
    },
  )

  it('retains prior and new sources across fresh cleanup after reload without doubling a subsequent no-op', async () => {
    await seed([
      item('a-survivor', { sourceRecipeIDs: ['recipe-a'] }),
      item('b-peer', { quantity: '2', sourceRecipeIDs: ['recipe-b', 'recipe-a'] }),
    ])
    const firstPlan = await requestGroceryCleanup(await capture(), async () => [])
    await applyGroceryCleanup(uid, firstPlan)
    expect((await persisted()).size).toBe(1)
    expect(await capture()).toMatchObject([{
      id: 'a-survivor', quantity: '3', sourceRecipeIDs: ['recipe-a', 'recipe-b'],
    }])

    await seed([item('c-peer', { quantity: '4', sourceRecipeIDs: ['recipe-c', 'recipe-b'] })])
    const secondPlan = await requestGroceryCleanup(await capture(), async () => [])
    await applyGroceryCleanup(uid, secondPlan)
    const beforeNoOp = await persisted()
    const secondReload = await capture()
    expect(secondReload).toMatchObject([{
      id: 'a-survivor', quantity: '7', unit: 'cup', sourceRecipeIDs: ['recipe-a', 'recipe-b', 'recipe-c'],
    }])
    expect(secondReload).toHaveLength(1)

    const noOpPlan = await requestGroceryCleanup(secondReload, async () => [])
    expect(noOpPlan.changes).toEqual([])
    await applyGroceryCleanup(uid, noOpPlan)

    expect(await persisted()).toEqual(beforeNoOp)
    expect(sdk.committedSizes).toEqual([2, 2])
  })

  it('persists and reloads every source from duplicates spanning three batches in a 250-item list', async () => {
    const duplicateIndices = [0, 1, 100, 200]
    const eligible = Array.from({ length: 250 }, (_, index) => item(`doc-${String(index).padStart(3, '0')}`, {
      name: duplicateIndices.includes(index) ? 'milk' : `Fixture${index}`,
      quantity: index === 0 ? '2' : '1',
      sourceRecipeIDs: index === 0 ? ['recipe-0'] : [`recipe-${index}`, 'recipe-0'],
      ...(index === 200 ? { needThisTrip: true } : {}),
    }))
    const checked = item('checked-milk', {
      name: 'milk', quantity: '99', isChecked: true, sourceRecipeIDs: ['checked-recipe'],
    })
    await seed([...eligible, checked])
    const before = await persisted()
    // Exercise request boundaries independently of the subscription's name sort.
    const snapshot = (await capture()).sort((left, right) => left.id.localeCompare(right.id))
    const batchSizes: number[] = []
    api.generateAIArray.mockResolvedValue([])
    const plan = await requestGroceryCleanup(snapshot, async batch => {
      batchSizes.push(batch.length)
      const response = await POST(new NextRequest('http://localhost/api/grocery-cleanup', {
        method: 'POST',
        headers: { Authorization: 'Bearer synthetic-test-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: batch }),
      }))
      expect(response.status).toBe(200)
      return response.json()
    })
    expect(batchSizes).toEqual([100, 100, 50])
    expect(api.generateAIArray).toHaveBeenCalledTimes(3)
    expect(plan.items).toHaveLength(250)
    expect(plan.changes).toEqual([expect.objectContaining({
      originalIndex: 0, mergedWith: [1, 100, 200], action: 'merge', quantity: '5', unit: 'cup',
    })])

    await applyGroceryCleanup(uid, plan)

    const saved = await persisted()
    expect(saved.size).toBe(248)
    expect(saved.get('doc-000')).toMatchObject({
      id: 'doc-000', name: 'milk', quantity: '5', unit: 'cup', isChecked: false, isManual: false,
      sourceRecipeIDs: ['recipe-0', 'recipe-1', 'recipe-100', 'recipe-200'], needThisTrip: true,
      createdAt: before.get('doc-000')!.createdAt,
    })
    for (const index of duplicateIndices.slice(1)) expect(saved.has(eligible[index].id)).toBe(false)
    for (const original of eligible.filter((_, index) => !duplicateIndices.includes(index))) {
      expect(saved.get(original.id)).toEqual(before.get(original.id))
    }
    expect(saved.get(checked.id)).toEqual(before.get(checked.id))
    const reloaded = await capture()
    expect(reloaded.find(value => value.id === 'doc-000')!.sourceRecipeIDs)
      .toEqual(['recipe-0', 'recipe-1', 'recipe-100', 'recipe-200'])
    expect(reloaded.find(value => value.id === checked.id)!.sourceRecipeIDs).toEqual(['checked-recipe'])
    expect(sdk.committedSizes).toEqual([4])
  }, 20_000)

  it.each(['checked', 'deleted', 'edited', 'timestamp', 'added'] as const)(
    'rejects a %s snapshot conflict before the first write, including an untouched item', async conflict => {
      await seed([item('target', { name: ' FLOUR ' }), item('untouched', { name: 'sugar' })])
      const items = await capture()
      if (conflict === 'checked') await updateDoc(ref('untouched', 1), { isChecked: true })
      if (conflict === 'deleted') await deleteDoc(ref('untouched', 1))
      if (conflict === 'edited') await updateDoc(ref('untouched', 1), { shoppingNote: 'newer metadata' })
      if (conflict === 'timestamp') await updateDoc(ref('untouched', 1), { updatedAt: new Timestamp(1_700_000_001, 457_000) })
      if (conflict === 'added') await setDoc(ref('new-item', 1), item('new-item', { name: 'milk' }))
      const before = await persisted()

      await expect(applyGroceryCleanup(uid, { items, changes: [normalize(items, 'target')] }))
        .rejects.toMatchObject({ code: 'grocery-cleanup-conflict', committedBatches: 0, committedWrites: 0 })
      expect(await persisted()).toEqual(before)
      expect(sdk.transactionCalls).toBe(0)
    },
  )

  it('rejects a newer checked state during an SDK transaction retry without overwriting it', async () => {
    await seed([item('target', { name: ' FLOUR ' })])
    const items = await capture()
    sdk.afterRead = async () => {
      sdk.afterRead = undefined
      await updateDoc(ref('target', 1), { isChecked: true, quantity: '8', updatedAt: new Timestamp(1_800_000_000, 1) })
    }

    await expect(applyGroceryCleanup(uid, { items, changes: [normalize(items, 'target')] }))
      .rejects.toMatchObject({ code: 'grocery-cleanup-conflict', committedBatches: 0, committedWrites: 0 })
    expect((await persisted()).get('target')).toMatchObject({ name: ' FLOUR ', quantity: '8', isChecked: true })
    expect(sdk.transactionAttempts).toBeGreaterThanOrEqual(2)
    expect(sdk.committedSizes).toEqual([])
  })

  it('packs whole merge groups into sequential transactions of at most 450 writes', async () => {
    const originals = Array.from({ length: 450 }, (_, index) => item(`item-${index}`, { name: ` PURCHASE ${index} ` }))
    await seed([...originals, item('merge-a'), item('merge-b')])
    const items = await capture()
    const changes = originals.slice(0, 449).map(original => normalize(items, original.id))
    changes.push({
      ...normalize(items, 'merge-a'), action: 'merge', quantity: '2',
      mergedWith: [items.findIndex(value => value.id === 'merge-b')],
    }, normalize(items, 'item-449'))

    await applyGroceryCleanup(uid, { items, changes })

    expect(sdk.committedSizes).toEqual([449, 3])
    const saved = await persisted()
    expect(saved.size).toBe(451)
    expect(saved.get('merge-a')!.quantity).toBe('2')
    expect(saved.has('merge-b')).toBe(false)
  }, 20_000)

  it('reports partial chunk failure accurately and refuses stale replay after an earlier chunk committed', async () => {
    const originals = Array.from({ length: 451 }, (_, index) => item(`item-${index}`, { name: ` PURCHASE ${index} ` }))
    await seed(originals)
    const items = await capture()
    const plan: GroceryCleanupPlan = { items, changes: originals.map(original => normalize(items, original.id)) }
    sdk.beforeTransaction = async call => {
      if (call === 2) throw new Error('private provider details must never appear')
    }

    const error = await applyGroceryCleanup(uid, plan).catch(value => value)
    expect(error).toBeInstanceOf(GroceryCleanupApplyError)
    expect(error).toMatchObject({ code: 'grocery-cleanup-save-failed', committedBatches: 1, committedWrites: 450 })
    expect(error.message).toContain('Some changes were saved')
    expect(error.message).not.toContain('private provider')
    const saved = await persisted()
    expect([...saved.values()].filter(value => value.name.startsWith('purchase'))).toHaveLength(450)
    expect(saved.get('item-450')!.name).toBe(' PURCHASE 450 ')
    expect(sdk.committedSizes).toEqual([450])

    sdk.beforeTransaction = undefined
    await expect(applyGroceryCleanup(uid, plan)).rejects.toMatchObject({
      code: 'grocery-cleanup-conflict', committedBatches: 0, committedWrites: 0,
    })
    expect(await persisted()).toEqual(saved)
  }, 20_000)
})
