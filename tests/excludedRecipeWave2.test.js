import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  AUTHORIZED_RECIPE_IDS,
  buildApplyPlan,
  commitContentPlan,
  evaluateManifestRow,
  isContentDerivedOnlyFromOriginal,
  isParserClean,
  sourceHash,
  validateManifest,
  verifyReadback,
  writePayload,
} from '../scripts/excluded-recipe-wave2-core.mjs'

const root = process.cwd()
const manifestPath = path.join(root, 'docs/audits/excluded-recipe-wave2-dryrun-2026-08-26.json')

function sampleRow(overrides = {}) {
  const before = 'https://example.com\nINGREDIENTS\n1 cup rice\nINSTRUCTIONS\nCook the rice until tender.\nStorage note.'
  const proposed = 'https://example.com\n\nNOTES\nStorage note.\n\nINGREDIENTS\n1 cup rice\n\nINSTRUCTIONS\nStep 1\nCook the rice until tender.'
  return {
    recipeId: AUTHORIZED_RECIPE_IDS[0],
    title: 'Sample',
    beforeContentSha256: cryptoSha(before),
    beforeSourceHash: sourceHash(['1 cup rice'], ['Cook the rice until tender.', 'Storage note.']),
    proposedContent: proposed,
    proposedContentSha256: cryptoSha(proposed),
    proposedParse: { ingredients: ['1 cup rice'], instructions: ['Cook the rice until tender.'] },
    safety: { allAddedTextExistsInOriginal: true, inventedFacts: false, parserClean: true, existingMapAbsent: true },
    classification: 'READY',
    ...overrides,
  }
}

function cryptoSha(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function parse(content) {
  const lines = content.split('\n').map(line => line.trim()).filter(Boolean)
  const ingredientsAt = lines.indexOf('INGREDIENTS')
  const instructionsAt = lines.indexOf('INSTRUCTIONS')
  return {
    ingredients: lines.slice(ingredientsAt + 1, instructionsAt).filter(line => line !== 'NOTES'),
    instructions: lines.slice(instructionsAt + 1).filter(line => !/^Step \d+$/.test(line)),
  }
}

function live(row = sampleRow(), overrides = {}) {
  const before = 'https://example.com\nINGREDIENTS\n1 cup rice\nINSTRUCTIONS\nCook the rice until tender.\nStorage note.'
  return { exists: true, data: { title: 'Sample', content: before }, updateTime: { seconds: 1 }, ...overrides }
}

describe('Wave 2 exact manifest boundary', () => {
  it('contains exactly the six authorized recipe IDs in deterministic order', () => {
    if (!fs.existsSync(manifestPath)) return
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    expect(manifest.rows.map(row => row.recipeId)).toEqual([...AUTHORIZED_RECIPE_IDS])
    expect(manifest.rows).toHaveLength(6)
  })

  it('rejects arbitrary recipe IDs', () => {
    const rows = AUTHORIZED_RECIPE_IDS.map(recipeId => sampleRow({ recipeId }))
    rows[0].recipeId = 'arbitrary-recipe'
    expect(() => validateManifest({ schemaVersion: 1, rows })).toThrow(/exact authorized population/)
  })

  it('detects invented proposed text', () => {
    const original = 'INGREDIENTS\n1 cup rice\nINSTRUCTIONS\nCook until tender.'
    expect(isContentDerivedOnlyFromOriginal(original, `${original}\nInvented saffron.`)).toBe(false)
    expect(isContentDerivedOnlyFromOriginal(original, `INGREDIENTS\n1 cup rice\nINSTRUCTIONS\nStep 1\nCook until tender.`)).toBe(true)
  })
})

describe('Wave 2 live preconditions', () => {
  it('skips on a live content SHA mismatch', () => {
    const row = sampleRow()
    const result = evaluateManifestRow({ row, live: live(row, { data: { content: 'changed content' } }), parseRecipeContent: parse })
    expect(result.reason).toBe('LIVE_CONTENT_SHA_MISMATCH')
  })

  it('skips before parsing when a map already exists', () => {
    const parser = vi.fn(parse)
    const row = sampleRow()
    const result = evaluateManifestRow({ row, live: live(row, { data: { content: 'same', cookingStepIngredientMap: {} } }), parseRecipeContent: parser })
    expect(result.reason).toBe('MAP_ALREADY_PRESENT')
    expect(parser).not.toHaveBeenCalled()
  })

  it('requires the immutable proposed parse to remain clean', () => {
    expect(isParserClean({ ingredients: ['1 cup rice'], instructions: ['Cook the rice until tender.'] })).toBe(true)
    expect(isParserClean({ ingredients: ['1 cup rice'], instructions: ['https://example.com'] })).toBe(false)
  })

  it('plans only live rows that pass every gate', () => {
    const row = sampleRow()
    const manifest = { rows: [row] }
    const plan = buildApplyPlan({ manifest, liveById: new Map([[row.recipeId, live(row)]]), parseRecipeContent: parse })
    expect(plan.readyToWrite).toHaveLength(1)
    expect(plan.errors).toEqual([])
  })
})

describe('Wave 2 field-only apply and verification', () => {
  it('constructs a content-only payload', () => {
    expect(writePayload('canonical')).toEqual({ content: 'canonical' })
    expect(Object.keys(writePayload('canonical'))).toEqual(['content'])
  })

  it('uses one preconditioned batch and never writes another field', async () => {
    const update = vi.fn()
    const commit = vi.fn(async () => [])
    const db = { batch: () => ({ update, commit }), collection: () => ({ doc: id => ({ id }) }) }
    const row = sampleRow()
    const result = await commitContentPlan(db, { readyToWrite: [{ row, updateTime: { seconds: 1 } }], skipped: [], errors: [] })
    expect(update).toHaveBeenCalledWith({ id: row.recipeId }, { content: row.proposedContent }, { lastUpdateTime: { seconds: 1 } })
    expect(result.committedWrites).toBe(1)
  })

  it('detects any non-content readback mutation', () => {
    const row = sampleRow()
    const beforeNonContentHash = crypto.createHash('sha256').update(JSON.stringify({ title: 'Sample' })).digest('hex')
    const plan = { readyToWrite: [{ row, beforeNonContentHash }], skipped: [], errors: [] }
    const result = verifyReadback({
      manifest: { rows: [row] },
      plan,
      liveById: new Map([[row.recipeId, { exists: true, data: { title: 'Changed', content: row.proposedContent } }]]),
      parseRecipeContent: parse,
    })
    expect(result.nonContentMismatches).toBe(1)
  })

  it('is idempotent after exact content is already applied', () => {
    const row = sampleRow()
    const manifest = { rows: [row] }
    const applied = { exists: true, data: { content: row.proposedContent } }
    const plan = buildApplyPlan({ manifest, liveById: new Map([[row.recipeId, applied]]), parseRecipeContent: parse })
    expect(plan.readyToWrite).toHaveLength(0)
    expect(plan.skipped[0].reason).toBe('ALREADY_APPLIED')
  })

  it('contains no mapping-generation or AI call surface', () => {
    const sources = ['scripts/remediate-excluded-recipe-wave2.mjs', 'scripts/excluded-recipe-wave2-core.mjs']
      .map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n')
    for (const token of [
      'build' + 'DeterministicCookingStepMap',
      'prepare' + 'CookingStepIngredientMap',
      '/api/' + 'cooking-step-map',
      '@ai-sdk/' + 'gateway',
      'generate' + 'Object(',
    ]) expect(sources).not.toContain(token)
  })
})
