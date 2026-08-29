import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { computeMappingRecipeRevision } from '@/lib/cookingModeMappingIdentity'
import { saveMappingProposal } from '@/lib/cookingModeMappingProposalPersistence'
import { appendMappingReviewDecision } from '@/lib/cookingModeMappingReviewPersistence'
import { listMappingCandidates, listReviewRequiredCandidates } from '@/lib/cookingModeMappingProposalPersistence'
import { recordMappingCompletenessAttestation } from '@/lib/cookingModeMappingCompletenessAttestation'
import {
  buildApprovedMapping,
  getApprovedMapping,
  getCurrentApprovedMappingPointer,
  MappingPersistenceConflictError,
  persistApprovedMapping,
  updateCurrentApprovedMappingPointer,
} from '@/lib/cookingModeMappingApprovedPersistence'
import type {
  ApprovedMapProvenanceV1,
  BuildApprovedMappingInput,
  PersistedMappingCompletenessAttestationV1,
} from '@/types/cookingModeMappingPersistence'
import { approvedMappingDocRef } from '@/lib/cookingModeMappingFirestore'
import { createFakeMappingFirestore } from './helpers/fakeMappingFirestore'
import { buildFixtureProposal, FIXTURE_RECIPE_ID, FIXTURE_SOURCE } from './helpers/mappingPersistenceFixtures'

const PROVENANCE: ApprovedMapProvenanceV1 = {
  reviewerARunId: 'run-a',
  reviewerBRunId: 'run-b',
  reviewerAOutputHash: 'hash-a-fixture',
  reviewerBOutputHash: 'hash-b-fixture',
  autoAcceptCandidateCount: 3,
  humanDecidedCandidateCount: 1,
}

function baseBuildInput(overrides: Partial<BuildApprovedMappingInput> & Pick<BuildApprovedMappingInput, 'candidates' | 'proposalBlockingReasons' | 'proposalId' | 'recipeRevision'>): BuildApprovedMappingInput {
  return {
    recipeId: FIXTURE_RECIPE_ID,
    parserVersion: FIXTURE_SOURCE.parserVersion,
    mappingSourceHash: 'unused-in-these-tests',
    reviewerContractVersion: 'cooking-mapping-reviewer-v1',
    evidenceContractVersion: 'cooking-routing-evidence-v1',
    routingContractVersion: 'cooking-review-routing-v1',
    approvedBy: 'admin-uid',
    completenessAttestation: null,
    provenance: PROVENANCE,
    ...overrides,
  }
}

async function setUpResolvableProposal(options: { includeStructuralInvalid?: boolean } = {}) {
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

/** Records the completeness attestation the given (already-fully-resolved) proposal's live candidate population requires before `buildApprovedMapping` will succeed. */
async function attestFixture(
  db: ReturnType<typeof createFakeMappingFirestore>,
  recipeId: string,
  proposalId: string,
  recipeRevision: string,
): Promise<PersistedMappingCompletenessAttestationV1> {
  return recordMappingCompletenessAttestation(
    { recipeId, proposalId, recipeRevision, attestedBy: 'admin-uid' },
    { db, now: () => '2026-08-28T00:00:00.000Z' },
  )
}

describe('buildApprovedMapping', () => {
  it('blocks on an unresolved REVIEW_REQUIRED candidate', async () => {
    const { db, revision, proposal } = await setUpResolvableProposal()
    const candidates = await listMappingCandidates(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    const outcome = await buildApprovedMapping(baseBuildInput({
      proposalId: proposal.proposalId, recipeRevision: revision, candidates, proposalBlockingReasons: [],
    }))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toBe('UNRESOLVED_CANDIDATE')
  })

  it('blocks when the proposal itself recorded a reviewer-incomplete failure', async () => {
    const { db, revision, proposal } = await setUpResolvableProposal()
    await resolveAllReviewRequired(db, FIXTURE_RECIPE_ID, proposal.proposalId, revision)
    const candidates = await listMappingCandidates(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    const outcome = await buildApprovedMapping(baseBuildInput({
      proposalId: proposal.proposalId, recipeRevision: revision, candidates,
      proposalBlockingReasons: ['REVIEWER_B_INCOMPLETE'],
    }))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toBe('PROPOSAL_BLOCKED')
  })

  it('blocks when any candidate is structurally invalid (AUTO_REJECT)', async () => {
    const { db, revision, proposal } = await setUpResolvableProposal({ includeStructuralInvalid: true })
    await resolveAllReviewRequired(db, FIXTURE_RECIPE_ID, proposal.proposalId, revision)
    const candidates = await listMappingCandidates(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    const outcome = await buildApprovedMapping(baseBuildInput({
      proposalId: proposal.proposalId, recipeRevision: revision, candidates, proposalBlockingReasons: [],
    }))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toBe('STRUCTURAL_BLOCKER')
  })

  it('builds the exact accepted set once every candidate is resolved, with a completeness attestation', async () => {
    const { db, revision, proposal } = await setUpResolvableProposal()
    await resolveAllReviewRequired(db, FIXTURE_RECIPE_ID, proposal.proposalId, revision)
    const candidates = await listMappingCandidates(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    const attestation = await attestFixture(db, FIXTURE_RECIPE_ID, proposal.proposalId, revision)
    const outcome = await buildApprovedMapping(baseBuildInput({
      proposalId: proposal.proposalId, recipeRevision: revision, candidates, proposalBlockingReasons: [],
      completenessAttestation: attestation,
    }))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const acceptedIds = new Set(candidates.filter(c => c.finalDecision === 'ACCEPT').map(c => c.candidateId))
    expect(new Set(outcome.map.relationships.map(r => r.candidateId))).toEqual(acceptedIds)
    expect(outcome.map.relationships.some(r => r.decisionSource === 'HUMAN')).toBe(true)
    expect(outcome.map.approvalMode).toBe('HUMAN_ASSISTED')
    expect(outcome.map.completenessAttestedAt).toBe('2026-08-28T00:00:00.000Z')
    expect(outcome.map.status).toBe('APPROVED')
    expect(outcome.map.mapId.startsWith('am1:')).toBe(true)
  })

  it('excludes REJECTed candidates from the relationship set', async () => {
    const { db, revision, proposal } = await setUpResolvableProposal()
    const reviewRequired = await listReviewRequiredCandidates(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    for (const candidate of reviewRequired) {
      await appendMappingReviewDecision({
        recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, candidateId: candidate.candidateId, recipeRevision: revision,
        decision: 'REJECT', reasonCode: 'LIFECYCLE_OR_REUSE', decidedBy: 'admin-uid',
      }, { db })
    }
    const candidates = await listMappingCandidates(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    const attestation = await attestFixture(db, FIXTURE_RECIPE_ID, proposal.proposalId, revision)
    const outcome = await buildApprovedMapping(baseBuildInput({
      proposalId: proposal.proposalId, recipeRevision: revision, candidates, proposalBlockingReasons: [],
      completenessAttestation: attestation,
    }))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.map.relationships.every(r => candidates.find(c => c.candidateId === r.candidateId)?.finalDecision === 'ACCEPT')).toBe(true)
  })

  it('produces a deterministic mapHash for the same accepted set', async () => {
    const { db, revision, proposal } = await setUpResolvableProposal()
    await resolveAllReviewRequired(db, FIXTURE_RECIPE_ID, proposal.proposalId, revision)
    const candidates = await listMappingCandidates(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    const attestation = await attestFixture(db, FIXTURE_RECIPE_ID, proposal.proposalId, revision)
    const input = baseBuildInput({
      proposalId: proposal.proposalId, recipeRevision: revision, candidates, proposalBlockingReasons: [],
      completenessAttestation: attestation,
    })
    const first = await buildApprovedMapping(input)
    const second = await buildApprovedMapping(input)
    expect(first.ok && second.ok).toBe(true)
    if (first.ok && second.ok) expect(first.map.mapHash).toBe(second.map.mapHash)
  })

  it('rejects when no completeness attestation has been recorded (last candidate decision does not implicitly attest)', async () => {
    const { db, revision, proposal } = await setUpResolvableProposal()
    await resolveAllReviewRequired(db, FIXTURE_RECIPE_ID, proposal.proposalId, revision)
    const candidates = await listMappingCandidates(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    const outcome = await buildApprovedMapping(baseBuildInput({
      proposalId: proposal.proposalId, recipeRevision: revision, candidates, proposalBlockingReasons: [],
      completenessAttestation: null,
    }))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toBe('MISSING_OR_STALE_COMPLETENESS_ATTESTATION')
  })

  it('rejects a stale attestation whose review state no longer matches (a decision changed after attesting)', async () => {
    const { db, revision, proposal } = await setUpResolvableProposal()
    await resolveAllReviewRequired(db, FIXTURE_RECIPE_ID, proposal.proposalId, revision)
    const attestation = await attestFixture(db, FIXTURE_RECIPE_ID, proposal.proposalId, revision)
    // Correct a decision after attesting — the attestation no longer covers the live state.
    const candidatesBeforeChange = await listMappingCandidates(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    const humanDecided = candidatesBeforeChange.find(c => c.decisionSource === 'HUMAN')!
    await appendMappingReviewDecision({
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, candidateId: humanDecided.candidateId, recipeRevision: revision,
      decision: 'REJECT', reasonCode: 'LIFECYCLE_OR_REUSE', decidedBy: 'admin-uid',
      supersedesDecisionId: humanDecided.effectiveReviewEventId ?? undefined,
    }, { db })
    const candidates = await listMappingCandidates(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    const outcome = await buildApprovedMapping(baseBuildInput({
      proposalId: proposal.proposalId, recipeRevision: revision, candidates, proposalBlockingReasons: [],
      completenessAttestation: attestation,
    }))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toBe('MISSING_OR_STALE_COMPLETENESS_ATTESTATION')
  })
})

describe('persistApprovedMapping', () => {
  async function buildResolvedMap(db: ReturnType<typeof createFakeMappingFirestore>) {
    const revision = await computeMappingRecipeRevision(FIXTURE_SOURCE)
    const proposal = await buildFixtureProposal({ recipeRevision: revision, includeStructuralInvalid: false })
    await saveMappingProposal(proposal, { db })
    await resolveAllReviewRequired(db, FIXTURE_RECIPE_ID, proposal.proposalId, revision)
    const candidates = await listMappingCandidates(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    const attestation = await attestFixture(db, FIXTURE_RECIPE_ID, proposal.proposalId, revision)
    const outcome = await buildApprovedMapping(baseBuildInput({
      proposalId: proposal.proposalId, recipeRevision: revision, candidates, proposalBlockingReasons: [],
      completenessAttestation: attestation,
    }))
    if (!outcome.ok) throw new Error('fixture setup expected a buildable map')
    return { revision, proposal, map: outcome.map }
  }

  it('writes a new approved map on first persist', async () => {
    const db = createFakeMappingFirestore()
    const { map } = await buildResolvedMap(db)
    const result = await persistApprovedMapping(map, { db, now: () => 'T1' })
    expect(result.outcome).toBe('CREATED')

    const stored = await getApprovedMapping(FIXTURE_RECIPE_ID, map.mapId, db)
    expect(stored?.mapHash).toBe(map.mapHash)
    expect(stored?.createdAt).toBe('T1')
    expect(stored?.approvedAt).toBe('T1')
  })

  it('is idempotent for an exact replay', async () => {
    const db = createFakeMappingFirestore()
    const { map } = await buildResolvedMap(db)
    await persistApprovedMapping(map, { db, now: () => 'T1' })
    const replay = await persistApprovedMapping(map, { db, now: () => 'T2' })
    expect(replay.outcome).toBe('REPLAYED_IDENTICAL')
    const stored = await getApprovedMapping(FIXTURE_RECIPE_ID, map.mapId, db)
    expect(stored?.createdAt).toBe('T1') // never rewritten by the replay
  })

  it('rejects internally-inconsistent content (mapHash does not match its own fields)', async () => {
    const db = createFakeMappingFirestore()
    const { map } = await buildResolvedMap(db)
    const tampered = { ...map, relationships: [] } // content changed without recomputing mapHash
    await expect(persistApprovedMapping(tampered, { db })).rejects.toBeInstanceOf(MappingPersistenceConflictError)
  })

  it('never mutates an existing approved map: fails closed on a corrupted same-mapId record with different stored content', async () => {
    const db = createFakeMappingFirestore()
    const { map } = await buildResolvedMap(db)
    // Simulate a corrupted/foreign write landing at this mapId out-of-band
    // (never possible through `persistApprovedMapping` itself, since a
    // content change always changes the derived mapId — this exercises the
    // defensive existing-content check directly).
    await approvedMappingDocRef(db, FIXTURE_RECIPE_ID, map.mapId).set({ ...map, relationships: [], mapHash: 'corrupted-hash' })
    await expect(persistApprovedMapping(map, { db })).rejects.toBeInstanceOf(MappingPersistenceConflictError)
  })

  it('rejects a map whose own mapHash does not match its content', async () => {
    const db = createFakeMappingFirestore()
    const { map } = await buildResolvedMap(db)
    await expect(persistApprovedMapping({ ...map, mapHash: 'not-the-real-hash' }, { db }))
      .rejects.toBeInstanceOf(MappingPersistenceConflictError)
  })

  it('preserves multiple immutable approved maps across different recipe revisions', async () => {
    const db = createFakeMappingFirestore()
    const { map: mapV1 } = await buildResolvedMap(db)
    await persistApprovedMapping(mapV1, { db })

    // A second, differently-worded source is a new revision and a new map.
    const revisedSource = { ...FIXTURE_SOURCE, instructions: [...FIXTURE_SOURCE.instructions, 'Cool completely before serving.'] }
    const revisionV2 = await computeMappingRecipeRevision(revisedSource)
    const proposalV2 = await buildFixtureProposal({ recipeRevision: revisionV2, includeStructuralInvalid: false, source: revisedSource })
    expect(proposalV2.recipeRevision).toBe(revisionV2)
    await saveMappingProposal(proposalV2, { db })
    await resolveAllReviewRequired(db, FIXTURE_RECIPE_ID, proposalV2.proposalId, revisionV2)
    const candidatesV2 = await listMappingCandidates(FIXTURE_RECIPE_ID, proposalV2.proposalId, db)
    const attestationV2 = await attestFixture(db, FIXTURE_RECIPE_ID, proposalV2.proposalId, revisionV2)
    const outcomeV2 = await buildApprovedMapping(baseBuildInput({
      proposalId: proposalV2.proposalId, recipeRevision: revisionV2, candidates: candidatesV2, proposalBlockingReasons: [],
      completenessAttestation: attestationV2,
    }))
    expect(outcomeV2.ok).toBe(true)
    if (!outcomeV2.ok) return
    await persistApprovedMapping(outcomeV2.map, { db })

    expect(mapV1.mapId).not.toBe(outcomeV2.map.mapId)
    expect(await getApprovedMapping(FIXTURE_RECIPE_ID, mapV1.mapId, db)).not.toBeNull()
    expect(await getApprovedMapping(FIXTURE_RECIPE_ID, outcomeV2.map.mapId, db)).not.toBeNull()
  })
})

describe('current-approved pointer', () => {
  async function persistedMap(db: ReturnType<typeof createFakeMappingFirestore>) {
    const revision = await computeMappingRecipeRevision(FIXTURE_SOURCE)
    const proposal = await buildFixtureProposal({ recipeRevision: revision, includeStructuralInvalid: false })
    await saveMappingProposal(proposal, { db })
    await resolveAllReviewRequired(db, FIXTURE_RECIPE_ID, proposal.proposalId, revision)
    const candidates = await listMappingCandidates(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    const attestation = await attestFixture(db, FIXTURE_RECIPE_ID, proposal.proposalId, revision)
    const outcome = await buildApprovedMapping(baseBuildInput({
      proposalId: proposal.proposalId, recipeRevision: revision, candidates, proposalBlockingReasons: [],
      completenessAttestation: attestation,
    }))
    if (!outcome.ok) throw new Error('fixture setup expected a buildable map')
    await persistApprovedMapping(outcome.map, { db })
    return { revision, map: outcome.map }
  }

  it('updates the pointer only after the map has been persisted', async () => {
    const db = createFakeMappingFirestore()
    const { revision, map } = await persistedMap(db)
    const pointer = await updateCurrentApprovedMappingPointer(FIXTURE_RECIPE_ID, map.mapId, { db, now: () => 'T1' })
    expect(pointer).toEqual({
      schemaVersion: 1, recipeId: FIXTURE_RECIPE_ID, recipeRevision: revision, mapId: map.mapId, mapHash: map.mapHash, updatedAt: 'T1',
    })
  })

  it('refuses to point at a map that was never persisted', async () => {
    const db = createFakeMappingFirestore()
    await expect(updateCurrentApprovedMappingPointer(FIXTURE_RECIPE_ID, 'am1:never-written', { db }))
      .rejects.toBeInstanceOf(MappingPersistenceConflictError)
  })

  it('reports CURRENT when the pointer revision matches the live recipe revision', async () => {
    const db = createFakeMappingFirestore()
    const { revision, map } = await persistedMap(db)
    await updateCurrentApprovedMappingPointer(FIXTURE_RECIPE_ID, map.mapId, { db })
    const result = await getCurrentApprovedMappingPointer(FIXTURE_RECIPE_ID, revision, db)
    expect(result.status).toBe('CURRENT')
  })

  it('reports STALE when the recipe has moved on to a new revision', async () => {
    const db = createFakeMappingFirestore()
    const { map } = await persistedMap(db)
    await updateCurrentApprovedMappingPointer(FIXTURE_RECIPE_ID, map.mapId, { db })
    const result = await getCurrentApprovedMappingPointer(FIXTURE_RECIPE_ID, 'a-completely-different-revision', db)
    expect(result.status).toBe('STALE')
  })

  it('reports NOT_FOUND when no pointer has ever been written', async () => {
    const db = createFakeMappingFirestore()
    const result = await getCurrentApprovedMappingPointer(FIXTURE_RECIPE_ID, 'any-revision', db)
    expect(result.status).toBe('NOT_FOUND')
    expect(result.pointer).toBeNull()
  })

  it('refuses to point at a map belonging to a different recipe', async () => {
    const db = createFakeMappingFirestore()
    const { map } = await persistedMap(db)
    await expect(updateCurrentApprovedMappingPointer('a-different-recipe', map.mapId, { db }))
      .rejects.toBeInstanceOf(MappingPersistenceConflictError)
  })
})
