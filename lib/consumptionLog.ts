// Consumption log + goals + saved foods data layer (Surfaces 2-4).
// Paths follow the existing users/{uid}/{area}/root/* convention from
// lib/userdata.ts:
//   users/{uid}/nutrition/root/log/{entryId}
//   users/{uid}/nutrition/root/goals/daily
//   users/{uid}/nutrition/root/savedFoods/{foodId}
//
// Index note: log queries range-filter and order on the SAME field (`date`)
// then sort by created_at client-side — combos like where(recipe_id)+range(date)
// would need a composite index, which this repo deliberately doesn't manage.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit as qLimit,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import type { NutritionMacros } from '@/types/recipe'
import type { ConsumptionEntry, NutritionGoals, SavedFood, RecentFood, Meal } from '@/types/nutrition'
import { servingsAmountLabel } from './nutrition'
import {
  weekPlansPath,
  weekIDFromDate,
  plannedRecipeIDList,
  type WeekPlan,
  type PlannedRole,
} from './userdata'

export function logPath(uid: string) {
  return collection(db, 'users', uid, 'nutrition', 'root', 'log')
}

function goalsDocRef(uid: string) {
  return doc(db, 'users', uid, 'nutrition', 'root', 'goals', 'daily')
}

export function savedFoodsPath(uid: string) {
  return collection(db, 'users', uid, 'nutrition', 'root', 'savedFoods')
}

// ─── Small shared helpers ────────────────────────────────────────────────────

/** Meal auto-assignment by time of day: breakfast <11am, lunch <3pm, snack <6pm, dinner otherwise. */
export function autoMealForTime(date: Date = new Date()): Meal {
  const h = date.getHours()
  if (h < 11) return 'breakfast'
  if (h < 15) return 'lunch'
  if (h < 18) return 'snack'
  return 'dinner'
}

/** Entry snapshot = per-serving × servings_eaten, rounded for display stability. */
export function scaleMacros(perServing: NutritionMacros, servings: number): NutritionMacros {
  const r1 = (n: number) => Math.round(n * 10) / 10
  return {
    calories: Math.round(perServing.calories * servings),
    protein_g: r1(perServing.protein_g * servings),
    carbs_g: r1(perServing.carbs_g * servings),
    fat_g: r1(perServing.fat_g * servings),
    fiber_g: r1(perServing.fiber_g * servings),
    sugar_g: r1(perServing.sugar_g * servings),
  }
}

export function dayBounds(d: Date): { start: Date; end: Date } {
  const start = new Date(d); start.setHours(0, 0, 0, 0)
  const end = new Date(d); end.setHours(23, 59, 59, 999)
  return { start, end }
}

function snapToEntry(id: string, data: Record<string, unknown>): ConsumptionEntry {
  return { id, ...(data as Omit<ConsumptionEntry, 'id'>) }
}

function createdAtMillis(e: ConsumptionEntry): number {
  const c = e.created_at as { toMillis?: () => number } | undefined
  return c?.toMillis ? c.toMillis() : 0
}

// ─── Log entries ─────────────────────────────────────────────────────────────

export type NewLogEntry = Omit<ConsumptionEntry, 'id' | 'created_at' | 'userId' | 'date'> & {
  date?: Date   // defaults to now
}

export async function addLogEntry(userId: string, entry: NewLogEntry): Promise<string> {
  const { date, ...rest } = entry
  // Drop undefined fields — Firestore rejects them, and amount_label is optional
  // (cook events and older callers don't set it).
  const clean = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined))
  const ref = await addDoc(logPath(userId), {
    ...clean,
    recipe_id: rest.recipe_id ?? null,
    date: Timestamp.fromDate(date ?? new Date()),
    created_at: serverTimestamp(),
    userId,
  })
  return ref.id
}

export async function getTodayEntries(userId: string): Promise<ConsumptionEntry[]> {
  const { start, end } = dayBounds(new Date())
  return getEntriesForRange(userId, start, end)
}

export async function getEntriesForRange(userId: string, start: Date, end: Date): Promise<ConsumptionEntry[]> {
  const q = query(
    logPath(userId),
    where('date', '>=', Timestamp.fromDate(start)),
    where('date', '<=', Timestamp.fromDate(end)),
    orderBy('date', 'asc'),
  )
  const snap = await getDocs(q)
  const entries = snap.docs.map(d => snapToEntry(d.id, d.data()))
  entries.sort((a, b) => createdAtMillis(a) - createdAtMillis(b))
  return entries
}

export async function deleteLogEntry(userId: string, entryId: string): Promise<void> {
  await deleteDoc(doc(logPath(userId), entryId))
}

/**
 * Correct an entry's servings count and recompute its nutrition snapshot.
 * The stored snapshot is per-serving × servings_eaten, so we recover the
 * per-serving basis (snapshot ÷ old servings) and re-scale to the new count.
 * Editing servings never re-references the source recipe — it stays a snapshot.
 */
export async function updateLogEntryServings(
  userId: string,
  entry: ConsumptionEntry,
  newServings: number,
): Promise<NutritionMacros> {
  const old = entry.servings_eaten > 0 ? entry.servings_eaten : 1
  const perServing = scaleMacros(entry.nutrition, 1 / old)
  const nutrition = scaleMacros(perServing, newServings)
  await updateDoc(doc(logPath(userId), entry.id), {
    servings_eaten: newServings,
    // The Today editor is servings-based, so re-derive the amount label to match
    // (a grams-logged entry edited here becomes a servings amount).
    amount_label: servingsAmountLabel(newServings),
    nutrition,
  })
  return nutrition
}

/** Today's cook-event entry for a recipe, if one exists (duplicate prevention). */
export async function getTodayCookEventForRecipe(userId: string, recipeId: string): Promise<ConsumptionEntry | null> {
  const entries = await getTodayEntries(userId)
  return entries.find(e => e.is_cook_event && e.recipe_id === recipeId) || null
}

// ─── Goals ───────────────────────────────────────────────────────────────────

export async function getGoals(userId: string): Promise<NutritionGoals | null> {
  const snap = await getDoc(goalsDocRef(userId))
  if (!snap.exists()) return null
  return snap.data() as NutritionGoals
}

export async function saveGoals(
  userId: string,
  goals: NutritionMacros & Pick<NutritionGoals, 'calorie_baseline'>,
): Promise<void> {
  await setDoc(goalsDocRef(userId), { ...goals, updated_at: serverTimestamp() }, { merge: true })
}

// ─── Saved foods (favorites) ─────────────────────────────────────────────────

function sanitizeFoodId(name: string): string {
  return name.toLowerCase().trim().replace(/[/\\]/g, '-').replace(/[^a-z0-9-_]/g, '-').substring(0, 80)
}

export async function getSavedFoods(userId: string): Promise<SavedFood[]> {
  const snap = await getDocs(savedFoodsPath(userId))
  return snap.docs
    .map(d => ({ ...(d.data() as Omit<SavedFood, 'id'>), id: d.id }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function saveFavorite(userId: string, food: Omit<SavedFood, 'id' | 'created_at'>): Promise<string> {
  const id = sanitizeFoodId(food.name)
  await setDoc(doc(savedFoodsPath(userId), id), {
    ...food,
    id,
    created_at: serverTimestamp(),
  }, { merge: true })
  return id
}

export async function deleteFavorite(userId: string, foodId: string): Promise<void> {
  await deleteDoc(doc(savedFoodsPath(userId), foodId))
}

// ─── Recents ─────────────────────────────────────────────────────────────────

/** Most recent distinct foods from the log (per-serving basis for re-logging). */
export async function getRecents(userId: string, count = 5): Promise<RecentFood[]> {
  const q = query(logPath(userId), orderBy('created_at', 'desc'), qLimit(40))
  const snap = await getDocs(q)
  const seen = new Set<string>()
  const out: RecentFood[] = []
  for (const d of snap.docs) {
    const e = snapToEntry(d.id, d.data())
    const key = e.name.toLowerCase().trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    const servings = e.servings_eaten > 0 ? e.servings_eaten : 1
    out.push({
      name: e.name,
      nutrition: scaleMacros(e.nutrition, 1 / servings),
      source: e.source,
      ...(e.ai_provenance ? { ai_provenance: e.ai_provenance } : {}),
      type: e.type,
      recipe_id: e.recipe_id ?? null,
    })
    if (out.length >= count) break
  }
  return out
}

// ─── Cook-event capture (Surface 2 core) ─────────────────────────────────────

export interface CookEventResult {
  loggedEntryId: string | null   // null when deduped (already logged today)
  duplicate: boolean
}

export class CookEventNutritionError extends Error {
  readonly code = 'cook-event-nutrition-unavailable'

  constructor() {
    super('Nutrition is not available for this recipe yet. Calculate nutrition, or use “Just mark cooked” without a nutrition log.')
    this.name = 'CookEventNutritionError'
  }
}

function localDateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Stable identity for one recipe's logical cook action on one local calendar day. */
export function cookEventDocumentId(recipeId: string, occurredAt: Date): string {
  const safeRecipeId = recipeId
    .trim()
    .replace(/[/\\]/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 200)
  if (!safeRecipeId) throw new Error('A recipe ID is required to log a cook event.')
  return `cook-${localDateKey(occurredAt)}-${safeRecipeId}`
}

/**
 * The single "mark as cooked" pathway used by BOTH Cooking Mode and the plan
 * page checkmark. It transactionally updates plan membership/cooked state and
 * creates one deterministic nutrition snapshot for recipe + local date. Both
 * persisted identity and a read of legacy same-day cook logs prevent duplicate
 * capture during retries or the CookingMode-then-checkmark sequence.
 *
 * Leftover/quick logging must NOT call this — it never touches the plan.
 */
export async function logCookEvent(
  userId: string,
  params: {
    recipeId: string
    recipeName: string
    perServing: NutritionMacros | null   // recipe.nutrition per-serving values, if present
    servingsEaten: number
    weekID?: string                       // defaults to the current week
    role?: PlannedRole                    // existing caller context; no recipe fetch required
    occurredAt?: Date                     // testable/local-day idempotency boundary; defaults now
  },
): Promise<CookEventResult> {
  if (!Number.isFinite(params.servingsEaten) || params.servingsEaten <= 0) {
    throw new Error('Servings eaten must be greater than zero.')
  }
  const occurredAt = params.occurredAt || new Date()
  const weekID = params.weekID || weekIDFromDate(occurredAt)
  const entryId = cookEventDocumentId(params.recipeId, occurredAt)
  const perServing = params.perServing
  const planRef = doc(weekPlansPath(userId), weekID)
  const logRef = doc(logPath(userId), entryId)
  const occurrenceBounds = dayBounds(occurredAt)
  const existingLegacyEvent = (await getEntriesForRange(
    userId,
    occurrenceBounds.start,
    occurrenceBounds.end,
  )).find(entry => entry.is_cook_event && entry.recipe_id === params.recipeId)
  const legacyLogRef = existingLegacyEvent && existingLegacyEvent.id !== entryId
    ? doc(logPath(userId), existingLegacyEvent.id)
    : null

  const duplicate = await runTransaction(db, async transaction => {
    const [planSnapshot, logSnapshot, legacyLogSnapshot] = await Promise.all([
      transaction.get(planRef),
      transaction.get(logRef),
      legacyLogRef ? transaction.get(legacyLogRef) : Promise.resolve(null),
    ])
    const existingPlan = planSnapshot.exists() ? planSnapshot.data() as WeekPlan : null
    const planned = existingPlan?.plannedRecipeIDs || []
    const cooked = existingPlan?.cookedRecipeIDs || []
    const alreadyPlanned = plannedRecipeIDList(planned).includes(params.recipeId)
    const alreadyCooked = cooked.includes(params.recipeId)

    const cookLogExists = logSnapshot.exists() || legacyLogSnapshot?.exists() === true
    if (!cookLogExists && !perServing) throw new CookEventNutritionError()

    if (!existingPlan) {
      transaction.set(planRef, {
        weekID,
        weekStartISO: weekID,
        plannedRecipeIDs: [{ recipeID: params.recipeId, day: null, role: params.role || 'main' }],
        cookedRecipeIDs: [params.recipeId],
        updatedAt: serverTimestamp(),
      })
    } else if (!alreadyPlanned || !alreadyCooked) {
      transaction.update(planRef, {
        plannedRecipeIDs: alreadyPlanned
          ? planned
          : [...planned, { recipeID: params.recipeId, day: null, role: params.role || 'main' }],
        cookedRecipeIDs: alreadyCooked ? cooked : [...cooked, params.recipeId],
        updatedAt: serverTimestamp(),
      })
    }

    if (cookLogExists) return true

    transaction.set(logRef, {
      meal: autoMealForTime(occurredAt),
      type: 'recipe',
      is_cook_event: true,
      cook_event_key: entryId,
      cook_event_week_id: weekID,
      recipe_id: params.recipeId,
      name: params.recipeName,
      servings_eaten: params.servingsEaten,
      nutrition: scaleMacros(perServing!, params.servingsEaten),
      source: 'recipe',
      date: Timestamp.fromDate(occurredAt),
      created_at: serverTimestamp(),
      userId,
    })
    return false
  })

  return { loggedEntryId: duplicate ? null : entryId, duplicate }
}

/** Atomically unmark a planned recipe and remove its associated cook logs. */
export async function undoCookEvent(
  userId: string,
  params: { recipeId: string; weekID: string; occurredAt?: Date },
): Promise<{ removedLogCount: number }> {
  const occurredAt = params.occurredAt || new Date()
  const today = dayBounds(occurredAt)
  const weekStart = new Date(`${params.weekID}T00:00:00`)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 7)
  weekEnd.setMilliseconds(weekEnd.getMilliseconds() - 1)
  const todayInsideWeek = occurredAt >= weekStart && occurredAt <= weekEnd
  const ranges = todayInsideWeek
    ? [{ start: weekStart, end: weekEnd }]
    : [{ start: today.start, end: today.end }, { start: weekStart, end: weekEnd }]
  const rangeEntries = await Promise.all(ranges.map(range =>
    getEntriesForRange(userId, range.start, range.end)))
  const matchingIDs = new Set(
    rangeEntries.flat()
      .filter(entry => entry.is_cook_event && entry.recipe_id === params.recipeId)
      .map(entry => entry.id),
  )
  matchingIDs.add(cookEventDocumentId(params.recipeId, occurredAt))

  const planRef = doc(weekPlansPath(userId), params.weekID)
  const logRefs = [...matchingIDs].map(id => doc(logPath(userId), id))
  return runTransaction(db, async transaction => {
    const [planSnapshot, ...logSnapshots] = await Promise.all([
      transaction.get(planRef),
      ...logRefs.map(ref => transaction.get(ref)),
    ])
    if (planSnapshot.exists()) {
      const plan = planSnapshot.data() as WeekPlan
      transaction.update(planRef, {
        cookedRecipeIDs: (plan.cookedRecipeIDs || []).filter(id => id !== params.recipeId),
        updatedAt: serverTimestamp(),
      })
    }
    let removedLogCount = 0
    logSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists()) return
      transaction.delete(logRefs[index])
      removedLogCount++
    })
    return { removedLogCount }
  })
}
