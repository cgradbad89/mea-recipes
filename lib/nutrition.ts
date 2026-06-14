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
 * The servings count actually in effect for the viewer: their personal override
 * when set to a positive number, else the recipe's shared stored basis
 * (`nutrition.servings`). Never mutates anything — pure derivation. This is the
 * denominator behind per-user per-serving macros: total ÷ effectiveServings.
 */
export function effectiveServings(
  n: RecipeNutrition | undefined,
  override: number | undefined | null,
): number | undefined {
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) return override
  return n?.servings
}

/**
 * Per-serving macros AS THE VIEWER SEES THEM: derived live from the durable
 * whole-recipe `total` divided by the viewer's effective servings (their
 * override if set, else the shared default). Falls back to the recipe's own
 * per-serving basis when no `total` exists (an override can't be applied without
 * the whole-recipe total). The shared `nutrition.total` is never written here.
 */
export function perServingForViewer(
  n: RecipeNutrition | undefined,
  override: number | undefined | null,
): NutritionMacros | null {
  if (!n) return null
  const derived = perServingFromTotal(n.total, effectiveServings(n, override))
  return derived || perServingOf(n)
}

// ── Amount-entry helpers (LogFoodSheet servings/grams entry) ─────────────────

/** Trim a quantity to ≤2 decimals with no trailing zeros: 2→"2", 1.5→"1.5", 0.45→"0.45". */
export function prettyAmount(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return String(Math.round(n * 100) / 100)
}

/** A servings amount as a human label: "1 serving", "1.5 servings". */
export function servingsAmountLabel(n: number): string {
  return `${prettyAmount(n)} ${n === 1 ? 'serving' : 'servings'}`
}

/**
 * Pull a gram weight out of a free-text serving label, e.g. "30 g" → 30,
 * "2 cookies (30 g)" → 30, "1 cup (240 ml)" → null. Ignores mg/kg/ml.
 */
export function gramsFromServingLabel(label?: string | null): number | null {
  if (!label) return null
  const matches = [...label.matchAll(/(\d+(?:\.\d+)?)\s*(?:grams?|g)\b/gi)]
  if (!matches.length) return null
  const v = parseFloat(matches[matches.length - 1][1])   // last "<n> g" wins ("2 cookies (30 g)")
  return Number.isFinite(v) && v > 0 ? v : null
}

/** Context shown above the amount entry: serving size, servings-per-container, per-100g note. */
export interface ServingContext {
  servingLabel?: string | null              // e.g. "30 g", "1 cup (240 ml)"
  gramsPerServing?: number | null           // numeric fallback when no label
  servingsPerContainer?: number | null
  containerKind?: 'container' | 'recipe'
  per100g?: boolean                          // macros are per 100 g, not per declared serving
}

function servingSizeText(label?: string | null, grams?: number | null): string | null {
  const l = (label || '').trim()
  if (l) return l
  if (typeof grams === 'number' && grams > 0) return `${prettyAmount(grams)} g`
  return null
}

/**
 * Display lines for a result's serving context — omits anything not present, so
 * a missing serving size or container count simply doesn't render (no "undefined").
 */
export function servingContextLines(ctx: ServingContext): string[] {
  const lines: string[] = []
  if (ctx.containerKind !== 'recipe') {
    const size = servingSizeText(ctx.servingLabel, ctx.gramsPerServing)
    if (size) lines.push(`1 serving = ${size}`)
  }
  const n = ctx.servingsPerContainer
  if (typeof n === 'number' && Number.isFinite(n) && n >= 1.5) {
    lines.push(ctx.containerKind === 'recipe'
      ? `Recipe makes ${prettyAmount(Math.round(n))} servings`
      : `≈ ${prettyAmount(Math.round(n * 10) / 10)} servings per container`)
  }
  if (ctx.per100g) lines.push('Macros shown per 100 g')
  return lines
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
