import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { evaluateActiveObjectRescue } from '../scripts/analyze-cooking-mode-v10f-lite-active-object-core.mjs'

const root = path.resolve(process.cwd())
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
const date = '2026-08-28'

const CORE_PATH = path.join(root, 'scripts/analyze-cooking-mode-v10f-lite-active-object-core.mjs')
const sha256 = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')

const v10a = readJson(`docs/audits/cooking-mode-arbiter-v10a-frozen-candidates-${date}.json`)
const v10d = readJson(`docs/audits/cooking-mode-v10d-principal-target-analysis-${date}.json`)
const v10e = readJson(`docs/audits/cooking-mode-v10e-remaining-fn-taxonomy-${date}.json`)
const v10g = readJson(`docs/audits/cooking-mode-v10g-active-object-full-frozen-validation-${date}.json`)

const ingredientCandidates = v10a.populations.INGREDIENT_RELATIONSHIPS
const preparedComponentCandidates = v10a.populations.PREPARED_COMPONENT_RELATIONSHIPS
const byId = new Map(ingredientCandidates.map((c) => [c.candidateId, c]))

const correctIds = new Set(ingredientCandidates.filter((c) => c.adjudicatedTruth === 'CORRECT').map((c) => c.candidateId))
const incorrectIds = new Set(ingredientCandidates.filter((c) => c.adjudicatedTruth === 'INCORRECT').map((c) => c.candidateId))
const fnIds = new Set(v10d.finalErrors.falseRejects.map((f) => f.candidateId))
const baselineRejectSet = new Set([...fnIds, ...incorrectIds])
const baselineAcceptSet = new Set(ingredientCandidates.map((c) => c.candidateId).filter((id) => !baselineRejectSet.has(id)))

/** Independent reconstruction of each recipe's instruction chronology from the same frozen
 *  artifact text fragments the V10G driver uses — duplicated here (not imported from the
 *  driver) so this test verifies the driver's headline numbers rather than trusting them. */
function buildInstructionMaps() {
  const perRecipe = new Map()
  const put = (recipeId, index, text) => {
    if (recipeId == null || index == null || text == null) return
    if (!perRecipe.has(recipeId)) perRecipe.set(recipeId, new Map())
    const m = perRecipe.get(recipeId)
    if (!m.has(index)) m.set(index, text)
  }
  for (const list of [ingredientCandidates, preparedComponentCandidates, v10e.candidates]) {
    for (const c of list) {
      const rid = c.recipeId
      if (rid == null) continue
      if (c.instructionIndex != null) {
        put(rid, c.instructionIndex, c.instructionText)
        if (c.previousInstructionText) put(rid, c.instructionIndex - 1, c.previousInstructionText)
        if (c.nextInstructionText) put(rid, c.instructionIndex + 1, c.nextInstructionText)
      }
      const prior = c.relevantSurroundingSource?.priorCandidateInstructions
      if (Array.isArray(prior)) for (const p of prior) put(rid, p.instructionIndex, p.text)
    }
  }
  const result = new Map()
  for (const [rid, m] of perRecipe.entries()) result.set(rid, { instructions: Array.from(m.entries()).map(([index, text]) => ({ index, text })) })
  return result
}
const instructionMaps = buildInstructionMaps()
const contextFor = (recipeId) => instructionMaps.get(recipeId) || { instructions: [] }

function rescueDecision(candidateId) {
  const c = byId.get(candidateId)
  if (!c) return null
  return evaluateActiveObjectRescue(
    { candidateId: c.candidateId, ingredientText: c.ingredientText, instructionText: c.instructionText, instructionIndex: c.instructionIndex },
    contextFor(c.recipeId),
  ).rescue
}

describe('V10G — locked core checkpoint', () => {
  it('the V10F-Lite core module is byte-identical before and after the full-frozen run', () => {
    expect(v10g.lockedCore.sha256Before).toEqual(v10g.lockedCore.sha256After)
    expect(v10g.lockedCore.byteIdentical).toBe(true)
    expect(sha256(CORE_PATH)).toEqual(v10g.lockedCore.sha256After)
  })
})

describe('V10G — exact frozen population reconciliation', () => {
  it('the ingredient-relationship population matches the historical 863/833/30 split', () => {
    expect(ingredientCandidates.length).toBe(863)
    expect(correctIds.size).toBe(833)
    expect(incorrectIds.size).toBe(30)
    expect(v10g.populationReconciliation.matchesHistorical).toBe(true)
  })
})

describe('V10G — exact V10D baseline reproduction', () => {
  it('reconstructing ACCEPT/REJECT purely from V10D\'s own finalErrors.falseRejects + adjudicatedTruth reproduces TP=642/FP=0/FN=191', () => {
    const tp = [...baselineAcceptSet].filter((id) => correctIds.has(id)).length
    const fp = [...baselineAcceptSet].filter((id) => incorrectIds.has(id)).length
    const fn = fnIds.size
    expect(tp).toBe(642)
    expect(fp).toBe(0)
    expect(fn).toBe(191)
    expect(v10d.finalMetrics.truePositives).toBe(642)
    expect(v10d.finalMetrics.falsePositives).toBe(0)
    expect(v10d.finalMetrics.falseNegatives).toBe(191)
  })

  it('the V10G artifact records an exact historical match', () => {
    expect(v10g.baselineReproduction.exactHistoricalMatch).toBe(true)
    expect(v10g.gate.v10dBaselineReproducedExactly).toBe(true)
  })
})

describe('V10G — rescue-only semantics', () => {
  it('every V10D baseline ACCEPT is preserved as ACCEPT (rescue-only never rejects an accept)', () => {
    const rescuedIds = new Set(v10g.rescue.results.map((r) => r.candidateId))
    for (const id of baselineAcceptSet) {
      expect(rescuedIds.has(id)).toBe(false) // baseline accepts are never re-evaluated by the rescue pass
    }
  })

  it('the driver only evaluated rescue for baseline REJECTs (191 FN + 30 incorrect = 221)', () => {
    expect(v10g.rescue.candidatesEvaluated).toBe(baselineRejectSet.size)
    expect(baselineRejectSet.size).toBe(221)
  })
})

describe('V10G — candidate metrics reconciliation', () => {
  it('final TP/FP/FN reconciles: finalTP = baselineTP + rescueTP, finalFP = baselineFP + rescueFP', () => {
    const rescuedTp = v10g.rescue.results.filter((r) => r.rescue && r.truth === 'CORRECT').length
    const rescuedFp = v10g.rescue.results.filter((r) => r.rescue && r.truth === 'INCORRECT').length
    expect(v10g.finalMetrics.truePositives).toBe(642 + rescuedTp)
    expect(v10g.finalMetrics.falsePositives).toBe(0 + rescuedFp)
    expect(v10g.finalMetrics.falseNegatives).toBe(833 - v10g.finalMetrics.truePositives)
  })

  it('independently recomputes the same rescue decision for a sample of baseline-REJECT candidates', () => {
    const sample = v10g.rescue.results.slice(0, 25)
    for (const r of sample) {
      expect(rescueDecision(r.candidateId)).toBe(r.rescue)
    }
  })
})

describe('V10G — semantic-class count reconciliation', () => {
  it('the ten required V10E classes sum to exactly 191 and match the V10E countByClass', () => {
    const total = v10g.semanticClassRecovery.reduce((sum, c) => sum + c.eligible, 0)
    expect(total).toBe(191)
    for (const c of v10g.semanticClassRecovery) {
      const v10eEntry = v10e.countByClass.find((x) => x.semanticClass === c.semanticClass)
      expect(v10eEntry).toBeTruthy()
      expect(c.eligible).toBe(v10eEntry.fnCount)
    }
  })

  it('DISH_STATE_CONTINUATION and PRONOUN_OR_DEICTIC_REFERENCE recovery match rescued/eligible exactly', () => {
    for (const className of ['DISH_STATE_CONTINUATION', 'PRONOUN_OR_DEICTIC_REFERENCE']) {
      const c = v10g.semanticClassRecovery.find((x) => x.semanticClass === className)
      expect(c.rescued + c.missed).toBe(c.eligible)
      expect(c.recoveryPct).toBeCloseTo((c.rescued / c.eligible) * 100, 1)
    }
  })
})

describe('V10G — 20 target-FP protection', () => {
  it('protects all 20 locked V10A target false positives (rescue never fires on them)', () => {
    const rows = v10d.targetFalsePositiveOutcomes
    expect(rows).toHaveLength(20)
    for (const c of rows) {
      expect(rescueDecision(c.candidateId)).toBe(false)
    }
    expect(v10g.targetFalsePositiveProtection.summary).toEqual({ total: 20, rejected: 20, accepted: 0 })
    expect(v10g.gate.allTargetFpRejected).toBe(true)
  })
})

describe('V10G — 9 quantity regressions', () => {
  it('all 9 quantity-regression candidates are baseline ACCEPT and remain repaired', () => {
    const rows = v10d.quantityRegressionOutcomes
    expect(rows).toHaveLength(9)
    for (const c of rows) {
      expect(baselineAcceptSet.has(c.candidateId)).toBe(true)
    }
    expect(v10g.quantityRegressionProtection.summary).toEqual({ total: 9, stillRepaired: 9 })
    expect(v10g.gate.allQuantityRegressionsRepaired).toBe(true)
  })
})

describe('V10G — historical locked cases', () => {
  it('reports 12 locked-truth cases with V10D baseline protection of 4/12', () => {
    expect(v10g.historicalLockedTruthProtection.outcomes).toHaveLength(12)
    expect(v10g.historicalLockedTruthProtection.summary.baselineProtected).toBe(4)
  })

  it('never claims a case is protected without either verifying it or leaving it explicitly unverifiable', () => {
    for (const o of v10g.historicalLockedTruthProtection.outcomes) {
      if (o.baselineProtected) {
        expect(o.verifiable === true || o.verifiable === false).toBe(true)
        if (!o.verifiable) expect(o.stillProtected).toBeNull()
      }
    }
  })
})

describe('V10G — zero production writes / zero AI calls / no production mapper integration', () => {
  it('reports zero AI calls and zero production mutations', () => {
    expect(v10g.aiUsage.aiCalls).toBe(0)
    expect(v10g.productionMutations).toEqual({ firestoreWrites: 0, recipeWrites: 0, mapWrites: 0, productionCodeChanges: 0 })
  })

  it('the driver script and core module never import Firestore or a production write path', () => {
    const driverSource = fs.readFileSync(path.join(root, 'scripts/analyze-cooking-mode-v10g-active-object-full-frozen.mjs'), 'utf8')
    const coreSource = fs.readFileSync(CORE_PATH, 'utf8')
    for (const source of [driverSource, coreSource]) {
      expect(source).not.toMatch(/firebase-admin|getFirestore|\.doc\(|\.collection\(|updateDoc|setDoc/)
    }
  })

  it('the core module is not imported by any production app/lib path', () => {
    const productionRoots = ['app', 'lib', 'components', 'hooks']
    for (const dir of productionRoots) {
      const full = path.join(root, dir)
      if (!fs.existsSync(full)) continue
      const files = fs.readdirSync(full, { recursive: true }).filter((f) => typeof f === 'string' && /\.(ts|tsx|js|mjs)$/.test(f))
      for (const f of files) {
        const contents = fs.readFileSync(path.join(full, f), 'utf8')
        expect(contents).not.toMatch(/analyze-cooking-mode-v10f-lite-active-object|analyze-cooking-mode-v10g-active-object/)
      }
    }
  })
})

describe('V10G — full-frozen gate and architecture recommendation are consistent', () => {
  it('verdict PASS iff every gate criterion is true, and the architecture recommendation matches', () => {
    const allPass = Object.values(v10g.gate).every(Boolean)
    if (allPass) {
      expect(v10g.verdict).toBe('PASS — ACTIVE-OBJECT RESCUE VALIDATED ON FULL FROZEN BENCHMARK')
      expect(v10g.architectureRecommendation).toBe('PROCEED TO COMBINED FROZEN-PIPELINE DESIGN')
    } else {
      expect(v10g.verdict).toBe('FAIL — ACTIVE-OBJECT RESCUE DOES NOT GENERALIZE')
      expect(v10g.architectureRecommendation).toBe('STOP ACTIVE-OBJECT DETERMINISTIC REFINEMENT — REASSESS AI-AT-INGESTION ARCHITECTURE')
    }
  })

  it('ratatouille policy holds: initial explicit salt/pepper use maps, later generic seasoning does not reactivate it', () => {
    expect(v10g.ratatouillePolicy.pass).toBe(true)
    for (const row of v10g.ratatouillePolicy.initialExplicitUse) expect(row.finalDecision).toBe('ACCEPT')
    for (const row of v10g.ratatouillePolicy.laterGenericSeasoning) expect(row.finalDecision).toBe('REJECT')
  })

  it('complexity stays frozen: 6 rules, 0 recipe-specific exceptions, 0 AI calls, 0 production integration', () => {
    expect(v10g.complexity).toEqual({ semanticRuleCountUnchanged: true, ruleCount: 6, recipeSpecificExceptions: 0, aiCalls: 0, productionIntegration: 0 })
  })
})
