import pairingsData from './flavor-pairings.json'

const PAIRINGS: Record<string, string[]> = pairingsData as Record<string, string[]>

export function normalizeIngredientKey(raw: string): string {
  let s = raw.toLowerCase().trim()
  s = s.replace(/^[\d\s.,/\-¼-¾⅐-⅞]+/, '')
  s = s.replace(/\b(cups?|tbsp|tsp|tablespoons?|teaspoons?|pounds?|lbs?|oz|ounces?|grams?|g|ml|cloves?|slices?|cans?|packages?|pinch|dash|bunch|handful)\b/gi, '')
  s = s.replace(/\b(fresh|dried|chopped|minced|sliced|diced|ground|whole|large|small|medium|ripe|boneless|skinless|to taste|finely|roughly|grated|peeled|seeded|crushed|melted|softened|divided|optional)\b/gi, '')
  s = s.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
  return s
}

export function lookupPairings(ingredientKey: string): string[] {
  if (!ingredientKey) return []
  if (PAIRINGS[ingredientKey]) return PAIRINGS[ingredientKey]
  const words = ingredientKey.split(' ')
  for (let i = 1; i < words.length; i++) {
    const sub = words.slice(i).join(' ')
    if (PAIRINGS[sub]) return PAIRINGS[sub]
  }
  const last = words[words.length - 1]
  if (PAIRINGS[last]) return PAIRINGS[last]
  return []
}

export function getComplementaryIngredients(inputs: string[], max = 15): string[] {
  const present = new Set(inputs.map(normalizeIngredientKey).filter(Boolean))
  const scores: Record<string, number> = {}
  for (const input of inputs) {
    const key = normalizeIngredientKey(input)
    const pairings = lookupPairings(key)
    pairings.forEach((p, idx) => {
      if (present.has(p)) return
      scores[p] = (scores[p] || 0) + (pairings.length - idx)
    })
  }
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([name]) => name)
}
