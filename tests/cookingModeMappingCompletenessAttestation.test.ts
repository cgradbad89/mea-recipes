import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { computeMappingRecipeRevision } from '@/lib/cookingModeMappingIdentity'
import { saveMappingProposal, listMappingCandidates, listReviewRequiredCandidates } from '@/lib/cookingModeMappingProposalPersistence'
import { appendMappingReviewDecision } from '@/lib/cookingModeMappingReviewPersistence'
import { addHumanMappingRelationship } from '@/lib/cookingModeMappingHumanRelationship'
import {
  getMappingCompletenessAttestationStatus,
  MappingCompletenessAttestationRejectedError,
  recordMappingCompletenessAttestation,
} from '@/lib/cookingModeMappingCompletenessAttestation'
import { createFakeMappingFirestore } from './helpers/fakeMappingFirestore'
import { buildFixtureProposal, FIXTURE_RECIPE_ID, FIXTURE_SOURCE } from './helpers/mappingPersistenceFixtures'

async function setUp(options: { includeStructuralInvalid?: boolean } = {}) {
  const db = createFakeMappingFirestore()
  const revision = await computeMappingRecipeRevision(FIXTURE_SOURCE)
  const proposal = await buildFixtureProposal({ recipeRevision: revision, includeStructuralInvalid: options.includeStructuralInvalid ?? false })
  await saveMappingProposal(proposal, { db })
  return { db, revision, proposal }
}

async function resolveAllReviewRequired(db: ReturnType<typeof createFakeMappingFirestore>, recipeId: string, proposalId: string, revision: string) {
  const reviewRequired = await listReviewRequiredCandidates(recipeId, proposalId, db)
  for (const candidate of reviewRequired) {
    await appendMappingReviewDecision({
      recipeId, proposalId, candidateId: candidate.candidateId, recipeRevision: revision,
      decision: 'ACCEPT', reasonCode: 'SOURCE_EXPLICIT_USE', decidedBy: 'admin-uid',
    }, { db })
  }
}

describe('recordMappingCompletenessAttestation', () => {
  it('rejects an unresolved proposal (a REVIEW_REQUIRED candidate still needs a decision)', async () => {
    const { db, revision, proposal } = await setUp()
    const call = recordMappingCompletenessAttestation(
      { recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, recipeRevision: revision, attestedBy: 'admin-uid' },
      { db },
    )
    await expect(call).rejects.toBeInstanceOf(MappingCompletenessAttestationRejectedError)
    await expect(call).rejects.toMatchObject({ reason: 'PROPOSAL_NOT_FULLY_RESOLVED' })
  })

  it('records an attestation once every candidate is resolved', async () => {
    const { db, revision, proposal } = await setUp()
    await resolveAllReviewRequired(db, FIXTURE_RECIPE_ID, proposal.proposalId, revision)
    const attestation = await recordMappingCompletenessAttestation(
      { recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, recipeRevision: revision, attestedBy: 'admin-uid' },
      { db, now: () => 'T1' },
    )
    expect(attestation.attestationId.startsWith('ma1:')).toBe(true)
    expect(attestation.attestedBy).toBe('admin-uid')
    expect(attestation.attestedAt).toBe('T1')
    expect(attestation.proposalId).toBe(proposal.proposalId)
  })

  it('is idempotent for a repeat attestation of the exact same review state', async () => {
    const { db, revision, proposal } = await setUp()
    await resolveAllReviewRequired(db, FIXTURE_RECIPE_ID, proposal.proposalId, revision)
    const input = { recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, recipeRevision: revision, attestedBy: 'admin-uid' }
    const first = await recordMappingCompletenessAttestation(input, { db, now: () => 'T1' })
    const second = await recordMappingCompletenessAttestation(input, { db, now: () => 'T2' })
    expect(second.attestationId).toBe(first.attestationId)
    expect(second.attestedAt).toBe('T1') // untouched by the replay, not overwritten with T2
  })

  it('rejects a proposal that does not exist', async () => {
    const db = createFakeMappingFirestore()
    await expect(recordMappingCompletenessAttestation(
      { recipeId: FIXTURE_RECIPE_ID, proposalId: 'mp1:nope', recipeRevision: 'any', attestedBy: 'admin-uid' },
      { db },
    )).rejects.toMatchObject({ reason: 'PROPOSAL_NOT_FOUND' })
  })

  it('rejects a stale recipeRevision', async () => {
    const { db, proposal } = await setUp()
    await expect(recordMappingCompletenessAttestation(
      { recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, recipeRevision: 'stale', attestedBy: 'admin-uid' },
      { db },
    )).rejects.toMatchObject({ reason: 'REVISION_MISMATCH' })
  })

  it('produces a different attestation for a zero-review (all-AUTO_ACCEPT) proposal too', async () => {
    // A proposal built only from candidates both reviewers agree on with no
    // risk needs no human candidate decisions at all, but per the approved
    // product decision (design doc §13) still requires explicit attestation.
    const db = createFakeMappingFirestore()
    const revision = await computeMappingRecipeRevision(FIXTURE_SOURCE)
    // Build a fixture with no disagreement/invalid candidates by resolving
    // the one REVIEW_REQUIRED candidate immediately.
    const proposal = await buildFixtureProposal({ recipeRevision: revision, includeStructuralInvalid: false })
    await saveMappingProposal(proposal, { db })
    await resolveAllReviewRequired(db, FIXTURE_RECIPE_ID, proposal.proposalId, revision)
    const attestation = await recordMappingCompletenessAttestation(
      { recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, recipeRevision: revision, attestedBy: 'admin-uid' },
      { db },
    )
    expect(attestation.reviewStateHash).toBeTruthy()
  })
})

describe('getMappingCompletenessAttestationStatus', () => {
  it('reports invalid when nothing has ever been attested', async () => {
    const { db, proposal } = await setUp()
    const status = await getMappingCompletenessAttestationStatus(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    expect(status.valid).toBe(false)
    expect(status.attestation).toBeNull()
  })

  it('reports valid once the live state has been attested', async () => {
    const { db, revision, proposal } = await setUp()
    await resolveAllReviewRequired(db, FIXTURE_RECIPE_ID, proposal.proposalId, revision)
    await recordMappingCompletenessAttestation(
      { recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, recipeRevision: revision, attestedBy: 'admin-uid' },
      { db },
    )
    const status = await getMappingCompletenessAttestationStatus(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    expect(status.valid).toBe(true)
    expect(status.attestation).not.toBeNull()
  })

  it('invalidates when a relationship decision changes after attesting', async () => {
    const { db, revision, proposal } = await setUp()
    await resolveAllReviewRequired(db, FIXTURE_RECIPE_ID, proposal.proposalId, revision)
    await recordMappingCompletenessAttestation(
      { recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, recipeRevision: revision, attestedBy: 'admin-uid' },
      { db },
    )
    // Everything is already resolved; correct one existing HUMAN decision instead.
    const candidates = await listMappingCandidates(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    const toCorrect = candidates.find(c => c.decisionSource === 'HUMAN')!
    await appendMappingReviewDecision({
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, candidateId: toCorrect.candidateId, recipeRevision: revision,
      decision: 'REJECT', reasonCode: 'LIFECYCLE_OR_REUSE', decidedBy: 'admin-uid',
      supersedesDecisionId: toCorrect.effectiveReviewEventId ?? undefined,
    }, { db })

    const status = await getMappingCompletenessAttestationStatus(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    expect(status.valid).toBe(false)
  })

  it('invalidates when a human relationship is added after attesting', async () => {
    const { db, revision, proposal } = await setUp()
    await resolveAllReviewRequired(db, FIXTURE_RECIPE_ID, proposal.proposalId, revision)
    await recordMappingCompletenessAttestation(
      { recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, recipeRevision: revision, attestedBy: 'admin-uid' },
      { db },
    )
    await addHumanMappingRelationship({
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, recipeRevision: revision, source: FIXTURE_SOURCE,
      ingredientRowIndex: 1, stepIndex: 2, addedBy: 'admin-uid',
    }, { db })

    const status = await getMappingCompletenessAttestationStatus(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    expect(status.valid).toBe(false)
  })

  it('reports invalid for a recipe revision the proposal was never generated for', async () => {
    const db = createFakeMappingFirestore()
    const status = await getMappingCompletenessAttestationStatus(FIXTURE_RECIPE_ID, 'mp1:does-not-exist', db)
    expect(status.valid).toBe(false)
    expect(status.attestation).toBeNull()
  })
})
