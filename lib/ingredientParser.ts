// ─── Unit-aware ingredient line parser ───────────────────────────────────────
//
// Pure, deterministic, and FIREBASE-FREE so it is safe to import from both the
// browser (app/grocery/page.tsx, lib/userdata.ts) and server API routes
// (app/api/grocery-cleanup/route.ts). It splits a single raw ingredient line
// into { quantity, unit, name } at the grocery-ADD boundary only — it does NOT
// touch how recipes store their ingredients.
//
// This module is the SINGLE SOURCE OF TRUTH for measurement/unit vocabulary.
// extractIngredientName() in the grocery page and the single-line AI-parse
// fallback in the grocery-cleanup route both reference the lists/helpers here —
// do not duplicate the vocabulary elsewhere.

export interface ParsedIngredient {
  quantity: string
  unit: string
  name: string
  /**
   * 'high' — parsed confidently (or stored verbatim as a plain noun phrase).
   * 'low'  — the line has an ambiguous quantity structure the deterministic
   *          parser will not guess at (e.g. a doubled quantity like
   *          "6 4 ears shucked corn"); the caller may invoke the AI fallback.
   */
  confidence: 'high' | 'low'
}

export interface QtyUnit {
  quantity: string
  unit: string
}

// MEASUREMENT units (volume / weight): quantities in the same measurement unit
// can be summed on merge ("2 cups" + "1 cup" = "3 cups"). Each canonical key
// maps to the surface spellings we recognise. Single-letter abbreviations are
// limited to the unambiguous metric ones (g, l) that recipes actually use.
const MEASUREMENT_UNIT_GROUPS: Record<string, string[]> = {
  cup:        ['cup', 'cups'],
  tablespoon: ['tablespoon', 'tablespoons', 'tbsp', 'tbsps', 'tbs'],
  teaspoon:   ['teaspoon', 'teaspoons', 'tsp', 'tsps'],
  ounce:      ['ounce', 'ounces', 'oz'],
  pound:      ['pound', 'pounds', 'lb', 'lbs'],
  gram:       ['gram', 'grams', 'g'],
  kilogram:   ['kilogram', 'kilograms', 'kg'],
  milligram:  ['milligram', 'milligrams', 'mg'],
  milliliter: ['milliliter', 'milliliters', 'millilitre', 'millilitres', 'ml'],
  liter:      ['liter', 'liters', 'litre', 'litres', 'l'],
  pint:       ['pint', 'pints', 'pt'],
  quart:      ['quart', 'quarts', 'qt'],
  gallon:     ['gallon', 'gallons', 'gal'],
}

// COUNTABLE units: the unit IS the countable noun ("1 can black beans" → "can",
// "4 ears shucked corn" → "ears"). Kept DISTINCT from measurements so they are
// preserved as the unit instead of being stripped/mistaken for a measurement —
// this is the fix for the "1 black beans" (dropped "can") artifact.
const COUNTABLE_UNIT_GROUPS: Record<string, string[]> = {
  can:     ['can', 'cans'],
  jar:     ['jar', 'jars'],
  bag:     ['bag', 'bags'],
  box:     ['box', 'boxes'],
  package: ['package', 'packages', 'pkg', 'pkgs', 'pack', 'packs'],
  bunch:   ['bunch', 'bunches'],
  head:    ['head', 'heads'],
  clove:   ['clove', 'cloves'],
  ear:     ['ear', 'ears'],
  stalk:   ['stalk', 'stalks'],
  slice:   ['slice', 'slices'],
  piece:   ['piece', 'pieces'],
  sprig:   ['sprig', 'sprigs'],
  stick:   ['stick', 'sticks'],
  bottle:  ['bottle', 'bottles'],
  loaf:    ['loaf', 'loaves'],
}

// All recognised unit surface spellings (measurement + countable).
export const ALL_UNIT_WORDS: string[] = [
  ...Object.values(MEASUREMENT_UNIT_GROUPS).flat(),
  ...Object.values(COUNTABLE_UNIT_GROUPS).flat(),
]

// Anchored "leading unit word" regex for the grocery page's sort helper
// (extractIngredientName). Longest-first so e.g. "tablespoons" wins over "tbs".
export const MEASUREMENT_WORDS_RE = new RegExp(
  '^(' +
    [...ALL_UNIT_WORDS].sort((a, b) => b.length - a.length).join('|') +
  ')\\b',
  'i',
)

const UNICODE_FRACTIONS: Record<string, number> = {
  '¼': 0.25, '½': 0.5, '¾': 0.75,
  '⅓': 1 / 3, '⅔': 2 / 3,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
  '⅙': 1 / 6, '⅚': 5 / 6,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
  '⅐': 1 / 7, '⅑': 1 / 9, '⅒': 0.1,
}

// Character class for unicode vulgar fractions (BMP — no `u` flag needed).
const FRAC = '[\\u00BC-\\u00BE\\u2150-\\u215E]'

// Leading-quantity matcher. Order matters: mixed/range forms must be tried
// before the plain integer/fraction forms so they win.
const LEADING_QTY_RE = new RegExp(
  '^\\s*(' +
    '\\d+\\s+\\d+\\s*/\\s*\\d+' +                              // mixed ascii:   "1 1/2"
    '|\\d+\\s*' + FRAC +                                       // mixed unicode: "1½" / "1 ½"
    '|\\d+(?:\\.\\d+)?\\s*(?:-|–|—|to)\\s*\\d+(?:\\.\\d+)?' +  // range:         "1-2" / "1 to 2"
    '|\\d+\\s*/\\s*\\d+' +                                     // fraction:      "1/2"
    '|\\d+\\.\\d+' +                                           // decimal:       "1.5"
    '|\\d+' +                                                  // integer:       "3"
    '|' + FRAC +                                               // unicode alone: "½"
  ')',
)

/**
 * Canonical key for a unit surface spelling, prefixed by family so a
 * measurement unit can never be "compatible" with a countable one.
 * Returns null for an unrecognised/empty unit.
 */
export function unitCanonical(unit: string): string | null {
  if (!unit) return null
  const u = unit.toLowerCase().replace(/\.+$/, '').trim()
  if (!u) return null
  for (const [canon, variants] of Object.entries(MEASUREMENT_UNIT_GROUPS)) {
    if (variants.includes(u)) return 'M:' + canon
  }
  for (const [canon, variants] of Object.entries(COUNTABLE_UNIT_GROUPS)) {
    if (variants.includes(u)) return 'C:' + canon
  }
  return null
}

/** True if `unit` is a recognised measurement or countable unit. */
export function isKnownUnit(unit: string): boolean {
  return unitCanonical(unit) !== null
}

const SINGULAR_EXCEPTIONS = new Set([
  'asparagus', 'bass', 'bison', 'bread', 'cheese', 'couscous', 'deer', 'fish',
  'hummus', 'molasses', 'moose', 'oats', 'rice', 'salmon', 'series', 'sheep',
  'shrimp', 'species', 'squid', 'tuna', 'watercress',
])

const IRREGULAR_FOOD_PLURALS: Record<string, string> = {
  halves: 'half',
  knives: 'knife',
  leaves: 'leaf',
  loaves: 'loaf',
  potatoes: 'potato',
  tomatoes: 'tomato',
}

/** Conservative food-aware singularizer used only for grocery identity keys. */
export function singularizeFoodWord(word: string): string {
  if (!word || SINGULAR_EXCEPTIONS.has(word)) return word
  if (IRREGULAR_FOOD_PLURALS[word]) return IRREGULAR_FOOD_PLURALS[word]
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 4 && word.endsWith('oes')) return word.slice(0, -2)
  if (word.length > 4 && /(?:ches|shes|xes|zes)$/.test(word)) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !/(?:ss|us|is)$/.test(word)) return word.slice(0, -1)
  return word
}

/**
 * Normalise a noun phrase for exact grocery merge comparison: lowercase, strip
 * punctuation/articles, singularize food words, and collapse whitespace.
 * Modifiers remain intact — "red onion" still does not collapse to "onion".
 */
export function normalizeNoun(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[.,;:!?()'"`]/g, ' ')
    .replace(/\b(?:a|an|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(singularizeFoodWord)
    .join(' ')
}

/**
 * Parse a SIMPLE quantity string to a number for summing. Returns null for
 * ranges, side-by-side compounds ("2 cups + 3 tbsp"), or anything non-numeric.
 */
function parseQtyNumber(q: string): number | null {
  const s = (q || '').trim()
  if (!s) return null
  if (s.includes('+')) return null
  if (/\d\s*(?:-|–|—|to)\s*\d/.test(s)) return null // range

  let m = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/) // mixed ascii "1 1/2"
  if (m) return finite(parseInt(m[1], 10) + parseInt(m[2], 10) / parseInt(m[3], 10))

  m = s.match(new RegExp('^(\\d+)\\s*(' + FRAC + ')$')) // mixed unicode "1½"
  if (m) return finite(parseInt(m[1], 10) + (UNICODE_FRACTIONS[m[2]] ?? NaN))

  m = s.match(/^(\d+)\s*\/\s*(\d+)$/) // fraction "1/2"
  if (m) return finite(parseInt(m[1], 10) / parseInt(m[2], 10))

  if (UNICODE_FRACTIONS[s] !== undefined) return UNICODE_FRACTIONS[s] // "½"

  if (/^\d+(?:\.\d+)?$/.test(s)) return finite(parseFloat(s)) // integer/decimal

  return null
}

function finite(n: number): number | null {
  return Number.isFinite(n) ? n : null
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return ''
  return String(Math.round(n * 100) / 100)
}

function joinQtyUnit(qu: QtyUnit): string {
  return [(qu.quantity || '').trim(), (qu.unit || '').trim()].filter(Boolean).join(' ')
}

/**
 * Combine two quantities for an exact-noun merge (decision #4):
 *  - same/compatible unit (or both unitless) AND both numeric → SUM
 *    ("2 cups" + "1 cup" = "3 cups")
 *  - otherwise → list both side by side, never dropping a value
 *    ("2 cups + 3 tbsp", "a handful + 200 g"); the combined text lives in
 *    `quantity` with `unit` cleared so it renders verbatim.
 */
export function mergeQuantities(existing: QtyUnit, incoming: QtyUnit): QtyUnit {
  const eQ = (existing.quantity || '').trim()
  const iQ = (incoming.quantity || '').trim()
  const eU = (existing.unit || '').trim()
  const iU = (incoming.unit || '').trim()

  // Nothing to combine on one side → keep whatever quantity we do have.
  if (!eQ && !iQ) return { quantity: '', unit: eU || iU }
  if (!iQ) return { quantity: eQ, unit: eU }
  if (!eQ) return { quantity: iQ, unit: iU }

  const eNum = parseQtyNumber(eQ)
  const iNum = parseQtyNumber(iQ)
  const eCanon = unitCanonical(eU)
  const iCanon = unitCanonical(iU)
  const unitsCompatible =
    (eCanon !== null && eCanon === iCanon) || (eU === '' && iU === '')

  if (eNum !== null && iNum !== null && unitsCompatible) {
    return { quantity: formatNumber(eNum + iNum), unit: eU || iU }
  }

  return {
    quantity: `${joinQtyUnit({ quantity: eQ, unit: eU })} + ${joinQtyUnit({ quantity: iQ, unit: iU })}`,
    unit: '',
  }
}

/**
 * Split a raw ingredient line into { quantity, unit, name, confidence }.
 * Pure and deterministic. Never throws.
 */
export function parseIngredient(raw: string): ParsedIngredient {
  const original = (raw || '').trim()
  if (!original) return { quantity: '', unit: '', name: '', confidence: 'high' }

  // Drop a leading list bullet/marker ("- 2 cups flour", "• garlic").
  const s = original.replace(/^[-*•·]+\s*/, '').trim()
  if (!s) return { quantity: '', unit: '', name: original, confidence: 'high' }

  const m = s.match(LEADING_QTY_RE)
  if (!m) {
    // No leading quantity — a plain noun phrase ("garlic", "red onion",
    // "Kosher salt"). Always storable verbatim; no AI needed.
    return { quantity: '', unit: '', name: s, confidence: 'high' }
  }

  const quantity = m[0].trim().replace(/\s+/g, ' ')
  const rest = s.slice(m[0].length).trim()

  // Ambiguous doubled quantity ("6 4 ears shucked corn"): a valid quantity is
  // immediately followed by another bare number. Don't guess — defer to AI.
  if (/^\d+(?:\.\d+)?(?:\s|$)/.test(rest)) {
    return { quantity: '', unit: '', name: original, confidence: 'low' }
  }

  let unit = ''
  const tokens = rest.length ? rest.split(/\s+/) : []
  if (tokens.length) {
    const cand = tokens[0].replace(/[.,]+$/, '').toLowerCase()
    if (isKnownUnit(cand)) {
      unit = cand
      tokens.shift()
      // "1 can OF black beans" → drop the connector
      if (tokens[0] && tokens[0].toLowerCase() === 'of') tokens.shift()
    }
  }

  let name = tokens.join(' ').trim()
  if (!unit) name = name.replace(/^of\s+/i, '').trim()

  if (!name) {
    // Quantity (+unit) with no noun ("2 cups"): keep the line verbatim rather
    // than store a nameless item — and don't waste an AI call AI can't fix.
    return { quantity: '', unit: '', name: original, confidence: 'high' }
  }

  return { quantity, unit, name, confidence: 'high' }
}
