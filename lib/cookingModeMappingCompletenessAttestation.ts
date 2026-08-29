import 'server-only'

import { computeMappingCompletenessAttestationId, computeMappingReviewStateHash } from '@/lib/cookingModeMappingPersistenceIdentity'
import {
  mappingCompletenessAttestationDocRef,
  resolveMappingFirestore,
} from '@/lib/cookingModeMappingFirestore'
import type { MappingFirestoreLike } from '@/lib/cookingModeMappingFirestore'
import { getMappingProposal, listMappingCandidates } from '@/lib/cookingModeMappingProposalPersistence'
import { computeProposalCompletion } from '@/lib/cookingModeMappingReviewPersistence'
import type {
  MappingCompletenessAttestationStatus,
  PersistedMappingCandidateV1,
  PersistedMappingCompletenessAttestationV1,
  RecordMappingCompletenessAttestationInput,
  RecordMappingCompletenessAttestationRejectionReason,
} from '@/types/cookingModeMappingPersistence'

/**
 * Fail-closed rejection of a completeness-attestation call. Every branch
 * means "no attestation was written."
 */
export class MappingCompletenessAttestationRejectedError extends Error {
  readonly reason: RecordMappingCompletenessAttestationRejectionReason

  constructor(reason: RecordMappingCompletenessAttestationRejectionReason, message: string) {
    super(message)
    this.name = 'MappingCompletenessAttestationRejectedError'
    this.reason = reason
  }
}

function reviewStateCandidateSnapshot(candidate: PersistedMappingCandidateV1) {
  return {
    candidateId: candidate.candidateId,
    finalDecision: candidate.finalDecision,
    decisionSource: candidate.decisionSource,
    candidateOrigin: candidate.provenance.candidateOrigin,
  }
}

async function liveReviewStateHashFor(
  recipeId: string,
  proposalId: string,
  recipeRevision: string,
  db: MappingFirestoreLike,
): Promise<{ hash: string; candidates: PersistedMappingCandidateV1[] }> {
  const candidates = await listMappingCandidates(recipeId, proposalId, db)
  const hash = await computeMappingReviewStateHash({
    proposalId,
    recipeId,
    recipeRevision,
    candidates: candidates.map(reviewStateCandidateSnapshot),
  })
  return { hash, candidates }
}

export interface RecordMappingCompletenessAttestationOptions {
  db?: MappingFirestoreLike
  now?: () => unknown
}

/**
 * Trusted/admin-side completeness attestation (Implementation 4B, §26.6).
 * The caller (a future admin-authenticated API route) is responsible for
 * verifying the acting identity via `verifyAdminToken` and passing that
 * verified uid as `input.attestedBy` — this function never accepts or trusts
 * a client-supplied identity of its own, matching
 * `appendMappingReviewDecision`'s convention.
 *
 * This is always a separate, explicit call: resolving the last
 * REVIEW_REQUIRED/HUMAN_ADDED candidate decision never implicitly attests
 * completeness (Critical Invariant). It requires the proposal to be fully
 * resolved (`computeProposalCompletion(candidates).complete`) before
 * recording anything, and is idempotent for an exact replay of the same
 * review state — the attestation id is deterministic over
 * `(proposalId, reviewStateHash)`, so re-attesting an unchanged state
 * returns the existing record unchanged rather than writing a duplicate.
 */
export async function recordMappingCompletenessAttestation(
  input: RecordMappingCompletenessAttestationInput,
  options: RecordMappingCompletenessAttestationOptions = {},
): Promise<PersistedMappingCompletenessAttestationV1> {
  const db = resolveMappingFirestore(options.db)
  const now = options.now ?? (() => new Date().toISOString())

  const proposal = await getMappingProposal(input.recipeId, input.proposalId, db)
  if (!proposal) {
    throw new MappingCompletenessAttestationRejectedError('PROPOSAL_NOT_FOUND', `No proposal ${input.proposalId} exists for this recipe`)
  }
  if (proposal.persistenceStatus !== 'READY') {
    throw new MappingCompletenessAttestationRejectedError('PROPOSAL_NOT_READY', 'Proposal has not finished writing its candidate population')
  }
  if (proposal.recipeRevision !== input.recipeRevision) {
    throw new MappingCompletenessAttestationRejectedError('REVISION_MISMATCH', 'Proposal recipe revision no longer matches the caller-supplied revision')
  }

  const { hash: reviewStateHash, candidates } = await liveReviewStateHashFor(
    input.recipeId, input.proposalId, input.recipeRevision, db,
  )
  const completion = computeProposalCompletion(candidates)
  if (!completion.complete) {
    throw new MappingCompletenessAttestationRejectedError(
      'PROPOSAL_NOT_FULLY_RESOLVED',
      'Every REVIEW_REQUIRED/HUMAN_ADDED candidate must have a current final decision before the map-level review can be attested',
    )
  }

  const attestationId = await computeMappingCompletenessAttestationId({
    proposalId: input.proposalId,
    reviewStateHash,
  })
  const ref = mappingCompletenessAttestationDocRef(db, input.recipeId, input.proposalId, attestationId)
  const existingSnap = await ref.get()
  if (existingSnap.exists) {
    // Idempotent replay of the exact same attested review state.
    return existingSnap.data() as unknown as PersistedMappingCompletenessAttestationV1
  }

  const attestation: PersistedMappingCompletenessAttestationV1 = {
    schemaVersion: 1,
    attestationId,
    proposalId: input.proposalId,
    recipeId: input.recipeId,
    recipeRevision: input.recipeRevision,
    reviewStateHash,
    attestedBy: input.attestedBy,
    attestedAt: now(),
  }
  await ref.set(attestation as unknown as Record<string, unknown>)
  return attestation
}

/**
 * Read-time validity check (Implementation 4B, §26.6) — mirrors
 * `getCurrentApprovedMappingPointer`'s CURRENT/STALE classification pattern.
 * Recomputes the live review-state hash from the proposal's current
 * candidate population and looks up the attestation at the deterministic id
 * that live hash implies; a `false` result covers "never attested" and
 * "attested a since-superseded state" identically, since both mean the human
 * must review the current complete map again before it can be approved.
 */
export async function getMappingCompletenessAttestationStatus(
  recipeId: string,
  proposalId: string,
  db?: MappingFirestoreLike,
): Promise<MappingCompletenessAttestationStatus> {
  const client = resolveMappingFirestore(db)
  const proposal = await getMappingProposal(recipeId, proposalId, client)
  if (!proposal || proposal.persistenceStatus !== 'READY') {
    return { valid: false, attestation: null, liveReviewStateHash: '' }
  }
  const { hash: liveReviewStateHash } = await liveReviewStateHashFor(recipeId, proposalId, proposal.recipeRevision, client)
  const attestationId = await computeMappingCompletenessAttestationId({ proposalId, reviewStateHash: liveReviewStateHash })
  const snap = await mappingCompletenessAttestationDocRef(client, recipeId, proposalId, attestationId).get()
  if (!snap.exists) {
    return { valid: false, attestation: null, liveReviewStateHash }
  }
  return { valid: true, attestation: snap.data() as unknown as PersistedMappingCompletenessAttestationV1, liveReviewStateHash }
}
