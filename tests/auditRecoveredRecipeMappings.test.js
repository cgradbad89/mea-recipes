import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AUTHORIZED_RECIPE_IDS,
  EXPECTED_CONFIGURATION,
  REPAIR_WAVES,
  UNRESOLVED_RECIPE_IDS,
  aiReviewGate,
  assertAuthorizedPopulation,
  classifyRecoveredRecipe,
  deterministicReviewGate,
  readyRecoveredManifestInvariant,
  sortRows,
} from '../scripts/audit-recovered-recipe-mappings-core.mjs'

describe('recovered-recipe mapping audit population', () => {
  it('contains exactly the unique 28 + 6 + 7 authorized recipes', () => {
    expect(REPAIR_WAVES.WAVE_1A).toHaveLength(28)
    expect(REPAIR_WAVES.WAVE_2).toHaveLength(6)
    expect(REPAIR_WAVES.WAVE_3).toHaveLength(7)
    expect(AUTHORIZED_RECIPE_IDS).toHaveLength(41)
    expect(new Set(AUTHORIZED_RECIPE_IDS).size).toBe(41)
    expect(assertAuthorizedPopulation()).toBe(true)
  })

  it('admits none of the final eight unresolved recipes', () => {
    expect(UNRESOLVED_RECIPE_IDS).toHaveLength(8)
    expect(UNRESOLVED_RECIPE_IDS.filter(id => AUTHORIZED_RECIPE_IDS.includes(id))).toEqual([])
  })

  it('stamps the exact audited v4 configuration', () => {
    expect(EXPECTED_CONFIGURATION).toEqual({
      schemaVersion: 1,
      parserVersion: 'recipe-content-v1',
      deterministicEngineVersion: 'deterministic-v4',
      hybridEngineVersion: 'hybrid-v4',
      promptVersion: 'v2',
      model: 'openai/gpt-5.6-luna',
      temperature: 0,
    })
  })
})

describe('recovered-recipe mapping gates', () => {
  const safeEvidence = {
    currentMapPresent: false,
    sourceStatus: 'SOURCE_CLEAN',
    deterministicFalsePositive: false,
    aiAmbiguous: 0,
    aiIncorrect: 0,
    stability: 'EXACT_STABLE',
    candidateValid: true,
    sourceHashMatches: true,
  }

  it('never classifies an existing map as READY', () => {
    expect(classifyRecoveredRecipe({ ...safeEvidence, currentMapPresent: true }).classification).toBe('EXISTING_MAP')
  })

  it('never classifies source-hash mismatch as READY', () => {
    expect(classifyRecoveredRecipe({ ...safeEvidence, sourceHashMatches: false }).classification).toBe('ERROR')
  })

  it('enforces deterministic and AI semantic zero-tolerance gates', () => {
    expect(deterministicReviewGate([{ references: [{ classification: 'SAFE_MAPPING' }], omissions: [{ classification: 'SAFE_OMISSION' }] }]))
      .toMatchObject({ safeMappings: 1, safeOmissions: 1, falsePositiveMappings: 0, pending: 0 })
    expect(deterministicReviewGate([{ references: [{ classification: 'FALSE_POSITIVE' }], omissions: [] }]).falsePositiveMappings).toBe(1)
    expect(aiReviewGate([{ classification: 'CORRECT' }, { classification: 'AMBIGUOUS' }]))
      .toMatchObject({ correct: 1, ambiguous: 1, incorrect: 0 })
  })

  it('requires candidate validation and exact source-bound READY preconditions', () => {
    const hash = 'a'.repeat(64)
    const row = {
      classification: 'READY',
      sourceHash: hash,
      candidateMap: { sourceHash: hash },
      precondition: { currentMapAbsent: true, contentSourceHash: hash },
      semanticReview: { deterministicSafe: true, aiAmbiguous: 0, aiIncorrect: 0 },
      audit: { candidateValidation: { valid: true } },
      stability: { classification: 'EXACT_STABLE' },
    }
    expect(readyRecoveredManifestInvariant(row)).toBe(true)
    expect(readyRecoveredManifestInvariant({ ...row, audit: { candidateValidation: { valid: false } } })).toBe(false)
  })

  it('sorts manifest rows deterministically', () => {
    expect(sortRows([{ recipeId: 'z' }, { recipeId: 'a' }, { recipeId: 'm' }]).map(row => row.recipeId))
      .toEqual(['a', 'm', 'z'])
  })

  it('contains no Firestore mutation or apply mode', () => {
    const source = fs.readFileSync(new URL('../scripts/audit-recovered-recipe-mappings.mjs', import.meta.url), 'utf8')
    expect(source).not.toMatch(/\.collection\([^)]*\)\.(?:add|set|update|delete)\s*\(/)
    expect(source).not.toMatch(/\.batch\s*\(|\.runTransaction\s*\(/)
    expect(source).not.toMatch(/--apply\b/)
  })

  it('finalizes semantic evidence and manifest before hashing immutable bytes', () => {
    const source = fs.readFileSync(new URL('../scripts/audit-recovered-recipe-mappings.mjs', import.meta.url), 'utf8')
    const semantic = source.indexOf('const semantic = expandSemanticEvidence')
    const manifest = source.indexOf('const manifest = manifestRows')
    const live = source.indexOf('const live = await finalLiveRead')
    const write = source.indexOf('fs.writeFileSync(MANIFEST_PATH')
    const hash = source.indexOf('const manifestHash = sha256')
    expect(semantic).toBeGreaterThan(-1)
    expect(semantic).toBeLessThan(manifest)
    expect(manifest).toBeLessThan(live)
    expect(live).toBeLessThan(write)
    expect(write).toBeLessThan(hash)
  })
})
