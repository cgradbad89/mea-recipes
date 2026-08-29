// Pure content-parsing helpers shared by client code (lib/recipes.ts) and
// server code (lib/nutritionEngine.ts). This module must stay free of any
// firebase import — the client SDK must not leak into server routes and the
// admin SDK must not leak into the browser bundle.

const INGREDIENT_HEADING = /^(INGREDIENTS|WHAT YOU NEED|YOU WILL NEED|SHOPPING LIST)(?:[ \t]*\(([^()\r\n]{1,80})\)[ \t]*)?:?$/i
const INSTRUCTION_HEADING = /^(INSTRUCTIONS|PREPARATION|DIRECTIONS|METHOD|STEPS|HOW TO MAKE):?$/i

const INGREDIENT_HEADER_KEYWORDS = new Set([
  'sauce', 'sauces', 'garnish', 'garnishes', 'marinade', 'dressing',
  'topping', 'toppings', 'filling', 'glaze', 'rub', 'spice mix',
  'spice blend', 'seasoning', 'seasoning blend', 'to serve',
  'to garnish', 'for serving', 'serving', 'dough', 'batter',
  'crust', 'assembly', 'main', 'main dish', 'dish',
])

// Exact normalized labels for audited subheader occurrences that the former
// presentation-only predicate missed. Keep this evidence-bound: generic
// short/title-case/no-quantity rules would also consume legitimate ingredients.
const AUDITED_INGREDIENT_SUBHEADER_LABELS = new Set([
  'additional toppings (optional)',
  'aromatics',
  'couscous sweet potato black bean salad',
  'enchiladas',
  'extras',
  'for the chicken',
  'for the chicken (see note 1 for other protein options)',
  'for the chickpeas',
  'for the chili',
  'for the croutons (optional)',
  'for the green harissa dressing',
  'for the green sauce',
  'for the mediterranean bowls (build your own bowls based on what you like)',
  'for the pickled onions',
  'for the ramen egg',
  'for the roasted tomatillo chipotle sauce',
  'for the rosemary oil',
  'for the salad',
  'for the soup',
  'for the stir fry',
  'for the stir-fry',
  'for the tacos',
  'green chile sauce',
  'green chile sauce!',
  'green tahini',
  'lime basil vinaigrette',
  'noodles',
  'pineapple salsa',
  'proteins',
  'quick cabbage slaw',
  'rosemary lemon garlic oil ( for drizzling)',
  'seasonings',
  'sheet pan ingredients',
  'spice rub',
  'the extras',
  'vegetables',
])

const NOTES_BOUNDARY = /^notes?:$/i
const EXACT_INSTRUCTION_BOUNDARY = /^(?:PREP|ON THE STOVE)$/i
const TERMINAL_PAGE_BLOCK = /^(?:OUR LATEST NEWSLETTER|5 Secrets of Authentic Chinese Cooking)$/i
const PAGE_CONTROL_LINE = /^(?:add (?:ingredients? )?to (?:your )?grocery list|shop ingredients? on instacart|email grocery list|save recipe|(?:cook mode )?prevent your screen from going dark|get the guide for free)$/i
const INSTRUCTION_REVIEW_BOUNDARY = /^(?:Have you cooked this\?(?: Mark as Cooked)?|COOKING NOTES|Comments?|Reviews?|Reader notes|Ratings?|.{1,80}\d+\s+years? ago)$/i
const INSTRUCTION_FOOTER_BOUNDARY = /^(?:Storage(?: Suggestions?)?:\s*|(?:📊\s*)?Nutrition Estimate:|Nutrition(?:al Information)?:$)/i
const INSTRUCTION_FOOTER_LINE = /^(?:Note:\s*The nutritional information\b|Recipe Source:\s*https?:\/\/\S+)/i
const INSTRUCTION_PAGE_CONTROL = /^(?:Make the recipe with us|On Off)$/i
const PREP_METHOD_HEADING = /^PREP:?$/i
const STOVE_METHOD_HEADING = /^ON THE STOVE:?$/i
const STANDALONE_STEP_HEADING = /^Step\s+(\d+):?$/i
const METADATA_LABEL_LINE = /^(?:yield|scale|prep(?: time)?|cook(?: time)?|total(?: time)?|rating|nutrition(?:al information)?|serves?|servings?|units? usm|us customary\s*-\s*metric|metric conversion)(?::.*)?$/i
const METADATA_TIME_VALUE = /^\d+(?:\.\d+)?\s+(?:minutes?|hours?)(?:\s+minutes?)?(?:\s*\(.*\))?$/i
const METADATA_SERVINGS_VALUE = /^\d+(?:\s+(?:to|[-\u2013\u2014])\s+\d+)?\s+servings?$/i
const METADATA_SCALE_VALUE = /^(?:\d+(?:\.\d+)?|\d+\s*\/\s*\d+)\s*[x\u00d7]$/i
const METADATA_RATING_VALUE = /^(?:\([\d,]+\)|\d+(?:\.\d+)?\s+from\s+[\d,]+\s+votes)$/i
const METADATA_BYLINE = /^by:\s*\S/i
const METRIC_CONVERSION_COPY = /^These recipes were created in US Customary measurements and the conversion to metric is being done by calculations\./i

// Strip at most four leading pictographic graphemes for section-label
// comparison only. The original content line is retained for extraction.
const LEADING_HEADING_DECORATION = /^(?:\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*[ \t]*){1,4}/u

function sectionHeadingCandidate(line: string): string {
  return line.trimStart().replace(LEADING_HEADING_DECORATION, '')
}

function isIngredientHeading(line: string): boolean {
  const match = INGREDIENT_HEADING.exec(sectionHeadingCandidate(line))
  return match !== null && (match[2] === undefined || match[2].trim().length > 0)
}

function isInstructionHeading(line: string): boolean {
  return INSTRUCTION_HEADING.test(sectionHeadingCandidate(line))
}

function normalizedSubheaderLabel(line: string): string {
  return line
    .trim()
    .replace(/^\*+|\*+$/g, '')
    .replace(/:$/, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/** Pure shared identity check for presentation and all downstream consumers. */
export function isIngredientSubheader(line: string): boolean {
  if (!line) return false
  const trimmed = line.trim()
  if (!trimmed) return false

  // Preserve the established presentation semantics.
  if (trimmed.endsWith(':')) {
    const withoutColon = trimmed.slice(0, -1).trim()
    if (!/\d/.test(withoutColon) && withoutColon.length < 60) return true
  }
  if (/^(\*\*|\*)(.+?)\1$/.test(trimmed)) return true

  const label = normalizedSubheaderLabel(trimmed)
  const keyword = label
    .replace(/^for the\s+/i, '')
    .replace(/^for\s+/i, '')
    .trim()

  return INGREDIENT_HEADER_KEYWORDS.has(keyword) || AUDITED_INGREDIENT_SUBHEADER_LABELS.has(label)
}

/** True only when the complete trimmed value is an explicit HTTP(S) URL. */
export function isExplicitUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test((value || '').trim())
}

function isRecipeMetadataLine(line: string): boolean {
  const trimmed = line.trim()
  return METADATA_LABEL_LINE.test(trimmed) ||
    METADATA_TIME_VALUE.test(trimmed) ||
    METADATA_SERVINGS_VALUE.test(trimmed) ||
    METADATA_SCALE_VALUE.test(trimmed) ||
    METADATA_RATING_VALUE.test(trimmed) ||
    METADATA_BYLINE.test(trimmed) ||
    METRIC_CONVERSION_COPY.test(trimmed)
}

/**
 * Apply the same conservative controls to both ingredient extraction paths.
 * Subheaders deliberately remain in this presentation-oriented array; shared
 * downstream guards keep them out of grocery and nutrition processing.
 */
function filterIngredientSpan(span: string[]): string[] {
  const ratingIndex = span.findIndex(line => /^rating$/i.test(line))
  const yieldAfterRating = ratingIndex === -1
    ? -1
    : span.findIndex((line, index) => index > ratingIndex && /^yield(?::|$)/i.test(line))

  const ingredients: string[] = []
  for (let index = 0; index < span.length; index += 1) {
    const line = span[index]

    // Audited NYT preambles place rating/comments/article copy before a later
    // Yield marker. The two exact anchors make this a bounded metadata block.
    if (ratingIndex !== -1 && yieldAfterRating !== -1 && index >= ratingIndex && index <= yieldAfterRating) {
      continue
    }

    // These exact markers start non-ingredient tails in the reviewed corpus.
    if (NOTES_BOUNDARY.test(line) || EXACT_INSTRUCTION_BOUNDARY.test(line) || TERMINAL_PAGE_BLOCK.test(line)) {
      break
    }

    if (line.length <= 2 || isRecipeMetadataLine(line) || PAGE_CONTROL_LINE.test(line) || isExplicitUrl(line)) {
      continue
    }

    ingredients.push(line)
  }
  return ingredients
}

function findPrepMethodStart(lines: string[], ingredientStart: number): number {
  if (ingredientStart === -1) return -1
  const prepStart = lines.findIndex((line, index) =>
    index > ingredientStart && PREP_METHOD_HEADING.test(sectionHeadingCandidate(line)),
  )
  if (prepStart === -1) return -1

  const stoveStart = lines.findIndex((line, index) =>
    index > prepStart && STOVE_METHOD_HEADING.test(sectionHeadingCandidate(line)),
  )
  if (stoveStart === -1) return -1

  const hasPrepAction = lines.slice(prepStart + 1, stoveStart).some(line => line.length > 10)
  const hasStoveAction = lines.slice(stoveStart + 1).some(line => line.length > 10)
  return hasPrepAction && hasStoveAction ? prepStart : -1
}

function findSequentialStepMethod(lines: string[], ingredientStart: number): {
  start: number
  instructions: string[]
} | null {
  if (ingredientStart === -1) return null

  const headings = lines.flatMap((line, index) => {
    if (index <= ingredientStart) return []
    const match = STANDALONE_STEP_HEADING.exec(line)
    return match ? [{ index, number: Number(match[1]) }] : []
  })
  const first = headings.findIndex(heading => heading.number === 1)
  if (first === -1) return null

  const sequence = headings.slice(first)
  if (sequence.length < 2 || sequence.some((heading, index) => heading.number !== index + 1)) {
    return null
  }

  const instructions = sequence.map(heading => lines[heading.index + 1] || '')
  if (instructions.some(line => line.length <= 10 || STANDALONE_STEP_HEADING.test(line))) {
    return null
  }

  return { start: sequence[0].index, instructions }
}

function filterInstructionSpan(span: string[]): string[] {
  const instructions: string[] = []
  for (const line of span) {
    if (INSTRUCTION_REVIEW_BOUNDARY.test(line) || INSTRUCTION_FOOTER_BOUNDARY.test(line)) break
    if (
      isExplicitUrl(line) ||
      INSTRUCTION_FOOTER_LINE.test(line) ||
      INSTRUCTION_PAGE_CONTROL.test(line) ||
      PREP_METHOD_HEADING.test(line) ||
      STOVE_METHOD_HEADING.test(line)
    ) continue
    if (line.length <= 10) continue

    const stripped = line.replace(/^Step\s+\d+\s*/i, '').trim()
    if (stripped.length > 10) instructions.push(stripped)
  }
  return instructions
}

// Parse ingredients and steps out of the raw content field
export function parseRecipeContent(content: string): {
  sourceURL: string
  ingredients: string[]
  instructions: string[]
  description: string
} {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean)

  const sourceURL = lines.find(l => l.startsWith('http')) || ''

  // Heading comparison is case-insensitive, accepts an optional trailing
  // colon, and ignores only bounded leading pictographic decoration. Ingredient
  // headings may also carry one nonempty, non-nested qualifier of at most 80
  // characters. Normal content extraction always uses the original lines.
  const ingredientHeadingIndexes = lines.flatMap((line, index) => isIngredientHeading(line) ? [index] : [])
  // Multiple top-level ingredient sections are ambiguous in the single-recipe
  // content model. Refuse to collapse composite content into one ingredient list.
  const ingStart = ingredientHeadingIndexes.length === 1 ? ingredientHeadingIndexes[0] : -1
  const ordinaryInstStart = lines.findIndex(isInstructionHeading)
  const prepInstStart = ordinaryInstStart === -1 ? findPrepMethodStart(lines, ingStart) : -1
  const numberedStepMethod = ordinaryInstStart === -1 && prepInstStart === -1
    ? findSequentialStepMethod(lines, ingStart)
    : null
  const instStart = ordinaryInstStart !== -1
    ? ordinaryInstStart
    : prepInstStart !== -1
      ? prepInstStart
      : numberedStepMethod?.start ?? -1

  let ingredients: string[] = []
  let instructions: string[] = []

  if (ingStart !== -1 && instStart !== -1) {
    ingredients = filterIngredientSpan(lines.slice(ingStart + 1, instStart))
  } else if (ingStart !== -1) {
    // Preserve the fallback's existing 20-line horizon; filtering must not pull
    // previously out-of-range content into the ingredient list.
    ingredients = filterIngredientSpan(
      lines.slice(ingStart + 1).filter(line => line.length > 2).slice(0, 20),
    )
  }

  if (numberedStepMethod) {
    // This no-heading fallback is intentionally limited to the single content
    // line immediately following each exact, sequential standalone Step N label.
    // That bounds the method without making generic Tip/Notes prose terminal.
    instructions = filterInstructionSpan(numberedStepMethod.instructions)
  } else if (instStart !== -1) {
    instructions = filterInstructionSpan(lines.slice(instStart + 1))
  }

  const descLines = lines.filter(
    l => !l.startsWith('http') &&
    !isIngredientHeading(l) &&
    !isInstructionHeading(l) &&
    !l.match(/^(Step|Yield|Total|Prep|Cook)/i) &&
    l.length > 20
  )
  const description = descLines[0] || ''

  return { sourceURL, ingredients, instructions, description }
}
