import { createHash } from 'node:crypto'

export const ROOT_CAUSES = [
  'PERSISTED_MAP_FALSE_NEGATIVE',
  'PERSISTED_MAP_FALSE_POSITIVE',
  'DETERMINISTIC_FALLBACK_FALSE_NEGATIVE',
  'DETERMINISTIC_FALLBACK_FALSE_POSITIVE',
  'DETERMINISTIC_CLASSIFIED_STEP_RESOLVED_TOO_EARLY',
  'AI_NEVER_ELIGIBLE',
  'RUNTIME_PERSISTED_MAP_REJECTED',
  'SOURCE_HASH_OR_OVERRIDE_FALLBACK',
  'UI_RENDERING_OR_INDEX_BUG',
  'PARSER_SOURCE_DEFECT',
  'INGREDIENT_IDENTITY_NORMALIZATION',
  'ROW_LIFECYCLE_OVERRESTRICTION',
  'GROUP_SCOPE_OVERRESTRICTION',
  'PREPARED_COMPONENT_OVERRESTRICTION',
  'ACTIVE_USE_DETECTION_MISS',
  'SEASONING_RECALL_MISS',
  'OTHER',
]

export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
export const GRADES = ['COMPLETE', 'MINOR_OMISSIONS', 'MATERIAL_OMISSIONS', 'UNSAFE', 'AMBIGUOUS_SOURCE']
export const RECOMMENDED_FIX_LAYERS = [
  'DETERMINISTIC',
  'AI_COMPLETENESS',
  'VALIDATOR',
  'PERSISTED_MAP_REGENERATION',
  'UI',
  'SOURCE_DATA',
  'REQUIRES_INVESTIGATION',
]
export const EXPECTED_MAPPED_POPULATION = 228

export const BLIND_REVIEW_SYSTEM_PROMPT = `You are an independent Cooking Mode completeness reviewer. This is a completeness audit, not the production mapper. Independently determine which listed ingredient rows a competent cook actively needs or uses at every numbered instruction step.

An ingredient belongs to a step when the cook actively introduces, uses, manipulates, seasons with, combines with, applies, adds, cooks, tosses, tops, garnishes, or otherwise needs that listed ingredient for the action described by that step. Do not omit an ingredient merely because deterministic matching might consider the relationship difficult.

Completeness must not reduce correctness. Do not map contextual mentions, consumed unrelated rows, guessed ingredients, or a prior row merely because it has not appeared yet. Do not invent ingredients, rewrite instructions, or return indexes outside the provided source. Rows explicitly marked GROUP HEADER are semantic context only and must never be returned as ingredient references. Do not infer unlisted cooking water, oil, or salt as a listed row.

Positive examples:
- "Add the potatoes" -> potatoes.
- "Cook the steak" -> steak.
- "Layer tomato and mozzarella" -> tomato and mozzarella.
- "Season zucchini with Italian herbs and pepper" -> zucchini, Italian herbs, and pepper.

Negative examples:
- "prepare sauce for the chicken" -> chicken is contextual unless chicken itself is acted upon.
- "boil eggs in water" -> do not map a previously listed soup water unless the recipe explicitly establishes reuse.

For each instruction, return all expected ingredient indexes, any prepared component label actively used at that step, and the high-confidence subset explicitly named or clearly aliased and directly acted upon. Assess every expected ingredient as CRITICAL main/structural, HIGH substantial, MEDIUM seasoning/herb/aromatic, or LOW optional garnish/low-impact; also tag its kind. Confidence HIGH means the source proves the relationship; UNCERTAIN means reasonable cooks could disagree. Use reasoningCategory to describe the strongest relationship in that step. The current Cooking Mode mapping is intentionally absent from the request.`

export const CONTROL_REVIEW_SYSTEM_PROMPT = `You are auditing false-negative risk after two blind Cooking Mode reviews agreed with the current UI. Inspect the complete recipe source and the supplied candidate expected indexes. Look specifically for any listed ingredient that a competent cook actively introduces, uses, manipulates, seasons with, combines with, applies, adds, cooks, tosses, tops, garnishes, or otherwise needs at a step but which the candidate omits. Also identify candidate indexes that are not actively used at that step. Be especially skeptical about main ingredients, proteins, vegetables, seasonings, collective references, aliases, group scope, and prepared components. Never return a group header or an out-of-range index. Return a complete corrected expectation for every instruction, even when unchanged.`

export const ADJUDICATION_SYSTEM_PROMPT = `You are the final evidence adjudicator for a Cooking Mode precision-and-recall audit. Inspect the raw numbered ingredients, group scope, the instruction, surrounding actionable instructions, the current UI indexes, two independent blind reviews, and any control review. Decide what a competent cook actively needs or uses at each step under this rule: an ingredient belongs when the cook actively introduces, uses, manipulates, seasons with, combines with, applies, adds, cooks, tosses, tops, garnishes, or otherwise needs that listed ingredient for that action. Contextual mentions and guesses do not belong.

Return a complete final expected mapping for every step. Then adjudicate every supplied discrepancy candidate as EXPECTED_CURRENT, EXPECTED_MISSING, CURRENT_INCORRECT, or AMBIGUOUS. Do not automatically trust reviewer consensus or a singleton. Do not return group-header or out-of-range indexes. For each expected ingredient, identify whether it is explicit active use and assign an impact level: CRITICAL for a main/structural ingredient, HIGH for a substantial specific ingredient, MEDIUM for a clearly used seasoning/herb/aromatic, LOW for an optional garnish or low-impact row. For confirmed current errors, choose the most specific supplied root cause and fix layer from the allowed enums. AMBIGUOUS relationships must not enter the expected indexes.`

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function effectiveRecipeContent(sharedContent, meta) {
  return typeof meta?.overrides?.content === 'string' && meta.overrides.content.length > 0
    ? meta.overrides.content
    : sharedContent
}

export function runtimeMapSource(resolvedSource) {
  return resolvedSource === 'persisted' ? 'persisted' : 'deterministic-v5-fallback'
}

export function runtimeEngineSegment(recipe) {
  return recipe.runtimeMapSource === 'deterministic-v5-fallback'
    ? 'deterministic-v5-runtime-fallback'
    : recipe.persistedEngine
}

export function assertMappedPopulation(documents, expected = EXPECTED_MAPPED_POPULATION) {
  const mapped = documents.filter(document => document?.data?.cookingStepIngredientMap)
  if (mapped.length !== expected) throw new Error(`mapped production population changed: ${mapped.length}/${expected}`)
  return mapped
}

export function buildRemediationCandidate({
  recipeId,
  instructionIndex,
  ingredientIndex,
  severity,
  rootCause,
  reviewerAFound,
  reviewerBFound,
  currentAiEligible,
  recommendedFixLayer,
}) {
  return {
    recipeId,
    instructionIndex,
    ingredientIndex,
    severity,
    rootCause,
    reviewerAFound,
    reviewerBFound,
    currentAiEligible,
    recommendedFixLayer,
  }
}

export function normalizeIndexes(indexes) {
  return [...new Set((indexes || []).filter(Number.isInteger))].sort((a, b) => a - b)
}

export function normalizeLabels(labels) {
  return [...new Set((labels || []).map(value => String(value || '').trim().replace(/\s+/g, ' ')).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
}

export function sameIndexes(left, right) {
  return JSON.stringify(normalizeIndexes(left)) === JSON.stringify(normalizeIndexes(right))
}

export function formatBlindRecipePrompt(title, ingredients, instructions, isHeader) {
  const ingredientLines = ingredients.map((raw, index) =>
    `[${index}] ${isHeader(raw) ? 'GROUP HEADER: ' : ''}${raw}`)
  const instructionLines = instructions.map((raw, index) => `[${index}] ${raw}`)
  return [
    'TITLE', title, '',
    'INGREDIENTS', ...ingredientLines, '',
    'INSTRUCTIONS', ...instructionLines,
  ].join('\n')
}

export function validateReviewOutput(output, ingredients, instructions, isHeader) {
  if (!output || !Array.isArray(output.steps)) throw new Error('review output has no steps array')
  const seen = new Set()
  for (const step of output.steps) {
    if (!Number.isInteger(step.instructionIndex) || step.instructionIndex < 0 || step.instructionIndex >= instructions.length) {
      throw new Error(`review instruction index out of range: ${step.instructionIndex}`)
    }
    if (seen.has(step.instructionIndex)) throw new Error(`duplicate review instruction index: ${step.instructionIndex}`)
    seen.add(step.instructionIndex)
    for (const field of ['expectedIngredientIndexes', 'explicitActiveUseIndexes']) {
      if (!Array.isArray(step[field])) throw new Error(`review step ${step.instructionIndex} lacks ${field}`)
      for (const index of step[field]) {
        if (!Number.isInteger(index) || index < 0 || index >= ingredients.length) {
          throw new Error(`review ingredient index out of range: ${index}`)
        }
        if (isHeader(ingredients[index])) throw new Error(`review referenced header index: ${index}`)
      }
    }
    const expected = new Set(step.expectedIngredientIndexes)
    if (step.explicitActiveUseIndexes.some(index => !expected.has(index))) {
      throw new Error(`review explicit indexes are not a subset at step ${step.instructionIndex}`)
    }
    if (!Array.isArray(step.ingredientAssessments)) throw new Error(`review step ${step.instructionIndex} lacks ingredientAssessments`)
    const assessed = new Set()
    for (const assessment of step.ingredientAssessments) {
      if (!expected.has(assessment.ingredientIndex)) throw new Error(`review assessed unexpected index ${assessment.ingredientIndex}`)
      if (assessed.has(assessment.ingredientIndex)) throw new Error(`review duplicate assessment ${assessment.ingredientIndex}`)
      assessed.add(assessment.ingredientIndex)
    }
    if (assessed.size !== expected.size) throw new Error(`review did not assess every expected index at step ${step.instructionIndex}`)
  }
  if (seen.size !== instructions.length) throw new Error(`review returned ${seen.size}/${instructions.length} steps`)
  return true
}

export function reviewStepMap(review) {
  return new Map((review?.steps || []).map(step => [step.instructionIndex, step]))
}

export function discrepancyCandidates(currentMap, reviewA, reviewB, controlReview = null) {
  const a = reviewStepMap(reviewA)
  const b = reviewStepMap(reviewB)
  const c = reviewStepMap(controlReview)
  const candidates = []
  for (const step of currentMap.steps) {
    const instructionIndex = step.instructionIndex
    const current = normalizeIndexes(step.ingredients.map(item => item.ingredientIndex))
    const ai = normalizeIndexes(a.get(instructionIndex)?.expectedIngredientIndexes)
    const bi = normalizeIndexes(b.get(instructionIndex)?.expectedIngredientIndexes)
    const ci = controlReview ? normalizeIndexes(c.get(instructionIndex)?.expectedIngredientIndexes) : null
    const union = normalizeIndexes([...current, ...ai, ...bi, ...(ci || [])])
    for (const ingredientIndex of union) {
      const present = current.includes(ingredientIndex)
      const inA = ai.includes(ingredientIndex)
      const inB = bi.includes(ingredientIndex)
      const inControl = ci === null ? null : ci.includes(ingredientIndex)
      if (present === inA && present === inB && (inControl === null || present === inControl)) continue
      let classification
      if (!present && inA && inB) classification = 'CURRENT_MISSING_CONSENSUS'
      else if (!present) classification = 'CURRENT_MISSING_SINGLETON'
      else if (!inA && !inB) classification = 'CURRENT_EXTRA_VS_BOTH'
      else classification = 'CURRENT_EXTRA_VS_ONE'
      candidates.push({ instructionIndex, ingredientIndex, current: present, reviewerA: inA, reviewerB: inB, control: inControl, classification })
    }
    if (!sameIndexes(ai, bi)) {
      candidates.push({ instructionIndex, ingredientIndex: null, classification: 'REVIEWERS_DISAGREE' })
    }
  }
  return candidates
}

export function associationMath(currentIndexes, expectedIndexes) {
  const current = new Set(normalizeIndexes(currentIndexes))
  const expected = new Set(normalizeIndexes(expectedIndexes))
  return {
    truePositiveIndexes: [...current].filter(index => expected.has(index)).sort((a, b) => a - b),
    falsePositiveIndexes: [...current].filter(index => !expected.has(index)).sort((a, b) => a - b),
    falseNegativeIndexes: [...expected].filter(index => !current.has(index)).sort((a, b) => a - b),
  }
}

export function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator
}

export function metricsFromSteps(steps) {
  const truePositives = steps.reduce((sum, step) => sum + step.truePositiveIndexes.length, 0)
  const falsePositives = steps.reduce((sum, step) => sum + step.falsePositiveIndexes.length, 0)
  const falseNegatives = steps.reduce((sum, step) => sum + step.falseNegativeIndexes.length, 0)
  const precision = ratio(truePositives, truePositives + falsePositives)
  const recall = ratio(truePositives, truePositives + falseNegatives)
  const f1 = precision === null || recall === null || precision + recall === 0
    ? null : 2 * precision * recall / (precision + recall)
  return { truePositives, falsePositives, falseNegatives, precision, recall, f1 }
}

export function sumMetrics(recipes) {
  const truePositives = recipes.reduce((sum, row) => sum + row.metrics.truePositives, 0)
  const falsePositives = recipes.reduce((sum, row) => sum + row.metrics.falsePositives, 0)
  const falseNegatives = recipes.reduce((sum, row) => sum + row.metrics.falseNegatives, 0)
  const precision = ratio(truePositives, truePositives + falsePositives)
  const recall = ratio(truePositives, truePositives + falseNegatives)
  const f1 = precision === null || recall === null || precision + recall === 0
    ? null : 2 * precision * recall / (precision + recall)
  return { truePositives, falsePositives, falseNegatives, precision, recall, f1 }
}

export function gradeRecipe(steps, ambiguousSource = false) {
  if (ambiguousSource) return 'AMBIGUOUS_SOURCE'
  if (steps.some(step => step.falsePositiveIndexes.length > 0)) return 'UNSAFE'
  const missingLevels = steps.flatMap(step => (step.severity || [])
    .filter(item => step.falseNegativeIndexes.includes(item.ingredientIndex))
    .map(item => item.level))
  if (missingLevels.some(level => level === 'CRITICAL' || level === 'HIGH')) return 'MATERIAL_OMISSIONS'
  if (missingLevels.length > 0) return 'MINOR_OMISSIONS'
  return 'COMPLETE'
}

export function selectControlSample(rows, target = 50) {
  const eligible = rows.filter(row => row.discrepancies.length === 0)
  const scored = eligible.map(row => {
    const ingredientCount = row.ingredients.filter(item => !row.headerIndexes.includes(item.index)).length
    const instructionCount = row.instructions.length
    const text = `${row.title} ${row.ingredients.map(item => item.raw).join(' ')}`.toLowerCase()
    const seasoning = /\b(?:salt|pepper|herb|spice|garlic|seasoning)\b/.test(text) ? 8 : 0
    const protein = /\b(?:chicken|beef|steak|pork|fish|salmon|shrimp|tofu|turkey)\b/.test(text) ? 7 : 0
    const starch = /\b(?:pasta|noodle|rice|potato)\b/.test(text) ? 6 : 0
    const multi = row.headerIndexes.length > 0 ? 10 : 0
    const engine = /v5$/.test(row.persistedEngine) ? 4 : 0
    return { row, score: ingredientCount + instructionCount * 2 + seasoning + protein + starch + multi + engine }
  }).sort((a, b) => b.score - a.score || a.row.recipeId.localeCompare(b.row.recipeId))

  const chosen = []
  const engines = ['deterministic-v4', 'hybrid-v4', 'deterministic-v5', 'hybrid-v5']
  for (const engine of engines) {
    const found = scored.find(item => item.row.persistedEngine === engine && !chosen.includes(item.row))
    if (found) chosen.push(found.row)
  }
  for (const item of scored) {
    if (chosen.length >= Math.min(target, eligible.length)) break
    if (!chosen.includes(item.row)) chosen.push(item.row)
  }
  return chosen.sort((a, b) => a.recipeId.localeCompare(b.recipeId))
}

export function assertNoCurrentMapInBlindPrompt(prompt) {
  const forbidden = ['currentIngredientIndexes', 'current UI', 'persisted map', 'deterministic map']
  for (const token of forbidden) {
    if (prompt.toLowerCase().includes(token.toLowerCase())) throw new Error(`blind prompt leaked ${token}`)
  }
  return true
}

export function classifyFallbackRoot(runtimeSource, fallbackReason, overrideActive, positive) {
  const causes = []
  if (runtimeSource === 'deterministic-v5-fallback') {
    causes.push(positive ? 'DETERMINISTIC_FALLBACK_FALSE_NEGATIVE' : 'DETERMINISTIC_FALLBACK_FALSE_POSITIVE')
    if (fallbackReason && fallbackReason !== 'missing') causes.push('RUNTIME_PERSISTED_MAP_REJECTED')
    if (overrideActive) causes.push('SOURCE_HASH_OR_OVERRIDE_FALLBACK')
  } else {
    causes.push(positive ? 'PERSISTED_MAP_FALSE_NEGATIVE' : 'PERSISTED_MAP_FALSE_POSITIVE')
  }
  return causes
}

export const NAMED_REGRESSIONS = {
  'garlic-butter-herb-steak-bites-with-potatoes': [
    { instructionIndex: 0, ingredientPattern: /potato/i },
    { instructionIndex: 1, ingredientPattern: /sirloin|steak/i },
  ],
  'caprese-salad': [
    { instructionIndex: 0, ingredientPattern: /mozzarella/i },
  ],
  'grilled-zucchini-and-summer-squash': [
    { instructionIndex: 1, ingredientPattern: /italian herb/i },
    { instructionIndex: 1, ingredientPattern: /black pepper/i },
  ],
}

export function namedRegressionResults(recipes) {
  return Object.entries(NAMED_REGRESSIONS).flatMap(([recipeId, checks]) => {
    const recipe = recipes.find(row => row.recipeId === recipeId)
    if (!recipe) return checks.map(check => ({ recipeId, ...check, error: 'recipe missing' }))
    return checks.map(check => {
      const ingredient = recipe.ingredients.find(item => check.ingredientPattern.test(item.raw))
      const step = recipe.steps.find(item => item.instructionIndex === check.instructionIndex)
      return {
        recipeId,
        instructionIndex: check.instructionIndex,
        ingredientIndex: ingredient?.index ?? null,
        current: ingredient ? step.currentIngredientIndexes.includes(ingredient.index) : null,
        expected: ingredient ? step.adjudicatedExpectedIndexes.includes(ingredient.index) : null,
        missing: ingredient ? step.falseNegativeIndexes.includes(ingredient.index) : null,
      }
    })
  })
}
