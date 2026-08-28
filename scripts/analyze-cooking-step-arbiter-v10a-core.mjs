import { createHash } from 'node:crypto'

export const ARBITER_BATCH_MAX = 15

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function ingredientCandidateId(recipeId, instructionIndex, ingredientIndex) {
  return `ingredient::${recipeId}::${instructionIndex}::${ingredientIndex}`
}

export function componentCandidateId(recipeId, instructionIndex, label) {
  return `component::${recipeId}::${instructionIndex}::${normalizeText(label)}`
}

export function relationKey(recipeId, instructionIndex, ingredientIndex) {
  return `${recipeId}:${instructionIndex}:${ingredientIndex}`
}

export function componentKey(recipeId, instructionIndex, label) {
  return `${recipeId}:${instructionIndex}:${normalizeText(label)}`
}

export function expandOrigins(origins = []) {
  const expanded = new Set()
  if (origins.includes('DETERMINISTIC')) expanded.add('DETERMINISTIC')
  if (origins.includes('BOTH_REVIEWERS') || origins.includes('A_ONLY')) expanded.add('REVIEWER_A')
  if (origins.includes('BOTH_REVIEWERS') || origins.includes('B_ONLY')) expanded.add('REVIEWER_B')
  return [...expanded]
}

export function provenanceClass(origins) {
  const reviewerCount = Number(origins.includes('REVIEWER_A')) + Number(origins.includes('REVIEWER_B'))
  if (reviewerCount === 2) return '2_OF_2_REVIEWERS'
  if (reviewerCount === 1) return '1_OF_2_REVIEWERS'
  return 'DETERMINISTIC_ONLY'
}

export function metrics(truePositives, falsePositives, expected) {
  const falseNegatives = expected - truePositives
  const precision = truePositives + falsePositives === 0 ? null : truePositives / (truePositives + falsePositives)
  const recall = expected === 0 ? null : truePositives / expected
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

export function candidateDecisionMetrics(candidates, decisions, selector = () => true) {
  const selected = candidates.filter(selector)
  const correctCandidates = selected.filter(candidate => candidate.adjudicatedTruth === 'CORRECT').length
  const incorrectCandidates = selected.length - correctCandidates
  let correctAccept = 0
  let correctReject = 0
  let incorrectAccept = 0
  let incorrectReject = 0
  let unavailable = 0
  for (const candidate of selected) {
    const decision = decisions.get(candidate.candidateId)
    if (!decision || !['ACCEPT', 'REJECT'].includes(decision.decision)) {
      unavailable += 1
      continue
    }
    if (candidate.adjudicatedTruth === 'CORRECT' && decision.decision === 'ACCEPT') correctAccept += 1
    if (candidate.adjudicatedTruth === 'CORRECT' && decision.decision === 'REJECT') correctReject += 1
    if (candidate.adjudicatedTruth === 'INCORRECT' && decision.decision === 'ACCEPT') incorrectAccept += 1
    if (candidate.adjudicatedTruth === 'INCORRECT' && decision.decision === 'REJECT') incorrectReject += 1
  }
  return {
    population: selected.length,
    correctCandidates,
    incorrectCandidates,
    correctAccept,
    correctReject,
    incorrectAccept,
    incorrectReject,
    unavailable,
    correctCandidateAcceptanceRate: correctCandidates ? correctAccept / correctCandidates : null,
    incorrectCandidateAcceptanceRate: incorrectCandidates ? incorrectAccept / incorrectCandidates : null,
    precision: correctAccept + incorrectAccept ? correctAccept / (correctAccept + incorrectAccept) : null,
  }
}

export function strategyMetrics(candidates, strategy, arbiterDecisions = new Map()) {
  const accepted = new Set()
  let aiCandidateCount = 0
  for (const candidate of candidates) {
    const provenance = provenanceClass(candidate.origins)
    if (strategy === 'REVIEWER_UNION') {
      if (provenance !== 'DETERMINISTIC_ONLY') accepted.add(candidate.candidateId)
    } else if (strategy === 'REVIEWER_INTERSECTION') {
      if (provenance === '2_OF_2_REVIEWERS') accepted.add(candidate.candidateId)
    } else if (strategy === 'DISAGREEMENT_ONLY') {
      if (provenance === '2_OF_2_REVIEWERS') accepted.add(candidate.candidateId)
      else {
        aiCandidateCount += 1
        if (arbiterDecisions.get(candidate.candidateId)?.decision === 'ACCEPT') accepted.add(candidate.candidateId)
      }
    } else if (strategy === 'ARBITRATE_EVERYTHING') {
      aiCandidateCount += 1
      if (arbiterDecisions.get(candidate.candidateId)?.decision === 'ACCEPT') accepted.add(candidate.candidateId)
    } else {
      throw new Error(`Unknown strategy: ${strategy}`)
    }
  }
  const correctTotal = candidates.filter(item => item.adjudicatedTruth === 'CORRECT').length
  const tp = candidates.filter(item => item.adjudicatedTruth === 'CORRECT' && accepted.has(item.candidateId)).length
  const fp = candidates.filter(item => item.adjudicatedTruth === 'INCORRECT' && accepted.has(item.candidateId)).length
  return { ...metrics(tp, fp, correctTotal), accepted: accepted.size, aiCandidateCount }
}

export function createBatches(candidates, maxSize = ARBITER_BATCH_MAX) {
  if (!Number.isInteger(maxSize) || maxSize < 1 || maxSize > 20) throw new Error('batch size must be 1..20')
  const grouped = new Map()
  for (const candidate of candidates) {
    const key = `${candidate.recipeId}::${candidate.candidateType}`
    const values = grouped.get(key) || []
    values.push(candidate)
    grouped.set(key, values)
  }
  const batches = []
  for (const [key, values] of grouped) {
    for (let offset = 0; offset < values.length; offset += maxSize) {
      const slice = values.slice(offset, offset + maxSize)
      batches.push({
        batchId: `${key}::${String(offset / maxSize).padStart(3, '0')}`,
        recipeId: slice[0].recipeId,
        candidateType: slice[0].candidateType,
        candidateIds: slice.map(item => item.candidateId),
      })
    }
  }
  return batches
}

export function validateBatchResults(candidateIds, value) {
  if (!value || !Array.isArray(value.results)) throw new Error('arbiter response must contain a results array')
  if (value.results.length !== candidateIds.length) throw new Error('arbiter response result count mismatch')
  const expected = new Set(candidateIds)
  const seen = new Set()
  for (const result of value.results) {
    if (!expected.has(result.candidateId)) throw new Error(`unexpected candidateId: ${result.candidateId}`)
    if (seen.has(result.candidateId)) throw new Error(`duplicate candidateId: ${result.candidateId}`)
    seen.add(result.candidateId)
  }
  return value.results
}

export function toModelCandidate(candidate) {
  const {
    adjudicatedTruth: _truth,
    v9Arbiter: _v9Arbiter,
    historicalRegressionOrigins: _historicalRegressionOrigins,
    ...safe
  } = candidate
  return safe
}

export function countBy(values) {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1)
  return Object.fromEntries([...counts].sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0]))))
}
