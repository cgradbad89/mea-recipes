import {
  extractCandidateRiskFacts,
  routeRisk,
} from './analyze-cooking-mode-v10b-ingredient-precision-core.mjs'

export const REVIEW_ROUTING_BENCHMARK_SIZE = 861

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator
}

function summarizePolicy(candidates, autoAcceptIds) {
  const autoAccept = candidates.filter(candidate => autoAcceptIds.has(candidate.candidateId))
  const reviewRequired = candidates.filter(candidate => !autoAcceptIds.has(candidate.candidateId))
  const autoAcceptTp = autoAccept.filter(candidate => candidate.adjudicatedTruth === 'CORRECT').length
  const autoAcceptFp = autoAccept.length - autoAcceptTp
  const reviewCorrect = reviewRequired.filter(candidate => candidate.adjudicatedTruth === 'CORRECT').length
  const reviewIncorrect = reviewRequired.length - reviewCorrect
  const affectedRecipes = new Set(reviewRequired.map(candidate => candidate.recipeId)).size

  return {
    autoAccept: {
      count: autoAccept.length,
      truePositives: autoAcceptTp,
      falsePositives: autoAcceptFp,
      precision: ratio(autoAcceptTp, autoAccept.length),
    },
    reviewRequired: {
      count: reviewRequired.length,
      correctCandidates: reviewCorrect,
      incorrectCandidates: reviewIncorrect,
    },
    autoReject: {
      count: 0,
      correctCandidatesIncorrectlyRejected: 0,
      incorrectCandidatesCorrectlyRejected: 0,
    },
    automaticallyResolvedShare: ratio(autoAccept.length, candidates.length),
    reviewRequiredShare: ratio(reviewRequired.length, candidates.length),
    recipesRequiringReview: affectedRecipes,
    averageReviewItemsPerAffectedRecipe: ratio(reviewRequired.length, affectedRecipes),
  }
}

function voteBucketKey(candidate) {
  const a = candidate.origins.includes('REVIEWER_A')
  const b = candidate.origins.includes('REVIEWER_B')
  if (a && b) return 'BOTH_ACCEPT'
  if (a) return 'A_ONLY_ACCEPTS'
  if (b) return 'B_ONLY_ACCEPTS'
  return 'BOTH_REJECT'
}

function summarizePositiveVoteBucket(candidates, totalPossibleCells) {
  const correct = candidates.filter(candidate => candidate.adjudicatedTruth === 'CORRECT').length
  const incorrect = candidates.length - correct
  return {
    correct,
    incorrect,
    total: candidates.length,
    precision: ratio(correct, candidates.length),
    shareOfReviewerUnionCandidates: ratio(candidates.length, REVIEW_ROUTING_BENCHMARK_SIZE),
    shareOfPossibleCells: ratio(candidates.length, totalPossibleCells),
  }
}

function possibleCellCount(recipes) {
  return recipes.reduce((total, recipe) => {
    const ingredientRows = recipe.ingredients.filter(ingredient => !ingredient.header).length
    return total + ingredientRows * recipe.steps.length
  }, 0)
}

function buildV10gAcceptIds(ingredientCandidates, v10d, v10g) {
  const v10dFalseRejectIds = new Set(v10d.finalErrors.falseRejects.map(row => row.candidateId))
  const accepted = new Set(ingredientCandidates
    .filter(candidate => candidate.adjudicatedTruth === 'CORRECT' && !v10dFalseRejectIds.has(candidate.candidateId))
    .map(candidate => candidate.candidateId))
  for (const row of v10g.rescue.results) if (row.rescue === true) accepted.add(row.candidateId)
  return accepted
}

export function evaluateReviewRoutingContract({ frozen, benchmark, v10d, v10g }) {
  const ingredientCandidates = frozen.populations.INGREDIENT_RELATIONSHIPS
  const reviewerUnionCandidates = ingredientCandidates.filter(candidate => candidate.provenanceClass !== 'DETERMINISTIC_ONLY')
  if (reviewerUnionCandidates.length !== REVIEW_ROUTING_BENCHMARK_SIZE) {
    throw new Error(`Expected ${REVIEW_ROUTING_BENCHMARK_SIZE} reviewer-union candidates; received ${reviewerUnionCandidates.length}`)
  }

  const recipeIds = new Set(reviewerUnionCandidates.map(candidate => candidate.recipeId))
  const recipes = benchmark.recipes.filter(recipe => recipeIds.has(recipe.recipeId))
  if (recipes.length !== recipeIds.size) throw new Error('Frozen recipe population does not reconcile with completeness evidence')
  const recipeById = new Map(recipes.map(recipe => [recipe.recipeId, recipe]))
  const componentCandidates = frozen.populations.PREPARED_COMPONENT_RELATIONSHIPS

  const evidenceById = new Map(reviewerUnionCandidates.map(candidate => {
    const recipe = recipeById.get(candidate.recipeId)
    if (!recipe) throw new Error(`Missing recipe evidence for ${candidate.recipeId}`)
    const facts = extractCandidateRiskFacts(candidate, recipe, ingredientCandidates, componentCandidates)
    return [candidate.candidateId, { facts, routing: routeRisk(facts) }]
  }))

  const totalPossibleCells = possibleCellCount(recipes)
  const truthRelationships = recipes.reduce((total, recipe) => total + recipe.steps.reduce(
    (stepTotal, step) => stepTotal + step.adjudicatedExpectedIndexes.length,
    0,
  ), 0)
  const unionCorrect = reviewerUnionCandidates.filter(candidate => candidate.adjudicatedTruth === 'CORRECT').length
  const unionIncorrect = reviewerUnionCandidates.length - unionCorrect
  const neitherAcceptsCorrect = truthRelationships - unionCorrect
  const neitherAcceptsTotal = totalPossibleCells - reviewerUnionCandidates.length
  const neitherAcceptsIncorrect = neitherAcceptsTotal - neitherAcceptsCorrect

  const voteGroups = Object.groupBy(reviewerUnionCandidates, voteBucketKey)
  const reviewerAgreement = {
    possibleIngredientStepCells: totalPossibleCells,
    truthRelationships,
    bothAccept: summarizePositiveVoteBucket(voteGroups.BOTH_ACCEPT || [], totalPossibleCells),
    aOnlyAccepts: summarizePositiveVoteBucket(voteGroups.A_ONLY_ACCEPTS || [], totalPossibleCells),
    bOnlyAccepts: summarizePositiveVoteBucket(voteGroups.B_ONLY_ACCEPTS || [], totalPossibleCells),
    bothReject: {
      correctRelationshipsMissed: neitherAcceptsCorrect,
      incorrectRelationshipsCorrectlyOmitted: neitherAcceptsIncorrect,
      total: neitherAcceptsTotal,
      correctRejectionRate: ratio(neitherAcceptsIncorrect, neitherAcceptsTotal),
      shareOfReviewerUnionCandidates: null,
      shareOfPossibleCells: ratio(neitherAcceptsTotal, totalPossibleCells),
    },
  }

  const bothAcceptIds = new Set(reviewerUnionCandidates
    .filter(candidate => voteBucketKey(candidate) === 'BOTH_ACCEPT')
    .map(candidate => candidate.candidateId))
  const bothAcceptNoRiskIds = new Set(reviewerUnionCandidates
    .filter(candidate => voteBucketKey(candidate) === 'BOTH_ACCEPT' && evidenceById.get(candidate.candidateId).routing.route === 'LOW_RISK')
    .map(candidate => candidate.candidateId))
  const anyReviewerNoRiskIds = new Set(reviewerUnionCandidates
    .filter(candidate => evidenceById.get(candidate.candidateId).routing.route === 'LOW_RISK')
    .map(candidate => candidate.candidateId))
  const v10gAcceptIds = buildV10gAcceptIds(ingredientCandidates, v10d, v10g)

  const policies = {
    reviewerAgreementOnly: summarizePolicy(reviewerUnionCandidates, bothAcceptIds),
    reviewerAgreementAndNoV10bRisk: summarizePolicy(reviewerUnionCandidates, bothAcceptNoRiskIds),
    maximumSafeNoV10bRisk: summarizePolicy(reviewerUnionCandidates, anyReviewerNoRiskIds),
    v10gCombinedExperimentalFrontier: summarizePolicy(reviewerUnionCandidates, v10gAcceptIds),
  }

  const v10gAccepted = reviewerUnionCandidates.filter(candidate => v10gAcceptIds.has(candidate.candidateId))
  const v10gRejected = reviewerUnionCandidates.filter(candidate => !v10gAcceptIds.has(candidate.candidateId))
  const combination = rows => ({
    count: rows.length,
    correct: rows.filter(candidate => candidate.adjudicatedTruth === 'CORRECT').length,
    incorrect: rows.filter(candidate => candidate.adjudicatedTruth === 'INCORRECT').length,
    precision: ratio(rows.filter(candidate => candidate.adjudicatedTruth === 'CORRECT').length, rows.length),
  })

  return {
    benchmark: {
      recipes: recipes.length,
      deterministicAugmentedCandidates: ingredientCandidates.length,
      deterministicOnlyCandidates: ingredientCandidates.length - reviewerUnionCandidates.length,
      reviewerUnionCandidates: reviewerUnionCandidates.length,
      correctCandidates: unionCorrect,
      incorrectCandidates: unionIncorrect,
      possibleIngredientStepCells: totalPossibleCells,
      truthRelationships,
    },
    reviewerAgreement,
    riskRouting: {
      reviewRequiredByV10bRisk: reviewerUnionCandidates.filter(candidate => evidenceById.get(candidate.candidateId).routing.route !== 'LOW_RISK').length,
      correctCandidatesRouted: reviewerUnionCandidates.filter(candidate => candidate.adjudicatedTruth === 'CORRECT' && evidenceById.get(candidate.candidateId).routing.route !== 'LOW_RISK').length,
      incorrectCandidatesRouted: reviewerUnionCandidates.filter(candidate => candidate.adjudicatedTruth === 'INCORRECT' && evidenceById.get(candidate.candidateId).routing.route !== 'LOW_RISK').length,
    },
    policies,
    selectedPolicy: 'reviewerAgreementAndNoV10bRisk',
    v10gCombinations: {
      reviewerUnionCandidateAndV10gAccept: combination(v10gAccepted),
      reviewerDisagreementAndV10gAccept: combination(v10gAccepted.filter(candidate => voteBucketKey(candidate) !== 'BOTH_ACCEPT')),
      bothReviewersAcceptAndV10gAccept: combination(v10gAccepted.filter(candidate => voteBucketKey(candidate) === 'BOTH_ACCEPT')),
      bothReviewersAcceptAndV10gReject: combination(v10gRejected.filter(candidate => voteBucketKey(candidate) === 'BOTH_ACCEPT')),
      reviewerDisagreementAndV10gReject: combination(v10gRejected.filter(candidate => voteBucketKey(candidate) !== 'BOTH_ACCEPT')),
      deterministicRescueSignal: combination(reviewerUnionCandidates.filter(candidate =>
        v10g.rescue.results.some(row => row.candidateId === candidate.candidateId && row.rescue === true))),
    },
  }
}
