import { normalizeNoun, parseIngredient } from '@/lib/ingredientParser'
import { isIngredientSubheader } from '@/lib/recipeContent'
import type {
  CookingIngredientUsage,
  CookingStepIngredientMap,
  CookingStepIngredientReference,
  CookingStepMapping,
} from '@/types/recipe'

export const COOKING_MAPPING_PARSER_VERSION = 'recipe-content-v1'
export const COOKING_MAPPING_ENGINE_VERSION = 'deterministic-v1'
export const COOKING_MAPPING_HYBRID_ENGINE_VERSION = 'hybrid-v1'

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
  'bean', 'butter', 'cheese', 'chile', 'ketchup', 'mayonnaise', 'mustard',
  'yogurt',
])

const QUALIFIED_GENERIC_FORMS = new Set([
  'cheese', 'cream', 'herb', 'milk', 'oil', 'sauce', 'stock',
])

const COMPONENT_WORDS = new Set([
  'batter', 'dough', 'dressing', 'filling', 'glaze', 'marinade', 'mixture',
  'rub', 'sauce', 'seasoning', 'tadka', 'topping',
])

const COOKING_MAPPING_UNRESOLVED_REASONS = new Set([
  'ambiguous', 'implicit-reference', 'prepared-component', 'no-ingredient-use',
])

const COLLECTIVE_REFERENCE = /\b(?:all (?:of )?(?:the )?ingredient|remaining ingredient|dry ingredient|wet ingredient|everything)\b/
const CONFIDENT_NO_USE = /^(?:preheat\b|(?:bake|cook|roast) (?:for|until)\b|reduce (?:the )?heat\b|remove from (?:the )?heat\b|let (?:it|this|the mixture|the dish) (?:rest|cool|chill)\b|rest\b|cool completely\b|refrigerate\b|chill\b|set aside\b)/
const PREPARED_COMPONENT_REFERENCE = /\b(?:add|baste|brush|fold|pour|serve|spread|stir|toss)\b(?:\s+\w+){0,6}\s+(?:(?:in|over|with)\s+)?(?:(?:the|prepared)\s+)?(?:\w+\s+){0,2}(?:dressing|filling|glaze|marinade|mixture|sauce|tadka|topping)\b/

interface IngredientIdentity {
  ingredientIndex: number
  raw: string
  quantity: string
  unit: string
  identity: string
  aliases: string[]
  qualifiedAliases: string[]
  group: string | null
}

interface PhraseOccurrence {
  ingredient: IngredientIdentity
  alias: string
  start: number
  end: number
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
  return normalized ? normalized.split(' ').filter(Boolean) : []
}

function withoutPreparationWords(value: string): string {
  const words = normalizedWords(value).filter(word => !PREPARATION_WORDS.has(word))
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
  const alternatives = beforeComma
    .replace(/\band\s*\/\s*or\b/gi, ' or ')
    .replace(/\s+\/\s+/g, ' or ')
    .split(/\s+or\s+/i)
    .map(part => part.trim())
    .filter(Boolean)
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
    if (protein) aliases.add(protein)

    const tail = words[words.length - 1]
    if (words.length > 1 && DISTINCTIVE_CATEGORY_FORMS.has(tail)) {
      aliases.add(tail)
      const prefix = words.slice(0, -1).join(' ')
      if (prefix) aliases.add(prefix)
    }
    if (words.length > 1 && QUALIFIED_GENERIC_FORMS.has(tail)) {
      qualifiedAliases.add(tail)
    }
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
    .replace(/^the\s+/i, ''))
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
    result.push({
      ingredientIndex,
      raw,
      quantity: parsed.quantity,
      unit: parsed.unit,
      group,
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

  // A shorter alias inside a more specific food phrase is not independent
  // evidence. This prevents "chicken" from selecting chicken breast inside
  // the phrase "chicken broth", while preserving a separate earlier mention.
  return occurrences.filter(occurrence => !occurrences.some(other =>
    other !== occurrence &&
    other.start <= occurrence.start &&
    other.end >= occurrence.end &&
    other.end - other.start > occurrence.end - occurrence.start
  ))
}

function instructionGroups(words: string[], identities: IngredientIdentity[]): string[] {
  const groups = [...new Set(identities.map(item => item.group).filter((group): group is string => Boolean(group)))]
  const normalizedInstruction = words.join(' ')
  return groups.filter(group => {
    const phrase = group.split(' ').map(escapeRegExp).join(' ')
    return new RegExp(`\\b(?:for|make|prepare) (?:the )?${phrase}\\b`).test(normalizedInstruction)
  })
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

  let occurrences = collectOccurrences(words, identities)
  if (explicitGroups.length === 1) {
    occurrences = occurrences.filter(occurrence => occurrence.ingredient.group === explicitGroups[0])
  }
  occurrences = dedupeBestOccurrences(occurrences)

  const ambiguousIndexes = ambiguousIngredientIndexes(occurrences)
  const safeOccurrences = occurrences.filter(occurrence => !ambiguousIndexes.has(occurrence.ingredient.ingredientIndex))
  const preparedComponent = PREPARED_COMPONENT_REFERENCE.test(normalizedInstruction)
  const preparedOnlyIndexes = new Set(safeOccurrences
    .filter(occurrence => {
      const after = words[occurrence.end]
      return COMPONENT_WORDS.has(occurrence.alias) || after === 'mixture'
    })
    .map(occurrence => occurrence.ingredient.ingredientIndex))
  const usableOccurrences = safeOccurrences.filter(occurrence => !preparedOnlyIndexes.has(occurrence.ingredient.ingredientIndex))

  const ingredients = usableOccurrences
    .sort((a, b) => a.ingredient.ingredientIndex - b.ingredient.ingredientIndex)
    .map(occurrence => ingredientReference(
      occurrence.ingredient.ingredientIndex,
      usageForOccurrence(instruction, words, occurrence),
    ))

  if (ambiguousIndexes.size > 0) return { ...base, ingredients, unresolvedReason: 'ambiguous' }
  if (preparedComponent && (preparedOnlyIndexes.size > 0 || ingredients.length === 0)) {
    return { ...base, ingredients, unresolvedReason: 'prepared-component' }
  }
  if (ingredients.length > 0) return { ...base, ingredients }
  if (CONFIDENT_NO_USE.test(normalizedInstruction)) {
    return { ...base, ingredients: [], unresolvedReason: 'no-ingredient-use' }
  }
  return { ...base, ingredients: [] }
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
  return {
    schemaVersion: 1,
    parserVersion: COOKING_MAPPING_PARSER_VERSION,
    engineVersion: COOKING_MAPPING_ENGINE_VERSION,
    steps: instructions.map((instruction, instructionIndex) =>
      mapInstruction(instruction, instructionIndex, identities)),
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

      if (reference.usage === undefined) return true
      if (!isRecord(reference.usage)) return false
      if (!['all', 'partial', 'remaining'].includes(reference.usage.kind as string)) return false
      if (reference.usage.quantityText === undefined) return true
      if (
        typeof reference.usage.quantityText !== 'string' ||
        reference.usage.quantityText.trim().length === 0 ||
        reference.usage.quantityText.length > 80
      ) return false
      const instruction = instructions[instructionIndex].replace(/\s+/g, ' ').toLowerCase()
      return instruction.includes(reference.usage.quantityText.trim().replace(/\s+/g, ' ').toLowerCase())
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
