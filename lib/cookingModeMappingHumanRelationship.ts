import 'server-only'

import {
  computeMappingCandidateId,
  computeMappingRecipeRevision,
  validateMappingCandidateStructure,
} from '@/lib/cookingModeMappingIdentity'
import { deriveMappingV1Evidence, FROZEN_V10B_SOURCE_EXTRACTOR_SHA256 } from '@/lib/cookingModeMappingEvidence'
import { mappingIngredientGroup } from '@/lib/cookingModeMappingRiskFacts'
import { mappingCandidateDocRef, resolveMappingFirestore } from '@/lib/cookingModeMappingFirestore'
import type { MappingFirestoreLike } from '@/lib/cookingModeMappingFirestore'
import { getMappingProposal, listMappingCandidates } from '@/lib/cookingModeMappingProposalPersistence'
import { appendMappingReviewDecision } from '@/lib/cookingModeMappingReviewPersistence'
import { MAPPING_EVIDENCE_CONTRACT_VERSION, MAPPING_ROUTING_CONTRACT_VERSION } from '@/types/cookingModeMapping'
import type {
  AddHumanMappingRelationshipInput,
  AddHumanMappingRelationshipOutcome,
  AddHumanMappingRelationshipRejectionReason,
  AddHumanMappingRelationshipResult,
  PersistedMappingCandidateV1,
  PersistedMappingReviewDecisionV1,
  RemoveHumanMappingRelationshipInput,
  RemoveHumanMappingRelationshipRejectionReason,
} from '@/types/cookingModeMappingPersistence'

/**
 * Human-discovered ingredient→step relationships (Implementation 4B) — see
 * docs/architecture/cooking-mode-review-routing-contract.md §26 for the
 * normative design and lib/cookingModeMappingReviewPersistence.ts for the
 * append-only decision mechanism this reuses rather than duplicates.
 */

export class AddHumanMappingRelationshipRejectedError extends Error {
  readonly reason: AddHumanMappingRelationshipRejectionReason

  constructor(reason: AddHumanMappingRelationshipRejectionReason, message: string) {
    super(message)
    this.name = 'AddHumanMappingRelationshipRejectedError'
    this.reason = reason
  }
}

export class RemoveHumanMappingRelationshipRejectedError extends Error {
  readonly reason: RemoveHumanMappingRelationshipRejectionReason

  constructor(reason: RemoveHumanMappingRelationshipRejectionReason, message: string) {
    super(message)
    this.name = 'RemoveHumanMappingRelationshipRejectedError'
    this.reason = reason
  }
}

export interface AddHumanMappingRelationshipOptions {
  db?: MappingFirestoreLike
  /** Server-timestamp provider for the candidate's `updatedAt`/decision `decidedAt` fields only. */
  now?: () => unknown
}

function freshHumanAddedCandidateShell(input: {
  candidateId: string
  proposalId: string
  recipeId: string
  recipeRevision: string
  proposalMappingSourceHash: string
  proposalReviewerContractVersion: string
  ingredientRowIndex: number
  ingredientText: string
  ingredientGroup: string | null
  stepIndex: number
  stepText: string
  parserVersion: string
  now: () => unknown
}): PersistedMappingCandidateV1 {
  return {
    schemaVersion: 1,
    candidateType: 'INGREDIENT_STEP_RELATIONSHIP',
    candidateId: input.candidateId,
    proposalId: input.proposalId,
    recipeId: input.recipeId,
    recipeRevision: input.recipeRevision,
    parserVersion: input.parserVersion,
    mappingSourceHash: input.proposalMappingSourceHash,
    ingredientRowIndex: input.ingredientRowIndex,
    ingredientText: input.ingredientText,
    ingredientGroup: input.ingredientGroup,
    stepIndex: input.stepIndex,
    stepText: input.stepText,
    // No fabricated reviewer vote — neither reviewer ever evaluated this
    // exact relationship as a union candidate. See the doc comment on
    // MappingCandidateV1.reviewerA/B.
    reviewerA: null,
    reviewerB: null,
    // Honest "not computed" evidence, not a fabricated risk/positive finding
    // — reuses the same shape the AI-discovery path falls back to on a real
    // evidence failure (deriveMappingV1Evidence with status UNAVAILABLE),
    // but this never sets approvalBlocked anywhere: buildMappingProposal's
    // evidenceFailure bookkeeping is never invoked for a human-added
    // candidate, since it is not built through buildMappingProposal at all.
    deterministicEvidence: deriveMappingV1Evidence({
      status: 'UNAVAILABLE',
      extractorFingerprint: FROZEN_V10B_SOURCE_EXTRACTOR_SHA256,
      frozenRiskFacts: null,
    }),
    routingDecision: 'HUMAN_ADDED',
    routingReasons: ['HUMAN_ADDED_RELATIONSHIP'],
    reviewStatus: 'PENDING',
    finalDecision: null,
    decisionSource: null,
    provenance: {
      routingContractVersion: MAPPING_ROUTING_CONTRACT_VERSION,
      evidenceContractVersion: MAPPING_EVIDENCE_CONTRACT_VERSION,
      reviewerContractVersion: input.proposalReviewerContractVersion,
      candidateOrigin: 'HUMAN_ADDED',
      acceptedByReviewerSlots: [],
    },
    createdAt: new Date().toISOString(),
    effectiveReviewEventId: null,
    updatedAt: input.now(),
  }
}

/**
 * Trusted/admin-side creation of a human-discovered ingredient→step
 * relationship that neither blind reviewer proposed (Implementation 4B,
 * §26.2-26.3). The caller (a future admin-authenticated API route) is
 * responsible for verifying the acting identity and passing that verified
 * uid as `input.addedBy` — never a client-supplied field, matching
 * `appendMappingReviewDecision`'s convention.
 *
 * Validation order (fail closed throughout, Phase 5):
 *   1. proposal exists and is READY;
 *   2. `input.source` recomputes to exactly `input.recipeRevision` AND the
 *      persisted proposal's own `recipeRevision` — a stale/changed recipe
 *      never gets a relationship added against its old mapping source;
 *   3. structural validity — reuses `validateMappingCandidateStructure`
 *      exactly, so a human add fails for the identical reasons (invalid/
 *      header ingredient row, invalid step, source-snapshot mismatch) an
 *      AI-discovered candidate would.
 *
 * Candidate identity is the existing frozen `mc1:` tuple
 * (recipeId/recipeRevision/ingredientRowIndex/stepIndex) — unchanged and
 * origin-independent (§26.3's "one canonical identity" invariant), so if an
 * AI-discovered candidate already occupies this identity, no duplicate is
 * ever created; the existing candidate is returned untouched instead
 * (`ALREADY_AI_DISCOVERED`).
 *
 * The relationship's initial ACCEPT — and any later re-add after a removal —
 * is recorded through the exact same `appendMappingReviewDecision` append-
 * only mechanism ordinary human candidate review uses (this is the "creation
 * is an append-only event" requirement from Phase 7: a first ACCEPT decision
 * on a freshly created candidate *is* the add event, not a second parallel
 * event-type system), which is also what makes this call idempotent for an
 * exact replay.
 */
export async function addHumanMappingRelationship(
  input: AddHumanMappingRelationshipInput,
  options: AddHumanMappingRelationshipOptions = {},
): Promise<AddHumanMappingRelationshipResult> {
  const db = resolveMappingFirestore(options.db)
  const now = options.now ?? (() => new Date().toISOString())

  const proposal = await getMappingProposal(input.recipeId, input.proposalId, db)
  if (!proposal) {
    throw new AddHumanMappingRelationshipRejectedError('PROPOSAL_NOT_FOUND', `No proposal ${input.proposalId} exists for this recipe`)
  }
  if (proposal.persistenceStatus !== 'READY') {
    throw new AddHumanMappingRelationshipRejectedError('PROPOSAL_NOT_READY', 'Proposal has not finished writing its candidate population')
  }

  const computedRevision = await computeMappingRecipeRevision(input.source)
  if (computedRevision !== input.recipeRevision || computedRevision !== proposal.recipeRevision) {
    throw new AddHumanMappingRelationshipRejectedError(
      'REVISION_MISMATCH',
      'The recipe source has changed since this proposal was generated; a human relationship cannot be added to a stale proposal',
    )
  }

  const candidateId = await computeMappingCandidateId({
    recipeId: input.recipeId,
    recipeRevision: computedRevision,
    ingredientRowIndex: input.ingredientRowIndex,
    stepIndex: input.stepIndex,
  })
  const structuralCandidate = {
    candidateId,
    recipeId: input.recipeId,
    recipeRevision: computedRevision,
    parserVersion: input.source.parserVersion,
    mappingSourceHash: proposal.mappingSourceHash,
    ingredientRowIndex: input.ingredientRowIndex,
    ingredientText: input.source.ingredients[input.ingredientRowIndex] ?? '',
    stepIndex: input.stepIndex,
    stepText: input.source.instructions[input.stepIndex] ?? '',
  }
  const structural = await validateMappingCandidateStructure(structuralCandidate, input.source, [])
  if (!structural.valid) {
    throw new AddHumanMappingRelationshipRejectedError(
      structural.reasons[0],
      `Human-added relationship failed structural validation: ${structural.reasons.join(', ')}`,
    )
  }

  const candidateRef = mappingCandidateDocRef(db, input.recipeId, input.proposalId, candidateId)
  const existingSnap = await candidateRef.get()
  const reasonCode = input.reasonCode ?? 'SOURCE_EXPLICIT_USE'

  let outcome: AddHumanMappingRelationshipOutcome

  if (existingSnap.exists) {
    const existing = existingSnap.data() as unknown as PersistedMappingCandidateV1
    if (existing.provenance.candidateOrigin === 'REVIEWER_UNION') {
      return { outcome: 'ALREADY_AI_DISCOVERED', candidate: existing }
    }
    if (existing.finalDecision === 'ACCEPT') {
      return { outcome: 'ALREADY_HUMAN_ADDED', candidate: existing }
    }
    // existing.finalDecision is REJECT (previously removed) or null
    // (a dangling shell from a prior failed attempt) — either way, append
    // a fresh ACCEPT, superseding whatever effective decision exists.
    await appendMappingReviewDecision({
      recipeId: input.recipeId,
      proposalId: input.proposalId,
      candidateId,
      recipeRevision: computedRevision,
      decision: 'ACCEPT',
      reasonCode,
      note: input.note ?? null,
      decidedBy: input.addedBy,
      supersedesDecisionId: existing.effectiveReviewEventId ?? undefined,
    }, { db, now })
    outcome = existing.finalDecision === 'REJECT' ? 'RESTORED' : 'CREATED'
  } else {
    const shell = freshHumanAddedCandidateShell({
      candidateId,
      proposalId: input.proposalId,
      recipeId: input.recipeId,
      recipeRevision: computedRevision,
      proposalMappingSourceHash: proposal.mappingSourceHash,
      proposalReviewerContractVersion: proposal.reviewerContractVersion,
      now,
      ingredientRowIndex: input.ingredientRowIndex,
      ingredientText: structuralCandidate.ingredientText,
      ingredientGroup: mappingIngredientGroup(input.source, input.ingredientRowIndex),
      stepIndex: input.stepIndex,
      stepText: structuralCandidate.stepText,
      parserVersion: input.source.parserVersion,
    })
    await candidateRef.set(shell as unknown as Record<string, unknown>)
    await appendMappingReviewDecision({
      recipeId: input.recipeId,
      proposalId: input.proposalId,
      candidateId,
      recipeRevision: computedRevision,
      decision: 'ACCEPT',
      reasonCode,
      note: input.note ?? null,
      decidedBy: input.addedBy,
    }, { db, now })
    outcome = 'CREATED'
  }

  const finalSnap = await candidateRef.get()
  return { outcome, candidate: finalSnap.data() as unknown as PersistedMappingCandidateV1 }
}

export interface RemoveHumanMappingRelationshipOptions {
  db?: MappingFirestoreLike
  now?: () => unknown
}

/**
 * Correction/removal for a `HUMAN_ADDED` relationship (Implementation 4B,
 * Phase 8) — a thin, explicitly-named wrapper around the exact same
 * append-only `appendMappingReviewDecision` mechanism ordinary AI-candidate
 * review corrections use: it submits a REJECT decision superseding the
 * candidate's current effective decision. The original ACCEPT event is never
 * edited or deleted — only the materialized current state moves to
 * REJECT/excluded (§26.8). Refuses to act on a `REVIEWER_UNION` candidate
 * (use ordinary review correction for those instead, via
 * `appendMappingReviewDecision` directly), so the audit trail always shows
 * which flow acted on a given candidate.
 */
export async function removeHumanMappingRelationship(
  input: RemoveHumanMappingRelationshipInput,
  options: RemoveHumanMappingRelationshipOptions = {},
): Promise<PersistedMappingReviewDecisionV1> {
  const db = resolveMappingFirestore(options.db)
  const snap = await mappingCandidateDocRef(db, input.recipeId, input.proposalId, input.candidateId).get()
  if (!snap.exists) {
    throw new RemoveHumanMappingRelationshipRejectedError('CANDIDATE_NOT_FOUND', `No candidate ${input.candidateId} exists for this proposal`)
  }
  const candidate = snap.data() as unknown as PersistedMappingCandidateV1
  if (candidate.provenance.candidateOrigin !== 'HUMAN_ADDED') {
    throw new RemoveHumanMappingRelationshipRejectedError('NOT_HUMAN_ADDED', 'Only a HUMAN_ADDED candidate can be removed through this call')
  }
  return appendMappingReviewDecision({
    recipeId: input.recipeId,
    proposalId: input.proposalId,
    candidateId: input.candidateId,
    recipeRevision: input.recipeRevision,
    decision: 'REJECT',
    reasonCode: input.reasonCode,
    note: input.note ?? null,
    decidedBy: input.removedBy,
    supersedesDecisionId: candidate.effectiveReviewEventId ?? undefined,
  }, { db, now: options.now })
}

/**
 * Every `HUMAN_ADDED` candidate for a proposal, regardless of current
 * decision (Phase 16: "read current human-added relationships"). Filters the
 * same full population `listMappingCandidates` already reads — no separate
 * query/index, matching this module's existing no-composite-index design.
 */
export async function listHumanAddedMappingRelationships(
  recipeId: string,
  proposalId: string,
  db?: MappingFirestoreLike,
): Promise<PersistedMappingCandidateV1[]> {
  const all = await listMappingCandidates(recipeId, proposalId, db)
  return all.filter(candidate => candidate.provenance.candidateOrigin === 'HUMAN_ADDED')
}
