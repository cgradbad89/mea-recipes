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

