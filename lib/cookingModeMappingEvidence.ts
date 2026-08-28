import {
  MAPPING_EVIDENCE_CONTRACT_VERSION,
  MAPPING_EVIDENCE_TAG_ORDER,
  MAPPING_POSITIVE_EVIDENCE_ORDER,
  MAPPING_RISK_EVIDENCE_ORDER,
} from '@/types/cookingModeMapping'
import type {
  MappingDeterministicEvidenceObservationsV1,
  MappingDeterministicEvidenceV1,
  MappingEvidenceInput,
  MappingEvidenceTag,
  MappingPositiveEvidence,
  MappingRiskEvidence,
} from '@/types/cookingModeMapping'

export const FROZEN_V10B_SOURCE_EXTRACTOR_SHA256 =
  '423b0934c1e7f2f6ba3a224b43e0c9343ce58508d50ee549c97861f40abeacad' as const

export const MAPPING_V1_EVIDENCE_EXTRACTOR_FINGERPRINT =
  `cooking-routing-evidence-v1:v10b-source-risk:sha256:${FROZEN_V10B_SOURCE_EXTRACTOR_SHA256}` as const

function canonicalValues<T extends string>(values: readonly T[], order: readonly T[]): T[] {
  const unique = new Set(values)
  return order.filter(value => unique.has(value))
}

function canonicalIndexes(values: readonly number[]): number[] {
  return [...new Set(values.filter(Number.isInteger))].sort((left, right) => left - right)
}

function canonicalLabels(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

const EMPTY_OBSERVATIONS: MappingDeterministicEvidenceObservationsV1 = {
  explicitlyNamed: false,
  ingredientGroup: null,
  duplicateSiblingIndexes: [],
  priorMentionStepIndexes: [],
  laterMentionStepIndexes: [],
  priorReviewerUseStepIndexes: [],
  listedQuantity: null,
  currentStepQuantity: null,
  componentLabels: [],
  componentEstablishedAtStep: null,
  remainingLanguage: false,
}

export function deriveMappingV1Evidence(input: MappingEvidenceInput): MappingDeterministicEvidenceV1 {
  const supportedFingerprint = input.extractorFingerprint === FROZEN_V10B_SOURCE_EXTRACTOR_SHA256
  const facts = input.frozenRiskFacts
  const status = input.status === 'COMPLETE' && (!supportedFingerprint || !facts) ? 'INVALID' : input.status
  const risks: MappingRiskEvidence[] = []

  if (status === 'COMPLETE' && facts) {
    if (facts.componentContext.possibleConstituent) risks.push('COMPONENT_CONTAINMENT_RISK')
    if (facts.lifecycleRisk) risks.push('LIFECYCLE_RISK')
    if (facts.contextualMentionRisk) risks.push('CONTEXT_ONLY_RISK')
    if (facts.processMaterialRisk) risks.push('PROCESS_MATERIAL_RISK')
    if (facts.duplicateRowRisk) risks.push('DUPLICATE_ROW_RISK')
    if (facts.groupConflictRisk) risks.push('GROUP_CONFLICT_RISK')
    if (facts.quantityConflictRisk) risks.push('QUANTITY_CONFLICT_RISK')
    if (facts.collectiveReferenceRisk) risks.push('COLLECTIVE_REFERENCE_RISK')
    if (facts.partialIdentityMatchRisk) risks.push('PARTIAL_IDENTITY_MATCH_RISK')
  }

  const observations = status === 'COMPLETE' && facts ? {
    explicitlyNamed: facts.isExplicitlyNamedInInstruction,
    ingredientGroup: facts.ingredientGroup ?? null,
    duplicateSiblingIndexes: canonicalIndexes(facts.duplicateSiblingIndexes),
    priorMentionStepIndexes: canonicalIndexes(facts.priorInstructionMentions),
    laterMentionStepIndexes: canonicalIndexes(facts.laterInstructionMentions),
    priorReviewerUseStepIndexes: canonicalIndexes(facts.priorReviewerUses.map(use => use.instructionIndex)),
    listedQuantity: facts.quantityEvidence.listedQuantity ?? null,
    currentStepQuantity: facts.quantityEvidence.currentInstructionQuantity ?? null,
    componentLabels: canonicalLabels(facts.componentContext.componentLabels),
    componentEstablishedAtStep: facts.componentContext.establishedInstructionIndex ?? null,
    remainingLanguage: facts.remainingLanguage,
  } : { ...EMPTY_OBSERVATIONS }

  return {
    contractVersion: MAPPING_EVIDENCE_CONTRACT_VERSION,
    extractorFingerprint: MAPPING_V1_EVIDENCE_EXTRACTOR_FINGERPRINT,
    status,
    positive: canonicalValues<MappingPositiveEvidence>(input.positive ?? [], MAPPING_POSITIVE_EVIDENCE_ORDER),
    risks: canonicalValues<MappingRiskEvidence>(risks, MAPPING_RISK_EVIDENCE_ORDER),
    tags: canonicalValues<MappingEvidenceTag>(input.tags ?? [], MAPPING_EVIDENCE_TAG_ORDER),
    observations,
  }
}
