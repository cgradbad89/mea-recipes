import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildMappingProposal } from '../lib/cookingModeMappingProposal'

const root = process.cwd()
const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
const pragmatic = readJson('docs/audits/cooking-mode-pragmatic-automatic-quality-validation-2026-08-29.json')
const completeness = readJson('docs/audits/cooking-mode-completeness-audit-2026-08-26.json')
const artifact = readJson('docs/audits/cooking-mode-additive-practical-quality-validation-2026-08-29.json')

const relationshipKey = (value: { ingredientRowIndex: number; stepIndex: number }) =>
  `${value.ingredientRowIndex}:${value.stepIndex}`

const score = (actual: Set<string>, truth: Set<string>) => {
  const tp = [...actual].filter(value => truth.has(value)).length
  const fp = actual.size - tp
  const fn = [...truth].filter(value => !actual.has(value)).length
  const precision = tp + fp === 0 ? null : tp / (tp + fp)
  const recall = tp + fn === 0 ? null : tp / (tp + fn)
  const f1 = precision === null || recall === null || precision + recall === 0
    ? null
    : 2 * precision * recall / (precision + recall)
  return { tp, fp, fn, precision, recall, f1 }
}

describe('Cooking Mode additive practical-quality replay', () => {
  it('replays the exact held-out reviewers through the production proposal builder', async () => {
    const completenessById = new Map(completeness.recipes.map((recipe: any) => [recipe.recipeId, recipe]))
    const recipes: any[] = []

    for (const item of pragmatic.recipeResults) {
      const audited: any = completenessById.get(item.recipeId)
      const proposal = await buildMappingProposal({
        recipeId: item.recipeId,
        source: item.source,
        recipeRevision: item.recipeRevision,
        reviewerA: item.reviewerA,
        reviewerB: item.reviewerB,
        createdAt: '2026-08-29T00:00:00.000Z',
      })
      expect(proposal.summary).toMatchObject({
        candidateCount: item.currentPolicy.candidateCount,
        autoAcceptCount: item.currentPolicy.autoAcceptCount,
        reviewRequiredCount: item.currentPolicy.reviewRequiredCount,
      })

      const truthRelationships = audited.steps.flatMap((step: any) =>
        step.adjudicatedExpectedIndexes.map((ingredientRowIndex: number) => ({
          ingredientRowIndex,
          stepIndex: step.instructionIndex,
        })))
      const oldRelationships = audited.steps.flatMap((step: any) =>
        step.currentIngredientIndexes.map((ingredientRowIndex: number) => ({
          ingredientRowIndex,
          stepIndex: step.instructionIndex,
        })))
      const autoAcceptRelationships = proposal.candidates
        .filter(candidate => candidate.routingDecision === 'AUTO_ACCEPT')
        .map(candidate => ({
          ingredientRowIndex: candidate.ingredientRowIndex,
          stepIndex: candidate.stepIndex,
          risks: candidate.deterministicEvidence.risks,
        }))
      const truth = new Set<string>(truthRelationships.map(relationshipKey))
      const old = new Set<string>(oldRelationships.map(relationshipKey))
      const auto = new Set<string>(autoAcceptRelationships.map(relationshipKey))
      const additive = new Set<string>([...old, ...auto])
      const incremental = new Set<string>([...auto].filter(value => !old.has(value)))

      recipes.push({
        recipeId: item.recipeId,
        title: item.title,
        persistedEngine: audited.persistedEngine,
        sourceHash: audited.sourceHash,
        sharedSourceHash: audited.sharedSourceHash,
        truthRelationships,
        oldRelationships,
        autoAcceptRelationships,
        additiveRelationships: [...additive].map(value => {
          const [ingredientRowIndex, stepIndex] = value.split(':').map(Number)
          return { ingredientRowIndex, stepIndex }
        }),
        metrics: {
          old: score(old, truth),
          autoAccept: score(auto, truth),
          additive: score(additive, truth),
          incremental: score(incremental, new Set([...truth].filter(value => !old.has(value)))),
        },
      })
    }

    const aggregate = (field: 'oldRelationships' | 'autoAcceptRelationships' | 'additiveRelationships') => {
      let tp = 0
      let fp = 0
      let fn = 0
      for (const recipe of recipes) {
        const result = recipe.metrics[field === 'oldRelationships' ? 'old' : field === 'autoAcceptRelationships' ? 'autoAccept' : 'additive']
        tp += result.tp
        fp += result.fp
        fn += result.fn
      }
      const precision = tp / (tp + fp)
      const recall = tp / (tp + fn)
      return { tp, fp, fn, precision, recall, f1: 2 * precision * recall / (precision + recall) }
    }

    const severity = (relationshipField: 'oldRelationships' | 'additiveRelationships') => {
      const result: Record<string, { total: number; found: number; recall: number }> = {}
      for (const category of ['CRITICAL', 'HIGH', 'SEASONING_HERB']) {
        let total = 0
        let found = 0
        for (const recipe of recipes) {
          const audited: any = completenessById.get(recipe.recipeId)
          const actual = new Set(recipe[relationshipField].map(relationshipKey))
          for (const step of audited.steps) {
            for (const item of step.severity) {
              if ((category === 'SEASONING_HERB' ? item.kind : item.level) !== category) continue
              total += 1
              if (actual.has(`${item.ingredientIndex}:${step.instructionIndex}`)) found += 1
            }
          }
        }
        result[category] = { total, found, recall: found / total }
      }
      return result
    }
    const aggregateIncremental = recipes.reduce((result, recipe) => {
      result.added += recipe.additiveRelationships.length - recipe.oldRelationships.length
      result.tp += recipe.metrics.additive.tp - recipe.metrics.old.tp
      result.fp += recipe.metrics.additive.fp - recipe.metrics.old.fp
      return result
    }, { added: 0, tp: 0, fp: 0 })

    expect(aggregate('oldRelationships')).toEqual(artifact.strategyMetrics.existingV4V5)
    expect(aggregate('autoAcceptRelationships')).toEqual(artifact.strategyMetrics.autoAcceptOnly)
    expect(aggregate('additiveRelationships')).toEqual(artifact.strategyMetrics.additiveV4V5PlusAutoAccept)
    expect({
      relationshipsAdded: aggregateIncremental.added,
      truePositives: aggregateIncremental.tp,
      falsePositives: aggregateIncremental.fp,
      incrementalPrecision: aggregateIncremental.tp / aggregateIncremental.added,
    }).toEqual({
      relationshipsAdded: artifact.incrementalAutoAcceptQuality.relationshipsAdded,
      truePositives: artifact.incrementalAutoAcceptQuality.truePositives,
      falsePositives: artifact.incrementalAutoAcceptQuality.falsePositives,
      incrementalPrecision: artifact.incrementalAutoAcceptQuality.incrementalPrecision,
    })
    expect(severity('oldRelationships')).toEqual({
      CRITICAL: artifact.severityDiagnostics.existingV4V5.critical,
      HIGH: artifact.severityDiagnostics.existingV4V5.high,
      SEASONING_HERB: artifact.severityDiagnostics.existingV4V5.seasoningHerb,
    })
    expect(severity('additiveRelationships')).toEqual({
      CRITICAL: artifact.severityDiagnostics.additive.critical,
      HIGH: artifact.severityDiagnostics.additive.high,
      SEASONING_HERB: artifact.severityDiagnostics.additive.seasoningHerb,
    })

    for (const recipe of recipes) {
      const recorded = artifact.heldOutSample.recipes.find((item: any) => item.recipeId === recipe.recipeId)
      expect(recorded).toBeDefined()
      expect(recorded.truth).toEqual(recipe.truthRelationships.map(relationshipKey))
      expect(recorded.oldMap).toEqual(recipe.oldRelationships.map(relationshipKey))
      expect(recorded.autoAccept).toEqual(recipe.autoAcceptRelationships.map(relationshipKey))
      expect(recorded.additiveMap).toEqual(recipe.additiveRelationships.map(relationshipKey))
      expect(recipe.sourceHash).toBe(recipe.sharedSourceHash)
    }
  })
})
