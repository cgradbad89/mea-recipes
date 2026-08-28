import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  candidateMetrics,
  componentKey,
  metrics,
  relationKey,
  voteSets,
} from '../scripts/analyze-cooking-mode-recall-root-cause-core.mjs'

describe('cooking-mode recall root-cause diagnostic math', () => {
  it('reconstructs reviewer union, intersection, and singleton votes exactly', () => {
    const rows = [{
      recipeId: 'r',
      reviewA: { steps: [{ instructionIndex: 0, expectedIngredientIndexes: [0, 1] }] },
      reviewB: { steps: [{ instructionIndex: 0, expectedIngredientIndexes: [1, 2] }] },
    }]
    const votes = voteSets(rows)
    expect([...votes.union]).toEqual(['r:0:0', 'r:0:1', 'r:0:2'])
    expect([...votes.intersection]).toEqual(['r:0:1'])
    expect([...votes.single]).toEqual(['r:0:0', 'r:0:2'])
  })

  it('calculates TP, FP, FN, precision, recall, and F1', () => {
    const result = candidateMetrics(new Set(['a', 'b', 'x']), new Set(['a', 'b', 'c', 'd']))
    expect(result).toMatchObject({
      truePositives: 2,
      falsePositives: 1,
      falseNegatives: 2,
      precision: 2 / 3,
      recall: 1 / 2,
    })
    expect(result.f1).toBeCloseTo(4 / 7)
    expect(metrics(0, 0, 0).precision).toBeNull()
  })

  it('builds stable ingredient and normalized component keys', () => {
    expect(relationKey('recipe', 2, 7)).toBe('recipe:2:7')
    expect(componentKey('recipe', 2, '  Green   Sauce ')).toBe('recipe:2:green sauce')
  })

  it('contains no production-write integration', async () => {
    const source = await import('node:fs/promises').then(fs => fs.readFile(
      new URL('../scripts/analyze-cooking-mode-recall-root-cause.mjs', import.meta.url),
      'utf8',
    ))
    expect(source).not.toContain('firebase-admin')
    expect(source).not.toContain('getAdmin')
    expect(source).not.toMatch(/\.collection\s*\(/)
  })

  it('freezes the exact focused population and reconstructs all root-cause counts', () => {
    const artifact = JSON.parse(fs.readFileSync(path.join(
      process.cwd(),
      'docs/audits/cooking-mode-recall-root-cause-analysis-2026-08-28.json',
    ), 'utf8'))
    expect(artifact.focusBenchmarkIntegrity).toMatchObject({
      recipeCount: 36,
      expectedAssociationCount: 868,
      sourceHashMatches: 36,
      sourceHashMismatches: [],
    })
    expect(new Set(artifact.diagnosticTruthTable.map((item: { key: string }) => item.key)).size).toBe(868)
    expect(artifact.reviewerMisses.rows).toHaveLength(35)
    expect(artifact.arbiterFalseRejects.rows).toHaveLength(108)
    expect(artifact.arbiterFalseAccepts.rows).toHaveLength(9)
    expect(artifact.hardSafetyFalseRejects.rows).toHaveLength(65)
  })

  it('freezes vote, ablation, and component metrics', () => {
    const artifact = JSON.parse(fs.readFileSync(path.join(
      process.cwd(),
      'docs/audits/cooking-mode-recall-root-cause-analysis-2026-08-28.json',
    ), 'utf8'))
    expect(artifact.layerAblations.reviewerUnion).toMatchObject({
      truePositives: 833, falsePositives: 28, falseNegatives: 35,
    })
    expect(artifact.layerAblations.reviewerUnionPlusArbiter).toMatchObject({
      truePositives: 722, falsePositives: 9, falseNegatives: 146,
    })
    expect(artifact.layerAblations.reviewerUnionPlusArbiterPlusHardSafety).toMatchObject({
      truePositives: 657, falsePositives: 9, falseNegatives: 211,
    })
    expect(artifact.reviewerVoteAnalysis.twoOfTwo).toMatchObject({
      truePositives: 763, falsePositives: 9,
    })
    expect(artifact.componentAnalysis).toMatchObject({ expectedCount: 165 })
    expect(artifact.componentAnalysis.metrics.safety).toMatchObject({
      truePositives: 52, falsePositives: 16, falseNegatives: 113,
    })
    expect(artifact.componentAnalysis.rows).toHaveLength(165)
    expect(artifact.componentAnalysis.falseProposals).toHaveLength(16)
  })
})
