import {
  GROCERY_CATEGORIES,
  categorizeIngredient,
  normalizePersistedGroceryCategory,
  type GroceryCategory,
} from './groceryCategories'
import { normalizeNoun } from './ingredientParser'
import type { SavedGroceryItem } from './userdata'

export const USUALLY_ON_HAND_SECTION = 'Usually On Hand' as const

export interface GroceryDisplayItem {
  name: string
  isChecked?: boolean
  manualSection?: GroceryCategory
  needThisTrip?: boolean
}

export function groceryIdentity(name: string): string {
  return normalizeNoun(name)
}

export function buildSavedGroceryIdentityLookup(
  savedItems: readonly SavedGroceryItem[],
): Map<string, SavedGroceryItem> {
  const lookup = new Map<string, SavedGroceryItem>()

  for (const savedItem of savedItems) {
    const identity = groceryIdentity(savedItem.name)
    if (!identity) continue

    const existing = lookup.get(identity)
    // Historical raw-name document IDs can leave more than one saved document
    // for the same normalized identity. Prefer an explicit true value so an
    // older duplicate cannot hide the persisted preference. The dedicated
    // setter updates every exact-identity match, bringing duplicates back into
    // agreement on the next user action.
    if (!existing || (!existing.usuallyOnHand && savedItem.usuallyOnHand === true)) {
      lookup.set(identity, savedItem)
    }
  }

  return lookup
}

export function isUsuallyOnHand(
  item: Pick<GroceryDisplayItem, 'name'>,
  savedLookup: ReadonlyMap<string, SavedGroceryItem>,
): boolean {
  return savedLookup.get(groceryIdentity(item.name))?.usuallyOnHand === true
}

export function effectiveGroceryCategory(item: GroceryDisplayItem): GroceryCategory {
  if (item.manualSection) {
    return normalizePersistedGroceryCategory(item.manualSection, item.name)
  }
  return categorizeIngredient(item.name)
}

export interface DerivedGrocerySections<T extends GroceryDisplayItem> {
  categories: Record<GroceryCategory, T[]>
  usuallyOnHand: T[]
}

export function deriveGrocerySections<T extends GroceryDisplayItem>(
  items: readonly T[],
  savedItems: readonly SavedGroceryItem[],
  includeChecked: boolean,
): DerivedGrocerySections<T> {
  const categories = Object.fromEntries(
    GROCERY_CATEGORIES.map(category => [category, [] as T[]]),
  ) as Record<GroceryCategory, T[]>
  const usuallyOnHand: T[] = []
  const savedLookup = buildSavedGroceryIdentityLookup(savedItems)

  for (const item of items) {
    if (!includeChecked && item.isChecked) continue
    if (isUsuallyOnHand(item, savedLookup) && item.needThisTrip !== true) {
      usuallyOnHand.push(item)
      continue
    }
    categories[effectiveGroceryCategory(item)].push(item)
  }

  return { categories, usuallyOnHand }
}
