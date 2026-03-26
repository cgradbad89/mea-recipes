import { deleteDoc,
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  setDoc,
  query,
  where,
  orderBy,
  limit,
  DocumentData,
} from 'firebase/firestore'
import { db } from './firebase'
import type { Recipe } from '@/types/recipe'

const COLLECTION = 'recipes'

function docToRecipe(id: string, data: DocumentData): Recipe {
  return {
    id,
    recipeID: data.recipeID || id,
    title: data.title || '',
    content: data.content || '',
    category: data.category || '',
    cuisine: data.cuisine || '',
    imageURL: data.imageURL || '',
    sourceURL: data.sourceURL || '',
    sourceFile: data.sourceFile || '',
    labels: data.labels || '',
    hasImage: data.hasImage || 'false',
    created: data.created || '',
    modified: data.modified || '',
    addedBy: data.addedBy || undefined,
  }
}

export async function getAllRecipes(): Promise<Recipe[]> {
  const snap = await getDocs(collection(db, COLLECTION))
  return snap.docs
    .map(d => docToRecipe(d.id, d.data()))
    .filter(r => r.title)
    .sort((a, b) => a.title.localeCompare(b.title))
}

export async function getRecipeById(id: string): Promise<Recipe | null> {
  const snap = await getDoc(doc(db, COLLECTION, id))
  if (!snap.exists()) return null
  return docToRecipe(snap.id, snap.data())
}

export async function getRecipesByCategory(category: string): Promise<Recipe[]> {
  const q = query(collection(db, COLLECTION), where('category', '==', category))
  const snap = await getDocs(q)
  return snap.docs.map(d => docToRecipe(d.id, d.data())).filter(r => r.title)
}

export async function getRecipesByCuisine(cuisine: string): Promise<Recipe[]> {
  const q = query(collection(db, COLLECTION), where('cuisine', '==', cuisine))
  const snap = await getDocs(q)
  return snap.docs.map(d => docToRecipe(d.id, d.data())).filter(r => r.title)
}

export async function saveRecipe(recipe: Omit<Recipe, 'id'>, addedByUid?: string): Promise<string> {
  const id = slugify(recipe.title)
  await setDoc(doc(db, COLLECTION, id), {
    ...recipe,
    id,
    recipeID: id,
    ...(addedByUid ? { addedBy: addedByUid } : {}),
  })
  return id
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Parse ingredients and steps out of the raw content field
export function parseRecipeContent(content: string): {
  sourceURL: string
  ingredients: string[]
  instructions: string[]
  description: string
} {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean)

  const sourceURL = lines.find(l => l.startsWith('http')) || ''

  // Find INGREDIENTS section
  const ingStart = lines.findIndex(l => /^INGREDIENTS$/i.test(l))
  const instStart = lines.findIndex(l => /^INSTRUCTIONS$/i.test(l))

  let ingredients: string[] = []
  let instructions: string[] = []

  if (ingStart !== -1 && instStart !== -1) {
    ingredients = lines
      .slice(ingStart + 1, instStart)
      .filter(l => !l.match(/^(yield|step|total|prep|cook|rating|scale)/i) && l.length > 2)
  } else if (ingStart !== -1) {
    ingredients = lines.slice(ingStart + 1).filter(l => l.length > 2).slice(0, 20)
  }

  if (instStart !== -1) {
    const rawSteps = lines.slice(instStart + 1)
    instructions = rawSteps
      .filter(l => l.length > 10)
      .map(l => l.replace(/^Step\s+\d+\s*/i, '').trim())
      .filter(l => l.length > 10)
  }

  const descLines = lines.filter(
    l => !l.startsWith('http') &&
    !l.match(/^(INGREDIENTS|INSTRUCTIONS|Step|Yield|Total|Prep|Cook)/i) &&
    l.length > 20
  )
  const description = descLines[0] || ''

  return { sourceURL, ingredients, instructions, description }
}

export async function deleteRecipe(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id))
}
