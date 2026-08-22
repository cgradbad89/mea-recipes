// Regression tests for M-03: five week-plan writers in lib/userdata.ts were
// converted from read-then-updateDoc to runTransaction (matching moveRecipeToWeek's
// existing shape) to close a race where two near-simultaneous writers on the same
// weekPlan doc could clobber each other's change. Each test fires two concurrent
// calls that would previously race on the same doc and asserts BOTH changes survive.
//
// Runs against the real Firestore emulator (this repo's existing local-dev tool —
// see package.json's `dev:emulator` script and the NEXT_PUBLIC_USE_FIRESTORE_EMULATOR
// switch in lib/firebase.ts) rather than mocks, so the test exercises Firestore's
// actual transaction/retry behavior, not a hand-rolled stand-in for it. The emulator
// is spawned and torn down by this file — `npm test` needs no manual setup, and the
// emulator has no rules file (per CLAUDE.md, this repo must never touch Firestore
// rules), so it runs in its default allow-all mode, same as `dev:emulator`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, ChildProcess } from 'node:child_process'

const EMULATOR_PORT = 8080
let emulator: ChildProcess

async function waitForEmulator(timeoutMs = 30_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${EMULATOR_PORT}`)
      if (res.status) return
    } catch {
      // not up yet
    }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('Firestore emulator did not become ready in time')
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_USE_FIRESTORE_EMULATOR = 'true'
  emulator = spawn(
    'firebase',
    ['emulators:start', '--only', 'firestore', '--project', 'malignant-metro'],
    { stdio: 'ignore' }
  )
  await waitForEmulator()
}, 45_000)

afterAll(() => {
  if (emulator) emulator.kill('SIGTERM')
})

// Each test uses a fresh, random uid/weekID so tests never interfere with each other
// even though they share one emulator instance.
function freshIDs() {
  const suffix = Math.random().toString(36).slice(2)
  return { uid: `test-uid-${suffix}`, weekID: `2026-W${suffix}` }
}

describe('week-plan writer transactions (concurrent-write races)', () => {
  it('addRecipeToWeekPlan: two concurrent adds to the same new week both land', async () => {
    const { addRecipeToWeekPlan } = await import('@/lib/userdata')
    const { getWeekPlan } = await import('@/lib/userdata')
    const { uid, weekID } = freshIDs()

    await Promise.all([
      addRecipeToWeekPlan(uid, weekID, 'recipe-a', 'main'),
      addRecipeToWeekPlan(uid, weekID, 'recipe-b', 'side'),
    ])

    const plan = await getWeekPlan(uid, weekID)
    const ids = (plan?.plannedRecipeIDs || []).map(el => (typeof el === 'string' ? el : el.recipeID))
    expect(ids.sort()).toEqual(['recipe-a', 'recipe-b'])
  })

  it('removeRecipeFromWeekPlan: two concurrent removals from the same week both apply', async () => {
    const { removeRecipeFromWeekPlan, getWeekPlan, weekPlansPath } = await import('@/lib/userdata')
    const { db } = await import('@/lib/firebase')
    const { doc, setDoc } = await import('firebase/firestore')
    const { uid, weekID } = freshIDs()

    await setDoc(doc(weekPlansPath(uid), weekID), {
      weekID,
      weekStartISO: weekID,
      plannedRecipeIDs: [
        { recipeID: 'recipe-a', day: null, role: 'main' },
        { recipeID: 'recipe-b', day: null, role: 'main' },
        { recipeID: 'recipe-c', day: null, role: 'side' },
      ],
      cookedRecipeIDs: [],
    })

    await Promise.all([
      removeRecipeFromWeekPlan(uid, weekID, 'recipe-a'),
      removeRecipeFromWeekPlan(uid, weekID, 'recipe-b'),
    ])

    const plan = await getWeekPlan(uid, weekID)
    const ids = (plan?.plannedRecipeIDs || []).map(el => (typeof el === 'string' ? el : el.recipeID))
    expect(ids).toEqual(['recipe-c'])
  })

  it('markRecipeCooked: two concurrent cooked-marks on the same week both land', async () => {
    const { markRecipeCooked, getWeekPlan, weekPlansPath } = await import('@/lib/userdata')
    const { doc, setDoc } = await import('firebase/firestore')
    const { uid, weekID } = freshIDs()

    await setDoc(doc(weekPlansPath(uid), weekID), {
      weekID,
      weekStartISO: weekID,
      plannedRecipeIDs: [
        { recipeID: 'recipe-a', day: null, role: 'main' },
        { recipeID: 'recipe-b', day: null, role: 'main' },
      ],
      cookedRecipeIDs: [],
    })

    await Promise.all([
      markRecipeCooked(uid, weekID, 'recipe-a', true),
      markRecipeCooked(uid, weekID, 'recipe-b', true),
    ])

    const plan = await getWeekPlan(uid, weekID)
    expect((plan?.cookedRecipeIDs || []).sort()).toEqual(['recipe-a', 'recipe-b'])
  })

  it('assignRecipeToDay: two concurrent day-assignments on the same week both land', async () => {
    const { assignRecipeToDay, getWeekPlan, weekPlansPath } = await import('@/lib/userdata')
    const { doc, setDoc } = await import('firebase/firestore')
    const { uid, weekID } = freshIDs()

    await setDoc(doc(weekPlansPath(uid), weekID), {
      weekID,
      weekStartISO: weekID,
      plannedRecipeIDs: [
        { recipeID: 'recipe-a', day: null, role: 'main' },
        { recipeID: 'recipe-b', day: null, role: 'main' },
      ],
      cookedRecipeIDs: [],
    })

    await Promise.all([
      assignRecipeToDay(uid, weekID, 'recipe-a', '2026-08-24'),
      assignRecipeToDay(uid, weekID, 'recipe-b', '2026-08-25'),
    ])

    const plan = await getWeekPlan(uid, weekID)
    const byID = new Map(
      (plan?.plannedRecipeIDs || []).map(el => (typeof el === 'string' ? [el, null] : [el.recipeID, el.day]))
    )
    expect(byID.get('recipe-a')).toBe('2026-08-24')
    expect(byID.get('recipe-b')).toBe('2026-08-25')
  })

  it('setPlannedRecipeRole: two concurrent role-changes on the same week both land', async () => {
    const { setPlannedRecipeRole, getWeekPlan, weekPlansPath } = await import('@/lib/userdata')
    const { doc, setDoc } = await import('firebase/firestore')
    const { uid, weekID } = freshIDs()

    await setDoc(doc(weekPlansPath(uid), weekID), {
      weekID,
      weekStartISO: weekID,
      plannedRecipeIDs: [
        { recipeID: 'recipe-a', day: null, role: 'main' },
        { recipeID: 'recipe-b', day: null, role: 'main' },
      ],
      cookedRecipeIDs: [],
    })

    await Promise.all([
      setPlannedRecipeRole(uid, weekID, 'recipe-a', 'side'),
      setPlannedRecipeRole(uid, weekID, 'recipe-b', 'side'),
    ])

    const plan = await getWeekPlan(uid, weekID)
    const byID = new Map(
      (plan?.plannedRecipeIDs || []).map(el => (typeof el === 'string' ? [el, 'main'] : [el.recipeID, el.role]))
    )
    expect(byID.get('recipe-a')).toBe('side')
    expect(byID.get('recipe-b')).toBe('side')
  })
})
