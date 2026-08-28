#!/usr/bin/env node
/**
 * V10F-Lite — Active-Object Rescue Go/No-Go driver.
 *
 * Read-only. Loads three LOCKED prior audit artifacts, reconstructs a small ~51-case
 * challenge set from already-adjudicated evidence (no new truth labels), runs the narrow
 * `evaluateActiveObjectRescue` diagnostic rule from the -core module against every case, and
 * writes docs/audits/cooking-mode-v10f-lite-active-object-go-no-go-2026-08-28.json.
 *
 * No Firestore access, no AI calls, no production writes, no recipe mutation.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { evaluateActiveObjectRescue } from './analyze-cooking-mode-v10f-lite-active-object-core.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const V10A_PATH = path.join(ROOT, 'docs/audits/cooking-mode-arbiter-v10a-frozen-candidates-2026-08-28.json')
const V10D_PATH = path.join(ROOT, 'docs/audits/cooking-mode-v10d-principal-target-analysis-2026-08-28.json')
const V10E_PATH = path.join(ROOT, 'docs/audits/cooking-mode-v10e-remaining-fn-taxonomy-2026-08-28.json')
const OUT_PATH = path.join(ROOT, 'docs/audits/cooking-mode-v10f-lite-active-object-go-no-go-2026-08-28.json')

// ---- Phase 2: frozen challenge-set selection (documented candidate IDs, no new truth labels) ----

/** 10 DISH_STATE_CONTINUATION positives, spread across 9 distinct recipes (one extra from the
 *  largest-population recipe, 173, to reach 10) — from V10E's 191-row reconstructed FN population. */
export const DSC_IDS = [
  'ingredient::152::1::2',
  'ingredient::164::2::0',
  'ingredient::168::1::0',
  'ingredient::173::3::1',
  'ingredient::173::3::2',
  'ingredient::chicken-tikka::2::0',
  'ingredient::grilled-zucchini-and-summer-squash::2::0',
  'ingredient::mapo-rag-crazy-good::2::2',
  'ingredient::mexican-oaxacan-bowl::3::5',
  'ingredient::roasted-white-bean-and-tomato-pasta::0::0',
]

/** 10 PRONOUN_OR_DEICTIC_REFERENCE positives, 2 each from 5 distinct recipes — from the same
 *  V10E population. */
export const PRONOUN_IDS = [
  'ingredient::mole-poblano::13::7',
  'ingredient::mole-poblano::13::8',
  'ingredient::mole-poblano::13::9',
  'ingredient::dads-chili::5::2',
  'ingredient::dads-chili::5::3',
  'ingredient::dads-chili::5::4',
  'ingredient::jocn-chicken-and-tomatillo-stew::5::0',
  'ingredient::jocn-chicken-and-tomatillo-stew::5::1',
  'ingredient::sheet-pan-bibimbap::3::0',
  'ingredient::sheet-pan-bibimbap::3::1',
]

/** 11 negative leakage cases: rows where a naive active-object rule would be dangerous
 *  (consumed row, duplicate/wrong-row salt, serving/garnish on an assembled skewer, an isolated
 *  already-combined dressing's 5 raw constituent rows, a mismatched sub-ingredient label, a
 *  marinade-blend target-identity miss, and a "set aside"/purée-broth passive-carry case) —
 *  drawn from the V10A frozen population's adjudicatedTruth === 'INCORRECT' rows, excluding any
 *  row already covered by the 20 locked target false positives below. */
export const NEGATIVE_LEAKAGE_IDS = [
  'ingredient::157::5::0',
  'ingredient::176::6::17',
  'ingredient::chicken-tikka::9::0',
  'ingredient::cucumber-tomato-salad-with-red-wine-vinaigrette::2::3',
  'ingredient::cucumber-tomato-salad-with-red-wine-vinaigrette::2::4',
  'ingredient::cucumber-tomato-salad-with-red-wine-vinaigrette::2::5',
  'ingredient::cucumber-tomato-salad-with-red-wine-vinaigrette::2::6',
  'ingredient::cucumber-tomato-salad-with-red-wine-vinaigrette::2::7',
  'ingredient::dads-chili::0::15',
  'ingredient::tacos-al-pastor::1::0',
  'ingredient::jocn-chicken-and-tomatillo-stew::4::2',
]

function loadJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'))
}

/** Reconstructs each needed recipe's own instruction chronology (index -> text) purely from the
 *  locked candidate artifacts' instructionText/previousInstructionText/nextInstructionText
 *  fields — this recipe's own text only, never global. */
function buildInstructionMap(recipeIds, v10aCandidates, v10eCandidates) {
  const map = new Map() // recipeId -> Map(index -> text)
  const need = new Set(recipeIds)

  function put(recipeId, index, text) {
    if (!need.has(recipeId) || text == null) return
    if (!map.has(recipeId)) map.set(recipeId, new Map())
    const m = map.get(recipeId)
    if (!m.has(index)) m.set(index, text)
  }

  for (const c of v10aCandidates) {
    put(c.recipeId, c.instructionIndex, c.instructionText)
    if (c.previousInstructionText) put(c.recipeId, c.instructionIndex - 1, c.previousInstructionText)
    if (c.nextInstructionText) put(c.recipeId, c.instructionIndex + 1, c.nextInstructionText)
  }
  for (const c of v10eCandidates) {
    put(c.recipeId, c.instructionIndex, c.instructionText)
  }

  const result = {}
  for (const [recipeId, m] of map.entries()) {
    result[recipeId] = { instructions: Array.from(m.entries()).map(([index, text]) => ({ index, text })) }
  }
  return result
}

function evalCase(group, candidate, recipeContext, expectRescue) {
  const result = evaluateActiveObjectRescue(candidate, recipeContext)
  return {
    group,
    candidateId: candidate.candidateId,
    recipeId: candidate.recipeId,
    title: candidate.title,
    ingredientText: candidate.ingredientText,
    instructionText: candidate.instructionText,
    expectRescue,
    rescue: result.rescue,
    evidence: result.evidence,
    reason: result.reason,
    matchedExpectation: result.rescue === expectRescue,
  }
}

function main() {
  const v10a = loadJson(V10A_PATH)
  const v10d = loadJson(V10D_PATH)
  const v10e = loadJson(V10E_PATH)

  const v10aCandidates = [...v10a.populations.INGREDIENT_RELATIONSHIPS, ...v10a.populations.PREPARED_COMPONENT_RELATIONSHIPS]
  const v10aById = new Map(v10aCandidates.map((c) => [c.candidateId, c]))
  const v10eById = new Map(v10e.candidates.map((c) => [c.candidateId, c]))

  const dscCandidates = DSC_IDS.map((id) => {
    const c = v10eById.get(id)
    if (!c) throw new Error(`Missing V10E candidate: ${id}`)
    return c
  })
  const pronounCandidates = PRONOUN_IDS.map((id) => {
    const c = v10eById.get(id)
    if (!c) throw new Error(`Missing V10E candidate: ${id}`)
    return c
  })
  const negativeCandidates = NEGATIVE_LEAKAGE_IDS.map((id) => {
    const c = v10aById.get(id)
    if (!c) throw new Error(`Missing V10A candidate: ${id}`)
    return c
  })
  const lockedTargetFp = v10d.targetFalsePositiveOutcomes.map((c) => ({
    candidateId: c.candidateId,
    recipeId: c.recipeId,
    title: c.recipeId,
    instructionIndex: c.instructionIndex,
    ingredientText: c.ingredientRow,
    instructionText: c.currentInstruction,
    rootCause: c.rootCause,
  }))

  const recipeIds = new Set([
    ...dscCandidates.map((c) => c.recipeId),
    ...pronounCandidates.map((c) => c.recipeId),
    ...negativeCandidates.map((c) => c.recipeId),
    ...lockedTargetFp.map((c) => c.recipeId),
  ])
  const instructionMaps = buildInstructionMap(recipeIds, v10aCandidates, v10e.candidates)
  const contextFor = (recipeId) => instructionMaps[recipeId] || { instructions: [] }

  const results = [
    ...dscCandidates.map((c) => evalCase('DISH_STATE_CONTINUATION_POSITIVE', c, contextFor(c.recipeId), true)),
    ...pronounCandidates.map((c) => evalCase('PRONOUN_OR_DEICTIC_REFERENCE_POSITIVE', c, contextFor(c.recipeId), true)),
    ...negativeCandidates.map((c) => evalCase('NEGATIVE_LEAKAGE', c, contextFor(c.recipeId), false)),
    ...lockedTargetFp.map((c) => evalCase('LOCKED_TARGET_FALSE_POSITIVE', c, contextFor(c.recipeId), false)),
  ]

  function summarize(group) {
    const rows = results.filter((r) => r.group === group)
    const matched = rows.filter((r) => r.matchedExpectation).length
    return { selected: rows.length, matched, recoveryPct: rows.length ? Math.round((matched / rows.length) * 10000) / 100 : null }
  }

  const dscSummary = summarize('DISH_STATE_CONTINUATION_POSITIVE')
  const pronounSummary = summarize('PRONOUN_OR_DEICTIC_REFERENCE_POSITIVE')
  const negativeSummary = summarize('NEGATIVE_LEAKAGE')
  const lockedSummary = summarize('LOCKED_TARGET_FALSE_POSITIVE')

  const rescueAccepts = results.filter((r) => r.rescue === true)
  const rescueTp = rescueAccepts.filter((r) => r.expectRescue === true).length
  const rescueFp = rescueAccepts.filter((r) => r.expectRescue === false).length
  const precision = rescueAccepts.length ? Math.round((rescueTp / rescueAccepts.length) * 10000) / 100 : null

  const negativeFalseAccepts = results.filter((r) => r.group === 'NEGATIVE_LEAKAGE' && r.rescue === true).length
  const lockedFalseAccepts = results.filter((r) => r.group === 'LOCKED_TARGET_FALSE_POSITIVE' && r.rescue === true).length

  const gate = {
    zeroNewFalsePositives: negativeFalseAccepts === 0 && lockedFalseAccepts === 0,
    dscRecoveryAtLeast85: dscSummary.recoveryPct >= 85,
    pronounRecoveryAtLeast85: pronounSummary.recoveryPct >= 85,
    allTargetFpRejected: lockedSummary.matched === lockedSummary.selected,
  }
  const goDecision = gate.zeroNewFalsePositives && gate.dscRecoveryAtLeast85 && gate.pronounRecoveryAtLeast85 && gate.allTargetFpRejected

  const artifact = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    kind: 'COOKING_MODE_V10F_LITE_ACTIVE_OBJECT_GO_NO_GO',
    verdict: goDecision
      ? 'GO — SIMPLE ACTIVE-OBJECT RESCUE WARRANTS FULL FROZEN VALIDATION'
      : 'NO-GO — STOP DETERMINISTIC SEMANTIC REFINEMENT',
    challengeSet: {
      positiveDishStateContinuation: { count: dscCandidates.length, candidateIds: DSC_IDS },
      positivePronounOrDeictic: { count: pronounCandidates.length, candidateIds: PRONOUN_IDS },
      negativeLeakage: { count: negativeCandidates.length, candidateIds: NEGATIVE_LEAKAGE_IDS },
      lockedTargetFalsePositives: { count: lockedTargetFp.length, candidateIds: lockedTargetFp.map((c) => c.candidateId) },
      totalSelected: dscCandidates.length + pronounCandidates.length + negativeCandidates.length + lockedTargetFp.length,
    },
    results,
    metrics: {
      dishStateContinuation: dscSummary,
      pronounOrDeictic: pronounSummary,
      negativeLeakage: { ...negativeSummary, falseAccepts: negativeFalseAccepts },
      lockedTargetFalsePositives: { ...lockedSummary, falseAccepts: lockedFalseAccepts },
      precision: { rescueTp, rescueFp, rescueAccepts: rescueAccepts.length, precisionPct: precision },
    },
    gate,
    aiUsage: { aiCalls: 0 },
    productionMutations: { firestoreWrites: 0, recipeWrites: 0, mapWrites: 0, productionCodeChanges: 0 },
  }

  writeFileSync(OUT_PATH, JSON.stringify(artifact, null, 2))

  console.log(`Verdict: ${artifact.verdict}`)
  console.log(`DISH_STATE_CONTINUATION: ${dscSummary.matched}/${dscSummary.selected} (${dscSummary.recoveryPct}%)`)
  console.log(`PRONOUN_OR_DEICTIC_REFERENCE: ${pronounSummary.matched}/${pronounSummary.selected} (${pronounSummary.recoveryPct}%)`)
  console.log(`Negative leakage correctly rejected: ${negativeSummary.matched}/${negativeSummary.selected}`)
  console.log(`Locked target FP correctly rejected: ${lockedSummary.matched}/${lockedSummary.selected}`)
  console.log(`Precision: TP=${rescueTp} FP=${rescueFp} (${precision}%)`)
  console.log(`Wrote ${path.relative(ROOT, OUT_PATH)}`)
}

main()
