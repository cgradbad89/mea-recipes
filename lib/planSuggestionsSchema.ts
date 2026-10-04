import { z } from 'zod'
import { RECIPE_CATEGORIES } from '@/lib/recipeCategories'

export const PLAN_SUGGESTIONS_SCHEMA = z.object({
  existing: z.array(z.object({
    title: z.string().max(300),
    reason: z.string().max(1_000),
  })).max(3),
  new: z.array(z.object({
    title: z.string().max(300),
    cuisine: z.string().max(100),
    category: z.enum(RECIPE_CATEGORIES),
    reason: z.string().max(1_000),
  })).max(3),
})
