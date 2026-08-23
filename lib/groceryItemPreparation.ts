// ─── Shared grocery-item preparation pipeline ────────────────────────────────
//
// One pure, deterministic, Firebase-free, AI-free, UI-free function used at
// BOTH grocery entry points:
//   recipe ingredient line  → prepareGroceryItem → addRecipeIngredientsToGrocery (lib/userdata.ts)
//   manual grocery add      → prepareGroceryItem → handleAddItem (app/grocery/page.tsx)
//
// This is a behavior-preserving consolidation (2026-08-23) of preparation logic
// that was previously duplicated/divergent between the two call sites. It owns
// ONLY the deterministic "raw input → candidate item" step. It intentionally
// does NOT own:
//   - Firestore reads/writes
//   - existing-item identity lookup or the merge decision itself
//     (see mergeQuantities/convertQuantity in lib/ingredientParser.ts)
//   - sourceRecipeIDs tracking
//   - timestamps
//   - React state / UI / toasts
//   - AI calls — the manual-add per-item AI fallback for an ambiguous line
//     (POST /api/grocery-cleanup {mode:'parse-line'}) is async and stays in
//     app/grocery/page.tsx; its RESOLVED result is fed in via `parsedOverride`
//     below rather than re-parsed here.
//
// It composes three existing single-purpose, dependency-free modules and adds
// no new vocabulary, category rule, or heuristic of its own:
//   - lib/ingredientParser.ts   → parseIngredient, normalizeNoun
//   - lib/groceryCategories.ts  → categorizeIngredient
//   - lib/recipeContent.ts      → isIngredientSubheader, isExplicitUrl
// It lives in its own module (rather than lib/ingredientParser.ts) specifically
// so those three stay single-purpose and import-free of each other — see the
// header comment on lib/ingredientParser.ts ("single source of truth for
// measurement/unit vocabulary").

import { parseIngredient, normalizeNoun } from './ingredientParser'
import { categorizeIngredient, type GroceryCategory } from './groceryCategories'
import { isExplicitUrl, isIngredientSubheader } from './recipeContent'

export interface PrepareGroceryItemInput {
  /** The raw ingredient line (recipe path) or the typed item name (manual path). */
  raw: string
  /**
   * A pre-resolved {quantity, unit, name} split to use INSTEAD of calling
   * parseIngredient(raw) again. Used only by the manual-add path after its
   * per-item AI fallback has already resolved an ambiguous line (or decided
   * not to) — reproduces manual-add's historic behavior of using the resolved
   * fields directly with no confidence gating.
   */
  parsedOverride?: { quantity: string; unit: string; name: string }
  /** An explicit quantity from a separate UI field; non-empty wins over the resolved quantity. */
  quantityOverride?: string
  /** An explicit unit from a separate UI field; non-empty wins over the resolved unit. */
  unitOverride?: string
  /** An explicit manual category selection; always wins over automatic categorization when provided. */
  categoryOverride?: GroceryCategory
  /**
   * Apply the recipe-ingestion content safeguards: reject a recognized shared
   * ingredient subheader or a complete explicit HTTP(S) URL (checked both on
   * the raw line and on the parsed name). Recipe-derived additions must set
   * this true. Manual additions leave it false/omitted — a manually typed
   * line is something the user deliberately entered, not scraped recipe
   * content, and has never been rejected on these grounds.
   */
  rejectContentArtifacts?: boolean
}

export interface PreparedGroceryItem {
  quantity: string
  unit: string
  name: string
  normalizedName: string
  category: GroceryCategory
  /** parseIngredient's confidence for this line; always 'high' when parsedOverride was supplied. */
  confidence: 'high' | 'low'
}

/**
 * Prepare one candidate grocery item from a raw/typed line. Pure, deterministic,
 * never throws. Returns null for input that must be rejected before it ever
 * reaches identity lookup, quantity merging, or persistence: an empty line, or
 * — only when `rejectContentArtifacts` is set — a recognized ingredient
 * subheader or a complete explicit URL.
 */
export function prepareGroceryItem(input: PrepareGroceryItemInput): PreparedGroceryItem | null {
  const raw = input.raw || ''
  const trimmed = raw.trim()
  if (!trimmed) return null

  if (input.rejectContentArtifacts && (isIngredientSubheader(trimmed) || isExplicitUrl(trimmed))) {
    return null
  }

  let quantity: string
  let unit: string
  let name: string
  let confidence: 'high' | 'low'

  if (input.parsedOverride) {
    name = (input.parsedOverride.name || '').trim() || trimmed
    quantity = input.parsedOverride.quantity || ''
    unit = input.parsedOverride.unit || ''
    confidence = 'high'
  } else {
    const parsed = parseIngredient(raw)
    const parsedName = parsed.name.trim()

    if (input.rejectContentArtifacts && (!parsedName || isExplicitUrl(parsedName))) {
      return null
    }

    const usable = parsed.confidence === 'high'
    name = usable && parsedName ? parsedName : trimmed
    quantity = usable ? parsed.quantity : ''
    unit = usable ? parsed.unit : ''
    confidence = parsed.confidence
  }

  quantity = input.quantityOverride?.trim() || quantity
  unit = input.unitOverride?.trim() || unit

  return {
    quantity,
    unit,
    name,
    normalizedName: normalizeNoun(name),
    category: input.categoryOverride ?? categorizeIngredient(name),
    confidence,
  }
}
