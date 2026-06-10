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
import type { Recipe, RecipeNutrition } from '@/types/recipe'
import { perServingFromTotal, servingSizeLabel } from './nutrition'

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
    prepTime: data.prepTime || undefined,
    cookTime: data.cookTime || undefined,
    servings: typeof data.servings === 'number' ? data.servings : undefined,
    // nutrition is written by the backfill; pass it through verbatim if present.
    nutrition: data.nutrition && typeof data.nutrition === 'object' ? data.nutrition : undefined,
  }
}

let _recipesCache: Recipe[] | null = null

export async function getAllRecipes(): Promise<Recipe[]> {
  if (_recipesCache) return _recipesCache
  const snap = await getDocs(collection(db, COLLECTION))
  const results = snap.docs
    .map(d => docToRecipe(d.id, d.data()))
    .filter(r => r.title)
    .sort((a, b) => a.title.localeCompare(b.title))
  _recipesCache = results
  return _recipesCache
}

export function invalidateRecipeCache(): void {
  _recipesCache = null
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
  invalidateRecipeCache()
  return id
}

/**
 * Correct a recipe's servings and re-derive its per-serving nutrition from the
 * durable whole-recipe `total`. Writes only servings, serving_size, and the
 * per-serving macro fields back onto the shared recipe doc's `nutrition` map —
 * `total`, `source`, `confidence`, and `computed_at` are left untouched.
 *
 * If `total` is missing, servings + serving_size are persisted but per-serving
 * values cannot be recomputed (left as-is). Returns the merged nutrition object
 * for optimistic local state. Uses a deep merge so existing nutrition fields are
 * preserved.
 */
export async function updateRecipeServings(
  id: string,
  servings: number,
  current: RecipeNutrition,
): Promise<RecipeNutrition> {
  const perServing = perServingFromTotal(current.total, servings)
  const patch: Record<string, unknown> = {
    servings,
    serving_size: servingSizeLabel(servings),
  }
  if (perServing) Object.assign(patch, perServing)

  await setDoc(doc(db, COLLECTION, id), { nutrition: patch }, { merge: true })
  invalidateRecipeCache()

  return { ...current, ...patch } as RecipeNutrition
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

  // Find INGREDIENTS section (case-insensitive)
  const ingKeywords = /^(INGREDIENTS|WHAT YOU NEED|YOU WILL NEED|SHOPPING LIST)$/i
  const instKeywords = /^(INSTRUCTIONS|PREPARATION|DIRECTIONS|METHOD|STEPS|HOW TO MAKE)$/i

  const ingStart  = lines.findIndex(l => ingKeywords.test(l))
  const instStart = lines.findIndex(l => instKeywords.test(l))

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
    !ingKeywords.test(l) &&
    !instKeywords.test(l) &&
    !l.match(/^(Step|Yield|Total|Prep|Cook)/i) &&
    l.length > 20
  )
  const description = descLines[0] || ''

  return { sourceURL, ingredients, instructions, description }
}

export async function deleteRecipe(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id))
  invalidateRecipeCache()
}

// ─── Time parsing helpers ───────────────────────────────────────────────────
// Parse a free-form time string (e.g. "30 min", "1 hr 15 min", "PT30M", "1h30m")
// into minutes (integer). Returns 0 on any failure.
export function parseTimeToMinutes(input: string | undefined | null): number {
  if (!input) return 0
  const s = input.toLowerCase().trim()
  if (!s) return 0

  // ISO 8601 duration (PT30M, PT1H15M)
  const iso = s.match(/^pt(?:(\d+)h)?(?:(\d+)m)?$/i)
  if (iso) {
    const h = parseInt(iso[1] || '0', 10)
    const m = parseInt(iso[2] || '0', 10)
    return h * 60 + m
  }

  let total = 0
  const hourMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/)
  if (hourMatch) total += parseFloat(hourMatch[1]) * 60

  const minMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/)
  if (minMatch) total += parseFloat(minMatch[1])

  if (total === 0) {
    const bare = s.match(/^(\d+(?:\.\d+)?)$/)
    if (bare) total = parseFloat(bare[1])
  }

  const rounded = Math.round(total)
  return Number.isFinite(rounded) ? rounded : 0
}

export function formatMinutes(mins: number): string {
  if (!mins || mins <= 0) return ''
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (m === 0) return `${h} hr`
  return `${h} hr ${m} min`
}

// ─── Ingredient sub-header detection ────────────────────────────────────────
const INGREDIENT_HEADER_KEYWORDS = new Set([
  'sauce', 'sauces', 'garnish', 'garnishes', 'marinade', 'dressing',
  'topping', 'toppings', 'filling', 'glaze', 'rub', 'spice mix',
  'spice blend', 'seasoning', 'seasoning blend', 'to serve',
  'to garnish', 'for serving', 'serving', 'dough', 'batter',
  'crust', 'assembly',
])

function cleanHeaderText(s: string): string {
  return s
    .replace(/^\*+|\*+$/g, '')
    .replace(/:$/, '')
    .trim()
}

export function detectIngredientHeader(line: string): { isHeader: boolean; text: string } {
  if (!line) return { isHeader: false, text: line }
  const trimmed = line.trim()
  if (!trimmed) return { isHeader: false, text: line }

  // Rule 1: Line ends with colon (and is short — no quantity-style content)
  if (trimmed.endsWith(':')) {
    const withoutColon = trimmed.slice(0, -1).trim()
    if (!/\d/.test(withoutColon) && withoutColon.length < 60) {
      return { isHeader: true, text: cleanHeaderText(withoutColon) }
    }
  }

  // Rule 2: Full line is markdown bold (** or *)
  const boldMatch = trimmed.match(/^(\*\*|\*)(.+?)\1$/)
  if (boldMatch) {
    return { isHeader: true, text: cleanHeaderText(boldMatch[2]) }
  }

  // Rule 3: Matches keyword list after normalization
  const normalized = trimmed
    .replace(/^\*+|\*+$/g, '')
    .replace(/:$/, '')
    .replace(/^for the\s+/i, '')
    .replace(/^for\s+/i, '')
    .trim()
    .toLowerCase()

  if (INGREDIENT_HEADER_KEYWORDS.has(normalized)) {
    return { isHeader: true, text: cleanHeaderText(trimmed) }
  }

  return { isHeader: false, text: line }
}

export function getTotalTime(
  prepTime: string | undefined,
  cookTime: string | undefined,
): { minutes: number; display: string } {
  const prep = parseTimeToMinutes(prepTime)
  const cook = parseTimeToMinutes(cookTime)
  const total = prep + cook
  return { minutes: total, display: formatMinutes(total) }
}
