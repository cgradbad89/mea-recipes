#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const benchmarkPath = path.join(root, 'docs/audits/cooking-mode-completeness-audit-2026-08-26.json')
const resultPath = '/tmp/cooking-step-completeness-v6-focused-2026-08-27.json'
const statePath = '/tmp/cooking-step-completeness-v6-focused-2026-08-27-state.json'
const outputPath = path.join(root, 'docs/audits/cooking-mode-v7-focused-failure-matrix-2026-08-27.md')

for (const required of [benchmarkPath, resultPath, statePath]) {
  if (!fs.existsSync(required)) throw new Error(`Missing required preserved evidence: ${required}`)
}

const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'))
const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
const benchmarkById = new Map(benchmark.recipes.map(recipe => [recipe.recipeId, recipe]))
const rejectedByKey = new Map(result.validatorRejectedCorrectAdditions.map(item => [
  `${item.recipeId}:${item.instructionIndex}:${item.ingredientIndex}`,
  item.reason,
]))

function outputFor(recipeId) {
  return Object.entries(state.outputs).find(([key]) => key.startsWith(`${recipeId}:`))?.[1]?.completenessOutput
}

function proposalFor(recipeId, instructionIndex, ingredientIndex) {
  const step = outputFor(recipeId)?.steps?.find(item => item.instructionIndex === instructionIndex)
  if (!step) return 'none'
  const locations = []
  if (step.expectedIngredientIndexes?.includes(ingredientIndex)) locations.push('expected')
  if (step.omissionCheckIngredientIndexes?.includes(ingredientIndex)) locations.push('omission-check')
  if (step.rejectedAfterSafetyCheckIndexes?.includes(ingredientIndex)) locations.push('AI-safety-rejected')
  return locations.length ? locations.join('+') : 'none'
}

function rootClass(recipeId, step, ingredientIndex, isFalsePositive = false) {
  if (isFalsePositive) return 'AI_FALSE_POSITIVE'
  const rejection = rejectedByKey.get(`${recipeId}:${step.instructionIndex}:${ingredientIndex}`)
  if (rejection === 'duplicate-proposal-conflict') return 'VALIDATOR_DUPLICATE_CONFLICT'
  if (rejection?.includes('group') || rejection?.includes('scope')) return 'VALIDATOR_GROUP_OVERRESTRICTION'
  if (rejection === 'invalid-source-row') return 'VALIDATOR_SOURCE_ROW_CLASSIFICATION'
  if (rejection) return 'VALIDATOR_LIFECYCLE_OVERRESTRICTION'
  const severity = step.severity?.find(item => item.ingredientIndex === ingredientIndex)
  const raw = benchmarkById.get(recipeId)?.ingredients?.find(item => item.index === ingredientIndex)?.raw || ''
  if (severity?.kind === 'SEASONING_HERB') return 'AI_SEASONING_MISS'
  if (severity?.kind === 'MAIN_STRUCTURAL' || severity?.level === 'CRITICAL') return 'AI_MAIN_INGREDIENT_MISS'
  if (/group|scope/i.test((step.rootCauses || []).join(' '))) return 'AI_GROUP_SCOPE_MISS'
  if (/salt|pepper|herb|spice|season|garlic|onion/i.test(raw)) return 'AI_SEASONING_MISS'
  return 'AI_SEMANTIC_MISS'
}

function clean(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
}

const ingredientRows = []
const componentRows = []
for (const resultRecipe of result.rows) {
  const truth = benchmarkById.get(resultRecipe.recipeId)
  if (!truth) throw new Error(`Missing benchmark recipe: ${resultRecipe.recipeId}`)
  for (const evaluationStep of resultRecipe.evaluation.steps) {
    const step = truth.steps.find(item => item.instructionIndex === evaluationStep.instructionIndex)
    if (!step) throw new Error(`Missing benchmark step: ${resultRecipe.recipeId}/${evaluationStep.instructionIndex}`)
    for (const ingredientIndex of evaluationStep.falsePositiveIndexes) {
      const source = truth.ingredients.find(item => item.index === ingredientIndex)?.raw || '<invalid index>'
      ingredientRows.push({
        recipeId: resultRecipe.recipeId,
        instructionIndex: step.instructionIndex,
        ingredientIndex,
        source,
        instruction: step.instruction,
        expected: 'not expected; unsafe relationship',
        rawProposal: proposalFor(resultRecipe.recipeId, step.instructionIndex, ingredientIndex),
        validator: 'accepted into hybrid-v6',
        rootCause: rootClass(resultRecipe.recipeId, step, ingredientIndex, true),
      })
    }
    for (const ingredientIndex of evaluationStep.falseNegativeIndexes) {
      const source = truth.ingredients.find(item => item.index === ingredientIndex)?.raw || '<invalid index>'
      const rejection = rejectedByKey.get(`${resultRecipe.recipeId}:${step.instructionIndex}:${ingredientIndex}`)
      ingredientRows.push({
        recipeId: resultRecipe.recipeId,
        instructionIndex: step.instructionIndex,
        ingredientIndex,
        source,
        instruction: step.instruction,
        expected: 'adjudicated active ingredient use',
        rawProposal: proposalFor(resultRecipe.recipeId, step.instructionIndex, ingredientIndex),
        validator: rejection ? `rejected: ${rejection}` : 'not proposed by AI',
        rootCause: rootClass(resultRecipe.recipeId, step, ingredientIndex),
      })
    }
    const actualLabels = new Set((resultRecipe.proposedMap.steps
      .find(item => item.instructionIndex === step.instructionIndex)?.preparedComponents || [])
      .map(item => item.label.trim().toLowerCase()))
    const aiLabels = outputFor(resultRecipe.recipeId)?.steps
      ?.find(item => item.instructionIndex === step.instructionIndex)?.preparedComponents || []
    for (const label of step.expectedPreparedComponents || []) {
      if (actualLabels.has(label.trim().toLowerCase())) continue
      const rawProposal = aiLabels.find(item => item.label?.trim().toLowerCase() === label.trim().toLowerCase())
      componentRows.push({
        recipeId: resultRecipe.recipeId,
        instructionIndex: step.instructionIndex,
        component: label,
        instruction: step.instruction,
        rawProposal: rawProposal ? JSON.stringify(rawProposal) : 'none',
        validator: rawProposal ? 'proposed but not present after grounding' : 'not proposed by AI',
        rootCause: rawProposal ? 'VALIDATOR_COMPONENT_GROUNDING' : 'AI_COMPONENT_MISS',
      })
    }
  }
}

ingredientRows.sort((a, b) => a.recipeId.localeCompare(b.recipeId) ||
  a.instructionIndex - b.instructionIndex || a.ingredientIndex - b.ingredientIndex)
componentRows.sort((a, b) => a.recipeId.localeCompare(b.recipeId) ||
  a.instructionIndex - b.instructionIndex || a.component.localeCompare(b.component))

const counts = [...ingredientRows, ...componentRows].reduce((map, row) => {
  map[row.rootCause] = (map[row.rootCause] || 0) + 1
  return map
}, {})
const lines = [
  '# Cooking Mode v7 focused failure matrix — 2026-08-27',
  '',
  '## Provenance',
  '',
  `This matrix is reconstructed from the immutable adjudicated 228-recipe audit, the preserved final v6 focused result at \`${resultPath}\`, and its raw AI state at \`${statePath}\`. The focused population is unchanged at ${result.summary.recipeCount} source-hash-matching recipes. No Gateway or Firestore call was made to construct this file.`,
  '',
  '## Summary',
  '',
  `- Ingredient false positives: ${ingredientRows.filter(row => row.rootCause === 'AI_FALSE_POSITIVE').length}`,
  `- Ingredient false negatives: ${ingredientRows.filter(row => row.rootCause !== 'AI_FALSE_POSITIVE').length}`,
  `- Correct proposals rejected by the validator: ${result.validatorRejectedCorrectAdditions.length}`,
  `- Prepared-component misses: ${componentRows.length}`,
  '',
  ...Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `- ${key}: ${value}`),
  '',
  '## Ingredient association failures',
  '',
  '| recipeId | step | ingredient | source ingredient | source instruction | expected relationship | raw v6 AI proposal | validator result | root cause |',
  '|---|---:|---:|---|---|---|---|---|---|',
  ...ingredientRows.map(row => `| ${clean(row.recipeId)} | ${row.instructionIndex} | ${row.ingredientIndex} | ${clean(row.source)} | ${clean(row.instruction)} | ${row.expected} | ${row.rawProposal} | ${row.validator} | ${row.rootCause} |`),
  '',
  '## Prepared-component failures',
  '',
  '| recipeId | step | component | source instruction | expected relationship | raw v6 AI proposal | validator result | root cause |',
  '|---|---:|---|---|---|---|---|---|',
  ...componentRows.map(row => `| ${clean(row.recipeId)} | ${row.instructionIndex} | ${clean(row.component)} | ${clean(row.instruction)} | expected prepared-component context | ${clean(row.rawProposal)} | ${row.validator} | ${row.rootCause} |`),
  '',
]
fs.writeFileSync(outputPath, `${lines.join('\n')}\n`)
console.log(JSON.stringify({ outputPath, ingredientRows: ingredientRows.length, componentRows: componentRows.length, counts }, null, 2))
