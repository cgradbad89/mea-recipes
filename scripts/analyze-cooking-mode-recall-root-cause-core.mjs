import { createHash } from 'node:crypto'

export function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator
}

export function metrics(truePositives, falsePositives, expected) {
  const falseNegatives = expected - truePositives
  const precision = ratio(truePositives, truePositives + falsePositives)
  const recall = ratio(truePositives, expected)
  return {
    truePositives,
    falsePositives,
    falseNegatives,
    precision,
    recall,
    f1: precision === null || recall === null || precision + recall === 0
      ? null : 2 * precision * recall / (precision + recall),
  }
}

export function normalizeLabel(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function relationKey(recipeId, instructionIndex, ingredientIndex) {
  return `${recipeId}:${instructionIndex}:${ingredientIndex}`
}

export function componentKey(recipeId, instructionIndex, label) {
  return `${recipeId}:${instructionIndex}:${normalizeLabel(label)}`
}

export function countBy(values) {
  return Object.fromEntries([...values.reduce((counts, value) => {
    counts.set(value, (counts.get(value) || 0) + 1)
    return counts
  }, new Map())].sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0]))))
}

export function candidateMetrics(keys, truthKeys) {
  let truePositives = 0
  let falsePositives = 0
  for (const key of keys) {
    if (truthKeys.has(key)) truePositives += 1
    else falsePositives += 1
  }
  return metrics(truePositives, falsePositives, truthKeys.size)
}

export function voteSets(rows) {
  const reviewerA = new Set()
  const reviewerB = new Set()
  for (const row of rows) {
    for (const step of row.reviewA?.steps || []) {
      for (const ingredientIndex of step.expectedIngredientIndexes || []) {
        reviewerA.add(relationKey(row.recipeId, step.instructionIndex, ingredientIndex))
      }
    }
    for (const step of row.reviewB?.steps || []) {
      for (const ingredientIndex of step.expectedIngredientIndexes || []) {
        reviewerB.add(relationKey(row.recipeId, step.instructionIndex, ingredientIndex))
      }
    }
  }
  const union = new Set([...reviewerA, ...reviewerB])
  const intersection = new Set([...reviewerA].filter(key => reviewerB.has(key)))
  const single = new Set([...union].filter(key => !intersection.has(key)))
  return { reviewerA, reviewerB, union, intersection, single }
}

export function pearson(rows, leftKey, rightKey) {
  const usable = rows.filter(row => Number.isFinite(row[leftKey]) && Number.isFinite(row[rightKey]))
  if (usable.length < 2) return null
  const leftMean = usable.reduce((sum, row) => sum + row[leftKey], 0) / usable.length
  const rightMean = usable.reduce((sum, row) => sum + row[rightKey], 0) / usable.length
  let numerator = 0
  let leftSquare = 0
  let rightSquare = 0
  for (const row of usable) {
    const left = row[leftKey] - leftMean
    const right = row[rightKey] - rightMean
    numerator += left * right
    leftSquare += left * left
    rightSquare += right * right
  }
  return leftSquare === 0 || rightSquare === 0 ? null : numerator / Math.sqrt(leftSquare * rightSquare)
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}
