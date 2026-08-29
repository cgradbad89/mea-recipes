import 'server-only'

import {
  canonicalizeApprovedMapRelationships,
  computeApprovedMapHash,
  computeApprovedMapId,
  computeApprovedMapVersion,
  computeMappingReviewStateHash,
  toApprovedMapHashInput,
} from '@/lib/cookingModeMappingPersistenceIdentity'
import {
  approvedMappingDocRef,
  mappingPointerDocRef,
  resolveMappingFirestore,
} from '@/lib/cookingModeMappingFirestore'
import type { MappingFirestoreLike } from '@/lib/cookingModeMappingFirestore'
import { computeProposalCompletion } from '@/lib/cookingModeMappingReviewPersistence'
import { MappingPersistenceConflictError } from '@/lib/cookingModeMappingPersistenceErrors'
import type {
  ApprovedIngredientStepRelationshipV1,
  ApprovedRelationshipProvenanceClass,
  BuildApprovedMappingInput,
  BuildApprovedMappingOutcome,
  CurrentApprovedMappingPointerV1,
  PersistApprovedMappingResult,
  PersistedApprovedCookingStepMapV1,
  PersistedMappingCandidateV1,
  ReadCurrentApprovedMappingPointerResult,
} from '@/types/cookingModeMappingPersistence'

export { MappingPersistenceConflictError }

const BLOCKING_REASONS_INDEPENDENT_OF_LIVE_CANDIDATES = [
  'REVIEWER_A_INCOMPLETE',
  'REVIEWER_B_INCOMPLETE',
  'DETERMINISTIC_EVIDENCE_FAILURE',
  'SOURCE_IDENTITY_MISMATCH',
] as const

/**
 * For one accepted candidate, the provenance class recorded on its approved
 * relationship (Implementation 4B, §26.7) — see
 * `ApprovedRelationshipProvenanceClass`'s doc comment for the three values.
 */
function classifyApprovedRelationshipProvenance(candidate: PersistedMappingCandidateV1): ApprovedRelationshipProvenanceClass {
  if (candidate.provenance.candidateOrigin === 'HUMAN_ADDED') return 'HUMAN_ADDED'
  return candidate.decisionSource === 'HUMAN' ? 'HUMAN_REVIEW_ACCEPT' : 'AUTO_ACCEPT'
}

/**
 * Pure constructor for the immutable approved-map artifact
 * (Implementation 3, Phase 12; extended Implementation 4B, §26.6-26.8).
 * Makes no Firestore call. `input.candidates` MUST be the full, live
 * candidate population (e.g. `listMappingCandidates`) so completeness is
 * judged against reality, not a stale generation-time snapshot — this
 * includes any `HUMAN_ADDED` candidates, which live in the exact same
 * `candidates` subcollection as AI-discovered ones (§26.3) and therefore
 * require no separate union step here.
 */
export async function buildApprovedMapping(input: BuildApprovedMappingInput): Promise<BuildApprovedMappingOutcome> {
  const revisionMismatch = input.candidates.some(candidate =>
    candidate.recipeId !== input.recipeId ||
    candidate.recipeRevision !== input.recipeRevision ||
    candidate.proposalId !== input.proposalId)
  if (revisionMismatch) {
    return { ok: false, reason: 'REVISION_MISMATCH', unresolvedCandidateIds: [] }
  }

  const blockedIndependently = input.proposalBlockingReasons.some(reason =>
    (BLOCKING_REASONS_INDEPENDENT_OF_LIVE_CANDIDATES as readonly string[]).includes(reason))
  if (blockedIndependently) {
    return { ok: false, reason: 'PROPOSAL_BLOCKED', unresolvedCandidateIds: [] }
  }

  const completion = computeProposalCompletion(input.candidates)
  if (!completion.complete) {
    return { ok: false, reason: 'UNRESOLVED_CANDIDATE', unresolvedCandidateIds: completion.unresolvedCandidateIds }
  }

  const structurallyInvalid = input.candidates.filter(candidate => candidate.routingDecision === 'AUTO_REJECT')
  if (structurallyInvalid.length > 0) {
    return {
      ok: false,
      reason: 'STRUCTURAL_BLOCKER',
      unresolvedCandidateIds: structurallyInvalid.map(candidate => candidate.candidateId),
    }
  }

  // Critical invariant (Implementation 4B, §26.6): map approval always
  // requires a valid *current* completeness attestation. Resolving the final
  // candidate decision above can never substitute for it — this is an
  // independent check against a separately, explicitly recorded attestation,
  // not something inferred from `completion.complete`. The live review-state
  // hash is recomputed from the exact same `input.candidates` population
  // (never from a caller-asserted string), so an attestation for a different
  // or now-stale review state is rejected exactly like a missing one.
  const liveReviewStateHash = await computeMappingReviewStateHash({
    proposalId: input.proposalId,
    recipeId: input.recipeId,
    recipeRevision: input.recipeRevision,
    candidates: input.candidates.map(candidate => ({
      candidateId: candidate.candidateId,
      finalDecision: candidate.finalDecision,
      decisionSource: candidate.decisionSource,
      candidateOrigin: candidate.provenance.candidateOrigin,
    })),
  })
  const attestation = input.completenessAttestation
  const attestationValid = Boolean(attestation) &&
    attestation!.proposalId === input.proposalId &&
    attestation!.recipeId === input.recipeId &&
    attestation!.recipeRevision === input.recipeRevision &&
    attestation!.reviewStateHash === liveReviewStateHash
  if (!attestationValid) {
    return { ok: false, reason: 'MISSING_OR_STALE_COMPLETENESS_ATTESTATION', unresolvedCandidateIds: [] }
  }

  const accepted = input.candidates.filter(candidate => candidate.finalDecision === 'ACCEPT')
  const relationships: ApprovedIngredientStepRelationshipV1[] = accepted.map(candidate => ({
    candidateId: candidate.candidateId,
    ingredientRowIndex: candidate.ingredientRowIndex,
    stepIndex: candidate.stepIndex,
    decisionSource: candidate.decisionSource === 'HUMAN' ? 'HUMAN' : 'AUTO',
    decisionId: candidate.decisionSource === 'HUMAN' ? candidate.effectiveReviewEventId : null,
    provenanceClass: classifyApprovedRelationshipProvenance(candidate),
  }))
  const canonicalRelationships = canonicalizeApprovedMapRelationships(relationships)
  const approvalMode: 'AUTO' | 'HUMAN_ASSISTED' =
    input.candidates.some(candidate => candidate.decisionSource === 'HUMAN') ? 'HUMAN_ASSISTED' : 'AUTO'

  const hashInput = {
    schemaVersion: 1 as const,
    recipeId: input.recipeId,
    recipeRevision: input.recipeRevision,
    parserVersion: input.parserVersion,
    mappingSourceHash: input.mappingSourceHash,
    proposalId: input.proposalId,
    reviewerContractVersion: input.reviewerContractVersion,
    evidenceContractVersion: input.evidenceContractVersion,
    routingContractVersion: input.routingContractVersion,
    status: 'APPROVED' as const,
    approvalMode,
    relationships: canonicalRelationships,
    preparedComponents: [] as never[],
    approvedBy: input.approvedBy,
  }
  const mapHash = await computeApprovedMapHash(hashInput)
  const mapId = computeApprovedMapId(mapHash)
  const mapVersion = computeApprovedMapVersion(input.routingContractVersion, mapHash)

  const map: PersistedApprovedCookingStepMapV1 = {
    ...hashInput,
    mapId,
    mapVersion,
    mapHash,
    completenessAttestedAt: attestation!.attestedAt,
    provenance: input.provenance,
    createdAt: null,
    approvedAt: null,
  }
  return { ok: true, map }
}

export interface PersistApprovedMappingOptions {
  db?: MappingFirestoreLike
  now?: () => unknown
}

/**
 * Trusted/admin-side write of an immutable approved map
 * (Implementation 3, Phase 13). Verifies the map's own hash before writing,
 * is idempotent for an exact replay, and fails closed
 * (`MappingPersistenceConflictError`) rather than overwrite if a document
 * with the same `mapId` already exists with different content. Never
 * mutates an existing approved map.
 */
export async function persistApprovedMapping(
  map: PersistedApprovedCookingStepMapV1,
  options: PersistApprovedMappingOptions = {},
): Promise<PersistApprovedMappingResult> {
  const db = resolveMappingFirestore(options.db)
  const now = options.now ?? (() => new Date().toISOString())

  const expectedHash = await computeApprovedMapHash(toApprovedMapHashInput(map))
  if (expectedHash !== map.mapHash) {
    throw new MappingPersistenceConflictError('Approved map content does not match its own mapHash', {
      expectedHash, actualHash: map.mapHash,
    })
  }
  const expectedMapId = computeApprovedMapId(expectedHash)
  if (expectedMapId !== map.mapId) {
    throw new MappingPersistenceConflictError('Approved map mapId does not match its deterministic identity', {
      expectedMapId, actualMapId: map.mapId,
    })
  }

  const ref = approvedMappingDocRef(db, map.recipeId, map.mapId)
  const existingSnap = await ref.get()
  if (existingSnap.exists) {
    const existing = existingSnap.data() as unknown as PersistedApprovedCookingStepMapV1
    if (existing.mapHash !== map.mapHash) {
      throw new MappingPersistenceConflictError('An approved map with this mapId already exists with different content', {
        mapId: map.mapId,
      })
    }
    return { mapId: map.mapId, outcome: 'REPLAYED_IDENTICAL' }
  }

  await ref.set({
    ...map,
    createdAt: now(),
    approvedAt: now(),
  })
  return { mapId: map.mapId, outcome: 'CREATED' }
}

export async function getApprovedMapping(
  recipeId: string,
  mapId: string,
  db?: MappingFirestoreLike,
): Promise<PersistedApprovedCookingStepMapV1 | null> {
  const snap = await approvedMappingDocRef(resolveMappingFirestore(db), recipeId, mapId).get()
  return snap.exists ? (snap.data() as unknown as PersistedApprovedCookingStepMapV1) : null
}

// ── Current-approved pointer ──────────────────────────────────────────────

export interface UpdateCurrentApprovedMappingPointerOptions {
  db?: MappingFirestoreLike
  now?: () => unknown
}

/**
 * Updates the small current-approved-map pointer (Implementation 3,
 * Phase 14). Only ever runs after the referenced approved map has been
 * persisted AND read back with a matching hash — never speculatively.
 * IMPORTANT: writing this pointer does not activate anything. Cooking Mode
 * does not read it yet (Phase 22); it exists so a later, separately gated
 * runtime-cutover task has a stable value to switch onto.
 */
export async function updateCurrentApprovedMappingPointer(
  recipeId: string,
  mapId: string,
  options: UpdateCurrentApprovedMappingPointerOptions = {},
): Promise<CurrentApprovedMappingPointerV1> {
  const db = resolveMappingFirestore(options.db)
  const now = options.now ?? (() => new Date().toISOString())

  const mapSnap = await approvedMappingDocRef(db, recipeId, mapId).get()
  if (!mapSnap.exists) {
    throw new MappingPersistenceConflictError('Cannot point at an approved map that has not been persisted', { recipeId, mapId })
  }
  const map = mapSnap.data() as unknown as PersistedApprovedCookingStepMapV1
  if (map.recipeId !== recipeId) {
    throw new MappingPersistenceConflictError('Approved map does not belong to this recipe', { recipeId, mapId })
  }
  // Exact readback + hash re-verification before the pointer may move.
  const recomputedHash = await computeApprovedMapHash(toApprovedMapHashInput(map))
  if (recomputedHash !== map.mapHash) {
    throw new MappingPersistenceConflictError('Approved map failed hash re-verification on readback; pointer not updated', { recipeId, mapId })
  }

  const pointer: CurrentApprovedMappingPointerV1 = {
    schemaVersion: 1,
    recipeId,
    recipeRevision: map.recipeRevision,
    mapId: map.mapId,
    mapHash: map.mapHash,
    updatedAt: now(),
  }
  await mappingPointerDocRef(db, recipeId).set(pointer as unknown as Record<string, unknown>)
  return pointer
}

/**
 * Reads the current-approved pointer and classifies it against the recipe's
 * live mapping revision (Implementation 3, Phase 15). Never claims a stale
 * pointer is current — this is a read-time classification only, nothing is
 * mutated, and no runtime/UI consumes this yet.
 */
export async function getCurrentApprovedMappingPointer(
  recipeId: string,
  currentRecipeRevision: string,
  db?: MappingFirestoreLike,
): Promise<ReadCurrentApprovedMappingPointerResult> {
  const snap = await mappingPointerDocRef(resolveMappingFirestore(db), recipeId).get()
  if (!snap.exists) {
    return { status: 'NOT_FOUND', pointer: null, currentRecipeRevision }
  }
  const pointer = snap.data() as unknown as CurrentApprovedMappingPointerV1
  const status = pointer.recipeRevision === currentRecipeRevision ? 'CURRENT' : 'STALE'
  return { status, pointer, currentRecipeRevision }
}
