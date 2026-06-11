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
  deleteDoc,
  query,
  where,
  orderBy,
  limit as qLimit,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import type { NutritionMacros } from '@/types/recipe'
import type { ConsumptionEntry, NutritionGoals, SavedFood, RecentFood, Meal } from '@/types/nutrition'
import { getWeekPlan, addRecipeToWeekPlan, markRecipeCooked, weekIDFromDate } from './userdata'

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

const ZERO_MACROS: NutritionMacros = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0 }

function dayBounds(d: Date): { start: Date; end: Date } {
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
  const ref = await addDoc(logPath(userId), {
    ...rest,
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

export async function saveGoals(userId: string, goals: NutritionMacros): Promise<void> {
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

/**
 * The single "mark as cooked" pathway used by BOTH Cooking Mode and the plan
 * page checkmark, so they act as one system:
 *  1. plan: if the recipe is on this week's plan → flag it cooked
 *     (cookedRecipeIDs union via markRecipeCooked); if not on the plan →
 *     add it to BOTH plannedRecipeIDs and cookedRecipeIDs (a recipe only in
 *     cookedRecipeIDs renders nowhere on the plan page).
 *  2. log: write ONE consumption_log entry with is_cook_event: true — unless
 *     a cook-event for this recipe already exists today (duplicate guard for
 *     the CookingMode-then-checkmark double-fire case).
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
  },
): Promise<CookEventResult> {
  const weekID = params.weekID || weekIDFromDate(new Date())

  // 1. plan update — reuse the exact existing write paths
  const plan = await getWeekPlan(userId, weekID)
  if (!plan || !(plan.plannedRecipeIDs || []).includes(params.recipeId)) {
    await addRecipeToWeekPlan(userId, weekID, params.recipeId)
  }
  await markRecipeCooked(userId, weekID, params.recipeId, true)

  // 2. consumption log with duplicate guard
  const existing = await getTodayCookEventForRecipe(userId, params.recipeId)
  if (existing) return { loggedEntryId: null, duplicate: true }

  const per = params.perServing ?? ZERO_MACROS
  const entryId = await addLogEntry(userId, {
    meal: autoMealForTime(),
    type: 'recipe',
    is_cook_event: true,
    recipe_id: params.recipeId,
    name: params.recipeName,
    servings_eaten: params.servingsEaten,
    nutrition: scaleMacros(per, params.servingsEaten),
    source: 'recipe',
  })
  return { loggedEntryId: entryId, duplicate: false }
}
