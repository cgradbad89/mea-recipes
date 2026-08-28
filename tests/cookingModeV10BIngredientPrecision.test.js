import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  candidateMetrics,
  classifyRiskFamily,
  createRiskBatches,
  deterministicContradiction,
  extractCandidateRiskFacts,
  routeRisk,
  validateArbiterResults,
  validateRiskFacts,
  voteClass,
} from '../scripts/analyze-cooking-mode-v10b-ingredient-precision-core.mjs'

const root = path.resolve(process.cwd())
const date = '2026-08-28'
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
const frozen = readJson(`docs/audits/cooking-mode-arbiter-v10a-frozen-candidates-${date}.json`)
const v10a = readJson(`docs/audits/cooking-mode-arbiter-v10a-analysis-${date}.json`)
const benchmark = readJson('docs/audits/cooking-mode-completeness-audit-2026-08-26.json')
const historical = readJson(`docs/audits/cooking-mode-consensus-v9-regression-input-${date}.json`)
const ingredients = frozen.populations.INGREDIENT_RELATIONSHIPS
const components = frozen.populations.PREPARED_COMPONENT_RELATIONSHIPS
const recipes = new Map(benchmark.recipes.map(recipe => [recipe.recipeId, recipe]))

function experimentAAccepts(candidate) {
  const incorrectAccepts = new Set(v10a.experimentAErrors.incorrectAccepts.map(item => item.candidateId))
  const correctRejects = new Set(v10a.experimentAErrors.correctRejects.map(item => item.candidateId))
  return candidate.adjudicatedTruth === 'CORRECT'
    ? !correctRejects.has(candidate.candidateId)
    : incorrectAccepts.has(candidate.candidateId)
}

function factsFor(candidate) {
  return extractCandidateRiskFacts(candidate, recipes.get(candidate.recipeId), ingredients, components)
}

describe('Cooking Mode V10B frozen ingredient precision audit', () => {
  it('uses the exact frozen population and reconstructs the V10A 831/20/2 strategy', () => {
    expect(ingredients).toHaveLength(863)
    expect(ingredients.filter(item => item.adjudicatedTruth === 'CORRECT')).toHaveLength(833)
    expect(ingredients.filter(item => item.adjudicatedTruth === 'INCORRECT')).toHaveLength(30)

    const accepted = new Set(ingredients.filter(candidate =>
      voteClass(candidate.origins) === '2_OF_2' || experimentAAccepts(candidate)).map(item => item.candidateId))
    expect(candidateMetrics(ingredients, accepted)).toMatchObject({
      truePositives: 831,
      falsePositives: 20,
      falseNegatives: 2,
    })
  })

  it('reconstructs all 20 false positives, their vote provenance, and root-cause taxonomy', () => {
    const errors = v10a.experimentAErrors.incorrectAccepts
    expect(errors).toHaveLength(20)
    const candidates = errors.map(error => ingredients.find(item => item.candidateId === error.candidateId))
    expect(candidates.every(Boolean)).toBe(true)
    expect(Object.fromEntries([...new Set(candidates.map(item => voteClass(item.origins)))].map(key =>
      [key, candidates.filter(item => voteClass(item.origins) === key).length]))).toEqual({
      '2_OF_2': 9,
      '1_OF_2': 10,
      DETERMINISTIC_ONLY: 1,
    })
    expect(Object.fromEntries([...new Set(errors.map(item => item.classification))].map(key =>
      [key, errors.filter(item => item.classification === key).length]))).toEqual({
      COMPONENT_LEAKAGE: 11,
      CONSUMED_ROW: 4,
      CONTEXTUAL_MENTION: 4,
      PROCESS_MATERIAL: 1,
    })
  })

  it('extracts chronological lifecycle facts without treating prior use as a conclusion', () => {
    const recipe = {
      ingredients: [{ raw: '2 tablespoons olive oil', group: 'Dressing' }],
      steps: [
        { instruction: 'Whisk the olive oil into the dressing.' },
        { instruction: 'Chill the dressing.' },
      ],
    }
    const current = {
      candidateId: 'candidate', recipeId: 'recipe', ingredientIndex: 0, instructionIndex: 1,
      ingredientText: recipe.ingredients[0].raw, ingredientGroup: 'Dressing', instructionText: recipe.steps[1].instruction,
    }
    const prior = { ...current, candidateId: 'prior', instructionIndex: 0, instructionText: recipe.steps[0].instruction, origins: ['REVIEWER_A', 'REVIEWER_B'] }
    const facts = extractCandidateRiskFacts(current, recipe, [prior, current], [])
    expect(facts.priorInstructionMentions).toEqual([0])
    expect(facts.priorReviewerUses).toEqual([{ instructionIndex: 0, reviewerCount: 2 }])
    expect(facts.quantityEvidence.listedQuantity).toBe('2 tablespoons')
    expect(facts.lifecycleRisk).toBe(true)
    expect(facts).not.toHaveProperty('isCorrect')
    expect(facts).not.toHaveProperty('shouldReject')
  })

  it('extracts component-containment state without inventing a component label', () => {
    const recipe = {
      ingredients: [
        { raw: '2 tablespoons olive oil', group: 'Dressing' },
        { raw: '1 tablespoon vinegar', group: 'Dressing' },
      ],
      steps: [
        { instruction: 'Whisk the olive oil and vinegar into a dressing.' },
        { instruction: 'Add the dressing to the greens.' },
      ],
    }
    const current = {
      candidateId: 'current', recipeId: 'recipe', ingredientIndex: 0, instructionIndex: 1,
      ingredientText: recipe.ingredients[0].raw, ingredientGroup: 'Dressing', instructionText: recipe.steps[1].instruction,
    }
    const prior = { ...current, candidateId: 'prior', instructionIndex: 0, instructionText: recipe.steps[0].instruction, origins: ['REVIEWER_A'] }
    const component = { recipeId: 'recipe', instructionIndex: 1, proposedCanonicalLabel: 'dressing' }
    const facts = extractCandidateRiskFacts(current, recipe, [prior, current], [component])
    expect(facts.componentContext).toMatchObject({
      possibleConstituent: true,
      componentLabels: ['dressing'],
      establishedInstructionIndex: 0,
      currentInstructionRefersToComponent: true,
    })
    expect(routeRisk(facts)).toMatchObject({ route: 'RISK_REVIEW_REQUIRED' })
  })

  it('routes every frozen incorrect candidate using only source-derived facts', () => {
    const routed = ingredients.map(candidate => ({ candidate, routing: routeRisk(factsFor(candidate)) }))
    expect(routed.filter(item => item.routing.route === 'RISK_REVIEW_REQUIRED')).toHaveLength(477)
    expect(routed.filter(item => item.candidate.adjudicatedTruth === 'INCORRECT' &&
      item.routing.route === 'RISK_REVIEW_REQUIRED')).toHaveLength(30)
    expect(routed.filter(item => item.candidate.adjudicatedTruth === 'CORRECT' &&
      item.routing.route === 'RISK_REVIEW_REQUIRED')).toHaveLength(447)
  })

  it('does not leak adjudicated truth into facts, routing, or model input', () => {
    const candidate = ingredients[0]
    const redacted = Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== 'adjudicatedTruth'))
    expect(factsFor(candidate)).toEqual(factsFor(redacted))
    expect(() => validateRiskFacts({ candidateId: 'safe', riskFacts: factsFor(candidate) })).not.toThrow()
    expect(() => validateRiskFacts({ candidateId: 'unsafe', adjudicatedTruth: 'CORRECT' })).toThrow(/forbidden field/)
  })

  it('reproduces the deterministic risk-rejection baseline', () => {
    const baseAccepted = new Set(ingredients.filter(candidate =>
      voteClass(candidate.origins) === '2_OF_2' || experimentAAccepts(candidate)).map(item => item.candidateId))
    const contradictions = new Set(ingredients.filter(candidate => deterministicContradiction(factsFor(candidate))).map(item => item.candidateId))
    const accepted = new Set([...baseAccepted].filter(id => !contradictions.has(id)))
    expect(candidateMetrics(ingredients, accepted)).toMatchObject({
      truePositives: 829,
      falsePositives: 19,
      falseNegatives: 4,
    })
  })

  it('covers all required generic historical false-positive families without recipe IDs', () => {
    expect(historical.ingredientFalsePositives).toHaveLength(82)
    const baseFacts = {
      processMaterialRisk: false, quantityConflictRisk: false, groupConflictRisk: false,
      duplicateRowRisk: false, contextualMentionRisk: false, lifecycleRisk: false,
      componentContext: { possibleConstituent: false },
    }
    const fixtures = [
      ['COMPONENT_LEAKAGE', 'Add the dressing.', { componentContext: { possibleConstituent: true } }],
      ['CONSUMED_ROW', 'Continue cooking.', { lifecycleRisk: true }],
      ['CONTEXTUAL_MENTION', 'Serve with sauce.', { contextualMentionRisk: true }],
      ['FRESH_PROCESS_MATERIAL', 'Thread onto fresh skewers.', { processMaterialRisk: true }],
      ['WRONG_DUPLICATE', 'Add the second portion.', { duplicateRowRisk: true }],
      ['WRONG_GROUP', 'Use the topping.', { groupConflictRisk: true }],
      ['QUANTITY_CONFLICT', 'Add 1 cup.', { quantityConflictRisk: true }],
      ['FINISHED_DISH_COLLISION', 'Assemble the sandwich.', { contextualMentionRisk: true }],
    ]
    for (const [expected, instructionText, patch] of fixtures) {
      expect(classifyRiskFamily({ instructionText }, { ...baseFacts, ...patch })).toBe(expected)
    }
  })

  it('micro-batches by recipe and validates exactly one result per candidate', () => {
    const sample = [
      { candidateId: 'a', recipeId: 'one' }, { candidateId: 'b', recipeId: 'one' },
      { candidateId: 'c', recipeId: 'two' },
    ]
    expect(createRiskBatches(sample, 2)).toEqual([
      { batchId: 'one::000', recipeId: 'one', candidateIds: ['a', 'b'] },
      { batchId: 'two::000', recipeId: 'two', candidateIds: ['c'] },
    ])
    const valid = { results: ['a', 'b'].map(candidateId => ({ candidateId, decision: 'REJECT' })) }
    expect(validateArbiterResults(['a', 'b'], valid)).toHaveLength(2)
    expect(() => validateArbiterResults(['a', 'b'], { results: [valid.results[0]] })).toThrow(/count mismatch/)
    expect(() => validateArbiterResults(['a', 'b'], { results: [valid.results[0], valid.results[0]] })).toThrow(/duplicate/)
  })

  it('keeps V10B tooling read-only with respect to production data', () => {
    const sources = [
      'scripts/analyze-cooking-mode-v10b-ingredient-precision-core.mjs',
      'scripts/analyze-cooking-mode-v10b-ingredient-precision.mjs',
      'scripts/run-cooking-mode-v10b-ingredient-precision.mjs',
    ].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n')
    expect(sources).not.toMatch(/firebase-admin|\.firestore\(|collection\(['"]recipes|writeBatch\(|setDoc\(|updateDoc\(|deleteDoc\(/)
  })
})
