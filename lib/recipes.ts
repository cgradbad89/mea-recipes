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
import type { CookingStepIngredientMap, Recipe, RecipeNutrition } from '@/types/recipe'
import { perServingFromTotal, servingSizeLabel } from './nutrition'
import { isIngredientSubheader, parseRecipeContent } from './recipeContent'
import {
  buildHashedDeterministicCookingStepMap,
  hasAiEligibleCookingSteps,
  validateCookingStepIngredientMap,
} from './cookingStepMapping'
import {
  isRecipeCategory,
  normalizeRecipeCategory,
  type RecipeCategory,
} from './recipeCategories'

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
    cookingStepIngredientMap: data.cookingStepIngredientMap && typeof data.cookingStepIngredientMap === 'object'
      ? data.cookingStepIngredientMap as CookingStepIngredientMap
      : undefined,
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

export async function getRecipesByCategory(category: RecipeCategory): Promise<Recipe[]> {
  const recipes = await getAllRecipes()
  return recipes.filter(recipe => normalizeRecipeCategory(recipe.category, recipe.id) === category)
}

export async function getRecipesByCuisine(cuisine: string): Promise<Recipe[]> {
  const q = query(collection(db, COLLECTION), where('cuisine', '==', cuisine))
  const snap = await getDocs(q)
  return snap.docs.map(d => docToRecipe(d.id, d.data())).filter(r => r.title)
}

export type SharedRecipeWrite = Omit<Recipe, 'id' | 'category'> & {
  category: RecipeCategory
}

export async function saveRecipe(recipe: SharedRecipeWrite, addedByUid?: string): Promise<string> {
  if (!isRecipeCategory(recipe.category)) {
    throw new Error('Choose a valid recipe category before publishing.')
  }
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

const COOKING_STEP_MAP_TIMEOUT_MS = 15_000
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Prepare a source-bound map for the exact content about to be saved. Optional
 * AI/API failure always falls back to the local deterministic map.
 */
export async function prepareCookingStepIngredientMap(
  content: string,
  token: string,
  timeoutMs: number = COOKING_STEP_MAP_TIMEOUT_MS,
): Promise<CookingStepIngredientMap> {
  const { ingredients, instructions } = parseRecipeContent(content)
  const deterministicMap = await buildHashedDeterministicCookingStepMap(ingredients, instructions)
  if (!hasAiEligibleCookingSteps(deterministicMap)) return deterministicMap

  try {
    const response = await fetch('/api/cooking-step-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ content }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return deterministicMap
    const data: unknown = await response.json()
    if (
      !isRecord(data) ||
      !isRecord(data.ai) ||
      typeof data.ai.attempted !== 'boolean' ||
      !['not_needed', 'completed', 'failed'].includes(data.ai.status as string) ||
      typeof data.ai.resolvedIngredientReferences !== 'number' ||
      !Number.isInteger(data.ai.resolvedIngredientReferences) ||
      data.ai.resolvedIngredientReferences < 0 ||
      typeof data.ai.resolvedPreparedComponents !== 'number' ||
      !Number.isInteger(data.ai.resolvedPreparedComponents) ||
      data.ai.resolvedPreparedComponents < 0 ||
      !validateCookingStepIngredientMap(data.mapping, ingredients, instructions, deterministicMap).valid
    ) return deterministicMap
    return data.mapping as CookingStepIngredientMap
  } catch {
    return deterministicMap
  }
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

// ─── Cooking Mode mapping generation on publish (Implementation 6) ──────────
// Mirrors the auto-nutrition pattern directly above: fired after a recipe is
// already saved, via the trusted `/api/mapping/generate` route (never
// touches Firestore directly from the client — mapping generation performs
// paid AI calls and writes shared catalog workflow state, so it stays behind
// the same admin-verified server boundary as the rest of the Cooking Mode
// mapping workflow). NEVER THROWS: any failure returns null and is logged,
// exactly like `computeAndStoreNutrition`, so a caller can run both
// alongside each other (e.g. via `Promise.allSettled`) without either one's
// failure affecting the other or the recipe's own already-completed save.
//
// Independent, shorter timeout than the route's own `maxDuration` (280s):
// this call runs inside the user-visible publish flow, so it gives up
// waiting well before the platform would — but the server-side generation
// keeps running to completion and persists the proposal regardless (Vercel
// serverless functions are not killed by a client disconnect), so a
// subsequent `/mapping-review` visit can still discover a proposal that
// finished after the client stopped waiting for it.
const MAPPING_GENERATION_TIMEOUT_MS = 90000

export interface MappingGenerationTriggerResult {
  outcome: 'GENERATED' | 'REUSED_EXISTING' | 'BLOCKED' | 'FAILED'
  recipeId: string
  recipeRevision: string | null
  proposalId: string | null
  candidateCount: number | null
  autoAcceptCount: number | null
  reviewRequiredCount: number | null
  approvalBlocked: boolean | null
  blockingReasons: string[]
}

/**
 * Trigger Cooking Mode mapping proposal generation for a just-published (or
 * mapping-relevantly edited) recipe. Best-effort and bounded: on any
 * network/timeout/server error this resolves to `null` rather than
 * throwing, so it never blocks or fails the caller's publish flow. Returns
 * the route's reported outcome on success (which itself may be `'FAILED'`
 * or `'BLOCKED'` — those are still successful HTTP responses; see
 * `app/api/mapping/generate/route.ts`).
 */
export async function triggerCookingModeMappingGeneration(
  recipeId: string,
  token: string,
  timeoutMs: number = MAPPING_GENERATION_TIMEOUT_MS,
): Promise<MappingGenerationTriggerResult | null> {
  try {
    const res = await fetch('/api/mapping/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ recipeId }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) throw new Error(`mapping-generate ${res.status}`)
    const data = await res.json()
    if (!data || typeof data.outcome !== 'string') throw new Error('no outcome in response')
    return data as MappingGenerationTriggerResult
  } catch (err) {
    console.error('Cooking Mode mapping generation failed (recipe saved anyway):', err)
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
export { isIngredientSubheader, parseRecipeContent } from './recipeContent'

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

function cleanHeaderText(s: string): string {
  return s
    .replace(/^\*+|\*+$/g, '')
    .replace(/:$/, '')
    .trim()
}

export function detectIngredientHeader(line: string): { isHeader: boolean; text: string } {
  return isIngredientSubheader(line)
    ? { isHeader: true, text: cleanHeaderText(line.trim()) }
    : { isHeader: false, text: line }
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
