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
    nutritionStatus: data.nutritionStatus === 'needs_calc' || data.nutritionStatus === 'computed'
      ? data.nutritionStatus : undefined,
    // Batch 5.1 — explicit meal-plan default role. Whitelisted here so it loads
    // (docToRecipe silently drops any field not listed).
    defaultRole: data.defaultRole === 'main' || data.defaultRole === 'side' ? data.defaultRole : undefined,
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

/**
 * Set this recipe's explicit default meal-plan role (main/side) on the SHARED
 * recipe doc — main/side is a property of the dish, so it is shared like the rest
 * of the catalog. Single-field merge write. Does NOT touch any week plan: changing
 * the default affects FUTURE adds only; existing planned entries keep their stored
 * per-entry role (see lib/userdata.ts resolveRecipeRole / normalizePlanned).
 */
export async function setRecipeDefaultRole(id: string, role: 'main' | 'side'): Promise<void> {
  await setDoc(doc(db, COLLECTION, id), { defaultRole: role }, { merge: true })
  invalidateRecipeCache()
}

// ─── Auto-nutrition on publish (shared client helper) ────────────────────────
// The engine lives server-side (lib/nutritionEngine.ts) and must read the recipe
// doc by id, so a recipe is always written FIRST, then nutrition is computed via
// the /api/nutrition-lookup route and merged back onto the doc here. Used by the
// queue publish flow and the Discover "Generate a recipe" save path.

const NUTRITION_TIMEOUT_MS = 20000

/** Persist a computed nutrition object onto the recipe doc (merge). */
export async function saveRecipeNutrition(id: string, nutrition: RecipeNutrition): Promise<void> {
  // Stamp computed_at as a real Date → Firestore Timestamp (the API response
  // serialises it to a string over JSON), matching the backfill's shape.
  const toStore: RecipeNutrition = { ...nutrition, computed_at: new Date() }
  await setDoc(doc(db, COLLECTION, id), { nutrition: toStore, nutritionStatus: 'computed' }, { merge: true })
  invalidateRecipeCache()
}

/** Flag a recipe as needing manual nutrition calculation (compute failed/timed out). */
export async function flagNutritionNeedsCalc(id: string): Promise<void> {
  await setDoc(doc(db, COLLECTION, id), { nutritionStatus: 'needs_calc' }, { merge: true })
  invalidateRecipeCache()
}

/**
 * Compute a recipe's nutrition via the shared engine route and persist it.
 *
 * NEVER THROWS and never blocks the caller's publish/save: the network call is
 * wrapped in a ~20s timeout, and on any slowness/error the recipe is flagged
 * `needs_calc` (surfacing the manual retry on the detail page) instead of failing.
 * Returns the stored nutrition on success, or null on failure.
 *
 * Servings handling (default-to-4 + `+default_servings` + low confidence, with
 * the whole-recipe `total` stored as the durable basis) is done inside the engine
 * — see computeRecipeNutrition in lib/nutritionEngine.ts.
 */
export async function computeAndStoreNutrition(
  recipeId: string,
  token: string,
  timeoutMs: number = NUTRITION_TIMEOUT_MS,
): Promise<RecipeNutrition | null> {
  try {
    const res = await fetch('/api/nutrition-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type: 'recipe', recipeId }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) throw new Error(`nutrition-lookup ${res.status}`)
    const data = await res.json()
    const nutrition = data?.nutrition as RecipeNutrition | undefined
    if (!nutrition) throw new Error('no nutrition in response')
    await saveRecipeNutrition(recipeId, nutrition)
    return nutrition
  } catch (err) {
    console.error('Nutrition compute failed; flagging for manual calc:', err)
    try { await flagNutritionNeedsCalc(recipeId) } catch { /* non-fatal */ }
    return null
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Canonical production origin for building shareable ABSOLUTE recipe links (e.g.
// Google Calendar event descriptions, Batch 6). The in-app route is the relative
// `/recipes/[id]` where `[id]` is the recipe's slug doc-id (`recipe.id`) — the same
// href RecipeCard/detail use. We never re-slugify the title; callers pass `recipe.id`.
export const SITE_URL = 'https://mea-recipes.vercel.app'

/** Absolute URL to a recipe's detail page. Reuses the `/recipes/[id]` route + the
 *  recipe's slug id (`recipe.id`); does not reconstruct the slug from the title. */
export function recipeUrl(id: string): string {
  return `${SITE_URL}/recipes/${id}`
}

// Parse ingredients and steps out of the raw content field.
// Implementation lives in lib/recipeContent.ts (pure, firebase-free) so the
// server-side nutrition engine can share it; re-exported here for back-compat.
export { parseRecipeContent } from './recipeContent'

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
  'crust', 'assembly', 'main', 'main dish', 'dish',
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
