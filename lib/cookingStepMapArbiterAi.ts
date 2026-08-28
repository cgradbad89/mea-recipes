import 'server-only'

import { z } from 'zod'
import { generateAIObject } from '@/lib/ai'
import { COOKING_STEP_MAPPING_TEMPERATURE } from '@/lib/aiConfig'
import type { CookingMapCandidatePool } from '@/lib/cookingStepMapConsensus'
import { normalizeCookingComponentLabel } from '@/lib/cookingStepMapConsensus'

const COOKING_STEP_MAP_ARBITER_PROMPT_VERSION = 'v1'

const DECISION_SCHEMA = z.enum(['ACCEPT', 'REJECT', 'UNCERTAIN'])

export const COOKING_MAP_ARBITRATION_SCHEMA = z.object({
  ingredientRelations: z.array(z.object({
    instructionIndex: z.number(),
    ingredientIndex: z.number(),
    decision: DECISION_SCHEMA,
    evidenceText: z.string().max(400),
  })).max(30_000),
  components: z.array(z.object({
    instructionIndex: z.number(),
    proposedLabel: z.string().min(1).max(100),
    decision: DECISION_SCHEMA,
    canonicalLabel: z.string().max(100),
    evidenceText: z.string().max(400),
  })).max(5_000),
})

export type CookingMapArbitration = z.infer<typeof COOKING_MAP_ARBITRATION_SCHEMA>

export const COOKING_MAP_ARBITER_SYSTEM_PROMPT = `You are the final source-grounded arbiter for a Cooking Mode map. Two independent blind reviewers already discovered semantic relationships, and deterministic-v5 supplied additional candidates. You do not generate a new map from scratch.

Classify every supplied ingredient relationship and every supplied prepared-component proposal exactly once as ACCEPT, REJECT, or UNCERTAIN. Do not add candidates and do not omit candidates. Every decision must include evidenceText; use a short source quote when available and an empty string only when no source quote applies. Every component decision must include canonicalLabel; for a non-ACCEPT decision, repeat proposedLabel.

ACCEPT an ingredient relationship only when the source proves that a competent cook actively introduces, uses, manipulates, seasons with, combines with, applies, adds, cooks, tosses, tops, garnishes, or otherwise needs that exact listed row for the current step. A continuing-use relationship is valid when the current action clearly manipulates an ingredient or established state from an earlier instruction. EvidenceText for ACCEPT must be a short exact quote from the current instruction that proves the action.

REJECT contextual mentions, guessed ingredients, negative or deferred use, consumed unrelated rows, fresh unlisted process material borrowing a listed row, quantity contradictions, the wrong duplicate/group/purpose row, finished-dish or compound-name collisions, and raw constituent leakage when the current step acts only on a prepared component. Reviewer agreement is useful evidence but is never automatic acceptance. A deterministic candidate may be rejected only after the source evidence is checked; reviewer omission alone is not a reason to reject it.

For prepared components, ACCEPT only a component established by an ingredient group or an actionable current/prior instruction and actively used at the candidate step. Generic aliases such as "dressing" may canonicalize to a unique source-grounded label such as "green harissa dressing". Evidence may quote the current instruction, the establishing prior instruction, or a group header. Do not invent labels or repeat raw constituents for a component-only action.

Use UNCERTAIN only when the recipe source itself cannot support a binary decision. An ACCEPT without exact source evidence is invalid. Decide only from the supplied recipe source and candidate metadata; no reviewer reasoning is supplied.`

function normalizeSource(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function sourceContains(source: string, evidence: string): boolean {
  const normalizedSource = normalizeSource(source)
  const normalizedEvidence = normalizeSource(evidence)
  return Boolean(normalizedEvidence) && ` ${normalizedSource} `.includes(` ${normalizedEvidence} `)
}

function relationKey(instructionIndex: number, ingredientIndex: number): string {
  return `${instructionIndex}:${ingredientIndex}`
}

function componentKey(instructionIndex: number, label: string): string {
  return `${instructionIndex}:${normalizeCookingComponentLabel(label)}`
}

export function buildCookingMapArbiterPrompt(
  title: string,
  ingredients: string[],
  instructions: string[],
  pool: CookingMapCandidatePool,
): string {
  const ingredientRelations = pool.ingredientRelations.map(candidate => ({
    instructionIndex: candidate.instructionIndex,
    ingredientIndex: candidate.ingredientIndex,
    deterministic: candidate.origins.includes('DETERMINISTIC'),
    reviewerAgreement: candidate.origins.includes('BOTH_REVIEWERS')
      ? 'both'
      : candidate.origins.some(origin => origin === 'A_ONLY' || origin === 'B_ONLY') ? 'single' : 'none',
    rawIngredient: candidate.rawIngredient,
    rawInstruction: candidate.rawInstruction,
    ingredientGroup: candidate.ingredientGroup,
  }))
  const components = pool.components.map(candidate => ({
    instructionIndex: candidate.instructionIndex,
    proposedLabel: candidate.proposedLabel,
    reviewerAgreement: candidate.origins.includes('BOTH_REVIEWERS') ? 'both' : 'single',
    rawInstruction: instructions[candidate.instructionIndex] || '',
  }))
  const source = {
    title,
    ingredients: ingredients.map((raw, ingredientIndex) => ({ ingredientIndex, raw })),
    instructions: instructions.map((raw, instructionIndex) => ({ instructionIndex, raw })),
  }
  return `Cooking-step map arbiter prompt version: ${COOKING_STEP_MAP_ARBITER_PROMPT_VERSION}

SOURCE RECIPE
${JSON.stringify(source, null, 2)}

CANDIDATE INGREDIENT RELATIONSHIPS
${JSON.stringify(ingredientRelations, null, 2)}

CANDIDATE PREPARED COMPONENTS
${JSON.stringify(components, null, 2)}

Return one decision for every supplied candidate and no other candidates.`
}

export function validateCookingMapArbitration(
  value: unknown,
  ingredients: string[],
  instructions: string[],
  pool: CookingMapCandidatePool,
): CookingMapArbitration {
  const parsed = COOKING_MAP_ARBITRATION_SCHEMA.parse(value)
  const expectedRelations = new Map(pool.ingredientRelations.map(candidate => [
    relationKey(candidate.instructionIndex, candidate.ingredientIndex), candidate,
  ]))
  const expectedComponents = new Map(pool.components.map(candidate => [
    componentKey(candidate.instructionIndex, candidate.proposedLabel), candidate,
  ]))
  if (parsed.ingredientRelations.length !== expectedRelations.size || parsed.components.length !== expectedComponents.size) {
    throw new Error('arbiter did not cover every candidate exactly once')
  }

  const seenRelations = new Set<string>()
  const ingredientRelations = parsed.ingredientRelations.map(decision => {
    const key = relationKey(decision.instructionIndex, decision.ingredientIndex)
    const candidate = expectedRelations.get(key)
    if (!candidate || seenRelations.has(key)) throw new Error(`invalid or duplicate arbiter relation: ${key}`)
    seenRelations.add(key)
    if (decision.decision === 'ACCEPT' &&
      (!decision.evidenceText || !sourceContains(instructions[decision.instructionIndex] || '', decision.evidenceText))) {
      return { ...decision, decision: 'REJECT' as const, evidenceText: '' }
    }
    return decision
  })

  const seenComponents = new Set<string>()
  const components = parsed.components.map(decision => {
    const key = componentKey(decision.instructionIndex, decision.proposedLabel)
    const candidate = expectedComponents.get(key)
    if (!candidate || seenComponents.has(key)) throw new Error(`invalid or duplicate arbiter component: ${key}`)
    seenComponents.add(key)
    if (decision.decision !== 'ACCEPT') return decision
    const evidence = decision.evidenceText || ''
    const sourceBeforeOrAtStep = [
      ...ingredients,
      ...instructions.slice(0, decision.instructionIndex + 1),
    ]
    if (!evidence || !sourceBeforeOrAtStep.some(source => sourceContains(source, evidence))) {
      return { ...decision, decision: 'REJECT' as const, canonicalLabel: decision.proposedLabel, evidenceText: '' }
    }
    const canonical = normalizeCookingComponentLabel(decision.canonicalLabel || decision.proposedLabel)
    if (!canonical || ![...ingredients, ...instructions].some(source => sourceContains(source, canonical))) {
      return { ...decision, decision: 'REJECT' as const, canonicalLabel: decision.proposedLabel, evidenceText: '' }
    }
    return decision
  })

  return {
    ingredientRelations: ingredientRelations
      .sort((left, right) => left.instructionIndex - right.instructionIndex || left.ingredientIndex - right.ingredientIndex),
    components: components.sort((left, right) => left.instructionIndex - right.instructionIndex ||
        left.proposedLabel.localeCompare(right.proposedLabel)),
  }
}

export async function arbitrateCookingStepMapWithAi(
  title: string,
  ingredients: string[],
  instructions: string[],
  pool: CookingMapCandidatePool,
  userId: string,
  timeout?: number,
): Promise<CookingMapArbitration> {
  const output = await generateAIObject({
    feature: 'cooking-step-map-arbiter',
    userId,
    promptVersion: COOKING_STEP_MAP_ARBITER_PROMPT_VERSION,
    system: COOKING_MAP_ARBITER_SYSTEM_PROMPT,
    prompt: buildCookingMapArbiterPrompt(title, ingredients, instructions, pool),
    schema: COOKING_MAP_ARBITRATION_SCHEMA,
    temperature: COOKING_STEP_MAPPING_TEMPERATURE,
    ...(timeout === undefined ? {} : { timeout }),
  })
  return validateCookingMapArbitration(output, ingredients, instructions, pool)
}
