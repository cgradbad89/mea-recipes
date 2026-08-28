import 'server-only'

import { z } from 'zod'
import { generateAIObject } from '@/lib/ai'
import {
  AI_MODEL,
  COOKING_MODE_MAPPING_REVIEWER_PROMPT_VERSION,
  COOKING_MODE_MAPPING_REVIEWER_TEMPERATURE,
} from '@/lib/aiConfig'
import { computeMappingRecipeRevision } from '@/lib/cookingModeMappingIdentity'
import { mappingIngredientGroup } from '@/lib/cookingModeMappingRiskFacts'
import { isIngredientSubheader } from '@/lib/recipeContent'
import {
  MAPPING_REVIEWER_CONTRACT_VERSION,
} from '@/types/cookingModeMapping'
import type {
  MappingBlindReviewResultV1,
  MappingReviewerAttemptFailure,
  MappingReviewerAttemptV1,
  MappingReviewerCoverageV1,
  MappingReviewerExecutionResultV1,
  MappingReviewerRelationshipV1,
  MappingReviewerResponseV1,
  MappingRevisionSource,
} from '@/types/cookingModeMapping'

export const MAPPING_REVIEWER_MAX_ATTEMPTS = 2
export const MAPPING_REVIEWER_DEFAULT_TIMEOUT_MS = 120_000
export const MAPPING_REVIEWER_MAX_INGREDIENT_ROWS = 200
export const MAPPING_REVIEWER_MAX_STEPS = 150
export const MAPPING_REVIEWER_MAX_SOURCE_LINE_LENGTH = 4_000

const REVIEWER_RELATIONSHIP_SCHEMA = z.object({
  ingredientRowIndex: z.number().int(),
  stepIndex: z.number().int(),
}).strict()

const REVIEWER_COVERAGE_SCHEMA = z.object({
  ingredientRowCount: z.number().int().nonnegative(),
  nonHeaderIngredientRowCount: z.number().int().nonnegative(),
  stepCount: z.number().int().nonnegative(),
  reviewedCellCount: z.number().int().nonnegative(),
}).strict()

export const MAPPING_REVIEWER_RESPONSE_SCHEMA = z.object({
  reviewerContractVersion: z.literal(MAPPING_REVIEWER_CONTRACT_VERSION),
  promptVersion: z.literal(COOKING_MODE_MAPPING_REVIEWER_PROMPT_VERSION),
  recipeRevision: z.string().min(1).max(200),
  coverage: REVIEWER_COVERAGE_SCHEMA,
  acceptedRelationships: z.array(REVIEWER_RELATIONSHIP_SCHEMA).max(30_000),
}).strict()

export const MAPPING_REVIEWER_SYSTEM_PROMPT = `You are one of two independent, blind Cooking Mode mapping reviewers. Perform exhaustive, source-grounded discovery over the complete recipe. For every non-header ingredient row, identify every instruction step where that listed ingredient is actively relevant according to the supplied source.

Include direct use; continued manipulation of a dish or mixture containing the row when the source establishes that lifecycle; pronoun or deictic references; clear collective references; transfer and assembly; serving or garnish actions; divided or reserved use; and seasoning or herb use.

Do not include passive isolated-component leakage, context-only mentions, process materials that are not the listed row, generic seasoning re-triggers without row-specific support, partial identity collisions, quantity-conflicting rows, or unmerged subordinate components. Ingredient group headers provide scope but are never relationships. Do not infer unlisted ingredients or benchmark truth.

Evaluate the entire non-header ingredient-by-step grid. Omission means REJECT only after that exhaustive evaluation. Return only the compact structured response. Do not provide chain-of-thought, explanations, confidence, hidden reasoning, candidate IDs, or any information outside the schema.`

function sourceSnapshot(source: MappingRevisionSource): MappingRevisionSource {
  return {
    recipeId: source.recipeId,
    parserVersion: source.parserVersion,
    ingredients: [...source.ingredients],
    instructions: [...source.instructions],
  }
}

function assertBoundedReviewerSource(source: MappingRevisionSource): void {
  if (!source.recipeId || !source.parserVersion) throw new Error('mapping reviewer source identity is required')
  if (source.ingredients.length > MAPPING_REVIEWER_MAX_INGREDIENT_ROWS) {
    throw new Error('mapping reviewer ingredient row limit exceeded')
  }
  if (source.instructions.length > MAPPING_REVIEWER_MAX_STEPS) {
    throw new Error('mapping reviewer step limit exceeded')
  }
  if ([...source.ingredients, ...source.instructions].some(value =>
    typeof value !== 'string' || value.length > MAPPING_REVIEWER_MAX_SOURCE_LINE_LENGTH)) {
    throw new Error('mapping reviewer source line limit exceeded')
  }
}

function expectedCoverage(source: MappingRevisionSource): MappingReviewerCoverageV1 {
  const nonHeaderIngredientRowCount = source.ingredients.filter(item => !isIngredientSubheader(item)).length
  return {
    ingredientRowCount: source.ingredients.length,
    nonHeaderIngredientRowCount,
    stepCount: source.instructions.length,
    reviewedCellCount: nonHeaderIngredientRowCount * source.instructions.length,
  }
}

export function buildMappingReviewerPrompt(
  source: MappingRevisionSource,
  recipeRevision: string,
): string {
  const coverage = expectedCoverage(source)
  const ingredientLines = source.ingredients.map((text, ingredientRowIndex) => {
    if (isIngredientSubheader(text)) return `[${ingredientRowIndex}] GROUP HEADER: ${text}`
    const group = mappingIngredientGroup(source, ingredientRowIndex)
    return `[${ingredientRowIndex}] INGREDIENT${group ? ` (group: ${group})` : ''}: ${text}`
  })
  const stepLines = source.instructions.map((text, stepIndex) => `[${stepIndex}] ${text}`)
  return [
    `Reviewer contract version: ${MAPPING_REVIEWER_CONTRACT_VERSION}`,
    `Prompt version: ${COOKING_MODE_MAPPING_REVIEWER_PROMPT_VERSION}`,
    `Recipe ID: ${source.recipeId}`,
    `Recipe revision: ${recipeRevision}`,
    `Required coverage: ${JSON.stringify(coverage)}`,
    '',
    'INGREDIENT ROWS',
    ...ingredientLines,
    '',
    'INSTRUCTION STEPS',
    ...stepLines,
    '',
    'Return the exact version, revision, coverage object, and acceptedRelationships array.',
  ].join('\n')
}

function relationshipKey(value: MappingReviewerRelationshipV1): string {
  return `${value.ingredientRowIndex}:${value.stepIndex}`
}

export function normalizeMappingReviewerRelationships(
  relationships: readonly MappingReviewerRelationshipV1[],
): MappingReviewerRelationshipV1[] {
  return [...new Map(relationships.map(relationship => [relationshipKey(relationship), {
    ingredientRowIndex: relationship.ingredientRowIndex,
    stepIndex: relationship.stepIndex,
  }])).values()].sort((left, right) =>
    left.ingredientRowIndex - right.ingredientRowIndex || left.stepIndex - right.stepIndex)
}

async function sha256(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto API is required to hash reviewer output')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function canonicalReviewerOutput(value: MappingReviewerResponseV1): string {
  return JSON.stringify({
    reviewerContractVersion: value.reviewerContractVersion,
    promptVersion: value.promptVersion,
    recipeRevision: value.recipeRevision,
    coverage: {
      ingredientRowCount: value.coverage.ingredientRowCount,
      nonHeaderIngredientRowCount: value.coverage.nonHeaderIngredientRowCount,
      stepCount: value.coverage.stepCount,
      reviewedCellCount: value.coverage.reviewedCellCount,
    },
    acceptedRelationships: normalizeMappingReviewerRelationships(value.acceptedRelationships),
  })
}

interface ParsedReviewerOutput {
  parseStatus: 'VALID' | 'INVALID'
  acceptedRelationships: MappingReviewerRelationshipV1[]
  coverage: MappingReviewerCoverageV1 | null
  outputHash: string
  failure: MappingReviewerAttemptFailure | null
  diagnosticCode: string | null
}

export async function parseMappingReviewerOutput(
  value: unknown,
  source: MappingRevisionSource,
  recipeRevision: string,
): Promise<ParsedReviewerOutput> {
  let decoded = value
  let raw = typeof value === 'string' ? value : JSON.stringify(value)
  if (typeof value === 'string') {
    try {
      decoded = JSON.parse(value)
    } catch {
      return {
        parseStatus: 'INVALID', acceptedRelationships: [], coverage: null,
        outputHash: await sha256(value), failure: 'PARSE_FAILURE', diagnosticCode: 'INVALID_JSON',
      }
    }
  }
  const parsed = MAPPING_REVIEWER_RESPONSE_SCHEMA.safeParse(decoded)
  if (!parsed.success) {
    return {
      parseStatus: 'INVALID', acceptedRelationships: [], coverage: null,
      outputHash: await sha256(raw ?? ''), failure: 'SCHEMA_FAILURE', diagnosticCode: 'INVALID_SCHEMA',
    }
  }

  const normalized = normalizeMappingReviewerRelationships(parsed.data.acceptedRelationships)
  const canonical = canonicalReviewerOutput({ ...parsed.data, acceptedRelationships: normalized })
  const outputHash = await sha256(canonical)
  const coverage = expectedCoverage(source)
  if (parsed.data.recipeRevision !== recipeRevision) {
    return { parseStatus: 'INVALID', acceptedRelationships: normalized, coverage: parsed.data.coverage,
      outputHash, failure: 'PARSE_FAILURE', diagnosticCode: 'REVISION_MISMATCH' }
  }
  if (JSON.stringify(parsed.data.coverage) !== JSON.stringify(coverage)) {
    return { parseStatus: 'INVALID', acceptedRelationships: normalized, coverage: parsed.data.coverage,
      outputHash, failure: 'MISSING_REQUIRED_OUTPUT', diagnosticCode: 'INCOMPLETE_COVERAGE' }
  }
  const structurallyInvalid = normalized.some(relationship =>
    relationship.ingredientRowIndex < 0 || relationship.ingredientRowIndex >= source.ingredients.length ||
    relationship.stepIndex < 0 || relationship.stepIndex >= source.instructions.length ||
    isIngredientSubheader(source.ingredients[relationship.ingredientRowIndex] ?? ''))
  if (structurallyInvalid) {
    return { parseStatus: 'INVALID', acceptedRelationships: normalized, coverage: parsed.data.coverage,
      outputHash, failure: 'PARSE_FAILURE', diagnosticCode: 'INVALID_RELATIONSHIP_INDEX' }
  }
  return {
    parseStatus: 'VALID', acceptedRelationships: normalized, coverage: parsed.data.coverage,
    outputHash, failure: null, diagnosticCode: null,
  }
}

type ReviewerGenerator = typeof generateAIObject

export interface MappingReviewerExecutionInput {
  reviewerSlot: 'A' | 'B'
  recipeId: string
  source: MappingRevisionSource
  userId?: string
  maxAttempts?: number
  timeoutMs?: number
  generate?: ReviewerGenerator
  now?: () => string
  idFactory?: (kind: 'run' | 'attempt', slot: 'A' | 'B', attempt: number) => string
}

function defaultIdFactory(kind: 'run' | 'attempt', slot: 'A' | 'B', attempt: number): string {
  return `${kind}-${slot.toLowerCase()}-${attempt}-${globalThis.crypto.randomUUID()}`
}

function classifyExecutionFailure(error: unknown): {
  parseStatus: 'INVALID' | 'NO_RESULT'
  failure: MappingReviewerAttemptFailure
  diagnosticCode: string
  rawText: string | null
} {
  const candidate = error as { name?: string; text?: unknown; message?: unknown }
  const timeout = candidate?.name === 'AbortError' || candidate?.name === 'TimeoutError' ||
    (typeof candidate?.message === 'string' && /timeout|timed out/i.test(candidate.message))
  if (timeout) return { parseStatus: 'NO_RESULT', failure: 'TIMEOUT', diagnosticCode: 'TIMEOUT', rawText: null }
  if (typeof candidate?.text === 'string') {
    return { parseStatus: 'INVALID', failure: 'SCHEMA_FAILURE', diagnosticCode: 'PROVIDER_SCHEMA_FAILURE', rawText: candidate.text }
  }
  return { parseStatus: 'NO_RESULT', failure: 'AI_EXECUTION_FAILURE', diagnosticCode: 'AI_EXECUTION_FAILURE', rawText: null }
}

export async function executeMappingReviewer(
  input: MappingReviewerExecutionInput,
): Promise<MappingReviewerExecutionResultV1> {
  if (input.recipeId !== input.source.recipeId) throw new Error('reviewer recipeId/source mismatch')
  const source = sourceSnapshot(input.source)
  assertBoundedReviewerSource(source)
  const recipeRevision = await computeMappingRecipeRevision(source)
  const prompt = buildMappingReviewerPrompt(source, recipeRevision)
  const generate = input.generate ?? generateAIObject
  const now = input.now ?? (() => new Date().toISOString())
  const idFactory = input.idFactory ?? defaultIdFactory
  const maxAttempts = input.maxAttempts ?? MAPPING_REVIEWER_MAX_ATTEMPTS
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new Error('mapping reviewer maxAttempts must be 1..3')
  }
  const attempts: MappingReviewerAttemptV1[] = []
  let finalRelationships: MappingReviewerRelationshipV1[] = []
  let finalCoverage: MappingReviewerCoverageV1 | null = null
  let finalHash: string | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const runId = idFactory('run', input.reviewerSlot, attempt)
    const attemptId = idFactory('attempt', input.reviewerSlot, attempt)
    const startedAt = now()
    console.info('[cooking-mapping-reviewer]', { event: 'started', reviewerSlot: input.reviewerSlot, attempt, runId })
    try {
      const output = await generate({
        feature: `cooking-mode-mapping-reviewer-${input.reviewerSlot.toLowerCase()}`,
        ...(input.userId ? { userId: input.userId } : {}),
        promptVersion: COOKING_MODE_MAPPING_REVIEWER_PROMPT_VERSION,
        system: MAPPING_REVIEWER_SYSTEM_PROMPT,
        prompt,
        schema: MAPPING_REVIEWER_RESPONSE_SCHEMA,
        temperature: COOKING_MODE_MAPPING_REVIEWER_TEMPERATURE,
        timeout: input.timeoutMs ?? MAPPING_REVIEWER_DEFAULT_TIMEOUT_MS,
        maxRetries: 0,
      })
      const parsed = await parseMappingReviewerOutput(output, source, recipeRevision)
      const completedAt = now()
      finalRelationships = parsed.acceptedRelationships
      finalCoverage = parsed.coverage
      finalHash = parsed.outputHash
      attempts.push({ reviewerSlot: input.reviewerSlot, runId, attemptId, attempt, startedAt, completedAt,
        parseStatus: parsed.parseStatus, outputHash: parsed.outputHash, failure: parsed.failure,
        diagnosticCode: parsed.diagnosticCode })
      if (parsed.parseStatus === 'VALID') {
        console.info('[cooking-mapping-reviewer]', { event: 'completed', reviewerSlot: input.reviewerSlot,
          attempt, runId, candidateCount: parsed.acceptedRelationships.length })
        return {
          reviewerSlot: input.reviewerSlot,
          reviewerContractVersion: MAPPING_REVIEWER_CONTRACT_VERSION,
          promptVersion: COOKING_MODE_MAPPING_REVIEWER_PROMPT_VERSION,
          modelId: AI_MODEL,
          recipeRevision,
          parseStatus: 'VALID',
          acceptedRelationships: parsed.acceptedRelationships,
          coverage: parsed.coverage,
          normalizedOutputHash: parsed.outputHash,
          completedAt,
          runId,
          attemptId,
          attempt,
          attempts,
        }
      }
      console.warn('[cooking-mapping-reviewer]', { event: 'failed', reviewerSlot: input.reviewerSlot,
        attempt, runId, code: parsed.diagnosticCode })
    } catch (error) {
      const failure = classifyExecutionFailure(error)
      const completedAt = now()
      const outputHash = failure.rawText === null ? null : await sha256(failure.rawText)
      finalHash = outputHash
      attempts.push({ reviewerSlot: input.reviewerSlot, runId, attemptId, attempt, startedAt, completedAt,
        parseStatus: failure.parseStatus, outputHash, failure: failure.failure, diagnosticCode: failure.diagnosticCode })
      console.warn('[cooking-mapping-reviewer]', { event: 'failed', reviewerSlot: input.reviewerSlot,
        attempt, runId, code: failure.diagnosticCode })
    }
  }

  const last = attempts.at(-1)!
  return {
    reviewerSlot: input.reviewerSlot,
    reviewerContractVersion: MAPPING_REVIEWER_CONTRACT_VERSION,
    promptVersion: COOKING_MODE_MAPPING_REVIEWER_PROMPT_VERSION,
    modelId: AI_MODEL,
    recipeRevision,
    parseStatus: last.parseStatus,
    acceptedRelationships: finalRelationships,
    coverage: finalCoverage,
    normalizedOutputHash: finalHash,
    completedAt: last.completedAt,
    runId: last.runId,
    attemptId: last.attemptId,
    attempt: last.attempt,
    attempts,
  }
}

export interface MappingReviewerOrchestrationInput extends Omit<MappingReviewerExecutionInput, 'reviewerSlot'> {}

export async function executeBlindMappingReviewers(
  input: MappingReviewerOrchestrationInput,
): Promise<MappingBlindReviewResultV1> {
  if (input.recipeId !== input.source.recipeId) throw new Error('reviewer orchestration recipeId/source mismatch')
  const source = sourceSnapshot(input.source)
  const recipeRevision = await computeMappingRecipeRevision(source)
  const common = { ...input, source }
  const [reviewerA, reviewerB] = await Promise.all([
    executeMappingReviewer({ ...common, reviewerSlot: 'A' }),
    executeMappingReviewer({ ...common, reviewerSlot: 'B' }),
  ])
  return { recipeId: input.recipeId, recipeRevision, source, reviewerA, reviewerB }
}
