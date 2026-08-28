import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { computeMappingRecipeRevision } from '@/lib/cookingModeMappingIdentity'
import { saveMappingProposal } from '@/lib/cookingModeMappingProposalPersistence'
import {
  appendMappingReviewDecision,
  computeProposalCompletion,
  getMappingReviewHistory,
  MappingReviewDecisionRejectedError,
} from '@/lib/cookingModeMappingReviewPersistence'
import { getMappingCandidate, listMappingCandidates, listReviewRequiredCandidates } from '@/lib/cookingModeMappingProposalPersistence'
import { createFakeMappingFirestore } from './helpers/fakeMappingFirestore'
import { buildFixtureProposal, FIXTURE_RECIPE_ID, FIXTURE_SOURCE } from './helpers/mappingPersistenceFixtures'

async function setUp() {
  const db = createFakeMappingFirestore()
  const revision = await computeMappingRecipeRevision(FIXTURE_SOURCE)
  const proposal = await buildFixtureProposal({ recipeRevision: revision })
  await saveMappingProposal(proposal, { db })
  const reviewRequired = await listReviewRequiredCandidates(FIXTURE_RECIPE_ID, proposal.proposalId, db)
  const autoAccepted = (await listMappingCandidates(FIXTURE_RECIPE_ID, proposal.proposalId, db))
    .find(candidate => candidate.routingDecision === 'AUTO_ACCEPT')
  return { db, revision, proposal, reviewRequiredCandidate: reviewRequired[0], autoAcceptedCandidate: autoAccepted! }
}

describe('appendMappingReviewDecision', () => {
  it('records an ACCEPT decision and materializes it on the candidate', async () => {
    const { db, revision, proposal, reviewRequiredCandidate } = await setUp()
    const event = await appendMappingReviewDecision({
      recipeId: FIXTURE_RECIPE_ID,
      proposalId: proposal.proposalId,
      candidateId: reviewRequiredCandidate.candidateId,
      recipeRevision: revision,
      decision: 'ACCEPT',
      reasonCode: 'SOURCE_EXPLICIT_USE',
      decidedBy: 'admin-uid',
    }, { db, now: () => 'T1' })

    expect(event.decision).toBe('ACCEPT')
    expect(event.decidedAt).toBe('T1')
    expect(event.supersedesDecisionId).toBeNull()

    const candidate = await getMappingCandidate(FIXTURE_RECIPE_ID, proposal.proposalId, reviewRequiredCandidate.candidateId, db)
    expect(candidate?.finalDecision).toBe('ACCEPT')
    expect(candidate?.decisionSource).toBe('HUMAN')
    expect(candidate?.reviewStatus).toBe('DECIDED')
    expect(candidate?.effectiveReviewEventId).toBe(event.decisionId)
  })

  it('records a REJECT decision', async () => {
    const { db, revision, proposal, reviewRequiredCandidate } = await setUp()
    const event = await appendMappingReviewDecision({
      recipeId: FIXTURE_RECIPE_ID,
      proposalId: proposal.proposalId,
      candidateId: reviewRequiredCandidate.candidateId,
      recipeRevision: revision,
      decision: 'REJECT',
      reasonCode: 'LIFECYCLE_OR_REUSE',
      decidedBy: 'admin-uid',
    }, { db })
    expect(event.decision).toBe('REJECT')
    const candidate = await getMappingCandidate(FIXTURE_RECIPE_ID, proposal.proposalId, reviewRequiredCandidate.candidateId, db)
    expect(candidate?.finalDecision).toBe('REJECT')
  })

  it('requires a non-empty note when reasonCode is OTHER', async () => {
    const { db, revision, proposal, reviewRequiredCandidate } = await setUp()
    const call = appendMappingReviewDecision({
      recipeId: FIXTURE_RECIPE_ID,
      proposalId: proposal.proposalId,
      candidateId: reviewRequiredCandidate.candidateId,
      recipeRevision: revision,
      decision: 'ACCEPT',
      reasonCode: 'OTHER',
      decidedBy: 'admin-uid',
    }, { db })
    await expect(call).rejects.toBeInstanceOf(MappingReviewDecisionRejectedError)
    await expect(call).rejects.toMatchObject({ reason: 'MISSING_REQUIRED_NOTE' })
  })

  it('rejects a decision for a candidate that does not exist', async () => {
    const { db, revision, proposal } = await setUp()
    await expect(appendMappingReviewDecision({
      recipeId: FIXTURE_RECIPE_ID,
      proposalId: proposal.proposalId,
      candidateId: 'mc1:does-not-exist',
      recipeRevision: revision,
      decision: 'ACCEPT',
      reasonCode: 'SOURCE_EXPLICIT_USE',
      decidedBy: 'admin-uid',
    }, { db })).rejects.toMatchObject({ reason: 'CANDIDATE_NOT_FOUND' })
  })

  it('rejects a decision whose proposalId does not match the candidate', async () => {
    const { db, revision, proposal, reviewRequiredCandidate } = await setUp()
    await expect(appendMappingReviewDecision({
      recipeId: FIXTURE_RECIPE_ID,
      proposalId: 'mp1:wrong-proposal',
      candidateId: reviewRequiredCandidate.candidateId,
      recipeRevision: revision,
      decision: 'ACCEPT',
      reasonCode: 'SOURCE_EXPLICIT_USE',
      decidedBy: 'admin-uid',
    }, { db })).rejects.toMatchObject({ reason: 'CANDIDATE_NOT_FOUND' })
  })

  it('rejects a decision whose recipeRevision is stale', async () => {
    const { db, proposal, reviewRequiredCandidate } = await setUp()
    await expect(appendMappingReviewDecision({
      recipeId: FIXTURE_RECIPE_ID,
      proposalId: proposal.proposalId,
      candidateId: reviewRequiredCandidate.candidateId,
      recipeRevision: 'stale-revision',
      decision: 'ACCEPT',
      reasonCode: 'SOURCE_EXPLICIT_USE',
      decidedBy: 'admin-uid',
    }, { db })).rejects.toMatchObject({ reason: 'REVISION_MISMATCH' })
  })

  it('rejects a decision on a candidate that is not REVIEW_REQUIRED (e.g. already AUTO_ACCEPT)', async () => {
    const { db, revision, proposal, autoAcceptedCandidate } = await setUp()
    await expect(appendMappingReviewDecision({
      recipeId: FIXTURE_RECIPE_ID,
      proposalId: proposal.proposalId,
      candidateId: autoAcceptedCandidate.candidateId,
      recipeRevision: revision,
      decision: 'ACCEPT',
      reasonCode: 'SOURCE_EXPLICIT_USE',
      decidedBy: 'admin-uid',
    }, { db })).rejects.toMatchObject({ reason: 'CANDIDATE_NOT_REVIEW_REQUIRED' })
  })

  it('is idempotent for an exact replay of the same decision content', async () => {
    const { db, revision, proposal, reviewRequiredCandidate } = await setUp()
    const input = {
      recipeId: FIXTURE_RECIPE_ID,
      proposalId: proposal.proposalId,
      candidateId: reviewRequiredCandidate.candidateId,
      recipeRevision: revision,
      decision: 'ACCEPT' as const,
      reasonCode: 'SOURCE_EXPLICIT_USE' as const,
      decidedBy: 'admin-uid',
    }
    const first = await appendMappingReviewDecision(input, { db, now: () => 'T1' })
    const second = await appendMappingReviewDecision(input, { db, now: () => 'T2' })
    expect(second.decisionId).toBe(first.decisionId)
    expect(second.decidedAt).toBe('T1') // untouched by the replay
  })

  it('requires an explicit supersession to correct an existing decision', async () => {
    const { db, revision, proposal, reviewRequiredCandidate } = await setUp()
    await appendMappingReviewDecision({
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, candidateId: reviewRequiredCandidate.candidateId,
      recipeRevision: revision, decision: 'ACCEPT', reasonCode: 'SOURCE_EXPLICIT_USE', decidedBy: 'admin-uid',
    }, { db })
    await expect(appendMappingReviewDecision({
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, candidateId: reviewRequiredCandidate.candidateId,
      recipeRevision: revision, decision: 'REJECT', reasonCode: 'LIFECYCLE_OR_REUSE', decidedBy: 'admin-uid',
    }, { db })).rejects.toMatchObject({ reason: 'MISSING_SUPERSESSION_FOR_CORRECTION' })
  })

  it('rejects a supersession that does not reference the current effective decision', async () => {
    const { db, revision, proposal, reviewRequiredCandidate } = await setUp()
    await appendMappingReviewDecision({
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, candidateId: reviewRequiredCandidate.candidateId,
      recipeRevision: revision, decision: 'ACCEPT', reasonCode: 'SOURCE_EXPLICIT_USE', decidedBy: 'admin-uid',
    }, { db })
    await expect(appendMappingReviewDecision({
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, candidateId: reviewRequiredCandidate.candidateId,
      recipeRevision: revision, decision: 'REJECT', reasonCode: 'LIFECYCLE_OR_REUSE', decidedBy: 'admin-uid',
      supersedesDecisionId: 'mr1:not-the-real-one',
    }, { db })).rejects.toMatchObject({ reason: 'INVALID_SUPERSESSION' })
  })

  it('accepts a correction that properly supersedes the current effective decision and preserves the old event', async () => {
    const { db, revision, proposal, reviewRequiredCandidate } = await setUp()
    const original = await appendMappingReviewDecision({
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, candidateId: reviewRequiredCandidate.candidateId,
      recipeRevision: revision, decision: 'ACCEPT', reasonCode: 'SOURCE_EXPLICIT_USE', decidedBy: 'admin-uid',
    }, { db })
    const correction = await appendMappingReviewDecision({
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, candidateId: reviewRequiredCandidate.candidateId,
      recipeRevision: revision, decision: 'REJECT', reasonCode: 'LIFECYCLE_OR_REUSE', decidedBy: 'admin-uid',
      supersedesDecisionId: original.decisionId,
    }, { db })

    expect(correction.supersedesDecisionId).toBe(original.decisionId)
    const candidate = await getMappingCandidate(FIXTURE_RECIPE_ID, proposal.proposalId, reviewRequiredCandidate.candidateId, db)
    expect(candidate?.finalDecision).toBe('REJECT')
    expect(candidate?.effectiveReviewEventId).toBe(correction.decisionId)

    const history = await getMappingReviewHistory(FIXTURE_RECIPE_ID, proposal.proposalId, reviewRequiredCandidate.candidateId, db)
    expect(history.map(e => e.decisionId)).toEqual([original.decisionId, correction.decisionId])
    expect(history[0].decision).toBe('ACCEPT') // the superseded event's content is preserved, not edited
  })
})

describe('computeProposalCompletion', () => {
  it('treats AUTO_ACCEPT/AUTO_REJECT candidates as already resolved', async () => {
    const { db, proposal } = await setUp()
    const candidates = await listMappingCandidates(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    const autoOnly = candidates.filter(c => c.routingDecision !== 'REVIEW_REQUIRED')
    const completion = computeProposalCompletion(autoOnly)
    expect(completion.complete).toBe(true)
    expect(completion.unresolvedCandidateIds).toEqual([])
  })

  it('is incomplete while any REVIEW_REQUIRED candidate lacks a final decision', async () => {
    const { db, proposal } = await setUp()
    const candidates = await listMappingCandidates(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    const completion = computeProposalCompletion(candidates)
    expect(completion.complete).toBe(false)
    expect(completion.unresolvedCandidateIds.length).toBeGreaterThan(0)
  })

  it('becomes complete once every REVIEW_REQUIRED candidate has a human decision', async () => {
    const { db, revision, proposal, reviewRequiredCandidate } = await setUp()
    await appendMappingReviewDecision({
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, candidateId: reviewRequiredCandidate.candidateId,
      recipeRevision: revision, decision: 'ACCEPT', reasonCode: 'SOURCE_EXPLICIT_USE', decidedBy: 'admin-uid',
    }, { db })
    const candidates = await listMappingCandidates(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    const completion = computeProposalCompletion(candidates)
    expect(completion.complete).toBe(true)
    expect(completion.requiresCompletenessAttestation).toBe(true)
  })
})
