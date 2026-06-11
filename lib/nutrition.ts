import type { NutritionMacros, RecipeNutrition } from '@/types/recipe'
import type { BarcodeLookupResponse } from '@/types/nutrition'

// The six tracked macros, in display order, with formatting rules.
export const NUTRIENTS: {
  key: keyof NutritionMacros
  label: string
  unit: string
  decimals: number
}[] = [
  { key: 'calories', label: 'Calories', unit: '',  decimals: 0 },
  { key: 'protein_g', label: 'Protein', unit: 'g', decimals: 1 },
  { key: 'carbs_g',  label: 'Carbs',    unit: 'g', decimals: 1 },
  { key: 'fat_g',    label: 'Fat',      unit: 'g', decimals: 1 },
  { key: 'fiber_g',  label: 'Fiber',    unit: 'g', decimals: 1 },
  { key: 'sugar_g',  label: 'Sugar',    unit: 'g', decimals: 1 },
]

const MACRO_KEYS: (keyof NutritionMacros)[] = [
  'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g',
]

/** Round a nutrient value per its display rule (calories → whole, macros → 1 decimal). */
export function formatNutrient(key: keyof NutritionMacros, value: number | undefined): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—'
  const decimals = key === 'calories' ? 0 : 1
  return value.toFixed(decimals)
}

/**
 * Derive per-serving macros from the whole-recipe total.
 * Returns null if total is missing or servings is not a positive number.
 */
export function perServingFromTotal(
  total: Partial<NutritionMacros> | undefined,
  servings: number | undefined,
): NutritionMacros | null {
  if (!total || !servings || !Number.isFinite(servings) || servings <= 0) return null
  const out = {} as NutritionMacros
  for (const k of MACRO_KEYS) {
    const t = total[k]
    out[k] = typeof t === 'number' && Number.isFinite(t) ? t / servings : 0
  }
  return out
}

/**
 * Per-serving macros for a recipe's nutrition object: derived from the durable
 * whole-recipe `total` when possible, else the stored per-serving fields.
 */
export function perServingOf(n: RecipeNutrition | undefined): NutritionMacros | null {
  if (!n) return null
  const derived = perServingFromTotal(n.total, n.servings)
  if (derived) return derived
  if (typeof n.calories === 'number' && Number.isFinite(n.calories)) {
    return {
      calories: n.calories, protein_g: n.protein_g ?? 0, carbs_g: n.carbs_g ?? 0,
      fat_g: n.fat_g ?? 0, fiber_g: n.fiber_g ?? 0, sugar_g: n.sugar_g ?? 0,
    }
  }
  return null
}

/** Human-readable serving label, e.g. "1 of 4". */
export function servingSizeLabel(servings: number | undefined): string {
  if (!servings || !Number.isFinite(servings) || servings <= 0) return ''
  return `1 of ${servings}`
}

/**
 * Whether the servings count behind these numbers was assumed rather than known.
 * Per spec: true when source carries +default_servings, or confidence is low,
 * or the stored serving_size label explicitly says "assumed".
 */
export function servingsAssumed(n: RecipeNutrition | undefined): boolean {
  if (!n) return false
  const source = (n.source || '').toLowerCase()
  const sizeLabel = (n.serving_size || '').toLowerCase()
  return (
    source.includes('+default_servings') ||
    n.confidence === 'low' ||
    sizeLabel.includes('assumed')
  )
}

/** Map a raw `source` string (possibly with +suffixes) to a short provider label. */
export function sourceLabel(source: string | undefined): string {
  const s = (source || '').toLowerCase()
  if (!s) return 'unknown'
  if (s.startsWith('usda+ai') || s.startsWith('ai')) return 'estimated'
  if (s.startsWith('openfoodfacts') || s.startsWith('off')) return 'Open Food Facts'
  if (s.startsWith('usda')) return 'USDA'   // also covers usda_branded
  if (s.startsWith('source_site') || s.startsWith('source')) return 'source'
  if (s.startsWith('manual')) return 'manual'
  return s.split('+')[0]
}

/** Trust badge text, e.g. "USDA · high" or "estimated · low". */
export function trustBadge(n: RecipeNutrition | undefined): string {
  if (!n) return ''
  const provider = sourceLabel(n.source)
  const confidence = n.confidence || 'unknown'
  return `${provider} · ${confidence}`
}

/**
 * Client-callable barcode lookup — hits the auth-gated /api/barcode-lookup route
 * (the lookup itself runs server-side to set OFF's courtesy header and dodge CORS).
 * Pass a fresh Firebase ID token (`await user.getIdToken()`). Returns the route's
 * response: a product (with `found: true`) or `{ found: false }`. Throws on
 * HTTP/network failure so callers can distinguish "not found" from "lookup broke".
 */
export async function lookupBarcode(barcode: string, idToken: string): Promise<BarcodeLookupResponse> {
  const res = await fetch('/api/barcode-lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ barcode }),
  })
  if (!res.ok) {
    const d = await res.json().catch(() => ({}))
    throw new Error(d.error || 'Barcode lookup failed')
  }
  return res.json()
}
