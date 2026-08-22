// Pure content-parsing helpers shared by client code (lib/recipes.ts) and
// server code (lib/nutritionEngine.ts). This module must stay free of any
// firebase import — the client SDK must not leak into server routes and the
// admin SDK must not leak into the browser bundle.

const INGREDIENT_HEADING = /^(INGREDIENTS|WHAT YOU NEED|YOU WILL NEED|SHOPPING LIST)(?:[ \t]*\(([^()\r\n]{1,80})\)[ \t]*)?:?$/i
const INSTRUCTION_HEADING = /^(INSTRUCTIONS|PREPARATION|DIRECTIONS|METHOD|STEPS|HOW TO MAKE):?$/i

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
  const instStart = lines.findIndex(isInstructionHeading)

  let ingredients: string[] = []
  let instructions: string[] = []

  if (ingStart !== -1 && instStart !== -1) {
    ingredients = lines
      .slice(ingStart + 1, instStart)
      .filter(l => !l.match(/^(yield|step|total|prep|cook|rating|scale)/i) && l.length > 2)
  } else if (ingStart !== -1) {
    ingredients = lines.slice(ingStart + 1).filter(l => l.length > 2).slice(0, 20)
  }

  if (instStart !== -1) {
    const rawSteps = lines.slice(instStart + 1)
    instructions = rawSteps
      .filter(l => l.length > 10)
      .map(l => l.replace(/^Step\s+\d+\s*/i, '').trim())
      .filter(l => l.length > 10)
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
