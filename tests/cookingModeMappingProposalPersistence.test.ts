import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { computeMappingRecipeRevision } from '@/lib/cookingModeMappingIdentity'
import { appendMappingReviewDecision } from '@/lib/cookingModeMappingReviewPersistence'
import {
  getMappingCandidate,
  getMappingProposal,
  listMappingCandidates,
  listReviewRequiredCandidates,
  MappingPersistenceConflictError,
  MappingPersistenceFailureError,
  saveMappingProposal,
} from '@/lib/cookingModeMappingProposalPersistence'
import { createFakeMappingFirestore } from './helpers/fakeMappingFirestore'
import { buildFixtureProposal, FIXTURE_RECIPE_ID, FIXTURE_SOURCE } from './helpers/mappingPersistenceFixtures'

async function fixtureRevision() {
  return computeMappingRecipeRevision(FIXTURE_SOURCE)
}

describe('saveMappingProposal', () => {
  it('writes the proposal header with a READY status and correct summary', async () => {
    const db = createFakeMappingFirestore()
    const revision = await fixtureRevision()
    const proposal = await buildFixtureProposal({ recipeRevision: revision })

    const result = await saveMappingProposal(proposal, { db, now: () => 'T0' })
    expect(result.outcome).toBe('CREATED')
    expect(result.candidateCount).toBe(proposal.candidates.length)

    const stored = await getMappingProposal(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    expect(stored?.persistenceStatus).toBe('READY')
    expect(stored?.summary).toEqual(proposal.summary)
    expect(stored?.candidateCount).toBe(proposal.candidates.length)
    expect(stored?.approvalBlocked).toBe(true) // review-required + structurally-invalid candidates present
  })

  it('writes the full candidate population, one document per candidate', async () => {
    const db = createFakeMappingFirestore()
    const revision = await fixtureRevision()
    const proposal = await buildFixtureProposal({ recipeRevision: revision })

    await saveMappingProposal(proposal, { db })
    const candidates = await listMappingCandidates(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    expect(candidates).toHaveLength(proposal.candidates.length)
    expect(new Set(candidates.map(c => c.candidateId))).toEqual(new Set(proposal.candidates.map(c => c.candidateId)))
  })

  it('readback count reconciles with the proposal candidate count', async () => {
    const db = createFakeMappingFirestore()
    const revision = await fixtureRevision()
    const proposal = await buildFixtureProposal({ recipeRevision: revision })
    await saveMappingProposal(proposal, { db })
    const header = await getMappingProposal(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    const candidates = await listMappingCandidates(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    expect(header?.candidateCount).toBe(candidates.length)
  })

  it('is idempotent for an exact replay of the same proposal', async () => {
    const db = createFakeMappingFirestore()
    const revision = await fixtureRevision()
    const proposal = await buildFixtureProposal({ recipeRevision: revision })

    await saveMappingProposal(proposal, { db, now: () => 'T0' })
    const second = await saveMappingProposal(proposal, { db, now: () => 'T1' })
    expect(second.outcome).toBe('REPLAYED_IDENTICAL')

    const header = await getMappingProposal(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    expect(header?.createdAt).toBe('T0') // createdAt is preserved across the replay, not reset
  })

  it('a replay never resets a candidate materialized by a since-appended human review decision', async () => {
    const db = createFakeMappingFirestore()
    const revision = await fixtureRevision()
    const proposal = await buildFixtureProposal({ recipeRevision: revision })
    await saveMappingProposal(proposal, { db })

    const reviewRequired = (await listReviewRequiredCandidates(FIXTURE_RECIPE_ID, proposal.proposalId, db))[0]
    expect(reviewRequired).toBeDefined()

    await appendMappingReviewDecision({
      recipeId: FIXTURE_RECIPE_ID,
      proposalId: proposal.proposalId,
      candidateId: reviewRequired.candidateId,
      recipeRevision: revision,
      decision: 'ACCEPT',
      reasonCode: 'SOURCE_EXPLICIT_USE',
      decidedBy: 'admin-uid',
    }, { db })
    const stored = await getMappingCandidate(FIXTURE_RECIPE_ID, proposal.proposalId, reviewRequired.candidateId, db)
    expect(stored?.finalDecision).toBe('ACCEPT')
    expect(stored?.decisionSource).toBe('HUMAN')

    // Replay the identical proposal again — the candidate's generation
    // content is unchanged, so it must be skipped rather than rewritten.
    await saveMappingProposal(proposal, { db })
    const afterReplay = await getMappingCandidate(FIXTURE_RECIPE_ID, proposal.proposalId, reviewRequired.candidateId, db)
    expect(afterReplay).toEqual(stored)
  })

  it('rejects a conflicting proposal header (different candidate population under the same identity)', async () => {
    const db = createFakeMappingFirestore()
    const revision = await fixtureRevision()
    const proposal = await buildFixtureProposal({ recipeRevision: revision })
    await saveMappingProposal(proposal, { db })

    const conflicting = { ...proposal, candidates: proposal.candidates.slice(0, 1), summary: { ...proposal.summary, candidateCount: 1 } }
    await expect(saveMappingProposal(conflicting, { db })).rejects.toBeInstanceOf(MappingPersistenceConflictError)
  })

  it('rejects a conflicting candidate (same identity, different generation content)', async () => {
    const db = createFakeMappingFirestore()
    const revision = await fixtureRevision()
    const proposal = await buildFixtureProposal({ recipeRevision: revision })
    await saveMappingProposal(proposal, { db })

    const mutated = {
      ...proposal,
      candidates: proposal.candidates.map((candidate, index) =>
        index === 0 ? { ...candidate, routingReasons: ['REVIEWER_DISAGREEMENT'] as const } : candidate),
    }
    await expect(saveMappingProposal(mutated as typeof proposal, { db })).rejects.toBeInstanceOf(MappingPersistenceConflictError)
  })

  it('rejects when the proposal identity does not match its own deterministic tuple', async () => {
    const db = createFakeMappingFirestore()
    const revision = await fixtureRevision()
    const proposal = await buildFixtureProposal({ recipeRevision: revision })
    await expect(saveMappingProposal({ ...proposal, proposalId: 'mp1:wrong' }, { db }))
      .rejects.toBeInstanceOf(MappingPersistenceConflictError)
  })

  it('rejects when a candidate identity does not match its own deterministic tuple', async () => {
    const db = createFakeMappingFirestore()
    const revision = await fixtureRevision()
    const proposal = await buildFixtureProposal({ recipeRevision: revision })
    const tampered = {
      ...proposal,
      candidates: proposal.candidates.map((candidate, index) => (index === 0 ? { ...candidate, candidateId: 'mc1:wrong' } : candidate)),
    }
    await expect(saveMappingProposal(tampered, { db })).rejects.toBeInstanceOf(MappingPersistenceConflictError)
  })

  it('a partial candidate write never leaves the proposal claiming READY', async () => {
    const revision = await fixtureRevision()
    const proposal = await buildFixtureProposal({ recipeRevision: revision })
    const poisoned = proposal.candidates[0].candidateId
    const db = createFakeMappingFirestore({ poisonedDocIds: new Set([poisoned]) })

    await expect(saveMappingProposal(proposal, { db })).rejects.toBeInstanceOf(MappingPersistenceFailureError)
    const header = await getMappingProposal(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    expect(header?.persistenceStatus).toBe('FAILED')
  })

  it('rejects a proposal whose recipe revision conflicts with an existing header', async () => {
    const db = createFakeMappingFirestore()
    const revision = await fixtureRevision()
    const proposal = await buildFixtureProposal({ recipeRevision: revision })
    await saveMappingProposal(proposal, { db })

    // Force a header-identity collision under a different revision — this
    // cannot happen from real deterministic proposalIds, but the guard must
    // still fail closed if it is ever observed.
    const forgedSameId = { ...proposal, recipeRevision: `${revision}-mutated` }
    await expect(saveMappingProposal(forgedSameId, { db })).rejects.toBeInstanceOf(MappingPersistenceConflictError)
  })
})

describe('listReviewRequiredCandidates', () => {
  it('returns only candidates without an effective final decision', async () => {
    const db = createFakeMappingFirestore()
    const revision = await fixtureRevision()
    const proposal = await buildFixtureProposal({ recipeRevision: revision })
    await saveMappingProposal(proposal, { db })

    const reviewRequired = await listReviewRequiredCandidates(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    expect(reviewRequired.every(candidate => candidate.finalDecision === null)).toBe(true)
    expect(reviewRequired.every(candidate => candidate.routingDecision === 'REVIEW_REQUIRED')).toBe(true)
    expect(reviewRequired.length).toBeGreaterThan(0)
  })
})
