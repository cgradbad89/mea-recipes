export const RECIPE_CATEGORIES = [
  'Chicken & Poultry',
  'Beef & Pork',
  'Seafood',
  'Vegetarian Mains',
  'Pasta, Noodles & Rice',
  'Salads & Bowls',
  'Soups, Stews & Chili',
  'Breakfast',
  'Snacks',
  'Drinks',
  'Sauces & Condiments',
  'Sides',
] as const

export type RecipeCategory = (typeof RECIPE_CATEGORIES)[number]

export type RecipeCategoryResolutionSource =
  | 'canonical'
  | 'direct-legacy-alias'
  | 'recipe-specific-legacy'

export interface RecipeCategoryResolution {
  category: RecipeCategory
  source: RecipeCategoryResolutionSource
}

const CANONICAL_CATEGORY_SET = new Set<string>(RECIPE_CATEGORIES)

const DIRECT_LEGACY_ALIASES: Readonly<Record<string, RecipeCategory>> = {
  Chicken: 'Chicken & Poultry',
  Beef: 'Beef & Pork',
  Pork: 'Beef & Pork',
  Vegetarian: 'Vegetarian Mains',
  'Pasta Noodles & Rice': 'Pasta, Noodles & Rice',
  'Soups Stews & Chili': 'Soups, Stews & Chili',
  'Soup/Stew': 'Soups, Stews & Chili',
  'Breakfast Snacks & Sides': 'Sides',
}

// Temporary read-only compatibility for heterogeneous production values. Each
// mapping is deliberately scoped to both the stored raw value and exact recipe ID;
// arbitrary future "Other" or combined-category records remain unresolved.
const RECIPE_SPECIFIC_LEGACY_ALIASES: Readonly<Record<string, Readonly<Record<string, RecipeCategory>>>> = {
  'Breakfast, Snacks & Sides': {
    bread: 'Sides',
    'cauliflower-breakfast-muffins': 'Breakfast',
    'chinese-chili-oil': 'Sauces & Condiments',
    'grownup-mustard-sauce-recipe': 'Sauces & Condiments',
    'hearthealthy-peanut-butter-protein-bars': 'Snacks',
    'honey-sriracha-roasted-brussels-sprouts': 'Sides',
    'huevos-rotos-broken-eggs': 'Breakfast',
    'jam-oat-bars': 'Snacks',
    'mexican-roasted-cauliflower': 'Sides',
    'mexican-roasted-zucchini': 'Sides',
    'mexican-street-corn': 'Sides',
    'peanut-butter-oat-protein-shake': 'Drinks',
    pesto: 'Sauces & Condiments',
    smoothies: 'Drinks',
    'traditional-southern-butter-butter-beans-recipe': 'Sides',
    'yogurt-dill-sauce': 'Sauces & Condiments',
  },
  Other: {
    '199': 'Sides',
    '190': 'Sides',
    '167': 'Snacks',
  },
  'Non-Recipe / Notes': {
    'rising-sun-mazcal': 'Drinks',
  },
  // Approved content outlier: its current stored value is canonical-looking but
  // known to be the wrong classification until the later data migration.
  'Vegetarian Mains': {
    'maple-roasted-candied-pecans': 'Snacks',
  },
}

export function isRecipeCategory(value: unknown): value is RecipeCategory {
  return typeof value === 'string' && CANONICAL_CATEGORY_SET.has(value)
}

export function normalizeRecipeCategory(
  value: unknown,
  recipeID?: string,
): RecipeCategory | null {
  return resolveRecipeCategory(value, recipeID)?.category ?? null
}

/**
 * Resolve a stored category while retaining where the approved classification
 * came from. Migration tooling uses the source to distinguish canonical values,
 * deterministic aliases, and exact recipe-specific compatibility without
 * maintaining a second taxonomy.
 */
export function resolveRecipeCategory(
  value: unknown,
  recipeID?: string,
): RecipeCategoryResolution | null {
  if (typeof value !== 'string' || value.trim() === '') return null

  if (recipeID) {
    const recipeSpecific = RECIPE_SPECIFIC_LEGACY_ALIASES[value]?.[recipeID]
    if (recipeSpecific) {
      return { category: recipeSpecific, source: 'recipe-specific-legacy' }
    }
  }

  if (isRecipeCategory(value)) return { category: value, source: 'canonical' }
  const directAlias = DIRECT_LEGACY_ALIASES[value]
  return directAlias
    ? { category: directAlias, source: 'direct-legacy-alias' }
    : null
}
