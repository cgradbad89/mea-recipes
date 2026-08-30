import {
  collection, addDoc, getDocs, deleteDoc, doc,
  orderBy, query, runTransaction, serverTimestamp, updateDoc, type Transaction
} from 'firebase/firestore'
import { db } from './firebase'
import {
  createRecipeInTransaction,
  invalidateRecipeCache,
  recipeIdForTitle,
  type SharedRecipeWrite,
} from './recipes'

export interface QueuedRecipe {
  id?: string
  title: string
  cuisine: string
  // Queue is a tolerant review boundary; publishing narrows this to RecipeCategory.
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
  publishedRecipeId?: string
  publishedAt?: unknown
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

export class QueuePublicationStateError extends Error {
  readonly code = 'queue-publication-state-conflict'

  constructor(message = 'This queued recipe has an inconsistent publication state. It was left unchanged.') {
    super(message)
    this.name = 'QueuePublicationStateError'
  }
}

/**
 * Atomically create the shared recipe and mark its queue source published.
 * A retry of the same completed transition returns the original recipe ID and
 * reports `created: false`, allowing cleanup to resume without publishing or
 * enriching the recipe a second time.
 */
export async function publishQueuedRecipe(
  uid: string,
  queueId: string,
  recipe: SharedRecipeWrite,
  addedByUid: string,
): Promise<{ recipeId: string; created: boolean }> {
  const result = await runTransaction(db, transaction =>
    publishQueuedRecipeInTransaction(transaction, uid, queueId, recipe, addedByUid))

  if (result.created) invalidateRecipeCache()
  return result
}

export async function publishQueuedRecipeInTransaction(
  transaction: Transaction,
  uid: string,
  queueId: string,
  recipe: SharedRecipeWrite,
  addedByUid: string,
): Promise<{ recipeId: string; created: boolean }> {
  const targetRecipeId = recipeIdForTitle(recipe.title)
  const queueRef = doc(queuePath(uid), queueId)
  const queueSnapshot = await transaction.get(queueRef)
  if (!queueSnapshot.exists()) throw new QueuePublicationStateError('This queued recipe no longer exists.')

  const queued = queueSnapshot.data() as Partial<QueuedRecipe>
  if (queued.status === 'published') {
    const publishedRecipeId = queued.publishedRecipeId || targetRecipeId
    if (publishedRecipeId !== targetRecipeId) throw new QueuePublicationStateError()
    const recipeSnapshot = await transaction.get(doc(db, 'recipes', publishedRecipeId))
    if (!recipeSnapshot.exists()) throw new QueuePublicationStateError()
    return { recipeId: publishedRecipeId, created: false }
  }

  const recipeId = await createRecipeInTransaction(transaction, recipe, addedByUid)
  transaction.update(queueRef, {
    status: 'published',
    publishedRecipeId: recipeId,
    publishedAt: serverTimestamp(),
  })
  return { recipeId, created: true }
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
