// Pure content-parsing helpers shared by client code (lib/recipes.ts) and
// server code (lib/nutritionEngine.ts). This module must stay free of any
// firebase import — the client SDK must not leak into server routes and the
// admin SDK must not leak into the browser bundle.

// Parse ingredients and steps out of the raw content field
export function parseRecipeContent(content: string): {
  sourceURL: string
  ingredients: string[]
  instructions: string[]
  description: string
} {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean)

  const sourceURL = lines.find(l => l.startsWith('http')) || ''

  // Find INGREDIENTS section (case-insensitive; tolerate a trailing colon,
  // e.g. "INGREDIENTS:" — seen in slow-cooker-carnitas-style content)
  const ingKeywords = /^(INGREDIENTS|WHAT YOU NEED|YOU WILL NEED|SHOPPING LIST):?$/i
  const instKeywords = /^(INSTRUCTIONS|PREPARATION|DIRECTIONS|METHOD|STEPS|HOW TO MAKE):?$/i

  const ingStart  = lines.findIndex(l => ingKeywords.test(l))
  const instStart = lines.findIndex(l => instKeywords.test(l))

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
    !ingKeywords.test(l) &&
    !instKeywords.test(l) &&
    !l.match(/^(Step|Yield|Total|Prep|Cook)/i) &&
    l.length > 20
  )
  const description = descLines[0] || ''

  return { sourceURL, ingredients, instructions, description }
}
