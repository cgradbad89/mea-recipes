import type { RecipeCategory } from '@/lib/recipeCategories'

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

export interface AIProvenance {
  provider: string
  model: string
  prompt_version: string
}

export interface RecipeNutrition extends NutritionMacros {
  serving_size?: string          // human-readable, e.g. "1 of 4" or "1 of 4 (assumed)"
  servings?: number              // count used to derive per-serving (may be an assumed default)
  total?: NutritionMacros        // whole-recipe basis — durable source of truth
  source?: string                // "source_site" | "usda" | "usda+ai" | "manual" (+ optional suffix)
  confidence?: string            // "high" | "medium" | "low"
  ai_provenance?: AIProvenance   // present when an AI fallback contributed to this calculation
  computed_at?: unknown          // Firestore timestamp
}

export type CookingMappingConfidence = 'high'

export type CookingMappingProvenance = 'deterministic'

export type CookingIngredientUsageKind = 'all' | 'partial' | 'remaining'

export interface CookingIngredientUsage {
  kind: CookingIngredientUsageKind
  quantityText?: string
}

export interface CookingStepIngredientReference {
  ingredientIndex: number
  confidence: CookingMappingConfidence
  provenance: CookingMappingProvenance
  usage?: CookingIngredientUsage
}

export interface CookingStepMapping {
  instructionIndex: number
  ingredients: CookingStepIngredientReference[]
  unresolvedReason?: 'ambiguous' | 'implicit-reference' | 'prepared-component' | 'no-ingredient-use'
}

export interface CookingStepIngredientMap {
  schemaVersion: 1
  parserVersion: string
  engineVersion: string
  sourceHash: string
  steps: CookingStepMapping[]
}

export interface Recipe {
  id: string
  recipeID: string
  title: string
  content: string
  // Production Firestore still contains legacy category strings. Keep the read
  // model tolerant; canonical runtime values and shared writes use RecipeCategory.
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
  // Explicit main/side default for meal planning (Batch 5.1). Lives on the SHARED
  // recipe doc (main/side is a property of the dish). When unset, the plan falls
  // back to category-derived role. Add-time precedence: per-week entry override >
  // defaultRole > category-derived. Editing it never rewrites existing plan entries.
  defaultRole?: 'main' | 'side'
}

export interface RecipeOverrides {
  title?: string
  cuisine?: string
  // Legacy personal overrides remain in Firestore until the later migration.
  category?: string
  content?: string
  servings?: number   // per-user servings override (see lib/userdata.ts RecipeMeta.overrides)
}

export type Category = RecipeCategory
