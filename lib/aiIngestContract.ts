import { z } from 'zod'
import { RECIPE_CATEGORIES } from '@/lib/recipeCategories'

export const RECIPE_SCHEMA = z.object({
  title: z.string().max(300),
  cuisine: z.string().max(100),
  category: z.enum(RECIPE_CATEGORIES),
  ingredients: z.array(z.string().max(2_000)).max(200),
  instructions: z.array(z.string().max(4_000)).max(150),
  imageURL: z.string().max(2_048),
  description: z.string().max(4_000),
  servings: z.string().max(100),
  prepTime: z.string().max(100),
  cookTime: z.string().max(100),
})

const CATEGORY_VOCABULARY = JSON.stringify(RECIPE_CATEGORIES)

export const SYSTEM_PROMPT = `You are a recipe parser. Given HTML or text content from a webpage or pasted text, extract the recipe and return ONLY a valid JSON object with no markdown, no backticks, no explanation.

Return exactly this shape:
{
  "title": "string",
  "cuisine": "string (lowercase, e.g. italian, mexican, asian)",
  "category": "one exact value from ${CATEGORY_VOCABULARY}",
  "ingredients": ["ingredient 1", "ingredient 2"],
  "instructions": ["Step 1 text", "Step 2 text"],
  "imageURL": "string or empty string",
  "description": "1-2 sentence description or empty string",
  "servings": "string or empty string",
  "prepTime": "string or empty string",
  "cookTime": "string or empty string"
}

Rules:
- ingredients: each item is a full ingredient line e.g. "2 cups all-purpose flour"
- instructions: each item is one complete step, no step numbers
- cuisine: single word or short phrase, always lowercase
- category: pick the closest match from the list above
- If you cannot find a value, use an empty string
- Return ONLY the JSON object, nothing else`
