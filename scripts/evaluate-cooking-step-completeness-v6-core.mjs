export const V6_QUALITY_GATES = Object.freeze({
  precision: 1,
  explicitActiveUseRecall: 0.98,
  criticalRecall: 1,
  highRecall: 0.99,
  seasoningRecall: 0.98,
})

export function normalizeIndexes(indexes) {
  return [...new Set((indexes || []).filter(Number.isInteger))].sort((a, b) => a - b)
}

export function normalizeLabels(labels) {
  return [...new Set((labels || []).map(value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase())
    .filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

export function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator
}

export function associationMath(actualIndexes, expectedIndexes) {
  const actual = new Set(normalizeIndexes(actualIndexes))
  const expected = new Set(normalizeIndexes(expectedIndexes))
  return {
    truePositiveIndexes: [...actual].filter(index => expected.has(index)).sort((a, b) => a - b),
    falsePositiveIndexes: [...actual].filter(index => !expected.has(index)).sort((a, b) => a - b),
    falseNegativeIndexes: [...expected].filter(index => !actual.has(index)).sort((a, b) => a - b),
  }
}

function recallForExpectedSubset(candidateIndexes, expectedSubset) {
  const actual = new Set(normalizeIndexes(candidateIndexes))
  const expected = normalizeIndexes(expectedSubset)
  const present = expected.filter(index => actual.has(index)).length
  return { expected: expected.length, present, missing: expected.length - present }
}

export function evaluateCandidateMap(candidateMap, benchmarkRecipe) {
  const candidateSteps = new Map((candidateMap?.steps || []).map(step => [step.instructionIndex, step]))
  const steps = benchmarkRecipe.steps.map(benchmarkStep => {
    const candidate = candidateSteps.get(benchmarkStep.instructionIndex) || { ingredients: [] }
    const candidateIndexes = normalizeIndexes(candidate.ingredients?.map(reference => reference.ingredientIndex))
    const association = associationMath(candidateIndexes, benchmarkStep.adjudicatedExpectedIndexes)
    const severity = benchmarkStep.severity || []
    const critical = severity.filter(item => item.level === 'CRITICAL').map(item => item.ingredientIndex)
    const high = severity.filter(item => item.level === 'HIGH').map(item => item.ingredientIndex)
    const seasoning = severity.filter(item => item.kind === 'SEASONING_HERB').map(item => item.ingredientIndex)
    const preparedActual = normalizeLabels((candidate.preparedComponents || []).map(item => item.label))
    const preparedExpected = normalizeLabels(benchmarkStep.expectedPreparedComponents || [])
    const preparedActualSet = new Set(preparedActual)
    const preparedExpectedSet = new Set(preparedExpected)
    return {
      instructionIndex: benchmarkStep.instructionIndex,
      candidateIndexes,
      expectedIndexes: normalizeIndexes(benchmarkStep.adjudicatedExpectedIndexes),
      ...association,
      explicitActiveUse: recallForExpectedSubset(candidateIndexes, benchmarkStep.explicitActiveUseIndexes),
      critical: recallForExpectedSubset(candidateIndexes, critical),
      high: recallForExpectedSubset(candidateIndexes, high),
      seasoning: recallForExpectedSubset(candidateIndexes, seasoning),
      preparedComponents: {
        expected: preparedExpected.length,
        present: preparedExpected.filter(label => preparedActualSet.has(label)).length,
        missing: preparedExpected.filter(label => !preparedActualSet.has(label)).length,
        falsePositives: preparedActual.filter(label => !preparedExpectedSet.has(label)),
      },
    }
  })
  return { recipeId: benchmarkRecipe.recipeId, title: benchmarkRecipe.title, steps }
}

function sumCategory(rows, key) {
  const expected = rows.reduce((sum, row) => sum + row[key].expected, 0)
  const present = rows.reduce((sum, row) => sum + row[key].present, 0)
  return { expected, present, missing: expected - present, recall: ratio(present, expected) }
}

export function summarizeCandidateEvaluations(recipes) {
  const steps = recipes.flatMap(recipe => recipe.steps)
  const truePositives = steps.reduce((sum, step) => sum + step.truePositiveIndexes.length, 0)
  const falsePositives = steps.reduce((sum, step) => sum + step.falsePositiveIndexes.length, 0)
  const falseNegatives = steps.reduce((sum, step) => sum + step.falseNegativeIndexes.length, 0)
  const precision = ratio(truePositives, truePositives + falsePositives)
  const recall = ratio(truePositives, truePositives + falseNegatives)
  const f1 = precision === null || recall === null || precision + recall === 0
    ? null : 2 * precision * recall / (precision + recall)
  return {
    recipeCount: recipes.length,
    truePositives,
    falsePositives,
    falseNegatives,
    precision,
    recall,
    f1,
    explicitActiveUse: sumCategory(steps, 'explicitActiveUse'),
    critical: sumCategory(steps, 'critical'),
    high: sumCategory(steps, 'high'),
    seasoning: sumCategory(steps, 'seasoning'),
    preparedComponents: sumCategory(steps, 'preparedComponents'),
  }
}

export function evaluateV6QualityGates(summary) {
  const checks = {
    precision: summary.precision === V6_QUALITY_GATES.precision,
    explicitActiveUseRecall: (summary.explicitActiveUse.recall ?? 0) >= V6_QUALITY_GATES.explicitActiveUseRecall,
    criticalRecall: summary.critical.recall === V6_QUALITY_GATES.criticalRecall,
    highRecall: (summary.high.recall ?? 0) >= V6_QUALITY_GATES.highRecall,
    seasoningRecall: (summary.seasoning.recall ?? 0) >= V6_QUALITY_GATES.seasoningRecall,
  }
  return { pass: Object.values(checks).every(Boolean), checks, thresholds: V6_QUALITY_GATES }
}
