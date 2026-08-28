export const MAPPING_ROUTING_CONTRACT_VERSION = 'cooking-review-routing-v1' as const
export const MAPPING_EVIDENCE_CONTRACT_VERSION = 'cooking-routing-evidence-v1' as const

export const MAPPING_REVIEWER_VOTE_VALUES = [
  'ACCEPT',
  'REJECT',
  'UNPARSEABLE',
  'MISSING',
] as const

export type MappingReviewerVoteValue = (typeof MAPPING_REVIEWER_VOTE_VALUES)[number]

export const MAPPING_REVIEWER_PARSE_STATUSES = ['VALID', 'INVALID', 'NO_RESULT'] as const
export type MappingReviewerParseStatus = (typeof MAPPING_REVIEWER_PARSE_STATUSES)[number]

export type MappingRoutingDecision = 'AUTO_ACCEPT' | 'REVIEW_REQUIRED' | 'AUTO_REJECT'
export type MappingFinalDecision = 'ACCEPT' | 'REJECT'
export type MappingReviewStatus = 'NOT_REQUIRED' | 'PENDING' | 'DECIDED' | 'BLOCKED'
export type MappingDecisionSource = 'AUTO' | 'HUMAN' | null

export interface MappingReviewerVoteV1 {
  reviewerSlot: 'A' | 'B'
  vote: MappingReviewerVoteValue
  reviewerContractVersion: string
  promptVersion: string
  modelId: string
  runId: string
  attemptId: string
  completedAt: string | null
  parseStatus: MappingReviewerParseStatus
  normalizedOutputHash: string | null
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | null
  sourceEvidence: string | null
}

export const MAPPING_POSITIVE_EVIDENCE_ORDER = [
  'DIRECT_EXPLICIT_USE',
  'DIRECT_ALIAS_SUPPORT',
  'ROW_SCOPED_QUANTITY_MATCH',
  'DETERMINISTIC_V5_SUPPORT',
  'V10G_ACTIVE_OBJECT_RESCUE_SUPPORT',
] as const

export type MappingPositiveEvidence = (typeof MAPPING_POSITIVE_EVIDENCE_ORDER)[number]

export const MAPPING_RISK_EVIDENCE_ORDER = [
  'COMPONENT_CONTAINMENT_RISK',
  'LIFECYCLE_RISK',
  'CONTEXT_ONLY_RISK',
  'PROCESS_MATERIAL_RISK',
  'DUPLICATE_ROW_RISK',
  'GROUP_CONFLICT_RISK',
  'QUANTITY_CONFLICT_RISK',
  'COLLECTIVE_REFERENCE_RISK',
  'PARTIAL_IDENTITY_MATCH_RISK',
] as const

export type MappingRiskEvidence = (typeof MAPPING_RISK_EVIDENCE_ORDER)[number]

export const MAPPING_EVIDENCE_TAG_ORDER = [
  'GENERIC_SEASONING',
  'PASSIVE_COMPONENT_CARRY',
  'ISOLATED_SUBCOMPONENT',
  'AMBIGUOUS_REFERENCE',
  'TRANSFER_OR_ASSEMBLY',
  'SERVING_OR_GARNISH',
  'PREPARED_COMPONENT_RELATED',
  'V10G_FRONTIER_ACCEPT',
  'V10G_FRONTIER_REJECT',
] as const

export type MappingEvidenceTag = (typeof MAPPING_EVIDENCE_TAG_ORDER)[number]
export type MappingDeterministicEvidenceStatus = 'COMPLETE' | 'UNAVAILABLE' | 'INVALID'

export interface MappingDeterministicEvidenceObservationsV1 {
  explicitlyNamed: boolean
  ingredientGroup: string | null
  duplicateSiblingIndexes: number[]
  priorMentionStepIndexes: number[]
  laterMentionStepIndexes: number[]
  priorReviewerUseStepIndexes: number[]
  listedQuantity: string | null
  currentStepQuantity: string | null
  componentLabels: string[]
  componentEstablishedAtStep: number | null
  remainingLanguage: boolean
}

export interface MappingDeterministicEvidenceV1 {
  contractVersion: typeof MAPPING_EVIDENCE_CONTRACT_VERSION
  extractorFingerprint: string
  status: MappingDeterministicEvidenceStatus
  positive: MappingPositiveEvidence[]
  risks: MappingRiskEvidence[]
  tags: MappingEvidenceTag[]
  observations: MappingDeterministicEvidenceObservationsV1
}

export const MAPPING_ROUTING_REASON_ORDER = [
  'AUTO_ACCEPT_BOTH_REVIEWERS_NO_V1_RISK',
  'REVIEWER_DISAGREEMENT',
  'REVIEWER_RESULT_INCOMPLETE',
  'DETERMINISTIC_EVIDENCE_UNAVAILABLE',
  'DETERMINISTIC_RISK_PRESENT',
  'BOTH_REJECT_WITH_POSITIVE_EVIDENCE',
  'UNSUPPORTED_RELATIONSHIP_CLASS',
  'INVALID_RECIPE_REVISION',
  'INVALID_INGREDIENT_INDEX',
  'INGREDIENT_HEADER_INDEX',
  'INVALID_STEP_INDEX',
  'SOURCE_SNAPSHOT_MISMATCH',
  'DUPLICATE_CANDIDATE_IDENTITY',
  'CANDIDATE_ID_COLLISION',
] as const

export type MappingRoutingReason = (typeof MAPPING_ROUTING_REASON_ORDER)[number]

export const MAPPING_STRUCTURAL_REASON_ORDER = [
  'INVALID_RECIPE_REVISION',
  'INVALID_INGREDIENT_INDEX',
  'INGREDIENT_HEADER_INDEX',
  'INVALID_STEP_INDEX',
  'SOURCE_SNAPSHOT_MISMATCH',
  'DUPLICATE_CANDIDATE_IDENTITY',
  'CANDIDATE_ID_COLLISION',
] as const satisfies readonly MappingRoutingReason[]

export type MappingStructuralReason = (typeof MAPPING_STRUCTURAL_REASON_ORDER)[number]

export interface MappingCandidateProvenanceV1 {
  routingContractVersion: typeof MAPPING_ROUTING_CONTRACT_VERSION
  evidenceContractVersion: typeof MAPPING_EVIDENCE_CONTRACT_VERSION
  reviewerContractVersion: string
  candidateOrigin: 'REVIEWER_UNION'
  acceptedByReviewerSlots: Array<'A' | 'B'>
}

export interface MappingCandidateV1 {
  schemaVersion: 1
  candidateType: 'INGREDIENT_STEP_RELATIONSHIP'
  candidateId: string
  proposalId: string
  recipeId: string
  recipeRevision: string
  parserVersion: string
  mappingSourceHash: string
  ingredientRowIndex: number
  ingredientText: string
  ingredientGroup: string | null
  stepIndex: number
  stepText: string
  reviewerA: MappingReviewerVoteV1
  reviewerB: MappingReviewerVoteV1
  deterministicEvidence: MappingDeterministicEvidenceV1
  routingDecision: MappingRoutingDecision
  routingReasons: MappingRoutingReason[]
  reviewStatus: MappingReviewStatus
  finalDecision: MappingFinalDecision | null
  decisionSource: MappingDecisionSource
  provenance: MappingCandidateProvenanceV1
  createdAt: string
}

export interface MappingRevisionSource {
  recipeId: string
  parserVersion: string
  ingredients: string[]
  instructions: string[]
}

export interface MappingCandidateIdentityInput {
  recipeId: string
  recipeRevision: string
  ingredientRowIndex: number
  stepIndex: number
}

export interface MappingCandidateStructuralInput extends MappingCandidateIdentityInput {
  candidateId: string
  parserVersion: string
  mappingSourceHash: string
  ingredientText: string
  stepText: string
}

export interface MappingStructuralValidation {
  valid: boolean
  reasons: MappingStructuralReason[]
}

export interface MappingFrozenV10BRiskFacts {
  isExplicitlyNamedInInstruction: boolean
  ingredientGroup?: string | null
  duplicateSiblingIndexes: number[]
  priorInstructionMentions: number[]
  laterInstructionMentions: number[]
  priorReviewerUses: Array<{ instructionIndex: number; reviewerCount: number }>
  quantityEvidence: {
    listedQuantity?: string
    currentInstructionQuantity?: string
    priorUseQuantity?: string
  }
  componentContext: {
    possibleConstituent: boolean
    componentLabels: string[]
    establishedInstructionIndex?: number
    currentInstructionRefersToComponent: boolean
  }
  remainingLanguage: boolean
  processMaterialRisk: boolean
  contextualMentionRisk: boolean
  duplicateRowRisk: boolean
  groupConflictRisk: boolean
  quantityConflictRisk: boolean
  lifecycleRisk: boolean
  collectiveReferenceRisk: boolean
  partialIdentityMatchRisk: boolean
}

export interface MappingEvidenceInput {
  status: MappingDeterministicEvidenceStatus
  extractorFingerprint: string
  frozenRiskFacts: MappingFrozenV10BRiskFacts | null
  positive?: readonly MappingPositiveEvidence[]
  tags?: readonly MappingEvidenceTag[]
}

export interface MappingRoutingInput {
  candidateType: string
  reviewerA: MappingReviewerVoteV1
  reviewerB: MappingReviewerVoteV1
  deterministicEvidence: MappingDeterministicEvidenceV1
  structuralValidation: MappingStructuralValidation
}

export interface MappingRoutingResult {
  routingDecision: MappingRoutingDecision
  routingReasons: MappingRoutingReason[]
  reviewStatus: MappingReviewStatus
  finalDecision: MappingFinalDecision | null
  decisionSource: MappingDecisionSource
}
