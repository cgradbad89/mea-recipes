import {
  convertQuantity,
  normalizeNoun,
  parseIngredient,
  parseQuantityNumber,
  unitCanonical,
} from '@/lib/ingredientParser'
import { isIngredientSubheader } from '@/lib/recipeContent'
import type {
  CookingIngredientUsage,
  CookingStepIngredientMap,
  CookingStepIngredientReference,
  CookingStepMapping,
} from '@/types/recipe'

export const COOKING_MAPPING_PARSER_VERSION = 'recipe-content-v1'
export const COOKING_MAPPING_ENGINE_VERSION = 'deterministic-v4'
export const COOKING_MAPPING_HYBRID_ENGINE_VERSION = 'hybrid-v4'

export type CookingStepMapFallbackReason =
  | 'missing'
  | 'source-hash-mismatch'
  | 'unsupported-schema'
  | 'unsupported-parser'
  | 'unsupported-engine'
  | 'invalid-structure'

export interface ResolvedCookingStepMap {
  mapping: CookingStepIngredientMap
  source: 'persisted' | 'deterministic-fallback'
  fallbackReason?: CookingStepMapFallbackReason
}

export type CookingStepMapValidationResult =
  | { valid: true }
  | { valid: false; reason: Exclude<CookingStepMapFallbackReason, 'missing'> }

export const AI_ELIGIBLE_COOKING_MAPPING_REASONS = [
  'ambiguous',
  'implicit-reference',
  'prepared-component',
] as const

type AiEligibleCookingMappingReason = typeof AI_ELIGIBLE_COOKING_MAPPING_REASONS[number]

export function isAiEligibleCookingMappingReason(
  reason: CookingStepMapping['unresolvedReason'],
): reason is AiEligibleCookingMappingReason {
  return reason !== undefined && AI_ELIGIBLE_COOKING_MAPPING_REASONS.includes(reason as AiEligibleCookingMappingReason)
}

export function hasAiEligibleCookingSteps(map: Pick<CookingStepIngredientMap, 'steps'>): boolean {
  return map.steps.some(step => isAiEligibleCookingMappingReason(step.unresolvedReason))
}

const PREPARATION_WORDS = new Set([
  'chopped', 'coarsely', 'crushed', 'cubed', 'diced', 'divided', 'drained',
  'finely', 'freshly', 'grated', 'halved', 'large', 'medium', 'melted',
  'minced', 'optional', 'packed', 'peeled', 'pressed', 'quartered', 'roughly',
  'rinsed', 'seeded',
  'shredded', 'sifted', 'sliced', 'small', 'softened', 'thinly', 'trimmed',
])

const REFERENCE_DESCRIPTOR_WORDS = new Set([
  'ground', 'natural', 'plain', 'salted', 'sweetened', 'unsalted', 'unsweetened',
])

const TERMINAL_COUNT_FORMS = new Set([
  'bunch', 'clove', 'head', 'package', 'piece', 'sprig', 'stalk',
])

const PROTEIN_WORDS = new Set([
  'beef', 'chicken', 'fish', 'lamb', 'pork', 'salmon', 'shrimp', 'tofu',
  'tuna', 'turkey',
])

const DISTINCTIVE_CATEGORY_FORMS = new Set([
  'bean', 'butter', 'cheese', 'ketchup', 'mayonnaise', 'mustard',
  'yogurt',
])

const QUALIFIED_GENERIC_FORMS = new Set([
  'cheese', 'cream', 'herb', 'milk', 'oil', 'sauce', 'stock',
])

const COMPONENT_WORDS = new Set([
  'batter', 'dough', 'dressing', 'filling', 'glaze', 'marinade', 'mixture',
  'rub', 'sauce', 'seasoning', 'tadka', 'topping',
])

const PREPARED_CARRIER_WORDS = new Set([
  ...COMPONENT_WORDS, 'aioli', 'mayo', 'mayonnaise', 'pesto',
])

const ROW_SENSITIVE_FORMS = new Set(['chile', 'garlic', 'oil', 'salt', 'water'])

const SOURCE_SECTION_LABELS = new Set([
  'aromatic', 'noodle', 'oil', 'protein', 'seasoning', 'vegetable',
])

const PURPOSE_SECTION_TAILS = new Set(['rub', 'slaw'])

const SHARED_ALTERNATIVE_HEAD_FORMS = new Set([
  'broth', 'cheese', 'chile', 'cream', 'milk', 'oil', 'pepper', 'powder',
  'sauce', 'seasoning', 'stock', 'vinegar', 'yogurt',
])

const NON_PRIMARY_PROTEIN_FORMS = new Set([
  'base', 'broth', 'flavor', 'oil', 'powder', 'sauce', 'seasoning', 'stock',
])

const AI_GENERIC_REFERENCE_FORMS = new Set([
  'bean', 'butter', 'cheese', 'cream', 'milk', 'oil', 'stock', 'yogurt',
])

const COOKING_MAPPING_UNRESOLVED_REASONS = new Set([
  'ambiguous', 'implicit-reference', 'prepared-component', 'no-ingredient-use', 'non-actionable',
])

const COLLECTIVE_REFERENCE = /\b(?:all (?:of )?(?:the )?(?:\w+ )?ingredient|remaining ingredient|dry ingredient|wet ingredient|everything(?: else)?)\b/
const CONFIDENT_NO_USE = /^(?:preheat\b|(?:bake|cook|roast) (?:for|until)\b|reduce (?:the )?heat\b|remove from (?:the )?heat\b|let (?:it|this|the mixture|the dish) (?:rest|cool|chill)\b|rest\b|cool completely\b|refrigerate\b|chill\b|set aside\b)/
const PREPARED_COMPONENT_REFERENCE = /\b(?:add|baste|brush|fold|pour|serve|spoon|spread|stir|toss)\b(?:\s+\w+){0,6}\s+(?:(?:in|over|with)\s+)?(?:(?:the|prepared)\s+)?(?:\w+\s+){0,2}(?:dressing|filling|glaze|marinade|mixture|sauce|tadka|topping)\b/

const EXACT_URL = /^https?:\/\/\S+$/i
const NON_ACTIONABLE_METADATA = /^(?:storage(?: suggestions?)?:|nutritional? information\b|(?:📊\s*)?nutrition estimate:|note:\s*the nutritional information\b|recipe source:)/i
const PAYWALL_PLACEHOLDER = /^(?:not available|unavailable)\b.*(?:paywall|could not be fetched|behind a paywall)/i
const REVIEW_OR_COMMENT = /^(?:have you cooked this\?|cooking notes$|most helpful\d*$|\d+ this is helpful$|loved this recipe\b|amazing recipe\b|delicious! if\b|also: this recipe is perfect\b|i made this for\b|i added all the water it asked\b)/i
const REVIEW_AUTHOR_LINE = /^.{1,80}\d+\s+years? ago$/i
const COMPONENT_HEADING = /^(?:(?:for )?(?:the )?)?[\p{L}\p{N} -]{0,50}(?:dressing|filling|glaze|marinade|mixture|sauce|tadka|topping):?$/iu
const INSTRUCTION_HEADING = /^(?:for\s+(?:the\s+)?|to\s+assemble\b|(?:start|finish|prepare|fry|mix)\s+(?:the\s+)?)[^.!?]{0,80}:?$/i
const SUPPLEMENTAL_REFERENCE = /^\d+\.\s*(?:apart from\b|please feel free\b|for shooting\b|mei fun is\b|you can either use\b|any type of\b)/i
const ACTIVE_USE_VERB = /\b(?:add|arrange|baste|beat|blend|boil|bring|brown|brush|coat|combine|cook|cut|divide|drain|drizzle|finish|fold|fry|garnish|grate|grill|heat|marinate|melt|mix|place|pour|press|pulse|reserve|return|rinse|roast|saute|season|sear|serve|shred|simmer|slice|smash|spoon|spread|sprinkle|squeeze|stir|stream|toss|top|transfer|use|whisk|wrap)\b/
const CONTINUING_USE_VERB = /(?:^| )(?:arrange|baste|brush|coat|cook|cut|divide|drain|garnish|grill|marinate|place|press|return|rinse|roast|sear|serve|shred|slice|top|transfer|toss|wrap)(?: the)?$/
const CONTEXTUAL_CLAUSE_START = /^(?:after|as|as soon as|before|if|once|until|when|while)\b/
const NEGATIVE_CLAUSE_START = /^(?:do not|dont|never|no need to|without|leave out)\b/
const SHORT_SECTION_HEADING = /^(?:prepare the [\p{L}\p{N} -]+|mix the (?:sauce|dressing)|fry the [\p{L}\p{N} -]+\s+&\s+[\p{L}\p{N} -]+|stir-fry to finish)$/iu

interface IngredientIdentity {
  ingredientIndex: number
  raw: string
  quantity: string
  unit: string
  identity: string
  aliases: string[]
  qualifiedAliases: string[]
  group: string | null
  sourceSectionLabel: boolean
}

interface PhraseOccurrence {
  ingredient: IngredientIdentity
  alias: string
  start: number
  end: number
  clauseIndex?: number
}

function stripBoundedParentheticals(value: string): string {
  let result = value
  let previous = ''
  // Ingredient notes in this domain are shallow. Repeating also handles a
  // bounded nested note without allowing an unclosed parenthesis to consume
  // the food identity.
  while (result !== previous) {
    previous = result
    result = result.replace(/\([^()\r\n]{0,120}\)/g, ' ')
  }
  return result
}

function normalizedWords(value: string): string[] {
  const normalized = normalizeNoun(value.replace(/[’']/g, '').replace(/[\/–—-]+/g, ' '))
  return normalized
    ? normalized.split(' ').filter(Boolean).map(word =>
      /^(?:chili|chily|chilies|chilie|chilli|chillis)$/.test(word) ? 'chile' : word)
    : []
}

function withoutPreparationWords(value: string): string {
  const words = normalizedWords(value).filter(word => !PREPARATION_WORDS.has(word))
  if (words.length > 2 && TERMINAL_COUNT_FORMS.has(words[0]) && words[1] === 'of') {
    words.splice(0, 2)
  }
  while (words.length > 1 && TERMINAL_COUNT_FORMS.has(words[words.length - 1])) words.pop()
  return words.join(' ')
}

function addAlias(target: Set<string>, value: string): void {
  const normalized = withoutPreparationWords(value)
  if (normalized) target.add(normalized)
}

function withoutReferenceDescriptors(value: string): string {
  return value.split(' ').filter(word => !REFERENCE_DESCRIPTOR_WORDS.has(word)).join(' ')
}

function ingredientAliases(rawName: string): {
  identity: string
  aliases: string[]
  qualifiedAliases: string[]
} {
  const withoutNotes = stripBoundedParentheticals(rawName)
  const beforeComma = withoutNotes.split(',')[0].trim()
  let alternatives = beforeComma
    .replace(/\band\s*\/\s*or\b/gi, ' or ')
    .replace(/\s+\/\s+/g, ' or ')
    .split(/\s+or\s+/i)
    .map(part => part.trim())
    .filter(Boolean)
  const finalAlternativeWords = normalizedWords(alternatives.at(-1) || '')
  const sharedHead = finalAlternativeWords.at(-1)
  if (sharedHead && finalAlternativeWords.length > 1 && SHARED_ALTERNATIVE_HEAD_FORMS.has(sharedHead)) {
    alternatives = alternatives.map(alternative => {
      const words = normalizedWords(alternative)
      return words.length > 0 && words.at(-1) !== sharedHead
        ? `${alternative} ${sharedHead}`
        : alternative
    })
  }
  const identity = withoutPreparationWords(alternatives[0] || beforeComma)
  const aliases = new Set<string>()
  const qualifiedAliases = new Set<string>()

  addAlias(aliases, identity)
  for (const alternative of alternatives.slice(1)) addAlias(aliases, alternative)

  for (const alias of [...aliases]) {
    const simplerReference = withoutReferenceDescriptors(alias)
    if (simplerReference && simplerReference !== alias) aliases.add(simplerReference)
  }

  for (const alias of [...aliases]) {
    const words = alias.split(' ')
    const protein = words.find(word => PROTEIN_WORDS.has(word))
    if (protein && !words.some(word => NON_PRIMARY_PROTEIN_FORMS.has(word))) aliases.add(protein)

    const tail = words[words.length - 1]
    if (words.length > 1 && DISTINCTIVE_CATEGORY_FORMS.has(tail)) {
      aliases.add(tail)
      const prefix = words.slice(0, -1).join(' ')
      if (prefix) aliases.add(prefix)
    }
    if (words.length > 1 && QUALIFIED_GENERIC_FORMS.has(tail)) {
      qualifiedAliases.add(tail)
      qualifiedAliases.add(words.slice(-2).join(' '))
    }
    if (tail === 'powder' && words.at(-2) === 'chile') {
      aliases.add('chile powder')
    }
    if (tail === 'water') aliases.add('water')
    if (tail === 'salt' && words.length === 2 && words[0] === 'kosher') aliases.add('salt')
    if (tail === 'miso') aliases.add('miso')
  }

  return {
    identity,
    aliases: [...aliases].sort(compareAliases),
    qualifiedAliases: [...qualifiedAliases].sort(compareAliases),
  }
}

function compareAliases(a: string, b: string): number {
  const tokenDifference = b.split(' ').length - a.split(' ').length
  return tokenDifference || b.length - a.length || a.localeCompare(b)
}

function normalizeGroup(raw: string): string {
  return normalizeNoun(raw
    .trim()
    .replace(/^\*+|\*+$/g, '')
    .replace(/:$/, '')
    .replace(/^for\s+(?:the\s+)?/i, '')
    .replace(/^the\s+/i, '')
    .replace(/\s+ingredients?$/i, ''))
}

function buildIngredientIdentities(ingredients: string[]): IngredientIdentity[] {
  const result: IngredientIdentity[] = []
  let group: string | null = null

  ingredients.forEach((raw, ingredientIndex) => {
    if (isIngredientSubheader(raw)) {
      group = normalizeGroup(raw) || null
      return
    }

    const parsed = parseIngredient(raw)
    const aliasData = ingredientAliases(parsed.name)
    if (!aliasData.identity) return
    const identityTail = aliasData.identity.split(' ').at(-1)
    if (
      !parsed.quantity && !parsed.unit &&
      /^[A-Z]/.test(raw.trim()) &&
      identityTail && PURPOSE_SECTION_TAILS.has(identityTail)
    ) {
      group = normalizeGroup(raw) || null
      return
    }
    const sourceSectionLabel = !parsed.quantity && !parsed.unit &&
      /^[A-Z]/.test(raw.trim()) && SOURCE_SECTION_LABELS.has(aliasData.identity)
    result.push({
      ingredientIndex,
      raw,
      quantity: parsed.quantity,
      unit: parsed.unit,
      group,
      sourceSectionLabel,
      ...aliasData,
    })
  })

  return result
}

function findPhrasePositions(words: string[], phrase: string): Array<{ start: number; end: number }> {
  const phraseWords = phrase.split(' ')
  const positions: Array<{ start: number; end: number }> = []
  if (!phraseWords.length || phraseWords.length > words.length) return positions

  for (let start = 0; start <= words.length - phraseWords.length; start += 1) {
    if (phraseWords.every((word, offset) => words[start + offset] === word)) {
      positions.push({ start, end: start + phraseWords.length })
    }
  }
  return positions
}

function isQualifiedReference(words: string[], position: { start: number; end: number }): boolean {
  const prefix = words.slice(Math.max(0, position.start - 6), position.start).join(' ')
  return /(?:^| )(?:remaining|rest of(?: the)?|half(?: of)?(?: the)?|quarter(?: of)?(?: the)?|some(?: of)?(?: the)?|\d+(?: \d+\/\d+|\/\d+)?(?: \w+)? of(?: the)?)$/.test(prefix)
}

function collectOccurrences(words: string[], identities: IngredientIdentity[]): PhraseOccurrence[] {
  const occurrences: PhraseOccurrence[] = []
  for (const ingredient of identities) {
    for (const alias of ingredient.aliases) {
      for (const position of findPhrasePositions(words, alias)) {
        occurrences.push({ ingredient, alias, ...position })
      }
    }
    for (const alias of ingredient.qualifiedAliases) {
      for (const position of findPhrasePositions(words, alias)) {
        if (isQualifiedReference(words, position)) {
          occurrences.push({ ingredient, alias, ...position })
        }
      }
    }
  }

  const chileIdentities = identities.filter(identity => identity.identity.split(' ').includes('chile'))
  for (const position of findPhrasePositions(words, 'chile')) {
    if (words[position.end] === 'powder') continue
    for (const ingredient of chileIdentities) {
      occurrences.push({ ingredient, alias: 'chile', ...position })
    }
  }

  // A shorter alias inside a more specific food phrase is not independent
  // evidence. This prevents "chicken" from selecting chicken breast inside
  // the phrase "chicken broth", while preserving a separate earlier mention.
  return occurrences.filter(occurrence =>
    !isInactiveOccurrence(words, occurrence) &&
    !occurrences.some(other =>
      other !== occurrence &&
      other.start <= occurrence.start &&
      other.end >= occurrence.end &&
      other.end - other.start > occurrence.end - occurrence.start
    ))
}

function isInactiveOccurrence(words: string[], occurrence: PhraseOccurrence): boolean {
  const prefix = words.slice(Math.max(0, occurrence.start - 9), occurrence.start).join(' ')
  const suffix = words.slice(occurrence.end, occurrence.end + 5).join(' ')
  const immediatePrefix = words.slice(Math.max(0, occurrence.start - 5), occurrence.start).join(' ')

  if (PROTEIN_WORDS.has(occurrence.alias) && NON_PRIMARY_PROTEIN_FORMS.has(words[occurrence.end])) return true
  if (occurrence.alias === 'chile' && /^(?:oil|powder|sauce|seasoning)\b/.test(suffix)) return true
  if (
    occurrence.alias === 'water' &&
    /(?:^| )(?:additional|extra|more)$/.test(immediatePrefix) &&
    !/\b(?:additional|extra) water\b/.test(occurrence.ingredient.identity)
  ) return true
  if (/(?:^| )(?:without|remove|discard)(?: the)?$/.test(immediatePrefix)) return true
  if (/(?:^| )except(?: the)?(?: [a-z]+ and)?$/.test(prefix)) return true
  if (/(?:^| )(?:do not|dont|never)(?: add| use| include| mix| stir in| pour in)?(?: the)?$/.test(immediatePrefix)) return true
  if (/(?:^| )(?:reserve|save|hold|set aside)(?: the)?$/.test(immediatePrefix) && /^(?:for|until) later\b/.test(suffix)) return true
  if (/(?:^| )some(?: of the)?$/.test(immediatePrefix) && /^may\b/.test(suffix)) return true
  if (/(?:^| )another(?: \d+){1,3}(?: \w+)?(?: of)?$/.test(immediatePrefix)) return true
  return false
}

function instructionGroups(words: string[], identities: IngredientIdentity[]): string[] {
  const groups = [...new Set(identities.map(item => item.group).filter((group): group is string => Boolean(group)))]
  const normalizedInstruction = words.join(' ')
  return groups.filter(group => {
    const phrase = group.split(' ').map(escapeRegExp).join(' ')
    const directMultiwordGroup = group.split(' ').length > 1 ? `|${phrase}` : ''
    return new RegExp(`\\b(?:(?:for|make|prepare) (?:the )?${phrase}|all (?:of )?(?:the )?${phrase} ingredient|${phrase} ingredient${directMultiwordGroup})\\b`).test(normalizedInstruction)
  })
}

export function isNonActionableCookingInstruction(instruction: string): boolean {
  const text = instruction.trim()
  if (!text) return false
  if (
    EXACT_URL.test(text) ||
    NON_ACTIONABLE_METADATA.test(text) ||
    PAYWALL_PLACEHOLDER.test(text) ||
    REVIEW_OR_COMMENT.test(text) ||
    REVIEW_AUTHOR_LINE.test(text) ||
    SUPPLEMENTAL_REFERENCE.test(text) ||
    SHORT_SECTION_HEADING.test(text) ||
    /^You can use small chicken pieces, large chicken breasts\b/i.test(text)
  ) return true
  if (COMPONENT_HEADING.test(text) && !/\b(?:add|blend|combine|cook|heat|make|mix|prepare|stir|whisk)\b/i.test(text)) {
    return true
  }
  if (INSTRUCTION_HEADING.test(text) && !ACTIVE_USE_VERB.test(normalizedWords(text).join(' '))) return true
  return false
}

function dedupeBestOccurrences(occurrences: PhraseOccurrence[]): PhraseOccurrence[] {
  const bestByIngredient = new Map<number, PhraseOccurrence>()
  for (const occurrence of occurrences) {
    const current = bestByIngredient.get(occurrence.ingredient.ingredientIndex)
    const length = occurrence.end - occurrence.start
    const currentLength = current ? current.end - current.start : -1
    if (!current || length > currentLength || (length === currentLength && occurrence.start < current.start)) {
      bestByIngredient.set(occurrence.ingredient.ingredientIndex, occurrence)
    }
  }
  return [...bestByIngredient.values()]
}

function ambiguousIngredientIndexes(occurrences: PhraseOccurrence[]): Set<number> {
  const byEvidence = new Map<string, PhraseOccurrence[]>()
  for (const occurrence of occurrences) {
    const key = `${occurrence.start}:${occurrence.end}:${occurrence.alias}`
    const current = byEvidence.get(key) || []
    current.push(occurrence)
    byEvidence.set(key, current)
  }

  const ambiguous = new Set<number>()
  for (const matches of byEvidence.values()) {
    if (matches.length < 2) continue
    for (const match of matches) ambiguous.add(match.ingredient.ingredientIndex)
  }
  return ambiguous
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function quantityTextForAlias(instruction: string, alias: string): string | undefined {
  const phrase = alias.split(' ').map(escapeRegExp).join('[\\s-]+')
  const fraction = '[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]'
  const number = `(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?|${fraction})`
  const unit = '(?:cups?|tablespoons?|tbsp|teaspoons?|tsp|ounces?|oz|pounds?|lb|grams?|g|milliliters?|ml)'
  const match = instruction.match(new RegExp(`(?:^|\\s)(${number}(?:\\s*${unit})?)\\s+(?:of\\s+)?(?:the\\s+)?${phrase}(?:e?s)?\\b`, 'i'))
  return match?.[1]?.replace(/\s+/g, ' ').trim()
}

interface InstructionClause {
  text: string
  words: string[]
  start: number
  end: number
  contextual: boolean
  negative: boolean
  groupCues: string[]
}

function leadingInstructionGroup(instruction: string, identities: IngredientIdentity[]): string | null {
  const colonIndex = instruction.indexOf(':')
  if (colonIndex < 0 || colonIndex > 80) return null
  const label = instruction.slice(0, colonIndex)
    .replace(/^(?:start|finish|prepare|fry|mix)\s+(?:the\s+)?/i, '')
  const normalized = normalizeGroup(label)
  const groups = [...new Set(identities.map(identity => identity.group).filter((group): group is string => Boolean(group)))]
  return groups.find(group => group === normalized) || null
}

function instructionClauses(instruction: string, identities: IngredientIdentity[]): InstructionClause[] {
  const leadingGroup = leadingInstructionGroup(instruction, identities)
  const parts = instruction.split(
    /[.;:]|,\s*(?=(?:then|after|as soon as|before|if|once|until|when|while|add|arrange|combine|heat|melt|mix|place|pour|return|season|serve|stir|toss|transfer|whisk)\b)/gi,
  )
  const clauses: InstructionClause[] = []
  let wordOffset = 0
  let carriedGroup: string | null = leadingGroup
  for (const part of parts) {
    const words = normalizedWords(part)
    if (words.length === 0) continue
    const normalized = words.join(' ')
    const explicitGroups = instructionGroups(words, identities)
    const groupCues = [...new Set([
      ...(carriedGroup ? [carriedGroup] : []),
      ...explicitGroups,
    ])]
    clauses.push({
      text: part.trim(),
      words,
      start: wordOffset,
      end: wordOffset + words.length,
      contextual: CONTEXTUAL_CLAUSE_START.test(normalized),
      negative: NEGATIVE_CLAUSE_START.test(normalized),
      groupCues,
    })
    if (explicitGroups.length === 1) carriedGroup = explicitGroups[0]
    else if (ACTIVE_USE_VERB.test(normalized) && !leadingGroup) carriedGroup = null
    wordOffset += words.length
  }
  return clauses
}

function clauseForOccurrence(
  clauses: InstructionClause[],
  occurrence: PhraseOccurrence,
): { clause: InstructionClause; clauseIndex: number } | null {
  const clauseIndex = clauses.findIndex(clause => occurrence.start >= clause.start && occurrence.end <= clause.end)
  return clauseIndex < 0 ? null : { clause: clauses[clauseIndex], clauseIndex }
}

function quantityAgreesWithRow(
  quantityText: string,
  alias: string,
  identity: IngredientIdentity,
  exact: boolean,
): boolean {
  if (!identity.quantity) return true
  const mentioned = parseIngredient(`${quantityText} ${alias}`)
  if (!mentioned.quantity) return false
  const rowQuantity = parseQuantityNumber(identity.quantity)
  const mentionedQuantity = parseQuantityNumber(mentioned.quantity)
  const rowUnit = unitCanonical(identity.unit)
  const mentionedUnit = unitCanonical(mentioned.unit)

  if (rowQuantity !== null && mentionedQuantity !== null) {
    if (rowUnit && mentionedUnit) {
      const converted = convertQuantity(mentionedQuantity, mentioned.unit, identity.unit)
      return converted !== null && (exact
        ? Math.abs(converted - rowQuantity) < 1e-9
        : converted <= rowQuantity + 1e-9)
    }
    if (rowUnit !== mentionedUnit) return false
    return exact
      ? Math.abs(mentionedQuantity - rowQuantity) < 1e-9
      : mentionedQuantity <= rowQuantity + 1e-9
  }

  return normalizeNoun(identity.quantity) === normalizeNoun(mentioned.quantity) && rowUnit === mentionedUnit
}

function occurrenceHasActiveUse(
  occurrence: PhraseOccurrence,
  clause: InstructionClause,
): boolean {
  if (occurrence.ingredient.sourceSectionLabel || clause.contextual || clause.negative) return false
  const relativeStart = occurrence.start - clause.start
  const relativeEnd = occurrence.end - clause.start
  const prefixWords = clause.words.slice(0, relativeStart)
  const suffixWords = clause.words.slice(relativeEnd)
  const prefix = prefixWords.join(' ')
  const immediatePrefix = prefixWords.slice(-6).join(' ')
  const suffix = suffixWords.slice(0, 5).join(' ')
  const aliasTail = occurrence.alias.split(' ').at(-1)

  if (/(?:^| )(?:for|from|alongside|beside)(?: the)?$/.test(immediatePrefix)) return false
  if (/(?:^| )to hold(?: the)?$/.test(immediatePrefix)) return false
  if (
    /(?:^| )over(?: the)?$/.test(immediatePrefix) &&
    PROTEIN_WORDS.has(occurrence.alias) &&
    /\bserve\b/.test(prefix)
  ) return false
  if (/(?:^| )with(?: the)?$/.test(immediatePrefix) && /^\w+(?: \w+)? on (?:the )?side\b/.test(`${occurrence.alias} ${suffix}`)) return false
  if (/^(?:plate|bowl|mixture|flavor)\b/.test(suffix)) return false
  if (/^(?:dripping|fat|grease|pan)\b/.test(suffix)) return false
  const embeddedInComponent = Boolean(suffixWords[0] && PREPARED_CARRIER_WORDS.has(suffixWords[0]))
  if (embeddedInComponent && !PREPARED_CARRIER_WORDS.has(aliasTail || '')) return false
  if (
    occurrence.alias === 'water' &&
    /(?:^| )(?:boiling|cold|fresh|hot|warm)$/.test(immediatePrefix) &&
    !/\b(?:boiling|cold|fresh|hot|warm) water\b/.test(occurrence.ingredient.identity)
  ) return false
  if (/(?:^| )no need to(?: \w+){0,4}$/.test(immediatePrefix)) return false
  if (
    ROW_SENSITIVE_FORMS.has(aliasTail || '') &&
    /(?:^| )(?:little|pinch of|dash of|(?:a )?few(?: \w+)?(?: of)?|(?:an )?extra splash of)(?: the)?$/.test(immediatePrefix) &&
    Boolean(occurrence.ingredient.quantity)
  ) return false
  if (!ACTIVE_USE_VERB.test(prefix)) return false
  if (/(?:^| )(?:until|while|when|before|after)(?: \w+){0,8}$/.test(prefix)) return false
  return true
}

function applyClauseGroupEvidence(
  occurrences: PhraseOccurrence[],
  clauses: InstructionClause[],
  identities: IngredientIdentity[],
): PhraseOccurrence[] {
  const kept: PhraseOccurrence[] = []
  for (let clauseIndex = 0; clauseIndex < clauses.length; clauseIndex += 1) {
    const clauseOccurrences = occurrences.filter(occurrence => occurrence.clauseIndex === clauseIndex)
    if (clauseOccurrences.length === 0) continue
    const byEvidence = new Map<string, PhraseOccurrence[]>()
    for (const occurrence of clauseOccurrences) {
      const key = `${occurrence.start}:${occurrence.end}:${occurrence.alias}`
      const matches = byEvidence.get(key) || []
      matches.push(occurrence)
      byEvidence.set(key, matches)
    }

    const cueGroups = new Set(clauses[clauseIndex].groupCues)
    if (cueGroups.size === 0) {
      const contextualGroups = new Set<string>()
      for (const identity of identities) {
        if (!identity.group) continue
        const evidenceAliases = new Set(identity.aliases)
        const tail = identity.identity.split(' ').at(-1)
        if (tail && !ROW_SENSITIVE_FORMS.has(tail)) evidenceAliases.add(tail)
        if ([...evidenceAliases].some(alias =>
          !ROW_SENSITIVE_FORMS.has(alias) && findPhrasePositions(clauses[clauseIndex].words, alias).length > 0
        )) contextualGroups.add(identity.group)
      }
      if (contextualGroups.size === 1) cueGroups.add([...contextualGroups][0])
    }
    if (cueGroups.size === 0) {
      for (const matches of byEvidence.values()) {
        if (matches.length !== 1) continue
        const match = matches[0]
        const aliasTail = match.alias.split(' ').at(-1) || ''
        if (match.ingredient.group && !ROW_SENSITIVE_FORMS.has(aliasTail)) cueGroups.add(match.ingredient.group)
      }
    }
    const clauseGroup = cueGroups.size === 1 ? [...cueGroups][0] : null

    for (const matches of byEvidence.values()) {
      if (!clauseGroup) {
        kept.push(...matches)
        continue
      }
      const matchingGroup = matches.filter(match => match.ingredient.group === clauseGroup)
      if (matches.length > 1 && matchingGroup.length > 0) {
        kept.push(...matchingGroup)
        continue
      }
      for (const match of matches) {
        if (
          ROW_SENSITIVE_FORMS.has(match.alias.split(' ').at(-1) || '') &&
          match.ingredient.group &&
          match.ingredient.group !== clauseGroup
        ) continue
        kept.push(match)
      }
    }
  }
  return kept
}

function collectActiveOccurrences(
  instruction: string,
  identities: IngredientIdentity[],
): { occurrences: PhraseOccurrence[]; quantityMismatch: boolean } {
  const words = normalizedWords(instruction)
  const clauses = instructionClauses(instruction, identities)
  let quantityMismatch = false
  const rawOccurrences = collectOccurrences(words, identities)
  const active = rawOccurrences.flatMap(occurrence => {
    const scoped = clauseForOccurrence(clauses, occurrence)
    if (!scoped || !occurrenceHasActiveUse(occurrence, scoped.clause)) return []
    const quantityText = quantityTextForAlias(scoped.clause.text, occurrence.alias)
    const duplicateEvidence = rawOccurrences.filter(other =>
      other.start === occurrence.start && other.end === occurrence.end && other.alias === occurrence.alias).length > 1
    if (
      quantityText &&
      !quantityAgreesWithRow(quantityText, occurrence.alias, occurrence.ingredient, duplicateEvidence)
    ) {
      quantityMismatch = true
      return []
    }
    return [{ ...occurrence, clauseIndex: scoped.clauseIndex }]
  })
  return { occurrences: applyClauseGroupEvidence(active, clauses, identities), quantityMismatch }
}

function usageForOccurrence(
  instruction: string,
  words: string[],
  occurrence: PhraseOccurrence,
): CookingIngredientUsage | undefined {
  const prefix = words.slice(Math.max(0, occurrence.start - 6), occurrence.start).join(' ')
  if (/(?:^| )(?:remaining|rest of(?: the)?)$/.test(prefix)) return { kind: 'remaining' }

  const quantityText = quantityTextForAlias(instruction, occurrence.alias)
  if (quantityText) return { kind: 'partial', quantityText }
  const partialWord = prefix.match(/(?:^| )(half|quarter|some)(?: of)?(?: the)?$/)?.[1]
  if (partialWord) return { kind: 'partial', quantityText: partialWord }
  return undefined
}

interface CookingInstructionScope {
  instruction: string
  words: string[]
  identities: IngredientIdentity[]
  explicitGroups: string[]
  boundedCollectiveIndexes: Set<number>
  unboundedCollective: boolean
}

function cookingInstructionScope(ingredients: string[], instruction: string): CookingInstructionScope {
  const words = normalizedWords(instruction)
  const identities = buildIngredientIdentities(ingredients)
  const explicitGroups = instructionGroups(words, identities)
  const hasCollective = COLLECTIVE_REFERENCE.test(words.join(' '))
  const boundedCollectiveIndexes = new Set<number>()
  if (hasCollective && explicitGroups.length === 1) {
    identities
      .filter(identity => identity.group === explicitGroups[0])
      .forEach(identity => boundedCollectiveIndexes.add(identity.ingredientIndex))
  }
  return {
    instruction,
    words,
    identities,
    explicitGroups,
    boundedCollectiveIndexes,
    unboundedCollective: hasCollective && explicitGroups.length !== 1,
  }
}

function ingredientReferenceAliases(identity: IngredientIdentity): string[] {
  const aliases = new Set(identity.aliases)
  const tail = identity.identity.split(' ').at(-1)
  if (tail && AI_GENERIC_REFERENCE_FORMS.has(tail)) aliases.add(tail)
  return [...aliases].sort(compareAliases)
}

function activeGroundedIngredientIndexes(
  scope: CookingInstructionScope,
): { grounded: Set<number>; ambiguous: Set<number> } {
  let occurrences = collectActiveOccurrences(scope.instruction, scope.identities).occurrences
  if (scope.explicitGroups.length === 1) {
    occurrences = occurrences.filter(occurrence => occurrence.ingredient.group === scope.explicitGroups[0])
  }

  // AI may resolve a unique generic reference such as "the oil", but never a
  // food-defining modifier such as chicken from chicken broth.
  const scopedIdentities = scope.explicitGroups.length === 1
    ? scope.identities.filter(identity => identity.group === scope.explicitGroups[0])
    : scope.identities
  for (const identity of scopedIdentities) {
    if (identity.sourceSectionLabel) continue
    const tail = identity.identity.split(' ').at(-1)
    if (!tail || !AI_GENERIC_REFERENCE_FORMS.has(tail)) continue
    const sameTail = scopedIdentities.filter(item => item.identity.split(' ').at(-1) === tail)
    if (sameTail.length !== 1) continue
    for (const position of findPhrasePositions(scope.words, tail)) {
      const occurrence = { ingredient: identity, alias: tail, ...position }
      const insideFullIdentity = ingredientReferenceAliases(identity)
        .filter(alias => alias !== tail)
        .flatMap(alias => findPhrasePositions(scope.words, alias))
        .some(full => full.start <= position.start && full.end >= position.end)
      const clauses = instructionClauses(scope.instruction, scope.identities)
      const scoped = clauseForOccurrence(clauses, occurrence)
      if (
        !insideFullIdentity &&
        !isInactiveOccurrence(scope.words, occurrence) &&
        scoped &&
        occurrenceHasActiveUse(occurrence, scoped.clause)
      ) occurrences.push({ ...occurrence, clauseIndex: scoped.clauseIndex })
    }
  }

  occurrences = dedupeBestOccurrences(occurrences)
  const ambiguous = ambiguousIngredientIndexes(occurrences)
  const grounded = new Set(occurrences
    .filter(occurrence => !ambiguous.has(occurrence.ingredient.ingredientIndex))
    .map(occurrence => occurrence.ingredient.ingredientIndex))
  scope.boundedCollectiveIndexes.forEach(index => grounded.add(index))
  return { grounded, ambiguous }
}

function usageLocallyGrounded(
  usage: CookingIngredientUsage,
  instruction: string,
  identity: IngredientIdentity,
  boundedCollective: boolean,
): CookingIngredientUsage | undefined {
  const words = normalizedWords(instruction)
  const aliases = ingredientReferenceAliases(identity)
  const occurrences = aliases.flatMap(alias =>
    findPhrasePositions(words, alias).map(position => ({ alias, ...position })))
  const quantityText = usage.quantityText?.trim().replace(/\s+/g, ' ')

  if (usage.kind === 'all') {
    const locallyAll = occurrences.some(occurrence => {
      const prefix = words.slice(Math.max(0, occurrence.start - 4), occurrence.start).join(' ')
      return /(?:^| )all(?: of)?(?: the)?$/.test(prefix)
    })
    if (!boundedCollective && !locallyAll) return undefined
  }

  if (usage.kind === 'remaining') {
    const locallyRemaining = occurrences.some(occurrence => {
      const prefix = words.slice(Math.max(0, occurrence.start - 5), occurrence.start).join(' ')
      return /(?:^| )(?:remaining|rest of(?: the)?)$/.test(prefix)
    })
    if (!locallyRemaining) return undefined
  }

  if (usage.kind === 'partial') {
    if (!quantityText) return undefined
    const quantityWords = normalizedWords(quantityText)
    const quantityPositions = findPhrasePositions(words, quantityWords.join(' '))
    const localQuantity = occurrences.some(occurrence => quantityPositions.some(quantity =>
      quantity.end <= occurrence.start && occurrence.start - quantity.end <= 3))
    if (!localQuantity) return undefined
  }

  return quantityText ? { kind: usage.kind, quantityText } : { kind: usage.kind }
}

export function validateAiCookingIngredientReference(
  ingredients: string[],
  instruction: string,
  ingredientIndex: number,
  usage?: CookingIngredientUsage,
): { accepted: boolean; usage?: CookingIngredientUsage } {
  if (isNonActionableCookingInstruction(instruction)) return { accepted: false }
  const scope = cookingInstructionScope(ingredients, instruction)
  const identity = scope.identities.find(item => item.ingredientIndex === ingredientIndex)
  if (!identity) return { accepted: false }
  const { grounded, ambiguous } = activeGroundedIngredientIndexes(scope)
  if (ambiguous.has(ingredientIndex) || !grounded.has(ingredientIndex)) return { accepted: false }
  if (scope.unboundedCollective && !collectOccurrences(scope.words, [identity]).length) {
    return { accepted: false }
  }
  if (!usage) return { accepted: true }
  const groundedUsage = usageLocallyGrounded(
    usage,
    instruction,
    identity,
    scope.boundedCollectiveIndexes.has(ingredientIndex),
  )
  return groundedUsage ? { accepted: true, usage: groundedUsage } : { accepted: true }
}

function canonicalComponentLabel(value: string): string {
  return normalizeNoun(value
    .trim()
    .replace(/^\*+|\*+$/g, '')
    .replace(/:$/, '')
    .replace(/^for\s+(?:the\s+)?/i, '')
    .replace(/^the\s+/i, ''))
}

function establishedPreparedComponents(
  ingredients: string[],
  instructions: string[],
  instructionIndex: number,
): string[] {
  const labels = new Set<string>()
  for (const ingredient of ingredients) {
    if (!isIngredientSubheader(ingredient)) continue
    const label = canonicalComponentLabel(ingredient)
    const tail = label.split(' ').at(-1)
    if (tail && COMPONENT_WORDS.has(tail)) labels.add(label)
  }

  const creationVerb = /\b(?:blend|combine|cook|form|make|mix|prepare|stir|whisk)\b/i
  for (const instruction of instructions.slice(0, instructionIndex)) {
    if (isNonActionableCookingInstruction(instruction) || !creationVerb.test(instruction)) continue
    const normalized = normalizedWords(instruction).join(' ')
    const componentAlternation = [...COMPONENT_WORDS].join('|')
    const patterns = [
      new RegExp(`\\b(?:make|prepare)(?: the)? ((?:[a-z0-9]+ ){0,2}(?:${componentAlternation}))\\b`, 'g'),
      new RegExp(`\\b(?:into|to form|to make)(?: a| the)? ((?:[a-z0-9]+ ){0,2}(?:${componentAlternation}))\\b`, 'g'),
      new RegExp(`\\b(?:reserve|save)(?: [a-z0-9]+){0,5} (?:of )?(?:the )?((?:[a-z0-9]+ )?(?:${componentAlternation}))\\b`, 'g'),
    ]
    for (const pattern of patterns) {
      for (const match of normalized.matchAll(pattern)) {
        const candidate = canonicalComponentLabel(match[1])
        const tail = candidate.split(' ').at(-1)
        if (tail && COMPONENT_WORDS.has(tail) && candidate.split(' ').length <= 3) labels.add(candidate)
      }
    }
  }
  return [...labels]
}

export function groundCookingPreparedComponent(
  label: string,
  instructionIndex: number,
  ingredients: string[],
  instructions: string[],
): string | null {
  const normalized = canonicalComponentLabel(label)
  const tail = normalized.split(' ').at(-1)
  if (!normalized || !tail || !COMPONENT_WORDS.has(tail)) return null
  const established = establishedPreparedComponents(ingredients, instructions, instructionIndex)
  const exact = established.find(component => component === normalized)
  if (exact) return exact
  if (normalized === tail) {
    const matchingTail = established.filter(component => component.split(' ').at(-1) === tail)
    if (matchingTail.length === 1) return matchingTail[0]
  }
  return null
}

function ingredientReference(ingredientIndex: number, usage?: CookingIngredientUsage): CookingStepIngredientReference {
  return usage
    ? { ingredientIndex, confidence: 'high', provenance: 'deterministic', usage }
    : { ingredientIndex, confidence: 'high', provenance: 'deterministic' }
}

function mapInstruction(
  instruction: string,
  instructionIndex: number,
  identities: IngredientIdentity[],
): CookingStepMapping {
  const base = { instructionIndex }
  if (isNonActionableCookingInstruction(instruction)) {
    return { ...base, ingredients: [], unresolvedReason: 'non-actionable' }
  }
  const words = normalizedWords(instruction)
  const normalizedInstruction = words.join(' ')
  const explicitGroups = instructionGroups(words, identities)
  const hasCollectiveReference = COLLECTIVE_REFERENCE.test(normalizedInstruction)

  if (hasCollectiveReference) {
    if (explicitGroups.length === 1) {
      const groupIngredients = identities.filter(item => item.group === explicitGroups[0])
      const kind = /\bremaining ingredient\b/.test(normalizedInstruction) ? 'remaining' : 'all'
      return {
        ...base,
        ingredients: groupIngredients.map(item => ingredientReference(item.ingredientIndex, { kind })),
      }
    }
    return { ...base, ingredients: [], unresolvedReason: 'implicit-reference' }
  }

  const activeResult = collectActiveOccurrences(instruction, identities)
  let occurrences = activeResult.occurrences
  const colonIndex = instruction.indexOf(':')
  const leadingGroup = leadingInstructionGroup(instruction, identities)
  if (!leadingGroup && colonIndex > 0 && colonIndex <= 80 && explicitGroups.length === 0) {
    const leadingPurpose = normalizeGroup(instruction.slice(0, colonIndex))
    if (leadingPurpose && !/^(?:finish|note|start|step)$/.test(leadingPurpose)) {
      occurrences = occurrences.filter(occurrence => occurrence.ingredient.group === null)
    }
  }
  occurrences = dedupeBestOccurrences(occurrences)

  const ambiguousIndexes = ambiguousIngredientIndexes(occurrences)
  const safeOccurrences = occurrences.filter(occurrence => !ambiguousIndexes.has(occurrence.ingredient.ingredientIndex))
  const preparedComponent = PREPARED_COMPONENT_REFERENCE.test(normalizedInstruction)
  const preparedOnlyIndexes = new Set(safeOccurrences
    .filter(occurrence => {
      const after = words.slice(occurrence.end, occurrence.end + 3)
      const identityTail = occurrence.ingredient.identity.split(' ').at(-1)
      return COMPONENT_WORDS.has(occurrence.alias) ||
        after[0] === 'mixture' ||
        (identityTail === 'chile' && after.includes('sauce'))
    })
    .map(occurrence => occurrence.ingredient.ingredientIndex))
  const usableOccurrences = safeOccurrences.filter(occurrence => !preparedOnlyIndexes.has(occurrence.ingredient.ingredientIndex))

  const ingredients = usableOccurrences
    .sort((a, b) => a.ingredient.ingredientIndex - b.ingredient.ingredientIndex)
    .map(occurrence => ingredientReference(
      occurrence.ingredient.ingredientIndex,
      usageForOccurrence(instruction, words, occurrence),
    ))

  if (ambiguousIndexes.size > 0 || activeResult.quantityMismatch) {
    return { ...base, ingredients, unresolvedReason: 'ambiguous' }
  }
  const groundedRawComponent = safeOccurrences.some(occurrence =>
    COMPONENT_WORDS.has(occurrence.ingredient.identity.split(' ').at(-1) || ''))
  if (preparedOnlyIndexes.size > 0 || (preparedComponent && !groundedRawComponent)) {
    return { ...base, ingredients, unresolvedReason: 'prepared-component' }
  }
  if (ingredients.length > 0) return { ...base, ingredients }
  if (CONFIDENT_NO_USE.test(normalizedInstruction)) {
    return { ...base, ingredients: [], unresolvedReason: 'no-ingredient-use' }
  }
  return { ...base, ingredients: [] }
}

function hasExplicitRowReuse(
  instruction: string,
  identity: IngredientIdentity,
  reference: CookingStepIngredientReference,
): boolean {
  if (reference.usage?.kind === 'remaining') return true
  const words = normalizedWords(instruction)
  const explicitReuse = ingredientReferenceAliases(identity).some(alias =>
    findPhrasePositions(words, alias).some(position => {
      const prefix = words.slice(Math.max(0, position.start - 6), position.start).join(' ')
      return /(?:^| )(?:remaining|reserved|rest of(?: the)?)$/.test(prefix)
    }))
  if (explicitReuse) return true
  return /\bdivided\b/i.test(identity.raw) && reference.usage?.kind === 'partial'
}

function isGenuineContinuingUse(
  instruction: string,
  identity: IngredientIdentity,
): boolean {
  const words = normalizedWords(instruction)
  return ingredientReferenceAliases(identity).some(alias =>
    findPhrasePositions(words, alias).some(position => {
      const prefix = words.slice(Math.max(0, position.start - 8), position.start).join(' ')
      return CONTINUING_USE_VERB.test(prefix)
    }))
}

function applyRowLifecycle(
  mapping: CookingStepMapping,
  instruction: string,
  identities: IngredientIdentity[],
  usedIndexes: Set<number>,
): CookingStepMapping {
  const available = mapping.ingredients.filter(reference => {
    if (!usedIndexes.has(reference.ingredientIndex)) return true
    const identity = identities.find(item => item.ingredientIndex === reference.ingredientIndex)
    if (!identity) return false
    return hasExplicitRowReuse(instruction, identity, reference) ||
      isGenuineContinuingUse(instruction, identity)
  })
  available.forEach(reference => usedIndexes.add(reference.ingredientIndex))
  return available.length === mapping.ingredients.length
    ? mapping
    : { ...mapping, ingredients: available }
}

/** Stable, lossless source serialization. Array order, exact text, and headers matter. */
export function canonicalizeCookingMappingSource(ingredients: string[], instructions: string[]): string {
  return JSON.stringify({ ingredients, instructions })
}

/** SHA-256 of the canonical source, represented as lowercase hexadecimal. */
export async function computeCookingMappingSourceHash(
  ingredients: string[],
  instructions: string[],
): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto API is required to hash cooking mapping sources')
  const bytes = new TextEncoder().encode(canonicalizeCookingMappingSource(ingredients, instructions))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Build a conservative map without persistence, network calls, or nondeterminism. */
export function buildDeterministicCookingStepMap(
  ingredients: string[],
  instructions: string[],
): Omit<CookingStepIngredientMap, 'sourceHash'> {
  const identities = buildIngredientIdentities(ingredients)
  const usedIndexes = new Set<number>()
  return {
    schemaVersion: 1,
    parserVersion: COOKING_MAPPING_PARSER_VERSION,
    engineVersion: COOKING_MAPPING_ENGINE_VERSION,
    steps: instructions.map((instruction, instructionIndex) =>
      applyRowLifecycle(
        mapInstruction(instruction, instructionIndex, identities),
        instruction,
        identities,
        usedIndexes,
      )),
  }
}

/** Build the persisted deterministic shape and bind it to this exact parsed source. */
export async function buildHashedDeterministicCookingStepMap(
  ingredients: string[],
  instructions: string[],
): Promise<CookingStepIngredientMap> {
  return {
    ...buildDeterministicCookingStepMap(ingredients, instructions),
    sourceHash: await computeCookingMappingSourceHash(ingredients, instructions),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate a persisted map against the exact deterministic source-bound map for
 * the content being displayed. This is shared by publish-time response handling
 * and browser runtime consumption so the two paths cannot drift.
 */
export function validateCookingStepIngredientMap(
  value: unknown,
  ingredients: string[],
  instructions: string[],
  deterministicMap: CookingStepIngredientMap,
): CookingStepMapValidationResult {
  if (!isRecord(value)) return { valid: false, reason: 'invalid-structure' }
  if (value.schemaVersion !== 1) return { valid: false, reason: 'unsupported-schema' }
  if (value.parserVersion !== COOKING_MAPPING_PARSER_VERSION) {
    return { valid: false, reason: 'unsupported-parser' }
  }
  if (
    value.engineVersion !== COOKING_MAPPING_ENGINE_VERSION &&
    value.engineVersion !== COOKING_MAPPING_HYBRID_ENGINE_VERSION
  ) return { valid: false, reason: 'unsupported-engine' }
  if (typeof value.sourceHash !== 'string' || !/^[0-9a-f]{64}$/.test(value.sourceHash)) {
    return { valid: false, reason: 'invalid-structure' }
  }
  if (value.sourceHash !== deterministicMap.sourceHash) {
    return { valid: false, reason: 'source-hash-mismatch' }
  }
  if (!Array.isArray(value.steps) || value.steps.length !== instructions.length) {
    return { valid: false, reason: 'invalid-structure' }
  }

  let hasAiResolution = false
  const validSteps = value.steps.every((step, instructionIndex) => {
    if (
      !isRecord(step) ||
      step.instructionIndex !== instructionIndex ||
      !Array.isArray(step.ingredients) ||
      step.ingredients.length > ingredients.length
    ) return false

    const deterministicStep = deterministicMap.steps[instructionIndex]
    if (!deterministicStep) return false
    const aiEligible = isAiEligibleCookingMappingReason(deterministicStep.unresolvedReason)
    const deterministicReferences = new Map(
      deterministicStep.ingredients.map(reference => [reference.ingredientIndex, reference]),
    )
    if (
      step.unresolvedReason !== undefined &&
      (typeof step.unresolvedReason !== 'string' || !COOKING_MAPPING_UNRESOLVED_REASONS.has(step.unresolvedReason))
    ) return false

    const seenIndexes = new Set<number>()
    const validIngredients = step.ingredients.every(reference => {
      if (!isRecord(reference)) return false
      const index = reference.ingredientIndex
      if (
        typeof index !== 'number' ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= ingredients.length ||
        isIngredientSubheader(ingredients[index]) ||
        seenIndexes.has(index) ||
        reference.confidence !== 'high' ||
        (reference.provenance !== 'deterministic' && reference.provenance !== 'ai')
      ) return false
      seenIndexes.add(index)

      const lockedReference = deterministicReferences.get(index)
      if (reference.provenance === 'deterministic') {
        if (!lockedReference || JSON.stringify(reference.usage) !== JSON.stringify(lockedReference.usage)) return false
      } else {
        if (!aiEligible || lockedReference) return false
        hasAiResolution = true
      }

      let validatedUsage: CookingIngredientUsage | undefined
      if (reference.usage !== undefined) {
        if (!isRecord(reference.usage)) return false
        if (!['all', 'partial', 'remaining'].includes(reference.usage.kind as string)) return false
        if (
          reference.usage.quantityText !== undefined &&
          (
            typeof reference.usage.quantityText !== 'string' ||
            reference.usage.quantityText.trim().length === 0 ||
            reference.usage.quantityText.length > 80
          )
        ) return false
        validatedUsage = reference.usage as unknown as CookingIngredientUsage
      }

      if (reference.provenance === 'ai') {
        const grounding = validateAiCookingIngredientReference(
          ingredients,
          instructions[instructionIndex],
          index,
          validatedUsage,
        )
        if (!grounding.accepted || JSON.stringify(grounding.usage) !== JSON.stringify(validatedUsage)) return false
      }
      return true
    })
    if (!validIngredients) return false
    if ([...deterministicReferences.keys()].some(index => !seenIndexes.has(index))) return false

    if (step.preparedComponents !== undefined) {
      if (!aiEligible || !Array.isArray(step.preparedComponents) || step.preparedComponents.length > 30) return false
      const labels = new Set<string>()
      const validComponents = step.preparedComponents.every(component => {
        if (
          !isRecord(component) ||
          typeof component.label !== 'string' ||
          component.label.trim().length === 0 ||
          component.label.length > 80 ||
          component.confidence !== 'high' ||
          component.provenance !== 'ai'
        ) return false
        const normalizedLabel = component.label.trim().replace(/\s+/g, ' ').toLowerCase()
        if (labels.has(normalizedLabel)) return false
        const groundedLabel = groundCookingPreparedComponent(
          component.label,
          instructionIndex,
          ingredients,
          instructions,
        )
        if (!groundedLabel || canonicalComponentLabel(component.label) !== groundedLabel) return false
        labels.add(normalizedLabel)
        hasAiResolution = true
        return true
      })
      if (!validComponents) return false
    }

    const stepHasAiResolution = step.ingredients.some(reference =>
      isRecord(reference) && reference.provenance === 'ai') ||
      (Array.isArray(step.preparedComponents) && step.preparedComponents.length > 0)
    return stepHasAiResolution || step.unresolvedReason === deterministicStep.unresolvedReason
  })

  if (!validSteps) return { valid: false, reason: 'invalid-structure' }
  if (value.engineVersion === COOKING_MAPPING_ENGINE_VERSION && hasAiResolution) {
    return { valid: false, reason: 'invalid-structure' }
  }
  if (value.engineVersion === COOKING_MAPPING_HYBRID_ENGINE_VERSION && !hasAiResolution) {
    return { valid: false, reason: 'invalid-structure' }
  }
  return { valid: true }
}

/**
 * Resolve the safest map for browser rendering. The deterministic map is always
 * built first; persisted data is returned only after exact hash/version/shape
 * validation. This function performs no network, AI, persistence, or mutation.
 */
export async function resolveCookingStepIngredientMap(
  ingredients: string[],
  instructions: string[],
  persistedMap?: unknown,
): Promise<ResolvedCookingStepMap> {
  const deterministicMap = await buildHashedDeterministicCookingStepMap(ingredients, instructions)
  if (persistedMap === undefined || persistedMap === null) {
    return {
      mapping: deterministicMap,
      source: 'deterministic-fallback',
      fallbackReason: 'missing',
    }
  }

  const validation = validateCookingStepIngredientMap(
    persistedMap,
    ingredients,
    instructions,
    deterministicMap,
  )
  if (!validation.valid) {
    return {
      mapping: deterministicMap,
      source: 'deterministic-fallback',
      fallbackReason: validation.reason,
    }
  }
  return { mapping: persistedMap as CookingStepIngredientMap, source: 'persisted' }
}
