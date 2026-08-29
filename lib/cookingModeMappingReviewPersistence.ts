import 'server-only'

import { computeMappingReviewDecisionId } from '@/lib/cookingModeMappingPersistenceIdentity'
import {
  mappingCandidateDocRef,
  mappingReviewEventDocRef,
  mappingReviewEventsCollection,
  resolveMappingFirestore,
} from '@/lib/cookingModeMappingFirestore'
import type { MappingFirestoreLike } from '@/lib/cookingModeMappingFirestore'
import type {
  AppendMappingReviewDecisionInput,
  PersistedMappingCandidateV1,
  PersistedMappingReviewDecisionV1,
  ProposalCompletionResult,
} from '@/types/cookingModeMappingPersistence'

export type MappingReviewDecisionRejectionReason =
  | 'CANDIDATE_NOT_FOUND'
  | 'PROPOSAL_MISMATCH'
  | 'REVISION_MISMATCH'
  | 'CANDIDATE_NOT_REVIEW_REQUIRED'
  | 'MISSING_REQUIRED_NOTE'
  | 'MISSING_SUPERSESSION_FOR_CORRECTION'
  | 'INVALID_SUPERSESSION'

/**
 * Fail-closed rejection of an append-review-decision call. Every branch here
 * means "no event was written and no candidate was mutated" — there is no
 * partial-append outcome.
 */
export class MappingReviewDecisionRejectedError extends Error {
  readonly reason: MappingReviewDecisionRejectionReason

  constructor(reason: MappingReviewDecisionRejectionReason, message: string) {
    super(message)
    this.name = 'MappingReviewDecisionRejectedError'
    this.reason = reason
  }
}

export interface AppendMappingReviewDecisionOptions {
  db?: MappingFirestoreLike
  now?: () => unknown
}

/**
 * Trusted/admin-side append-only human-review-decision service
 * (Implementation 3, Phase 10). The caller (a future admin-authenticated API
 * route) is responsible for verifying the acting identity via
 * `verifyAdminToken` (`lib/firebaseAdmin.ts`) and passing that verified uid
 * as `input.decidedBy` — this function never accepts or trusts a
 * client-supplied identity of its own.
 *
 * Decisions are immutable once written: a correction is expressed by
 * calling this again with `supersedesDecisionId` set to the candidate's
 * current `effectiveReviewEventId`. The candidate's materialized
 * `finalDecision`/`decisionSource`/`reviewStatus`/`effectiveReviewEventId`
 * are updated in the same transaction as the new event, so a reader never
 * observes an event without its materialized effect or vice versa.
 */
export async function appendMappingReviewDecision(
  input: AppendMappingReviewDecisionInput,
  options: AppendMappingReviewDecisionOptions = {},
): Promise<PersistedMappingReviewDecisionV1> {
  const db = resolveMappingFirestore(options.db)
  const now = options.now ?? (() => new Date().toISOString())

  if (input.reasonCode === 'OTHER' && !(input.note && input.note.trim().length > 0)) {
    throw new MappingReviewDecisionRejectedError('MISSING_REQUIRED_NOTE', 'A non-empty note is required when reasonCode is OTHER')
  }

  const decisionId = await computeMappingReviewDecisionId({
    proposalId: input.proposalId,
    candidateId: input.candidateId,
    decision: input.decision,
    reasonCode: input.reasonCode,
    note: input.note ?? null,
    decidedBy: input.decidedBy,
    supersedesDecisionId: input.supersedesDecisionId ?? null,
  })

  const candidateRef = mappingCandidateDocRef(db, input.recipeId, input.proposalId, input.candidateId)
  const eventRef = mappingReviewEventDocRef(db, input.recipeId, input.proposalId, decisionId)

  return db.runTransaction(async transaction => {
    const candidateSnap = await transaction.get(candidateRef)
    if (!candidateSnap.exists) {
      throw new MappingReviewDecisionRejectedError('CANDIDATE_NOT_FOUND', `No candidate ${input.candidateId} exists for this proposal`)
    }
    const candidate = candidateSnap.data() as unknown as PersistedMappingCandidateV1
    if (candidate.proposalId !== input.proposalId || candidate.recipeId !== input.recipeId) {
      throw new MappingReviewDecisionRejectedError('PROPOSAL_MISMATCH', 'Candidate does not belong to the given recipe/proposal')
    }
    if (candidate.recipeRevision !== input.recipeRevision) {
      throw new MappingReviewDecisionRejectedError('REVISION_MISMATCH', 'Candidate recipe revision no longer matches the caller-supplied revision')
    }
    // HUMAN_ADDED candidates (Implementation 4B) also accept a decision
    // through this exact append-only mechanism: the candidate's initial
    // ACCEPT is recorded this way immediately after creation, and a later
    // correction/removal (REJECT) or restore (ACCEPT again) reuses it too —
    // see lib/cookingModeMappingHumanRelationship.ts. AUTO_ACCEPT/AUTO_REJECT
    // candidates never do; their finalDecision is already a pure function of
    // routing and is not human-correctable through this call.
    if (candidate.routingDecision !== 'REVIEW_REQUIRED' && candidate.routingDecision !== 'HUMAN_ADDED') {
      throw new MappingReviewDecisionRejectedError('CANDIDATE_NOT_REVIEW_REQUIRED', 'Only REVIEW_REQUIRED or HUMAN_ADDED candidates accept a human decision')
    }

    const existingEventSnap = await transaction.get(eventRef)
    if (existingEventSnap.exists) {
      // Idempotent replay of the exact same decision content — do not touch
      // decidedAt or re-materialize; return the event exactly as recorded.
      return existingEventSnap.data() as unknown as PersistedMappingReviewDecisionV1
    }

    if (input.supersedesDecisionId) {
      if (candidate.effectiveReviewEventId !== input.supersedesDecisionId) {
        throw new MappingReviewDecisionRejectedError(
          'INVALID_SUPERSESSION',
          'supersedesDecisionId must reference the candidate\'s current effective decision',
        )
      }
      const supersededSnap = await transaction.get(
        mappingReviewEventDocRef(db, input.recipeId, input.proposalId, input.supersedesDecisionId),
      )
      if (!supersededSnap.exists) {
        throw new MappingReviewDecisionRejectedError('INVALID_SUPERSESSION', 'Superseded decision event does not exist')
      }
    } else if (candidate.effectiveReviewEventId) {
      throw new MappingReviewDecisionRejectedError(
        'MISSING_SUPERSESSION_FOR_CORRECTION',
        'Candidate already has an effective decision; supply supersedesDecisionId to correct it',
      )
    }

    const decisionEvent: PersistedMappingReviewDecisionV1 = {
      schemaVersion: 1,
      decisionId,
      recipeId: input.recipeId,
      proposalId: input.proposalId,
      candidateId: input.candidateId,
      recipeRevision: input.recipeRevision,
      decision: input.decision,
      reasonCode: input.reasonCode,
      note: input.note ?? null,
      decidedBy: input.decidedBy,
      decidedAt: now(),
      supersedesDecisionId: input.supersedesDecisionId ?? null,
    }
    transaction.set(eventRef, decisionEvent as unknown as Record<string, unknown>)
    transaction.set(candidateRef, {
      ...candidate,
      finalDecision: input.decision,
      decisionSource: 'HUMAN',
      reviewStatus: 'DECIDED',
      effectiveReviewEventId: decisionId,
      updatedAt: now(),
    })
    return decisionEvent
  })
}

/**
 * Full append-only decision chain for one candidate, oldest first,
 * reconstructed by walking `supersedesDecisionId` back from the candidate's
 * current `effectiveReviewEventId` rather than by sorting on a server
 * timestamp — `appendMappingReviewDecision` guarantees a single linear chain
 * per candidate, so the walk is exact and needs no query/index at all.
 */
export async function getMappingReviewHistory(
  recipeId: string,
  proposalId: string,
  candidateId: string,
  db?: MappingFirestoreLike,
): Promise<PersistedMappingReviewDecisionV1[]> {
  const client = resolveMappingFirestore(db)
  const candidateSnap = await mappingCandidateDocRef(client, recipeId, proposalId, candidateId).get()
  if (!candidateSnap.exists) return []
  const candidate = candidateSnap.data() as unknown as PersistedMappingCandidateV1

  const chain: PersistedMappingReviewDecisionV1[] = []
  let cursor = candidate.effectiveReviewEventId
  const seen = new Set<string>()
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor)
    const snap = await mappingReviewEventDocRef(client, recipeId, proposalId, cursor).get()
    if (!snap.exists) break
    const event = snap.data() as unknown as PersistedMappingReviewDecisionV1
    chain.push(event)
    cursor = event.supersedesDecisionId
  }
  return chain.reverse()
}

/** Every review event ever written for a proposal, in undefined cross-candidate order (diagnostic/audit use only — use `getMappingReviewHistory` for one candidate's ordered chain). */
export async function listAllMappingReviewEvents(
  recipeId: string,
  proposalId: string,
  db?: MappingFirestoreLike,
): Promise<PersistedMappingReviewDecisionV1[]> {
  const snap = await mappingReviewEventsCollection(resolveMappingFirestore(db), recipeId, proposalId).get()
  return snap.docs.map(doc => doc.data() as unknown as PersistedMappingReviewDecisionV1)
}

/**
 * Pure completion calculation (Implementation 3, Phase 11). `candidates`
 * MUST be the full population of a proposal (e.g. from
 * `listMappingCandidates`, never a filtered/paginated subset) — completeness
 * can only be judged against every candidate that exists.
 */
export function computeProposalCompletion(candidates: readonly PersistedMappingCandidateV1[]): ProposalCompletionResult {
  const unresolved = candidates.filter(candidate => candidate.finalDecision === null)
  return {
    complete: unresolved.length === 0,
    totalCandidates: candidates.length,
    resolvedCandidates: candidates.length - unresolved.length,
    unresolvedCandidateIds: unresolved.map(candidate => candidate.candidateId),
    requiresCompletenessAttestation: candidates.some(candidate => candidate.decisionSource === 'HUMAN'),
  }
}
