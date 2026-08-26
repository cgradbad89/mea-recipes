import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  AUTHORIZED_RECIPE_IDS,
  buildApplyPlan,
  commitContentPlan,
  evaluateManifestRow,
  isParserClean,
  sourceHash,
  validateLineProvenance,
  verifyReadback,
  writePayload,
} from '../scripts/excluded-recipe-wave3-core.mjs'

const root = process.cwd()
const manifestPath = path.join(root, 'docs/audits/excluded-recipe-wave3-dryrun-2026-08-26.json')

function cryptoSha(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function parse(content) {
  const lines = content.split('\n').map(line => line.trim()).filter(Boolean)
  const ingredientsAt = lines.indexOf('INGREDIENTS')
  const instructionsAt = lines.indexOf('INSTRUCTIONS')
  return {
    ingredients: ingredientsAt === -1 || instructionsAt === -1 ? [] : lines.slice(ingredientsAt + 1, instructionsAt),
    instructions: instructionsAt === -1 ? [] : lines.slice(instructionsAt + 1).filter(line => !/^Step \d+$/.test(line)),
  }
}

function sampleRow(overrides = {}) {
  const before = 'https://example.com\nINGREDIENTS\n1 cup rice\nINSTRUCTIONS\nCook the rice until tender.\nStorage note.'
  const proposed = 'https://example.com\n\nNOTES\nStorage note.\n\nINGREDIENTS\n1 cup rice\n\nINSTRUCTIONS\nStep 1\nCook the rice until tender.'
  return {
    recipeId: AUTHORIZED_RECIPE_IDS[0],
    title: 'Sample',
    sourceState: 'SOURCE_UNCHANGED',
    beforeContentSha256: cryptoSha(before),
    beforeSourceHash: sourceHash(['1 cup rice'], ['Cook the rice until tender.', 'Storage note.']),
    operations: ['MOVE_EXISTING_TEXT'],
    proposedContent: proposed,
    proposedContentSha256: cryptoSha(proposed),
    proposedParse: { ingredients: ['1 cup rice'], instructions: ['Cook the rice until tender.'] },
    provenance: {
      substantiveTextDerivedFromOriginal: true,
      inventedRecipeFacts: false,
      lineMappings: [
        { proposedLine: 'https://example.com', originalFragments: ['https://example.com'], transform: 'EXACT', category: 'SOURCE' },
        { proposedLine: 'Storage note.', originalFragments: ['Storage note.'], transform: 'EXACT', category: 'STORAGE' },
        { proposedLine: '1 cup rice', originalFragments: ['1 cup rice'], transform: 'EXACT', category: 'INGREDIENT' },
        { proposedLine: 'Cook the rice until tender.', originalFragments: ['Cook the rice until tender.'], transform: 'EXACT', category: 'ACTIONABLE_METHOD' },
      ],
    },
    safety: { parserClean: true, existingMapAbsent: true, unresolvedSourceGap: false },
    manualInspection: { passed: true },
    classification: 'READY',
    ...overrides,
  }
}

function live(overrides = {}) {
  const content = 'https://example.com\nINGREDIENTS\n1 cup rice\nINSTRUCTIONS\nCook the rice until tender.\nStorage note.'
  return { exists: true, data: { title: 'Sample', content }, updateTime: { seconds: 1 }, ...overrides }
}

describe('Wave 3 authorization and immutable evidence', () => {
  it('authorizes exactly the requested seven recipe IDs in sorted order', () => {
    expect(AUTHORIZED_RECIPE_IDS).toEqual([
      'chana-masala', 'dads-chili', 'easy-chicken-ramen',
      'lemon-herb-pasta-salad-with-marinated-chickpeas', 'lemongrass-chicken',
      'mole-poblano', 'tuscan-bean-soup',
    ])
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      expect(manifest.rows.map(row => row.recipeId)).toEqual([...AUTHORIZED_RECIPE_IDS])
      expect(manifest.rows).toHaveLength(7)
    }
  })

  it('rejects arbitrary IDs before any live parsing or write planning', () => {
    const parser = vi.fn(parse)
    const result = evaluateManifestRow({ row: sampleRow({ recipeId: 'arbitrary-recipe' }), live: live(), parseRecipeContent: parser })
    expect(result).toEqual({ status: 'ERROR', reason: 'UNAUTHORIZED_RECIPE_ID' })
    expect(parser).not.toHaveBeenCalled()
  })

  it('requires every substantive line to derive from exact original fragments', () => {
    const original = 'Marinated Chickpeas\nCook the rice\nuntil tender.'
    const proposed = 'INGREDIENTS\nMarinated Chickpeas:\nINSTRUCTIONS\nStep 1\nCook the rice until tender.'
    const mappings = [
      { proposedLine: 'Marinated Chickpeas:', originalFragments: ['Marinated Chickpeas'], transform: 'APPEND_STRUCTURAL_COLON' },
      { proposedLine: 'Cook the rice until tender.', originalFragments: ['Cook the rice', 'until tender.'], transform: 'JOIN_WITH_SPACE' },
    ]
    expect(validateLineProvenance(original, proposed, mappings)).toBe(true)
    expect(validateLineProvenance(original, `${proposed}\nInvented saffron.`, mappings)).toBe(false)
  })

  it('restores the exact existing chickpea quantity in the generated manifest', () => {
    if (!fs.existsSync(manifestPath)) return
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const row = manifest.rows.find(item => item.recipeId === 'lemon-herb-pasta-salad-with-marinated-chickpeas')
    expect(row.proposedParse.ingredients).toContain('one 14 ounce can chickpeas, drained and rinsed (DeLallo)')
    expect(row.provenance.lineMappings).toContainEqual(expect.objectContaining({
      proposedLine: 'one 14 ounce can chickpeas, drained and rinsed (DeLallo)',
      transform: 'EXACT',
    }))
  })
})

describe('Wave 3 live preconditions', () => {
  it('skips on a live content SHA mismatch', () => {
    const row = sampleRow()
    const result = evaluateManifestRow({ row, live: live({ data: { content: 'changed content' } }), parseRecipeContent: parse })
    expect(result.reason).toBe('LIVE_CONTENT_SHA_MISMATCH')
  })

  it('skips on a live sourceHash mismatch even when the content SHA precondition matches', () => {
    const changed = 'https://example.com\nINGREDIENTS\n1 cup rice\nINSTRUCTIONS\nCook differently until tender.\nStorage note.'
    const row = sampleRow({ beforeContentSha256: cryptoSha(changed) })
    const result = evaluateManifestRow({ row, live: live({ data: { content: changed } }), parseRecipeContent: parse })
    expect(result.reason).toBe('LIVE_SOURCE_HASH_MISMATCH')
  })

  it('skips before parsing when a map already exists', () => {
    const parser = vi.fn(parse)
    const result = evaluateManifestRow({ row: sampleRow(), live: live({ data: { content: 'same', cookingStepIngredientMap: {} } }), parseRecipeContent: parser })
    expect(result.reason).toBe('MAP_ALREADY_PRESENT')
    expect(parser).not.toHaveBeenCalled()
  })

  it('rejects a non-clean parse', () => {
    expect(isParserClean({ ingredients: ['1 cup rice'], instructions: ['Cook the rice until tender.'] })).toBe(true)
    expect(isParserClean({ ingredients: ['1 cup rice'], instructions: ['Calories: 200 kcal'] })).toBe(false)
  })
})

describe('Wave 3 content-only apply and readback', () => {
  it('constructs only the authorized content field', () => {
    expect(writePayload('canonical')).toEqual({ content: 'canonical' })
    expect(Object.keys(writePayload('canonical'))).toEqual(['content'])
  })

  it('uses one update-time-preconditioned batch without another field', async () => {
    const update = vi.fn()
    const commit = vi.fn(async () => [])
    const db = { batch: () => ({ update, commit }), collection: () => ({ doc: id => ({ id }) }) }
    const row = sampleRow()
    const result = await commitContentPlan(db, { readyToWrite: [{ row, updateTime: { seconds: 1 } }], skipped: [], errors: [] })
    expect(update).toHaveBeenCalledWith({ id: row.recipeId }, { content: row.proposedContent }, { lastUpdateTime: { seconds: 1 } })
    expect(result.committedWrites).toBe(1)
  })

  it('detects non-content changes and unexpected mapping fields on readback', () => {
    const row = sampleRow()
    const beforeNonContentHash = cryptoSha(JSON.stringify({ title: 'Sample' }))
    const plan = { readyToWrite: [{ row, beforeNonContentHash }], skipped: [], errors: [] }
    const result = verifyReadback({
      manifest: { rows: [row] },
      plan,
      liveById: new Map([[row.recipeId, { exists: true, data: { title: 'Changed', content: row.proposedContent, cookingStepIngredientMap: {} } }]]),
      parseRecipeContent: parse,
    })
    expect(result.nonContentMismatches).toBe(1)
    expect(result.mapFieldsPresent).toBe(1)
  })

  it('is idempotent after the exact manifest content is applied', () => {
    const row = sampleRow()
    const plan = buildApplyPlan({ manifest: { rows: [row] }, liveById: new Map([[row.recipeId, { exists: true, data: { content: row.proposedContent } }]]), parseRecipeContent: parse })
    expect(plan.readyToWrite).toHaveLength(0)
    expect(plan.skipped[0].reason).toBe('ALREADY_APPLIED')
  })

  it('contains no AI, deterministic-map, hybrid-map, or mapping persistence surface', () => {
    const sources = ['scripts/remediate-excluded-recipe-wave3.mjs', 'scripts/excluded-recipe-wave3-core.mjs']
      .map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n')
    for (const token of [
      'build' + 'DeterministicCookingStepMap', 'prepare' + 'CookingStepIngredientMap',
      '/api/' + 'cooking-step-map', '@ai-sdk/' + 'gateway', 'generate' + 'Object(',
      'hybrid' + '-v4', 'deterministic' + '-v4',
    ]) expect(sources).not.toContain(token)
  })
})
