import type { NutritionMacros, RecipeNutrition } from '@/types/recipe'
import { servingSizeLabel } from './nutrition'

/**
 * Deterministic facts published in recipe structured data. This is deliberately
 * small: it is used before AI parsing, and only returns nutrition when every
 * macro needed by MEA's durable-total contract is present and unambiguous.
 */
export interface SourceRecipeFacts {
  imageURL: string
  nutrition?: RecipeNutrition
}

type JsonRecord = Record<string, unknown>

const MACRO_FIELDS = {
  calories: 'calories',
  protein_g: 'proteinContent',
  carbs_g: 'carbohydrateContent',
  fat_g: 'fatContent',
  fiber_g: 'fiberContent',
  sugar_g: 'sugarContent',
} as const

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasRecipeType(value: JsonRecord): boolean {
  const type = value['@type']
  return type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))
}

function recipeNodes(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.flatMap(recipeNodes)
  if (!isRecord(value)) return []
  const nodes = hasRecipeType(value) ? [value] : []
  if (Array.isArray(value['@graph'])) nodes.push(...recipeNodes(value['@graph']))
  return nodes
}

function normalizeNumber(value: unknown, kind: 'calories' | 'grams'): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 100_000 ? value : null
  if (typeof value !== 'string') return null
  const text = value.trim()
  const pattern = kind === 'calories'
    ? /^(\d+(?:\.\d+)?)\s*(?:kcal|cal(?:ories)?)?\s*$/i
    : /^(\d+(?:\.\d+)?)\s*(?:g|grams?)?\s*$/i
  const match = text.match(pattern)
  if (!match) return null
  const numeric = Number(match[1])
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100_000 ? numeric : null
}

function normalizeServings(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 && value <= 10_000 ? value : null
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^(?:makes?\s+|serves?\s+)?(\d+(?:\.\d+)?)\s*(?:servings?|portions?|people)?\s*$/i)
  if (!match) return null
  const servings = Number(match[1])
  return Number.isFinite(servings) && servings > 0 && servings <= 10_000 ? servings : null
}

function roundForStorage(key: keyof NutritionMacros, value: number): number {
  return key === 'calories' ? Math.round(value) : Math.round(value * 10) / 10
}

/** Convert trusted structured NutritionInformation into MEA's complete recipe contract. */
export function publisherNutritionFromStructuredData(value: unknown): RecipeNutrition | undefined {
  if (!isRecord(value)) return undefined
  const values = {} as NutritionMacros
  for (const [key, field] of Object.entries(MACRO_FIELDS) as [keyof NutritionMacros, string][]) {
    const numeric = normalizeNumber(value[field], key === 'calories' ? 'calories' : 'grams')
    // A missing or malformed field is unknown, never a zero-filled macro.
    if (numeric === null) return undefined
    values[key] = roundForStorage(key, numeric)
  }

  const servings = normalizeServings(value.recipeYield ?? value.servings)
  // Schema.org nutrition is per serving. Without a reliable count, we cannot
  // safely create the durable whole-recipe totals MEA requires.
  if (servings === null) return undefined

  const total = {} as NutritionMacros
  for (const key of Object.keys(values) as (keyof NutritionMacros)[]) {
    total[key] = roundForStorage(key, values[key] * servings)
  }
  const sourceServingSize = typeof value.servingSize === 'string' && value.servingSize.trim()
    ? value.servingSize.trim().slice(0, 100)
    : undefined

  return {
    ...values,
    serving_size: sourceServingSize || servingSizeLabel(servings),
    servings,
    total,
    source: 'source_site',
    confidence: 'high',
  }
}

function isUsableImageUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
    && !/(?:^|[\/_\-.])(icon|logo|avatar)(?:[\/_\-.]|$)/i.test(value)
}

/** Resolve source-provided image URLs without downloading or rehosting them. */
export function normalizeRecipeImageUrl(value: unknown, pageUrl?: string): string {
  if (typeof value !== 'string' || !value.trim()) return ''
  try {
    const url = new URL(value.trim(), pageUrl || undefined)
    return isUsableImageUrl(url.href) ? url.href : ''
  } catch {
    return ''
  }
}

function imageFromStructuredValue(value: unknown, pageUrl?: string): string {
  if (typeof value === 'string') return normalizeRecipeImageUrl(value, pageUrl)
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const image = imageFromStructuredValue(candidate, pageUrl)
      if (image) return image
    }
    return ''
  }
  if (isRecord(value)) return normalizeRecipeImageUrl(value.url ?? value.contentUrl, pageUrl)
  return ''
}

function jsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = []
  const pattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  for (const match of html.matchAll(pattern)) {
    try { blocks.push(JSON.parse(match[1])) } catch { /* malformed metadata is non-fatal */ }
  }
  return blocks
}

function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))
  return match?.[2]
}

function microdataImage(html: string, pageUrl?: string): string {
  const recipeScope = /<[^>]*itemtype=["'][^"']*schema\.org\/Recipe[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/i.exec(html)?.[0] || html
  const matches = recipeScope.match(/<[^>]*itemprop=["'][^"']*image[^"']*["'][^>]*>/gi) || []
  for (const tag of matches) {
    const image = normalizeRecipeImageUrl(attribute(tag, 'content') ?? attribute(tag, 'src') ?? attribute(tag, 'href'), pageUrl)
    if (image) return image
  }
  return ''
}

function ogImage(html: string, pageUrl?: string): string {
  const tags = html.match(/<meta\b[^>]*>/gi) || []
  for (const tag of tags) {
    const property = attribute(tag, 'property') ?? attribute(tag, 'name')
    if (property?.toLowerCase() !== 'og:image') continue
    const image = normalizeRecipeImageUrl(attribute(tag, 'content'), pageUrl)
    if (image) return image
  }
  return ''
}

/** Extract Recipe JSON-LD facts, then recipe microdata, then Open Graph image. */
export function extractSourceRecipeFacts(html: string, pageUrl?: string): SourceRecipeFacts {
  const recipes = jsonLdBlocks(html).flatMap(recipeNodes)
  let imageURL = ''
  let nutrition: RecipeNutrition | undefined
  for (const recipe of recipes) {
    if (!imageURL) imageURL = imageFromStructuredValue(recipe.image, pageUrl)
    if (!nutrition) {
      const rawNutrition = isRecord(recipe.nutrition) ? {
        ...recipe.nutrition,
        recipeYield: recipe.recipeYield,
      } : undefined
      nutrition = publisherNutritionFromStructuredData(rawNutrition)
    }
  }
  return {
    imageURL: imageURL || microdataImage(html, pageUrl) || ogImage(html, pageUrl),
    ...(nutrition ? { nutrition } : {}),
  }
}
