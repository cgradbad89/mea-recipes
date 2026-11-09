import { normalizeRecipeCategory } from './recipeCategories'

export type PlannedRole = 'main' | 'side'

/**
 * One planned recipe within a week (Batch 5). `day` is an ISO date (YYYY-MM-DD)
 * inside that week, or null = "Unscheduled". `role` is main/side — auto-defaulted
 * from the recipe's category on add, user-overridable per entry. `slot` is RESERVED
 * for a future meal-slot dimension (dinners-only today); it is never written now,
 * but lives in the type so adding slots later needs no second migration.
 */
export interface PlannedEntry {
  recipeID: string
  day: string | null
  role: PlannedRole
  slot?: string | null
}

/**
 * On disk a planned element is EITHER a legacy bare recipeID string (pre-Batch-5
 * docs) OR a PlannedEntry object. Always normalize on read; writers upgrade any
 * entry they touch to the object form — a lossless read-time migration, no bulk wipe.
 */
export type PlannedElement = string | PlannedEntry

// Category-derived defaults normalize legacy read values first. Only the two
// canonical accompaniment categories are sides; unresolved values fail safely
// to main. An optional recipe ID enables exact heterogeneous legacy mappings.
export function deriveRoleFromCategory(
  category?: string | null,
  recipeID?: string,
): PlannedRole {
  const canonical = normalizeRecipeCategory(category, recipeID)
  return canonical === 'Sides' || canonical === 'Sauces & Condiments' ? 'side' : 'main'
}

export function isPlannedRole(v: unknown): v is PlannedRole {
  return v === 'main' || v === 'side'
}

/**
 * Read-time adapter. Normalize one planned element (legacy string OR object) into a
 * full PlannedEntry. Legacy strings → { recipeID, day: null, role } i.e. Unscheduled
 * with a role derived from the recipe's category (via `resolveCategory` when
 * supplied, else 'main'). Never wipes, never guesses a day — lossless.
 */
export function normalizePlannedEntry(
  el: PlannedElement,
  resolveCategory?: (recipeID: string) => string | null | undefined,
): PlannedEntry {
  if (typeof el === 'string') {
    return { recipeID: el, day: null, role: deriveRoleFromCategory(resolveCategory?.(el), el) }
  }
  const entry: PlannedEntry = {
    recipeID: el.recipeID,
    day: el.day ?? null,
    role: isPlannedRole(el.role)
      ? el.role
      : deriveRoleFromCategory(resolveCategory?.(el.recipeID), el.recipeID),
  }
  if (el.slot !== undefined) entry.slot = el.slot
  return entry
}

export function normalizePlanned(
  planned: PlannedElement[] | undefined,
  resolveCategory?: (recipeID: string) => string | null | undefined,
): PlannedEntry[] {
  return (planned || []).map(el => normalizePlannedEntry(el, resolveCategory))
}

