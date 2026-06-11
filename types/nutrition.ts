// Nutrition tracker data models (Surfaces 2-5). See nutrition-tracker-spec.md
// "Shared Data Models". NutritionMacros (the six tracked values) lives in
// types/recipe.ts and is reused here.
import type { NutritionMacros } from './recipe'

export type Meal = 'breakfast' | 'lunch' | 'snack' | 'dinner'

export type LogEntryType = 'recipe' | 'quick_food' | 'manual'

// 'openfoodfacts' / 'usda_branded' are packaged-product sources from the barcode
// lookup (app/api/barcode-lookup) — a scanned product logs as a quick_food whose
// source reflects which provider answered. See lib/nutritionEngine lookupFoodByBarcode.
export type LogSource = 'recipe' | 'usda' | 'ai_estimate' | 'manual' | 'openfoodfacts' | 'usda_branded'

/**
 * One consumed item. Firestore path: users/{uid}/nutrition/root/log/{entryId}
 * (user-scoped subcollection following the existing users/{uid}/{area}/root/*
 * convention — see lib/userdata.ts).
 *
 * `nutrition` is a SNAPSHOT of totals for this entry (per-serving ×
 * servings_eaten). Editing the source recipe later never rewrites history.
 *
 * `is_cook_event` is true only when logged via "mark cooked" (Cooking Mode or
 * the plan checkmark) — those entries are the only ones tied to the plan.
 * Leftover/quick logs are false and never touch the plan.
 */
export interface ConsumptionEntry {
  id: string
  date: unknown            // Firestore Timestamp — when it was eaten
  meal: Meal
  type: LogEntryType
  is_cook_event: boolean
  recipe_id: string | null
  name: string
  servings_eaten: number
  nutrition: NutritionMacros
  source: LogSource
  created_at: unknown      // Firestore serverTimestamp
  userId: string
}

/** Daily targets. Firestore path: users/{uid}/nutrition/root/goals/daily */
export interface NutritionGoals extends NutritionMacros {
  updated_at?: unknown
}

/** Starred quick-foods. Firestore path: users/{uid}/nutrition/root/savedFoods/{foodId} */
export interface SavedFood {
  id: string
  name: string
  nutrition: NutritionMacros   // per serving
  source: 'usda' | 'ai_estimate' | 'manual'
  created_at?: unknown
}

// ── Barcode lookup (packaged products) ──────────────────────────────────────
// Server contract for app/api/barcode-lookup. A barcode (UPC/EAN) resolves to a
// packaged product via Open Food Facts (crowdsourced → never "high" confidence)
// then USDA's branded dataset. `basis` says whether the macros are per declared
// serving or per 100 g — the camera/log UI must NOT treat per_100g as a serving.
export type BarcodeBasis = 'per_serving' | 'per_100g'
export type BarcodeSource = 'openfoodfacts' | 'usda_branded'

/** A barcode hit (the engine omits `found`; the route adds it). */
export interface BarcodeProduct {
  name: string
  nutrition: NutritionMacros
  serving_size: string | null      // declared serving label, e.g. "30 g" (null if unknown)
  source: BarcodeSource
  confidence: 'medium' | 'low'     // OFF is crowdsourced; USDA branded → medium
  basis: BarcodeBasis
}

/** Route response shape: a hit carries `found: true`, a miss is `{ found: false }`. */
export type BarcodeLookupResponse = (BarcodeProduct & { found: true }) | { found: false }

/** A recent distinct food derived from the log, for quick re-logging. */
export interface RecentFood {
  name: string
  nutrition: NutritionMacros   // per single serving (entry snapshot ÷ servings_eaten)
  source: LogSource
  type: LogEntryType
  recipe_id: string | null
}
