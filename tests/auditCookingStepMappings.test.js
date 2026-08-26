import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import {
  auditPrecondition,
  callWithOneTransientRetry,
  classifyRecipeSource,
  compareStability,
  isAuditAiEligible,
  mapConcurrent,
  parserDefectEvidence,
} from '../scripts/audit-cooking-step-mappings-core.mjs'

const limits = { maxContentLength: 64_000, maxIngredients: 200, maxInstructions: 150, maxLineLength: 4_000 }

describe('cooking-step audit source eligibility', () => {
  it('excludes missing parsed sections before AI eligibility', () => {
    expect(classifyRecipeSource({ content: 'x' }, { ingredients: [], instructions: ['Cook it.'] }, limits).status)
      .toBe('EXCLUDE_NO_INGREDIENTS')
    expect(classifyRecipeSource({ content: 'x' }, { ingredients: ['salt'], instructions: [] }, limits).status)
      .toBe('EXCLUDE_NO_INSTRUCTIONS')
  })

  it('recognizes only evidence-backed parser contamination', () => {
    expect(parserDefectEvidence(['https://example.com/recipe'])).toHaveLength(1)
    expect(parserDefectEvidence(['Storage: keep for five days.'])).toHaveLength(1)
    expect(parserDefectEvidence(['Refrigerate the dough for one hour.'])).toEqual([])
    expect(parserDefectEvidence(['Have you cooked this? Mark as Cooked'])).toHaveLength(1)
    expect(parserDefectEvidence(['Jane2 years ago'])).toHaveLength(1)
  })

  it('excludes exact PRD-known source defects', () => {
    const result = classifyRecipeSource(
      { content: 'valid', recipeId: 'mole-poblano' },
      { ingredients: ['chicken'], instructions: ['Cook the chicken.'] },
      limits,
    )
    expect(result.status).toBe('EXCLUDE_PARSER_DEFECT')
  })

  it('records production parse-limit failures deterministically', () => {
    const first = classifyRecipeSource({ content: 'x'.repeat(64_001) }, { ingredients: [], instructions: [] }, limits)
    const second = classifyRecipeSource({ content: 'x'.repeat(64_001) }, { ingredients: [], instructions: [] }, limits)
    expect(first).toEqual(second)
    expect(first.status).toBe('EXCLUDE_INVALID_CONTENT')
  })
})

describe('cooking-step audit AI controls', () => {
  it('never selects excluded or existing-map rows for AI', () => {
    const base = { sourceStatus: 'ELIGIBLE', currentMapPresent: false, deterministicStats: { aiEligibleSteps: 1 } }
    expect(isAuditAiEligible(base)).toBe(true)
    expect(isAuditAiEligible({ ...base, sourceStatus: 'EXCLUDE_PARSER_DEFECT' })).toBe(false)
    expect(isAuditAiEligible({ ...base, currentMapPresent: true })).toBe(false)
  })

  it('records source-hash and existing-map preconditions exactly', () => {
    expect(auditPrecondition({ currentMapPresent: false, sourceHash: 'a'.repeat(64) })).toEqual({
      currentMapAbsent: true,
      contentSourceHash: 'a'.repeat(64),
    })
    expect(auditPrecondition({ currentMapPresent: true, sourceHash: null }).currentMapAbsent).toBe(false)
  })

  it('contains no Firestore write method in the CLI execution path', () => {
    const source = fs.readFileSync(new URL('../scripts/audit-cooking-step-mappings.mjs', import.meta.url), 'utf8')
    expect(source).not.toMatch(/\.(?:set|update|delete|create|add|batch|runTransaction)\s*\(/)
  })

  it('does not retry a successful request', async () => {
    const call = vi.fn().mockResolvedValue({ steps: [] })
    await expect(callWithOneTransientRetry(call)).resolves.toMatchObject({ status: 'completed', attempts: 1 })
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('permits only one retry for a transient provider failure', async () => {
    const call = vi.fn().mockRejectedValue(Object.assign(new Error('gateway timeout'), { status: 503 }))
    await expect(callWithOneTransientRetry(call)).resolves.toMatchObject({ status: 'failed', attempts: 2 })
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('does not retry a non-transient validation failure', async () => {
    const call = vi.fn().mockRejectedValue(new Error('schema validation failed'))
    await expect(callWithOneTransientRetry(call)).resolves.toMatchObject({ status: 'failed', attempts: 1 })
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('bounds concurrent work', async () => {
    let active = 0
    let peak = 0
    await mapConcurrent([1, 2, 3, 4, 5], 3, async value => {
      active += 1; peak = Math.max(peak, active)
      await Promise.resolve()
      active -= 1
      return value
    })
    expect(peak).toBeLessThanOrEqual(3)
  })
})

describe('semantic stability comparison', () => {
  const base = {
    schemaVersion: 1, parserVersion: 'recipe-content-v1', engineVersion: 'hybrid-v1', sourceHash: 'a'.repeat(64),
    steps: [{ instructionIndex: 0, ingredients: [{ ingredientIndex: 1, confidence: 'high', provenance: 'ai' }] }],
  }
  it('distinguishes exact and material semantic output', () => {
    expect(compareStability(base, structuredClone(base))).toBe('EXACT_STABLE')
    const changed = structuredClone(base)
    changed.steps[0].ingredients[0].ingredientIndex = 2
    expect(compareStability(base, changed)).toBe('MATERIAL_DIFFERENCE')
  })
})
