import { createHash } from 'node:crypto'

export const AUDIT_CLASSIFICATIONS = ['READY', 'REVIEW', 'EXCLUDED', 'ERROR', 'EXISTING_MAP']

const EXACT_URL = /^https?:\/\/\S+$/i
const PAYWALL_PLACEHOLDER = /^(?:not available|unavailable)\b.*(?:paywall|could not be fetched)/i
const STANDALONE_NON_COOKING_STEP = /^(?:storage(?: suggestions?)?:|nutritional? information\b|(?:📊\s*)?nutrition estimate:|note:\s*the nutritional information\b|recipe source:)/i
const STANDALONE_SOURCE_NOTE = /^(?:i love purchasing frozen chopped lemongrass\b|keep this vegan by using\b)/i
const REVIEW_CHROME_OR_COMMENT = /^(?:have you cooked this\?|cooking notes$|most helpful\d*$|\d+ this is helpful$|loved this recipe\b|amazing recipe\b|delicious! if\b|also: this recipe is perfect\b|i made this for\b|i added all the water it asked\b)/i
const REVIEW_AUTHOR_LINE = /^.{1,80}\d+\s+years? ago$/i

const KNOWN_SOURCE_DEFECTS = new Map([
  ['chipotle-tahini-bowls', 'PRD-known legacy source defect: the ingredient source mixes unquantified bowl suggestions with note-only preparation content.'],
  ['lemon-herb-pasta-salad-with-marinated-chickpeas', 'The parsed ingredient list omits the chickpeas named by the recipe and instructions.'],
  ['mole-poblano', 'PRD-known legacy source defect: storage/tip prose and presentation labels are parsed as cooking instructions.'],
])

export function parserDefectEvidence(instructions) {
  const evidence = []
  instructions.forEach((instruction, instructionIndex) => {
    const text = String(instruction || '').trim()
    let defect = null
    if (EXACT_URL.test(text)) defect = 'source URL parsed as a cooking instruction'
    else if (PAYWALL_PLACEHOLDER.test(text)) defect = 'unavailable/paywalled placeholder parsed as a cooking instruction'
    else if (STANDALONE_NON_COOKING_STEP.test(text)) defect = 'standalone nutrition, storage, or source metadata parsed as a cooking instruction'
    else if (STANDALONE_SOURCE_NOTE.test(text)) defect = 'standalone source note parsed as a cooking instruction'
    else if (REVIEW_CHROME_OR_COMMENT.test(text) || REVIEW_AUTHOR_LINE.test(text)) defect = 'review/comment chrome parsed as a cooking instruction'
    if (defect) evidence.push({ instructionIndex, instruction: text, defect })
  })
  return evidence
}

export function classifyRecipeSource(data, parsed, limits) {
  if (typeof data.content !== 'string' || data.content.trim().length === 0) {
    return { status: 'EXCLUDE_INVALID_CONTENT', reason: 'Shared recipe content is missing or not a nonempty string.', evidence: [] }
  }
  if (data.content.length > limits.maxContentLength) {
    return { status: 'EXCLUDE_INVALID_CONTENT', reason: `Shared content exceeds the production ${limits.maxContentLength}-character limit.`, evidence: [] }
  }
  if (parsed.ingredients.length === 0) {
    return { status: 'EXCLUDE_NO_INGREDIENTS', reason: 'parseRecipeContent returned no ingredients from shared content.', evidence: [] }
  }
  if (parsed.instructions.length === 0) {
    return { status: 'EXCLUDE_NO_INSTRUCTIONS', reason: 'parseRecipeContent returned no instructions from shared content.', evidence: [] }
  }
  if (parsed.ingredients.length > limits.maxIngredients || parsed.instructions.length > limits.maxInstructions) {
    return { status: 'EXCLUDE_INVALID_CONTENT', reason: 'Parsed source exceeds the production ingredient/instruction count limit.', evidence: [] }
  }
  if ([...parsed.ingredients, ...parsed.instructions].some(line => line.length > limits.maxLineLength)) {
    return { status: 'EXCLUDE_INVALID_CONTENT', reason: `A parsed source line exceeds the production ${limits.maxLineLength}-character limit.`, evidence: [] }
  }
  const knownDefect = KNOWN_SOURCE_DEFECTS.get(data.recipeId)
  if (knownDefect) {
    return { status: 'EXCLUDE_PARSER_DEFECT', reason: knownDefect, evidence: [{ defect: knownDefect }] }
  }
  const evidence = parserDefectEvidence(parsed.instructions)
  if (evidence.length > 0) {
    return {
      status: 'EXCLUDE_PARSER_DEFECT',
      reason: evidence.map(item => `Step ${item.instructionIndex}: ${item.defect}.`).join(' '),
      evidence,
    }
  }
  return { status: 'ELIGIBLE', reason: null, evidence: [] }
}

export function mapStats(map) {
  const steps = map?.steps || []
  const reasonCount = reason => steps.filter(step => step.unresolvedReason === reason).length
  return {
    instructionCount: steps.length,
    ingredientReferences: steps.reduce((sum, step) => sum + step.ingredients.length, 0),
    mappedIngredientReferences: steps.reduce((sum, step) => sum + step.ingredients.length, 0),
    mappedSteps: steps.filter(step => step.ingredients.length > 0 || (step.preparedComponents?.length || 0) > 0).length,
    unmappedSteps: steps.filter(step => step.ingredients.length === 0 && !(step.preparedComponents?.length > 0)).length,
    ambiguousSteps: reasonCount('ambiguous'),
    implicitReferenceSteps: reasonCount('implicit-reference'),
    preparedComponentSteps: reasonCount('prepared-component'),
    noIngredientUseSteps: reasonCount('no-ingredient-use'),
    nonActionableSteps: reasonCount('non-actionable'),
    aiEligibleSteps: steps.filter(step => ['ambiguous', 'implicit-reference', 'prepared-component'].includes(step.unresolvedReason)).length,
    preparedComponents: steps.reduce((sum, step) => sum + (step.preparedComponents?.length || 0), 0),
  }
}

export function additionId(recipeId, addition) {
  return addition.kind === 'ingredient'
    ? `${recipeId}|step:${addition.instructionIndex}|ingredient:${addition.ingredientIndex}`
    : `${recipeId}|step:${addition.instructionIndex}|component:${addition.label.toLowerCase().replace(/\s+/g, ' ')}`
}

export function extractAiAdditions(recipeId, candidateMap, ingredients, instructions) {
  return candidateMap.steps.flatMap(step => {
    const ingredientAdditions = step.ingredients
      .filter(reference => reference.provenance === 'ai')
      .map(reference => ({
        kind: 'ingredient',
        instructionIndex: step.instructionIndex,
        instruction: instructions[step.instructionIndex],
        ingredientIndex: reference.ingredientIndex,
        ingredient: ingredients[reference.ingredientIndex],
        reference,
      }))
    const componentAdditions = (step.preparedComponents || [])
      .filter(component => component.provenance === 'ai')
      .map(component => ({
        kind: 'prepared-component',
        instructionIndex: step.instructionIndex,
        instruction: instructions[step.instructionIndex],
        label: component.label,
        component,
      }))
    return [...ingredientAdditions, ...componentAdditions]
      .map(addition => ({ ...addition, additionId: additionId(recipeId, addition) }))
  })
}

export function aiSemanticSignature(map) {
  return map.steps.flatMap(step => [
    ...step.ingredients.filter(ref => ref.provenance === 'ai').map(ref => {
      const semanticUsage = ref.usage?.kind === 'partial'
        ? ref.usage
        : ref.usage ? { kind: ref.usage.kind } : null
      return `i:${step.instructionIndex}:${ref.ingredientIndex}:${JSON.stringify(semanticUsage)}`
    }),
    ...(step.preparedComponents || []).filter(item => item.provenance === 'ai').map(item =>
      `p:${step.instructionIndex}:${item.label.trim().replace(/\s+/g, ' ').toLowerCase()}`),
  ]).sort()
}

export function compareStability(primaryMap, repeatMap) {
  if (JSON.stringify(primaryMap) === JSON.stringify(repeatMap)) return 'EXACT_STABLE'
  if (JSON.stringify(aiSemanticSignature(primaryMap)) === JSON.stringify(aiSemanticSignature(repeatMap))) {
    return 'SEMANTICALLY_STABLE'
  }
  return 'MATERIAL_DIFFERENCE'
}

export function isTransientProviderError(error) {
  const status = Number(error?.statusCode ?? error?.status ?? error?.response?.status)
  if ([408, 409, 425, 429].includes(status) || status >= 500) return true
  const message = String(error?.message || error || '')
  return /(?:timeout|timed out|temporar|rate limit|network|connection|ECONN|fetch failed|gateway)/i.test(message)
}

export async function callWithOneTransientRetry(call) {
  let attempts = 0
  try {
    attempts += 1
    return { status: 'completed', attempts, value: await call() }
  } catch (error) {
    if (!isTransientProviderError(error)) return { status: 'failed', attempts, error: String(error?.message || error) }
    try {
      attempts += 1
      return { status: 'completed', attempts, value: await call() }
    } catch (retryError) {
      return { status: 'failed', attempts, error: String(retryError?.message || retryError) }
    }
  }
}

export async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length)
  let nextIndex = 0
  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker))
  return results
}

export function isAuditAiEligible(row) {
  return row.sourceStatus === 'ELIGIBLE' &&
    !row.currentMapPresent &&
    (row.deterministicStats?.aiEligibleSteps || 0) > 0
}

export function auditPrecondition(row) {
  return {
    currentMapAbsent: !row.currentMapPresent,
    contentSourceHash: row.sourceHash,
  }
}

export function classifyAuditRecipe(evidence) {
  if (evidence.sourceStatus?.startsWith('EXCLUDE_')) {
    return { classification: 'EXCLUDED', reason: evidence.sourceReason }
  }
  if (evidence.sourceStatus === 'ERROR') return { classification: 'ERROR', reason: evidence.sourceReason }
  if (evidence.currentMapPresent) {
    return {
      classification: 'EXISTING_MAP',
      reason: `A persisted ${evidence.currentMapEngineVersion || 'unknown-version'} map already exists; future backfill must not replace it.`,
    }
  }
  if (evidence.aiStatus === 'failed') {
    return { classification: 'ERROR', reason: `AI evaluation failed: ${evidence.aiError}` }
  }
  if (!evidence.candidateValid) {
    return { classification: 'ERROR', reason: `Candidate failed production validation: ${evidence.candidateValidationReason || 'unknown'}` }
  }
  if (evidence.missingReview) return { classification: 'REVIEW', reason: 'AI additions await semantic review.' }
  if (evidence.aiIncorrect > 0) {
    return { classification: 'EXCLUDED', reason: 'At least one AI addition is semantically incorrect.' }
  }
  if (evidence.aiAmbiguous > 0) {
    return { classification: 'REVIEW', reason: 'At least one AI addition is semantically ambiguous.' }
  }
  if (evidence.stabilityAiIncorrect > 0 || evidence.stabilityAiAmbiguous > 0) {
    return { classification: 'REVIEW', reason: 'The stability rerun produced an unsafe accepted AI relationship.' }
  }
  if (evidence.deterministicFalsePositive) {
    return { classification: 'EXCLUDED', reason: 'Deterministic semantic sample found an obvious false positive.' }
  }
  if (evidence.stabilityStatus === 'MATERIAL_DIFFERENCE' || evidence.stabilityStatus === 'ERROR') {
    return { classification: 'REVIEW', reason: `Stability check result: ${evidence.stabilityStatus}.` }
  }
  return { classification: 'READY', reason: null }
}

export function sortManifestRows(rows) {
  return [...rows].sort((a, b) => a.recipeId.localeCompare(b.recipeId))
}

export function selectStabilitySubset(rows, target = 30) {
  const scored = rows.filter(row => row.hybridStats?.aiAttempted).map(row => {
    const text = row.parsed.instructions.join(' ').toLowerCase()
    const ingredients = row.parsed.ingredients.map(item => item.toLowerCase())
    const repeated = ingredients.some((item, index) => ingredients.indexOf(item) !== index)
    const score =
      (row.aiAdditions.some(item => item.kind === 'prepared-component') ? 32 : 0) +
      (row.deterministicStats.ambiguousSteps > 0 ? 16 : 0) +
      (/\b(?:all ingredients|remaining ingredients|everything)\b/.test(text) ? 8 : 0) +
      (/\b(?:it|them|this|that|these|those)\b/.test(text) ? 4 : 0) +
      (repeated ? 2 : 0) +
      (/\b(?:half|quarter|remaining|rest|some)\b/.test(text) ? 1 : 0)
    return { row, score }
  })
  return scored.sort((a, b) => b.score - a.score || a.row.recipeId.localeCompare(b.row.recipeId))
    .slice(0, target).map(item => item.row)
}

export function selectDeterministicSample(rows, target = 80) {
  const requiredIds = [
    '194', 'charlie-bird-s-farro-salad', 'easy-spaghetti-with-meat-sauce', 'pesto',
    'roasted-asparagus-with-lemon', 'taco-soup', 'japanese-teriyaki-salmon-bowl',
    'blue-corn-green-chili-chicken-enchiladas',
    'buttersoy-chicken-and-asparagus-stirfry', 'chicken-chow-mein', 'chicken-wild-rice',
    'creamy-chickpea-spinach-masala-with-tadka', 'fried-chicken-sandwich',
    'moqueca-brazilian-fish-stew', 'queso-chicken-chili-with-roasted-corn-and-jalape-o',
    'tacos-al-pastor',
    'sheet-pan-chicken-tinga-bowls', 'chopped-thai-shrimp-salad-with-garlic-lime-dressing',
    'singapore-mei-fun', 'sesame-apricot-tofu', 'chickpea-curry',
  ]
  const eligible = rows.filter(row => row.sourceStatus === 'ELIGIBLE')
  const selected = []
  const ids = new Set()
  for (const recipeId of requiredIds) {
    const row = eligible.find(item => item.recipeId === recipeId)
    if (row && !ids.has(row.recipeId)) { selected.push(row); ids.add(row.recipeId) }
  }
  const rest = eligible.filter(row => !ids.has(row.recipeId)).sort((a, b) => {
    const complexityA = a.deterministicStats.ambiguousSteps * 8 + a.deterministicStats.preparedComponentSteps * 4 + a.deterministicStats.implicitReferenceSteps * 2 + a.parsed.ingredients.length / 100
    const complexityB = b.deterministicStats.ambiguousSteps * 8 + b.deterministicStats.preparedComponentSteps * 4 + b.deterministicStats.implicitReferenceSteps * 2 + b.parsed.ingredients.length / 100
    return complexityB - complexityA || a.recipeId.localeCompare(b.recipeId)
  })
  for (const row of rest) {
    if (selected.length >= target) break
    selected.push(row); ids.add(row.recipeId)
  }
  return selected.slice(0, target)
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}
