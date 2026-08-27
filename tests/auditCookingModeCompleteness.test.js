import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  assertMappedPopulation,
  assertNoCurrentMapInBlindPrompt,
  associationMath,
  BLIND_REVIEW_SYSTEM_PROMPT,
  buildRemediationCandidate,
  discrepancyCandidates,
  effectiveRecipeContent,
  EXPECTED_MAPPED_POPULATION,
  formatBlindRecipePrompt,
  gradeRecipe,
  metricsFromSteps,
  namedRegressionResults,
  runtimeEngineSegment,
  runtimeMapSource,
  sumMetrics,
  validateReviewOutput,
} from '../scripts/audit-cooking-mode-completeness-core.mjs'

const review = indexes => ({
  steps: [{
    instructionIndex: 0,
    expectedIngredientIndexes: indexes,
    preparedComponents: [],
    explicitActiveUseIndexes: indexes,
    ingredientAssessments: indexes.map(ingredientIndex => ({
      ingredientIndex, level: 'HIGH', kind: 'SUBSTANTIAL',
    })),
    confidence: 'HIGH',
    reasoningCategory: 'EXPLICIT_ACTIVE_USE',
  }],
})

const currentMap = indexes => ({
  steps: [{ instructionIndex: 0, ingredients: indexes.map(ingredientIndex => ({ ingredientIndex })) }],
})

describe('Cooking Mode completeness production baseline', () => {
  it('requires exactly the full 228 mapped-recipe population', () => {
    expect(EXPECTED_MAPPED_POPULATION).toBe(228)
    const documents = Array.from({ length: 228 }, (_, index) => ({
      id: String(index), data: { cookingStepIngredientMap: {} },
    }))
    expect(assertMappedPopulation(documents)).toHaveLength(228)
    expect(() => assertMappedPopulation(documents.slice(1))).toThrow(/227\/228/)
  })

  it('mirrors effective owner-content override handling', () => {
    expect(effectiveRecipeContent('shared', { overrides: { content: 'owner' } })).toBe('owner')
    expect(effectiveRecipeContent('shared', { overrides: { content: '' } })).toBe('shared')
    expect(effectiveRecipeContent('shared', null)).toBe('shared')
  })

  it('segments persisted and deterministic-v5 fallback runtime sources', () => {
    expect(runtimeMapSource('persisted')).toBe('persisted')
    expect(runtimeMapSource('deterministic-fallback')).toBe('deterministic-v5-fallback')
    expect(runtimeEngineSegment({ runtimeMapSource: 'persisted', persistedEngine: 'hybrid-v4' })).toBe('hybrid-v4')
    expect(runtimeEngineSegment({ runtimeMapSource: 'deterministic-v5-fallback', persistedEngine: 'hybrid-v4' }))
      .toBe('deterministic-v5-runtime-fallback')
  })
})

describe('blind completeness review contract', () => {
  it('provides full numbered context without exposing the current map', () => {
    const prompt = formatBlindRecipePrompt(
      'Example', ['For sauce:', '1 cup tomatoes'], ['Add tomatoes.'], raw => raw.endsWith(':'),
    )
    expect(prompt).toContain('[0] GROUP HEADER: For sauce:')
    expect(prompt).toContain('[1] 1 cup tomatoes')
    expect(prompt).toContain('[0] Add tomatoes.')
    expect(() => assertNoCurrentMapInBlindPrompt(prompt)).not.toThrow()
    expect(BLIND_REVIEW_SYSTEM_PROMPT).toContain('The current Cooking Mode mapping is intentionally absent')
  })

  it('rejects headers, out-of-range indexes, incomplete steps, and invalid explicit subsets', () => {
    const ingredients = ['For sauce:', '1 cup tomatoes']
    const instructions = ['Add tomatoes.']
    const isHeader = raw => raw.endsWith(':')
    expect(validateReviewOutput(review([1]), ingredients, instructions, isHeader)).toBe(true)
    expect(() => validateReviewOutput(review([0]), ingredients, instructions, isHeader)).toThrow(/header/)
    expect(() => validateReviewOutput(review([2]), ingredients, instructions, isHeader)).toThrow(/out of range/)
    const invalid = review([1])
    invalid.steps[0].explicitActiveUseIndexes = [0]
    expect(() => validateReviewOutput(invalid, ingredients, instructions, isHeader)).toThrow()
  })
})

describe('discrepancy and corpus metric math', () => {
  it('generates consensus, singleton, extra, and reviewer-disagreement evidence', () => {
    expect(discrepancyCandidates(currentMap([]), review([0]), review([0])))
      .toContainEqual(expect.objectContaining({ ingredientIndex: 0, classification: 'CURRENT_MISSING_CONSENSUS' }))
    expect(discrepancyCandidates(currentMap([]), review([0]), review([])))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ ingredientIndex: 0, classification: 'CURRENT_MISSING_SINGLETON' }),
        expect.objectContaining({ ingredientIndex: null, classification: 'REVIEWERS_DISAGREE' }),
      ]))
    expect(discrepancyCandidates(currentMap([0]), review([]), review([])))
      .toContainEqual(expect.objectContaining({ ingredientIndex: 0, classification: 'CURRENT_EXTRA_VS_BOTH' }))
  })

  it('calculates TP/FP/FN, precision, recall, and F1 from adjudicated truth', () => {
    const math = associationMath([0, 1], [1, 2])
    expect(math).toEqual({ truePositiveIndexes: [1], falsePositiveIndexes: [0], falseNegativeIndexes: [2] })
    const metrics = metricsFromSteps([math])
    expect(metrics).toEqual({ truePositives: 1, falsePositives: 1, falseNegatives: 1, precision: 0.5, recall: 0.5, f1: 0.5 })
    expect(sumMetrics([{ metrics }, { metrics }])).toEqual({
      truePositives: 2, falsePositives: 2, falseNegatives: 2, precision: 0.5, recall: 0.5, f1: 0.5,
    })
  })

  it('grades severity and unsafe mappings independently', () => {
    expect(gradeRecipe([{ falsePositiveIndexes: [], falseNegativeIndexes: [], severity: [] }])).toBe('COMPLETE')
    expect(gradeRecipe([{
      falsePositiveIndexes: [], falseNegativeIndexes: [1], severity: [{ ingredientIndex: 1, level: 'MEDIUM' }],
    }])).toBe('MINOR_OMISSIONS')
    expect(gradeRecipe([{
      falsePositiveIndexes: [], falseNegativeIndexes: [1], severity: [{ ingredientIndex: 1, level: 'CRITICAL' }],
    }])).toBe('MATERIAL_OMISSIONS')
    expect(gradeRecipe([{ falsePositiveIndexes: [0], falseNegativeIndexes: [], severity: [] }])).toBe('UNSAFE')
  })
})

describe('named regressions and remediation evidence', () => {
  it('detects the required missing potato, steak, mozzarella, herbs, and pepper cases', () => {
    const makeRecipe = (recipeId, ingredients, checks) => ({
      recipeId,
      ingredients: ingredients.map((raw, index) => ({ index, raw })),
      steps: checks.map(({ instructionIndex, expected }) => ({
        instructionIndex,
        currentIngredientIndexes: [],
        adjudicatedExpectedIndexes: expected,
        falseNegativeIndexes: expected,
      })),
    })
    const results = namedRegressionResults([
      makeRecipe('garlic-butter-herb-steak-bites-with-potatoes', ['potatoes', 'sirloin steaks'], [
        { instructionIndex: 0, expected: [0] }, { instructionIndex: 1, expected: [1] },
      ]),
      makeRecipe('caprese-salad', ['fresh mozzarella'], [{ instructionIndex: 0, expected: [0] }]),
      makeRecipe('grilled-zucchini-and-summer-squash', ['Italian herbs', 'black pepper'], [
        { instructionIndex: 1, expected: [0, 1] },
      ]),
    ])
    expect(results).toHaveLength(5)
    expect(results.every(item => item.missing === true)).toBe(true)
  })

  it('emits the review-only remediation candidate contract', () => {
    expect(buildRemediationCandidate({
      recipeId: 'recipe', instructionIndex: 1, ingredientIndex: 2,
      severity: 'CRITICAL', rootCause: 'ACTIVE_USE_DETECTION_MISS',
      reviewerAFound: true, reviewerBFound: true, currentAiEligible: false,
      recommendedFixLayer: 'AI_COMPLETENESS',
    })).toEqual({
      recipeId: 'recipe', instructionIndex: 1, ingredientIndex: 2,
      severity: 'CRITICAL', rootCause: 'ACTIVE_USE_DETECTION_MISS',
      reviewerAFound: true, reviewerBFound: true, currentAiEligible: false,
      recommendedFixLayer: 'AI_COMPLETENESS',
    })
  })
})

describe('audit CLI safety and exact runtime reproduction', () => {
  const source = fs.readFileSync(new URL('../scripts/audit-cooking-mode-completeness.mjs', import.meta.url), 'utf8')

  it('uses the production parser and resolver on effective content and persisted map', () => {
    expect(source).toContain('effectiveRecipeContent(data.content, meta)')
    expect(source).toContain('modules.recipeContent.parseRecipeContent(effectiveContent)')
    expect(source).toContain('modules.mapping.resolveCookingStepIngredientMap(parsed.ingredients, parsed.instructions, data.cookingStepIngredientMap)')
  })

  it('has no Firestore mutation API, apply mode, or production-map assignment path', () => {
    expect(source).not.toMatch(/\.set\s*\(|\.update\s*\(|\.delete\s*\(|batch\s*\(|--apply|apply=true/)
    expect(source).not.toMatch(/cookingStepIngredientMap\s*=/)
    expect(source).toContain(".collection('recipes').get()")
  })

  it('runs two blind passes with bounded concurrency three and no real AI in tests', () => {
    expect(source).toContain('const CONCURRENCY = 3')
    expect(source).toContain("await runBlindPass(rows, 'A', modules, state)")
    expect(source).toContain("await runBlindPass(rows, 'B', modules, state)")
    expect(source).toContain('temperature: 0')
  })
})

describe('final production completeness evidence', () => {
  const audit = JSON.parse(fs.readFileSync(new URL(
    '../docs/audits/cooking-mode-completeness-audit-2026-08-26.json', import.meta.url,
  ), 'utf8'))
  const remediation = JSON.parse(fs.readFileSync(new URL(
    '../docs/audits/cooking-mode-completeness-remediation-candidates-2026-08-26.json', import.meta.url,
  ), 'utf8'))

  it('contains sorted, source-bound evidence for all 228 mapped recipes', () => {
    expect(audit.recipes).toHaveLength(228)
    expect(audit.recipes.map(recipe => recipe.recipeId)).toEqual(
      [...audit.recipes.map(recipe => recipe.recipeId)].sort((a, b) => a.localeCompare(b)),
    )
    expect(audit.recipes.every(recipe => /^[a-f0-9]{64}$/.test(recipe.sourceHash))).toBe(true)
    expect(audit.coverage).toEqual({
      reviewA: 228, reviewB: 228, discrepanciesAdjudicated: 228, noDiscrepancyControls: 0,
    })
  })

  it('keeps remediation candidates review-only and exactly aligned to adjudicated FNs', () => {
    expect(remediation).toHaveLength(audit.summary.metrics.falseNegatives)
    const expected = audit.recipes.flatMap(recipe => recipe.steps.flatMap(step =>
      step.falseNegativeIndexes.map(ingredientIndex =>
        `${recipe.recipeId}|${step.instructionIndex}|${ingredientIndex}`))).sort()
    const actual = remediation.map(item =>
      `${item.recipeId}|${item.instructionIndex}|${item.ingredientIndex}`).sort()
    expect(actual).toEqual(expected)
  })
})
