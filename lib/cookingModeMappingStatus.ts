import 'server-only'

// Cooking Mode mapping — single-recipe status read helper (Implementation 6,
// Phase 17). Adds no second lifecycle model: it reuses the exact
// `MappingReviewQueueStatus` values already produced by the cross-recipe
// queue read model (`lib/cookingModeMappingReviewQueue.ts`) and adds exactly
// one value, `NO_PROPOSAL`, for the one recipe state that read model has no
// reason to represent (it only ever lists recipes that already have a
// proposal). Built on `loadMappingReviewRecipe`
// (`lib/cookingModeMappingReviewDetail.ts`) — the same single-recipe join
// already used by `/api/mapping-review/[recipeId]` — rather than a second
// data-loading path.
//
// There is no `PROPOSAL_GENERATING` state: this repo has no background job
// system (CLAUDE.md), so proposal generation is a single bounded request/
// response inside `generateAndPersistCookingModeMappingProposal`
// (`lib/cookingModeMappingIngestion.ts`) — a proposal is either not
// persisted yet (`NO_PROPOSAL`) or persisted (`READY`, reflected in one of
// the other statuses below). There is no durable "in flight" record to read.

import { loadMappingReviewRecipe } from '@/lib/cookingModeMappingReviewDetail'
import type { LoadMappingReviewRecipeOptions } from '@/lib/cookingModeMappingReviewDetail'
import type { MappingReviewQueueStatus } from '@/lib/cookingModeMappingReviewQueue'

export type MappingRecipeStatus = MappingReviewQueueStatus | 'NO_PROPOSAL'

export interface MappingRecipeStatusResult {
  recipeId: string
  status: MappingRecipeStatus
  recipeRevision: string
  proposalId: string | null
  resolvedCandidates: number
  totalCandidates: number
}

/**
 * Recipe-level mapping status (Phase 17) — primarily for tests and future
 * observability/UX, not a new UI surface in this task. Returns `null` only
 * when the recipe itself does not exist.
 */
export async function getMappingStatusForRecipe(
  recipeId: string,
  options: LoadMappingReviewRecipeOptions = {},
): Promise<MappingRecipeStatusResult | null> {
  const data = await loadMappingReviewRecipe(recipeId, options)
  if (!data) return null

  if (data.pointer.status === 'CURRENT' && data.pointer.pointer) {
    const relationshipCount = data.approvedMap?.relationships.length ?? data.proposal?.candidateCount ?? 0
    return {
      recipeId, status: 'APPROVED', recipeRevision: data.liveRevision,
      proposalId: data.proposal?.proposalId ?? null,
      resolvedCandidates: relationshipCount, totalCandidates: relationshipCount,
    }
  }

  if (!data.proposal) {
    if (data.staleProposalId) {
      return {
        recipeId, status: 'STALE', recipeRevision: data.liveRevision,
        proposalId: data.staleProposalId, resolvedCandidates: 0, totalCandidates: 0,
      }
    }
    return {
      recipeId, status: 'NO_PROPOSAL', recipeRevision: data.liveRevision,
      proposalId: null, resolvedCandidates: 0, totalCandidates: 0,
    }
  }

  const completion = data.completion
  const nonReviewBlockers = data.proposal.blockingReasons.filter(r => r !== 'CANDIDATE_REVIEW_REQUIRED')
  if (data.proposal.approvalBlocked && nonReviewBlockers.length > 0) {
    return {
      recipeId, status: 'BLOCKED', recipeRevision: data.liveRevision,
      proposalId: data.proposal.proposalId,
      resolvedCandidates: completion?.resolvedCandidates ?? 0,
      totalCandidates: completion?.totalCandidates ?? 0,
    }
  }

  const status: MappingRecipeStatus = completion?.complete
    ? 'READY_FOR_FINAL_REVIEW'
    : data.candidates.some(c => c.decisionSource === 'HUMAN')
      ? 'IN_PROGRESS'
      : 'NEEDS_REVIEW'

  return {
    recipeId, status, recipeRevision: data.liveRevision,
    proposalId: data.proposal.proposalId,
    resolvedCandidates: completion?.resolvedCandidates ?? 0,
    totalCandidates: completion?.totalCandidates ?? 0,
  }
}
