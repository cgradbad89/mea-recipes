import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { createFakeMappingFirestore } from './helpers/fakeMappingFirestore'
import { buildFixtureProposal, FIXTURE_RECIPE_ID } from './helpers/mappingPersistenceFixtures'
import { COOKING_MAPPING_PARSER_VERSION } from '@/lib/cookingStepMapping'
import { COOKING_MODE_MAPPING_REVIEWER_PROMPT_VERSION } from '@/lib/aiConfig'
import { computeMappingRecipeRevision } from '@/lib/cookingModeMappingIdentity'
import { buildMappingProposal } from '@/lib/cookingModeMappingProposal'
import { saveMappingProposal, listMappingCandidates } from '@/lib/cookingModeMappingProposalPersistence'
import { appendMappingReviewDecision } from '@/lib/cookingModeMappingReviewPersistence'
import { recordMappingCompletenessAttestation } from '@/lib/cookingModeMappingCompletenessAttestation'
import { buildApprovedMapping, persistApprovedMapping, updateCurrentApprovedMappingPointer } from '@/lib/cookingModeMappingApprovedPersistence'
import { getMappingStatusForRecipe } from '@/lib/cookingModeMappingStatus'
import { MAPPING_REVIEWER_CONTRACT_VERSION } from '@/types/cookingModeMapping'
import type { MappingRevisionSource } from '@/types/cookingModeMapping'
import type { Recipe } from '@/types/recipe'

// `helpers/mappingPersistenceFixtures.ts`'s `FIXTURE_SOURCE` is pinned to a
// synthetic `parserVersion: 'v1'` (fine for persistence-layer tests that
// never re-derive a "live" revision from real recipe content). This module
// exercises `getMappingStatusForRecipe`, which — like the real ingestion/
// review-detail code paths — recomputes the live revision from
// `parseRecipeContent(recipe.content)` under the *real*
// `COOKING_MAPPING_PARSER_VERSION`. So this file defines its own matching
// source/content pair instead, reusing `buildFixtureProposal`'s `source`
// override to swap in the real parser version.
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

// Same source, plus one extra ingredient row/step — only used by the
// IN_PROGRESS test below, which needs a fourth valid index pair to place a
// second independent reviewer disagreement.
const CONTENT_WITH_BUTTER = `INGREDIENTS
2 cups flour
1 tsp salt
1 cup sugar
1 stick butter

INSTRUCTIONS
Step 1
Mix the flour and salt.
Step 2
Add the sugar and stir.
Step 3
Bake at 350F for 30 minutes.
Step 4
Melt the butter.`

const LIVE_SOURCE: MappingRevisionSource = {
  recipeId: FIXTURE_RECIPE_ID,
  parserVersion: COOKING_MAPPING_PARSER_VERSION,
  ingredients: ['2 cups flour', '1 tsp salt', '1 cup sugar'],
  instructions: ['Mix the flour and salt.', 'Add the sugar and stir.', 'Bake at 350F for 30 minutes.'],
}

function fixtureRecipe(content = CONTENT): Recipe {
  return {
    id: FIXTURE_RECIPE_ID, recipeID: FIXTURE_RECIPE_ID, title: 'Status Fixture Recipe', content,
    category: 'Dinner', cuisine: 'american', imageURL: '', sourceURL: '', sourceFile: '',
    labels: '', hasImage: 'false', created: '', modified: '',
  }
}

describe('getMappingStatusForRecipe', () => {
  it('returns null when the recipe does not exist', async () => {
    const db = createFakeMappingFirestore()
    const result = await getMappingStatusForRecipe(FIXTURE_RECIPE_ID, { db, getRecipe: async () => null })
    expect(result).toBeNull()
  })

  it('reports NO_PROPOSAL when nothing has been generated yet', async () => {
    const db = createFakeMappingFirestore()
    const result = await getMappingStatusForRecipe(FIXTURE_RECIPE_ID, { db, getRecipe: async () => fixtureRecipe() })
    expect(result?.status).toBe('NO_PROPOSAL')
    expect(result?.proposalId).toBeNull()
  })

  it('reports NEEDS_REVIEW when a proposal has an unresolved candidate and no human decisions yet', async () => {
    const db = createFakeMappingFirestore()
    const recipeRevision = await computeMappingRecipeRevision(LIVE_SOURCE)
    const proposal = await buildFixtureProposal({ recipeRevision, source: LIVE_SOURCE, includeStructuralInvalid: false })
    await saveMappingProposal(proposal, { db })
    expect(proposal.candidates.some(c => c.routingDecision === 'REVIEW_REQUIRED')).toBe(true)

    const result = await getMappingStatusForRecipe(FIXTURE_RECIPE_ID, { db, getRecipe: async () => fixtureRecipe() })
    expect(result?.status).toBe('NEEDS_REVIEW')
    expect(result?.proposalId).toBe(proposal.proposalId)
  })

  it('reports IN_PROGRESS once at least one human decision exists but some remain unresolved', async () => {
    const db = createFakeMappingFirestore()
    // Needs two independent reviewer disagreements so one can be decided
    // while the other stays pending — `buildFixtureProposal`'s fixed
    // relationship set only ever produces one, so this test builds its own
    // two-disagreement proposal directly via the pure `buildMappingProposal`
    // constructor every other fixture in this repo ultimately calls too.
    const source: MappingRevisionSource = {
      ...LIVE_SOURCE,
      ingredients: [...LIVE_SOURCE.ingredients, '1 stick butter'],
      instructions: [...LIVE_SOURCE.instructions, 'Melt the butter.'],
    }
    const recipeRevision = await computeMappingRecipeRevision(source)
    const coverage = { ingredientRowCount: 4, nonHeaderIngredientRowCount: 4, stepCount: 4, reviewedCellCount: 16 }
    function reviewer(slot: 'A' | 'B', accepted: { ingredientRowIndex: number; stepIndex: number }[]) {
      return {
        reviewerSlot: slot, reviewerContractVersion: MAPPING_REVIEWER_CONTRACT_VERSION,
        promptVersion: COOKING_MODE_MAPPING_REVIEWER_PROMPT_VERSION, modelId: 'fixture-model',
        recipeRevision, parseStatus: 'VALID' as const, acceptedRelationships: accepted, coverage,
        normalizedOutputHash: `hash-${slot}`, completedAt: '2026-08-29T00:00:00.000Z',
        runId: `run-${slot}`, attemptId: `attempt-${slot}`, attempt: 1, attempts: [],
      }
    }
    // (0,2): only A proposes it. (3,3): only B proposes it. Both are
    // single-reviewer disagreements -> two independent REVIEW_REQUIRED candidates.
    const proposal = await buildMappingProposal({
      recipeId: FIXTURE_RECIPE_ID, source, recipeRevision, createdAt: '2026-08-29T00:00:00.000Z',
      reviewerA: reviewer('A', [{ ingredientRowIndex: 0, stepIndex: 2 }]),
      reviewerB: reviewer('B', [{ ingredientRowIndex: 3, stepIndex: 3 }]),
    })
    const reviewRequired = proposal.candidates.filter(c => c.routingDecision === 'REVIEW_REQUIRED')
    expect(reviewRequired).toHaveLength(2)
    await saveMappingProposal(proposal, { db })

    await appendMappingReviewDecision({
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, candidateId: reviewRequired[0].candidateId,
      recipeRevision: proposal.recipeRevision, decision: 'ACCEPT', reasonCode: 'SOURCE_EXPLICIT_USE', decidedBy: 'admin-uid',
    }, { db })

    const result = await getMappingStatusForRecipe(FIXTURE_RECIPE_ID, { db, getRecipe: async () => fixtureRecipe(CONTENT_WITH_BUTTER) })
    expect(result?.status).toBe('IN_PROGRESS')
  })

  it('reports READY_FOR_FINAL_REVIEW once every candidate has a decision but no map is approved', async () => {
    const db = createFakeMappingFirestore()
    const recipeRevision = await computeMappingRecipeRevision(LIVE_SOURCE)
    const proposal = await buildFixtureProposal({ recipeRevision, source: LIVE_SOURCE, includeStructuralInvalid: false })
    await saveMappingProposal(proposal, { db })
    for (const candidate of proposal.candidates.filter(c => c.routingDecision === 'REVIEW_REQUIRED')) {
      await appendMappingReviewDecision({
        recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, candidateId: candidate.candidateId,
        recipeRevision: proposal.recipeRevision, decision: 'ACCEPT', reasonCode: 'SOURCE_EXPLICIT_USE', decidedBy: 'admin-uid',
      }, { db })
    }

    const result = await getMappingStatusForRecipe(FIXTURE_RECIPE_ID, { db, getRecipe: async () => fixtureRecipe() })
    expect(result?.status).toBe('READY_FOR_FINAL_REVIEW')
  })

  it('reports APPROVED once the current-approved pointer resolves CURRENT for the live revision', async () => {
    const db = createFakeMappingFirestore()
    const recipeRevision = await computeMappingRecipeRevision(LIVE_SOURCE)
    const proposal = await buildFixtureProposal({ recipeRevision, source: LIVE_SOURCE, includeStructuralInvalid: false })
    await saveMappingProposal(proposal, { db })
    for (const candidate of proposal.candidates.filter(c => c.routingDecision === 'REVIEW_REQUIRED')) {
      await appendMappingReviewDecision({
        recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, candidateId: candidate.candidateId,
        recipeRevision: proposal.recipeRevision, decision: 'ACCEPT', reasonCode: 'SOURCE_EXPLICIT_USE', decidedBy: 'admin-uid',
      }, { db })
    }
    const attestation = await recordMappingCompletenessAttestation({
      recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, recipeRevision: proposal.recipeRevision, attestedBy: 'admin-uid',
    }, { db })
    const candidates = await listMappingCandidates(FIXTURE_RECIPE_ID, proposal.proposalId, db)
    const outcome = await buildApprovedMapping({
      recipeId: FIXTURE_RECIPE_ID, recipeRevision: proposal.recipeRevision, parserVersion: proposal.parserVersion,
      mappingSourceHash: proposal.mappingSourceHash, proposalId: proposal.proposalId,
      reviewerContractVersion: proposal.reviewerContractVersion, evidenceContractVersion: proposal.evidenceContractVersion,
      routingContractVersion: proposal.routingContractVersion, candidates, proposalBlockingReasons: proposal.blockingReasons,
      approvedBy: 'admin-uid', completenessAttestation: attestation,
      provenance: { reviewerARunId: '', reviewerBRunId: '', reviewerAOutputHash: null, reviewerBOutputHash: null, autoAcceptCandidateCount: 0, humanDecidedCandidateCount: candidates.length },
    })
    if (!outcome.ok) throw new Error('fixture setup failed to build an approved map')
    await persistApprovedMapping(outcome.map, { db })
    await updateCurrentApprovedMappingPointer(FIXTURE_RECIPE_ID, outcome.map.mapId, { db })

    const result = await getMappingStatusForRecipe(FIXTURE_RECIPE_ID, { db, getRecipe: async () => fixtureRecipe() })
    expect(result?.status).toBe('APPROVED')
  })

  it('reports STALE when the recipe changed since the last persisted proposal (edit invalidates the old pointer read)', async () => {
    const db = createFakeMappingFirestore()
    const recipeRevision = await computeMappingRecipeRevision(LIVE_SOURCE)
    const proposal = await buildFixtureProposal({ recipeRevision, source: LIVE_SOURCE, includeStructuralInvalid: false })
    await saveMappingProposal(proposal, { db })

    const changedContent = CONTENT.replace('2 cups flour', '4 cups flour')
    const result = await getMappingStatusForRecipe(FIXTURE_RECIPE_ID, { db, getRecipe: async () => fixtureRecipe(changedContent) })
    expect(result?.status).toBe('STALE')
    expect(result?.proposalId).toBe(proposal.proposalId)
  })

  it('reports BLOCKED for a non-review structural blocker', async () => {
    const db = createFakeMappingFirestore()
    const recipeRevision = await computeMappingRecipeRevision(LIVE_SOURCE)
    const proposal = await buildFixtureProposal({ recipeRevision, source: LIVE_SOURCE, includeStructuralInvalid: true })
    await saveMappingProposal(proposal, { db })

    const result = await getMappingStatusForRecipe(FIXTURE_RECIPE_ID, { db, getRecipe: async () => fixtureRecipe() })
    expect(result?.status).toBe('BLOCKED')
  })
})
