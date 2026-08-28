import {
  computeMappingCandidateId,
  computeMappingProposalId,
} from '@/lib/cookingModeMappingIdentity'
import { deriveMappingV1Evidence, FROZEN_V10B_SOURCE_EXTRACTOR_SHA256 } from '@/lib/cookingModeMappingEvidence'
import { extractMappingV1RiskFacts, mappingIngredientGroup } from '@/lib/cookingModeMappingRiskFacts'
import { routeMappingCandidate } from '@/lib/cookingModeMappingRouter'
import { computeCookingMappingSourceHash } from '@/lib/cookingStepMapping'
import {
  MAPPING_EVIDENCE_CONTRACT_VERSION,
  MAPPING_PROPOSAL_BLOCKING_REASON_VALUES,
  MAPPING_REVIEWER_CONTRACT_VERSION,
  MAPPING_ROUTING_CONTRACT_VERSION,
} from '@/types/cookingModeMapping'
import type {
  MappingCandidateV1,
  MappingEvidenceInput,
  MappingProposalBlockingReason,
  MappingProposalV1,
  MappingReviewerExecutionResultV1,
  MappingReviewerRelationshipV1,
  MappingReviewerVoteV1,
  MappingRevisionSource,
  MappingStructuralValidation,
} from '@/types/cookingModeMapping'
import { validateMappingCandidateStructure } from '@/lib/cookingModeMappingIdentity'
import { COOKING_MODE_MAPPING_REVIEWER_PROMPT_VERSION } from '@/lib/aiConfig'

function relationshipKey(value: MappingReviewerRelationshipV1): string {
  return `${value.ingredientRowIndex}:${value.stepIndex}`
}

function acceptedKeys(result: MappingReviewerExecutionResultV1): Set<string> {
  return new Set(result.acceptedRelationships.map(relationshipKey))
}

function reviewerComplete(result: MappingReviewerExecutionResultV1, sourceRevision: string): boolean {
  return result.parseStatus === 'VALID' &&
    result.recipeRevision === sourceRevision &&
    result.reviewerContractVersion === MAPPING_REVIEWER_CONTRACT_VERSION &&
    result.promptVersion === COOKING_MODE_MAPPING_REVIEWER_PROMPT_VERSION &&
    result.completedAt !== null &&
    result.normalizedOutputHash !== null
}

function reviewerVote(
  result: MappingReviewerExecutionResultV1,
  relationship: MappingReviewerRelationshipV1,
  sourceRevision: string,
): MappingReviewerVoteV1 {
  const complete = reviewerComplete(result, sourceRevision)
  return {
    reviewerSlot: result.reviewerSlot,
    vote: complete
      ? (acceptedKeys(result).has(relationshipKey(relationship)) ? 'ACCEPT' : 'REJECT')
      : (result.parseStatus === 'INVALID' ? 'UNPARSEABLE' : 'MISSING'),
    reviewerContractVersion: result.reviewerContractVersion,
    promptVersion: result.promptVersion,
    modelId: result.modelId,
    runId: result.runId,
    attemptId: result.attemptId,
    completedAt: result.completedAt,
    parseStatus: result.parseStatus,
    normalizedOutputHash: result.normalizedOutputHash,
    confidence: null,
    sourceEvidence: null,
  }
}

function canonicalBlockingReasons(reasons: Iterable<MappingProposalBlockingReason>): MappingProposalBlockingReason[] {
  const values = new Set(reasons)
  return MAPPING_PROPOSAL_BLOCKING_REASON_VALUES.filter(reason => values.has(reason))
}

export interface MappingProposalEvidenceContext {
  source: MappingRevisionSource
  relationship: MappingReviewerRelationshipV1
  reviewerA: MappingReviewerExecutionResultV1
  reviewerB: MappingReviewerExecutionResultV1
}

export type MappingProposalEvidenceResolver = (
  context: MappingProposalEvidenceContext,
) => MappingEvidenceInput | Promise<MappingEvidenceInput>

function defaultEvidenceResolver(context: MappingProposalEvidenceContext): MappingEvidenceInput {
  const facts = extractMappingV1RiskFacts({
    source: context.source,
    ingredientRowIndex: context.relationship.ingredientRowIndex,
    stepIndex: context.relationship.stepIndex,
    reviewerAAccepts: context.reviewerA.acceptedRelationships,
    reviewerBAccepts: context.reviewerB.acceptedRelationships,
  })
  return {
    status: 'COMPLETE',
    extractorFingerprint: FROZEN_V10B_SOURCE_EXTRACTOR_SHA256,
    frozenRiskFacts: facts,
    ...(facts.isExplicitlyNamedInInstruction ? { positive: ['DIRECT_EXPLICIT_USE'] } : {}),
  }
}

export interface BuildMappingProposalInput {
  recipeId: string
  source: MappingRevisionSource
  recipeRevision: string
  reviewerA: MappingReviewerExecutionResultV1
  reviewerB: MappingReviewerExecutionResultV1
  createdAt: string
  sourceIdentityMismatch?: boolean
  evidenceResolver?: MappingProposalEvidenceResolver
}

export async function buildMappingProposal(input: BuildMappingProposalInput): Promise<MappingProposalV1> {
  const mappingSourceHash = await computeCookingMappingSourceHash(input.source.ingredients, input.source.instructions)
  const expectedRevision = `${input.source.parserVersion}:sha256:${mappingSourceHash}`
  const sourceIdentityMismatch = Boolean(input.sourceIdentityMismatch) ||
    input.recipeId !== input.source.recipeId || input.recipeRevision !== expectedRevision ||
    input.reviewerA.recipeRevision !== expectedRevision || input.reviewerB.recipeRevision !== expectedRevision
  const proposalId = await computeMappingProposalId({ recipeId: input.recipeId, recipeRevision: expectedRevision })
  const reviewerAKeys = acceptedKeys(input.reviewerA)
  const reviewerBKeys = acceptedKeys(input.reviewerB)
  const union = new Map<string, MappingReviewerRelationshipV1>()
  for (const relationship of [...input.reviewerA.acceptedRelationships, ...input.reviewerB.acceptedRelationships]) {
    union.set(relationshipKey(relationship), {
      ingredientRowIndex: relationship.ingredientRowIndex,
      stepIndex: relationship.stepIndex,
    })
  }
  const relationships = [...union.values()].sort((left, right) =>
    left.ingredientRowIndex - right.ingredientRowIndex || left.stepIndex - right.stepIndex)
  const candidates: MappingCandidateV1[] = []
  const structuralCandidates: Parameters<typeof validateMappingCandidateStructure>[0][] = []
  let evidenceFailure = false

  for (const relationship of relationships) {
    const candidateId = await computeMappingCandidateId({
      recipeId: input.recipeId,
      recipeRevision: expectedRevision,
      ingredientRowIndex: relationship.ingredientRowIndex,
      stepIndex: relationship.stepIndex,
    })
    const structuralCandidate = {
      candidateId,
      recipeId: input.recipeId,
      recipeRevision: expectedRevision,
      parserVersion: input.source.parserVersion,
      mappingSourceHash,
      ingredientRowIndex: relationship.ingredientRowIndex,
      ingredientText: input.source.ingredients[relationship.ingredientRowIndex] ?? '',
      stepIndex: relationship.stepIndex,
      stepText: input.source.instructions[relationship.stepIndex] ?? '',
    }
    const structuralValidation: MappingStructuralValidation = await validateMappingCandidateStructure(
      structuralCandidate,
      input.source,
      structuralCandidates,
    )
    structuralCandidates.push(structuralCandidate)
    let evidenceInput: MappingEvidenceInput
    try {
      evidenceInput = await (input.evidenceResolver ?? defaultEvidenceResolver)({
        source: input.source,
        relationship,
        reviewerA: input.reviewerA,
        reviewerB: input.reviewerB,
      })
    } catch {
      evidenceFailure = true
      evidenceInput = {
        status: 'UNAVAILABLE',
        extractorFingerprint: FROZEN_V10B_SOURCE_EXTRACTOR_SHA256,
        frozenRiskFacts: null,
      }
    }
    const deterministicEvidence = deriveMappingV1Evidence(evidenceInput)
    if (structuralValidation.valid && deterministicEvidence.status !== 'COMPLETE') evidenceFailure = true
    const voteA = reviewerVote(input.reviewerA, relationship, expectedRevision)
    const voteB = reviewerVote(input.reviewerB, relationship, expectedRevision)
    const route = routeMappingCandidate({
      candidateType: 'INGREDIENT_STEP_RELATIONSHIP',
      reviewerA: voteA,
      reviewerB: voteB,
      deterministicEvidence,
      structuralValidation,
    })
    candidates.push({
      schemaVersion: 1,
      candidateType: 'INGREDIENT_STEP_RELATIONSHIP',
      candidateId,
      proposalId,
      recipeId: input.recipeId,
      recipeRevision: expectedRevision,
      parserVersion: input.source.parserVersion,
      mappingSourceHash,
      ingredientRowIndex: relationship.ingredientRowIndex,
      ingredientText: structuralCandidate.ingredientText,
      ingredientGroup: Number.isInteger(relationship.ingredientRowIndex) && relationship.ingredientRowIndex >= 0
        ? mappingIngredientGroup(input.source, relationship.ingredientRowIndex)
        : null,
      stepIndex: relationship.stepIndex,
      stepText: structuralCandidate.stepText,
      reviewerA: voteA,
      reviewerB: voteB,
      deterministicEvidence,
      ...route,
      provenance: {
        routingContractVersion: MAPPING_ROUTING_CONTRACT_VERSION,
        evidenceContractVersion: MAPPING_EVIDENCE_CONTRACT_VERSION,
        reviewerContractVersion: MAPPING_REVIEWER_CONTRACT_VERSION,
        candidateOrigin: 'REVIEWER_UNION',
        acceptedByReviewerSlots: (['A', 'B'] as const).filter(slot =>
          (slot === 'A' ? reviewerAKeys : reviewerBKeys).has(relationshipKey(relationship))),
      },
      createdAt: input.createdAt,
    })
  }

  const summary = {
    candidateCount: candidates.length,
    autoAcceptCount: candidates.filter(candidate => candidate.routingDecision === 'AUTO_ACCEPT').length,
    reviewRequiredCount: candidates.filter(candidate => candidate.routingDecision === 'REVIEW_REQUIRED').length,
    autoRejectCount: candidates.filter(candidate => candidate.routingDecision === 'AUTO_REJECT').length,
  }
  const blockingReasons = new Set<MappingProposalBlockingReason>()
  if (!reviewerComplete(input.reviewerA, expectedRevision)) blockingReasons.add('REVIEWER_A_INCOMPLETE')
  if (!reviewerComplete(input.reviewerB, expectedRevision)) blockingReasons.add('REVIEWER_B_INCOMPLETE')
  if (candidates.some(candidate => candidate.routingDecision === 'REVIEW_REQUIRED')) {
    blockingReasons.add('CANDIDATE_REVIEW_REQUIRED')
  }
  if (candidates.some(candidate => candidate.routingDecision === 'AUTO_REJECT')) {
    blockingReasons.add('STRUCTURAL_INVALIDITY')
  }
  if (evidenceFailure) blockingReasons.add('DETERMINISTIC_EVIDENCE_FAILURE')
  if (sourceIdentityMismatch) blockingReasons.add('SOURCE_IDENTITY_MISMATCH')
  const orderedBlockingReasons = canonicalBlockingReasons(blockingReasons)
  const approvalBlocked = orderedBlockingReasons.length > 0

  return {
    schemaVersion: 1,
    proposalId,
    recipeId: input.recipeId,
    recipeRevision: expectedRevision,
    parserVersion: input.source.parserVersion,
    mappingSourceHash,
    reviewerContractVersion: MAPPING_REVIEWER_CONTRACT_VERSION,
    evidenceContractVersion: MAPPING_EVIDENCE_CONTRACT_VERSION,
    routingContractVersion: MAPPING_ROUTING_CONTRACT_VERSION,
    reviewerA: input.reviewerA,
    reviewerB: input.reviewerB,
    candidates,
    summary,
    approvalBlocked,
    blockingReasons: orderedBlockingReasons,
    reviewCompleteWithoutHuman: !approvalBlocked && candidates.every(candidate => candidate.routingDecision === 'AUTO_ACCEPT'),
    createdAt: input.createdAt,
  }
}
