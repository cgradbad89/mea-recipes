import 'server-only'

import { chunkItems } from '@/lib/chunkItems'
import {
  computeMappingCandidateId,
  computeMappingProposalId,
} from '@/lib/cookingModeMappingIdentity'
import {
  mappingCandidateDocRef,
  mappingCandidatesCollection,
  mappingProposalDocRef,
  resolveMappingFirestore,
} from '@/lib/cookingModeMappingFirestore'
import type { MappingFirestoreLike } from '@/lib/cookingModeMappingFirestore'
import type { MappingCandidateV1, MappingProposalV1 } from '@/types/cookingModeMapping'
import type {
  PersistedMappingCandidateV1,
  PersistedMappingProposalV1,
  PersistMappingProposalResult,
} from '@/types/cookingModeMappingPersistence'
import {
  MappingPersistenceConflictError,
  MappingPersistenceFailureError,
} from '@/lib/cookingModeMappingPersistenceErrors'

export { MappingPersistenceConflictError, MappingPersistenceFailureError }

/**
 * The subset of a candidate's fields that a generation attempt (reviewer
 * execution + deterministic evidence + routing) produces. Deliberately
 * excludes `reviewStatus`/`finalDecision`/`decisionSource`: for a
 * `REVIEW_REQUIRED` candidate those are owned by human review after the
 * proposal is written and legitimately change independently of a proposal
 * replay; for `AUTO_ACCEPT`/`AUTO_REJECT` they are already a pure function
 * of `routingDecision`, which this signature does cover.
 */
function candidateGenerationSignature(candidate: MappingCandidateV1): string {
  return JSON.stringify({
    candidateType: candidate.candidateType,
    ingredientRowIndex: candidate.ingredientRowIndex,
    ingredientText: candidate.ingredientText,
    ingredientGroup: candidate.ingredientGroup,
    stepIndex: candidate.stepIndex,
    stepText: candidate.stepText,
    reviewerA: candidate.reviewerA,
    reviewerB: candidate.reviewerB,
    deterministicEvidence: candidate.deterministicEvidence,
    routingDecision: candidate.routingDecision,
    routingReasons: candidate.routingReasons,
    provenance: candidate.provenance,
  })
}

export interface SaveMappingProposalOptions {
  db?: MappingFirestoreLike
  now?: () => unknown
}

/**
 * Trusted/admin-side persistence for a generated `MappingProposalV1`
 * (Implementation 3, Phases 8–9). Verifies deterministic identities, then
 * writes the proposal header and its candidate population atomically enough
 * that a reader can never observe a `READY` header with an incomplete
 * candidate population:
 *
 *   header persistenceStatus = WRITING
 *     -> batch-write candidates (chunked at the Firestore batch limit)
 *     -> readback candidate count
 *     -> header persistenceStatus = READY (or FAILED on reconciliation failure)
 *
 * Idempotent for an exact replay of the same proposal: unchanged candidates
 * are left untouched (preserving any materialized human-review state) and
 * the call returns `REPLAYED_IDENTICAL` instead of `CREATED`. Fails closed
 * (`MappingPersistenceConflictError`) if an existing record with the same
 * deterministic identity carries materially different immutable content —
 * it never silently overwrites or merges.
 */
export async function saveMappingProposal(
  proposal: MappingProposalV1,
  options: SaveMappingProposalOptions = {},
): Promise<PersistMappingProposalResult> {
  const db = resolveMappingFirestore(options.db)
  const now = options.now ?? (() => new Date().toISOString())

  const expectedProposalId = await computeMappingProposalId({
    recipeId: proposal.recipeId,
    recipeRevision: proposal.recipeRevision,
    reviewerContractVersion: proposal.reviewerContractVersion,
    evidenceContractVersion: proposal.evidenceContractVersion,
    routingContractVersion: proposal.routingContractVersion,
  })
  if (expectedProposalId !== proposal.proposalId) {
    throw new MappingPersistenceConflictError('Proposal identity does not match its deterministic identity tuple', {
      expectedProposalId, actualProposalId: proposal.proposalId,
    })
  }

  const candidateIds = new Set<string>()
  for (const candidate of proposal.candidates) {
    if (candidate.recipeId !== proposal.recipeId || candidate.recipeRevision !== proposal.recipeRevision) {
      throw new MappingPersistenceConflictError('Candidate recipe/revision does not match its proposal', {
        candidateId: candidate.candidateId,
      })
    }
    const expectedCandidateId = await computeMappingCandidateId({
      recipeId: candidate.recipeId,
      recipeRevision: candidate.recipeRevision,
      ingredientRowIndex: candidate.ingredientRowIndex,
      stepIndex: candidate.stepIndex,
    })
    if (expectedCandidateId !== candidate.candidateId) {
      throw new MappingPersistenceConflictError('Candidate identity does not match its deterministic identity tuple', {
        expectedCandidateId, actualCandidateId: candidate.candidateId,
      })
    }
    if (candidateIds.has(candidate.candidateId)) {
      throw new MappingPersistenceConflictError('Duplicate candidate identity within one proposal', {
        candidateId: candidate.candidateId,
      })
    }
    candidateIds.add(candidate.candidateId)
  }

  const proposalRef = mappingProposalDocRef(db, proposal.recipeId, proposal.proposalId)
  const existingSnap = await proposalRef.get()
  const existingHeader = existingSnap.exists ? (existingSnap.data() as unknown as PersistedMappingProposalV1 | undefined) : undefined
  const candidateCount = candidateIds.size

  if (existingHeader) {
    if (
      existingHeader.recipeRevision !== proposal.recipeRevision ||
      existingHeader.parserVersion !== proposal.parserVersion ||
      existingHeader.mappingSourceHash !== proposal.mappingSourceHash ||
      existingHeader.reviewerContractVersion !== proposal.reviewerContractVersion ||
      existingHeader.evidenceContractVersion !== proposal.evidenceContractVersion ||
      existingHeader.routingContractVersion !== proposal.routingContractVersion
    ) {
      throw new MappingPersistenceConflictError('Existing proposal header has conflicting immutable content', {
        proposalId: proposal.proposalId,
      })
    }
    if (existingHeader.persistenceStatus === 'READY' && existingHeader.candidateCount !== candidateCount) {
      throw new MappingPersistenceConflictError('Existing READY proposal has a different candidate population size', {
        proposalId: proposal.proposalId, existingCandidateCount: existingHeader.candidateCount, incomingCandidateCount: candidateCount,
      })
    }
  }

  const headerData = {
    schemaVersion: 1 as const,
    proposalId: proposal.proposalId,
    recipeId: proposal.recipeId,
    recipeRevision: proposal.recipeRevision,
    parserVersion: proposal.parserVersion,
    mappingSourceHash: proposal.mappingSourceHash,
    reviewerContractVersion: proposal.reviewerContractVersion,
    evidenceContractVersion: proposal.evidenceContractVersion,
    routingContractVersion: proposal.routingContractVersion,
    summary: proposal.summary,
    candidateCount,
    approvalBlocked: proposal.approvalBlocked,
    blockingReasons: proposal.blockingReasons,
    reviewCompleteWithoutHuman: proposal.reviewCompleteWithoutHuman,
    createdAt: existingHeader?.createdAt ?? now(),
  }

  await proposalRef.set({ ...headerData, persistenceStatus: 'WRITING', updatedAt: now() })

  const candidatesCollection = mappingCandidatesCollection(db, proposal.recipeId, proposal.proposalId)
  const existingCandidatesSnap = await candidatesCollection.get()
  const existingCandidateById = new Map(existingCandidatesSnap.docs.map(doc => [doc.id, doc.data()]))

  const toWrite: MappingCandidateV1[] = []
  for (const candidate of proposal.candidates) {
    const existingCandidate = existingCandidateById.get(candidate.candidateId) as PersistedMappingCandidateV1 | undefined
    if (!existingCandidate) {
      toWrite.push(candidate)
      continue
    }
    if (candidateGenerationSignature(existingCandidate) !== candidateGenerationSignature(candidate)) {
      throw new MappingPersistenceConflictError('Existing candidate has conflicting immutable generation content', {
        candidateId: candidate.candidateId,
      })
    }
    // Identical generation content is already stored — never overwrite it,
    // so any materialized human-review state on the existing doc survives.
  }

  for (const chunk of chunkItems(toWrite)) {
    const batch = db.batch()
    for (const candidate of chunk) {
      const ref = mappingCandidateDocRef(db, proposal.recipeId, proposal.proposalId, candidate.candidateId)
      const persisted: PersistedMappingCandidateV1 = {
        ...candidate,
        effectiveReviewEventId: null,
        updatedAt: now(),
      }
      batch.set(ref, persisted as unknown as Record<string, unknown>)
    }
    await batch.commit()
  }

  const readbackSnap = await candidatesCollection.get()
  if (readbackSnap.size !== candidateCount) {
    await proposalRef.set({ ...headerData, persistenceStatus: 'FAILED', updatedAt: now() })
    throw new MappingPersistenceFailureError('Candidate population readback did not reconcile with the proposal; marked FAILED', {
      proposalId: proposal.proposalId, expectedCandidateCount: candidateCount, readCandidateCount: readbackSnap.size,
    })
  }

  const outcome: PersistMappingProposalResult['outcome'] =
    existingHeader?.persistenceStatus === 'READY' ? 'REPLAYED_IDENTICAL' : 'CREATED'

  await proposalRef.set({ ...headerData, persistenceStatus: 'READY', updatedAt: now() })

  return { proposalId: proposal.proposalId, outcome, candidateCount }
}

export async function getMappingProposal(
  recipeId: string,
  proposalId: string,
  db?: MappingFirestoreLike,
): Promise<PersistedMappingProposalV1 | null> {
  const snap = await mappingProposalDocRef(resolveMappingFirestore(db), recipeId, proposalId).get()
  return snap.exists ? (snap.data() as unknown as PersistedMappingProposalV1) : null
}

export async function getMappingCandidate(
  recipeId: string,
  proposalId: string,
  candidateId: string,
  db?: MappingFirestoreLike,
): Promise<PersistedMappingCandidateV1 | null> {
  const snap = await mappingCandidateDocRef(resolveMappingFirestore(db), recipeId, proposalId, candidateId).get()
  return snap.exists ? (snap.data() as unknown as PersistedMappingCandidateV1) : null
}

/**
 * Full candidate population for one proposal. Deliberately an unfiltered,
 * unpaginated read of the whole (small, bounded) subcollection rather than a
 * `where(...)` query — see the indexing rationale in
 * `lib/cookingModeMappingFirestore.ts`. Completion/approval logic must never
 * infer completeness from anything less than this full population
 * (Implementation 3, Phase 11).
 */
export async function listMappingCandidates(
  recipeId: string,
  proposalId: string,
  db?: MappingFirestoreLike,
): Promise<PersistedMappingCandidateV1[]> {
  const snap = await mappingCandidatesCollection(resolveMappingFirestore(db), recipeId, proposalId).get()
  return snap.docs.map(doc => doc.data() as unknown as PersistedMappingCandidateV1)
}

/** Candidates with no effective final decision yet (always `REVIEW_REQUIRED` ones — AUTO routes always resolve at generation time). */
export async function listReviewRequiredCandidates(
  recipeId: string,
  proposalId: string,
  db?: MappingFirestoreLike,
): Promise<PersistedMappingCandidateV1[]> {
  const all = await listMappingCandidates(recipeId, proposalId, db)
  return all.filter(candidate => candidate.finalDecision === null)
}
