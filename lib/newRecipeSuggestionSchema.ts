import { z } from 'zod'
import { RECIPE_CATEGORIES } from '@/lib/recipeCategories'

export const NEW_SUGGESTION_SCHEMA = z.object({
  title: z.string().max(300),
  cuisine: z.string().max(100),
  category: z.enum(RECIPE_CATEGORIES),
  description: z.string().max(1_000),
  searchQuery: z.string().max(500),
})
