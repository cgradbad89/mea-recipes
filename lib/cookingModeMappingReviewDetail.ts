import 'server-only'

// Cooking Mode mapping review — single-recipe detail read model
// (Human Mapping Review Experience, Phase 6).
//
// Joins the existing, already-tested persistence services for one recipe:
// no new mutation, no new candidate/decision/routing logic. Recomputes the
// recipe's live mapping revision from its current content on every read so
// staleness (Phase 21) is always judged against reality, never a cached
// value.

import { getRecipeById } from '@/lib/recipes'
import { parseRecipeContent } from '@/lib/recipeContent'
import { COOKING_MAPPING_PARSER_VERSION } from '@/lib/cookingStepMapping'
import { computeMappingRecipeRevision } from '@/lib/cookingModeMappingIdentity'
import { mappingProposalsCollection, resolveMappingFirestore } from '@/lib/cookingModeMappingFirestore'
import type { MappingFirestoreLike } from '@/lib/cookingModeMappingFirestore'
import { getMappingProposal, listMappingCandidates } from '@/lib/cookingModeMappingProposalPersistence'
import { computeProposalCompletion } from '@/lib/cookingModeMappingReviewPersistence'
import { getMappingCompletenessAttestationStatus } from '@/lib/cookingModeMappingCompletenessAttestation'
import { getApprovedMapping, getCurrentApprovedMappingPointer } from '@/lib/cookingModeMappingApprovedPersistence'
import type {
  MappingCompletenessAttestationStatus,
  PersistedApprovedCookingStepMapV1,
  PersistedMappingCandidateV1,
  PersistedMappingProposalV1,
  ProposalCompletionResult,
  ReadCurrentApprovedMappingPointerResult,
} from '@/types/cookingModeMappingPersistence'
import type { MappingRevisionSource } from '@/types/cookingModeMapping'
import type { Recipe } from '@/types/recipe'

export interface MappingReviewRecipeData {
  recipeId: string
  recipeTitle: string
  liveRevision: string
  liveSource: MappingRevisionSource
  /** The proposal matching the recipe's live revision, or null if none exists (Phase 21 — stale/no-proposal). */
  proposal: PersistedMappingProposalV1 | null
  /** Set only when `proposal` is null but an out-of-date proposal exists, for the stale-state message. */
  staleProposalId: string | null
  candidates: PersistedMappingCandidateV1[]
  completion: ProposalCompletionResult | null
  attestation: MappingCompletenessAttestationStatus | null
  pointer: ReadCurrentApprovedMappingPointerResult
  approvedMap: PersistedApprovedCookingStepMapV1 | null
}

export interface LoadMappingReviewRecipeOptions {
  db?: MappingFirestoreLike
  getRecipe?: (recipeId: string) => Promise<Recipe | null>
}

export async function loadMappingReviewRecipe(
  recipeId: string,
  options: LoadMappingReviewRecipeOptions = {},
): Promise<MappingReviewRecipeData | null> {
  const db = resolveMappingFirestore(options.db)
  const getRecipe = options.getRecipe ?? getRecipeById
  const recipe = await getRecipe(recipeId)
  if (!recipe) return null

  const { ingredients, instructions } = parseRecipeContent(recipe.content)
  const liveSource: MappingRevisionSource = {
    recipeId,
    parserVersion: COOKING_MAPPING_PARSER_VERSION,
    ingredients,
    instructions,
  }
  const liveRevision = await computeMappingRecipeRevision(liveSource)

  const pointer = await getCurrentApprovedMappingPointer(recipeId, liveRevision, db)
  const approvedMap = pointer.status === 'CURRENT' && pointer.pointer
    ? await getApprovedMapping(recipeId, pointer.pointer.mapId, db)
    : null

  const proposalsSnap = await mappingProposalsCollection(db, recipeId).get()
  const forRecipe = proposalsSnap.docs
    .map(doc => doc.data() as unknown as PersistedMappingProposalV1)
    .filter(p => p.persistenceStatus === 'READY')
  const currentHeader = forRecipe.find(p => p.recipeRevision === liveRevision) ?? null

  if (!currentHeader) {
    const reference = [...forRecipe].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
    return {
      recipeId,
      recipeTitle: recipe.title,
      liveRevision,
      liveSource,
      proposal: null,
      staleProposalId: reference?.proposalId ?? null,
      candidates: [],
      completion: null,
      attestation: null,
      pointer,
      approvedMap,
    }
  }

  const proposal = await getMappingProposal(recipeId, currentHeader.proposalId, db)
  const candidates = await listMappingCandidates(recipeId, currentHeader.proposalId, db)
  const completion = computeProposalCompletion(candidates)
  const attestation = await getMappingCompletenessAttestationStatus(recipeId, currentHeader.proposalId, db)

  return {
    recipeId,
    recipeTitle: recipe.title,
    liveRevision,
    liveSource,
    proposal,
    staleProposalId: null,
    candidates,
    completion,
    attestation,
    pointer,
    approvedMap,
  }
}
