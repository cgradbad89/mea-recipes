import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { createFakeMappingFirestore } from './helpers/fakeMappingFirestore'
import { buildFixtureProposal, FIXTURE_RECIPE_ID } from './helpers/mappingPersistenceFixtures'
import { parseRecipeContent } from '@/lib/recipeContent'
import { COOKING_MAPPING_PARSER_VERSION } from '@/lib/cookingStepMapping'
import { computeMappingRecipeRevision } from '@/lib/cookingModeMappingIdentity'
import { saveMappingProposal } from '@/lib/cookingModeMappingProposalPersistence'
import { buildMappingProposal } from '@/lib/cookingModeMappingProposal'
import { MAPPING_REVIEWER_CONTRACT_VERSION } from '@/types/cookingModeMapping'
import { COOKING_MODE_MAPPING_REVIEWER_PROMPT_VERSION } from '@/lib/aiConfig'
import type { MappingReviewerExecutionResultV1, MappingReviewerRelationshipV1 } from '@/types/cookingModeMapping'
import { appendMappingReviewDecision } from '@/lib/cookingModeMappingReviewPersistence'
import { recordMappingCompletenessAttestation } from '@/lib/cookingModeMappingCompletenessAttestation'
import {
  buildApprovedMapping,
  persistApprovedMapping,
  updateCurrentApprovedMappingPointer,
} from '@/lib/cookingModeMappingApprovedPersistence'
import { loadMappingReviewQueue } from '@/lib/cookingModeMappingReviewQueue'
import type { MappingFirestoreLike } from '@/lib/cookingModeMappingFirestore'
import type { MappingProposalV1, MappingRevisionSource } from '@/types/cookingModeMapping'
import type { Recipe } from '@/types/recipe'

const CONTENT = `INGREDIENTS
2 cups flour
1 tsp salt
1 cup sugar

INSTRUCTIONS
Step 1
Mix the flour and salt.
Step 2
Add the sugar and stir.
Step 3
Bake at 350F for 30 minutes.`

function fixtureRecipe(): Recipe {
  return {
    id: FIXTURE_RECIPE_ID,
    recipeID: FIXTURE_RECIPE_ID,
    title: 'Fixture Recipe',
    content: CONTENT,
    category: 'Dinner',
    cuisine: 'american',
    imageURL: '',
    sourceURL: '',
    sourceFile: '',
    labels: '',
    hasImage: 'false',
    created: '',
    modified: '',
  }
}

async function liveSource(): Promise<MappingRevisionSource> {
  const { ingredients, instructions } = parseRecipeContent(CONTENT)
  expect(ingredients).toHaveLength(3)
  expect(instructions).toHaveLength(3)
  return { recipeId: FIXTURE_RECIPE_ID, parserVersion: COOKING_MAPPING_PARSER_VERSION, ingredients, instructions }
}

async function setup(): Promise<{ db: MappingFirestoreLike; source: MappingRevisionSource; proposal: MappingProposalV1 }> {
  const db = createFakeMappingFirestore()
  const source = await liveSource()
  const recipeRevision = await computeMappingRecipeRevision(source)
  const proposal = await buildFixtureProposal({ recipeRevision, source, includeStructuralInvalid: false })
  await saveMappingProposal(proposal, { db })
  return { db, source, proposal }
}

function reviewerResult(
  slot: 'A' | 'B',
  accepted: MappingReviewerRelationshipV1[],
  recipeRevision: string,
): MappingReviewerExecutionResultV1 {
  return {
    reviewerSlot: slot,
    reviewerContractVersion: MAPPING_REVIEWER_CONTRACT_VERSION,
    promptVersion: COOKING_MODE_MAPPING_REVIEWER_PROMPT_VERSION,
    modelId: 'fixture-model',
    recipeRevision,
    parseStatus: 'VALID',
    acceptedRelationships: accepted,
    coverage: { ingredientRowCount: 3, nonHeaderIngredientRowCount: 3, stepCount: 3, reviewedCellCount: 9 },
    normalizedOutputHash: `hash-${slot.toLowerCase()}`,
    completedAt: '2026-08-28T00:00:00.000Z',
    runId: `run-${slot.toLowerCase()}`,
    attemptId: `attempt-${slot.toLowerCase()}-1`,
    attempt: 1,
    attempts: [{
      reviewerSlot: slot, runId: `run-${slot.toLowerCase()}`, attemptId: `attempt-${slot.toLowerCase()}-1`, attempt: 1,
      startedAt: '2026-08-28T00:00:00.000Z', completedAt: '2026-08-28T00:00:00.000Z',
      parseStatus: 'VALID', outputHash: `hash-${slot.toLowerCase()}`, failure: null, diagnosticCode: null,
    }],
  }
}

/** Two disagreement candidates (unlike `buildFixtureProposal`'s one), so a single decision leaves one unresolved. */
async function setupTwoReviewRequired(): Promise<{ db: MappingFirestoreLike; proposal: MappingProposalV1 }> {
  const db = createFakeMappingFirestore()
  const source = await liveSource()
  const recipeRevision = await computeMappingRecipeRevision(source)
  const bothAccept: MappingReviewerRelationshipV1[] = [
    { ingredientRowIndex: 0, stepIndex: 0 },
    { ingredientRowIndex: 1, stepIndex: 0 },
    { ingredientRowIndex: 2, stepIndex: 1 },
  ]
  const reviewerA = reviewerResult('A', [...bothAccept, { ingredientRowIndex: 0, stepIndex: 2 }, { ingredientRowIndex: 1, stepIndex: 2 }], recipeRevision)
  const reviewerB = reviewerResult('B', bothAccept, recipeRevision)
  const proposal = await buildMappingProposal({
    recipeId: FIXTURE_RECIPE_ID, source, recipeRevision, reviewerA, reviewerB, createdAt: '2026-08-28T00:00:00.000Z',
  })
  await saveMappingProposal(proposal, { db })
  return { db, proposal }
}

function loadOptions(db: MappingFirestoreLike) {
  return {
    db,
    listHeaders: async () => {
      const snap = await db.collection('recipes').doc(FIXTURE_RECIPE_ID).collection('mappingProposals').get()
      return snap.docs.map(d => d.data() as never)
    },
    getRecipe: async () => fixtureRecipe(),
  }
}

describe('loadMappingReviewQueue', () => {
  it('reports NEEDS_REVIEW when a review-required candidate has no decisions yet', async () => {
    const { db } = await setup()
    const entries = await loadMappingReviewQueue(loadOptions(db))
    expect(entries).toHaveLength(1)
    expect(entries[0].status).toBe('NEEDS_REVIEW')
    expect(entries[0].recipeTitle).toBe('Fixture Recipe')
  })

  it('reports IN_PROGRESS once at least one human decision exists but candidates remain unresolved', async () => {
    const { db, proposal } = await setupTwoReviewRequired()
    const [first] = proposal.candidates.filter(c => c.routingDecision === 'REVIEW_REQUIRED')
    await appendMappingReviewDecision({
      recipeId: FIXTURE_RECIPE_ID,
      proposalId: proposal.proposalId,
      candidateId: first.candidateId,
      recipeRevision: proposal.recipeRevision,
      decision: 'ACCEPT',
      reasonCode: 'SOURCE_EXPLICIT_USE',
      decidedBy: 'admin-uid',
    }, { db })

    const entries = await loadMappingReviewQueue(loadOptions(db))
    expect(entries[0].status).toBe('IN_PROGRESS')
    expect(entries[0].resolvedCandidates).toBeGreaterThan(0)
  })

  it('reports READY_FOR_FINAL_REVIEW once every candidate is resolved and no map is approved', async () => {
    const { db, proposal } = await setup()
    const reviewCandidates = proposal.candidates.filter(c => c.routingDecision === 'REVIEW_REQUIRED')
    for (const candidate of reviewCandidates) {
      await appendMappingReviewDecision({
        recipeId: FIXTURE_RECIPE_ID,
        proposalId: proposal.proposalId,
        candidateId: candidate.candidateId,
        recipeRevision: proposal.recipeRevision,
        decision: 'ACCEPT',
        reasonCode: 'SOURCE_EXPLICIT_USE',
        decidedBy: 'admin-uid',
      }, { db })
    }

    const entries = await loadMappingReviewQueue(loadOptions(db))
    expect(entries[0].status).toBe('READY_FOR_FINAL_REVIEW')
  })

  it('reports APPROVED once a current approved map exists for the live revision', async () => {
    const { db, proposal, source } = await setup()
    const reviewCandidates = proposal.candidates.filter(c => c.routingDecision === 'REVIEW_REQUIRED')
    for (const candidate of reviewCandidates) {
      await appendMappingReviewDecision({
        recipeId: FIXTURE_RECIPE_ID,
        proposalId: proposal.proposalId,
        candidateId: candidate.candidateId,
        recipeRevision: proposal.recipeRevision,
        decision: 'ACCEPT',
        reasonCode: 'SOURCE_EXPLICIT_USE',
        decidedBy: 'admin-uid',
      }, { db })
    }
    const attestation = await recordMappingCompletenessAttestation({
      recipeId: FIXTURE_RECIPE_ID,
      proposalId: proposal.proposalId,
      recipeRevision: proposal.recipeRevision,
      attestedBy: 'admin-uid',
    }, { db })

    const { listMappingCandidates } = await import('@/lib/cookingModeMappingProposalPersistence')
    const liveCandidates = await listMappingCandidates(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    const outcome = await buildApprovedMapping({
      recipeId: FIXTURE_RECIPE_ID,
      recipeRevision: proposal.recipeRevision,
      parserVersion: source.parserVersion,
      mappingSourceHash: proposal.mappingSourceHash,
      proposalId: proposal.proposalId,
      reviewerContractVersion: proposal.reviewerContractVersion,
      evidenceContractVersion: proposal.evidenceContractVersion,
      routingContractVersion: proposal.routingContractVersion,
      candidates: liveCandidates,
      proposalBlockingReasons: proposal.blockingReasons,
      approvedBy: 'admin-uid',
      completenessAttestation: attestation,
      provenance: {
        reviewerARunId: 'run-a', reviewerBRunId: 'run-b',
        reviewerAOutputHash: null, reviewerBOutputHash: null,
        autoAcceptCandidateCount: 0, humanDecidedCandidateCount: reviewCandidates.length,
      },
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error('expected build to succeed')
    await persistApprovedMapping(outcome.map, { db })
    await updateCurrentApprovedMappingPointer(FIXTURE_RECIPE_ID, outcome.map.mapId, { db })

    const entries = await loadMappingReviewQueue(loadOptions(db))
    expect(entries[0].status).toBe('APPROVED')
    expect(entries[0].totalCandidates).toBe(outcome.map.relationships.length)
  })

  it('reports STALE when the recipe changed since every persisted proposal', async () => {
    const { db } = await setup()
    const options = loadOptions(db)
    const changedRecipe: Recipe = { ...fixtureRecipe(), content: CONTENT.replace('1 cup sugar', '2 cups sugar') }
    const entries = await loadMappingReviewQueue({ ...options, getRecipe: async () => changedRecipe })
    expect(entries[0].status).toBe('STALE')
  })

  it('reports BLOCKED for a proposal blocked on a non-review reason', async () => {
    const db = createFakeMappingFirestore()
    const source = await liveSource()
    const recipeRevision = await computeMappingRecipeRevision(source)
    const proposal = await buildFixtureProposal({ recipeRevision, source, includeStructuralInvalid: false })
    proposal.approvalBlocked = true
    proposal.blockingReasons = ['DETERMINISTIC_EVIDENCE_FAILURE']
    await saveMappingProposal(proposal, { db })

    const entries = await loadMappingReviewQueue(loadOptions(db))
    expect(entries[0].status).toBe('BLOCKED')
    expect(entries[0].blockedReason).toBe('DETERMINISTIC_EVIDENCE_FAILURE')
  })

  it('omits a recipe entirely when it has no persisted proposal', async () => {
    const db = createFakeMappingFirestore()
    const entries = await loadMappingReviewQueue({ db, listHeaders: async () => [], getRecipe: async () => fixtureRecipe() })
    expect(entries).toHaveLength(0)
  })
})
