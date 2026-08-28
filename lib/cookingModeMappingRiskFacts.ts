import { isIngredientSubheader } from '@/lib/recipeContent'
import type {
  MappingFrozenV10BRiskFacts,
  MappingReviewerRelationshipV1,
  MappingRevisionSource,
} from '@/types/cookingModeMapping'

const UNIT_WORDS = new Set([
  'cup', 'cups', 'tablespoon', 'tablespoons', 'tbsp', 'teaspoon', 'teaspoons', 'tsp',
  'pound', 'pounds', 'lb', 'lbs', 'ounce', 'ounces', 'oz', 'gram', 'grams', 'g',
  'clove', 'cloves', 'can', 'cans', 'bunch', 'bunches', 'package', 'packages', 'pinch',
])
const STOP_WORDS = new Set([
  'the', 'and', 'or', 'with', 'for', 'from', 'into', 'of', 'to', 'a', 'an', 'about',
  'more', 'taste', 'optional', 'divided', 'fresh', 'large', 'medium', 'small', 'thinly',
  'finely', 'roughly', 'chopped', 'sliced', 'diced', 'minced', 'trimmed', 'peeled',
  'cut', 'see', 'notes', 'note', 'use', 'using', 'plus', 'extra', 'as', 'needed',
  'wooden', 'soaked', 'minutes', 'minute', 'hours', 'hour',
])
const COMPONENT_NOUNS = [
  'sauce', 'dressing', 'mixture', 'mix', 'broth', 'salad', 'wrap', 'marinade', 'batter',
  'slaw', 'filling', 'paste', 'glaze', 'soup', 'stock', 'salsa', 'cream', 'rub', 'mole',
]

function normalizeText(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')
}

function ingredientIdentityTokens(value: string): string[] {
  return normalizeText(value).split(' ').filter(token => token.length > 1 &&
    !/^\d+$/.test(token) && !UNIT_WORDS.has(token) && !STOP_WORDS.has(token))
}

function quantityText(value: string): string | null {
  const normalized = normalizeText(value)
  const match = normalized.match(/(?:^|\b)(\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:\.\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])(?:\s+(?:to|-|–)\s*(?:\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:\.\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞]))?\s+(cups?|tablespoons?|tbsp|teaspoons?|tsp|pounds?|lbs?|ounces?|oz|grams?|g|cloves?|cans?|bunch(?:es)?|packages?)\b/)
  return match?.[0] ?? null
}

function sourceMentionsIngredient(instruction: string, ingredientText: string): boolean {
  const source = ` ${normalizeText(instruction)} `
  const tokens = [...new Set(ingredientIdentityTokens(ingredientText))]
  if (!tokens.length) return false
  const distinctive = tokens.filter(token => token.length >= 4)
  const required = distinctive.length > 1 ? Math.min(2, distinctive.length) : 1
  return distinctive.filter(token => source.includes(` ${token} `)).length >= required ||
    tokens.some(token => token.length >= 3 && source.includes(` ${token} `))
}

export function mappingIngredientGroup(source: MappingRevisionSource, ingredientRowIndex: number): string | null {
  let group: string | null = null
  for (let index = 0; index <= ingredientRowIndex && index < source.ingredients.length; index += 1) {
    if (isIngredientSubheader(source.ingredients[index])) group = source.ingredients[index]
  }
  return group
}

function duplicateSiblings(source: MappingRevisionSource, ingredientRowIndex: number): number[] {
  const tokens = new Set(ingredientIdentityTokens(source.ingredients[ingredientRowIndex] ?? ''))
  return source.ingredients.flatMap((item, index) => {
    if (index === ingredientRowIndex || isIngredientSubheader(item)) return []
    const sibling = new Set(ingredientIdentityTokens(item))
    if (!tokens.size || !sibling.size) return []
    const intersection = [...tokens].filter(token => sibling.has(token)).length
    return intersection / Math.min(tokens.size, sibling.size) >= 0.8 ? [index] : []
  })
}

export function extractMappingV1RiskFacts(input: {
  source: MappingRevisionSource
  ingredientRowIndex: number
  stepIndex: number
  reviewerAAccepts: readonly MappingReviewerRelationshipV1[]
  reviewerBAccepts: readonly MappingReviewerRelationshipV1[]
}): MappingFrozenV10BRiskFacts {
  const { source, ingredientRowIndex, stepIndex } = input
  const ingredientText = source.ingredients[ingredientRowIndex] ?? ''
  const instructionText = source.instructions[stepIndex] ?? ''
  const ingredientGroup = mappingIngredientGroup(source, ingredientRowIndex)
  const explicitlyNamed = sourceMentionsIngredient(instructionText, ingredientText)
  const identityTokens = [...new Set(ingredientIdentityTokens(ingredientText).filter(token => token.length >= 3))]
  const currentSource = ` ${normalizeText(instructionText)} `
  const matchedIdentityTokens = identityTokens.filter(token => currentSource.includes(` ${token} `))
  const partialIdentityMatchRisk = identityTokens.length > 1 && matchedIdentityTokens.length > 0 &&
    matchedIdentityTokens.length < identityTokens.length &&
    matchedIdentityTokens.every(token => COMPONENT_NOUNS.includes(token) || token === 'oil')
  const priorInstructionMentions: number[] = []
  const laterInstructionMentions: number[] = []
  source.instructions.forEach((instruction, index) => {
    if (!sourceMentionsIngredient(instruction, ingredientText)) return
    if (index < stepIndex) priorInstructionMentions.push(index)
    if (index > stepIndex) laterInstructionMentions.push(index)
  })

  const reviewerCounts = new Map<number, number>()
  for (const relationships of [input.reviewerAAccepts, input.reviewerBAccepts]) {
    for (const relationship of relationships) {
      if (relationship.ingredientRowIndex !== ingredientRowIndex || relationship.stepIndex >= stepIndex) continue
      reviewerCounts.set(relationship.stepIndex, (reviewerCounts.get(relationship.stepIndex) ?? 0) + 1)
    }
  }
  const priorReviewerUses = [...reviewerCounts]
    .map(([instructionIndex, reviewerCount]) => ({ instructionIndex, reviewerCount }))
    .sort((left, right) => left.instructionIndex - right.instructionIndex)
  const current = normalizeText(instructionText)
  const componentLabels = COMPONENT_NOUNS.filter(noun => new RegExp(`\\b${noun}\\b`, 'i').test(instructionText))
  const currentInstructionRefersToComponent = componentLabels.length > 0
  const priorUseIndexes = priorReviewerUses.map(item => item.instructionIndex)
  const listedQuantity = quantityText(ingredientText)
  const currentInstructionQuantity = quantityText(instructionText)
  const priorUseQuantity = priorUseIndexes.map(index => quantityText(source.instructions[index] ?? '')).find(Boolean) ?? null
  const remainingLanguage = /\b(?:remaining|remainder|rest|reserved|another portion|divided)\b/.test(current)
  const processMaterialRisk = /\b(?:skewers?|ice|water|foil|parchment|oil for (?:frying|greasing))\b/.test(normalizeText(ingredientText)) && !explicitlyNamed
  const contextualMentionRisk = /\b(?:taste and adjust|adjust seasoning|serve with|for serving|set aside|keep warm|cover and refrigerate|once everything|finished|assemble|build your)\b/.test(current) &&
    (!explicitlyNamed || /\b(?:assemble|build your|taste and adjust|once everything)\b/.test(current))
  const collectiveReferenceRisk = /\b(?:all (?:of )?the ingredients|rest of (?:the )?ingredients|everything|fried ingredients|prepared ingredients)\b/.test(current) && !explicitlyNamed
  const groupNamedByCurrent = ingredientIdentityTokens(ingredientGroup ?? '').some(token => current.includes(token))
  const possibleConstituent = currentInstructionRefersToComponent && !explicitlyNamed &&
    (priorReviewerUses.length > 0 || groupNamedByCurrent || collectiveReferenceRisk)
  const lifecycleRisk = priorReviewerUses.length > 0 && !remainingLanguage &&
    (!explicitlyNamed || currentInstructionRefersToComponent || contextualMentionRisk)
  const groupTokens = ingredientIdentityTokens(ingredientGroup ?? '')
  const groupConflictRisk = Boolean(ingredientGroup) && groupTokens.length > 0 &&
    !groupTokens.some(token => current.includes(token)) && source.ingredients.some((item, index) => {
      const otherGroup = mappingIngredientGroup(source, index)
      return !isIngredientSubheader(item) && otherGroup && otherGroup !== ingredientGroup &&
        ingredientIdentityTokens(otherGroup).some(token => current.includes(token))
    })
  const quantityConflictRisk = Boolean(listedQuantity && currentInstructionQuantity &&
    normalizeText(listedQuantity) !== normalizeText(currentInstructionQuantity) && explicitlyNamed)

  return {
    isExplicitlyNamedInInstruction: explicitlyNamed,
    ingredientGroup,
    duplicateSiblingIndexes: duplicateSiblings(source, ingredientRowIndex),
    priorInstructionMentions,
    laterInstructionMentions,
    priorReviewerUses,
    quantityEvidence: {
      ...(listedQuantity ? { listedQuantity } : {}),
      ...(currentInstructionQuantity ? { currentInstructionQuantity } : {}),
      ...(priorUseQuantity ? { priorUseQuantity } : {}),
    },
    componentContext: {
      possibleConstituent,
      componentLabels,
      ...(priorUseIndexes.length ? { establishedInstructionIndex: Math.max(...priorUseIndexes) } : {}),
      currentInstructionRefersToComponent,
    },
    remainingLanguage,
    processMaterialRisk,
    contextualMentionRisk,
    duplicateRowRisk: duplicateSiblings(source, ingredientRowIndex).length > 0,
    groupConflictRisk,
    quantityConflictRisk,
    lifecycleRisk,
    collectiveReferenceRisk,
    partialIdentityMatchRisk,
  }
}
