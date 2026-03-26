import {
  collection, addDoc, getDocs, deleteDoc, doc,
  orderBy, query, serverTimestamp, updateDoc
} from 'firebase/firestore'
import { db } from './firebase'

export interface QueuedRecipe {
  id?: string
  title: string
  cuisine: string
  category: string
  ingredients: string[]
  instructions: string[]
  imageURL: string
  sourceURL: string
  description: string
  servings: string
  prepTime: string
  cookTime: string
  status: 'pending' | 'published'
  createdAt?: unknown
}

function queuePath(uid: string) {
  return collection(db, 'users', uid, 'recipeQueue')
}

export async function addToQueue(uid: string, recipe: Omit<QueuedRecipe, 'id' | 'status' | 'createdAt'>): Promise<string> {
  const ref = await addDoc(queuePath(uid), {
    ...recipe,
    status: 'pending',
    createdAt: serverTimestamp(),
  })
  return ref.id
}

export async function getQueue(uid: string): Promise<QueuedRecipe[]> {
  const snap = await getDocs(query(queuePath(uid), orderBy('createdAt', 'desc')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as QueuedRecipe))
}

export async function updateQueueItem(uid: string, id: string, data: Partial<QueuedRecipe>): Promise<void> {
  await updateDoc(doc(queuePath(uid), id), data as any)
}

export async function deleteFromQueue(uid: string, id: string): Promise<void> {
  await deleteDoc(doc(queuePath(uid), id))
}

export function buildRecipeContent(recipe: QueuedRecipe): string {
  const lines: string[] = []
  if (recipe.sourceURL) lines.push(recipe.sourceURL, '')
  if (recipe.description) lines.push(recipe.description, '')
  if (recipe.prepTime || recipe.cookTime || recipe.servings) {
    if (recipe.prepTime) lines.push(`Prep: ${recipe.prepTime}`)
    if (recipe.cookTime) lines.push(`Cook: ${recipe.cookTime}`)
    if (recipe.servings) lines.push(`Serves: ${recipe.servings}`)
    lines.push('')
  }
  if (recipe.ingredients?.length) {
    lines.push('INGREDIENTS')
    recipe.ingredients.forEach(i => lines.push(i))
    lines.push('')
  }
  if (recipe.instructions?.length) {
    lines.push('INSTRUCTIONS')
    recipe.instructions.forEach((s, i) => {
      lines.push(`Step ${i + 1}`)
      lines.push(s)
    })
  }
  return lines.join('\n')
}
