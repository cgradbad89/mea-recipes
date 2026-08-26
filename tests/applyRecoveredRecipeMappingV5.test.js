import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  AUTHORIZED_MANIFEST_PATH,
  AUTHORIZED_MANIFEST_SHA256,
  EXPECTED_COUNTS,
  FORBIDDEN_RECOVERED_V4_MANIFEST,
  SEMANTIC_EVIDENCE_PATH,
  UNRESOLVED_RECIPE_IDS,
  buildApplyPlan,
  commitApplyPlan,
  documentHash,
  loadAuthorizedManifest,
  loadValidationBaselines,
  parseMode,
  snapshotProtectedDocuments,
  validateManifestStructure,
  verifyAuthorizedManifestBytes,
  verifyProtectedDocumentsUnchanged,
  verifyReadback,
  writePayload,
} from '../scripts/apply-recovered-recipe-mapping-v5-core.mjs'

const root = process.cwd()
const manifestBytes = fs.readFileSync(path.join(root, AUTHORIZED_MANIFEST_PATH))
const manifestRows = JSON.parse(manifestBytes.toString('utf8'))
const sourceHash = 'a'.repeat(64)

function candidate(overrides = {}) {
  return {
    schemaVersion: 1,
    parserVersion: 'recipe-content-v1',
    engineVersion: 'deterministic-v5',
    sourceHash,
    steps: [{ instructionIndex: 0, ingredients: [] }],
    ...overrides,
  }
}

function row(overrides = {}) {
  return { recipeId: 'safe-recipe', title: 'Safe', sourceHash, candidateMap: candidate(), ...overrides }
}

function live(data = { content: 'Ingredients\nSalt\nInstructions\nCook.' }, overrides = {}) {
  return { exists: true, data, updateTime: { seconds: 1, nanoseconds: 0 }, ...overrides }
}

function operations(overrides = {}) {
  return {
    parseRecipeContent: vi.fn(() => ({ ingredients: ['Salt'], instructions: ['Cook.'] })),
    computeSourceHash: vi.fn(async () => sourceHash),
    validateCandidate: vi.fn(() => ({ valid: true })),
    ...overrides,
  }
}

async function planFor(recipeRow = row(), recipeLive = live(), overrides = {}) {
  return buildApplyPlan({
    readyRows: [recipeRow],
    liveById: new Map([[recipeRow.recipeId, recipeLive]]),
    baselines: new Map([[recipeRow.recipeId, candidate()]]),
    ...operations(overrides),
  })
}

describe('recovered-v5 immutable authorization', () => {
  it('aborts on the wrong manifest hash', () => {
    expect(() => verifyAuthorizedManifestBytes(Buffer.from('wrong'))).toThrow(/MANIFEST HASH MISMATCH/)
  })

  it('rejects the recovered-v4 manifest', () => {
    const bytes = fs.readFileSync(path.join(root, FORBIDDEN_RECOVERED_V4_MANIFEST))
    expect(() => loadAuthorizedManifest(bytes, FORBIDDEN_RECOVERED_V4_MANIFEST)).toThrow(/Unauthorized manifest path/)
  })

  it('makes an arbitrary manifest path or mode argument impossible', () => {
    expect(() => loadAuthorizedManifest(manifestBytes, 'other.json')).toThrow(/Unauthorized manifest path/)
    expect(() => parseMode(['--apply', '--manifest', 'other.json'])).toThrow(/exactly one mode/)
    expect(() => parseMode([])).toThrow(/exactly one mode/)
  })

  it('accepts exactly the locked 41-row READY manifest', () => {
    const loaded = loadAuthorizedManifest(manifestBytes)
    expect(loaded.actualSha256).toBe(AUTHORIZED_MANIFEST_SHA256)
    expect(loaded.counts).toMatchObject({ rows: 41, uniqueRecipeIds: 41, READY: 41 })
  })

  it('requires the exact 28 + 6 + 7 repair-wave partition', () => {
    expect(loadAuthorizedManifest(manifestBytes).counts.repairWaves).toEqual({ WAVE_1A: 28, WAVE_2: 6, WAVE_3: 7 })
    const corrupted = structuredClone(manifestRows)
    corrupted[0].repairWave = 'WAVE_2'
    expect(() => validateManifestStructure(corrupted)).toThrow(/count mismatch/)
  })

  it('aborts on duplicate recipe IDs', () => {
    const corrupted = structuredClone(manifestRows)
    corrupted[1].recipeId = corrupted[0].recipeId
    expect(() => validateManifestStructure(corrupted)).toThrow(/Duplicate recipeId/)
  })

  it('admits none of the unresolved eight', () => {
    const ids = new Set(manifestRows.map(item => item.recipeId))
    expect(UNRESOLVED_RECIPE_IDS).toHaveLength(8)
    expect(UNRESOLVED_RECIPE_IDS.filter(id => ids.has(id))).toEqual([])
  })

  it('loads 41 validator baselines from separately locked semantic evidence', () => {
    const baselines = loadValidationBaselines(
      fs.readFileSync(path.join(root, SEMANTIC_EVIDENCE_PATH)), manifestRows,
    )
    expect(baselines.size).toBe(EXPECTED_COUNTS.READY)
  })
})

describe('complete live preflight', () => {
  it('skips a missing recipe', async () => {
    expect((await planFor(row(), { exists: false, data: null })).skipped[0].reason).toBe('RECIPE_MISSING')
  })

  it('skips an existing map before parsing', async () => {
    const ops = operations()
    const recipeRow = row()
    const plan = await buildApplyPlan({
      readyRows: [recipeRow],
      liveById: new Map([[recipeRow.recipeId, live({ content: 'same', cookingStepIngredientMap: candidate() })]]),
      baselines: new Map([[recipeRow.recipeId, candidate()]]),
      ...ops,
    })
    expect(plan.skipped[0].reason).toBe('MAP_ALREADY_PRESENT')
    expect(ops.parseRecipeContent).not.toHaveBeenCalled()
  })

  it('skips a sourceHash mismatch', async () => {
    const plan = await planFor(row(), live(), { computeSourceHash: vi.fn(async () => 'b'.repeat(64)) })
    expect(plan.skipped[0].reason).toBe('SOURCE_HASH_MISMATCH')
  })

  it('skips an invalid candidate without replacing it', async () => {
    const plan = await planFor(row(), live(), { validateCandidate: vi.fn(() => ({ valid: false, reason: 'bad' })) })
    expect(plan.skipped[0]).toMatchObject({ reason: 'CANDIDATE_INVALID', validationReason: 'bad' })
  })

  it('skips an unsupported candidate engine', async () => {
    const plan = await planFor(row({ candidateMap: candidate({ engineVersion: 'hybrid-v4' }) }))
    expect(plan.skipped[0].reason).toBe('VERSION_MISMATCH')
  })

  it('marks a fully valid row READY_TO_WRITE', async () => {
    const plan = await planFor()
    expect(plan.readyToWrite).toHaveLength(1)
    expect(plan.readyToWrite[0].nonMapHash).toBe(documentHash(live().data, { excludeMap: true }))
  })

  it('records unexpected evaluation errors and prevents eligibility', async () => {
    const plan = await planFor(row(), live(), {
      computeSourceHash: vi.fn(async () => { throw new Error('unexpected') }),
    })
    expect(plan.unexpectedErrors).toEqual([{ recipeId: 'safe-recipe', message: 'unexpected' }])
    expect(plan.readyToWrite).toHaveLength(0)
  })

  it('post-apply planning produces zero writes for an existing exact map', async () => {
    const plan = await planFor(row(), live({ content: 'same', cookingStepIngredientMap: candidate() }))
    expect(plan.readyToWrite).toHaveLength(0)
    expect(plan.skipped[0].reason).toBe('MAP_ALREADY_PRESENT')
  })
})

describe('field-only atomic write and integrity', () => {
  it('creates only the cookingStepIngredientMap payload', () => {
    expect(writePayload(candidate())).toEqual({ cookingStepIngredientMap: candidate() })
    expect(Object.keys(writePayload(candidate()))).toEqual(['cookingStepIngredientMap'])
  })

  it('rejects a write population above 41', async () => {
    const db = { batch: vi.fn() }
    const item = { row: row(), updateTime: { seconds: 1 } }
    await expect(commitApplyPlan(db, {
      readyToWrite: Array.from({ length: 42 }, () => item), skipped: [], unexpectedErrors: [],
    })).rejects.toThrow(/exceed.*41/)
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('aborts batch creation on any unexpected preflight error', async () => {
    const db = { batch: vi.fn() }
    await expect(commitApplyPlan(db, {
      readyToWrite: [], skipped: [], unexpectedErrors: [{ message: 'bad' }],
    })).rejects.toThrow(/prevent batch commit/)
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('uses one update-time-preconditioned batch with the exact candidate', async () => {
    const update = vi.fn()
    const commit = vi.fn(async () => [])
    const db = {
      batch: vi.fn(() => ({ update, commit })),
      collection: vi.fn(() => ({ doc: vi.fn(id => ({ id })) })),
    }
    const recipeRow = row()
    const updateTime = { seconds: 1, nanoseconds: 2 }
    const result = await commitApplyPlan(db, {
      readyToWrite: [{ row: recipeRow, updateTime }], skipped: [], unexpectedErrors: [],
    })
    expect(update).toHaveBeenCalledWith(
      { id: recipeRow.recipeId },
      { cookingStepIngredientMap: recipeRow.candidateMap },
      { lastUpdateTime: updateTime },
    )
    expect(commit).toHaveBeenCalledOnce()
    expect(result).toEqual({ batchCount: 1, attemptedWrites: 1, committedWrites: 1 })
  })

  it('requires exact candidate equality on readback', async () => {
    const recipeRow = row()
    const before = live().data
    const plan = { readyToWrite: [{ row: recipeRow, nonMapHash: documentHash(before, { excludeMap: true }) }], skipped: [], unexpectedErrors: [] }
    const changed = candidate({ steps: [{ instructionIndex: 0, ingredients: [], unresolvedReason: 'ambiguous' }] })
    const result = await verifyReadback({
      readyRows: [recipeRow], plan,
      liveById: new Map([[recipeRow.recipeId, live({ ...before, cookingStepIngredientMap: changed })]]),
      baselines: new Map([[recipeRow.recipeId, candidate()]]), ...operations(),
    })
    expect(result.exactCandidateMatches).toBe(0)
    expect(result.unexpectedStates).toBe(1)
  })

  it('detects raw non-map field changes', async () => {
    const recipeRow = row()
    const before = live().data
    const plan = { readyToWrite: [{ row: recipeRow, nonMapHash: documentHash(before, { excludeMap: true }) }], skipped: [], unexpectedErrors: [] }
    const result = await verifyReadback({
      readyRows: [recipeRow], plan,
      liveById: new Map([[recipeRow.recipeId, live({ ...before, title: 'changed', cookingStepIngredientMap: candidate() })]]),
      baselines: new Map([[recipeRow.recipeId, candidate()]]), ...operations(),
    })
    expect(result.rawNonMapMismatches).toBe(1)
  })

  it('detects mutation of an original mapped recipe', () => {
    const beforeDocs = new Map([['mapped', live({ cookingStepIngredientMap: candidate(), unknown: 1 })]])
    const snapshot = snapshotProtectedDocuments(beforeDocs, ['mapped'])
    const afterDocs = new Map([['mapped', live({ cookingStepIngredientMap: candidate(), unknown: 2 })]])
    expect(verifyProtectedDocumentsUnchanged(snapshot, afterDocs).changed).toBe(1)
  })

  it('detects mutation of an unresolved recipe', () => {
    const beforeDocs = new Map([['unresolved', live({ content: 'unsafe' })]])
    const snapshot = snapshotProtectedDocuments(beforeDocs, ['unresolved'])
    const afterDocs = new Map([['unresolved', live({ content: 'unsafe', cookingStepIngredientMap: candidate() })]])
    expect(verifyProtectedDocumentsUnchanged(snapshot, afterDocs).changed).toBe(1)
  })

  it('contains no AI invocation surface', () => {
    const sources = ['scripts/apply-recovered-recipe-mapping-v5-core.mjs', 'scripts/apply-recovered-recipe-mapping-v5-manifest.mjs']
      .map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n')
    expect(sources).not.toContain('@ai-sdk/' + 'gateway')
    expect(sources).not.toContain('cookingStepMapping' + 'Ai')
    expect(sources).not.toContain('generate' + 'Object(')
  })

  it('contains no mapping generator invocation surface', () => {
    const sources = ['scripts/apply-recovered-recipe-mapping-v5-core.mjs', 'scripts/apply-recovered-recipe-mapping-v5-manifest.mjs']
      .map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n')
    expect(sources).not.toContain('build' + 'DeterministicCookingStepMap')
    expect(sources).not.toContain('prepare' + 'CookingStepIngredientMap')
    expect(sources).not.toContain('/api/' + 'cooking-step-map')
  })
})
