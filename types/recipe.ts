// Per-recipe nutrition, written by the (in-progress) nutrition backfill onto the
// shared recipes/{id} doc. See nutrition-tracker-spec.md (Surface 1) for the contract.
// `total` is the durable whole-recipe basis; per-serving values are derived as
// total[x] / servings, so correcting `servings` re-divides cleanly.
export interface NutritionMacros {
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g: number
  sugar_g: number
}

export interface RecipeNutrition extends NutritionMacros {
  serving_size?: string          // human-readable, e.g. "1 of 4" or "1 of 4 (assumed)"
  servings?: number              // count used to derive per-serving (may be an assumed default)
  total?: NutritionMacros        // whole-recipe basis — durable source of truth
  source?: string                // "source_site" | "usda" | "usda+ai" | "manual" (+ optional suffix)
  confidence?: string            // "high" | "medium" | "low"
  computed_at?: unknown          // Firestore timestamp
}

export interface Recipe {
  id: string
  recipeID: string
  title: string
  content: string
  category: string
  cuisine: string
  imageURL: string
  sourceURL: string
  sourceFile: string
  labels: string
  hasImage: string
  created: string
  modified: string
  addedBy?: string  // uid of user who added this recipe via web
  prepTime?: string
  cookTime?: string
  servings?: number          // recipe-level servings, if stored top-level on the doc
  nutrition?: RecipeNutrition
  // Set when auto-nutrition-on-publish failed/timed out: 'needs_calc' surfaces the
  // manual "Calculate nutrition" retry on the recipe detail page; 'computed' once filled.
  nutritionStatus?: 'needs_calc' | 'computed'
}

export interface RecipeOverrides {
  title?: string
  cuisine?: string
  category?: string
  content?: string
}

export type Category =
  | 'Chicken & Poultry'
  | 'Vegetarian Mains'
  | 'Salads & Bowls'
  | 'Pasta, Noodles & Rice'
  | 'Soups, Stews & Chili'
  | 'Seafood'
  | 'Beef & Pork'
  | 'Breakfast, Snacks & Sides'
