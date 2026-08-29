import 'server-only'

import {
  MAPPING_APPROVED_MAP_ID_PREFIX,
  MAPPING_COMPLETENESS_ATTESTATION_ID_PREFIX,
  MAPPING_REVIEW_DECISION_ID_PREFIX,
} from '@/types/cookingModeMappingPersistence'
import type {
  ApprovedIngredientStepRelationshipV1,
  MappingHumanReviewReason,
} from '@/types/cookingModeMappingPersistence'
import type { MappingCandidateOrigin, MappingFinalDecision, MappingDecisionSource } from '@/types/cookingModeMapping'

async function sha256(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto API is required to hash cooking mapping persistence identities')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

// ── Review-decision identity ────────────────────────────────────────────
//
// Deterministic and idempotent: resubmitting the exact same decision content
// (same candidate, decision, reason, note, actor, and supersession target)
// yields the same `decisionId` and therefore does not append a duplicate
// event. A genuinely different decision (different verdict, reason, note, or
// an explicit supersession) always yields a different id, so a correction
// always appends rather than colliding with the event it supersedes.

export interface MappingReviewDecisionIdentityInput {
  proposalId: string
  candidateId: string
  decision: 'ACCEPT' | 'REJECT'
  reasonCode: MappingHumanReviewReason
  note?: string | null
  decidedBy: string
  supersedesDecisionId?: string | null
}

export function canonicalizeMappingReviewDecisionIdentity(input: MappingReviewDecisionIdentityInput): string {
  return JSON.stringify([
    'mapping-review-decision',
    1,
    input.proposalId,
    input.candidateId,
    input.decision,
    input.reasonCode,
    input.note ?? null,
    input.decidedBy,
    input.supersedesDecisionId ?? null,
  ])
}

export async function computeMappingReviewDecisionId(input: MappingReviewDecisionIdentityInput): Promise<string> {
  return `${MAPPING_REVIEW_DECISION_ID_PREFIX}${await sha256(canonicalizeMappingReviewDecisionIdentity(input))}`
}

// ── Approved-map identity and canonical content hash ────────────────────
//
// `mapHash` covers only identity-relevant, deterministic content: recipe/
// proposal/contract identity and the final accepted-relationship set
// (including, as of Implementation 4B, each relationship's `provenanceClass`
// — see `ApprovedRelationshipProvenanceClass` — so two maps that accept the
// exact same (row,step) set via different provenance, e.g. one via ordinary
// human review vs one via a direct human add, are never conflated as
// identical content). It deliberately excludes:
//   - `mapId`/`mapVersion`/`mapHash` themselves (mapId and mapVersion are
//     derived FROM the hash, so including them would be circular);
//   - `createdAt`/`approvedAt` (server timestamps — two exact-replay writes
//     of the same semantic map must hash identically regardless of when
//     each was written, per Implementation-3 Phase 7);
//   - `provenance` (reviewer run/attempt/output-hash bookkeeping — diagnostic
//     only; see the doc comment on `ApprovedMapProvenanceV1`);
//   - `completenessAttestedAt` (Implementation 4B: also a server timestamp,
//     resolved only after a write — excluded for the exact same reason as
//     `createdAt`/`approvedAt` above. The attestation's *content* identity
//     is already fully captured by the hashed `relationships` set itself:
//     `buildApprovedMapping` requires the attestation's `reviewStateHash` to
//     match that same candidate population before it will ever build, so
//     nothing identity-relevant is lost by excluding the timestamp).
// Relationship order never affects the hash: relationships are deduplicated
// by `candidateId` and sorted by `(stepIndex, ingredientRowIndex, candidateId)`
// before serialization, matching architecture-contract §15.

export interface ApprovedMapHashInput {
  schemaVersion: 1
  recipeId: string
  recipeRevision: string
  parserVersion: string
  mappingSourceHash: string
  proposalId: string
  reviewerContractVersion: string
  evidenceContractVersion: string
  routingContractVersion: string
  status: 'APPROVED'
  approvalMode: 'AUTO' | 'HUMAN_ASSISTED'
  relationships: readonly ApprovedIngredientStepRelationshipV1[]
  preparedComponents: readonly never[]
  approvedBy: string
}

export function canonicalizeApprovedMapRelationships(
  relationships: readonly ApprovedIngredientStepRelationshipV1[],
): ApprovedIngredientStepRelationshipV1[] {
  const byCandidateId = new Map<string, ApprovedIngredientStepRelationshipV1>()
  for (const relationship of relationships) {
    byCandidateId.set(relationship.candidateId, relationship)
  }
  return [...byCandidateId.values()].sort((left, right) =>
    left.stepIndex - right.stepIndex ||
    left.ingredientRowIndex - right.ingredientRowIndex ||
    left.candidateId.localeCompare(right.candidateId))
}

export function canonicalizeApprovedMapContent(input: ApprovedMapHashInput): string {
  const relationships = canonicalizeApprovedMapRelationships(input.relationships)
  return JSON.stringify({
    schemaVersion: input.schemaVersion,
    recipeId: input.recipeId,
    recipeRevision: input.recipeRevision,
    parserVersion: input.parserVersion,
    mappingSourceHash: input.mappingSourceHash,
    proposalId: input.proposalId,
    reviewerContractVersion: input.reviewerContractVersion,
    evidenceContractVersion: input.evidenceContractVersion,
    routingContractVersion: input.routingContractVersion,
    status: input.status,
    approvalMode: input.approvalMode,
    relationships: relationships.map(relationship => ({
      candidateId: relationship.candidateId,
      ingredientRowIndex: relationship.ingredientRowIndex,
      stepIndex: relationship.stepIndex,
      decisionSource: relationship.decisionSource,
      decisionId: relationship.decisionId,
      provenanceClass: relationship.provenanceClass,
    })),
    preparedComponents: [],
    approvedBy: input.approvedBy,
  })
}

export async function computeApprovedMapHash(input: ApprovedMapHashInput): Promise<string> {
  return sha256(canonicalizeApprovedMapContent(input))
}

export function computeApprovedMapId(mapHash: string): string {
  return `${MAPPING_APPROVED_MAP_ID_PREFIX}${mapHash}`
}

export function computeApprovedMapVersion(routingContractVersion: string, mapHash: string): string {
  return `${routingContractVersion}:${mapHash.slice(0, 16)}`
}

/**
 * Projects any full approved-map record (persisted or freshly built) down to
 * exactly the fields `computeApprovedMapHash` reads, explicitly — rather
 * than destructuring-and-discarding `mapId`/`mapVersion`/`mapHash`/
 * `provenance`/timestamps — so callers never need an unused-variable escape
 * hatch to recompute/verify a hash from a full record.
 */
export function toApprovedMapHashInput(map: {
  schemaVersion: 1
  recipeId: string
  recipeRevision: string
  parserVersion: string
  mappingSourceHash: string
  proposalId: string
  reviewerContractVersion: string
  evidenceContractVersion: string
  routingContractVersion: string
  status: 'APPROVED'
  approvalMode: 'AUTO' | 'HUMAN_ASSISTED'
  relationships: readonly ApprovedIngredientStepRelationshipV1[]
  preparedComponents: readonly never[]
  approvedBy: string
}): ApprovedMapHashInput {
  return {
    schemaVersion: map.schemaVersion,
    recipeId: map.recipeId,
    recipeRevision: map.recipeRevision,
    parserVersion: map.parserVersion,
    mappingSourceHash: map.mappingSourceHash,
    proposalId: map.proposalId,
    reviewerContractVersion: map.reviewerContractVersion,
    evidenceContractVersion: map.evidenceContractVersion,
    routingContractVersion: map.routingContractVersion,
    status: map.status,
    approvalMode: map.approvalMode,
    relationships: map.relationships,
    preparedComponents: map.preparedComponents,
    approvedBy: map.approvedBy,
  }
}

// ── Review-state hash (Implementation 4B) ────────────────────────────────
//
// A deterministic fingerprint of "every candidate's current effective
// decision" for one proposal. Two purposes:
//   1. It is exactly what a completeness attestation attests to
//      (`PersistedMappingCompletenessAttestationV1.reviewStateHash`) — see
//      §26.6. Recomputing it from the live candidate population and
//      comparing against a stored attestation's hash is the entire
//      invalidation mechanism: any candidate addition, decision change, or
//      revision change changes this hash, so a stale attestation is detected
//      by simple inequality rather than by tracking each invalidation
//      trigger separately.
//   2. It is not the same as `mapHash` — this hash exists before a map is
//      ever built (attestation happens before approval) and covers every
//      candidate regardless of `finalDecision` (including unresolved and
//      REJECTed ones), where `mapHash` covers only the final accepted set.

export interface MappingReviewStateCandidateSnapshot {
  candidateId: string
  finalDecision: MappingFinalDecision | null
  decisionSource: MappingDecisionSource
  candidateOrigin: MappingCandidateOrigin
}

export interface MappingReviewStateHashInput {
  proposalId: string
  recipeId: string
  recipeRevision: string
  candidates: readonly MappingReviewStateCandidateSnapshot[]
}

export function canonicalizeMappingReviewState(input: MappingReviewStateHashInput): string {
  const sorted = [...input.candidates].sort((left, right) => left.candidateId.localeCompare(right.candidateId))
  return JSON.stringify({
    proposalId: input.proposalId,
    recipeId: input.recipeId,
    recipeRevision: input.recipeRevision,
    candidates: sorted.map(candidate => ({
      candidateId: candidate.candidateId,
      finalDecision: candidate.finalDecision,
      decisionSource: candidate.decisionSource,
      candidateOrigin: candidate.candidateOrigin,
    })),
  })
}

export async function computeMappingReviewStateHash(input: MappingReviewStateHashInput): Promise<string> {
  return sha256(canonicalizeMappingReviewState(input))
}

// ── Completeness-attestation identity ────────────────────────────────────
//
// Deterministic over `(proposalId, reviewStateHash)` only — deliberately
// excludes `attestedBy`: attesting the exact same complete review state
// twice is the same logical attestation event regardless of a timestamp
// difference (repeat-attestation idempotency, §26.6), and this app has
// exactly one recipe-admin identity (PRD.md §1) so a second distinct actor
// is not a real-world case this identity needs to separate.

export interface MappingCompletenessAttestationIdentityInput {
  proposalId: string
  reviewStateHash: string
}

export function canonicalizeMappingCompletenessAttestationIdentity(
  input: MappingCompletenessAttestationIdentityInput,
): string {
  return JSON.stringify(['mapping-completeness-attestation', 1, input.proposalId, input.reviewStateHash])
}

export async function computeMappingCompletenessAttestationId(
  input: MappingCompletenessAttestationIdentityInput,
): Promise<string> {
  return `${MAPPING_COMPLETENESS_ATTESTATION_ID_PREFIX}${await sha256(canonicalizeMappingCompletenessAttestationIdentity(input))}`
}
