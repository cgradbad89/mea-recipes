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
  writeBatch, deleteField } from 'firebase/firestore'
import { db } from './firebase'
import type { Recipe } from '@/types/recipe'

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

export async function getRecipeMeta(uid: string, recipeID: string): Promise<RecipeMeta | null> {
  const snap = await getDoc(doc(metaPath(uid), recipeID))
  if (!snap.exists()) return null
  return snap.data() as RecipeMeta
}

export async function saveRecipeMeta(uid: string, recipeID: string, meta: Partial<RecipeMeta>): Promise<void> {
  const data: any = { ...meta, recipeID, updatedAt: serverTimestamp() }
  if (data.overrides === undefined || data.overrides === null) {
    data.overrides = deleteField()
  }
  await setDoc(doc(metaPath(uid), recipeID), data, { merge: true })
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
  const existing = snap.exists() ? (snap.data() as WeekPlan) : null
  const planned = existing?.plannedRecipeIDs || []
  const cooked = existing?.cookedRecipeIDs || []
  if (!planned.includes(recipeID)) {
    await setDoc(ref, {
      weekID,
      weekStartISO: weekID,
      plannedRecipeIDs: [...planned, recipeID],
      cookedRecipeIDs: cooked,
      updatedAt: serverTimestamp(),
    })
  }
}

export async function removeRecipeFromWeekPlan(uid: string, weekID: string, recipeID: string): Promise<void> {
  const ref = doc(weekPlansPath(uid), weekID)
  const snap = await getDoc(ref)
  if (!snap.exists()) return
  const plan = snap.data() as WeekPlan
  await setDoc(ref, {
    ...plan,
    plannedRecipeIDs: plan.plannedRecipeIDs.filter(id => id !== recipeID),
    updatedAt: serverTimestamp(),
  })
}

export async function moveRecipeToWeek(uid: string, fromWeekID: string, toWeekID: string, recipeID: string): Promise<void> {
  await removeRecipeFromWeekPlan(uid, fromWeekID, recipeID)
  await addRecipeToWeekPlan(uid, toWeekID, recipeID)
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

// ─── Grocery Items ────────────────────────────────────────────────────────────
// users/{uid}/pantry/root/groceryItems/{docId}

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

// ─── Add recipe ingredients to grocery ───────────────────────────────────────
export async function addRecipeIngredientsToGrocery(
  uid: string,
  recipeID: string,
  ingredients: string[]
): Promise<void> {
  for (const ingredient of ingredients) {
    if (!ingredient.trim()) continue
    const id = sanitizeDocId(`${recipeID}-${ingredient.toLowerCase().slice(0, 40)}`)
    const ref = doc(groceryPath(uid), id)
    const existing = await getDoc(ref)
    if (existing.exists()) {
      const data = existing.data() as GroceryItem
      if (!data.sourceRecipeIDs.includes(recipeID)) {
        await updateDoc(ref, {
          sourceRecipeIDs: [...data.sourceRecipeIDs, recipeID],
          updatedAt: serverTimestamp(),
        })
      }
    } else {
      await setDoc(ref, {
        id,
        name: ingredient,
        quantity: '',
        unit: '',
        isChecked: false,
        isManual: false,
        sourceRecipeIDs: [recipeID],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    }
  }
}
