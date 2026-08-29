import {
  MAPPING_EVIDENCE_CONTRACT_VERSION,
  MAPPING_EVIDENCE_TAG_ORDER,
  MAPPING_POSITIVE_EVIDENCE_ORDER,
  MAPPING_RISK_EVIDENCE_ORDER,
  MAPPING_ROUTING_REASON_ORDER,
} from '@/types/cookingModeMapping'
import type {
  MappingCandidateV1,
  MappingReviewerVoteV1,
  MappingRoutingInput,
  MappingRoutingReason,
  MappingRoutingResult,
} from '@/types/cookingModeMapping'
import { MAPPING_V1_EVIDENCE_EXTRACTOR_FINGERPRINT } from '@/lib/cookingModeMappingEvidence'

function canonicalReasons(reasons: Iterable<MappingRoutingReason>): MappingRoutingReason[] {
  const values = new Set(reasons)
  return MAPPING_ROUTING_REASON_ORDER.filter(reason => values.has(reason))
}

function isCompleteReviewer(vote: MappingReviewerVoteV1, slot: 'A' | 'B'): boolean {
  return vote.reviewerSlot === slot &&
    (vote.vote === 'ACCEPT' || vote.vote === 'REJECT') &&
    vote.parseStatus === 'VALID' &&
    vote.completedAt !== null &&
    vote.normalizedOutputHash !== null
}

function reviewRequired(reasons: Iterable<MappingRoutingReason>, blocked = false): MappingRoutingResult {
  return {
    routingDecision: 'REVIEW_REQUIRED',
    routingReasons: canonicalReasons(reasons),
    reviewStatus: blocked ? 'BLOCKED' : 'PENDING',
    finalDecision: null,
    decisionSource: null,
  }
}

function canonicalReviewerVote(vote: MappingReviewerVoteV1 | null) {
  if (!vote) return null
  return {
    reviewerSlot: vote.reviewerSlot,
    vote: vote.vote,
    reviewerContractVersion: vote.reviewerContractVersion,
    promptVersion: vote.promptVersion,
    modelId: vote.modelId,
    runId: vote.runId,
    attemptId: vote.attemptId,
    completedAt: vote.completedAt,
    parseStatus: vote.parseStatus,
    normalizedOutputHash: vote.normalizedOutputHash,
    confidence: vote.confidence,
    sourceEvidence: vote.sourceEvidence,
  }
}

export function routeMappingCandidate(input: MappingRoutingInput): MappingRoutingResult {
  if (!input.structuralValidation.valid) {
    return {
      routingDecision: 'AUTO_REJECT',
      routingReasons: canonicalReasons(input.structuralValidation.reasons),
      reviewStatus: 'NOT_REQUIRED',
      finalDecision: 'REJECT',
      decisionSource: 'AUTO',
    }
  }

  const reviewerAComplete = isCompleteReviewer(input.reviewerA, 'A')
  const reviewerBComplete = isCompleteReviewer(input.reviewerB, 'B')
  const sameReviewerContract = input.reviewerA.reviewerContractVersion === input.reviewerB.reviewerContractVersion &&
    input.reviewerA.promptVersion === input.reviewerB.promptVersion
  const evidenceComplete = input.deterministicEvidence.status === 'COMPLETE' &&
    input.deterministicEvidence.contractVersion === MAPPING_EVIDENCE_CONTRACT_VERSION &&
    input.deterministicEvidence.extractorFingerprint === MAPPING_V1_EVIDENCE_EXTRACTOR_FINGERPRINT

  const blockingReasons = new Set<MappingRoutingReason>()
  if (!reviewerAComplete || !reviewerBComplete || !sameReviewerContract) {
    blockingReasons.add('REVIEWER_RESULT_INCOMPLETE')
  }
  if (!evidenceComplete) blockingReasons.add('DETERMINISTIC_EVIDENCE_UNAVAILABLE')
  if (blockingReasons.size > 0) return reviewRequired(blockingReasons, true)

  const reviewReasons = new Set<MappingRoutingReason>()
  if (input.candidateType !== 'INGREDIENT_STEP_RELATIONSHIP') {
    reviewReasons.add('UNSUPPORTED_RELATIONSHIP_CLASS')
  }
  if (input.deterministicEvidence.risks.length > 0) {
    reviewReasons.add('DETERMINISTIC_RISK_PRESENT')
  }
  if (reviewReasons.size > 0) return reviewRequired(reviewReasons)

  const bothAccept = input.reviewerA.vote === 'ACCEPT' && input.reviewerB.vote === 'ACCEPT'
  if (bothAccept) {
    return {
      routingDecision: 'AUTO_ACCEPT',
      routingReasons: ['AUTO_ACCEPT_BOTH_REVIEWERS_NO_V1_RISK'],
      reviewStatus: 'NOT_REQUIRED',
      finalDecision: 'ACCEPT',
      decisionSource: 'AUTO',
    }
  }

  if (input.reviewerA.vote !== input.reviewerB.vote) {
    reviewReasons.add('REVIEWER_DISAGREEMENT')
  } else if (
    input.reviewerA.vote === 'REJECT' &&
    input.deterministicEvidence.positive.length > 0
  ) {
    reviewReasons.add('BOTH_REJECT_WITH_POSITIVE_EVIDENCE')
  } else {
    // A materialized candidate with two complete REJECT votes is outside the
    // reviewer-union invariant and cannot be approved or semantically rejected.
    reviewReasons.add('REVIEWER_RESULT_INCOMPLETE')
  }

  return reviewRequired(reviewReasons)
}

export function serializeMappingCandidateV1(candidate: MappingCandidateV1): string {
  const positive = new Set(candidate.deterministicEvidence.positive)
  const risks = new Set(candidate.deterministicEvidence.risks)
  const tags = new Set(candidate.deterministicEvidence.tags)
  const reasons = new Set(candidate.routingReasons)
  return JSON.stringify({
    schemaVersion: candidate.schemaVersion,
    candidateType: candidate.candidateType,
    candidateId: candidate.candidateId,
    proposalId: candidate.proposalId,
    recipeId: candidate.recipeId,
    recipeRevision: candidate.recipeRevision,
    parserVersion: candidate.parserVersion,
    mappingSourceHash: candidate.mappingSourceHash,
    ingredientRowIndex: candidate.ingredientRowIndex,
    ingredientText: candidate.ingredientText,
    ingredientGroup: candidate.ingredientGroup,
    stepIndex: candidate.stepIndex,
    stepText: candidate.stepText,
    reviewerA: canonicalReviewerVote(candidate.reviewerA),
    reviewerB: canonicalReviewerVote(candidate.reviewerB),
    deterministicEvidence: {
      contractVersion: candidate.deterministicEvidence.contractVersion,
      extractorFingerprint: candidate.deterministicEvidence.extractorFingerprint,
      status: candidate.deterministicEvidence.status,
      positive: MAPPING_POSITIVE_EVIDENCE_ORDER.filter(value => positive.has(value)),
      risks: MAPPING_RISK_EVIDENCE_ORDER.filter(value => risks.has(value)),
      tags: MAPPING_EVIDENCE_TAG_ORDER.filter(value => tags.has(value)),
      observations: {
        explicitlyNamed: candidate.deterministicEvidence.observations.explicitlyNamed,
        ingredientGroup: candidate.deterministicEvidence.observations.ingredientGroup,
        duplicateSiblingIndexes: [...new Set(candidate.deterministicEvidence.observations.duplicateSiblingIndexes)].sort((left, right) => left - right),
        priorMentionStepIndexes: [...new Set(candidate.deterministicEvidence.observations.priorMentionStepIndexes)].sort((left, right) => left - right),
        laterMentionStepIndexes: [...new Set(candidate.deterministicEvidence.observations.laterMentionStepIndexes)].sort((left, right) => left - right),
        priorReviewerUseStepIndexes: [...new Set(candidate.deterministicEvidence.observations.priorReviewerUseStepIndexes)].sort((left, right) => left - right),
        listedQuantity: candidate.deterministicEvidence.observations.listedQuantity,
        currentStepQuantity: candidate.deterministicEvidence.observations.currentStepQuantity,
        componentLabels: [...new Set(candidate.deterministicEvidence.observations.componentLabels)].sort((left, right) => left.localeCompare(right)),
        componentEstablishedAtStep: candidate.deterministicEvidence.observations.componentEstablishedAtStep,
        remainingLanguage: candidate.deterministicEvidence.observations.remainingLanguage,
      },
    },
    routingDecision: candidate.routingDecision,
    routingReasons: MAPPING_ROUTING_REASON_ORDER.filter(reason => reasons.has(reason)),
    reviewStatus: candidate.reviewStatus,
    finalDecision: candidate.finalDecision,
    decisionSource: candidate.decisionSource,
    provenance: {
      routingContractVersion: candidate.provenance.routingContractVersion,
      evidenceContractVersion: candidate.provenance.evidenceContractVersion,
      reviewerContractVersion: candidate.provenance.reviewerContractVersion,
      candidateOrigin: candidate.provenance.candidateOrigin,
      acceptedByReviewerSlots: (['A', 'B'] as const).filter(slot => candidate.provenance.acceptedByReviewerSlots.includes(slot)),
    },
    createdAt: candidate.createdAt,
  })
}
