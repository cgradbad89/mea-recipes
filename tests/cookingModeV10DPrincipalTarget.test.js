import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildActiveObjectTimeline,
  derivePrincipalContinuation,
  detectGenericSeasoningAction,
  eligibleGenericSeasoningRow,
  extractPrincipalTargets,
  extractV10CState,
  extractV10DState,
  isSeasoningRow,
  resolveCategoryAliases,
  routeV10DRisk,
  validateTruthBlind,
} from '../scripts/analyze-cooking-mode-v10d-principal-target-core.mjs'

const root = path.resolve(process.cwd())
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
const date = '2026-08-28'
const frozen = readJson(`docs/audits/cooking-mode-arbiter-v10a-frozen-candidates-${date}.json`)
const v10a = readJson(`docs/audits/cooking-mode-arbiter-v10a-analysis-${date}.json`)
const v10c = readJson(`docs/audits/cooking-mode-v10c-active-target-analysis-${date}.json`)
const benchmark = readJson('docs/audits/cooking-mode-completeness-audit-2026-08-26.json')
const ingredients = frozen.populations.INGREDIENT_RELATIONSHIPS
const components = frozen.populations.PREPARED_COMPONENT_RELATIONSHIPS
const recipes = new Map(benchmark.recipes.map(recipe => [recipe.recipeId, recipe]))

function candidateState(candidateId) {
  const candidate = ingredients.find(item => item.candidateId === candidateId)
  return extractV10DState(candidate, recipes.get(candidate.recipeId), ingredients, components)
}

describe('Cooking Mode V10D principal-target extraction (Phase 3)', () => {
  it('requires source evidence (title match or repeated active manipulation), not just "first ingredient"', () => {
    const recipe = {
      title: 'Crockpot Chicken Wild Rice Soup',
      ingredients: [
        { index: 0, raw: '3/4 cup uncooked wild rice, rinsed', group: null, header: false },
        { index: 1, raw: '2 cups mirepoix, chopped', group: null, header: false },
      ],
      steps: [
        { instruction: 'Load wild rice, chicken, mirepoix into slow cooker.' },
        { instruction: 'Cover and cook on low for 6 hours.' },
      ],
    }
    const targets = extractPrincipalTargets(recipe)
    expect(targets.some(item => item.ingredientIndex === 0)).toBe(true) // wild rice: title match
    expect(targets.find(item => item.ingredientIndex === 0).confidence).toBe('MEDIUM')
    // mirepoix: no title match and only one active mention -> not principal
    expect(targets.some(item => item.ingredientIndex === 1)).toBe(false)
  })

  it('assigns HIGH confidence only with both title match and repeated active manipulation', () => {
    const recipe = {
      title: 'Seared Steak Bites',
      ingredients: [{ index: 0, raw: '1 pound steak bites', group: null, header: false }],
      steps: [
        { instruction: 'Sear the steak bites in a hot pan.' },
        { instruction: 'Flip and continue cooking the steak until browned.' },
      ],
    }
    const targets = extractPrincipalTargets(recipe)
    expect(targets[0].confidence).toBe('HIGH')
    expect(targets[0].introducedAtInstructionIndex).toBe(0)
  })
})

describe('Cooking Mode V10D safe category aliases (Phase 4)', () => {
  it('derives conservative aliases toward core nouns', () => {
    expect(resolveCategoryAliases('2 boneless skinless chicken breasts')).toContain('chicken')
    expect(resolveCategoryAliases('1 pound steak bites')).toContain('steak')
    expect(resolveCategoryAliases('1 yellow summer squash, sliced')).toContain('squash')
    expect(resolveCategoryAliases('2 zucchini, sliced')).toContain('zucchini')
    expect(resolveCategoryAliases('2 potatoes, cubed')).toContain('potatoes')
  })

  it('blocks aliases that would collapse semantically distinct rows', () => {
    expect(resolveCategoryAliases('2 cups chicken broth')).not.toContain('chicken')
    expect(resolveCategoryAliases('1 tablespoon coconut oil')).not.toContain('coconut')
    expect(resolveCategoryAliases('1 cup coconut milk')).not.toContain('coconut')
    expect(resolveCategoryAliases('Chili Sauce')).not.toContain('chili')
  })
})

describe('Cooking Mode V10D generic seasoning contract (Phase 8-10)', () => {
  it('recognizes bare generic seasoning language only', () => {
    expect(detectGenericSeasoningAction('Taste and adjust seasoning and serve.')).toBe(true)
    expect(detectGenericSeasoningAction('Season to taste with salt and pepper.')).toBe(false)
    expect(detectGenericSeasoningAction('Add the sauce and simmer.')).toBe(false)
  })

  it('identifies conservative seasoning rows only', () => {
    expect(isSeasoningRow('1 teaspoon salt, more to taste')).toBe(true)
    expect(isSeasoningRow('Black pepper to taste')).toBe(true)
    expect(isSeasoningRow('1 teaspoon ground cumin')).toBe(false)
  })

  it('does not reactivate a seasoning row already established at an earlier instruction (ratatouille regression)', () => {
    const state = candidateState('ingredient::chickpea-and-fennel-ratatouille::2::7')
    expect(state.genericSeasoningAction).toBe(true)
    expect(state.rowEstablishedAtEarlierInstruction).toBe(true)
    expect(state.eligibleGenericSeasoningRow).toBe(false)
  })

  it('scopes generic seasoning to the current dish/component and excludes an unestablished, unscoped marinade/dressing row', () => {
    const recipe = {
      title: 'Grilled Chicken',
      ingredients: [{ index: 0, raw: '1 teaspoon salt', group: 'Marinade', header: false }],
      steps: [{ instruction: 'Whisk the oil and salt into a marinade.' }, { instruction: 'Taste and adjust seasoning of the finished salad.' }],
    }
    const candidate = { candidateId: 'c', recipeId: 'fixture-scope', ingredientIndex: 0, ingredientText: recipe.ingredients[0].raw, ingredientGroup: 'Marinade', instructionIndex: 1, instructionText: recipe.steps[1].instruction, origins: [] }
    const v10cState = extractV10CState(candidate, recipe, [candidate], [])
    expect(eligibleGenericSeasoningRow(candidate, v10cState.componentMembership.memberships, [candidate])).toBe(false)
  })
})

describe('Cooking Mode V10D principal-target continuation (Phase 5-6)', () => {
  it('continues an introduced principal ingredient through unnamed manipulation verbs', () => {
    const recipe = {
      title: 'Roast Potatoes',
      ingredients: [{ index: 0, raw: '2 pounds potatoes, cubed', group: null, header: false }],
      steps: [
        { instruction: 'Add potatoes to a sheet pan.' },
        { instruction: 'Roast 15 minutes.' },
        { instruction: 'Turn and roast another 10 minutes.' },
      ],
    }
    const base = { recipeId: 'fixture-continuation', ingredientIndex: 0, ingredientText: recipe.ingredients[0].raw, origins: [] }
    const candidates = recipe.steps.map((step, instructionIndex) => ({ ...base, candidateId: `c${instructionIndex}`, instructionIndex, instructionText: step.instruction }))
    const targets = extractPrincipalTargets(recipe)
    const v10cState = extractV10CState(candidates[2], recipe, candidates, [])
    const continuation = derivePrincipalContinuation(candidates[2], targets, v10cState.componentMembership.memberships, v10cState)
    expect(continuation.eligible).toBe(true)
  })

  it('breaks continuation when the instruction switches to a prepared component target', () => {
    const recipe = {
      title: 'Salad with Vinaigrette',
      ingredients: [
        { index: 0, raw: '2 tablespoons olive oil', group: 'Dressing', header: false },
        { index: 1, raw: '1 teaspoon salt', group: 'Dressing', header: false },
      ],
      steps: [
        { instruction: 'Make dressing from oil, vinegar, salt.' },
        { instruction: 'Set aside.' },
        { instruction: 'Arrange salad.' },
        { instruction: 'Add dressing.' },
      ],
    }
    const base = { recipeId: 'fixture-switch', ingredientIndex: 1, ingredientText: recipe.ingredients[1].raw, ingredientGroup: 'Dressing', origins: [] }
    const candidates = recipe.steps.map((step, instructionIndex) => ({ ...base, candidateId: `c${instructionIndex}`, instructionIndex, instructionText: step.instruction }))
    const state = extractV10DState(candidates[3], recipe, candidates, [])
    expect(state.principalContinuation.eligible).toBe(false)
    expect(state.currentObject).not.toBe('INGREDIENT')
  })
})

describe('Cooking Mode V10D active-object timeline (Phase 7)', () => {
  it('is truth-blind and marks a switch to a named component', () => {
    const recipe = {
      title: 'Salad with Vinaigrette',
      ingredients: [{ index: 0, raw: '2 tablespoons olive oil', group: 'Dressing', header: false }],
      steps: [{ instruction: 'Whisk the olive oil into a dressing.' }, { instruction: 'Add the dressing.' }],
    }
    const targets = extractPrincipalTargets(recipe)
    const timeline = buildActiveObjectTimeline(recipe, targets)
    expect(timeline).toHaveLength(2)
    expect(timeline[1].targetTransition).toBe('SWITCH_TO_COMPONENT')
    expect(JSON.stringify(timeline)).not.toMatch(/adjudicatedTruth/)
  })
})

describe('Cooking Mode V10D frozen reproduction and regression gates', () => {
  it('reproduces the exact V10C frozen result before any V10D change', () => {
    expect(v10c.finalMetrics.truePositives).toBe(669)
    expect(v10c.finalMetrics.falsePositives).toBe(2)
    expect(v10c.finalMetrics.falseNegatives).toBe(164)
    expect(v10c.targetProtection.rejected).toBe(18)
    expect(v10c.quantityRegressionSummary.repaired).toBe(9)
  })

  it('routes the identical risk population size as V10C among base-accepted candidates (Phase 14: only risk-routed candidates get AI arbitration)', () => {
    const v10aState = JSON.parse(fs.readFileSync(`/tmp/cooking-step-arbiter-v10a-${date}-state.json`, 'utf8'))
    const v10aDecisions = new Map(Object.entries(v10aState.ingredientResults))
    const baseIds = new Set(ingredients.filter(candidate => candidate.provenanceClass === '2_OF_2_REVIEWERS' || v10aDecisions.get(candidate.candidateId)?.decision === 'ACCEPT').map(item => item.candidateId))
    const routedV10D = ingredients.filter(candidate => {
      if (!baseIds.has(candidate.candidateId)) return false
      const state = extractV10CState(candidate, recipes.get(candidate.recipeId), ingredients, components)
      return routeV10DRisk(state).route === 'RISK_REVIEW_REQUIRED'
    })
    expect(routedV10D).toHaveLength(v10c.routedCandidateCount)
  })

  it('all 30 frozen incorrect candidates and all 20 V10A target false positives remain routed for review', () => {
    const routed = ingredients.map(candidate => {
      const state = extractV10CState(candidate, recipes.get(candidate.recipeId), ingredients, components)
      return { candidate, routing: routeV10DRisk(state) }
    })
    expect(routed.filter(item => item.candidate.adjudicatedTruth === 'INCORRECT' && item.routing.route === 'RISK_REVIEW_REQUIRED')).toHaveLength(30)
    const targetIds = new Set(v10a.experimentAErrors.incorrectAccepts.map(item => item.candidateId))
    expect(routed.filter(item => targetIds.has(item.candidate.candidateId) && item.routing.route === 'RISK_REVIEW_REQUIRED')).toHaveLength(20)
  })

  it('produces identical truth-blind V10D state when truth/evaluation fields are inaccessible', () => {
    const candidate = ingredients.find(item => item.candidateId === 'ingredient::157::4::0')
    const redacted = Object.fromEntries(Object.entries(candidate).filter(([key]) => !['adjudicatedTruth', 'v9Arbiter'].includes(key)))
    const recipe = recipes.get(candidate.recipeId)
    const cleanIngredients = ingredients.map(item => Object.fromEntries(Object.entries(item).filter(([key]) => !['adjudicatedTruth', 'v9Arbiter'].includes(key))))
    expect(extractV10DState(candidate, recipe, ingredients, components)).toEqual(extractV10DState(redacted, recipe, cleanIngredients, components))
    expect(() => validateTruthBlind(extractV10DState(candidate, recipe, ingredients, components))).not.toThrow()
    expect(() => validateTruthBlind({ adjudicatedTruth: 'CORRECT' })).toThrow(/forbidden field/)
  })

  it('keeps V10D tooling audit-only and free of production writes', () => {
    const sources = ['scripts/analyze-cooking-mode-v10d-principal-target-core.mjs', 'scripts/analyze-cooking-mode-v10d-principal-target.mjs', 'scripts/run-cooking-mode-v10d-principal-target.mjs']
      .map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n')
    expect(sources).not.toMatch(/firebase-admin|\.firestore\(|collection\(['"]recipes|writeBatch\(|setDoc\(|updateDoc\(|deleteDoc\(/)
  })
})
