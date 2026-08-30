import 'server-only'

// Cooking Mode mapping — ingestion orchestration boundary (Implementation 6).
//
// The single production entry point that connects a finalized shared recipe
// (new OR mapping-relevantly edited) to the existing, already-implemented
// mapping pipeline: parse -> revision -> generateMappingProposal ->
// saveMappingProposal. No caller duplicates this sequence.
//
// This module deliberately does not branch on "is this a new recipe or an
// edit" — the identity contract already does that for us. `recipeRevision`
// (and therefore `proposalId`) is a pure function of the recipe's current
// parsed mapping source (architecture-contract §3, §16). A metadata-only
// edit reproduces the exact same revision, so the dedupe check below reuses
// the existing proposal untouched (Phase 9's "old revision == new revision
// -> do not generate a new mapping proposal"); a mapping-relevant edit
// produces a different revision, which naturally computes a different
// proposalId and therefore always falls into "generate a new proposal",
// while the prior revision's proposal/candidates/approved map are never
// touched (Phase 10's immutability requirement — this module has no delete
// or overwrite path for another revision's records at all).
//
// This module never writes `cookingModeMappingPointer/current` — that
// happens only via the explicit map-approval route
// (`app/api/mapping-review/[recipeId]/approve/route.ts`). That omission is
// exactly Phase 11's "do not silently repoint an edited recipe" requirement:
// there is no code path here that could.

import { getRecipeById } from '@/lib/recipes'
import { parseRecipeContent } from '@/lib/recipeContent'
import { COOKING_MAPPING_PARSER_VERSION } from '@/lib/cookingStepMapping'
import { computeMappingProposalId, computeMappingRecipeRevision } from '@/lib/cookingModeMappingIdentity'
import { generateMappingProposal } from '@/lib/cookingModeMappingOrchestrator'
import type { GenerateMappingProposalInput } from '@/lib/cookingModeMappingOrchestrator'
import {
  getMappingProposal,
  listMappingCandidates,
  saveMappingProposal,
} from '@/lib/cookingModeMappingProposalPersistence'
import { MappingPersistenceFailureError } from '@/lib/cookingModeMappingPersistenceErrors'
import { safeErrorLogDetails } from '@/lib/apiRequest'
import { isAIAbuseControlError } from '@/lib/aiAbuseControl'
import type { MappingFirestoreLike } from '@/lib/cookingModeMappingFirestore'
import type { MappingProposalBlockingReason, MappingRevisionSource } from '@/types/cookingModeMapping'
import type { Recipe } from '@/types/recipe'

/**
 * `GENERATED` — a fresh proposal was produced and persisted for this revision.
 * `REUSED_EXISTING` — an identical READY proposal for this exact revision was
 *   already durably persisted; no AI calls were made (Phase 13/14).
 * `BLOCKED` — generation completed but the resulting proposal is
 *   `approvalBlocked` (e.g. a reviewer slot failed, evidence was
 *   unavailable). The recipe remains saved; only the mapping workflow is
 *   affected (Phase 4/24).
 * `FAILED` — generation could not complete at all (recipe not found, an
 *   unexpected exception). The recipe's own save is never rolled back by
 *   this module — it doesn't touch the recipe document.
 */
export type MappingIngestionOutcome = 'GENERATED' | 'REUSED_EXISTING' | 'BLOCKED' | 'FAILED'

export interface GenerateAndPersistMappingInput {
  recipeId: string
  /** Pre-loaded recipe, when the caller already has it (avoids a re-read). */
  recipe?: Recipe
  getRecipe?: (recipeId: string) => Promise<Recipe | null>
  userId?: string
  db?: MappingFirestoreLike
  generate?: GenerateMappingProposalInput['generate']
  now?: () => string
  idFactory?: GenerateMappingProposalInput['idFactory']
}

export interface GenerateAndPersistMappingResult {
  outcome: MappingIngestionOutcome
  recipeId: string
  recipeRevision: string | null
  proposalId: string | null
  candidateCount: number | null
  autoAcceptCount: number | null
  reviewRequiredCount: number | null
  approvalBlocked: boolean | null
  blockingReasons: MappingProposalBlockingReason[]
  /** Sanitized, user-safe message. Present only when `outcome === 'FAILED'`. */
  error?: string
}

function liveMappingSource(recipe: Recipe): MappingRevisionSource {
  const { ingredients, instructions } = parseRecipeContent(recipe.content)
  return { recipeId: recipe.id, parserVersion: COOKING_MAPPING_PARSER_VERSION, ingredients, instructions }
}

function notFound(recipeId: string): GenerateAndPersistMappingResult {
  return {
    outcome: 'FAILED', recipeId, recipeRevision: null, proposalId: null,
    candidateCount: null, autoAcceptCount: null, reviewRequiredCount: null,
    approvalBlocked: null, blockingReasons: [], error: 'Recipe not found.',
  }
}

function failed(
  recipeId: string,
  recipeRevision: string | null,
  proposalId: string | null,
  message: string,
): GenerateAndPersistMappingResult {
  return {
    outcome: 'FAILED', recipeId, recipeRevision, proposalId,
    candidateCount: null, autoAcceptCount: null, reviewRequiredCount: null,
    approvalBlocked: null, blockingReasons: [], error: message,
  }
}

/**
 * Generate (or reuse) a Cooking Mode mapping proposal for a recipe's exact
 * current persisted content, and durably persist it. Ordinary generation and
 * persistence failures are reported in the returned `outcome`/`error`, matching the
 * repo's existing `computeAndStoreNutrition` never-throws convention so a
 * caller can run this alongside other post-save enrichment without special
 * error handling. A centralized `AIAbuseControlError` is deliberately rethrown
 * so an API route can preserve the stable 429 contract and stop retries.
 *
 * Fails closed with respect to *mapping approval* only: this function can
 * never move `cookingModeMappingPointer/current`, approve a map, or mutate
 * an existing recipe document. A `FAILED`/`BLOCKED` outcome here has zero
 * effect on the recipe's own existence or validity (Phase 4).
 */
export async function generateAndPersistCookingModeMappingProposal(
  input: GenerateAndPersistMappingInput,
): Promise<GenerateAndPersistMappingResult> {
  const getRecipe = input.getRecipe ?? getRecipeById
  let recipe: Recipe | null
  try {
    recipe = input.recipe ?? (await getRecipe(input.recipeId))
  } catch (error) {
    console.error('[cooking-mapping-ingestion]', { event: 'recipe_read_failed', recipeId: input.recipeId, error: safeErrorLogDetails(error) })
    return failed(input.recipeId, null, null, 'Could not load the recipe for mapping generation.')
  }
  if (!recipe) return notFound(input.recipeId)

  const source = liveMappingSource(recipe)
  const recipeRevision = await computeMappingRecipeRevision(source)
  const proposalId = await computeMappingProposalId({ recipeId: recipe.id, recipeRevision })

  // Idempotency / dedupe (Phase 13): a durably-complete proposal for the
  // exact same logical identity already exists — reuse it and make no AI
  // calls. A `WRITING` or `FAILED` header means no safe READY population
  // exists yet; fall through to a fresh generation attempt (Phase 14) rather
  // than trusting a possibly-incomplete prior write. `saveMappingProposal`'s
  // own conflict detection still protects against two attempts disagreeing
  // on immutable generation content.
  let existingHeader
  try {
    existingHeader = await getMappingProposal(recipe.id, proposalId, input.db)
  } catch (error) {
    console.error('[cooking-mapping-ingestion]', { event: 'existing_proposal_read_failed', recipeId: recipe.id, recipeRevision, error: safeErrorLogDetails(error) })
    return failed(recipe.id, recipeRevision, proposalId, 'Could not check for an existing mapping proposal.')
  }
  if (existingHeader?.persistenceStatus === 'READY') {
    let candidates
    try {
      candidates = await listMappingCandidates(recipe.id, proposalId, input.db)
    } catch (error) {
      console.error('[cooking-mapping-ingestion]', { event: 'existing_candidates_read_failed', recipeId: recipe.id, recipeRevision, proposalId, error: safeErrorLogDetails(error) })
      return failed(recipe.id, recipeRevision, proposalId, 'Could not load the existing mapping proposal.')
    }
    console.info('[cooking-mapping-ingestion]', {
      event: 'reused_existing', recipeId: recipe.id, recipeRevision, proposalId,
      candidateCount: candidates.length, approvalBlocked: existingHeader.approvalBlocked,
    })
    return {
      outcome: 'REUSED_EXISTING',
      recipeId: recipe.id, recipeRevision, proposalId,
      candidateCount: existingHeader.candidateCount,
      autoAcceptCount: existingHeader.summary.autoAcceptCount,
      reviewRequiredCount: existingHeader.summary.reviewRequiredCount,
      approvalBlocked: existingHeader.approvalBlocked,
      blockingReasons: existingHeader.blockingReasons,
    }
  }

  try {
    const proposal = await generateMappingProposal({
      recipeId: recipe.id,
      source,
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.generate ? { generate: input.generate } : {}),
      ...(input.now ? { now: input.now } : {}),
      ...(input.idFactory ? { idFactory: input.idFactory } : {}),
    })
    const persisted = await saveMappingProposal(proposal, input.db ? { db: input.db } : {})
    // `proposal.approvalBlocked` also fires for the completely routine
    // "some candidates are REVIEW_REQUIRED and await a human decision" case
    // (`CANDIDATE_REVIEW_REQUIRED`) — that is a *successful* generation, not
    // a generation failure; it's exactly the expected NEEDS_REVIEW state the
    // `/mapping-review` queue already models. `BLOCKED` here means
    // generation itself could not produce a resolvable proposal (a reviewer
    // slot failed, evidence was unavailable, a structural/source problem was
    // found) — mirrors the identical `nonReviewBlockers` filter already used
    // by `lib/cookingModeMappingReviewQueue.ts` and `lib/cookingModeMappingStatus.ts`
    // so all three read the same distinction the same way.
    const nonReviewBlockingReasons = proposal.blockingReasons.filter(reason => reason !== 'CANDIDATE_REVIEW_REQUIRED')
    const outcome: MappingIngestionOutcome = nonReviewBlockingReasons.length > 0 ? 'BLOCKED' : 'GENERATED'
    console.info('[cooking-mapping-ingestion]', {
      event: 'generated', recipeId: recipe.id, recipeRevision, proposalId: proposal.proposalId,
      persistOutcome: persisted.outcome, candidateCount: persisted.candidateCount,
      autoAcceptCount: proposal.summary.autoAcceptCount, reviewRequiredCount: proposal.summary.reviewRequiredCount,
      outcome, approvalBlocked: proposal.approvalBlocked, blockingReasons: proposal.blockingReasons,
    })
    return {
      outcome,
      recipeId: recipe.id, recipeRevision, proposalId: proposal.proposalId,
      candidateCount: proposal.summary.candidateCount,
      autoAcceptCount: proposal.summary.autoAcceptCount,
      reviewRequiredCount: proposal.summary.reviewRequiredCount,
      approvalBlocked: proposal.approvalBlocked,
      blockingReasons: proposal.blockingReasons,
    }
  } catch (error) {
    if (isAIAbuseControlError(error)) throw error
    const sanitized = error instanceof MappingPersistenceFailureError
      ? 'Mapping proposal generation completed but could not be durably persisted.'
      : 'Mapping proposal generation failed.'
    console.error('[cooking-mapping-ingestion]', { event: 'failed', recipeId: recipe.id, recipeRevision, proposalId, error: safeErrorLogDetails(error) })
    return failed(recipe.id, recipeRevision, proposalId, sanitized)
  }
}
