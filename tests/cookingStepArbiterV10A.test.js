import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  candidateDecisionMetrics,
  createBatches,
  strategyMetrics,
  toModelCandidate,
  validateBatchResults,
} from '../scripts/analyze-cooking-step-arbiter-v10a-core.mjs'

const root = path.resolve(process.cwd())
const frozenPath = path.join(root, 'docs/audits/cooking-mode-arbiter-v10a-frozen-candidates-2026-08-28.json')
const frozen = JSON.parse(fs.readFileSync(frozenPath, 'utf8'))
const ingredients = frozen.populations.INGREDIENT_RELATIONSHIPS
const components = frozen.populations.PREPARED_COMPONENT_RELATIONSHIPS

describe('Cooking Step Arbiter V10A audit invariants', () => {
  it('reconstructs the exact frozen V9 candidate population and decisions', () => {
    expect(ingredients).toHaveLength(863)
    expect(components).toHaveLength(196)
    expect(frozen.exactPopulation.ingredientRelationships).toMatchObject({
      correctCandidates: 833,
      incorrectCandidates: 30,
      correctAccept: 721,
      correctReject: 108,
      incorrectAccept: 9,
      incorrectReject: 21,
      unavailable: 4,
    })
  })

  it('uses stable unique IDs for every candidate population', () => {
    const all = [...ingredients, ...components]
    expect(new Set(all.map(item => item.candidateId)).size).toBe(all.length)
    expect(all.every(item => item.candidateId.includes(item.recipeId))).toBe(true)
  })

  it('micro-batches by recipe and candidate type with a strict maximum', () => {
    const batches = createBatches([...ingredients, ...components], 15)
    expect(batches.every(batch => batch.candidateIds.length >= 1 && batch.candidateIds.length <= 15)).toBe(true)
    for (const batch of batches) {
      const values = batch.candidateIds.map(id => [...ingredients, ...components].find(item => item.candidateId === id))
      expect(new Set(values.map(item => item.recipeId)).size).toBe(1)
      expect(new Set(values.map(item => item.candidateType)).size).toBe(1)
    }
  })

  it('never sends adjudicated truth or historical decisions to the arbiter', () => {
    const modelCandidate = toModelCandidate(ingredients[0])
    expect(modelCandidate).not.toHaveProperty('adjudicatedTruth')
    expect(modelCandidate).not.toHaveProperty('v9Arbiter')
    expect(modelCandidate).not.toHaveProperty('historicalRegressionOrigins')
  })

  it('requires exactly one structurally valid result per candidate ID', () => {
    const ids = ['a', 'b']
    const valid = { results: ids.map(candidateId => ({ candidateId, decision: 'ACCEPT', basis: 'OTHER', evidenceText: 'source' })) }
    expect(validateBatchResults(ids, valid)).toHaveLength(2)
    expect(() => validateBatchResults(ids, { results: [valid.results[0]] })).toThrow(/count mismatch/)
    expect(() => validateBatchResults(ids, { results: [valid.results[0], valid.results[0]] })).toThrow(/duplicate/)
  })

  it('computes vote strategies and candidate arbitration independently', () => {
    const sample = [
      { candidateId: 'a', origins: ['REVIEWER_A', 'REVIEWER_B'], adjudicatedTruth: 'CORRECT' },
      { candidateId: 'b', origins: ['REVIEWER_A'], adjudicatedTruth: 'CORRECT' },
      { candidateId: 'c', origins: ['REVIEWER_A', 'REVIEWER_B'], adjudicatedTruth: 'INCORRECT' },
      { candidateId: 'd', origins: ['DETERMINISTIC'], adjudicatedTruth: 'INCORRECT' },
    ]
    const decisions = new Map([
      ['a', { decision: 'ACCEPT' }], ['b', { decision: 'ACCEPT' }],
      ['c', { decision: 'REJECT' }], ['d', { decision: 'REJECT' }],
    ])
    expect(strategyMetrics(sample, 'REVIEWER_UNION', decisions)).toMatchObject({ truePositives: 2, falsePositives: 1 })
    expect(strategyMetrics(sample, 'DISAGREEMENT_ONLY', decisions)).toMatchObject({ truePositives: 2, falsePositives: 1, aiCandidateCount: 2 })
    expect(candidateDecisionMetrics(sample, decisions)).toMatchObject({ correctAccept: 2, incorrectReject: 2, unavailable: 0 })
  })

  it('keeps component metrics independent from ingredient metrics', () => {
    const componentMetrics = candidateDecisionMetrics(components, new Map(components.map(item => [item.candidateId, item.v9Arbiter])))
    expect(componentMetrics).toMatchObject({ population: 196, correctCandidates: 75, incorrectCandidates: 121 })
  })

  it('contains no Firestore or production write path', () => {
    const sources = [
      'scripts/analyze-cooking-step-arbiter-v10a-core.mjs',
      'scripts/analyze-cooking-step-arbiter-v10a.mjs',
      'scripts/run-cooking-step-arbiter-v10a.mjs',
    ].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n')
    expect(sources).not.toMatch(/firebase-admin|\.firestore\(|collection\(['"]recipes|writeBatch\(|setDoc\(|updateDoc\(|deleteDoc\(/)
  })
})
