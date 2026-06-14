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
  arrayUnion,
  arrayRemove,
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

// ─── Week Plans ───────────────────────────────────────────────────────────────
// users/{uid}/pantry/root/weekPlans/{weekID}

export interface WeekPlan {
  weekID: string
  weekStartISO: string
  plannedRecipeIDs: string[]
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

export async function addRecipeToWeekPlan(uid: string, weekID: string, recipeID: string): Promise<void> {
  const ref = doc(weekPlansPath(uid), weekID)
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    await setDoc(ref, {
      weekID,
      weekStartISO: weekID,
      plannedRecipeIDs: [recipeID],
      cookedRecipeIDs: [],
      updatedAt: serverTimestamp(),
    })
  } else {
    await updateDoc(ref, {
      plannedRecipeIDs: arrayUnion(recipeID),
      updatedAt: serverTimestamp(),
    })
  }
}

export async function removeRecipeFromWeekPlan(uid: string, weekID: string, recipeID: string): Promise<void> {
  const ref = doc(weekPlansPath(uid), weekID)
  await updateDoc(ref, {
    plannedRecipeIDs: arrayRemove(recipeID),
    updatedAt: serverTimestamp(),
  })
}

export async function moveRecipeToWeek(uid: string, fromWeekID: string, toWeekID: string, recipeID: string): Promise<void> {
  const fromRef = doc(weekPlansPath(uid), fromWeekID)
  const toRef = doc(weekPlansPath(uid), toWeekID)
  await runTransaction(db, async tx => {
    const toSnap = await tx.get(toRef)
    tx.update(fromRef, { plannedRecipeIDs: arrayRemove(recipeID), updatedAt: serverTimestamp() })
    if (!toSnap.exists()) {
      tx.set(toRef, { weekID: toWeekID, weekStartISO: toWeekID, plannedRecipeIDs: [recipeID], cookedRecipeIDs: [], updatedAt: serverTimestamp() })
    } else {
      tx.update(toRef, { plannedRecipeIDs: arrayUnion(recipeID), updatedAt: serverTimestamp() })
    }
  })
}

export async function markRecipeCooked(uid: string, weekID: string, recipeID: string, cooked: boolean): Promise<void> {
  const ref = doc(weekPlansPath(uid), weekID)
  const snap = await getDoc(ref)
  if (!snap.exists()) return
  const plan = snap.data() as WeekPlan
  const cookedIDs = cooked
    ? [...new Set([...plan.cookedRecipeIDs, recipeID])]
    : plan.cookedRecipeIDs.filter(id => id !== recipeID)
  await setDoc(ref, { ...plan, cookedRecipeIDs: cookedIDs, updatedAt: serverTimestamp() })
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
  plannedRecipeIDs: string[]
): Promise<void> {
  await setDoc(
    doc(db, 'sharedWeekPlans', weekID, 'users', uid),
    { uid, displayName, photoURL, plannedRecipeIDs, updatedAt: serverTimestamp() }
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
  plannedRecipeIDs: string[],
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

  // Step 2: Re-add ingredients from each planned recipe
  for (const recipeID of plannedRecipeIDs) {
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
