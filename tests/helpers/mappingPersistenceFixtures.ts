// Deterministic (zero-AI) MappingProposalV1 fixtures for persistence tests.
// Uses the already-tested pure `buildMappingProposal` constructor with
// synthetic reviewer results instead of calling any AI reviewer — per
// Implementation-3 Phase 20, persistence tests must never call
// `generateMappingProposal`/the live AI Gateway.
import { buildMappingProposal } from '@/lib/cookingModeMappingProposal'
import { COOKING_MODE_MAPPING_REVIEWER_PROMPT_VERSION } from '@/lib/aiConfig'
import {
  MAPPING_REVIEWER_CONTRACT_VERSION,
} from '@/types/cookingModeMapping'
import type {
  MappingProposalV1,
  MappingReviewerExecutionResultV1,
  MappingReviewerRelationshipV1,
  MappingRevisionSource,
} from '@/types/cookingModeMapping'

export const FIXTURE_RECIPE_ID = 'fixture-recipe-1'

export const FIXTURE_SOURCE: MappingRevisionSource = {
  recipeId: FIXTURE_RECIPE_ID,
  parserVersion: 'v1',
  ingredients: ['2 cups flour', '1 tsp salt', '1 cup sugar'],
  instructions: [
    'Mix the flour and salt.',
    'Add the sugar and stir.',
    'Bake at 350F for 30 minutes.',
  ],
}

function reviewerResult(
  slot: 'A' | 'B',
  accepted: MappingReviewerRelationshipV1[],
  recipeRevision: string,
  outputHash: string,
): MappingReviewerExecutionResultV1 {
  return {
    reviewerSlot: slot,
    reviewerContractVersion: MAPPING_REVIEWER_CONTRACT_VERSION,
    promptVersion: COOKING_MODE_MAPPING_REVIEWER_PROMPT_VERSION,
    modelId: 'fixture-model',
    recipeRevision,
    parseStatus: 'VALID',
    acceptedRelationships: accepted,
    coverage: {
      ingredientRowCount: 3,
      nonHeaderIngredientRowCount: 3,
      stepCount: 3,
      reviewedCellCount: 9,
    },
    normalizedOutputHash: outputHash,
    completedAt: '2026-08-28T00:00:00.000Z',
    runId: `run-${slot.toLowerCase()}`,
    attemptId: `attempt-${slot.toLowerCase()}-1`,
    attempt: 1,
    attempts: [{
      reviewerSlot: slot,
      runId: `run-${slot.toLowerCase()}`,
      attemptId: `attempt-${slot.toLowerCase()}-1`,
      attempt: 1,
      startedAt: '2026-08-28T00:00:00.000Z',
      completedAt: '2026-08-28T00:00:00.000Z',
      parseStatus: 'VALID',
      outputHash,
      failure: null,
      diagnosticCode: null,
    }],
  }
}

/**
 * Builds a deterministic proposal with one candidate of each kind this test
 * suite needs:
 *   (0,0) flour/mix     — both reviewers accept, no risk  -> AUTO_ACCEPT
 *   (1,0) salt/mix      — both reviewers accept, no risk  -> AUTO_ACCEPT
 *   (2,1) sugar/add     — both reviewers accept, no risk  -> AUTO_ACCEPT
 *   (0,2) flour/bake    — reviewers disagree              -> REVIEW_REQUIRED
 *   (99,0) out-of-range — structurally invalid index      -> AUTO_REJECT
 */
export async function buildFixtureProposal(options: {
  recipeRevision: string
  createdAt?: string
  includeStructuralInvalid?: boolean
  source?: MappingRevisionSource
}): Promise<MappingProposalV1> {
  const {
    recipeRevision,
    createdAt = '2026-08-28T00:00:00.000Z',
    includeStructuralInvalid = true,
    source = FIXTURE_SOURCE,
  } = options
  const bothAccept: MappingReviewerRelationshipV1[] = [
    { ingredientRowIndex: 0, stepIndex: 0 },
    { ingredientRowIndex: 1, stepIndex: 0 },
    { ingredientRowIndex: 2, stepIndex: 1 },
  ]
  const invalid: MappingReviewerRelationshipV1[] = includeStructuralInvalid
    ? [{ ingredientRowIndex: 99, stepIndex: 0 }]
    : []
  const reviewerAAccepted: MappingReviewerRelationshipV1[] = [
    ...bothAccept,
    { ingredientRowIndex: 0, stepIndex: 2 }, // disagreement: only A accepts
    ...invalid,
  ]
  const reviewerBAccepted: MappingReviewerRelationshipV1[] = [
    ...bothAccept,
    ...invalid, // structurally invalid (also proposed by B, when included)
  ]

  const reviewerA = reviewerResult('A', reviewerAAccepted, recipeRevision, 'hash-a-fixture')
  const reviewerB = reviewerResult('B', reviewerBAccepted, recipeRevision, 'hash-b-fixture')

  return buildMappingProposal({
    recipeId: FIXTURE_RECIPE_ID,
    source,
    recipeRevision,
    reviewerA,
    reviewerB,
    createdAt,
  })
}
