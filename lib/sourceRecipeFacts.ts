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
  ingredients?: string[]
  instructions?: string[]
  /** A single allowlisted Recipe entity; never cross-combine source arrays. */
  recipe?: Record<string, unknown>
  unsupportedRecipe?: boolean
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

/**
 * Shared allowlist for server extraction and browser capture. Keep this function
 * self-contained: the bookmarklet embeds this exact implementation. Unrecognized
 * fields/state are never serialized; invalid rows remain invalid, never filtered.
 */
export function recipeEvidenceFromJsonLd(value: unknown): Record<string, unknown>[] {
  function record(v: unknown): v is Record<string, unknown> {
    return !!v && typeof v === 'object' && !Array.isArray(v)
  }
  function scalar(v: unknown): string | number | null {
    return typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? v : null
  }
  function image(v: unknown, depth = 0): unknown {
    if (depth > 32) return null
    if (typeof v === 'string') return v
    if (Array.isArray(v)) return v.map(x => image(x, depth + 1))
    if (record(v)) return { url: scalar(v.url ?? v.contentUrl) }
    return null
  }
  function method(v: unknown, depth = 0): unknown {
    if (depth > 32) return null
    if (typeof v === 'string') return v
    if (Array.isArray(v)) return v.map(x => method(x, depth + 1))
    if (!record(v)) return null
    const types = Array.isArray(v['@type']) ? v['@type'] : [v['@type']]
    const type = types.find(x => x === 'HowToStep' || x === 'HowToSection' || x === 'ListItem')
    if (type === 'HowToStep') return { '@type': type, text: scalar(v.text) }
    if (type === 'HowToSection') return { '@type': type, itemListElement: method(v.itemListElement, depth + 1) }
    if (type === 'ListItem') return { '@type': type, item: method(v.item, depth + 1) }
    return null
  }
  function visit(v: unknown, depth = 0): Record<string, unknown>[] {
    // Unknown deep graph content must keep selection ambiguous, never hide a
    // second Recipe and accidentally promote the first node's rows.
    if (depth > 32) return [{ '@type': 'Recipe' }]
    if (Array.isArray(v)) return v.flatMap(x => visit(x, depth + 1))
    if (!record(v)) return []
    const type = v['@type']
    const result: Record<string, unknown>[] = []
    if (type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))) {
      const r: Record<string, unknown> = { '@type': 'Recipe' }
      for (const key of ['name', 'description', 'recipeCuisine', 'recipeCategory', 'recipeYield', 'prepTime', 'cookTime', 'totalTime']) {
        if (v[key] !== undefined) r[key] = scalar(v[key])
      }
      if (v.image !== undefined) r.image = image(v.image)
      if (v.recipeIngredient !== undefined) {
        r.recipeIngredient = Array.isArray(v.recipeIngredient) ? v.recipeIngredient.map(scalar) : null
      }
      if (v.recipeInstructions !== undefined) r.recipeInstructions = method(v.recipeInstructions)
      if (record(v.nutrition)) {
        const n: Record<string, unknown> = {}
        for (const key of ['calories', 'proteinContent', 'carbohydrateContent', 'fatContent', 'fiberContent', 'sugarContent', 'servingSize']) {
          if (v.nutrition[key] !== undefined) n[key] = scalar(v.nutrition[key])
        }
        r.nutrition = n
      }
      result.push(r)
    }
    if (v['@graph'] !== undefined) result.push(...visit(v['@graph'], depth + 1))
    return result
  }
  return visit(value)
}

function ingredientRows(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.length || value.some(v => typeof v !== 'string' || !v.trim())) return undefined
  return value.map(v => (v as string).trim())
}

function instructionRows(value: unknown): string[] | undefined {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : undefined
  if (Array.isArray(value)) {
    if (!value.length) return undefined
    const parts = value.map(instructionRows)
    return parts.every(v => v !== undefined) ? parts.flatMap(v => v!) : undefined
  }
  if (!isRecord(value)) return undefined
  if (value['@type'] === 'HowToStep') return instructionRows(value.text)
  if (value['@type'] === 'HowToSection') return instructionRows(value.itemListElement)
  if (value['@type'] === 'ListItem') return instructionRows(value.item)
  return undefined
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
  const recipes = jsonLdBlocks(html).flatMap(recipeEvidenceFromJsonLd)
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
  const recipe = recipes.length === 1 ? recipes[0] : undefined
  const ingredients = ingredientRows(recipe?.recipeIngredient)
  const instructions = instructionRows(recipe?.recipeInstructions)
  // Bounds reject whole recipes in the route. They must never become partial
  // authoritative arrays or silently fall back to a plausible model replacement.
  const unsupportedRecipe = !!(
    (ingredients && (ingredients.length > 200 || ingredients.some(row => row.length > 2_000))) ||
    (instructions && (instructions.length > 150 || instructions.some(row => row.length > 4_000)))
  )
  return {
    imageURL: imageURL || microdataImage(html, pageUrl) || ogImage(html, pageUrl),
    ...(nutrition ? { nutrition } : {}),
    ...(recipe ? { recipe } : {}),
    ...(ingredients ? { ingredients } : {}),
    ...(instructions ? { instructions } : {}),
    ...(unsupportedRecipe ? { unsupportedRecipe } : {}),
  }
}
