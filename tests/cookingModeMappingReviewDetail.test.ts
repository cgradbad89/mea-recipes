import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { createFakeMappingFirestore } from './helpers/fakeMappingFirestore'
import { buildFixtureProposal, FIXTURE_RECIPE_ID } from './helpers/mappingPersistenceFixtures'
import { parseRecipeContent } from '@/lib/recipeContent'
import { COOKING_MAPPING_PARSER_VERSION } from '@/lib/cookingStepMapping'
import { computeMappingRecipeRevision } from '@/lib/cookingModeMappingIdentity'
import { saveMappingProposal } from '@/lib/cookingModeMappingProposalPersistence'
import { appendMappingReviewDecision } from '@/lib/cookingModeMappingReviewPersistence'
import { loadMappingReviewRecipe } from '@/lib/cookingModeMappingReviewDetail'
import type { MappingFirestoreLike } from '@/lib/cookingModeMappingFirestore'
import type { MappingRevisionSource } from '@/types/cookingModeMapping'
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

function fixtureRecipe(content = CONTENT): Recipe {
  return {
    id: FIXTURE_RECIPE_ID, recipeID: FIXTURE_RECIPE_ID, title: 'Fixture Recipe', content,
    category: 'Dinner', cuisine: 'american', imageURL: '', sourceURL: '', sourceFile: '',
    labels: '', hasImage: 'false', created: '', modified: '',
  }
}

async function liveSource(): Promise<MappingRevisionSource> {
  const { ingredients, instructions } = parseRecipeContent(CONTENT)
  return { recipeId: FIXTURE_RECIPE_ID, parserVersion: COOKING_MAPPING_PARSER_VERSION, ingredients, instructions }
}

describe('loadMappingReviewRecipe', () => {
  it('returns null when the recipe does not exist', async () => {
    const db = createFakeMappingFirestore()
    const result = await loadMappingReviewRecipe(FIXTURE_RECIPE_ID, { db, getRecipe: async () => null })
    expect(result).toBeNull()
  })

  it('returns a stale-shaped result when no proposal matches the live revision', async () => {
    const db = createFakeMappingFirestore()
    const source = await liveSource()
    const recipeRevision = await computeMappingRecipeRevision(source)
    const proposal = await buildFixtureProposal({ recipeRevision, source, includeStructuralInvalid: false })
    await saveMappingProposal(proposal, { db })

    const changedRecipe = fixtureRecipe(CONTENT.replace('1 cup sugar', '2 cups sugar'))
    const result = await loadMappingReviewRecipe(FIXTURE_RECIPE_ID, { db, getRecipe: async () => changedRecipe })
    expect(result?.proposal).toBeNull()
    expect(result?.staleProposalId).toBe(proposal.proposalId)
    expect(result?.candidates).toHaveLength(0)
  })

  it('returns the live proposal, candidates, and completion when the revision matches', async () => {
    const db = createFakeMappingFirestore()
    const source = await liveSource()
    const recipeRevision = await computeMappingRecipeRevision(source)
    const proposal = await buildFixtureProposal({ recipeRevision, source, includeStructuralInvalid: false })
    await saveMappingProposal(proposal, { db })

    const result = await loadMappingReviewRecipe(FIXTURE_RECIPE_ID, { db, getRecipe: async () => fixtureRecipe() })
    expect(result?.proposal?.proposalId).toBe(proposal.proposalId)
    expect(result?.candidates.length).toBe(proposal.candidates.length)
    expect(result?.completion?.complete).toBe(false)
    expect(result?.attestation?.valid).toBe(false)
    expect(result?.pointer.status).toBe('NOT_FOUND')
  })

  it('reflects a resolved proposal as complete but not yet attested', async () => {
    const db = createFakeMappingFirestore()
    const source = await liveSource()
    const recipeRevision = await computeMappingRecipeRevision(source)
    const proposal = await buildFixtureProposal({ recipeRevision, source, includeStructuralInvalid: false })
    await saveMappingProposal(proposal, { db })

    for (const candidate of proposal.candidates.filter(c => c.routingDecision === 'REVIEW_REQUIRED')) {
      await appendMappingReviewDecision({
        recipeId: FIXTURE_RECIPE_ID, proposalId: proposal.proposalId, candidateId: candidate.candidateId,
        recipeRevision: proposal.recipeRevision, decision: 'ACCEPT', reasonCode: 'SOURCE_EXPLICIT_USE', decidedBy: 'admin-uid',
      }, { db })
    }

    const result = await loadMappingReviewRecipe(FIXTURE_RECIPE_ID, { db, getRecipe: async () => fixtureRecipe() })
    expect(result?.completion?.complete).toBe(true)
    expect(result?.attestation?.valid).toBe(false)
  })
})
