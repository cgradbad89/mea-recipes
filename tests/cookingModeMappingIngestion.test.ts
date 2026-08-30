import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ai', () => ({ generateAIObject: vi.fn() }))

import { createFakeMappingFirestore } from './helpers/fakeMappingFirestore'
import { COOKING_MODE_MAPPING_REVIEWER_PROMPT_VERSION } from '@/lib/aiConfig'
import { AIAbuseControlError } from '@/lib/aiAbuseControl'
import { COOKING_MAPPING_PARSER_VERSION } from '@/lib/cookingStepMapping'
import { computeMappingProposalId, computeMappingRecipeRevision } from '@/lib/cookingModeMappingIdentity'
import { getMappingProposal, listMappingCandidates } from '@/lib/cookingModeMappingProposalPersistence'
import { generateAndPersistCookingModeMappingProposal } from '@/lib/cookingModeMappingIngestion'
import { MAPPING_REVIEWER_CONTRACT_VERSION } from '@/types/cookingModeMapping'
import type { MappingReviewerResponseV1, MappingRevisionSource } from '@/types/cookingModeMapping'
import type { Recipe } from '@/types/recipe'

const RECIPE_ID = 'ingestion-fixture-recipe'

const CONTENT = `INGREDIENTS
2 cups flour
1 tsp salt

INSTRUCTIONS
Step 1
Mix the flour and salt.
Step 2
Bake at 350F for 30 minutes.`

function recipe(content = CONTENT, id = RECIPE_ID): Recipe {
  return {
    id, recipeID: id, title: 'Ingestion Fixture Recipe', content,
    category: 'Breakfast', cuisine: 'american', imageURL: '', sourceURL: '', sourceFile: '',
    labels: '', hasImage: 'false', created: '', modified: '',
  }
}

function coverageFor(source: MappingRevisionSource) {
  return {
    ingredientRowCount: source.ingredients.length,
    nonHeaderIngredientRowCount: source.ingredients.length,
    stepCount: source.instructions.length,
    reviewedCellCount: source.ingredients.length * source.instructions.length,
  }
}

function response(
  source: MappingRevisionSource,
  recipeRevision: string,
  acceptedRelationships: Array<{ ingredientRowIndex: number; stepIndex: number }> = [],
): MappingReviewerResponseV1 {
  return {
    reviewerContractVersion: MAPPING_REVIEWER_CONTRACT_VERSION,
    promptVersion: COOKING_MODE_MAPPING_REVIEWER_PROMPT_VERSION,
    recipeRevision,
    coverage: coverageFor(source),
    acceptedRelationships,
  }
}

const deterministicIds = (kind: 'run' | 'attempt', slot: 'A' | 'B', attempt: number) => `${kind}-${slot}-${attempt}`
const deterministicNow = () => '2026-08-29T12:00:00.000Z'

async function liveSource(content = CONTENT): Promise<MappingRevisionSource> {
  const { parseRecipeContent } = await import('@/lib/recipeContent')
  const { ingredients, instructions } = parseRecipeContent(content)
  return { recipeId: RECIPE_ID, parserVersion: COOKING_MAPPING_PARSER_VERSION, ingredients, instructions }
}

let generate: ReturnType<typeof vi.fn>

beforeEach(() => {
  generate = vi.fn(async request => {
    const req = request as { prompt: string }
    // Both reviewer slots see the identical prompt; respond identically so
    // tests get deterministic AUTO_ACCEPT/REVIEW_REQUIRED without needing to
    // distinguish slot A from slot B.
    const revisionMatch = req.prompt.match(/Recipe revision: (\S+)/)
    const recipeRevision = revisionMatch?.[1] ?? ''
    const source = await liveSource()
    return response(source, recipeRevision, [{ ingredientRowIndex: 0, stepIndex: 0 }])
  })
})

describe('generateAndPersistCookingModeMappingProposal', () => {
  it('generates and persists a fresh proposal for a new recipe', async () => {
    const db = createFakeMappingFirestore()
    const result = await generateAndPersistCookingModeMappingProposal({
      recipeId: RECIPE_ID, recipe: recipe(), db,
      generate: generate as never, now: deterministicNow, idFactory: deterministicIds,
    })

    expect(result.outcome).toBe('GENERATED')
    expect(result.proposalId).toMatch(/^mp1:[0-9a-f]{64}$/)
    expect(generate).toHaveBeenCalledTimes(2) // exactly two blind reviewer slots

    const persisted = await getMappingProposal(RECIPE_ID, result.proposalId!, db)
    expect(persisted?.persistenceStatus).toBe('READY')
  })

  it('reuses an existing READY proposal for the identical revision without calling AI again', async () => {
    const db = createFakeMappingFirestore()
    const first = await generateAndPersistCookingModeMappingProposal({
      recipeId: RECIPE_ID, recipe: recipe(), db,
      generate: generate as never, now: deterministicNow, idFactory: deterministicIds,
    })
    expect(first.outcome).toBe('GENERATED')
    expect(generate).toHaveBeenCalledTimes(2)

    const second = await generateAndPersistCookingModeMappingProposal({
      recipeId: RECIPE_ID, recipe: recipe(), db,
      generate: generate as never, now: deterministicNow, idFactory: deterministicIds,
    })
    expect(second.outcome).toBe('REUSED_EXISTING')
    expect(second.proposalId).toBe(first.proposalId)
    expect(generate).toHaveBeenCalledTimes(2) // unchanged — no new AI calls
  })

  it('preserves candidate identity across a retry of the same revision', async () => {
    const db = createFakeMappingFirestore()
    const first = await generateAndPersistCookingModeMappingProposal({
      recipeId: RECIPE_ID, recipe: recipe(), db,
      generate: generate as never, now: deterministicNow, idFactory: deterministicIds,
    })
    const candidatesFirst = await listMappingCandidates(RECIPE_ID, first.proposalId!, db)

    const second = await generateAndPersistCookingModeMappingProposal({
      recipeId: RECIPE_ID, recipe: recipe(), db,
      generate: generate as never, now: deterministicNow, idFactory: deterministicIds,
    })
    const candidatesSecond = await listMappingCandidates(RECIPE_ID, second.proposalId!, db)

    expect(candidatesSecond.map(c => c.candidateId).sort()).toEqual(candidatesFirst.map(c => c.candidateId).sort())
  })

  it('does not regenerate for a metadata-only edit (revision unchanged)', async () => {
    const db = createFakeMappingFirestore()
    const original = recipe()
    const first = await generateAndPersistCookingModeMappingProposal({
      recipeId: RECIPE_ID, recipe: original, db,
      generate: generate as never, now: deterministicNow, idFactory: deterministicIds,
    })
    expect(first.outcome).toBe('GENERATED')

    const metadataEdited: Recipe = { ...original, imageURL: 'https://example.com/new.jpg', category: 'Snacks', cuisine: 'italian' }
    const second = await generateAndPersistCookingModeMappingProposal({
      recipeId: RECIPE_ID, recipe: metadataEdited, db,
      generate: generate as never, now: deterministicNow, idFactory: deterministicIds,
    })
    expect(second.outcome).toBe('REUSED_EXISTING')
    expect(second.recipeRevision).toBe(first.recipeRevision)
    expect(generate).toHaveBeenCalledTimes(2) // unchanged
  })

  it.each([
    ['ingredient text change', CONTENT.replace('2 cups flour', '3 cups flour')],
    ['ingredient order change', `INGREDIENTS\n1 tsp salt\n2 cups flour\n\nINSTRUCTIONS\nStep 1\nMix the flour and salt.\nStep 2\nBake at 350F for 30 minutes.`],
    ['instruction text change', CONTENT.replace('Bake at 350F for 30 minutes.', 'Bake at 375F for 25 minutes.')],
    ['instruction order change', `INGREDIENTS\n2 cups flour\n1 tsp salt\n\nINSTRUCTIONS\nStep 1\nBake at 350F for 30 minutes.\nStep 2\nMix the flour and salt.`],
  ])('regenerates for a %s (mapping-relevant edit)', async (_label, editedContent) => {
    const db = createFakeMappingFirestore()
    const first = await generateAndPersistCookingModeMappingProposal({
      recipeId: RECIPE_ID, recipe: recipe(), db,
      generate: generate as never, now: deterministicNow, idFactory: deterministicIds,
    })
    expect(first.outcome).toBe('GENERATED')

    const second = await generateAndPersistCookingModeMappingProposal({
      recipeId: RECIPE_ID, recipe: recipe(editedContent), db,
      generate: generate as never, now: deterministicNow, idFactory: deterministicIds,
    })
    expect(second.outcome).toBe('GENERATED')
    expect(second.recipeRevision).not.toBe(first.recipeRevision)
    expect(second.proposalId).not.toBe(first.proposalId)
    expect(generate).toHaveBeenCalledTimes(4) // two fresh reviewer calls for the new revision
  })

  it('leaves the old revision proposal/candidates immutable after a mapping-relevant edit', async () => {
    const db = createFakeMappingFirestore()
    const first = await generateAndPersistCookingModeMappingProposal({
      recipeId: RECIPE_ID, recipe: recipe(), db,
      generate: generate as never, now: deterministicNow, idFactory: deterministicIds,
    })
    const before = await getMappingProposal(RECIPE_ID, first.proposalId!, db)

    const edited = CONTENT.replace('2 cups flour', '4 cups flour')
    await generateAndPersistCookingModeMappingProposal({
      recipeId: RECIPE_ID, recipe: recipe(edited), db,
      generate: generate as never, now: deterministicNow, idFactory: deterministicIds,
    })

    const after = await getMappingProposal(RECIPE_ID, first.proposalId!, db)
    expect(after).toEqual(before)
  })

  it('reports FAILED (never throws) when the recipe does not exist', async () => {
    const db = createFakeMappingFirestore()
    const result = await generateAndPersistCookingModeMappingProposal({
      recipeId: 'missing-recipe', getRecipe: async () => null, db,
      generate: generate as never,
    })
    expect(result).toMatchObject({ outcome: 'FAILED', recipeId: 'missing-recipe', recipeRevision: null, proposalId: null })
    expect(result.error).toBeTruthy()
    expect(generate).not.toHaveBeenCalled()
  })

  it('reports BLOCKED (never throws) when reviewer execution cannot complete', async () => {
    const db = createFakeMappingFirestore()
    const alwaysFailing = vi.fn().mockRejectedValue(new Error('provider unavailable'))
    const result = await generateAndPersistCookingModeMappingProposal({
      recipeId: RECIPE_ID, recipe: recipe(), db,
      generate: alwaysFailing as never, now: deterministicNow, idFactory: deterministicIds,
    })
    expect(result.outcome).toBe('BLOCKED')
    expect(result.approvalBlocked).toBe(true)
  })

  it('rethrows centralized limiter denial instead of converting it to a blocked proposal', async () => {
    const db = createFakeMappingFirestore()
    const denied = vi.fn().mockRejectedValue(new AIAbuseControlError('concurrency', 45))

    await expect(generateAndPersistCookingModeMappingProposal({
      recipeId: RECIPE_ID, recipe: recipe(), db,
      generate: denied as never, now: deterministicNow, idFactory: deterministicIds,
    })).rejects.toEqual(expect.objectContaining({ reason: 'concurrency', status: 429 }))
  })

  it('reports FAILED (never throws) when persistence cannot durably complete', async () => {
    const source = await liveSource()
    const recipeRevision = await computeMappingRecipeRevision(source)
    const proposalId = await computeMappingProposalId({ recipeId: RECIPE_ID, recipeRevision })
    // Force a readback mismatch inside saveMappingProposal by poisoning the
    // candidate write for the one relationship this fixture's mocked
    // reviewers agree on.
    const { computeMappingCandidateId } = await import('@/lib/cookingModeMappingIdentity')
    const candidateId = await computeMappingCandidateId({ recipeId: RECIPE_ID, recipeRevision, ingredientRowIndex: 0, stepIndex: 0 })
    const db = createFakeMappingFirestore({ poisonedDocIds: new Set([candidateId]) })

    const result = await generateAndPersistCookingModeMappingProposal({
      recipeId: RECIPE_ID, recipe: recipe(), db,
      generate: generate as never, now: deterministicNow, idFactory: deterministicIds,
    })
    expect(result).toMatchObject({ outcome: 'FAILED', recipeId: RECIPE_ID, proposalId })
    expect(result.error).toBeTruthy()
  })
})

describe('ingestion never touches map approval or the current-approved pointer', () => {
  it('has no reference to approval/pointer-writing functions in source', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/cookingModeMappingIngestion.ts'), 'utf8')
    expect(source).not.toMatch(/updateCurrentApprovedMappingPointer|persistApprovedMapping|buildApprovedMapping/)
  })
})
