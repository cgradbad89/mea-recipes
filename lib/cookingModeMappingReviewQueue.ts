import 'server-only'

// Cooking Mode mapping review — recipe-level queue read model
// (Human Mapping Review Experience, Phase 6).
//
// This is the one new server-side read capability the review UI needs that
// the recipe-scoped persistence services (lib/cookingModeMapping*Persistence.ts)
// deliberately don't provide: a cross-recipe view of "which recipes have a
// mapping proposal at all." It adds no Firestore redesign and no composite
// index — `listAllMappingProposalHeaders` is an unfiltered Firestore
// collection-group scan (no `where`/`orderBy`), which Firestore does not
// require an index for; only filtered/ordered collection-group queries do.
// Recipe-derived state per entry is computed by joining that scan with the
// existing, already-tested persistence services — no new mutation, no new
// candidate/decision logic.

import { getAdminDb } from '@/lib/firebaseAdmin'
import { MAPPING_PROPOSALS_SUBCOLLECTION, resolveMappingFirestore } from '@/lib/cookingModeMappingFirestore'
import type { MappingFirestoreLike } from '@/lib/cookingModeMappingFirestore'
import { getRecipeById } from '@/lib/recipes'
import { parseRecipeContent } from '@/lib/recipeContent'
import { COOKING_MAPPING_PARSER_VERSION } from '@/lib/cookingStepMapping'
import { computeMappingRecipeRevision } from '@/lib/cookingModeMappingIdentity'
import { listMappingCandidates } from '@/lib/cookingModeMappingProposalPersistence'
import { computeProposalCompletion } from '@/lib/cookingModeMappingReviewPersistence'
import { getApprovedMapping, getCurrentApprovedMappingPointer } from '@/lib/cookingModeMappingApprovedPersistence'
import type { PersistedMappingProposalV1 } from '@/types/cookingModeMappingPersistence'
import type { MappingRevisionSource } from '@/types/cookingModeMapping'
import type { Recipe } from '@/types/recipe'

/**
 * Recipe-level queue states (design doc §11) — derived only from backend
 * state that already exists; "Approved" specifically requires the
 * current-approved pointer to resolve CURRENT, never merely "zero unresolved
 * candidates" (Phase 5's explicit requirement).
 */
export type MappingReviewQueueStatus =
  | 'NEEDS_REVIEW'
  | 'IN_PROGRESS'
  | 'READY_FOR_FINAL_REVIEW'
  | 'APPROVED'
  | 'STALE'
  | 'BLOCKED'

export interface MappingReviewQueueEntry {
  recipeId: string
  recipeTitle: string
  status: MappingReviewQueueStatus
  proposalId: string | null
  resolvedCandidates: number
  totalCandidates: number
  blockedReason: string | null
}

export async function listAllMappingProposalHeaders(): Promise<PersistedMappingProposalV1[]> {
  const snap = await getAdminDb().collectionGroup(MAPPING_PROPOSALS_SUBCOLLECTION).get()
  return snap.docs.map(doc => doc.data() as PersistedMappingProposalV1)
}

export interface LoadMappingReviewQueueOptions {
  db?: MappingFirestoreLike
  listHeaders?: () => Promise<PersistedMappingProposalV1[]>
  getRecipe?: (recipeId: string) => Promise<Recipe | null>
}

function liveSourceFor(recipe: Recipe): MappingRevisionSource {
  const { ingredients, instructions } = parseRecipeContent(recipe.content)
  return { recipeId: recipe.id, parserVersion: COOKING_MAPPING_PARSER_VERSION, ingredients, instructions }
}

/**
 * Builds the recipe-level review queue (Phase 5-6). Only recipes that have
 * at least one persisted mapping proposal ever appear — a recipe with no
 * proposal at all is not "Needs review," it simply isn't in this queue
 * (Phase 23's empty-state distinction: no queue items vs. mapping system
 * unavailable is made by the caller, not by inventing a synthetic entry
 * here).
 */
export async function loadMappingReviewQueue(
  options: LoadMappingReviewQueueOptions = {},
): Promise<MappingReviewQueueEntry[]> {
  const db = resolveMappingFirestore(options.db)
  const listHeaders = options.listHeaders ?? listAllMappingProposalHeaders
  const getRecipe = options.getRecipe ?? getRecipeById

  const headers = (await listHeaders()).filter(h => h.persistenceStatus === 'READY')
  const byRecipe = new Map<string, PersistedMappingProposalV1[]>()
  for (const header of headers) {
    const list = byRecipe.get(header.recipeId) ?? []
    list.push(header)
    byRecipe.set(header.recipeId, list)
  }

  const entries: MappingReviewQueueEntry[] = []

  for (const [recipeId, proposals] of byRecipe) {
    const recipe = await getRecipe(recipeId)
    if (!recipe) continue

    const liveRevision = await computeMappingRecipeRevision(liveSourceFor(recipe))
    const pointerResult = await getCurrentApprovedMappingPointer(recipeId, liveRevision, db)
    const currentProposal = proposals.find(p => p.recipeRevision === liveRevision) ?? null

    if (pointerResult.status === 'CURRENT' && pointerResult.pointer) {
      const map = await getApprovedMapping(recipeId, pointerResult.pointer.mapId, db)
      const relationshipCount = map?.relationships.length ?? currentProposal?.candidateCount ?? 0
      entries.push({
        recipeId,
        recipeTitle: recipe.title,
        status: 'APPROVED',
        proposalId: currentProposal?.proposalId ?? null,
        resolvedCandidates: relationshipCount,
        totalCandidates: relationshipCount,
        blockedReason: null,
      })
      continue
    }

    if (!currentProposal) {
      // The recipe's mapping source has changed since every persisted
      // proposal for it — nothing reviewable at the live revision exists
      // (Phase 21). This covers both "an approved map exists but is now
      // stale" and "an old review exists for a since-edited recipe."
      const reference = [...proposals].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
      entries.push({
        recipeId,
        recipeTitle: recipe.title,
        status: 'STALE',
        proposalId: reference?.proposalId ?? null,
        resolvedCandidates: 0,
        totalCandidates: reference?.candidateCount ?? 0,
        blockedReason: null,
      })
      continue
    }

    const candidates = await listMappingCandidates(recipeId, currentProposal.proposalId, db)
    const completion = computeProposalCompletion(candidates)
    const nonReviewBlockers = currentProposal.blockingReasons.filter(r => r !== 'CANDIDATE_REVIEW_REQUIRED')

    if (currentProposal.approvalBlocked && nonReviewBlockers.length > 0) {
      entries.push({
        recipeId,
        recipeTitle: recipe.title,
        status: 'BLOCKED',
        proposalId: currentProposal.proposalId,
        resolvedCandidates: completion.resolvedCandidates,
        totalCandidates: completion.totalCandidates,
        blockedReason: nonReviewBlockers[0],
      })
      continue
    }

    const status: MappingReviewQueueStatus = completion.complete
      ? 'READY_FOR_FINAL_REVIEW'
      : candidates.some(c => c.decisionSource === 'HUMAN')
        ? 'IN_PROGRESS'
        : 'NEEDS_REVIEW'

    entries.push({
      recipeId,
      recipeTitle: recipe.title,
      status,
      proposalId: currentProposal.proposalId,
      resolvedCandidates: completion.resolvedCandidates,
      totalCandidates: completion.totalCandidates,
      blockedReason: null,
    })
  }

  return entries.sort((a, b) => a.recipeTitle.localeCompare(b.recipeTitle))
}
