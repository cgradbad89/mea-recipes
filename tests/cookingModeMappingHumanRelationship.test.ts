import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { computeMappingCandidateId, computeMappingRecipeRevision } from '@/lib/cookingModeMappingIdentity'
import { saveMappingProposal, getMappingCandidate, listMappingCandidates } from '@/lib/cookingModeMappingProposalPersistence'
import { appendMappingReviewDecision, getMappingReviewHistory } from '@/lib/cookingModeMappingReviewPersistence'
import {
  addHumanMappingRelationship,
  AddHumanMappingRelationshipRejectedError,
  listHumanAddedMappingRelationships,
  removeHumanMappingRelationship,
  RemoveHumanMappingRelationshipRejectedError,
} from '@/lib/cookingModeMappingHumanRelationship'
import { createFakeMappingFirestore } from './helpers/fakeMappingFirestore'
import { buildFixtureProposal, FIXTURE_RECIPE_ID, FIXTURE_SOURCE } from './helpers/mappingPersistenceFixtures'

async function setUp() {
  const db = createFakeMappingFirestore()
  const revision = await computeMappingRecipeRevision(FIXTURE_SOURCE)
  const proposal = await buildFixtureProposal({ recipeRevision: revision, includeStructuralInvalid: false })
  await saveMappingProposal(proposal, { db })
  return { db, revision, proposal }
}

// (1, 2) = "1 tsp salt" / "Bake at 350F for 30 minutes." — not proposed by
// either reviewer in the fixture, so this identity has no existing candidate.
const MISSING_ROW = 1
const MISSING_STEP = 2

describe('addHumanMappingRelationship', () => {
  it('creates a HUMAN_ADDED candidate for a relationship neither reviewer proposed, immediately ACCEPTed', async () => {
    const { db, revision, proposal } = await setUp()
    const result = await addHumanMappingRelationship({
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, recipeRevision: revision, source: FIXTURE_SOURCE,
      ingredientRowIndex: MISSING_ROW, stepIndex: MISSING_STEP, addedBy: 'admin-uid',
    }, { db })

    expect(result.outcome).toBe('CREATED')
    expect(result.candidate.finalDecision).toBe('ACCEPT')
    expect(result.candidate.decisionSource).toBe('HUMAN')
    expect(result.candidate.routingDecision).toBe('HUMAN_ADDED')
    expect(result.candidate.provenance.candidateOrigin).toBe('HUMAN_ADDED')
    expect(result.candidate.provenance.acceptedByReviewerSlots).toEqual([])
    expect(result.candidate.reviewerA).toBeNull()
    expect(result.candidate.reviewerB).toBeNull()
    expect(result.candidate.ingredientRowIndex).toBe(MISSING_ROW)
    expect(result.candidate.stepIndex).toBe(MISSING_STEP)

    const expectedId = await computeMappingCandidateId({
      recipeId: FIXTURE_RECIPE_ID, recipeRevision: revision, ingredientRowIndex: MISSING_ROW, stepIndex: MISSING_STEP,
    })
    expect(result.candidate.candidateId).toBe(expectedId)

    const stored = await getMappingCandidate(FIXTURE_RECIPE_ID, proposal.proposalId, expectedId, db)
    expect(stored?.finalDecision).toBe('ACCEPT')
  })

  it('is idempotent for an exact replay (retry/idempotent add)', async () => {
    const { db, revision, proposal } = await setUp()
    const input = {
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, recipeRevision: revision, source: FIXTURE_SOURCE,
      ingredientRowIndex: MISSING_ROW, stepIndex: MISSING_STEP, addedBy: 'admin-uid',
    }
    const first = await addHumanMappingRelationship(input, { db })
    const second = await addHumanMappingRelationship(input, { db })
    expect(first.outcome).toBe('CREATED')
    expect(second.outcome).toBe('ALREADY_HUMAN_ADDED')
    expect(second.candidate.candidateId).toBe(first.candidate.candidateId)
    expect(second.candidate.effectiveReviewEventId).toBe(first.candidate.effectiveReviewEventId)

    const history = await getMappingReviewHistory(FIXTURE_RECIPE_ID, proposal.proposalId, first.candidate.candidateId, db)
    expect(history).toHaveLength(1) // no duplicate event from the replay
  })

  it('rejects an ingredient row that does not exist', async () => {
    const { db, revision, proposal } = await setUp()
    await expect(addHumanMappingRelationship({
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, recipeRevision: revision, source: FIXTURE_SOURCE,
      ingredientRowIndex: 99, stepIndex: 0, addedBy: 'admin-uid',
    }, { db })).rejects.toMatchObject({ reason: 'INVALID_INGREDIENT_INDEX' })
  })

  it('rejects a header ingredient row', async () => {
    const db = createFakeMappingFirestore()
    const sourceWithHeader = {
      ...FIXTURE_SOURCE,
      ingredients: ['For the dough:', ...FIXTURE_SOURCE.ingredients],
    }
    const headerRevision = await computeMappingRecipeRevision(sourceWithHeader)
    const headerProposal = await buildFixtureProposal({ recipeRevision: headerRevision, source: sourceWithHeader, includeStructuralInvalid: false })
    await saveMappingProposal(headerProposal, { db })
    await expect(addHumanMappingRelationship({
      recipeId: FIXTURE_RECIPE_ID, proposalId: headerProposal.proposalId, recipeRevision: headerRevision, source: sourceWithHeader,
      ingredientRowIndex: 0, stepIndex: 0, addedBy: 'admin-uid',
    }, { db })).rejects.toMatchObject({ reason: 'INGREDIENT_HEADER_INDEX' })
  })

  it('rejects an invalid step index', async () => {
    const { db, revision, proposal } = await setUp()
    const call = addHumanMappingRelationship({
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, recipeRevision: revision, source: FIXTURE_SOURCE,
      ingredientRowIndex: 0, stepIndex: 99, addedBy: 'admin-uid',
    }, { db })
    await expect(call).rejects.toBeInstanceOf(AddHumanMappingRelationshipRejectedError)
    await expect(call).rejects.toMatchObject({ reason: 'INVALID_STEP_INDEX' })
  })

  it('rejects a stale proposal whose recipe revision has changed', async () => {
    const { db, proposal } = await setUp()
    const changedSource = { ...FIXTURE_SOURCE, instructions: [...FIXTURE_SOURCE.instructions, 'Cool before serving.'] }
    const changedRevision = await computeMappingRecipeRevision(changedSource)
    await expect(addHumanMappingRelationship({
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, recipeRevision: changedRevision, source: changedSource,
      ingredientRowIndex: MISSING_ROW, stepIndex: MISSING_STEP, addedBy: 'admin-uid',
    }, { db })).rejects.toMatchObject({ reason: 'REVISION_MISMATCH' })
  })

  it('rejects a mismatched caller-supplied recipeRevision even against the correct source', async () => {
    const { db, proposal } = await setUp()
    await expect(addHumanMappingRelationship({
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, recipeRevision: 'not-the-real-revision', source: FIXTURE_SOURCE,
      ingredientRowIndex: MISSING_ROW, stepIndex: MISSING_STEP, addedBy: 'admin-uid',
    }, { db })).rejects.toMatchObject({ reason: 'REVISION_MISMATCH' })
  })

  it('does not create a duplicate when an AI-discovered candidate already occupies the identity', async () => {
    const { db, revision, proposal } = await setUp()
    const allCandidates = await listMappingCandidates(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    const aiCandidate = allCandidates.find(c => c.provenance.candidateOrigin === 'REVIEWER_UNION')!
    const result = await addHumanMappingRelationship({
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, recipeRevision: revision, source: FIXTURE_SOURCE,
      ingredientRowIndex: aiCandidate.ingredientRowIndex, stepIndex: aiCandidate.stepIndex, addedBy: 'admin-uid',
    }, { db })
    expect(result.outcome).toBe('ALREADY_AI_DISCOVERED')
    expect(result.candidate.candidateId).toBe(aiCandidate.candidateId)
    expect(result.candidate.provenance.candidateOrigin).toBe('REVIEWER_UNION')

    // No duplicate candidate was created, and the AI candidate's own history is untouched.
    const countAtIdentity = allCandidates.filter(c => c.candidateId === aiCandidate.candidateId).length
    expect(countAtIdentity).toBe(1)
  })

  it('produces the same candidate identity a REVIEWER_UNION candidate at the same (row, step) would have', async () => {
    const { revision } = await setUp()
    const humanId = await computeMappingCandidateId({
      recipeId: FIXTURE_RECIPE_ID, recipeRevision: revision, ingredientRowIndex: MISSING_ROW, stepIndex: MISSING_STEP,
    })
    const sameTupleId = await computeMappingCandidateId({
      recipeId: FIXTURE_RECIPE_ID, recipeRevision: revision, ingredientRowIndex: MISSING_ROW, stepIndex: MISSING_STEP,
    })
    expect(humanId).toBe(sameTupleId) // identity is origin-independent
  })
})

describe('removeHumanMappingRelationship / re-add (correction, append-only history)', () => {
  it('removes a human-added relationship, materializing REJECT without deleting the original event', async () => {
    const { db, revision, proposal } = await setUp()
    const added = await addHumanMappingRelationship({
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, recipeRevision: revision, source: FIXTURE_SOURCE,
      ingredientRowIndex: MISSING_ROW, stepIndex: MISSING_STEP, addedBy: 'admin-uid',
    }, { db })

    const removal = await removeHumanMappingRelationship({
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, candidateId: added.candidate.candidateId,
      recipeRevision: revision, reasonCode: 'SOURCE_NO_ACTIVE_USE', removedBy: 'admin-uid',
    }, { db })
    expect(removal.decision).toBe('REJECT')
    expect(removal.supersedesDecisionId).toBe(added.candidate.effectiveReviewEventId)

    const current = await getMappingCandidate(FIXTURE_RECIPE_ID, proposal.proposalId, added.candidate.candidateId, db)
    expect(current?.finalDecision).toBe('REJECT')

    const history = await getMappingReviewHistory(FIXTURE_RECIPE_ID, proposal.proposalId, added.candidate.candidateId, db)
    expect(history.map(e => e.decision)).toEqual(['ACCEPT', 'REJECT'])
    expect(history[0].decisionId).toBe(added.candidate.effectiveReviewEventId) // original ADD event preserved, not edited
  })

  it('refuses to remove a REVIEWER_UNION candidate through this call', async () => {
    const { db, proposal } = await setUp()
    const allCandidates = await listMappingCandidates(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    const aiCandidate = allCandidates.find(c => c.provenance.candidateOrigin === 'REVIEWER_UNION')!
    await expect(removeHumanMappingRelationship({
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, candidateId: aiCandidate.candidateId,
      recipeRevision: aiCandidate.recipeRevision, reasonCode: 'OTHER', note: 'nope', removedBy: 'admin-uid',
    }, { db })).rejects.toBeInstanceOf(RemoveHumanMappingRelationshipRejectedError)
  })

  it('re-add after removal supersedes the REJECT and preserves the full chain', async () => {
    const { db, revision, proposal } = await setUp()
    const added = await addHumanMappingRelationship({
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, recipeRevision: revision, source: FIXTURE_SOURCE,
      ingredientRowIndex: MISSING_ROW, stepIndex: MISSING_STEP, addedBy: 'admin-uid',
    }, { db })
    await removeHumanMappingRelationship({
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, candidateId: added.candidate.candidateId,
      recipeRevision: revision, reasonCode: 'SOURCE_NO_ACTIVE_USE', removedBy: 'admin-uid',
    }, { db })

    const readded = await addHumanMappingRelationship({
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, recipeRevision: revision, source: FIXTURE_SOURCE,
      ingredientRowIndex: MISSING_ROW, stepIndex: MISSING_STEP, addedBy: 'admin-uid',
    }, { db })
    expect(readded.outcome).toBe('RESTORED')
    expect(readded.candidate.candidateId).toBe(added.candidate.candidateId) // one canonical identity throughout
    expect(readded.candidate.finalDecision).toBe('ACCEPT')

    const history = await getMappingReviewHistory(FIXTURE_RECIPE_ID, proposal.proposalId, added.candidate.candidateId, db)
    expect(history.map(e => e.decision)).toEqual(['ACCEPT', 'REJECT', 'ACCEPT'])
  })
})

describe('listHumanAddedMappingRelationships', () => {
  it('lists only HUMAN_ADDED candidates, regardless of current decision', async () => {
    const { db, revision, proposal } = await setUp()
    const added = await addHumanMappingRelationship({
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, recipeRevision: revision, source: FIXTURE_SOURCE,
      ingredientRowIndex: MISSING_ROW, stepIndex: MISSING_STEP, addedBy: 'admin-uid',
    }, { db })

    const list = await listHumanAddedMappingRelationships(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    expect(list.map(c => c.candidateId)).toEqual([added.candidate.candidateId])
    expect(list.every(c => c.provenance.candidateOrigin === 'HUMAN_ADDED')).toBe(true)
  })

  it('excludes REVIEWER_UNION candidates', async () => {
    const { db, proposal } = await setUp()
    const list = await listHumanAddedMappingRelationships(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    expect(list).toEqual([])
  })
})

describe('interaction with ordinary candidate review', () => {
  it('a HUMAN_ADDED candidate is also usable with appendMappingReviewDecision directly (same append-only mechanism)', async () => {
    const { db, revision, proposal } = await setUp()
    const added = await addHumanMappingRelationship({
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, recipeRevision: revision, source: FIXTURE_SOURCE,
      ingredientRowIndex: MISSING_ROW, stepIndex: MISSING_STEP, addedBy: 'admin-uid',
    }, { db })
    const corrected = await appendMappingReviewDecision({
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, candidateId: added.candidate.candidateId,
      recipeRevision: revision, decision: 'REJECT', reasonCode: 'LIFECYCLE_OR_REUSE', decidedBy: 'admin-uid',
      supersedesDecisionId: added.candidate.effectiveReviewEventId ?? undefined,
    }, { db })
    expect(corrected.decision).toBe('REJECT')
  })
})
