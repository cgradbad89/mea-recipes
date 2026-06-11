// Server-side nutrition lookup engine — the single shared module behind the
// backfill logic, recipe (re)computation, and live quick-food lookup.
// See nutrition-tracker-spec.md "Shared Module: Nutrition Lookup Engine".
//
// SERVER ONLY: imports firebase-admin via lib/firebaseAdmin. Never import this
// from client components — call it through /api/nutrition-lookup instead.
//
// Implements, as proven necessary during the Cowork backfill:
//  - format-aware ingredient parsing (unicode fractions, mixed numbers,
//    range→midpoint, parenthetical can sizes, blog/promo junk stripping,
//    serving-multiplier widgets, garnish/optional flagging, "plus" summation
//    for high-calorie ingredients only)
//  - USDA lookup with match validation (token-stem overlap, kcal/100g band
//    checks by food class, canonical staples table, zero-calorie penalty).
//    Known failure modes guarded: "butter beans"/"butternut" must never match
//    dairy butter; "X cups oil for frying" capped at 15% absorption.
//  - AI estimate fallback via the Anthropic API (tagged usda+ai / ai_estimate,
//    confidence medium). Degrades gracefully when ANTHROPIC_API_KEY is unset.
//  - arbitrary food-name lookup (USDA Branded/Survey first) for quick-food.

import { getAdminDb } from './firebaseAdmin'
import { parseRecipeContent } from './recipeContent'
import type { NutritionMacros, RecipeNutrition } from '@/types/recipe'
import type { BarcodeProduct } from '@/types/nutrition'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ParsedIngredient {
  raw: string
  name: string            // cleaned food name used for lookup
  grams: number | null    // resolved weight in grams; null = unquantified
  optional: boolean       // "for serving / garnish / optional" side
  fryingOilCapped: boolean
}

interface ResolvedFood {
  per100g: NutritionMacros
  matchedDescription: string
  resolvedBy: 'usda' | 'ai'
}

export interface RecipeComputeResult {
  nutrition: RecipeNutrition
  unresolved: string[]    // ingredient lines that produced no nutrition data
  flagged: string[]       // skipped/odd lines (unquantified sides, junk…)
}

export interface FoodLookupResult {
  name: string            // matched/displayed food name
  nutrition: NutritionMacros  // per serving
  servingGrams: number | null
  source: 'usda' | 'ai_estimate'
  confidence: 'high' | 'medium' | 'low'
}

const ZERO: NutritionMacros = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0 }

// ─── Quantity parsing ────────────────────────────────────────────────────────

const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅕': 0.2, '⅖': 0.4,
  '⅗': 0.6, '⅘': 0.8, '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
}

/** "1½" / "1 ½" / "½" → decimal string; leaves other text alone. */
function normalizeFractions(s: string): string {
  let out = s
  for (const [glyph, val] of Object.entries(UNICODE_FRACTIONS)) {
    // mixed number "1½" or "1 ½" → 1.5
    out = out.replace(new RegExp(`(\\d+)\\s*${glyph}`, 'g'), (_, n) => String(parseInt(n, 10) + val))
    out = out.replace(new RegExp(glyph, 'g'), String(val))
  }
  // ascii mixed numbers: "1 1/2" or "1-1/2" → 1.5
  out = out.replace(/(\d+)[\s-](\d+)\s*\/\s*(\d+)/g, (_, w, n, d) =>
    String(parseInt(w, 10) + parseInt(n, 10) / parseInt(d, 10)))
  // plain fractions "1/2" → 0.5
  out = out.replace(/(\d+)\s*\/\s*(\d+)/g, (_, n, d) =>
    String(Math.round((parseInt(n, 10) / parseInt(d, 10)) * 1000) / 1000))
  return out
}

/** Leading quantity (after normalizeFractions): handles ranges → midpoint. */
function parseLeadingQuantity(text: string): { value: number; rest: string } | null {
  const t = text.trim()
  // range: "2-3", "2 – 3", "2 to 3", "4 or 5"
  const range = t.match(/^(\d+(?:\.\d+)?)\s*(?:-|–|—|to|or)\s*(\d+(?:\.\d+)?)\b\s*(.*)$/i)
  if (range) {
    const a = parseFloat(range[1]); const b = parseFloat(range[2])
    if (b >= a) return { value: (a + b) / 2, rest: range[3] }
  }
  const single = t.match(/^(\d+(?:\.\d+)?)\s*(.*)$/)
  if (single) return { value: parseFloat(single[1]), rest: single[2] }
  const word = t.match(/^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b\s*(.*)$/i)
  if (word) return { value: NUMBER_WORDS[word[1].toLowerCase()], rest: word[2] }
  return null
}

// ─── Units & densities ───────────────────────────────────────────────────────

const VOLUME_ML: [RegExp, number][] = [
  [/^(tablespoons?|tbsps?|tbs|tbl)\b\.?/i, 14.79],
  [/^(teaspoons?|tsps?)\b\.?/i, 4.93],
  [/^(cups?|c)\b\.?/i, 236.59],
  [/^(fluid ounces?|fl\.?\s*oz)\b\.?/i, 29.57],
  [/^(milliliters?|ml)\b\.?/i, 1],
  [/^(liters?|litres?|l)\b\.?/i, 1000],
  [/^(pints?)\b\.?/i, 473.18],
  [/^(quarts?|qts?)\b\.?/i, 946.35],
]

const WEIGHT_G: [RegExp, number][] = [
  [/^(kilograms?|kgs?)\b\.?/i, 1000],
  [/^(grams?|g)\b\.?/i, 1],
  [/^(ounces?|oz)\b\.?/i, 28.35],
  [/^(pounds?|lbs?)\b\.?/i, 453.59],
]

// g/ml by food keyword — first match wins, ordered specific → general.
const DENSITY_RULES: [RegExp, number][] = [
  [/peanut butter|almond butter|tahini|nutella/i, 1.08],
  [/brown sugar/i, 0.93],
  [/powdered sugar|confectioner/i, 0.56],
  [/sugar/i, 0.85],
  [/honey|maple syrup|molasses|agave|corn syrup/i, 1.42],
  [/oil/i, 0.92],
  [/butter|margarine|ghee|lard|shortening/i, 0.95],
  [/flour|cornstarch|corn starch/i, 0.53],
  [/cocoa/i, 0.42],
  [/oats|oatmeal/i, 0.38],
  [/rice(?!\s*vinegar)/i, 0.85],
  [/breadcrumbs?|panko/i, 0.45],
  [/parmesan|cheese/i, 0.45],
  [/nuts?|almonds?|pecans?|walnuts?|cashews?|peanuts?|pistachios?/i, 0.55],
  [/spinach|lettuce|arugula|kale|greens|basil|cilantro|parsley|mint|dill|herbs/i, 0.12],
  [/shredded cabbage|cabbage|shredded carrot/i, 0.35],
  [/beans?|chickpeas?|lentils?|peas\b/i, 0.73],
  [/mayonnaise|mayo/i, 0.91],
  [/yogurt|sour cream|cream cheese/i, 1.02],
  [/broth|stock|milk|water|juice|wine|vinegar|sauce|salsa|puree|passata|coconut milk|cream/i, 1.02],
  [/onion|carrot|celery|pepper|squash|zucchini|mushroom|tomato|potato|corn|broccoli|cauliflower/i, 0.6],
]

function densityFor(name: string): number {
  for (const [re, d] of DENSITY_RULES) if (re.test(name)) return d
  return 1.0
}

// Per-item gram defaults for count-based ingredients (medium size).
const COUNT_DEFAULTS: [RegExp, number][] = [
  [/garlic cloves?|cloves? (of )?garlic/i, 5],
  [/heads? (of )?garlic/i, 50],
  [/eggs?\b/i, 50],
  [/yolks?\b/i, 17],
  [/(green onions?|scallions?|spring onions?)/i, 15],
  [/shallots?/i, 40],
  [/onions?/i, 110],
  [/carrots?/i, 61],
  [/celery (stalks?|ribs?)|stalks? (of )?celery/i, 40],
  [/sweet potato(es)?/i, 130],
  [/potato(es)?/i, 213],
  [/roma tomato(es)?|plum tomato(es)?/i, 62],
  [/cherry tomato(es)?/i, 17],
  [/tomato(es)?/i, 123],
  [/bell peppers?/i, 119],
  [/jalapen(o|õ|ô)s?|jalapeño s?|jalapeños?/i, 14],
  [/serranos?/i, 6],
  [/chipotles?/i, 10],
  [/limes?/i, 67],
  [/lemons?/i, 84],
  [/oranges?/i, 131],
  [/bananas?/i, 118],
  [/apples?/i, 182],
  [/avocados?/i, 136],
  [/(strips?|slices?|rashers?) (of )?bacon|bacon (strips?|slices?)/i, 28],
  [/slices? (of )?bread|bread slices?/i, 30],
  [/tortillas?/i, 35],
  [/(brioche )?buns?|rolls?\b/i, 60],
  [/chicken breasts?/i, 174],
  [/chicken thighs?/i, 130],
  [/chicken drumsticks?/i, 105],
  [/bay (leaf|leaves)/i, 0.2],
  [/radish(es)?/i, 9],
  [/cucumbers?/i, 201],
  [/zucchinis?|courgettes?/i, 196],
  [/ears? (of )?corn|corn (on the cob|ears?)/i, 90],
  [/cinnamon sticks?/i, 3],
]

const SIZE_MULTIPLIERS: [RegExp, number][] = [
  [/\b(extra[- ]large|x-?large|xl|jumbo)\b/i, 1.6],
  [/\blarge\b/i, 1.3],
  [/\bmedium\b/i, 1.0],
  [/\bsmall\b/i, 0.7],
]

// ─── Line-level junk / flag detection ───────────────────────────────────────

const JUNK_LINE = [
  /^https?:\/\//i,
  /^\s*[\d\s./½¼¾⅓⅔]*\s*[x×]\s*$/i,          // serving-multiplier widget: "1/2 x", "1 x", "2 x"
  /^scale$/i,
  /^n?gredients?$/i,                            // "INGREDIENTS" / OCR'd "NGREDIENTS"
  /^(yield|serves|servings|makes)\b/i,
  /click here|read (my|our|the) (article|post|guide)|read more about|learn:/i,
  /metric conversion|these recipes were created|conversion to metric|please let us know|in the comments/i,
  /^(notes?|equipment|special equipment|nutrition|video)[:.]?$/i,
  /^leftovers\./i,
  /^about the /i,
]

const HEADER_LINE = /^[^,;]{0,50}:$/  // "Tangy Slaw:", "Wet Ingredients for Chicken:"

const OPTIONAL_FLAG = /(for serving|to serve|for (the )?garnish|garnish(,| |$)|optional|if desired|for drizzling|for sprinkling|for topping|as needed|to taste)/i

const NEGLIGIBLE = /^(kosher |sea |table |coarse |morton coarse kosher |flaky |fine |freshly |fresh |cracked |ground |black |white )*(salt|pepper|peppercorns?|salt and pepper|water|ice)( and (black )?pepper)?$/i

// High-calorie classes where split "plus" quantities must be summed.
const HIGH_CAL_PLUS = /(oil|butter|cheese|nuts?|sugar|cream|mayo|chocolate|tahini)/i

const FRYING_OIL = /\boil\b.*\b(for|to)\s+(deep[- ]?)?fry(ing)?\b|\b(deep[- ]?)?fry(ing)?\s+oil\b/i
const FRYING_ABSORPTION = 0.15

// descriptors stripped when building the lookup name / tokens
const DESCRIPTOR_WORDS = new Set([
  'fresh', 'freshly', 'finely', 'coarsely', 'roughly', 'thinly', 'chopped', 'diced', 'sliced',
  'minced', 'grated', 'shredded', 'peeled', 'seeded', 'trimmed', 'halved', 'quartered', 'cut',
  'into', 'pieces', 'piece', 'inch', 'large', 'medium', 'small', 'extra', 'jumbo', 'ripe',
  'boneless', 'skinless', 'skin-on', 'bone-in', 'lean', 'reduced', 'sodium', 'low', 'unsalted',
  'salted', 'softened', 'melted', 'divided', 'plus', 'more', 'about', 'such', 'as', 'like',
  'preferably', 'optional', 'taste', 'needed', 'serving', 'serve', 'garnish', 'whole', 'a', 'an',
  'the', 'of', 'or', 'and', 'with', 'without', 'your', 'favorite', 'good', 'quality', 'store-bought',
  'homemade', 'packed', 'loosely', 'loose', 'heaping', 'level', 'roomtemperature', 'room', 'temperature',
])

function stem(t: string): string {
  if (t.length <= 3) return t
  if (t.endsWith('ies')) return t.slice(0, -3) + 'y'
  if (t.endsWith('es') && !t.endsWith('ses')) return t.slice(0, -2)
  if (t.endsWith('s')) return t.slice(0, -1)
  return t
}

function keyTokens(name: string): string[] {
  return name.toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(t => t.length > 1 && !DESCRIPTOR_WORDS.has(t))
    .map(stem)
}

// ─── Ingredient line parser ──────────────────────────────────────────────────

interface QtyUnit { grams: number | null }

/** Parse "<qty> <unit>" from the start of a fragment, resolving to grams. */
function quantityToGrams(fragment: string, foodName: string): QtyUnit & { rest: string } {
  const q = parseLeadingQuantity(fragment)
  if (!q) return { grams: null, rest: fragment }
  let rest = q.rest.trim()

  for (const [re, g] of WEIGHT_G) {
    const m = rest.match(re)
    if (m) return { grams: q.value * g, rest: rest.slice(m[0].length).trim() }
  }
  for (const [re, ml] of VOLUME_ML) {
    const m = rest.match(re)
    if (m) {
      const name = foodName || rest
      return { grams: q.value * ml * densityFor(name), rest: rest.slice(m[0].length).trim() }
    }
  }
  // count-based: "2 strips bacon", "1 large onion", "4 chicken breasts"
  let sizeMult = 1
  for (const [re, mult] of SIZE_MULTIPLIERS) {
    if (re.test(rest)) { sizeMult = mult; break }
  }
  const target = foodName || rest
  for (const [re, g] of COUNT_DEFAULTS) {
    if (re.test(target) || re.test(rest)) {
      return { grams: q.value * g * sizeMult, rest }
    }
  }
  // bare count with unknown item — leave grams unresolved but keep the count
  return { grams: null, rest }
}

/** Handle "(two 15-ounce cans)" / "1 (14.5 oz) can …" parenthetical sizing. */
function canSizeGrams(line: string): number | null {
  const norm = normalizeFractions(line.toLowerCase())
  // count inside or outside parens × per-can size
  const m = norm.match(/(\d+(?:\.\d+)?|one|two|three|four|five|six)?\s*\(\s*(?:(one|two|three|four|five|six|\d+(?:\.\d+)?)\s+)?(\d+(?:\.\d+)?)\s*-?\s*(ounce|oz|gram|g|pound|lb)[^)]*(?:\/\s*(\d+(?:\.\d+)?)\s*-?\s*(gram|g))?[^)]*\)\s*(cans?|jars?|packages?|pkgs?|bottles?|boxes?|tins?)?/i)
  if (!m) return null
  const outerCount = m[1] ? (NUMBER_WORDS[m[1]] ?? parseFloat(m[1])) : null
  const innerCount = m[2] ? (NUMBER_WORDS[m[2]] ?? parseFloat(m[2])) : null
  const size = parseFloat(m[3])
  const unit = m[4]
  const gramAlt = m[5] ? parseFloat(m[5]) : null
  const isContainer = !!m[7] || /cans?|jars?|packages?|tins?/.test(norm)
  if (!isContainer && !innerCount) return null
  const count = outerCount ?? innerCount ?? 1
  const per = gramAlt ?? (unit.startsWith('g') ? size : unit.startsWith('p') || unit.startsWith('lb') ? size * 453.59 : size * 28.35)
  return count * per
}

/**
 * Parse one raw ingredient line → ParsedIngredient, or null when the line is
 * junk (blog prose, serving-multiplier widgets, section headers, post-"Notes"
 * content is handled by the caller).
 */
export function parseIngredientLine(raw: string): ParsedIngredient | null {
  let line = raw.replace(/^[-•*▢☐□]\s*/, '').trim()
  if (!line || line.length < 2) return null
  for (const re of JUNK_LINE) if (re.test(line)) return null
  if (HEADER_LINE.test(line) && !/\d/.test(line)) return null

  const optional = OPTIONAL_FLAG.test(line)
  const fryingOil = FRYING_OIL.test(line)

  // normalize fractions before any numeric work
  let work = normalizeFractions(line)

  // parenthetical can/package sizing takes priority when the main qty is a container count
  const containerGrams = /\b(cans?|jars?|packages?|pkgs?|tins?)\b/i.test(work) ? canSizeGrams(work) : null

  // build the lookup name: strip parentheticals, quantities, units, descriptors
  let base = work
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b\d+(\.\d+)?\s*(kilograms?|kgs?|grams?|g|ounces?|oz|pounds?|lbs?|tablespoons?|tbsps?|tbs|teaspoons?|tsps?|cups?|fl\.?\s*oz|milliliters?|ml|liters?|l|pints?|quarts?|cans?|jars?|packages?|pkgs?|cloves?|strips?|slices?|stalks?|ribs?|heads?|leaves|leaf|sticks?|ears?|bunch(es)?|pinch(es)?|dash(es)?|handfuls?)\b\.?/gi, ' ')
    .replace(/\b\d+(\.\d+)?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // Prep clauses hide on either side of commas ("onion, finely chopped" /
  // "whole, diced, or crushed tomatoes") — keep the comma segment with the
  // most real food words rather than blindly cutting at the first comma.
  const segments = base.split(',').map(s => s.trim()).filter(Boolean)
  let name = base
  if (segments.length > 1) {
    let bestSeg = ''; let bestCount = -1
    for (const seg of segments) {
      const count = seg.split(/\s+/).filter(w => w.length > 1 && !DESCRIPTOR_WORDS.has(w.toLowerCase())).length
      if (count > bestCount) { bestCount = count; bestSeg = seg }
    }
    name = bestSeg
  }
  name = name.split(/\s+/).filter(w => !DESCRIPTOR_WORDS.has(w.toLowerCase())).join(' ').trim() || work.trim()

  // negligible seasonings resolve to zero without lookups
  if (NEGLIGIBLE.test(name) || NEGLIGIBLE.test(line)) {
    return { raw, name: name || line, grams: 0, optional, fryingOilCapped: false }
  }

  // quantity → grams
  let grams: number | null = null
  if (containerGrams != null) {
    grams = containerGrams
  } else if (HIGH_CAL_PLUS.test(name) && /\bplus\b/i.test(work)) {
    // sum split "plus" quantities for high-calorie ingredients only
    const parts = work.split(/\bplus\b/i)
    let sum = 0; let any = false
    for (const part of parts) {
      const r = quantityToGrams(part.replace(/^[^0-9]*/, ''), name)
      if (r.grams != null) { sum += r.grams; any = true }
    }
    grams = any ? sum : null
  } else {
    const stripped = work.replace(/\([^)]*\)/g, ' ').trim()
    grams = quantityToGrams(stripped, name).grams
  }

  if (grams != null && fryingOil) grams *= FRYING_ABSORPTION

  return { raw, name, grams, optional, fryingOilCapped: fryingOil && grams != null }
}

/** Parse a full ingredient-line list, dropping junk and post-"Notes" prose. */
export function parseIngredientList(lines: string[]): { parsed: ParsedIngredient[]; flagged: string[] } {
  const parsed: ParsedIngredient[] = []
  const flagged: string[] = []
  let inNotes = false
  for (const raw of lines) {
    if (/^notes?:?$/i.test(raw.trim())) { inNotes = true; continue }
    if (inNotes) continue
    const p = parseIngredientLine(raw)
    if (!p) { flagged.push(`skipped: ${raw.slice(0, 60)}`); continue }
    if (p.grams == null) {
      flagged.push(`unquantified${p.optional ? ' (optional/side)' : ''}: ${raw.slice(0, 60)}`)
      if (p.optional) continue   // unquantified sides ("Steamed rice (optional)") are excluded
    }
    parsed.push(p)
  }
  return { parsed, flagged }
}

// ─── USDA lookup with match validation ──────────────────────────────────────

const USDA_SEARCH = 'https://api.nal.usda.gov/fdc/v1/foods/search'
const USDA_DETAIL = 'https://api.nal.usda.gov/fdc/v1/food'

// Canonical staples: foods USDA search mis-ranks. Checked before search.
// Critical guards from the backfill: butter beans / butternut → never dairy butter.
const CANONICAL_STAPLES: { re: RegExp; query: string; cls: FoodClass }[] = [
  { re: /\bbutter(y)?[- ]?beans?\b/i, query: 'lima beans canned', cls: 'legume' },
  { re: /\bbutternut\b/i, query: 'squash winter butternut raw', cls: 'vegetable' },
  { re: /\bchicken (broth|stock)\b/i, query: 'chicken broth canned', cls: 'broth' },
  { re: /\b(all[- ]?purpose )?flour\b/i, query: 'wheat flour white all-purpose enriched', cls: 'flour' },
  { re: /\bolive oil\b/i, query: 'oil olive salad or cooking', cls: 'oil' },
  { re: /\b(peanut|canola|vegetable|grapeseed|neutral|frying) oil\b/i, query: 'oil canola', cls: 'oil' },
  { re: /\bsesame oil\b/i, query: 'oil sesame', cls: 'oil' },
  { re: /\bbuttermilk\b/i, query: 'buttermilk lowfat', cls: 'dairy' },
  { re: /\bheavy (whipping )?cream\b/i, query: 'cream heavy whipping', cls: 'dairy' },
  { re: /\bsoy sauce\b/i, query: 'soy sauce shoyu', cls: 'condiment' },
]

type FoodClass =
  | 'oil' | 'butter' | 'leafy' | 'legume' | 'meat' | 'bacon' | 'cheese' | 'nuts'
  | 'sugar' | 'flour' | 'broth' | 'spice' | 'vegetable' | 'fruit' | 'dairy' | 'condiment' | 'grain' | 'unknown'

const CLASS_RULES: [RegExp, FoodClass][] = [
  [/\b(oil|ghee|lard|shortening)\b/i, 'oil'],
  [/\bbutter\b/i, 'butter'],               // staples table already rerouted butter-beans/butternut
  [/\b(spinach|lettuce|arugula|kale|chard|cabbage|greens|watercress)\b/i, 'leafy'],
  [/\b(beans?|lentils?|chickpeas?|garbanzo|black-?eyed peas?|edamame)\b/i, 'legume'],
  [/\bbacon\b/i, 'bacon'],
  // dried spices & herbs read as vegetables by name ("chipotle pepper powder")
  // but run 150–600 kcal/100g — classify before the vegetable rule
  [/\b(cumin|paprika|oregano|cinnamon|coriander|turmeric|cayenne|allspice|nutmeg|cloves \(ground\)|chil[ei] powder|chipotle.*powder|curry powder|garam masala|za'?atar|spices?|seasonings?|peppercorns?|dried (basil|thyme|rosemary|dill|herbs?))\b/i, 'spice'],
  [/\b(chicken|beef|pork|turkey|lamb|steak|sausage|shrimp|salmon|fish|tuna|cod)\b/i, 'meat'],
  [/\b(cheese|parmesan|cheddar|mozzarella|feta|gouda|swiss)\b/i, 'cheese'],
  [/\b(almonds?|pecans?|walnuts?|cashews?|peanuts?|pistachios?|nuts?)\b/i, 'nuts'],
  [/\bsugar\b/i, 'sugar'],
  [/\b(flour|cornstarch)\b/i, 'flour'],
  [/\b(broth|stock)\b/i, 'broth'],
  [/\b(milk|cream|yogurt)\b/i, 'dairy'],
  [/\b(rice|pasta|noodles?|quinoa|oats|bread|tortillas?)\b/i, 'grain'],
  [/\b(onions?|garlic|carrots?|celery|peppers?|squash|zucchini|tomato(es)?|potato(es)?|broccoli|cauliflower|mushrooms?|radish(es)?|turnips?|scallions?|jalapen)\b/i, 'vegetable'],
  [/\b(apple|banana|lemon|lime|orange|berr|mango|pineapple|avocado)\b/i, 'fruit'],
]

// kcal-per-100g sanity bands. A candidate outside its query-class band is rejected
// (spec callouts: oils <100/100g are wrong; leafy veg >200/100g is wrong).
const KCAL_BANDS: Record<FoodClass, [number, number]> = {
  oil: [700, 950], butter: [600, 800], leafy: [5, 200], legume: [40, 400],
  meat: [80, 450], bacon: [350, 600], cheese: [150, 500], nuts: [450, 750],
  sugar: [300, 420], flour: [300, 400], broth: [0, 60], spice: [100, 600],
  vegetable: [5, 150], fruit: [15, 250], dairy: [30, 350], condiment: [0, 500],
  grain: [80, 400], unknown: [0, 950],
}

function classify(name: string): FoodClass {
  for (const [re, cls] of CLASS_RULES) if (re.test(name)) return cls
  return 'unknown'
}

interface UsdaSearchFood {
  fdcId: number
  description: string
  dataType: string
  servingSize?: number
  servingSizeUnit?: string
  gtinUpc?: string          // present on Branded foods — used for barcode matching
  brandOwner?: string
  brandName?: string
  foodNutrients?: { nutrientId?: number; nutrientNumber?: string; nutrientName?: string; value?: number }[]
}

function macrosFromSearchFood(f: UsdaSearchFood): NutritionMacros | null {
  const get = (numbers: string[], ids: number[]): number => {
    for (const n of f.foodNutrients || []) {
      const num = n.nutrientNumber ? String(n.nutrientNumber) : ''
      if ((num && numbers.some(x => num === x || num.startsWith(x + '.'))) ||
          (n.nutrientId != null && ids.includes(n.nutrientId))) {
        return typeof n.value === 'number' ? n.value : 0
      }
    }
    return 0
  }
  const calories = get(['208'], [1008]) || get(['957'], [2047]) || get(['958'], [2048])
  const macros: NutritionMacros = {
    calories,
    protein_g: get(['203'], [1003]),
    carbs_g: get(['205'], [1005]),
    fat_g: get(['204'], [1004]),
    fiber_g: get(['291'], [1079]),
    sugar_g: get(['269'], [2000]),
  }
  if (!Number.isFinite(macros.calories)) return null
  return macros
}

const DATATYPE_WEIGHT: Record<string, number> = {
  'SR Legacy': 3, Foundation: 2.5, 'Survey (FNDDS)': 2, Branded: 1,
}

/**
 * USDA search, hardened against the API's flaky WAF:
 *  - NEVER sends "Survey (FNDDS)" in the dataType param — parentheses in the
 *    querystring intermittently trigger nginx 400s (~60% observed). When FNDDS
 *    results are wanted, the dataType param is omitted entirely and results
 *    are post-filtered by `allow` instead.
 *  - one retry with a short backoff for residual transient failures.
 */
async function usdaSearch(query: string, allow: string[], pageSize = 12): Promise<UsdaSearchFood[]> {
  const key = process.env.USDA_API_KEY
  if (!key) return []
  const parensFree = allow.filter(t => !t.includes('('))
  const params = new URLSearchParams({ api_key: key, query, pageSize: String(pageSize) })
  if (parensFree.length === allow.length) {
    params.set('dataType', parensFree.join(','))
  } else {
    params.set('pageSize', String(Math.max(pageSize, 25)))  // unfiltered → fetch more, filter below
  }
  const allowSet = new Set(allow)

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${USDA_SEARCH}?${params}`, { signal: AbortSignal.timeout(10000) })
      if (res.ok) {
        const data = await res.json()
        const foods: UsdaSearchFood[] = Array.isArray(data.foods) ? data.foods : []
        return foods.filter(f => allowSet.has(f.dataType))
      }
    } catch { /* timeout / network — retry */ }
    await new Promise(r => setTimeout(r, 300))
  }
  return []
}

/**
 * Validate + score USDA candidates for an ingredient query.
 * Returns the best candidate's per-100g macros, or null (→ AI fallback).
 */
function pickValidated(queryName: string, cls: FoodClass, foods: UsdaSearchFood[]): { macros: NutritionMacros; description: string } | null {
  const qTokens = keyTokens(queryName)
  if (qTokens.length === 0) return null
  const [lo, hi] = KCAL_BANDS[cls]
  let best: { score: number; macros: NutritionMacros; description: string } | null = null

  for (const f of foods) {
    const macros = macrosFromSearchFood(f)
    if (!macros) continue
    // (b) kcal/100g band check by food class — reject out-of-band matches
    if (macros.calories < lo || macros.calories > hi) continue
    // (a) token-stem overlap — matched name must share a key noun token
    const dTokens = keyTokens(f.description)
    const overlap = qTokens.filter(t => dTokens.includes(t)).length
    if (overlap === 0) continue
    // guard: a "butter" match for a non-butter query class is always wrong
    if (cls !== 'butter' && cls !== 'dairy' && /^butter\b/i.test(f.description) && !/bean|squash|nut\b|milk/i.test(f.description) && !/\bbutter\b/i.test(queryName)) continue

    let score = overlap * 10 + (DATATYPE_WEIGHT[f.dataType] ?? 0)
    if (macros.calories === 0 && cls !== 'broth' && cls !== 'condiment') score -= 50  // zero-calorie penalty
    score -= f.description.length / 100  // favor short/generic descriptions
    if (dTokens[0] === qTokens[0]) score += 3
    if (!best || score > best.score) best = { score, macros, description: f.description }
  }
  return best ? { macros: best.macros, description: best.description } : null
}

// ─── AI estimate fallback ────────────────────────────────────────────────────

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_MODEL = 'claude-sonnet-4-6'

async function anthropicJson(prompt: string): Promise<Record<string, number> | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null   // degrade gracefully — key lives in Vercel, may be absent locally
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) return null
    const data = await res.json()
    const text: string = data.content?.[0]?.text || ''
    const json = text.match(/\{[\s\S]*\}/)
    if (!json) return null
    const obj = JSON.parse(json[0])
    return typeof obj === 'object' && obj ? obj : null
  } catch {
    return null
  }
}

async function aiEstimateIngredient(name: string, grams: number): Promise<NutritionMacros | null> {
  const obj = await anthropicJson(
    `Estimate the nutrition of ${Math.round(grams)} g of "${name}" (as used in home cooking). ` +
    `Respond with ONLY a JSON object, no prose: {"calories": n, "protein_g": n, "carbs_g": n, "fat_g": n, "fiber_g": n, "sugar_g": n}`
  )
  if (!obj || typeof obj.calories !== 'number') return null
  return {
    calories: obj.calories || 0, protein_g: obj.protein_g || 0, carbs_g: obj.carbs_g || 0,
    fat_g: obj.fat_g || 0, fiber_g: obj.fiber_g || 0, sugar_g: obj.sugar_g || 0,
  }
}

// ─── Ingredient resolution (with cache) ──────────────────────────────────────

// In-memory per-instance cache. (The backfill's persistent cache is a later
// enhancement — this keeps repeat lookups within a server instance free.)
const ingredientCache = new Map<string, ResolvedFood | null>()

async function resolveIngredient(name: string): Promise<ResolvedFood | null> {
  const cacheKey = name.toLowerCase().trim()
  if (ingredientCache.has(cacheKey)) return ingredientCache.get(cacheKey) ?? null

  // canonical staples reroute the query before search (butter beans → legume, …)
  let query = name
  let cls = classify(name)
  for (const s of CANONICAL_STAPLES) {
    if (s.re.test(name)) { query = s.query; cls = s.cls; break }
  }

  let resolved: ResolvedFood | null = null
  try {
    // SR Legacy + Foundation cover raw ingredients and keep the dataType param
    // parens-free (the "Survey (FNDDS)" param value trips the USDA WAF)
    const foods = await usdaSearch(query, ['SR Legacy', 'Foundation'])
    const pick = pickValidated(query, cls, foods)
    if (pick) resolved = { per100g: pick.macros, matchedDescription: pick.description, resolvedBy: 'usda' }
  } catch { /* network failure → AI fallback */ }

  if (!resolved) {
    // reject-and-fall-through: AI estimates per-100g via a 100 g ask
    const ai = await aiEstimateIngredient(name, 100)
    if (ai) resolved = { per100g: ai, matchedDescription: `AI estimate: ${name}`, resolvedBy: 'ai' }
  }

  ingredientCache.set(cacheKey, resolved)
  return resolved
}

// ─── Public API: recipe computation ─────────────────────────────────────────

function round1(n: number): number { return Math.round(n * 10) / 10 }

export async function computeRecipeNutrition(recipeId: string): Promise<RecipeComputeResult> {
  const db = getAdminDb()
  const snap = await db.collection('recipes').doc(recipeId).get()
  if (!snap.exists) throw new Error(`Recipe not found: ${recipeId}`)
  const data = snap.data() || {}

  const { ingredients } = parseRecipeContent(String(data.content || ''))
  if (!ingredients.length) throw new Error('Recipe has no parseable ingredient list')

  const { parsed, flagged } = parseIngredientList(ingredients)
  const unresolved: string[] = []
  const total: NutritionMacros = { ...ZERO }
  let usedAI = false

  for (const ing of parsed) {
    if (ing.grams == null) { unresolved.push(ing.raw); continue }
    if (ing.grams === 0) continue   // negligible seasonings
    const food = await resolveIngredient(ing.name)
    if (!food) { unresolved.push(ing.raw); continue }
    if (food.resolvedBy === 'ai') usedAI = true
    const factor = ing.grams / 100
    total.calories += food.per100g.calories * factor
    total.protein_g += food.per100g.protein_g * factor
    total.carbs_g += food.per100g.carbs_g * factor
    total.fat_g += food.per100g.fat_g * factor
    total.fiber_g += food.per100g.fiber_g * factor
    total.sugar_g += food.per100g.sugar_g * factor
  }

  // servings: recipe doc → existing nutrition → tagged default of 4
  const docServings = typeof data.servings === 'number' && data.servings > 0 ? data.servings : undefined
  const prevServings = typeof data.nutrition?.servings === 'number' && data.nutrition.servings > 0
    ? data.nutrition.servings : undefined
  const servings = docServings ?? prevServings ?? 4
  const servingsDefaulted = docServings === undefined && prevServings === undefined

  const totals: NutritionMacros = {
    calories: Math.round(total.calories), protein_g: round1(total.protein_g),
    carbs_g: round1(total.carbs_g), fat_g: round1(total.fat_g),
    fiber_g: round1(total.fiber_g), sugar_g: round1(total.sugar_g),
  }
  const per: NutritionMacros = {
    calories: Math.round(total.calories / servings), protein_g: round1(total.protein_g / servings),
    carbs_g: round1(total.carbs_g / servings), fat_g: round1(total.fat_g / servings),
    fiber_g: round1(total.fiber_g / servings), sugar_g: round1(total.sugar_g / servings),
  }

  const source = (usedAI ? 'usda+ai' : 'usda') + (servingsDefaulted ? '+default_servings' : '')
  const confidence = servingsDefaulted ? 'low' : (usedAI || unresolved.length > 0 ? 'medium' : 'high')

  const nutrition: RecipeNutrition = {
    ...per,
    serving_size: `1 of ${servings}${servingsDefaulted ? ' (assumed)' : ''}`,
    servings,
    total: totals,
    source,
    confidence,
    computed_at: new Date(),
  }
  return { nutrition, unresolved, flagged }
}

// ─── Public API: food-name lookup (quick-food / "Big Mac" path) ─────────────

async function usdaServingGrams(food: UsdaSearchFood): Promise<number | null> {
  if (food.servingSize && /^(g|grm|gram|ml|mlt)$/i.test(food.servingSizeUnit || '')) {
    return food.servingSize
  }
  // SR Legacy / FNDDS: portion weights only come back on the detail endpoint
  const key = process.env.USDA_API_KEY
  if (!key) return null
  try {
    const res = await fetch(`${USDA_DETAIL}/${food.fdcId}?api_key=${key}`, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return null
    const detail = await res.json()
    const portions: any[] = detail.foodPortions || []
    for (const p of portions) {
      if (typeof p.gramWeight === 'number' && p.gramWeight > 0) return p.gramWeight
    }
    return null
  } catch {
    return null
  }
}

export async function lookupFoodByName(rawName: string): Promise<FoodLookupResult | null> {
  const name = rawName.trim()
  if (!name) return null

  try {
    // quick-food favors real-world items: survey + branded first, generic last
    const foods = await usdaSearch(name, ['Survey (FNDDS)', 'Branded', 'SR Legacy', 'Foundation'], 15)
    const qTokens = keyTokens(name)
    let best: { score: number; food: UsdaSearchFood; macros: NutritionMacros } | null = null
    for (const f of foods) {
      const macros = macrosFromSearchFood(f)
      if (!macros || macros.calories <= 0 || macros.calories > 950) continue
      const dTokens = keyTokens(f.description)
      const overlap = qTokens.filter(t => dTokens.includes(t)).length
      if (overlap === 0) continue
      let score = overlap * 10
      if (f.description.toLowerCase().includes(name.toLowerCase())) score += 15  // exact-phrase bonus
      score += f.dataType === 'Survey (FNDDS)' || f.dataType === 'SR Legacy' ? 3 : 0
      score -= f.description.length / 100
      if (!best || score > best.score) best = { score, food: f, macros }
    }

    if (best) {
      const grams = await usdaServingGrams(best.food)
      const basis = grams ?? 100
      const per = (v: number) => v * basis / 100
      return {
        name: best.food.description,
        nutrition: {
          calories: Math.round(per(best.macros.calories)),
          protein_g: round1(per(best.macros.protein_g)),
          carbs_g: round1(per(best.macros.carbs_g)),
          fat_g: round1(per(best.macros.fat_g)),
          fiber_g: round1(per(best.macros.fiber_g)),
          sugar_g: round1(per(best.macros.sugar_g)),
        },
        servingGrams: grams,
        source: 'usda',
        confidence: grams ? 'high' : 'medium',   // no portion data → per-100g basis
      }
    }
  } catch { /* fall through to AI */ }

  // AI fallback for unresolved foods
  const obj = await anthropicJson(
    `Estimate the nutrition of ONE typical serving of "${name}". ` +
    `Respond with ONLY a JSON object, no prose: {"calories": n, "protein_g": n, "carbs_g": n, "fat_g": n, "fiber_g": n, "sugar_g": n, "serving_grams": n}`
  )
  if (obj && typeof obj.calories === 'number') {
    return {
      name,
      nutrition: {
        calories: Math.round(obj.calories || 0), protein_g: round1(obj.protein_g || 0),
        carbs_g: round1(obj.carbs_g || 0), fat_g: round1(obj.fat_g || 0),
        fiber_g: round1(obj.fiber_g || 0), sugar_g: round1(obj.sugar_g || 0),
      },
      servingGrams: typeof obj.serving_grams === 'number' ? obj.serving_grams : null,
      source: 'ai_estimate',
      confidence: 'medium',
    }
  }
  return null
}

// ─── Public API: barcode lookup (packaged products) ─────────────────────────
// Cascade: Open Food Facts → USDA branded → miss. Called server-side only
// (the route handles CORS + the courtesy User-Agent header OFF asks for).
// Returns the product, or null on a miss (→ route emits { found: false }).

const OFF_PRODUCT = 'https://world.openfoodfacts.org/api/v2/product'
// OFF asks third parties to identify themselves; an anonymous UA can be throttled.
const OFF_USER_AGENT = 'MEA-Recipes/1.0 (https://mea-recipes.vercel.app; folstromjohn@gmail.com)'

/** Pull the six macros off an OFF `nutriments` object for a given basis suffix. */
function offMacros(nutr: Record<string, unknown>, basis: 'serving' | '100g'): NutritionMacros {
  const num = (key: string): number => {
    const v = nutr[`${key}_${basis}`]
    return typeof v === 'number' && Number.isFinite(v) ? v : 0
  }
  return {
    calories: num('energy-kcal'),
    protein_g: num('proteins'),
    carbs_g: num('carbohydrates'),
    fat_g: num('fat'),
    fiber_g: num('fiber'),
    sugar_g: num('sugars'),
  }
}

/** True when a key exists as a finite number for the basis (0 counts as present). */
function offHas(nutr: Record<string, unknown>, key: string, basis: 'serving' | '100g'): boolean {
  const v = nutr[`${key}_${basis}`]
  return typeof v === 'number' && Number.isFinite(v)
}

async function lookupOpenFoodFacts(barcode: string): Promise<BarcodeProduct | null> {
  let data: any
  try {
    const res = await fetch(`${OFF_PRODUCT}/${encodeURIComponent(barcode)}.json`, {
      headers: { 'User-Agent': OFF_USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    data = await res.json()
  } catch {
    return null   // network/timeout → let the USDA fallback try
  }
  const product = data?.product
  const nutr: Record<string, unknown> | undefined = product?.nutriments
  if (!product || !nutr) return null

  // Prefer per-serving values when OFF carries them; else fall back to per-100g.
  // Calories is the gate: no energy on either basis → no usable nutrition.
  const hasServing = offHas(nutr, 'energy-kcal', 'serving')
  const has100g = offHas(nutr, 'energy-kcal', '100g')
  if (!hasServing && !has100g) return null
  const basis: 'serving' | '100g' = hasServing ? 'serving' : '100g'

  const nutrition = offMacros(nutr, basis)
  // Completeness → confidence. OFF is crowdsourced, so the ceiling is "medium":
  // all four core macros present → medium; sparse → low.
  const core =
    offHas(nutr, 'energy-kcal', basis) && offHas(nutr, 'proteins', basis) &&
    offHas(nutr, 'carbohydrates', basis) && offHas(nutr, 'fat', basis)
  const confidence: 'medium' | 'low' = core ? 'medium' : 'low'

  const name: string =
    product.product_name || product.product_name_en || product.generic_name ||
    product.brands || `Product ${barcode}`
  const servingSize: string | null =
    typeof product.serving_size === 'string' && product.serving_size.trim()
      ? product.serving_size.trim() : null

  return {
    name: String(name).trim(),
    nutrition: {
      calories: Math.round(nutrition.calories), protein_g: round1(nutrition.protein_g),
      carbs_g: round1(nutrition.carbs_g), fat_g: round1(nutrition.fat_g),
      fiber_g: round1(nutrition.fiber_g), sugar_g: round1(nutrition.sugar_g),
    },
    serving_size: servingSize,
    source: 'openfoodfacts',
    confidence,
    basis: basis === 'serving' ? 'per_serving' : 'per_100g',
  }
}

/** Strip leading zeros so UPC-12 / EAN-13 representations of the same GTIN match. */
function normalizeGtin(s: string): string {
  return s.replace(/\D/g, '').replace(/^0+/, '') || '0'
}

async function lookupUsdaBranded(barcode: string): Promise<BarcodeProduct | null> {
  let foods: UsdaSearchFood[]
  try {
    foods = await usdaSearch(barcode, ['Branded'], 25)
  } catch {
    return null
  }
  const target = normalizeGtin(barcode)
  const match = foods.find(f => f.gtinUpc && normalizeGtin(f.gtinUpc) === target)
  if (!match) return null

  // Branded foodNutrients are stored per 100 g — report that basis honestly.
  const macros = macrosFromSearchFood(match)
  if (!macros || !Number.isFinite(macros.calories)) return null

  const serving = match.servingSize && match.servingSizeUnit
    ? `${match.servingSize} ${match.servingSizeUnit}`.trim()
    : null

  return {
    name: [match.brandName || match.brandOwner, match.description].filter(Boolean).join(' — ') || match.description,
    nutrition: {
      calories: Math.round(macros.calories), protein_g: round1(macros.protein_g),
      carbs_g: round1(macros.carbs_g), fat_g: round1(macros.fat_g),
      fiber_g: round1(macros.fiber_g), sugar_g: round1(macros.sugar_g),
    },
    serving_size: serving,
    source: 'usda_branded',
    confidence: 'medium',
    basis: 'per_100g',
  }
}

export async function lookupFoodByBarcode(rawBarcode: string): Promise<BarcodeProduct | null> {
  const barcode = rawBarcode.replace(/\s+/g, '').trim()
  if (!barcode) return null
  // 1) Open Food Facts first (richest packaged-food coverage)…
  const off = await lookupOpenFoodFacts(barcode)
  if (off) return off
  // 2) …then USDA's branded dataset by GTIN.
  return lookupUsdaBranded(barcode)
}
