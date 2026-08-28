import 'server-only'

import { computeCookingMappingSourceHash } from '@/lib/cookingStepMapping'
import {
  buildMappingProposal,
} from '@/lib/cookingModeMappingProposal'
import type { MappingProposalEvidenceResolver } from '@/lib/cookingModeMappingProposal'
import {
  executeBlindMappingReviewers,
} from '@/lib/cookingModeMappingReviewer'
import type { MappingReviewerOrchestrationInput } from '@/lib/cookingModeMappingReviewer'
import type { MappingProposalV1, MappingRevisionSource } from '@/types/cookingModeMapping'

export interface GenerateMappingProposalInput extends Omit<MappingReviewerOrchestrationInput, 'recipeId' | 'source'> {
  recipeId: string
  source: MappingRevisionSource
  now?: () => string
  evidenceResolver?: MappingProposalEvidenceResolver
}

export async function generateMappingProposal(input: GenerateMappingProposalInput): Promise<MappingProposalV1> {
  if (input.recipeId !== input.source.recipeId) throw new Error('proposal recipeId/source mismatch')
  const initialSource = {
    recipeId: input.source.recipeId,
    parserVersion: input.source.parserVersion,
    ingredients: [...input.source.ingredients],
    instructions: [...input.source.instructions],
  }
  const { now = () => new Date().toISOString(), evidenceResolver, ...reviewerInput } = input
  const blindReview = await executeBlindMappingReviewers({ ...reviewerInput, source: initialSource })
  const currentHash = await computeCookingMappingSourceHash(input.source.ingredients, input.source.instructions)
  const currentRevision = `${input.source.parserVersion}:sha256:${currentHash}`
  const proposal = await buildMappingProposal({
    recipeId: input.recipeId,
    source: blindReview.source,
    recipeRevision: blindReview.recipeRevision,
    reviewerA: blindReview.reviewerA,
    reviewerB: blindReview.reviewerB,
    createdAt: now(),
    sourceIdentityMismatch: currentRevision !== blindReview.recipeRevision || input.source.recipeId !== blindReview.source.recipeId,
    ...(evidenceResolver ? { evidenceResolver } : {}),
  })
  console.info('[cooking-mapping-proposal]', {
    event: 'built', recipeId: proposal.recipeId, proposalId: proposal.proposalId,
    ...proposal.summary, approvalBlocked: proposal.approvalBlocked,
  })
  return proposal
}
