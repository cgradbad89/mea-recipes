#!/usr/bin/env node
/** Reconstruct the exhaustive-v8 design input from preserved v6/v7 focused evidence. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const benchmarkPath = path.join(root, 'docs/audits/cooking-mode-completeness-audit-2026-08-26.json')
const v6ResultPath = '/tmp/cooking-step-completeness-v6-focused-2026-08-27.json'
const v6StatePath = '/tmp/cooking-step-completeness-v6-focused-2026-08-27-state.json'
const v7ResultPath = '/tmp/cooking-step-semantic-v7-focused-2026-08-27.json'
const outputPath = path.join(root, 'docs/audits/cooking-mode-usage-matrix-v8-design-input-2026-08-27.json')

for (const required of [benchmarkPath, v6ResultPath, v6StatePath, v7ResultPath]) {
  if (!fs.existsSync(required)) throw new Error(`Missing required preserved evidence: ${required}`)
}

const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'))
const v6 = JSON.parse(fs.readFileSync(v6ResultPath, 'utf8'))
const v6State = JSON.parse(fs.readFileSync(v6StatePath, 'utf8'))
const v7 = JSON.parse(fs.readFileSync(v7ResultPath, 'utf8'))
const truthById = new Map(benchmark.recipes.map(recipe => [recipe.recipeId, recipe]))

function truthContext(recipeId, instructionIndex, ingredientIndex) {
  const recipe = truthById.get(recipeId)
  const step = recipe?.steps.find(item => item.instructionIndex === instructionIndex)
  return {
    title: recipe?.title || '',
    sourceIngredient: ingredientIndex === undefined ? undefined : recipe?.ingredients[ingredientIndex],
    sourceInstruction: step?.instruction || '',
  }
}

function diagnosticFor(row, instructionIndex, ingredientIndex) {
  return row.diagnostics.filter(item =>
    item.instructionIndex === instructionIndex && item.ingredientIndex === ingredientIndex)
}

const failures = []

for (const row of v7.rows) {
  for (const truthStep of row.evaluation.steps) {
    const rawStep = row.semanticOutput.steps.find(item => item.instructionIndex === truthStep.instructionIndex)
    const finalIndexes = new Set(row.proposedMap.steps[truthStep.instructionIndex].ingredients
      .map(item => item.ingredientIndex))
    const expectedIndexes = new Set(truthStep.expectedIndexes)
    for (const ingredientIndex of expectedIndexes) {
      const proposals = (rawStep?.ingredientUses || []).filter(item =>
        item.ingredientIndex === ingredientIndex && item.confidence === 'high')
      if (proposals.length === 0) {
        failures.push({
          recipeId: row.recipeId,
          instructionIndex: truthStep.instructionIndex,
          ingredientIndex,
          ...truthContext(row.recipeId, truthStep.instructionIndex, ingredientIndex),
          expected: 'USE_NOW',
          rawAiDecision: null,
          validatorDecision: 'NOT_EVALUATED_NO_PROPOSAL',
          failureClass: 'V7_AI_SEMANTIC_MISS',
        })
      } else if (!finalIndexes.has(ingredientIndex)) {
        failures.push({
          recipeId: row.recipeId,
          instructionIndex: truthStep.instructionIndex,
          ingredientIndex,
          ...truthContext(row.recipeId, truthStep.instructionIndex, ingredientIndex),
          expected: 'USE_NOW',
          rawAiDecision: proposals,
          validatorDecision: diagnosticFor(row, truthStep.instructionIndex, ingredientIndex),
          failureClass: 'V7_CORRECT_USE_REJECTED_BY_VALIDATOR',
        })
      }
    }
    for (const proposal of rawStep?.ingredientUses || []) {
      if (proposal.confidence !== 'high' || expectedIndexes.has(proposal.ingredientIndex) ||
        !finalIndexes.has(proposal.ingredientIndex)) continue
      failures.push({
        recipeId: row.recipeId,
        instructionIndex: truthStep.instructionIndex,
        ingredientIndex: proposal.ingredientIndex,
        ...truthContext(row.recipeId, truthStep.instructionIndex, proposal.ingredientIndex),
        expected: 'NOT_THIS_STEP',
        rawAiDecision: proposal,
        validatorDecision: diagnosticFor(row, truthStep.instructionIndex, proposal.ingredientIndex),
        failureClass: 'V7_INCORRECT_USE_ACCEPTED_BY_VALIDATOR',
      })
    }

    const expectedComponents = new Set(truthStep.preparedComponents.missing)
    const rawUses = rawStep?.componentUses || []
    for (const component of expectedComponents) {
      const normalized = component.toLowerCase()
      const matchingDefinitions = row.semanticOutput.components.filter(item =>
        item.label.toLowerCase() === normalized)
      const ids = new Set(matchingDefinitions.map(item => item.componentId))
      const matchingUses = rawUses.filter(item => ids.has(item.componentId))
      failures.push({
        recipeId: row.recipeId,
        instructionIndex: truthStep.instructionIndex,
        component,
        ...truthContext(row.recipeId, truthStep.instructionIndex),
        expected: 'COMPONENT_USE_NOW',
        rawAiDecision: { definitions: matchingDefinitions, uses: matchingUses },
        validatorDecision: matchingUses.flatMap(use => row.diagnostics.filter(item =>
          item.instructionIndex === truthStep.instructionIndex && item.componentId === use.componentId)),
        failureClass: matchingUses.length > 0
          ? 'V7_COMPONENT_USE_REJECTED_OR_MISNAMED'
          : 'V7_COMPONENT_MISS',
      })
    }
    for (const component of truthStep.preparedComponents.falsePositives) {
      const normalized = component.toLowerCase()
      const definitions = row.semanticOutput.components.filter(item => item.label.toLowerCase() === normalized)
      const ids = new Set(definitions.map(item => item.componentId))
      failures.push({
        recipeId: row.recipeId,
        instructionIndex: truthStep.instructionIndex,
        component,
        ...truthContext(row.recipeId, truthStep.instructionIndex),
        expected: 'NO_COMPONENT_USE',
        rawAiDecision: { definitions, uses: rawUses.filter(item => ids.has(item.componentId)) },
        validatorDecision: 'ACCEPTED_INTO_HYBRID_V7',
        failureClass: 'V7_INCORRECT_COMPONENT_ACCEPTED',
      })
    }
  }
}

for (const row of v6.rows) {
  const stateEntry = v6State.outputs[`${row.recipeId}:${row.sourceHash}`]
  for (const step of row.evaluation.steps) {
    for (const ingredientIndex of step.falsePositiveIndexes || []) {
      const rawStep = stateEntry?.completenessOutput?.steps?.find(item =>
        item.instructionIndex === step.instructionIndex)
      failures.push({
        recipeId: row.recipeId,
        instructionIndex: step.instructionIndex,
        ingredientIndex,
        ...truthContext(row.recipeId, step.instructionIndex, ingredientIndex),
        expected: 'NOT_THIS_STEP',
        rawAiDecision: rawStep || null,
        validatorDecision: 'ACCEPTED_INTO_HYBRID_V6',
        failureClass: 'V6_INCORRECT_USE_ACCEPTED_BY_VALIDATOR',
      })
    }
  }
}

const counts = failures.reduce((result, failure) => {
  result[failure.failureClass] = (result[failure.failureClass] || 0) + 1
  return result
}, {})
const requiredCounts = {
  V7_AI_SEMANTIC_MISS: 169,
  V7_CORRECT_USE_REJECTED_BY_VALIDATOR: 52,
  V7_INCORRECT_USE_ACCEPTED_BY_VALIDATOR: 9,
  V6_INCORRECT_USE_ACCEPTED_BY_VALIDATOR: 16,
}
for (const [failureClass, expected] of Object.entries(requiredCounts)) {
  if (counts[failureClass] !== expected) {
    throw new Error(`${failureClass} count changed: ${counts[failureClass]}/${expected}`)
  }
}

failures.sort((left, right) => left.recipeId.localeCompare(right.recipeId) ||
  left.instructionIndex - right.instructionIndex ||
  (left.ingredientIndex ?? Number.MAX_SAFE_INTEGER) - (right.ingredientIndex ?? Number.MAX_SAFE_INTEGER) ||
  String(left.component || '').localeCompare(String(right.component || '')) ||
  left.failureClass.localeCompare(right.failureClass))

const output = {
  schemaVersion: 1,
  architectureTarget: 'exhaustive-ingredient-step-matrix-v8',
  generatedFrom: {
    benchmark: path.relative(root, benchmarkPath),
    v6Result: v6ResultPath,
    v6State: v6StatePath,
    v7Result: v7ResultPath,
  },
  sourceFocusedRecipeCount: v7.summary.recipeCount,
  counts,
  failures,
}
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`)
console.log(JSON.stringify({ outputPath, counts, total: failures.length }, null, 2))
