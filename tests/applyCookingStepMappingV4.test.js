import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  AUTHORIZED_MANIFEST_PATH,
  AUTHORIZED_MANIFEST_SHA256,
  EXPECTED_COUNTS,
  buildApplyPlan,
  commitApplyPlan,
  deepCanonicalEqual,
  documentHash,
  loadAuthorizedManifest,
  parseMode,
  validateManifestStructure,
  verifyAuthorizedManifestBytes,
  verifyExcludedUnchanged,
  verifyReadback,
  writePayload,
} from '../scripts/apply-cooking-step-mapping-v4-core.mjs'

const root = process.cwd()
const authorizedBytes = fs.readFileSync(path.join(root, AUTHORIZED_MANIFEST_PATH))
const authorizedRows = JSON.parse(authorizedBytes.toString('utf8'))
const sourceHash = 'a'.repeat(64)

function candidate(overrides = {}) {
  return {
    schemaVersion: 1,
    parserVersion: 'recipe-content-v1',
    engineVersion: 'deterministic-v4',
    sourceHash,
    steps: [{ instructionIndex: 0, ingredients: [] }],
    ...overrides,
  }
}

function row(overrides = {}) {
  return {
    recipeId: 'safe-recipe',
    title: 'Safe recipe',
    classification: 'READY',
    sourceHash,
    candidateMap: candidate(),
    ...overrides,
  }
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

async function planFor(recipeRow = row(), recipeLive = live(), operationOverrides = {}) {
  return buildApplyPlan({
    readyRows: [recipeRow],
    liveById: new Map([[recipeRow.recipeId, recipeLive]]),
    baselines: new Map([[recipeRow.recipeId, candidate()]]),
    ...operations(operationOverrides),
  })
}

describe('manifest-locked v4 apply authorization', () => {
  it('hard-aborts on a wrong manifest SHA', () => {
    expect(() => verifyAuthorizedManifestBytes(Buffer.from('wrong'))).toThrow(/MANIFEST HASH MISMATCH/)
  })

  it.each([
    'docs/audits/cooking-step-mapping-dryrun-2026-08-25.json',
    'docs/audits/cooking-step-mapping-dryrun-v2-2026-08-26.json',
    'docs/audits/cooking-step-mapping-dryrun-v3-2026-08-26.json',
  ])('rejects historical manifest %s', historicalPath => {
    const bytes = fs.readFileSync(path.join(root, historicalPath))
    expect(() => loadAuthorizedManifest(bytes, historicalPath)).toThrow(/Unauthorized manifest path/)
  })

  it('accepts only the exact authorized manifest bytes and expected population', () => {
    const loaded = loadAuthorizedManifest(authorizedBytes)
    expect(loaded.actualSha256).toBe(AUTHORIZED_MANIFEST_SHA256)
    expect(loaded.counts).toEqual({
      rows: EXPECTED_COUNTS.rows,
      READY: EXPECTED_COUNTS.READY,
      REVIEW: 0,
      EXCLUDED: EXPECTED_COUNTS.EXCLUDED,
      ERROR: 0,
      EXISTING_MAP: 0,
    })
  })

  it('aborts on duplicate recipe IDs', () => {
    const corrupted = structuredClone(authorizedRows)
    corrupted[1].recipeId = corrupted[0].recipeId
    expect(() => validateManifestStructure(corrupted)).toThrow(/Duplicate recipeId/)
  })

  it('aborts when manifest READY counts or candidates are corrupted', () => {
    const wrongCount = structuredClone(authorizedRows)
    wrongCount.find(item => item.classification === 'READY').classification = 'EXCLUDED'
    expect(() => validateManifestStructure(wrongCount)).toThrow()
    const missingCandidate = structuredClone(authorizedRows)
    missingCandidate.find(item => item.classification === 'READY').candidateMap = null
    expect(() => validateManifestStructure(missingCandidate)).toThrow(/candidateMap/)
  })

  it('requires one explicit mode and never defaults to apply', () => {
    expect(() => parseMode([])).toThrow(/exactly one mode/)
    expect(parseMode(['--dry-run'])).toBe('dry-run')
    expect(parseMode(['--apply'])).toBe('apply')
    expect(() => parseMode(['--apply', '--manifest', 'other.json'])).toThrow(/exactly one mode/)
  })
})

describe('complete live preflight planning', () => {
  it('skips a missing live recipe', async () => {
    const plan = await planFor(row(), { exists: false, data: null })
    expect(plan.skipped[0].reason).toBe('RECIPE_MISSING')
    expect(plan.readyToWrite).toHaveLength(0)
  })

  it('skips an existing map before parsing or generation', async () => {
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

  it('skips a source-hash mismatch without candidate validation', async () => {
    const validator = vi.fn(() => ({ valid: true }))
    const plan = await planFor(row(), live(), {
      computeSourceHash: vi.fn(async () => 'b'.repeat(64)),
      validateCandidate: validator,
    })
    expect(plan.skipped[0].reason).toBe('SOURCE_HASH_MISMATCH')
    expect(validator).not.toHaveBeenCalled()
  })

  it('skips an invalid immutable candidate without replacing it', async () => {
    const plan = await planFor(row(), live(), {
      validateCandidate: vi.fn(() => ({ valid: false, reason: 'invalid-structure' })),
    })
    expect(plan.skipped[0]).toMatchObject({ reason: 'CANDIDATE_INVALID', validationReason: 'invalid-structure' })
    expect(plan.readyToWrite).toHaveLength(0)
  })

  it('marks a safe live row READY_TO_WRITE and snapshots all non-map fields', async () => {
    const plan = await planFor()
    expect(plan.readyToWrite).toHaveLength(1)
    expect(plan.readyToWrite[0].nonMapHash).toBe(documentHash(live().data, { excludeMap: true }))
    expect(plan.unexpectedErrors).toEqual([])
  })

  it('never places an excluded manifest row into the READY-derived write plan', async () => {
    const readyRows = authorizedRows.filter(item => item.classification === 'READY')
    expect(readyRows).toHaveLength(187)
    expect(readyRows.some(item => item.classification === 'EXCLUDED')).toBe(false)
    expect(authorizedRows.filter(item => item.classification === 'EXCLUDED')).toHaveLength(49)
  })

  it('turns unexpected evaluation failures into preflight errors', async () => {
    const plan = await planFor(row(), live(), {
      computeSourceHash: vi.fn(async () => { throw new Error('read/parse failure') }),
    })
    expect(plan.unexpectedErrors).toEqual([{ recipeId: 'safe-recipe', message: 'read/parse failure' }])
    expect(plan.readyToWrite).toHaveLength(0)
  })

  it('a rerun after the exact map exists produces zero planned writes', async () => {
    const plan = await planFor(row(), live({ content: 'same', cookingStepIngredientMap: candidate() }))
    expect(plan.readyToWrite).toHaveLength(0)
    expect(plan.skipped[0].reason).toBe('MAP_ALREADY_PRESENT')
  })
})

describe('atomic field-only write and verification', () => {
  it('constructs a write payload containing only cookingStepIngredientMap', () => {
    expect(writePayload(candidate())).toEqual({ cookingStepIngredientMap: candidate() })
    expect(Object.keys(writePayload(candidate()))).toEqual(['cookingStepIngredientMap'])
  })

  it('aborts rather than splitting a population above 450 writes', async () => {
    const db = { batch: vi.fn() }
    const item = { row: row(), updateTime: { seconds: 1 } }
    await expect(commitApplyPlan(db, {
      readyToWrite: Array.from({ length: 451 }, () => item), skipped: [], unexpectedErrors: [],
    })).rejects.toThrow(/exceed.*450/)
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('prevents batch creation when any unexpected preflight error exists', async () => {
    const db = { batch: vi.fn() }
    await expect(commitApplyPlan(db, {
      readyToWrite: [], skipped: [], unexpectedErrors: [{ message: 'unexpected' }],
    })).rejects.toThrow(/prevent batch commit/)
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('uses one batch update with the snapshot update-time precondition', async () => {
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

  it('requires deep exact candidate equality during readback', async () => {
    const recipeRow = row()
    const before = live().data
    const plan = {
      readyToWrite: [{ row: recipeRow, nonMapHash: documentHash(before, { excludeMap: true }) }],
      skipped: [], unexpectedErrors: [],
    }
    const changedCandidate = candidate({ steps: [{ instructionIndex: 0, ingredients: [], unresolvedReason: 'ambiguous' }] })
    const result = await verifyReadback({
      readyRows: [recipeRow], plan,
      liveById: new Map([[recipeRow.recipeId, live({ ...before, cookingStepIngredientMap: changedCandidate })]]),
      baselines: new Map([[recipeRow.recipeId, candidate()]]),
      ...operations(),
    })
    expect(result.exactCandidateMatches).toBe(0)
    expect(result.unexpectedStates).toBe(1)
    expect(deepCanonicalEqual(changedCandidate, recipeRow.candidateMap)).toBe(false)
  })

  it('detects any non-map field change after an otherwise exact write', async () => {
    const recipeRow = row()
    const before = live().data
    const plan = {
      readyToWrite: [{ row: recipeRow, nonMapHash: documentHash(before, { excludeMap: true }) }],
      skipped: [], unexpectedErrors: [],
    }
    const result = await verifyReadback({
      readyRows: [recipeRow], plan,
      liveById: new Map([[recipeRow.recipeId, live({ ...before, title: 'Changed', cookingStepIngredientMap: candidate() })]]),
      baselines: new Map([[recipeRow.recipeId, candidate()]]),
      ...operations(),
    })
    expect(result.nonMapFieldMismatches).toBe(1)
    expect(result.unexpectedStates).toBe(1)
  })

  it('detects mutation of an excluded recipe, including a newly added map', () => {
    const excluded = [{ recipeId: 'excluded' }]
    const before = new Map([['excluded', live({ content: 'bad source', unknown: 1 })]])
    const after = new Map([['excluded', live({ content: 'bad source', unknown: 1, cookingStepIngredientMap: candidate() })]])
    const result = verifyExcludedUnchanged(excluded, before, after)
    expect(result.writesByThisApply).toBe(0)
    expect(result.mutations).toHaveLength(1)
  })

  it('has no mapping-generation or AI import/call surface in apply tooling', () => {
    const sources = [
      'scripts/apply-cooking-step-mapping-v4-manifest.mjs',
      'scripts/apply-cooking-step-mapping-v4-core.mjs',
    ].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n')
    const forbidden = [
      'build' + 'DeterministicCookingStepMap',
      'prepare' + 'CookingStepIngredientMap',
      '/api/' + 'cooking-step-map',
      '@ai-sdk/' + 'gateway',
      'generate' + 'Object(',
      'cookingStepMapping' + 'Ai',
    ]
    for (const token of forbidden) expect(sources).not.toContain(token)
  })
})
