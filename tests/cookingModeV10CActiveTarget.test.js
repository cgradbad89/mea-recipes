import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  extractComponentMembership,
  extractQuantityMentions,
  extractV10CState,
  listedQuantity,
  routeV10CRisk,
  rowLocalInstructionQuantity,
  validateTruthBlind,
} from '../scripts/analyze-cooking-mode-v10c-active-target-core.mjs'

const root = path.resolve(process.cwd())
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
const date = '2026-08-28'
const frozen = readJson(`docs/audits/cooking-mode-arbiter-v10a-frozen-candidates-${date}.json`)
const v10a = readJson(`docs/audits/cooking-mode-arbiter-v10a-analysis-${date}.json`)
const v10b = readJson(`docs/audits/cooking-mode-v10b-ingredient-precision-analysis-${date}.json`)
const benchmark = readJson('docs/audits/cooking-mode-completeness-audit-2026-08-26.json')
const ingredients = frozen.populations.INGREDIENT_RELATIONSHIPS
const components = frozen.populations.PREPARED_COMPONENT_RELATIONSHIPS
const recipes = new Map(benchmark.recipes.map(recipe => [recipe.recipeId, recipe]))

function candidateState(candidateId) {
  const candidate = ingredients.find(item => item.candidateId === candidateId)
  return extractV10CState(candidate, recipes.get(candidate.recipeId), ingredients, components)
}

describe('Cooking Mode V10C row-local quantity and active-target state', () => {
  it('preserves decimals, ASCII fractions, Unicode fractions, mixed numbers, and ranges', () => {
    expect(extractQuantityMentions('1.5 lbs pork; 3/4 tsp salt; ½ cup oil; 1 1/2 cups milk; 2-3 pounds chicken; 2½ cups water').map(item => item.text)).toEqual([
      '1.5 lbs', '3/4 tsp', '½ cup', '1 1/2 cups', '2-3 pounds', '2½ cups',
    ])
  })

  it('never borrows a quantity from a sibling row in the same instruction', () => {
    const instruction = 'Heat the olive oil. Add minced garlic and 2 teaspoons salt.'
    expect(rowLocalInstructionQuantity(instruction, '1 tablespoon olive oil')).toBeUndefined()
    expect(rowLocalInstructionQuantity(instruction, '2 teaspoons salt')).toBe('2 teaspoons')
    expect(rowLocalInstructionQuantity('Mix sour cream, chipotle, and salt. Use powdered chipotle, about 1/2 teaspoon.', '½ cup sour cream')).toBeUndefined()
  })

  it('repairs all nine V10B quantity-defect candidates with exact row-local facts', () => {
    const expected = {
      'ingredient::157::3::0': ['1.5 lbs', undefined],
      'ingredient::171::0::7': ['3/4 tsp', undefined],
      'ingredient::171::0::9': ['1/2 tsp', undefined],
      'ingredient::171::1::13': ['1/2 cup', undefined],
      'ingredient::crunchy-queso-wrap::2::14': ['¾ cup', '3 tablespoons'],
      'ingredient::crunchy-queso-wrap::2::16': ['¾ cup', '3 tablespoons'],
      'ingredient::grilled-fish-tacos::1::1': ['½ cup', undefined],
      'ingredient::grilled-fish-tacos::1::2': ['1 teaspoon', undefined],
      'ingredient::jocn-chicken-and-tomatillo-stew::3::8': ['1 tablespoon', undefined],
    }
    const defectIds = v10b.stateAwareErrors.falseRejects.filter(item => item.decision?.basis === 'QUANTITY_CONFLICT').map(item => item.candidateId)
    expect(defectIds).toHaveLength(9)
    for (const candidateId of defectIds) {
      const state = candidateState(candidateId)
      expect([state.quantityState.listedQuantity, state.quantityState.currentUseQuantity], candidateId).toEqual(expected[candidateId])
    }
  })

  it('derives the required row-local quantity-state contract', () => {
    const state = candidateState('ingredient::crunchy-queso-wrap::2::14').quantityState
    expect(state).toEqual({ listedQuantity: '¾ cup', priorUses: [], currentUseQuantity: '3 tablespoons', rowAvailability: 'AVAILABLE' })
    expect(listedQuantity('1 1/2 cups ketchup')).toBe('1 1/2 cups')
  })

  it('distinguishes direct ingredient targets from passive component constituents', () => {
    const recipe = {
      ingredients: [
        { index: 0, raw: '2 tablespoons olive oil', group: 'Dressing', header: false },
        { index: 1, raw: '1 tablespoon vinegar', group: 'Dressing', header: false },
        { index: 2, raw: '1 teaspoon salt', group: 'Dressing', header: false },
      ],
      steps: [
        { instruction: 'Whisk the olive oil, vinegar, and salt into a dressing.' },
        { instruction: 'Add the dressing.' },
        { instruction: 'Add the dressing and remaining salt.' },
      ],
    }
    const base = { recipeId: 'fixture', ingredientIndex: 2, ingredientText: recipe.ingredients[2].raw, ingredientGroup: 'Dressing', origins: [] }
    const candidates = [0, 1, 2].map(instructionIndex => ({ ...base, candidateId: `c${instructionIndex}`, instructionIndex, instructionText: recipe.steps[instructionIndex].instruction }))
    const passive = extractV10CState(candidates[1], recipe, candidates, [])
    const both = extractV10CState(candidates[2], recipe, candidates, [])
    expect(passive.currentTarget).toBe('COMPONENT')
    expect(passive.continuingUse).toBe('PASSIVE_COMPONENT_CARRY')
    expect(both.currentTarget).toBe('BOTH')
    expect(both.continuingUse).toBe('RESERVED_REMAINDER')
  })

  it('derives conservative component membership from explicit group and source construction', () => {
    const recipe = {
      ingredients: [
        { index: 0, raw: '2 tablespoons olive oil', group: 'Dressing', header: false },
        { index: 1, raw: '1 tablespoon vinegar', group: 'Dressing', header: false },
      ],
      steps: [{ instruction: 'Whisk the olive oil and vinegar into a dressing.' }, { instruction: 'Add the dressing.' }],
    }
    const candidate = { candidateId: 'c', recipeId: 'fixture', ingredientIndex: 0, ingredientText: recipe.ingredients[0].raw, ingredientGroup: 'Dressing', instructionIndex: 1, instructionText: recipe.steps[1].instruction, origins: [] }
    const memberships = extractComponentMembership(candidate, recipe, [], [])
    expect(memberships.some(item => item.componentKey === 'dressing' && item.sourceIngredientIndexes.includes(0))).toBe(true)
  })

  it('distinguishes continuing manipulation, divided use, reserved remainder, and passive carry', () => {
    const recipe = {
      ingredients: [{ index: 0, raw: '1 cup parsley', group: null, header: false }],
      steps: [{ instruction: 'Use half the parsley.' }, { instruction: 'Add the remaining parsley.' }, { instruction: 'Continue chopping the parsley.' }],
    }
    const base = { recipeId: 'fixture', ingredientIndex: 0, ingredientText: recipe.ingredients[0].raw, origins: [] }
    const candidates = recipe.steps.map((step, instructionIndex) => ({ ...base, candidateId: `c${instructionIndex}`, instructionIndex, instructionText: step.instruction }))
    expect(extractV10CState(candidates[1], recipe, candidates, []).continuingUse).toBe('DIVIDED_USE')
    expect(extractV10CState(candidates[2], recipe, candidates, []).continuingUse).toBe('CONTINUING_MANIPULATION')
  })

  it('routes all 30 frozen incorrect candidates and all 20 V10A target false positives', () => {
    const routed = ingredients.map(candidate => {
      const state = extractV10CState(candidate, recipes.get(candidate.recipeId), ingredients, components)
      return { candidate, routing: routeV10CRisk(state) }
    })
    expect(routed.filter(item => item.candidate.adjudicatedTruth === 'INCORRECT' && item.routing.route === 'RISK_REVIEW_REQUIRED')).toHaveLength(30)
    const targetIds = new Set(v10a.experimentAErrors.incorrectAccepts.map(item => item.candidateId))
    expect(routed.filter(item => targetIds.has(item.candidate.candidateId) && item.routing.route === 'RISK_REVIEW_REQUIRED')).toHaveLength(20)
  })

  it('produces identical state when all truth and evaluation fields are inaccessible', () => {
    const candidate = ingredients.find(item => item.candidateId === 'ingredient::157::4::0')
    const redacted = Object.fromEntries(Object.entries(candidate).filter(([key]) => !['adjudicatedTruth', 'v9Arbiter'].includes(key)))
    const recipe = recipes.get(candidate.recipeId)
    expect(extractV10CState(candidate, recipe, ingredients, components)).toEqual(extractV10CState(redacted, recipe, ingredients.map(item => Object.fromEntries(Object.entries(item).filter(([key]) => !['adjudicatedTruth', 'v9Arbiter'].includes(key)))), components.map(item => Object.fromEntries(Object.entries(item).filter(([key]) => !['adjudicatedTruth', 'v9Arbiter'].includes(key))))))
    expect(() => validateTruthBlind(extractV10CState(candidate, recipe, ingredients, components))).not.toThrow()
    expect(() => validateTruthBlind({ adjudicatedTruth: 'CORRECT' })).toThrow(/forbidden field/)
  })

  it('keeps V10C tooling audit-only and free of production writes', () => {
    const sources = ['scripts/analyze-cooking-mode-v10c-active-target-core.mjs'].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n')
    expect(sources).not.toMatch(/firebase-admin|\.firestore\(|collection\(['"]recipes|writeBatch\(|setDoc\(|updateDoc\(|deleteDoc\(/)
  })
})
