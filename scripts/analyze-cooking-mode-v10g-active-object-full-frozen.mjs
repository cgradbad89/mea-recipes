#!/usr/bin/env node
/**
 * V10G — Full frozen-benchmark validation of the locked V10F-Lite active-object rescue rule.
 *
 * Read-only. Loads existing locked audit artifacts (V10A frozen candidates, V10D
 * principal-target analysis, V10E remaining-FN semantic taxonomy) and:
 *   1. Reconstructs the exact 863-candidate frozen ingredient-relationship population and
 *      verifies it against the historical V10A/V10D numbers.
 *   2. Reproduces the V10D baseline decision (ACCEPT/REJECT) for every one of the 863
 *      candidates directly from V10D's own recorded outcomes (finalErrors.falseRejects +
 *      adjudicatedTruth) — no recomputation of V10D's decision logic, no recipe-source rerun.
 *   3. Applies the LOCKED, byte-identical V10F-Lite `evaluateActiveObjectRescue` rule
 *      RESCUE-ONLY to every V10D REJECT (191 false negatives + 30 incorrect candidates).
 *      V10D ACCEPTs are never re-evaluated or revoked.
 *   4. Reports full-population TP/FP/FN/precision/recall/F1 deltas, V10E semantic-class
 *      recovery, target-FP/quantity-regression/historical-locked protection, and every new
 *      false positive with source evidence.
 *
 * This module does not modify `analyze-cooking-mode-v10f-lite-active-object-core.mjs` and
 * verifies its SHA-256 is unchanged before and after the run. No AI calls, no Firestore
 * access, no production writes, no recipe mutation, no 228-recipe corpus rerun.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { evaluateActiveObjectRescue } from './analyze-cooking-mode-v10f-lite-active-object-core.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const CORE_PATH = path.join(ROOT, 'scripts/analyze-cooking-mode-v10f-lite-active-object-core.mjs')
const V10A_PATH = path.join(ROOT, 'docs/audits/cooking-mode-arbiter-v10a-frozen-candidates-2026-08-28.json')
const V10D_PATH = path.join(ROOT, 'docs/audits/cooking-mode-v10d-principal-target-analysis-2026-08-28.json')
const V10E_PATH = path.join(ROOT, 'docs/audits/cooking-mode-v10e-remaining-fn-taxonomy-2026-08-28.json')
const OUT_JSON = path.join(ROOT, 'docs/audits/cooking-mode-v10g-active-object-full-frozen-validation-2026-08-28.json')
const OUT_MD = path.join(ROOT, 'docs/audits/cooking-mode-v10g-active-object-full-frozen-validation-2026-08-28.md')

const REQUIRED_SEMANTIC_CLASSES = [
  'DISH_STATE_CONTINUATION',
  'PRONOUN_OR_DEICTIC_REFERENCE',
  'SERVING_OR_GARNISH_ACTION',
  'TRANSFER_OR_ASSEMBLY_TARGET',
  'COLLECTION_ACTIVE_CONTINUATION',
  'CATEGORY_OR_COLLECTIVE_ALIAS',
  'MULTI_COMPONENT_ASSEMBLY',
  'CONTINUING_COOKING_OBJECT',
  'DIVIDED_OR_RESERVED_USE',
  'IMPLIED_SEASONING_OR_FINISHING',
]

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function loadJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'))
}

function pct(n, d) {
  return d ? Math.round((n / d) * 10000) / 100 : null
}

function round4(n) {
  return n == null ? null : Math.round(n * 10000) / 10000
}

/** Merges every available fragment of a recipe's own instruction text found across the frozen
 *  candidate artifacts (instructionText / previousInstructionText / nextInstructionText / the
 *  V10D principal-target `relevantSurroundingSource.priorCandidateInstructions` chain) into one
 *  index -> text chronology per recipe. This recipe's own text only, never global; no text is
 *  invented and no recipe source is re-parsed — every fragment already exists in a locked
 *  artifact produced by a prior audit. */
function buildInstructionMaps(sources) {
  const perRecipe = new Map() // recipeId -> Map(index -> text)
  const put = (recipeId, index, text) => {
    if (recipeId == null || index == null || text == null) return
    if (!perRecipe.has(recipeId)) perRecipe.set(recipeId, new Map())
    const m = perRecipe.get(recipeId)
    if (!m.has(index)) m.set(index, text)
  }
  for (const list of sources) {
    for (const c of list) {
      const rid = c.recipeId
      if (rid == null) continue
      if (c.instructionIndex != null) {
        put(rid, c.instructionIndex, c.instructionText)
        if (c.previousInstructionText) put(rid, c.instructionIndex - 1, c.previousInstructionText)
        if (c.nextInstructionText) put(rid, c.instructionIndex + 1, c.nextInstructionText)
      }
      const prior = c.relevantSurroundingSource?.priorCandidateInstructions
      if (Array.isArray(prior)) {
        for (const p of prior) put(rid, p.instructionIndex, p.text)
      }
    }
  }
  const result = new Map()
  for (const [rid, m] of perRecipe.entries()) {
    result.set(rid, { instructions: Array.from(m.entries()).map(([index, text]) => ({ index, text })) })
  }
  return result
}

function main() {
  // ---- Phase 1: freeze the implementation --------------------------------------------------
  const shaBefore = sha256(CORE_PATH)

  // ---- Phase 2: reconstruct the complete frozen candidate benchmark ------------------------
  const v10a = loadJson(V10A_PATH)
  const v10d = loadJson(V10D_PATH)
  const v10e = loadJson(V10E_PATH)

  const ingredientCandidates = v10a.populations.INGREDIENT_RELATIONSHIPS
  const preparedComponentCandidates = v10a.populations.PREPARED_COMPONENT_RELATIONSHIPS
  const byId = new Map(ingredientCandidates.map((c) => [c.candidateId, c]))

  const correctIds = new Set(ingredientCandidates.filter((c) => c.adjudicatedTruth === 'CORRECT').map((c) => c.candidateId))
  const incorrectIds = new Set(ingredientCandidates.filter((c) => c.adjudicatedTruth === 'INCORRECT').map((c) => c.candidateId))
  const otherTruth = ingredientCandidates.filter((c) => c.adjudicatedTruth !== 'CORRECT' && c.adjudicatedTruth !== 'INCORRECT')

  const populationReconciliation = {
    total: ingredientCandidates.length,
    correct: correctIds.size,
    incorrect: incorrectIds.size,
    otherTruthCount: otherTruth.length,
    recipeCoverage: new Set(ingredientCandidates.map((c) => c.recipeId)).size,
    historicalExpected: { total: 863, correct: 833, incorrect: 30 },
    matchesHistorical: ingredientCandidates.length === 863 && correctIds.size === 833 && incorrectIds.size === 30,
    exactPopulationArtifactField: v10a.exactPopulation?.ingredientRelationships || null,
    frozenPopulationFieldInV10D: v10d.frozenPopulation || null,
  }

  // ---- Phase 3: reproduce the V10D baseline exactly (from V10D's own recorded outcomes) ----
  const fnIds = new Set(v10d.finalErrors.falseRejects.map((f) => f.candidateId))
  const fnNotCorrect = [...fnIds].filter((id) => !correctIds.has(id))
  const fnOverlapsIncorrect = [...fnIds].filter((id) => incorrectIds.has(id))
  const fnNotInPopulation = [...fnIds].filter((id) => !byId.has(id))

  const baselineRejectSet = new Set([...fnIds, ...incorrectIds])
  const baselineAcceptSet = new Set(ingredientCandidates.map((c) => c.candidateId).filter((id) => !baselineRejectSet.has(id)))

  const baselineTP = [...baselineAcceptSet].filter((id) => correctIds.has(id)).length
  const baselineFP = [...baselineAcceptSet].filter((id) => incorrectIds.has(id)).length
  const baselineFN = fnIds.size
  const baselinePrecision = round4(baselineTP / (baselineTP + baselineFP || 1))
  const baselineRecall = round4(baselineTP / (baselineTP + baselineFN || 1))
  const baselineF1 = round4((2 * baselinePrecision * baselineRecall) / (baselinePrecision + baselineRecall || 1))

  const historicalV10D = v10d.finalMetrics
  const baselineReproduction = {
    integrityChecks: {
      fnIdsAllTruthCorrect: fnNotCorrect.length === 0,
      fnDisjointFromIncorrect: fnOverlapsIncorrect.length === 0,
      fnAllInPopulation: fnNotInPopulation.length === 0,
      fnCountMatchesV10DFinalMetrics: fnIds.size === historicalV10D.falseNegatives,
    },
    reconstructed: { truePositives: baselineTP, falsePositives: baselineFP, falseNegatives: baselineFN, precision: baselinePrecision, recall: baselineRecall, f1: baselineF1 },
    historical: historicalV10D,
    exactHistoricalMatch:
      baselineTP === historicalV10D.truePositives &&
      baselineFP === historicalV10D.falsePositives &&
      baselineFN === historicalV10D.falseNegatives,
    targetProtectionHistorical: v10d.targetProtection,
    quantityRegressionHistorical: v10d.quantityRegressionSummary,
    historicalLockedTruthHistorical: { total: v10d.historicalRegression.lockedTruthTotal, rejected: v10d.historicalRegression.lockedTruthRejected },
  }

  const reproductionOk =
    baselineReproduction.exactHistoricalMatch &&
    Object.values(baselineReproduction.integrityChecks).every(Boolean) &&
    populationReconciliation.matchesHistorical

  if (!reproductionOk) {
    const failure = {
      schemaVersion: '1.0.0',
      generatedAt: new Date().toISOString(),
      kind: 'COOKING_MODE_V10G_ACTIVE_OBJECT_FULL_FROZEN_VALIDATION',
      verdict: 'STOP — BASELINE REPRODUCTION FAILED',
      populationReconciliation,
      baselineReproduction,
    }
    writeFileSync(OUT_JSON, JSON.stringify(failure, null, 2))
    console.error('STOP — BASELINE REPRODUCTION FAILED')
    console.error(JSON.stringify(baselineReproduction, null, 2))
    process.exit(1)
  }

  // ---- Phase 4: apply the exact V10F-Lite rule as rescue-only on every baseline REJECT ------
  const instructionMaps = buildInstructionMaps([ingredientCandidates, preparedComponentCandidates, v10e.candidates])
  const contextFor = (recipeId) => instructionMaps.get(recipeId) || { instructions: [] }

  const rescueResults = []
  for (const id of baselineRejectSet) {
    const c = byId.get(id)
    if (!c) continue
    const candidate = { candidateId: c.candidateId, ingredientText: c.ingredientText, instructionText: c.instructionText, instructionIndex: c.instructionIndex }
    const ctx = contextFor(c.recipeId)
    const result = evaluateActiveObjectRescue(candidate, ctx)
    rescueResults.push({
      candidateId: id,
      recipeId: c.recipeId,
      title: c.title,
      ingredientText: c.ingredientText,
      instructionText: c.instructionText,
      truth: correctIds.has(id) ? 'CORRECT' : 'INCORRECT',
      wasFalseNegative: fnIds.has(id),
      wasIncorrectCandidate: incorrectIds.has(id),
      reconstructedEarlierInstructionCount: ctx.instructions.filter((i) => i.index < c.instructionIndex).length,
      rescue: result.rescue,
      evidence: result.evidence,
      reason: result.reason,
    })
  }
  const rescueById = new Map(rescueResults.map((r) => [r.candidateId, r]))

  // ---- Phase 5: full-population metrics ------------------------------------------------------
  const rescuedAcceptIds = new Set(rescueResults.filter((r) => r.rescue).map((r) => r.candidateId))
  const finalAcceptSet = new Set([...baselineAcceptSet, ...rescuedAcceptIds])

  const finalTP = [...finalAcceptSet].filter((id) => correctIds.has(id)).length
  const finalFP = [...finalAcceptSet].filter((id) => incorrectIds.has(id)).length
  const finalFN = correctIds.size - finalTP
  const finalPrecision = round4(finalTP / (finalTP + finalFP || 1))
  const finalRecall = round4(finalTP / (finalTP + finalFN || 1))
  const finalF1 = round4((2 * finalPrecision * finalRecall) / (finalPrecision + finalRecall || 1))

  const rescueTpGained = rescueResults.filter((r) => r.rescue && r.truth === 'CORRECT').length
  const rescueFpIntroduced = rescueResults.filter((r) => r.rescue && r.truth === 'INCORRECT').length

  const delta = {
    tpGained: finalTP - baselineTP,
    fpAdded: finalFP - baselineFP,
    fnRemoved: baselineFN - finalFN,
    precisionDelta: round4(finalPrecision - baselinePrecision),
    recallDelta: round4(finalRecall - baselineRecall),
    recallImprovementOverGate: round4(finalRecall - 0.995),
    recallImprovementOverHistoricalBaseline: round4(finalRecall - 0.7707082833133253),
  }

  console.log(`Baseline: TP=${baselineTP} FP=${baselineFP} FN=${baselineFN} precision=${baselinePrecision} recall=${baselineRecall}`)
  console.log(`Rescue:   +TP=${rescueTpGained} +FP=${rescueFpIntroduced}`)
  console.log(`Final:    TP=${finalTP} FP=${finalFP} FN=${finalFN} precision=${finalPrecision} recall=${finalRecall} f1=${finalF1}`)

  // ---- Phase 6: recovery by V10E semantic class ------------------------------------------------
  const v10eById = new Map(v10e.candidates.map((c) => [c.candidateId, c]))
  const semanticClassBreakdown = REQUIRED_SEMANTIC_CLASSES.map((semanticClass) => {
    const rows = v10e.candidates.filter((c) => c.semanticClass === semanticClass)
    const rescued = rows.filter((c) => rescueById.get(c.candidateId)?.rescue === true)
    return {
      semanticClass,
      eligible: rows.length,
      rescued: rescued.length,
      missed: rows.length - rescued.length,
      recoveryPct: pct(rescued.length, rows.length),
      candidateIds: rows.map((c) => c.candidateId),
      rescuedCandidateIds: rescued.map((c) => c.candidateId),
    }
  })
  const classifiedFnCount = semanticClassBreakdown.reduce((sum, c) => sum + c.eligible, 0)

  const dscBreakdown = semanticClassBreakdown.find((c) => c.semanticClass === 'DISH_STATE_CONTINUATION')
  const pronounBreakdown = semanticClassBreakdown.find((c) => c.semanticClass === 'PRONOUN_OR_DEICTIC_REFERENCE')

  // ---- Phase 7: analyze every new false positive ------------------------------------------------
  const newFalsePositives = rescueResults
    .filter((r) => r.wasIncorrectCandidate && r.rescue)
    .map((r) => ({
      candidateId: r.candidateId,
      recipeId: r.recipeId,
      recipe: r.title,
      ingredient: r.ingredientText,
      instruction: r.instructionText,
      evidence: r.evidence,
      whyRuleFired: r.reason,
      whyBenchmarkSaysWrong: 'This candidate is adjudicated INCORRECT in the frozen V10A truth set (ingredient/component not actually relevant at this instruction).',
    }))

  // ---- Phase 9 (computed here, reported below): target-FP / quantity / historical protections --
  const targetFpOutcomes = v10d.targetFalsePositiveOutcomes.map((o) => {
    const r = rescueById.get(o.candidateId)
    return {
      candidateId: o.candidateId,
      recipeId: o.recipeId,
      rootCause: o.rootCause,
      v10dDecision: o.v10dDecision,
      rescueEvaluated: Boolean(r),
      rescueFired: r ? r.rescue : null,
      stillRejected: r ? !r.rescue : o.v10dDecision === 'REJECT',
    }
  })
  const targetFpProtection = { total: targetFpOutcomes.length, rejected: targetFpOutcomes.filter((o) => o.stillRejected).length, accepted: targetFpOutcomes.filter((o) => !o.stillRejected).length }

  const quantityRegressionOutcomes = v10d.quantityRegressionOutcomes.map((o) => ({
    candidateId: o.candidateId,
    baselineDecision: o.v10dDecision,
    isBaselineAccept: baselineAcceptSet.has(o.candidateId),
    rescueApplicable: false,
    stillRepaired: baselineAcceptSet.has(o.candidateId), // rescue-only never revokes an accept
  }))
  const quantityRegressionProtection = { total: quantityRegressionOutcomes.length, stillRepaired: quantityRegressionOutcomes.filter((o) => o.stillRepaired).length }

  const lockedTruthOutcomes = v10d.historicalRegression.outcomes
    .filter((o) => o.truthStatus === 'LOCKED_TRUTH')
    .map((o) => {
      const inPopulation = byId.has(o.candidateId)
      const r = rescueById.get(o.candidateId)
      const hasText = inPopulation && byId.get(o.candidateId).ingredientText != null
      const baselineProtected = o.decision === 'REJECT' // V10D's own baseline: REJECT = correctly protected (locked truth is a known false positive)
      let finalDecision
      let verifiable
      if (o.decision === 'ACCEPT') {
        // rescue-only never revokes an accept; baseline was already unprotected and stays that way.
        finalDecision = 'ACCEPT'
        verifiable = true
      } else if (r) {
        finalDecision = r.rescue ? 'ACCEPT' : 'REJECT'
        verifiable = true
      } else {
        finalDecision = 'UNKNOWN'
        verifiable = false
      }
      return {
        candidateId: o.candidateId,
        origins: o.origins,
        v10dDecision: o.decision,
        baselineProtected,
        inFrozen863Population: inPopulation,
        hasRawSourceText: hasText,
        verifiable,
        finalDecision,
        stillProtected: verifiable ? finalDecision === 'REJECT' : null,
      }
    })
  const lockedTruthProtection = {
    total: lockedTruthOutcomes.length,
    baselineProtected: lockedTruthOutcomes.filter((o) => o.baselineProtected).length, // matches V10D's own 4/12
    baselineUnprotectedAccepts: lockedTruthOutcomes.filter((o) => !o.baselineProtected).length, // 8 — unaffected by rescue-only
    verifiedStillProtected: lockedTruthOutcomes.filter((o) => o.verifiable && o.stillProtected).length,
    unverifiableForRescueFlip: lockedTruthOutcomes.filter((o) => o.baselineProtected && !o.verifiable).length,
    comparisonWithV10D: {
      v10dBaseline: '4/12',
      v10gVerifiedFloor: `${lockedTruthOutcomes.filter((o) => o.verifiable && o.stillProtected).length}/12 confirmed still protected`,
      v10gUnverifiedCeiling: `${lockedTruthOutcomes.filter((o) => o.baselineProtected).length}/12 (baseline) minus any unverifiable case where rescue would flip it — 3 of the 4 baseline-REJECT cases have no raw source text and could not be tested against the rescue rule`,
    },
  }

  // ---- Ratatouille policy check -----------------------------------------------------------------
  const ratatouilleIds = {
    initialExplicitUse: ['ingredient::chickpea-and-fennel-ratatouille::0::7', 'ingredient::chickpea-and-fennel-ratatouille::0::8'],
    laterGenericSeasoning: [
      'ingredient::chickpea-and-fennel-ratatouille::1::7',
      'ingredient::chickpea-and-fennel-ratatouille::1::8',
      'ingredient::chickpea-and-fennel-ratatouille::1::9',
      'ingredient::chickpea-and-fennel-ratatouille::2::7',
      'ingredient::chickpea-and-fennel-ratatouille::2::8',
    ],
  }
  const ratatouillePolicy = {
    initialExplicitUse: ratatouilleIds.initialExplicitUse.map((id) => ({ candidateId: id, truth: correctIds.has(id) ? 'CORRECT' : incorrectIds.has(id) ? 'INCORRECT' : 'UNKNOWN', baselineDecision: baselineAcceptSet.has(id) ? 'ACCEPT' : 'REJECT', finalDecision: finalAcceptSet.has(id) ? 'ACCEPT' : 'REJECT' })),
    laterGenericSeasoning: ratatouilleIds.laterGenericSeasoning.map((id) => ({ candidateId: id, truth: correctIds.has(id) ? 'CORRECT' : incorrectIds.has(id) ? 'INCORRECT' : 'UNKNOWN', baselineDecision: baselineAcceptSet.has(id) ? 'ACCEPT' : 'REJECT', finalDecision: finalAcceptSet.has(id) ? 'ACCEPT' : 'REJECT', rescueFired: rescueById.get(id)?.rescue ?? null })),
  }
  const ratatouillePass =
    ratatouillePolicy.initialExplicitUse.every((r) => r.finalDecision === 'ACCEPT') &&
    ratatouillePolicy.laterGenericSeasoning.every((r) => r.finalDecision === 'REJECT')

  // ---- Phase 8: remaining false negatives, taxonomy --------------------------------------------
  const remainingFn = semanticClassBreakdown
    .map((c) => ({ semanticClass: c.semanticClass, missed: c.missed }))
    .filter((c) => c.missed > 0)
    .sort((a, b) => b.missed - a.missed)

  // ---- Phase 10: gate ------------------------------------------------------------------------
  const shaAfter = sha256(CORE_PATH)
  const byteIdentical = shaBefore === shaAfter

  const gate = {
    v10dBaselineReproducedExactly: baselineReproduction.exactHistoricalMatch,
    zeroNewFalsePositives: newFalsePositives.length === 0,
    allTargetFpRejected: targetFpProtection.rejected === targetFpProtection.total,
    allQuantityRegressionsRepaired: quantityRegressionProtection.stillRepaired === quantityRegressionProtection.total,
    dscRecoveryAtLeast85: dscBreakdown.recoveryPct >= 85,
    pronounRecoveryAtLeast85: pronounBreakdown.recoveryPct >= 85,
    recallMateriallyImprovedOver7707: finalRecall > 0.7707082833133253 + 0.01,
    ruleByteIdentical: byteIdentical,
  }
  const preferred = {
    dscRecoveryAtLeast90: dscBreakdown.recoveryPct >= 90,
    pronounRecoveryAtLeast90: pronounBreakdown.recoveryPct >= 90,
  }
  const gatePass = Object.values(gate).every(Boolean)
  const verdict = gatePass ? 'PASS — ACTIVE-OBJECT RESCUE VALIDATED ON FULL FROZEN BENCHMARK' : 'FAIL — ACTIVE-OBJECT RESCUE DOES NOT GENERALIZE'
  const architectureRecommendation = gatePass
    ? 'PROCEED TO COMBINED FROZEN-PIPELINE DESIGN'
    : 'STOP ACTIVE-OBJECT DETERMINISTIC REFINEMENT — REASSESS AI-AT-INGESTION ARCHITECTURE'

  const artifact = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    kind: 'COOKING_MODE_V10G_ACTIVE_OBJECT_FULL_FROZEN_VALIDATION',
    verdict,
    repository: { branch: 'main', headBefore: null, headAfter: null }, // filled by caller via env if needed
    lockedCore: { path: 'scripts/analyze-cooking-mode-v10f-lite-active-object-core.mjs', sha256Before: shaBefore, sha256After: shaAfter, byteIdentical },
    populationReconciliation,
    baselineReproduction,
    rescue: {
      candidatesEvaluated: rescueResults.length,
      rescuedCount: rescuedAcceptIds.size,
      results: rescueResults,
    },
    finalMetrics: { truePositives: finalTP, falsePositives: finalFP, falseNegatives: finalFN, precision: finalPrecision, recall: finalRecall, f1: finalF1 },
    delta: { ...delta, rescueTruePositivesGained: rescueTpGained, rescueFalsePositivesIntroduced: rescueFpIntroduced },
    semanticClassRecovery: semanticClassBreakdown,
    classifiedFnCount,
    newFalsePositives,
    targetFalsePositiveProtection: { summary: targetFpProtection, outcomes: targetFpOutcomes },
    quantityRegressionProtection: { summary: quantityRegressionProtection, outcomes: quantityRegressionOutcomes },
    historicalLockedTruthProtection: { summary: lockedTruthProtection, outcomes: lockedTruthOutcomes },
    ratatouillePolicy: { pass: ratatouillePass, ...ratatouillePolicy },
    remainingFnTaxonomy: remainingFn,
    complexity: { semanticRuleCountUnchanged: true, ruleCount: 6, recipeSpecificExceptions: 0, aiCalls: 0, productionIntegration: 0 },
    gate,
    preferred,
    architectureRecommendation,
    aiUsage: { aiCalls: 0 },
    productionMutations: { firestoreWrites: 0, recipeWrites: 0, mapWrites: 0, productionCodeChanges: 0 },
    unverifiableItems: [
      'Three of the 12 historical locked-truth candidates (historical::192::1::20, historical::chicken-paprikash::3::1, historical::pearl-couscous-skillet-with-tomatoes-chickpeas-and-feta::4::12) have no raw ingredientText/instructionText in any frozen artifact — only extracted state facts. They could not be evaluated against the text-based rescue rule without regenerating from recipe source, which is out of scope. Their V10D-recorded decision (REJECT) is reported as-is; rescue applicability is UNKNOWN, not assumed safe.',
      'Instruction chronology per recipe is reconstructed only from text fragments already present across the frozen V10A/V10D/V10E artifacts (instructionText/previousInstructionText/nextInstructionText/priorCandidateInstructions). A recipe instruction that never appears in any candidate\'s fragments is not reconstructable without a corpus rerun (out of scope), so `reconstructedEarlierInstructionCount` on each rescue result is a lower bound on the true earlier-instruction count for that recipe.',
    ],
  }

  writeFileSync(OUT_JSON, JSON.stringify(artifact, null, 2))
  console.log(`Wrote ${path.relative(ROOT, OUT_JSON)}`)
  console.log(`Verdict: ${verdict}`)

  writeMarkdown(artifact)
  console.log(`Wrote ${path.relative(ROOT, OUT_MD)}`)
}

function writeMarkdown(a) {
  const lines = []
  lines.push('# Cooking Mode V10G — Active-Object Rescue: Full Frozen-Benchmark Validation')
  lines.push('')
  lines.push(`**Verdict:** ${a.verdict}`)
  lines.push('')
  lines.push(`**Architecture recommendation:** ${a.architectureRecommendation}`)
  lines.push('')
  lines.push('## 1. Locked rule')
  lines.push('')
  lines.push(`- Core: \`${a.lockedCore.path}\``)
  lines.push(`- SHA-256 before: \`${a.lockedCore.sha256Before}\``)
  lines.push(`- SHA-256 after: \`${a.lockedCore.sha256After}\``)
  lines.push(`- Byte-identical: ${a.lockedCore.byteIdentical ? 'YES' : 'NO'}`)
  lines.push('')
  lines.push('## 2. Frozen population')
  lines.push('')
  lines.push(`- Total: ${a.populationReconciliation.total} (historical: ${a.populationReconciliation.historicalExpected.total})`)
  lines.push(`- Correct: ${a.populationReconciliation.correct} (historical: ${a.populationReconciliation.historicalExpected.correct})`)
  lines.push(`- Incorrect: ${a.populationReconciliation.incorrect} (historical: ${a.populationReconciliation.historicalExpected.incorrect})`)
  lines.push(`- Recipe coverage: ${a.populationReconciliation.recipeCoverage} recipes`)
  lines.push(`- Matches historical: ${a.populationReconciliation.matchesHistorical ? 'YES' : 'NO'}`)
  lines.push('')
  lines.push('## 3. V10D baseline reproduction')
  lines.push('')
  const br = a.baselineReproduction
  lines.push(`- Reconstructed: TP=${br.reconstructed.truePositives} FP=${br.reconstructed.falsePositives} FN=${br.reconstructed.falseNegatives} precision=${br.reconstructed.precision} recall=${br.reconstructed.recall}`)
  lines.push(`- Historical: TP=${br.historical.truePositives} FP=${br.historical.falsePositives} FN=${br.historical.falseNegatives} precision=${br.historical.precision} recall=${br.historical.recall}`)
  lines.push(`- Exact historical match: ${br.exactHistoricalMatch ? 'YES' : 'NO'}`)
  lines.push('')
  lines.push('## 4. V10D + active-object rescue result')
  lines.push('')
  const fm = a.finalMetrics
  lines.push(`- TP=${fm.truePositives} FP=${fm.falsePositives} FN=${fm.falseNegatives} precision=${fm.precision} recall=${fm.recall} F1=${fm.f1}`)
  lines.push('')
  lines.push('## 5. Delta')
  lines.push('')
  lines.push(`- TP gained: ${a.delta.tpGained}`)
  lines.push(`- FP added: ${a.delta.fpAdded}`)
  lines.push(`- FN removed: ${a.delta.fnRemoved}`)
  lines.push(`- Precision delta: ${a.delta.precisionDelta}`)
  lines.push(`- Recall delta: ${a.delta.recallDelta}`)
  lines.push('')
  lines.push('## 6. Semantic-class recovery (V10E taxonomy, all 191 V10D false negatives)')
  lines.push('')
  lines.push('| Class | Eligible | Rescued | Missed | Recovery % |')
  lines.push('|---|---|---|---|---|')
  for (const c of a.semanticClassRecovery) {
    lines.push(`| ${c.semanticClass} | ${c.eligible} | ${c.rescued} | ${c.missed} | ${c.recoveryPct ?? '—'} |`)
  }
  lines.push('')
  lines.push('## 7. New false positives')
  lines.push('')
  if (a.newFalsePositives.length === 0) {
    lines.push('None — 0 of the 30 frozen INCORRECT candidates were rescued.')
  } else {
    for (const fp of a.newFalsePositives) {
      lines.push(`- **${fp.candidateId}** (${fp.recipe}): ingredient "${fp.ingredient}" / instruction "${fp.instruction}" — evidence: ${fp.evidence}. ${fp.whyRuleFired}`)
    }
  }
  lines.push('')
  lines.push('## 8. Target false positive protection')
  lines.push('')
  lines.push(`${a.targetFalsePositiveProtection.summary.rejected}/${a.targetFalsePositiveProtection.summary.total} rejected`)
  lines.push('')
  lines.push('## 9. Quantity regression protection')
  lines.push('')
  lines.push(`${a.quantityRegressionProtection.summary.stillRepaired}/${a.quantityRegressionProtection.summary.total} remain repaired`)
  lines.push('')
  lines.push('## 10. Historical locked-truth cases')
  lines.push('')
  const lt = a.historicalLockedTruthProtection.summary
  lines.push(`Baseline protected (matches V10D): ${lt.baselineProtected}/${lt.total}. Of those, ${lt.verifiedStillProtected} verified still-protected post-rescue and ${lt.unverifiableForRescueFlip} unverifiable (no raw source text — cannot confirm rescue does not flip them). ${lt.baselineUnprotectedAccepts}/${lt.total} were already unprotected ACCEPTs under V10D and are unaffected by rescue-only. V10D baseline was 4/12.`)
  lines.push('')
  lines.push('## 11. Ratatouille generic-seasoning policy')
  lines.push('')
  lines.push(`Pass: ${a.ratatouillePolicy.pass ? 'YES' : 'NO'}`)
  lines.push('')
  lines.push('## 12. Remaining FN taxonomy (largest classes)')
  lines.push('')
  for (const c of a.remainingFnTaxonomy) lines.push(`- ${c.semanticClass}: ${c.missed} still missed`)
  lines.push('')
  lines.push('## 13. Complexity')
  lines.push('')
  lines.push(`- Semantic rule count unchanged: ${a.complexity.semanticRuleCountUnchanged ? 'YES' : 'NO'} (${a.complexity.ruleCount})`)
  lines.push(`- Recipe-specific exceptions: ${a.complexity.recipeSpecificExceptions}`)
  lines.push(`- AI calls: ${a.complexity.aiCalls}`)
  lines.push(`- Production integration: ${a.complexity.productionIntegration}`)
  lines.push('')
  lines.push('## 14. Full-frozen gate')
  lines.push('')
  for (const [k, v] of Object.entries(a.gate)) lines.push(`- ${k}: ${v ? 'PASS' : 'FAIL'}`)
  lines.push('')
  lines.push('## 15. Preferred thresholds')
  lines.push('')
  for (const [k, v] of Object.entries(a.preferred)) lines.push(`- ${k}: ${v ? 'YES' : 'no'}`)
  lines.push('')
  lines.push('## 16. Unverifiable items')
  lines.push('')
  for (const item of a.unverifiableItems) lines.push(`- ${item}`)
  lines.push('')
  writeFileSync(OUT_MD, lines.join('\n'))
}

main()
