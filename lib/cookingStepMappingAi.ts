import 'server-only'

import { z } from 'zod'
import { generateAIObject } from '@/lib/ai'
import { COOKING_STEP_MAPPING_PROMPT_VERSION } from '@/lib/aiConfig'
import {
  COOKING_MAPPING_HYBRID_ENGINE_VERSION,
  isAiEligibleCookingMappingReason,
} from '@/lib/cookingStepMapping'
import { normalizeNoun, parseIngredient } from '@/lib/ingredientParser'
import { isIngredientSubheader } from '@/lib/recipeContent'
import type {
  CookingIngredientUsage,
  CookingPreparedComponentReference,
  CookingStepIngredientMap,
  CookingStepIngredientReference,
} from '@/types/recipe'

const AI_USAGE_SCHEMA = z.object({
  kind: z.enum(['all', 'partial', 'remaining']),
  quantityText: z.string().max(80).optional(),
})

const AI_INGREDIENT_REFERENCE_SCHEMA = z.object({
  ingredientIndex: z.number(),
  confidence: z.enum(['high', 'uncertain']),
  usage: AI_USAGE_SCHEMA.optional(),
})

const AI_PREPARED_COMPONENT_SCHEMA = z.object({
  label: z.string().max(80),
  confidence: z.enum(['high', 'uncertain']),
})

export const AI_COOKING_STEP_RESOLUTION_SCHEMA = z.object({
  steps: z.array(z.object({
    instructionIndex: z.number(),
    ingredients: z.array(AI_INGREDIENT_REFERENCE_SCHEMA).max(200),
    preparedComponents: z.array(AI_PREPARED_COMPONENT_SCHEMA).max(30),
  })).max(150),
})

export type AiCookingStepResolution = z.infer<typeof AI_COOKING_STEP_RESOLUTION_SCHEMA>

const COMPONENT_WORDS = new Set([
  'batter', 'dough', 'dressing', 'filling', 'glaze', 'marinade', 'mixture',
  'rub', 'sauce', 'seasoning', 'tadka', 'topping',
])

const PARTIAL_LANGUAGE = /(?:\b(?:half|quarter|some|\d+(?:\.\d+)?|\d+\/\d+)\b|[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/i
const REMAINING_LANGUAGE = /\b(?:remaining|rest)\b/i
const ALL_LANGUAGE = /\b(?:all|everything)\b/i

export const COOKING_STEP_MAPPING_SYSTEM_PROMPT = `You resolve only high-confidence semantic ingredient relationships for cooking instructions.

The deterministic mappings supplied in the request are locked and authoritative. Never remove, replace, correct, or restate them. Return proposals only for the listed unresolved instruction indexes, and reference only the existing numeric indexes.

Rules:
- A mapped ingredient is actively introduced or used in that instruction.
- Return an association only when the recipe text strongly supports it. When multiple rows remain plausible, omit it or mark it uncertain.
- Use ingredient subheaders as semantic scope only when instruction context supports that group.
- A generic reference such as "the sauce", "the marinade", "the dressing", "the filling", "the topping", "the tadka", or "the prepared mixture" is a prepared component, not permission to choose an arbitrary raw ingredient whose name ends with that word.
- Resolve collective references only when their group scope is clear. Generic "everything" remains uncertain without a clear scope.
- Resolve pronouns only when the antecedent is strong; otherwise omit them.
- Preserve explicit half, remaining, rest, fractional, or measured usage text, but never calculate quantities.
- Never rewrite recipe text, invent ingredients, create indexes, or add explanatory prose.

Use confidence "high" only for strongly supported proposals. Use "uncertain" or omit the proposal whenever doubt remains.`

interface IngredientContext {
  ingredientIndex: number
  raw: string
  identity: string
  group: string | null
  header: boolean
}

function normalizeText(value: string): string {
  return normalizeNoun(value
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]+/gu, ' '))
}

function normalizeHeader(value: string): string {
  return normalizeText(value
    .replace(/^\*+|\*+$/g, '')
    .replace(/:$/, '')
    .replace(/^for\s+(?:the\s+)?/i, '')
    .replace(/^the\s+/i, ''))
}

function normalizeIngredientIdentity(value: string): string {
  const parsed = parseIngredient(value)
  const withoutNotes = parsed.name.replace(/\([^()\r\n]{0,120}\)/g, ' ')
  return normalizeText(withoutNotes.split(',')[0])
}

function ingredientContexts(ingredients: string[]): IngredientContext[] {
  const result: IngredientContext[] = []
  let group: string | null = null
  ingredients.forEach((raw, ingredientIndex) => {
    if (isIngredientSubheader(raw)) {
      group = normalizeHeader(raw) || null
      result.push({ ingredientIndex, raw, identity: '', group, header: true })
      return
    }
    result.push({
      ingredientIndex,
      raw,
      identity: normalizeIngredientIdentity(raw),
      group,
      header: false,
    })
  })
  return result
}

function containsNormalizedPhrase(source: string, phrase: string): boolean {
  if (!phrase) return false
  return ` ${normalizeText(source)} `.includes(` ${normalizeText(phrase)} `)
}

function validateUsage(
  usage: AiCookingStepResolution['steps'][number]['ingredients'][number]['usage'],
  instruction: string,
): CookingIngredientUsage | undefined | null {
  if (!usage) return undefined
  const quantityText = usage.quantityText?.trim().replace(/\s+/g, ' ')
  const normalizedInstruction = instruction.trim().replace(/\s+/g, ' ').toLowerCase()
  if (quantityText && !normalizedInstruction.includes(quantityText.toLowerCase())) return null
  if (usage.kind === 'remaining' && !REMAINING_LANGUAGE.test(instruction)) return null
  if (usage.kind === 'partial' && !quantityText && !PARTIAL_LANGUAGE.test(instruction)) return null
  if (usage.kind === 'all' && !ALL_LANGUAGE.test(instruction)) return null
  return quantityText ? { kind: usage.kind, quantityText } : { kind: usage.kind }
}

function competingIdentityIndexes(
  candidates: AiCookingStepResolution['steps'][number]['ingredients'],
  contexts: IngredientContext[],
): Set<number> {
  const byIdentity = new Map<string, Set<number>>()
  for (const candidate of candidates) {
    if (candidate.confidence !== 'high' || !Number.isInteger(candidate.ingredientIndex)) continue
    const context = contexts[candidate.ingredientIndex]
    if (!context || context.header || !context.identity) continue
    const indexes = byIdentity.get(context.identity) || new Set<number>()
    indexes.add(candidate.ingredientIndex)
    byIdentity.set(context.identity, indexes)
  }
  const conflicts = new Set<number>()
  for (const indexes of byIdentity.values()) {
    if (indexes.size < 2) continue
    for (const index of indexes) conflicts.add(index)
  }
  return conflicts
}

function groundedPreparedComponent(
  label: string,
  instructionIndex: number,
  ingredients: string[],
  instructions: string[],
): string | null {
  const concise = label.trim().replace(/\s+/g, ' ').replace(/^the\s+/i, '')
  const normalized = normalizeText(concise)
  if (!concise || concise.length > 80 || !normalized) return null
  const tail = normalized.split(' ').at(-1)
  if (!tail || !COMPONENT_WORDS.has(tail)) return null

  const currentInstruction = instructions[instructionIndex] || ''
  const headerGrounded = ingredients
    .filter(isIngredientSubheader)
    .some(header => containsNormalizedPhrase(header, concise) || containsNormalizedPhrase(concise, normalizeHeader(header)))
  const nearbyInstructionGrounded = instructions
    .slice(Math.max(0, instructionIndex - 2), instructionIndex + 1)
    .some(instruction => containsNormalizedPhrase(instruction, concise))

  return containsNormalizedPhrase(currentInstruction, concise) || headerGrounded || nearbyInstructionGrounded
    ? concise
    : null
}

/**
 * Merge only structurally and textually validated AI proposals. The input map is
 * never mutated, and deterministic references always win.
 */
export function mergeValidatedAiCookingMappings(
  deterministicMap: CookingStepIngredientMap,
  ingredients: string[],
  instructions: string[],
  modelOutput: unknown,
): CookingStepIngredientMap {
  const parsedOutput = AI_COOKING_STEP_RESOLUTION_SCHEMA.safeParse(modelOutput)
  if (!parsedOutput.success) return deterministicMap

  const contexts = ingredientContexts(ingredients)
  const eligibleIndexes = new Set(deterministicMap.steps
    .filter(step => isAiEligibleCookingMappingReason(step.unresolvedReason))
    .map(step => step.instructionIndex))
  const proposalsByStep = new Map<number, AiCookingStepResolution['steps']>()
  for (const proposal of parsedOutput.data.steps) {
    if (!Number.isInteger(proposal.instructionIndex) || !eligibleIndexes.has(proposal.instructionIndex)) continue
    const current = proposalsByStep.get(proposal.instructionIndex) || []
    current.push(proposal)
    proposalsByStep.set(proposal.instructionIndex, current)
  }

  let acceptedAiAssociation = false
  const steps = deterministicMap.steps.map(step => {
    const proposals = proposalsByStep.get(step.instructionIndex)
    if (!proposals?.length) return {
      ...step,
      ingredients: step.ingredients.map(reference => reference.usage
        ? { ...reference, usage: { ...reference.usage } }
        : { ...reference }),
    }

    const proposedIngredients = proposals.flatMap(proposal => proposal.ingredients)
    const conflicts = competingIdentityIndexes(proposedIngredients, contexts)
    const deterministicIndexes = new Set(step.ingredients.map(reference => reference.ingredientIndex))
    const acceptedIndexes = new Set<number>()
    const aiIngredients: CookingStepIngredientReference[] = []

    for (const proposal of proposedIngredients) {
      const index = proposal.ingredientIndex
      if (proposal.confidence !== 'high' || !Number.isInteger(index) || index < 0 || index >= ingredients.length) continue
      if (contexts[index]?.header || conflicts.has(index) || deterministicIndexes.has(index) || acceptedIndexes.has(index)) continue
      const usage = validateUsage(proposal.usage, instructions[step.instructionIndex] || '')
      if (usage === null) continue
      acceptedIndexes.add(index)
      aiIngredients.push({
        ingredientIndex: index,
        confidence: 'high',
        provenance: 'ai',
        ...(usage ? { usage } : {}),
      })
    }

    const existingPreparedLabels = new Set((step.preparedComponents || []).map(component => normalizeText(component.label)))
    const aiPreparedComponents: CookingPreparedComponentReference[] = []
    for (const proposal of proposals.flatMap(item => item.preparedComponents)) {
      if (proposal.confidence !== 'high') continue
      const label = groundedPreparedComponent(proposal.label, step.instructionIndex, ingredients, instructions)
      const normalized = label ? normalizeText(label) : ''
      if (!label || existingPreparedLabels.has(normalized)) continue
      existingPreparedLabels.add(normalized)
      aiPreparedComponents.push({ label, confidence: 'high', provenance: 'ai' })
    }

    const resolved = aiIngredients.length > 0 || aiPreparedComponents.length > 0
    if (resolved) acceptedAiAssociation = true
    const { unresolvedReason, ...stepWithoutReason } = step
    return {
      ...(resolved ? stepWithoutReason : step),
      ingredients: [...step.ingredients, ...aiIngredients]
        .sort((a, b) => a.ingredientIndex - b.ingredientIndex),
      ...((step.preparedComponents?.length || aiPreparedComponents.length)
        ? { preparedComponents: [...(step.preparedComponents || []), ...aiPreparedComponents] }
        : {}),
    }
  })

  return acceptedAiAssociation
    ? { ...deterministicMap, engineVersion: COOKING_MAPPING_HYBRID_ENGINE_VERSION, steps }
    : { ...deterministicMap, steps }
}

export function countAiCookingMappings(map: CookingStepIngredientMap): {
  resolvedIngredientReferences: number
  resolvedPreparedComponents: number
} {
  return map.steps.reduce((counts, step) => ({
    resolvedIngredientReferences: counts.resolvedIngredientReferences +
      step.ingredients.filter(reference => reference.provenance === 'ai').length,
    resolvedPreparedComponents: counts.resolvedPreparedComponents +
      (step.preparedComponents?.filter(component => component.provenance === 'ai').length || 0),
  }), { resolvedIngredientReferences: 0, resolvedPreparedComponents: 0 })
}

export function buildCookingStepMappingPrompt(
  deterministicMap: CookingStepIngredientMap,
  ingredients: string[],
  instructions: string[],
): string {
  const contexts = ingredientContexts(ingredients)
  const ingredientLines = contexts.map(context => context.header
    ? `[${context.ingredientIndex}] GROUP HEADER: ${context.raw}`
    : `[${context.ingredientIndex}] INGREDIENT${context.group ? ` (group: ${context.group})` : ''}: ${context.raw}`)
  const instructionLines = instructions.map((instruction, instructionIndex) => {
    const step = deterministicMap.steps[instructionIndex]
    const locked = step?.ingredients.map(reference => reference.ingredientIndex).join(', ') || 'none'
    const unresolved = step?.unresolvedReason || 'none'
    return `[${instructionIndex}] ${instruction}\n    locked deterministic ingredient indexes: ${locked}; unresolved reason: ${unresolved}`
  })
  const eligible = deterministicMap.steps
    .filter(step => isAiEligibleCookingMappingReason(step.unresolvedReason))
    .map(step => `${step.instructionIndex}:${step.unresolvedReason}`)
    .join(', ')

  return `Cooking-step mapping prompt version: ${COOKING_STEP_MAPPING_PROMPT_VERSION}

INGREDIENTS
${ingredientLines.join('\n')}

INSTRUCTIONS
${instructionLines.join('\n')}

ELIGIBLE UNRESOLVED STEPS
${eligible || 'none'}

Return proposals only for eligible unresolved steps. Use existing numeric indexes and the structured response shape.`
}

/** Make the one optional Gateway call for a recipe with eligible unresolved steps. */
export async function resolveCookingStepMappingsWithAi(
  deterministicMap: CookingStepIngredientMap,
  ingredients: string[],
  instructions: string[],
  userId: string,
): Promise<AiCookingStepResolution> {
  return generateAIObject({
    feature: 'cooking-step-map',
    userId,
    promptVersion: COOKING_STEP_MAPPING_PROMPT_VERSION,
    system: COOKING_STEP_MAPPING_SYSTEM_PROMPT,
    prompt: buildCookingStepMappingPrompt(deterministicMap, ingredients, instructions),
    schema: AI_COOKING_STEP_RESOLUTION_SCHEMA,
  })
}
