import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  updateDoc,
  query,
  orderBy,
  serverTimestamp,
  DocumentData,
  onSnapshot,
  Unsubscribe,
  writeBatch,
  deleteField,
  runTransaction } from 'firebase/firestore'
import { db } from './firebase'
import type { Recipe } from '@/types/recipe'
import type { GroceryCategory } from './groceryCategories'
import { parseIngredient, normalizeNoun, mergeQuantities } from './ingredientParser'

// ─── Favorites ────────────────────────────────────────────────────────────────
// users/{uid}/recipes/root/favorites/{recipeID}

export function favoritesPath(uid: string) {
  return collection(db, 'users', uid, 'recipes', 'root', 'favorites')
}

export async function getFavoriteIDs(uid: string): Promise<Set<string>> {
  const snap = await getDocs(favoritesPath(uid))
  return new Set(snap.docs.map(d => d.id))
}

export function subscribeFavorites(uid: string, cb: (ids: Set<string>) => void): Unsubscribe {
  return onSnapshot(favoritesPath(uid), snap => {
    cb(new Set(snap.docs.map(d => d.id)))
  })
}

export async function addFavorite(uid: string, recipeID: string): Promise<void> {
  await setDoc(doc(favoritesPath(uid), recipeID), { updatedAt: serverTimestamp() })
}

export async function removeFavorite(uid: string, recipeID: string): Promise<void> {
  await deleteDoc(doc(favoritesPath(uid), recipeID))
}

// ─── Recipe Meta (notes + ratings) ───────────────────────────────────────────
// users/{uid}/recipes/root/meta/{recipeID}

export interface RecipeMeta {
  recipeID?: string
  note?: string
  rating?: number
  updatedAt?: unknown
  overrides?: {
    title?: string
    cuisine?: string
    category?: string
    content?: string
    imageURL?: string
    prepTime?: string
    cookTime?: string
    // Per-user servings override (Batch 3). When set, this user's per-serving
    // macros derive from shared nutrition.total ÷ servings; the shared
    // recipe.servings / nutrition.total are never mutated. Absent → shared default.
    servings?: number
  }
}

export function metaPath(uid: string) {
  return collection(db, 'users', uid, 'recipes', 'root', 'meta')
}

function sanitizeMetaID(recipeID: string): string {
  return recipeID.replace(/\//g, '_').replace(/\s+/g, '-')
}

export async function getRecipeMeta(uid: string, recipeID: string): Promise<RecipeMeta | null> {
  const snap = await getDoc(doc(metaPath(uid), sanitizeMetaID(recipeID)))
  if (!snap.exists()) return null
  return snap.data() as RecipeMeta
}

export async function saveRecipeMeta(uid: string, recipeID: string, meta: Partial<RecipeMeta>): Promise<void> {
  const data: any = { ...meta, recipeID, updatedAt: serverTimestamp() }
  if (data.overrides === undefined || data.overrides === null) {
    data.overrides = deleteField()
  }
  await setDoc(doc(metaPath(uid), sanitizeMetaID(recipeID)), data, { merge: true })
}

/**
 * Set or clear THIS user's personal servings override for a recipe
 * (`meta.overrides.servings`). Pass null to clear it and fall back to the
 * recipe's shared default. A deep-merge write that touches ONLY `overrides.servings`
 * — other overrides (title/content/image…) and the shared recipe doc are untouched.
 */
export async function setServingsOverride(uid: string, recipeID: string, servings: number | null): Promise<void> {
  await setDoc(
    doc(metaPath(uid), sanitizeMetaID(recipeID)),
    {
      recipeID,
      overrides: { servings: servings == null ? deleteField() : servings },
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

// ─── Week Plans ───────────────────────────────────────────────────────────────
// users/{uid}/pantry/root/weekPlans/{weekID}

export type PlannedRole = 'main' | 'side'

/**
 * One planned recipe within a week (Batch 5). `day` is an ISO date (YYYY-MM-DD)
 * inside that week, or null = "Unscheduled". `role` is main/side — auto-defaulted
 * from the recipe's category on add, user-overridable per entry. `slot` is RESERVED
 * for a future meal-slot dimension (dinners-only today); it is never written now,
 * but lives in the type so adding slots later needs no second migration.
 */
export interface PlannedEntry {
  recipeID: string
  day: string | null
  role: PlannedRole
  slot?: string | null
}

/**
 * On disk a planned element is EITHER a legacy bare recipeID string (pre-Batch-5
 * docs) OR a PlannedEntry object. Always normalize on read; writers upgrade any
 * entry they touch to the object form — a lossless read-time migration, no bulk wipe.
 */
export type PlannedElement = string | PlannedEntry

// Recipe category → default role. Only "Breakfast, Snacks & Sides" defaults to a
// side; mains and the ambiguous Salads/Soups categories default to 'main' (a
// missing side is less wrong than a missing main — the user can demote per entry).
// Unknown/empty category → 'main'. Category values mirror types/recipe.ts `Category`.
const CATEGORY_ROLE: Record<string, PlannedRole> = {
  'Chicken & Poultry': 'main',
  'Beef & Pork': 'main',
  'Seafood': 'main',
  'Vegetarian Mains': 'main',
  'Pasta, Noodles & Rice': 'main',
  'Salads & Bowls': 'main',
  'Soups, Stews & Chili': 'main',
  'Breakfast, Snacks & Sides': 'side',
}

export function deriveRoleFromCategory(category?: string | null): PlannedRole {
  return (category && CATEGORY_ROLE[category]) || 'main'
}

function isPlannedRole(v: unknown): v is PlannedRole {
  return v === 'main' || v === 'side'
}

function elementRecipeID(el: PlannedElement): string {
  return typeof el === 'string' ? el : el.recipeID
}

/**
 * Read-time adapter. Normalize one planned element (legacy string OR object) into a
 * full PlannedEntry. Legacy strings → { recipeID, day: null, role } i.e. Unscheduled
 * with a role derived from the recipe's category (via `resolveCategory` when
 * supplied, else 'main'). Never wipes, never guesses a day — lossless.
 */
export function normalizePlannedEntry(
  el: PlannedElement,
  resolveCategory?: (recipeID: string) => string | null | undefined,
): PlannedEntry {
  if (typeof el === 'string') {
    return { recipeID: el, day: null, role: deriveRoleFromCategory(resolveCategory?.(el)) }
  }
  const entry: PlannedEntry = {
    recipeID: el.recipeID,
    day: el.day ?? null,
    role: isPlannedRole(el.role) ? el.role : deriveRoleFromCategory(resolveCategory?.(el.recipeID)),
  }
  if (el.slot !== undefined) entry.slot = el.slot
  return entry
}

export function normalizePlanned(
  planned: PlannedElement[] | undefined,
  resolveCategory?: (recipeID: string) => string | null | undefined,
): PlannedEntry[] {
  return (planned || []).map(el => normalizePlannedEntry(el, resolveCategory))
}

/** Recipe IDs from a planned array (legacy or new), order-preserving. */
export function plannedRecipeIDList(planned: PlannedElement[] | undefined): string[] {
  return (planned || []).map(elementRecipeID)
}

export interface WeekPlan {
  weekID: string
  weekStartISO: string
  plannedRecipeIDs: PlannedElement[]
  cookedRecipeIDs: string[]
  updatedAt?: unknown
}

export function weekPlansPath(uid: string) {
  return collection(db, 'users', uid, 'pantry', 'root', 'weekPlans')
}

export function weekIDFromDate(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday
  d.setDate(diff)
  return d.toISOString().split('T')[0]
}

export async function getWeekPlan(uid: string, weekID: string): Promise<WeekPlan | null> {
  const snap = await getDoc(doc(weekPlansPath(uid), weekID))
  if (!snap.exists()) return null
  return snap.data() as WeekPlan
}

export function subscribeWeekPlan(uid: string, weekID: string, cb: (plan: WeekPlan | null) => void): Unsubscribe {
  return onSnapshot(doc(weekPlansPath(uid), weekID), snap => {
    cb(snap.exists() ? (snap.data() as WeekPlan) : null)
  })
}

export async function getAllWeekPlans(uid: string): Promise<WeekPlan[]> {
  const snap = await getDocs(weekPlansPath(uid))
  return snap.docs.map(d => d.data() as WeekPlan).sort((a, b) => b.weekID.localeCompare(a.weekID))
}

// Elements are objects now, so arrayUnion/arrayRemove no longer work on planned[]
// (they compare by deep value). Every planned writer is read-modify-write and
// leaves untouched elements EXACTLY as stored (legacy strings stay strings until
// the user acts on that specific recipe) — maximally lossless, no role/day churn.
export async function addRecipeToWeekPlan(
  uid: string,
  weekID: string,
  recipeID: string,
  role: PlannedRole = 'main',
): Promise<void> {
  const ref = doc(weekPlansPath(uid), weekID)
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    await setDoc(ref, {
      weekID,
      weekStartISO: weekID,
      plannedRecipeIDs: [{ recipeID, day: null, role }],
      cookedRecipeIDs: [],
      updatedAt: serverTimestamp(),
    })
    return
  }
  const plan = snap.data() as WeekPlan
  const planned = plan.plannedRecipeIDs || []
  // Idempotent (replaces arrayUnion's dedupe): if already planned in any shape,
  // leave it untouched so an existing day/role is preserved.
  if (planned.some(el => elementRecipeID(el) === recipeID)) return
  await updateDoc(ref, {
    plannedRecipeIDs: [...planned, { recipeID, day: null, role }],
    updatedAt: serverTimestamp(),
  })
}

export async function removeRecipeFromWeekPlan(uid: string, weekID: string, recipeID: string): Promise<void> {
  const ref = doc(weekPlansPath(uid), weekID)
  const snap = await getDoc(ref)
  if (!snap.exists()) return
  const plan = snap.data() as WeekPlan
  const planned = (plan.plannedRecipeIDs || []).filter(el => elementRecipeID(el) !== recipeID)
  await updateDoc(ref, { plannedRecipeIDs: planned, updatedAt: serverTimestamp() })
}

export async function moveRecipeToWeek(
  uid: string,
  fromWeekID: string,
  toWeekID: string,
  recipeID: string,
  fallbackRole: PlannedRole = 'main',
): Promise<void> {
  const fromRef = doc(weekPlansPath(uid), fromWeekID)
  const toRef = doc(weekPlansPath(uid), toWeekID)
  await runTransaction(db, async tx => {
    const fromSnap = await tx.get(fromRef)
    const toSnap = await tx.get(toRef)
    // Carry the entry's role across; the day resets to null — the target week has
    // different dates, so an old ISO day is meaningless there (lands Unscheduled).
    let role: PlannedRole = fallbackRole
    let fromPlanned: PlannedElement[] = []
    if (fromSnap.exists()) {
      fromPlanned = (fromSnap.data() as WeekPlan).plannedRecipeIDs || []
      const moving = fromPlanned.find(el => elementRecipeID(el) === recipeID)
      if (moving && typeof moving !== 'string' && isPlannedRole(moving.role)) role = moving.role
    }
    const remaining = fromPlanned.filter(el => elementRecipeID(el) !== recipeID)
    tx.update(fromRef, { plannedRecipeIDs: remaining, updatedAt: serverTimestamp() })

    const moved: PlannedEntry = { recipeID, day: null, role }
    if (!toSnap.exists()) {
      tx.set(toRef, { weekID: toWeekID, weekStartISO: toWeekID, plannedRecipeIDs: [moved], cookedRecipeIDs: [], updatedAt: serverTimestamp() })
    } else {
      const toPlanned = (toSnap.data() as WeekPlan).plannedRecipeIDs || []
      const next = toPlanned.some(el => elementRecipeID(el) === recipeID) ? toPlanned : [...toPlanned, moved]
      tx.update(toRef, { plannedRecipeIDs: next, updatedAt: serverTimestamp() })
    }
  })
}

export async function markRecipeCooked(uid: string, weekID: string, recipeID: string, cooked: boolean): Promise<void> {
  const ref = doc(weekPlansPath(uid), weekID)
  const snap = await getDoc(ref)
  if (!snap.exists()) return
  const plan = snap.data() as WeekPlan
  const cookedIDs = cooked
    ? [...new Set([...(plan.cookedRecipeIDs || []), recipeID])]
    : (plan.cookedRecipeIDs || []).filter(id => id !== recipeID)
  // Only cooked[] changes; planned[] is left exactly as stored (cooked items need
  // neither day nor role, and we avoid churning the planned array's element shapes).
  await updateDoc(ref, { cookedRecipeIDs: cookedIDs, updatedAt: serverTimestamp() })
}

/**
 * Set or clear a planned entry's `day` (null = Unscheduled). Preserves the entry's
 * role and upgrades a legacy string entry to the object shape; `fallbackRole` is
 * used only when upgrading a legacy string (whose role can't be derived here). If
 * the recipe isn't in the plan yet it is appended on that day.
 */
export async function assignRecipeToDay(
  uid: string,
  weekID: string,
  recipeID: string,
  day: string | null,
  fallbackRole: PlannedRole = 'main',
): Promise<void> {
  const ref = doc(weekPlansPath(uid), weekID)
  const snap = await getDoc(ref)
  if (!snap.exists()) return
  const plan = snap.data() as WeekPlan
  const planned = plan.plannedRecipeIDs || []
  let found = false
  const next: PlannedElement[] = planned.map(el => {
    if (elementRecipeID(el) !== recipeID) return el
    found = true
    const role = typeof el !== 'string' && isPlannedRole(el.role) ? el.role : fallbackRole
    const entry: PlannedEntry = { recipeID, day, role }
    if (typeof el !== 'string' && el.slot !== undefined) entry.slot = el.slot
    return entry
  })
  if (!found) next.push({ recipeID, day, role: fallbackRole })
  await updateDoc(ref, { plannedRecipeIDs: next, updatedAt: serverTimestamp() })
}

/**
 * Manual main/side override for a planned entry. Persisted ON the entry, so the
 * read-time role derivation never clobbers a user's choice. Preserves the entry's
 * day; upgrades a legacy string entry to the object shape.
 */
export async function setPlannedRecipeRole(
  uid: string,
  weekID: string,
  recipeID: string,
  role: PlannedRole,
): Promise<void> {
  const ref = doc(weekPlansPath(uid), weekID)
  const snap = await getDoc(ref)
  if (!snap.exists()) return
  const plan = snap.data() as WeekPlan
  const planned = plan.plannedRecipeIDs || []
  const next: PlannedElement[] = planned.map(el => {
    if (elementRecipeID(el) !== recipeID) return el
    const day = typeof el === 'string' ? null : (el.day ?? null)
    const entry: PlannedEntry = { recipeID, day, role }
    if (typeof el !== 'string' && el.slot !== undefined) entry.slot = el.slot
    return entry
  })
  await updateDoc(ref, { plannedRecipeIDs: next, updatedAt: serverTimestamp() })
}

// ─── Shared Week Plans ───────────────────────────────────────────────────────
// sharedWeekPlans/{weekID}/users/{uid}

export interface SharedPlanEntry {
  uid: string
  displayName: string
  photoURL: string
  plannedRecipeIDs: string[]
  updatedAt?: unknown
}

export async function publishSharedPlan(
  uid: string,
  displayName: string,
  photoURL: string,
  weekID: string,
  plannedRecipeIDs: PlannedElement[]
): Promise<void> {
  await setDoc(
    doc(db, 'sharedWeekPlans', weekID, 'users', uid),
    // The shared mirror stays a flat string[] of recipe IDs — friends only see
    // WHICH recipes you planned, never your private day/role assignments. This keeps
    // the SharedPlanEntry schema (and the Friends' UI) unchanged.
    { uid, displayName, photoURL, plannedRecipeIDs: plannedRecipeIDList(plannedRecipeIDs), updatedAt: serverTimestamp() }
  )
}

export function subscribeSharedWeekPlans(
  weekID: string,
  currentUid: string,
  cb: (plans: SharedPlanEntry[]) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, 'sharedWeekPlans', weekID, 'users'),
    snap => {
      cb(
        snap.docs
          .map(d => d.data() as SharedPlanEntry)
          .filter(p => p.uid !== currentUid)
      )
    }
  )
}

// ─── Grocery Items ────────────────────────────────────────────────────────────
// users/{uid}/pantry/root/groceryItems/{docId}
// Isolation: grocery data is per-user — all reads/writes are scoped to the
// authenticated user's uid passed from useAuth(). Each user only ever
// reads/writes their own subcollection path.

export interface GroceryItem {
  id: string
  name: string
  quantity: string
  unit: string
  isChecked: boolean
  isManual: boolean
  sourceRecipeIDs: string[]
  manualSection?: string
  createdAt?: unknown
  updatedAt?: unknown
}

/**
 * Grocery items are fully isolated per user via the Firestore path
 * users/{uid}/pantry/root/groceryItems. Each user only reads and writes
 * their own items. No sharing occurs between users.
 */
export function groceryPath(uid: string) {
  return collection(db, 'users', uid, 'pantry', 'root', 'groceryItems')
}

function sanitizeDocId(id: string): string {
  return id.replace(/[/\\]/g, '-').replace(/[^a-zA-Z0-9-_]/g, '-').substring(0, 100)
}

export function subscribeGroceryItems(uid: string, cb: (items: GroceryItem[]) => void): Unsubscribe {
  return onSnapshot(groceryPath(uid), snap => {
    const items = snap.docs.map(d => d.data() as GroceryItem)
    items.sort((a, b) => {
      if (a.isChecked !== b.isChecked) return a.isChecked ? 1 : -1
      return a.name.localeCompare(b.name)
    })
    cb(items)
  })
}

export async function addGroceryItem(uid: string, item: Omit<GroceryItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<void> {
  const id = sanitizeDocId(item.name.toLowerCase())
  await setDoc(doc(groceryPath(uid), id), {
    ...item,
    id,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

export async function toggleGroceryItem(uid: string, itemId: string, checked: boolean): Promise<void> {
  await updateDoc(doc(groceryPath(uid), itemId), {
    isChecked: checked,
    updatedAt: serverTimestamp(),
  })
}

export async function deleteGroceryItem(uid: string, itemId: string): Promise<void> {
  await deleteDoc(doc(groceryPath(uid), itemId))
}

export async function clearCheckedGroceryItems(uid: string): Promise<void> {
  const snap = await getDocs(groceryPath(uid))
  const batch = writeBatch(db)
  snap.docs.forEach(d => {
    if ((d.data() as GroceryItem).isChecked) batch.delete(d.ref)
  })
  await batch.commit()
}

export async function clearAllGroceryItems(uid: string): Promise<void> {
  const snap = await getDocs(groceryPath(uid))
  const batch = writeBatch(db)
  snap.docs.forEach(d => batch.delete(d.ref))
  await batch.commit()
}

// ─── Saved Grocery Items ─────────────────────────────────────────────────────
// users/{uid}/pantry/root/savedGroceryItems/{itemId}

export interface SavedGroceryItem {
  id: string
  name: string
  defaultCategory: GroceryCategory
  timesUsed: number
  lastUsed: unknown
}

export function savedGroceryItemsPath(uid: string) {
  return collection(db, 'users', uid, 'pantry', 'root', 'savedGroceryItems')
}

export async function getSavedGroceryItems(uid: string): Promise<SavedGroceryItem[]> {
  const snap = await getDocs(savedGroceryItemsPath(uid))
  return snap.docs.map(d => d.data() as SavedGroceryItem)
    .sort((a, b) => b.timesUsed - a.timesUsed)
}

export async function upsertSavedGroceryItem(
  uid: string,
  name: string,
  category: GroceryCategory
): Promise<void> {
  const id = sanitizeDocId(name.toLowerCase())
  const ref = doc(savedGroceryItemsPath(uid), id)
  const existing = await getDoc(ref)
  if (existing.exists()) {
    const data = existing.data() as SavedGroceryItem
    await updateDoc(ref, {
      timesUsed: data.timesUsed + 1,
      lastUsed: serverTimestamp(),
      defaultCategory: category,
    })
  } else {
    await setDoc(ref, {
      id,
      name: name.trim(),
      defaultCategory: category,
      timesUsed: 1,
      lastUsed: serverTimestamp(),
    })
  }
}

export async function deleteSavedGroceryItem(uid: string, itemId: string): Promise<void> {
  await deleteDoc(doc(savedGroceryItemsPath(uid), itemId))
}

// ─── Rebuild grocery from plan ───────────────────────────────────────────────
export async function rebuildGroceryFromPlan(
  uid: string,
  plannedRecipeIDs: PlannedElement[],
  getRecipeById: (id: string) => Promise<Recipe | null>,
  parseContent: (content: string) => { ingredients: string[]; instructions: string[]; description: string },
  metas?: Record<string, { overrides?: { content?: string } }>,
): Promise<void> {
  // Step 1: Delete non-manual, non-legacy items
  const snap = await getDocs(groceryPath(uid))
  const batch = writeBatch(db)
  snap.docs.forEach(d => {
    const data = d.data() as GroceryItem
    if (!data.isManual && !d.id.includes('/')) {
      batch.delete(d.ref)
    }
  })
  await batch.commit()

  // Step 2: Re-add ingredients from EVERY planned recipe, regardless of day or
  // role (neither affects the grocery list — we pull all planned recipes).
  for (const recipeID of plannedRecipeIDList(plannedRecipeIDs)) {
    const recipe = await getRecipeById(recipeID)
    if (!recipe) continue
    const effectiveContent = metas?.[recipeID]?.overrides?.content || recipe.content
    const { ingredients } = parseContent(effectiveContent)
    await addRecipeIngredientsToGrocery(uid, recipeID, ingredients)
  }
}

// ─── Add recipe ingredients to grocery ───────────────────────────────────────
// Each ingredient line is parsed into {quantity, unit, name} at write time (the
// grocery-add boundary — recipe storage is untouched) via the shared, pure
// ingredientParser. New items merge by EXACT normalized noun into existing
// RECIPE-sourced (non-manual) items only:
//   • manual items are never touched here, so the rebuild invariant holds
//     (rebuild deletes recipe-sourced items and re-adds them; manual quantities
//     must never get folded into a recipe item or they'd be lost on rebuild);
//   • already-contributed recipes are skipped so re-adding the same recipe (or a
//     repeated "Add to grocery") stays idempotent.
// The deterministic parser handles recipe lines without any AI call; a rare
// low-confidence/ambiguous line is stored verbatim in `name` (status quo — never
// worse). The single-line AI fallback is reserved for the interactive manual-add
// path, not this bulk path.
export async function addRecipeIngredientsToGrocery(
  uid: string,
  recipeID: string,
  ingredients: string[]
): Promise<void> {
  // Snapshot existing items once; index non-manual items by normalized noun.
  const snap = await getDocs(groceryPath(uid))
  const byNoun = new Map<string, { id: string; data: GroceryItem }>()
  snap.docs.forEach(d => {
    const data = d.data() as GroceryItem
    if (data.isManual) return
    const noun = normalizeNoun(data.name)
    if (noun && !byNoun.has(noun)) byNoun.set(noun, { id: d.id, data })
  })

  const batch = writeBatch(db)
  let wrote = false

  for (const ingredient of ingredients) {
    if (!ingredient.trim()) continue
    const parsed = parseIngredient(ingredient)
    const usable = parsed.confidence === 'high' && !!parsed.name
    const name = usable ? parsed.name : ingredient.trim()
    const quantity = usable ? parsed.quantity : ''
    const unit = usable ? parsed.unit : ''
    const noun = normalizeNoun(name)

    const target = noun ? byNoun.get(noun) : undefined
    if (target) {
      const data = target.data
      const sources = data.sourceRecipeIDs || []
      if (sources.includes(recipeID)) continue // already contributed — idempotent
      const merged = mergeQuantities(
        { quantity: data.quantity || '', unit: data.unit || '' },
        { quantity, unit },
      )
      const newSources = [...sources, recipeID]
      batch.update(doc(groceryPath(uid), target.id), {
        quantity: merged.quantity,
        unit: merged.unit,
        sourceRecipeIDs: newSources,
        updatedAt: serverTimestamp(),
      })
      // Reflect the merge in-memory so later same-noun lines fold in too.
      target.data = { ...data, quantity: merged.quantity, unit: merged.unit, sourceRecipeIDs: newSources }
      wrote = true
    } else {
      const id = sanitizeDocId(noun || `${recipeID}-${name.toLowerCase().slice(0, 40)}`)
      const newItem: GroceryItem = {
        id,
        name,
        quantity,
        unit,
        isChecked: false,
        isManual: false,
        sourceRecipeIDs: [recipeID],
      }
      batch.set(doc(groceryPath(uid), id), {
        ...newItem,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      if (noun) byNoun.set(noun, { id, data: newItem })
      wrote = true
    }
  }

  if (wrote) await batch.commit()
}
