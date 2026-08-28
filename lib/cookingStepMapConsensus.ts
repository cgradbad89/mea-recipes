import { normalizeNoun, parseIngredient } from '@/lib/ingredientParser'
import {
  computeCookingMappingSourceHash,
  isNonActionableCookingInstruction,
} from '@/lib/cookingStepMapping'
import { isIngredientSubheader } from '@/lib/recipeContent'
import type { BlindCookingReview } from '@/lib/cookingStepBlindReviewerAi'
import type {
  CookingPreparedComponentReference,
  CookingStepIngredientMap,
  CookingStepIngredientReference,
  CookingStepMapping,
} from '@/types/recipe'

const COOKING_MAPPING_CONSENSUS_ENGINE_VERSION = 'hybrid-v9'

export type CandidateOrigin = 'DETERMINISTIC' | 'BOTH_REVIEWERS' | 'A_ONLY' | 'B_ONLY'

export interface CookingIngredientRelationCandidate {
  instructionIndex: number
  ingredientIndex: number
  origins: CandidateOrigin[]
  rawIngredient: string
  rawInstruction: string
  ingredientGroup: string | null
}

export interface CookingComponentCandidate {
  instructionIndex: number
  proposedLabel: string
  origins: Exclude<CandidateOrigin, 'DETERMINISTIC'>[]
}

export interface CookingMapCandidatePool {
  ingredientRelations: CookingIngredientRelationCandidate[]
  components: CookingComponentCandidate[]
}

export interface ArbitrationIngredientDecision {
  instructionIndex: number
  ingredientIndex: number
  decision: 'ACCEPT' | 'REJECT' | 'UNCERTAIN'
  evidenceText?: string
}

export interface ArbitrationComponentDecision {
  instructionIndex: number
  proposedLabel: string
  decision: 'ACCEPT' | 'REJECT' | 'UNCERTAIN'
  canonicalLabel?: string
  evidenceText?: string
}

export interface CookingMapArbitrationLike {
  ingredientRelations: ArbitrationIngredientDecision[]
  components: ArbitrationComponentDecision[]
}

export interface CookingMapSafetyDiagnostic {
  kind: 'ingredient' | 'component'
  instructionIndex: number
  ingredientIndex?: number
  proposedLabel?: string
  arbiterDecision: 'ACCEPT' | 'REJECT' | 'UNCERTAIN'
  retained: boolean
  reason: string
}

export interface ConsensusMergeResult {
  mapping: CookingStepIngredientMap
  diagnostics: CookingMapSafetyDiagnostic[]
}

interface IngredientContext {
  index: number
  raw: string
  group: string | null
  identity: string
  tail: string
  quantity: string | null
  unit: string | null
}

const COMPONENT_TAILS = new Set([
  'butter', 'dressing', 'filling', 'marinade', 'mixture', 'oil', 'rub', 'salsa',
  'sauce', 'seasoning', 'slaw', 'soup', 'tadka', 'topping', 'vinaigrette',
])
const COLLISION_CARRIERS = new Set(['broth', 'cream', 'milk', 'oil', 'sauce', 'stock', 'water'])

function normalizeText(value: string): string {
  return normalizeNoun(value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' '))
}

export function normalizeCookingComponentLabel(value: string): string {
  return normalizeText(value).replace(/^(?:the|prepared|remaining)\s+/, '').trim()
}

function ingredientContexts(ingredients: string[]): IngredientContext[] {
  let group: string | null = null
  return ingredients.flatMap((raw, index) => {
    if (isIngredientSubheader(raw)) {
      group = normalizeCookingComponentLabel(raw
        .replace(/^[-*#\s]+/, '')
        .replace(/:$/, '')
        .replace(/^for\s+(?:the\s+)?/i, '')) || null
      return []
    }
    const parsed = parseIngredient(raw)
    const identity = normalizeText(parsed.name
      .replace(/\([^()\r\n]{0,120}\)/g, ' ')
      .replace(/\s*,?\s*(?:more\s+)?to taste\b/gi, ' '))
    return [{
      index,
      raw,
      group,
      identity,
      tail: identity.split(' ').at(-1) || '',
      quantity: parsed.quantity ? normalizeText(parsed.quantity) : null,
      unit: parsed.unit ? normalizeText(parsed.unit) : null,
    }]
  })
}

function originFor(
  inA: boolean,
  inB: boolean,
): Exclude<CandidateOrigin, 'DETERMINISTIC'> | null {
  if (inA && inB) return 'BOTH_REVIEWERS'
  if (inA) return 'A_ONLY'
  if (inB) return 'B_ONLY'
  return null
}

function exactSourcePhrase(value: string, ingredients: string[], instructions: string[]): boolean {
  const needle = normalizeCookingComponentLabel(value)
  if (!needle) return false
  return [...ingredients, ...instructions].some(source =>
    ` ${normalizeText(source)} `.includes(` ${needle} `))
}

function canonicalComponentProposal(
  label: string,
  labels: string[],
  ingredients: string[],
  instructions: string[],
): string {
  const normalized = normalizeCookingComponentLabel(label)
  const longer = [...new Set(labels.map(normalizeCookingComponentLabel))]
    .filter(candidate => candidate !== normalized && candidate.endsWith(` ${normalized}`) &&
      exactSourcePhrase(candidate, ingredients, instructions))
    .sort((left, right) => right.length - left.length)
  return longer.length === 1 ? longer[0] : normalized
}

export function buildCookingMapCandidatePool(
  deterministicMap: CookingStepIngredientMap,
  ingredients: string[],
  instructions: string[],
  reviewA: BlindCookingReview,
  reviewB: BlindCookingReview,
): CookingMapCandidatePool {
  const contexts = new Map(ingredientContexts(ingredients).map(context => [context.index, context]))
  const aSteps = new Map(reviewA.steps.map(step => [step.instructionIndex, step]))
  const bSteps = new Map(reviewB.steps.map(step => [step.instructionIndex, step]))
  const ingredientRelations: CookingIngredientRelationCandidate[] = []
  const components: CookingComponentCandidate[] = []

  for (const deterministicStep of deterministicMap.steps) {
    const instructionIndex = deterministicStep.instructionIndex
    const a = aSteps.get(instructionIndex)
    const b = bSteps.get(instructionIndex)
    const aIndexes = new Set(a?.expectedIngredientIndexes || [])
    const bIndexes = new Set(b?.expectedIngredientIndexes || [])
    const deterministicIndexes = new Set(deterministicStep.ingredients.map(item => item.ingredientIndex))
    const union = [...new Set([...deterministicIndexes, ...aIndexes, ...bIndexes])].sort((left, right) => left - right)
    for (const ingredientIndex of union) {
      const context = contexts.get(ingredientIndex)
      if (!context) throw new Error(`candidate pool contains invalid ingredient index ${ingredientIndex}`)
      const origins: CandidateOrigin[] = []
      if (deterministicIndexes.has(ingredientIndex)) origins.push('DETERMINISTIC')
      const reviewerOrigin = originFor(aIndexes.has(ingredientIndex), bIndexes.has(ingredientIndex))
      if (reviewerOrigin) origins.push(reviewerOrigin)
      ingredientRelations.push({
        instructionIndex,
        ingredientIndex,
        origins,
        rawIngredient: context.raw,
        rawInstruction: instructions[instructionIndex] || '',
        ingredientGroup: context.group,
      })
    }

    const aLabels = (a?.preparedComponents || []).map(item => item.label)
    const bLabels = (b?.preparedComponents || []).map(item => item.label)
    const allLabels = [...aLabels, ...bLabels]
    const aNormalized = new Set(aLabels.map(label => canonicalComponentProposal(label, allLabels, ingredients, instructions)))
    const bNormalized = new Set(bLabels.map(label => canonicalComponentProposal(label, allLabels, ingredients, instructions)))
    for (const proposedLabel of [...new Set([...aNormalized, ...bNormalized])].sort()) {
      const reviewerOrigin = originFor(aNormalized.has(proposedLabel), bNormalized.has(proposedLabel))
      if (!reviewerOrigin) continue
      components.push({
        instructionIndex,
        proposedLabel,
        origins: [reviewerOrigin],
      })
    }
  }

  return { ingredientRelations, components }
}

function relationKey(instructionIndex: number, ingredientIndex: number): string {
  return `${instructionIndex}:${ingredientIndex}`
}

function componentKey(instructionIndex: number, label: string): string {
  return `${instructionIndex}:${normalizeCookingComponentLabel(label)}`
}

function negativeOrDeferredEvidence(value: string): boolean {
  const evidence = normalizeText(value)
  return /\b(?:do not|dont|never|without|discard|except)\b/.test(evidence) ||
    /\b(?:reserve|save)\b.*\bfor later\b/.test(evidence)
}

function hardIngredientSafetyReason(
  candidate: CookingIngredientRelationCandidate,
  evidenceText: string,
  contexts: IngredientContext[],
  acceptedComponents: ArbitrationComponentDecision[],
  retainedPriorIndexes: Set<number>,
): string | null {
  const context = contexts.find(item => item.index === candidate.ingredientIndex)
  if (!context || isIngredientSubheader(candidate.rawIngredient)) return 'invalid-or-header-index'
  if (isNonActionableCookingInstruction(candidate.rawInstruction)) return 'non-actionable-instruction'
  if (negativeOrDeferredEvidence(evidenceText)) return 'negative-or-deferred-evidence'
  const instruction = normalizeText(candidate.rawInstruction)
  if (
    ['water', 'oil', 'salt'].includes(context.tail) &&
    Boolean(context.quantity) &&
    /\b(?:fresh|additional|extra|more|boiling|cold|hot|warm)\b/.test(instruction) &&
    (!context.quantity || !instruction.includes(context.quantity))
  ) return 'fresh-process-material-hijack'

  if (context.quantity && context.unit) {
    const units = '(?:cups?|tablespoons?|tbsp|teaspoons?|tsp|ounces?|oz|pounds?|lb)'
    const quantityUse = instruction.match(new RegExp(`\\b([0-9]+(?:\\s+[0-9]+\\/[0-9]+|\\/[0-9]+)?|[¼½¾⅓⅔⅛⅜⅝⅞])\\s+(${units})\\b[^.]{0,40}\\b${context.tail}\\b`))
    if (quantityUse) {
      const cited = normalizeText(`${quantityUse[1]} ${quantityUse[2]}`)
      const listed = normalizeText(`${context.quantity} ${context.unit}`)
      if (cited !== listed) return 'quantity-contradiction'
    }
  }

  const identityWords = context.identity.split(' ')
  if (
    identityWords.length > 1 &&
    COLLISION_CARRIERS.has(context.tail) &&
    !(` ${instruction} `.includes(` ${context.identity} `)) &&
    !(` ${instruction} `.includes(` ${context.tail} `)) &&
    identityWords.slice(0, -1).some(word => word.length > 2 && ` ${instruction} `.includes(` ${word} `))
  ) return 'finished-dish-or-compound-name-collision'

  const sameTail = contexts.filter(item => item.index !== context.index && item.tail === context.tail)
  const explicitSiblingGroup = sameTail.find(item => item.group && ` ${instruction} `.includes(` ${item.group} `))
  if (explicitSiblingGroup && context.group !== explicitSiblingGroup.group) return 'wrong-duplicate-group-direct-contradiction'

  const groupTail = context.group?.split(' ').at(-1) || ''
  if (
    retainedPriorIndexes.has(context.index) &&
    Boolean(context.group) &&
    COMPONENT_TAILS.has(groupTail) &&
    !(` ${instruction} `.includes(` ${context.group} `)) &&
    !/\b(?:remaining|rest|reserved|again|continue)\b/.test(instruction)
  ) return 'consumed-row-reused-without-explicit-reuse'

  const acceptedAtStep = acceptedComponents.filter(item => item.instructionIndex === candidate.instructionIndex)
  if (context.group && acceptedAtStep.some(component => {
    const label = normalizeCookingComponentLabel(component.canonicalLabel || component.proposedLabel)
    const groupTail = context.group?.split(' ').at(-1) || ''
    const labelTail = label.split(' ').at(-1) || ''
    const componentNamed = ` ${instruction} `.includes(` ${label} `) ||
      (COMPONENT_TAILS.has(labelTail) && ` ${instruction} `.includes(` ${labelTail} `))
    const groupMatches = context.group === label || groupTail === labelTail
    const ingredientNamed = ` ${instruction} `.includes(` ${context.identity} `) ||
      (context.tail.length > 2 && ` ${instruction} `.includes(` ${context.tail} `))
    return componentNamed && groupMatches && !ingredientNamed
  })) return 'prepared-component-constituent-leakage'

  return null
}

function cloneReference(reference: CookingStepIngredientReference): CookingStepIngredientReference {
  return reference.usage ? { ...reference, usage: { ...reference.usage } } : { ...reference }
}

export async function mergeArbitratedCookingStepMap(
  deterministicMap: CookingStepIngredientMap,
  ingredients: string[],
  instructions: string[],
  pool: CookingMapCandidatePool,
  arbitration: CookingMapArbitrationLike,
): Promise<ConsensusMergeResult> {
  const expectedHash = await computeCookingMappingSourceHash(ingredients, instructions)
  if (deterministicMap.sourceHash !== expectedHash) throw new Error('sourceHash/source mismatch before consensus merge')
  const contexts = ingredientContexts(ingredients)
  const relationCandidates = new Map(pool.ingredientRelations.map(item => [
    relationKey(item.instructionIndex, item.ingredientIndex), item,
  ]))
  const relationDecisions = new Map(arbitration.ingredientRelations.map(item => [
    relationKey(item.instructionIndex, item.ingredientIndex), item,
  ]))
  const componentCandidates = new Map(pool.components.map(item => [
    componentKey(item.instructionIndex, item.proposedLabel), item,
  ]))
  const componentDecisions = new Map(arbitration.components.map(item => [
    componentKey(item.instructionIndex, item.proposedLabel), item,
  ]))
  if (relationCandidates.size !== relationDecisions.size || componentCandidates.size !== componentDecisions.size) {
    throw new Error('arbitration coverage changed before consensus merge')
  }

  const acceptedComponents = arbitration.components.filter(item => item.decision === 'ACCEPT')
  const diagnostics: CookingMapSafetyDiagnostic[] = []
  const retainedPriorIndexes = new Set<number>()
  const steps: CookingStepMapping[] = deterministicMap.steps.map(step => {
    const deterministicReferences = new Map(step.ingredients.map(reference => [reference.ingredientIndex, reference]))
    const references: CookingStepIngredientReference[] = []
    for (const candidate of pool.ingredientRelations.filter(item => item.instructionIndex === step.instructionIndex)) {
      const decision = relationDecisions.get(relationKey(candidate.instructionIndex, candidate.ingredientIndex))
      if (!decision) throw new Error('missing ingredient arbitration during merge')
      let reason = decision.decision.toLowerCase()
      let retained = false
      if (decision.decision === 'ACCEPT') {
        const safetyReason = hardIngredientSafetyReason(
          candidate,
          decision.evidenceText || '',
          contexts,
          acceptedComponents,
          retainedPriorIndexes,
        )
        if (safetyReason) reason = safetyReason
        else {
          const deterministic = deterministicReferences.get(candidate.ingredientIndex)
          references.push(deterministic
            ? cloneReference(deterministic)
            : { ingredientIndex: candidate.ingredientIndex, confidence: 'high', provenance: 'ai' })
          retained = true
          retainedPriorIndexes.add(candidate.ingredientIndex)
          reason = 'accepted-and-safe'
        }
      }
      diagnostics.push({
        kind: 'ingredient',
        instructionIndex: candidate.instructionIndex,
        ingredientIndex: candidate.ingredientIndex,
        arbiterDecision: decision.decision,
        retained,
        reason,
      })
    }

    const preparedComponents: CookingPreparedComponentReference[] = []
    for (const candidate of pool.components.filter(item => item.instructionIndex === step.instructionIndex)) {
      const decision = componentDecisions.get(componentKey(candidate.instructionIndex, candidate.proposedLabel))
      if (!decision) throw new Error('missing component arbitration during merge')
      const canonicalLabel = normalizeCookingComponentLabel(decision.canonicalLabel || candidate.proposedLabel)
      const retained = decision.decision === 'ACCEPT' && Boolean(canonicalLabel) && canonicalLabel.length <= 80
      if (retained) preparedComponents.push({ label: canonicalLabel, confidence: 'high', provenance: 'ai' })
      diagnostics.push({
        kind: 'component',
        instructionIndex: candidate.instructionIndex,
        proposedLabel: candidate.proposedLabel,
        arbiterDecision: decision.decision,
        retained,
        reason: retained ? 'accepted-and-safe' : decision.decision.toLowerCase(),
      })
    }

    const uniqueReferences = [...new Map(references.map(reference => [reference.ingredientIndex, reference])).values()]
      .sort((left, right) => left.ingredientIndex - right.ingredientIndex)
    const uniqueComponents = [...new Map(preparedComponents.map(component => [
      normalizeCookingComponentLabel(component.label), component,
    ])).values()]
    const resolved = uniqueReferences.length > 0 || uniqueComponents.length > 0
    const { unresolvedReason, ...withoutReason } = step
    return {
      ...(resolved ? withoutReason : step),
      ingredients: uniqueReferences,
      ...(uniqueComponents.length > 0 ? { preparedComponents: uniqueComponents } : {}),
    }
  })

  return {
    mapping: {
      ...deterministicMap,
      engineVersion: COOKING_MAPPING_CONSENSUS_ENGINE_VERSION,
      steps,
    },
    diagnostics,
  }
}
