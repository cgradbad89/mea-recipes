// Implementation 6, Phase 18/28 — verifies that a proposal produced by the
// new ingestion entry point (`generateAndPersistCookingModeMappingProposal`)
// is naturally discoverable by the *existing, unmodified*
// `/mapping-review` queue read model (`loadMappingReviewQueue`), with no
// change to that read model or the review UI. Uses test doubles throughout
// (fake Firestore, mocked reviewer AI) — no production Firestore, no live
// AI calls.
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ai', () => ({ generateAIObject: vi.fn() }))

import { createFakeMappingFirestore } from './helpers/fakeMappingFirestore'
import { FIXTURE_RECIPE_ID } from './helpers/mappingPersistenceFixtures'
import { COOKING_MODE_MAPPING_REVIEWER_PROMPT_VERSION } from '@/lib/aiConfig'
import { COOKING_MAPPING_PARSER_VERSION } from '@/lib/cookingStepMapping'
import { generateAndPersistCookingModeMappingProposal } from '@/lib/cookingModeMappingIngestion'
import { loadMappingReviewQueue } from '@/lib/cookingModeMappingReviewQueue'
import { MAPPING_REVIEWER_CONTRACT_VERSION } from '@/types/cookingModeMapping'
import type { MappingFirestoreLike } from '@/lib/cookingModeMappingFirestore'
import type { MappingReviewerResponseV1, MappingRevisionSource } from '@/types/cookingModeMapping'
import type { Recipe } from '@/types/recipe'

const CONTENT = `INGREDIENTS
2 cups flour
1 tsp salt

INSTRUCTIONS
Step 1
Mix the flour and salt.
Step 2
Bake at 350F for 30 minutes.`

function fixtureRecipe(): Recipe {
  return {
    id: FIXTURE_RECIPE_ID, recipeID: FIXTURE_RECIPE_ID, title: 'Queue Integration Fixture', content: CONTENT,
    category: 'Breakfast', cuisine: 'american', imageURL: '', sourceURL: '', sourceFile: '',
    labels: '', hasImage: 'false', created: '', modified: '',
  }
}

function coverageFor(source: MappingRevisionSource) {
  return {
    ingredientRowCount: source.ingredients.length, nonHeaderIngredientRowCount: source.ingredients.length,
    stepCount: source.instructions.length, reviewedCellCount: source.ingredients.length * source.instructions.length,
  }
}

function response(
  source: MappingRevisionSource, recipeRevision: string,
  acceptedRelationships: Array<{ ingredientRowIndex: number; stepIndex: number }>,
): MappingReviewerResponseV1 {
  return {
    reviewerContractVersion: MAPPING_REVIEWER_CONTRACT_VERSION, promptVersion: COOKING_MODE_MAPPING_REVIEWER_PROMPT_VERSION,
    recipeRevision, coverage: coverageFor(source), acceptedRelationships,
  }
}

const deterministicIds = (kind: 'run' | 'attempt', slot: 'A' | 'B', attempt: number) => `${kind}-${slot}-${attempt}`
const deterministicNow = () => '2026-08-29T12:00:00.000Z'

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

async function liveSource(): Promise<MappingRevisionSource> {
  const { parseRecipeContent } = await import('@/lib/recipeContent')
  const { ingredients, instructions } = parseRecipeContent(CONTENT)
  return { recipeId: FIXTURE_RECIPE_ID, parserVersion: COOKING_MAPPING_PARSER_VERSION, ingredients, instructions }
}

describe('ingestion -> review queue integration', () => {
  it('a newly published recipe with a fully auto-resolved proposal appears as Ready for final review', async () => {
    const db = createFakeMappingFirestore()
    const generate = vi.fn(async request => {
      const revisionMatch = (request as { prompt: string }).prompt.match(/Recipe revision: (\S+)/)
      const source = await liveSource()
      return response(source, revisionMatch?.[1] ?? '', [{ ingredientRowIndex: 0, stepIndex: 0 }])
    })

    const result = await generateAndPersistCookingModeMappingProposal({
      recipeId: FIXTURE_RECIPE_ID, recipe: fixtureRecipe(), db,
      generate: generate as never, now: deterministicNow, idFactory: deterministicIds,
    })
    expect(result.outcome).toBe('GENERATED')
    expect(result.reviewRequiredCount).toBe(0)

    const entries = await loadMappingReviewQueue(loadOptions(db))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ recipeId: FIXTURE_RECIPE_ID, status: 'READY_FOR_FINAL_REVIEW' })
  })

  it('a newly published recipe with a reviewer disagreement appears as Needs review', async () => {
    const db = createFakeMappingFirestore()
    const generate = vi.fn(async request => {
      const req = request as { prompt: string; feature: string }
      const revisionMatch = req.prompt.match(/Recipe revision: (\S+)/)
      const source = await liveSource()
      // Only reviewer A accepts the relationship -> reviewer disagreement -> REVIEW_REQUIRED.
      const accepted = req.feature.endsWith('-a') ? [{ ingredientRowIndex: 0, stepIndex: 0 }] : []
      return response(source, revisionMatch?.[1] ?? '', accepted)
    })

    const result = await generateAndPersistCookingModeMappingProposal({
      recipeId: FIXTURE_RECIPE_ID, recipe: fixtureRecipe(), db,
      generate: generate as never, now: deterministicNow, idFactory: deterministicIds,
    })
    expect(result.outcome).toBe('GENERATED')
    expect(result.reviewRequiredCount).toBe(1)

    const entries = await loadMappingReviewQueue(loadOptions(db))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ recipeId: FIXTURE_RECIPE_ID, status: 'NEEDS_REVIEW' })
  })

  it('a proposal blocked by reviewer execution failure appears as Blocked', async () => {
    const db = createFakeMappingFirestore()
    const alwaysFailing = vi.fn().mockRejectedValue(new Error('provider unavailable'))

    const result = await generateAndPersistCookingModeMappingProposal({
      recipeId: FIXTURE_RECIPE_ID, recipe: fixtureRecipe(), db,
      generate: alwaysFailing as never, now: deterministicNow, idFactory: deterministicIds,
    })
    expect(result.outcome).toBe('BLOCKED')

    const entries = await loadMappingReviewQueue(loadOptions(db))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ recipeId: FIXTURE_RECIPE_ID, status: 'BLOCKED' })
  })

  it('does not auto-approve a zero-REVIEW_REQUIRED proposal — completeness attestation is still required', async () => {
    const db = createFakeMappingFirestore()
    const generate = vi.fn(async request => {
      const revisionMatch = (request as { prompt: string }).prompt.match(/Recipe revision: (\S+)/)
      const source = await liveSource()
      return response(source, revisionMatch?.[1] ?? '', [{ ingredientRowIndex: 0, stepIndex: 0 }])
    })
    await generateAndPersistCookingModeMappingProposal({
      recipeId: FIXTURE_RECIPE_ID, recipe: fixtureRecipe(), db,
      generate: generate as never, now: deterministicNow, idFactory: deterministicIds,
    })

    const entries = await loadMappingReviewQueue(loadOptions(db))
    // READY_FOR_FINAL_REVIEW, never APPROVED — human completeness attestation
    // and an explicit map-approval call (outside this module's scope) are
    // still required before anything is APPROVED.
    expect(entries[0].status).toBe('READY_FOR_FINAL_REVIEW')
    expect(entries[0].status).not.toBe('APPROVED')
  })
})
