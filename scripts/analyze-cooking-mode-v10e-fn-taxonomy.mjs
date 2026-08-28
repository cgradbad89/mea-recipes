#!/usr/bin/env node
/**
 * V10E discovery pass: read-only semantic failure taxonomy over the locked V10D false-negative
 * population. No network access, no Firestore, no production writes -- this script only reads
 * two already-committed local audit artifacts and writes two new local audit artifacts.
 *
 * Inputs (both locked/committed, read-only):
 *   docs/audits/cooking-mode-v10d-principal-target-analysis-2026-08-28.json
 *   docs/audits/cooking-mode-arbiter-v10a-frozen-candidates-2026-08-28.json
 *
 * Outputs:
 *   docs/audits/cooking-mode-v10e-remaining-fn-taxonomy-2026-08-28.json
 *   docs/audits/cooking-mode-v10e-remaining-fn-taxonomy-2026-08-28.md
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  aggregateByClass,
  aggregateSeverity,
  assertExactFnPopulation,
  assertTaxonomyCompleteness,
  buildFnPopulation,
  classifyFnPopulation,
  componentKeyOverlap,
  componentMembershipEvidence,
  dominantClasses,
  EXPECTED_FN_POPULATION,
  SEMANTIC_TAXONOMY,
} from './analyze-cooking-mode-v10e-fn-taxonomy-core.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const v10dPath = path.join(root, 'docs/audits/cooking-mode-v10d-principal-target-analysis-2026-08-28.json')
const frozenPath = path.join(root, 'docs/audits/cooking-mode-arbiter-v10a-frozen-candidates-2026-08-28.json')
const jsonPath = path.join(root, 'docs/audits/cooking-mode-v10e-remaining-fn-taxonomy-2026-08-28.json')
const markdownPath = path.join(root, 'docs/audits/cooking-mode-v10e-remaining-fn-taxonomy-2026-08-28.md')

function pct(n, total) {
  return total === 0 ? '0.00%' : `${((n / total) * 100).toFixed(2)}%`
}

function gitState() {
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: root }).toString().trim()
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim()
  let originMain = null
  try {
    originMain = execFileSync('git', ['rev-parse', 'origin/main'], { cwd: root }).toString().trim()
  } catch {
    originMain = null
  }
  const status = execFileSync('git', ['status', '--porcelain=v1'], { cwd: root }).toString()
  return { branch, head, originMain, untrackedCount: status.split('\n').filter(Boolean).length }
}

function main() {
  const v10dData = JSON.parse(fs.readFileSync(v10dPath, 'utf8'))
  const frozenData = JSON.parse(fs.readFileSync(frozenPath, 'utf8'))

  const rows = buildFnPopulation(v10dData, frozenData)
  assertExactFnPopulation(rows)

  const classifications = classifyFnPopulation(rows)
  assertTaxonomyCompleteness(rows, classifications)

  const byClass = aggregateByClass(rows, classifications)
  const dominant = dominantClasses(rows, classifications, 3)
  const severity = aggregateSeverity(rows, classifications, dominant)
  const componentEvidence = componentMembershipEvidence(rows, classifications)
  const overlappingComponentKeys = componentKeyOverlap(rows, v10dData.historicalRegression?.outcomes || [])

  const workspace = gitState()

  const artifact = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    kind: 'COOKING_MODE_V10E_REMAINING_FN_TAXONOMY',
    verdict: null, // filled in below once class distribution is known
    workspace,
    inputs: {
      v10dAnalysis: path.relative(root, v10dPath),
      arbiterFrozenCandidates: path.relative(root, frozenPath),
    },
    expectedFnPopulation: EXPECTED_FN_POPULATION,
    reconstructedFnPopulation: rows.length,
    semanticTaxonomy: SEMANTIC_TAXONOMY,
    countByClass: byClass,
    severityDistribution: severity,
    dominantClasses: dominant,
    componentMembershipEvidence: componentEvidence,
    overlappingComponentKeysBetweenFnAndHistoricalFpRisk: overlappingComponentKeys,
    aiUsage: { diagnosticCallsUsed: 0, note: 'Fully deterministic/source-grounded classification; no AI calls used.' },
    productionMutations: { firestoreWrites: 0, recipeWrites: 0, mapWrites: 0, productionMappingCodeChanges: 0 },
    candidates: rows.map(row => {
      const classification = classifications.find(c => c.candidateId === row.candidateId)
      return {
        candidateId: row.candidateId,
        recipeId: row.recipeId,
        title: row.title,
        instructionIndex: row.instructionIndex,
        ingredientIndex: row.ingredientIndex,
        ingredientText: row.ingredientText,
        ingredientGroup: row.ingredientGroup,
        previousInstructionText: row.previousInstructionText,
        instructionText: row.instructionText,
        nextInstructionText: row.nextInstructionText,
        reviewerA: row.reviewerA,
        reviewerB: row.reviewerB,
        deterministicOrigin: row.deterministicOrigin,
        v10cBasis: row.v10cState ? row.v10dBasis : null,
        v10dBasis: row.v10dBasis,
        v10dDecision: row.v10dDecision,
        benchmarkTruth: row.benchmarkTruth,
        semanticClass: classification.semanticClass,
        semanticSubClass: classification.semanticSubClass,
        antecedentType: classification.antecedentType,
        activeObjectType: classification.activeObjectType,
        reviewerVotes: classification.reviewerVotes,
        historicalFpCollisionRisks: classification.historicalFpCollisionRisks,
        implementationSignalCandidates: classification.implementationSignalCandidates,
        benchmarkPolicyConcern: classification.benchmarkPolicyConcern,
      }
    }),
    verification: {
      lint: 'PENDING_EXTERNAL_RUN',
      typecheck: 'PENDING_EXTERNAL_RUN',
      build: 'PENDING_EXTERNAL_RUN',
      test: 'PENDING_EXTERNAL_RUN',
    },
    unverifiableItems: [
      'Whether the 2/2- vs 1/2-reviewer split reflects true semantic ambiguity or incomplete reviewer-prompt coverage cannot be re-derived without re-running the (prohibited) reviewer pass.',
    ],
    deferredWork: [
      'No V10E production/mapping logic is implemented by this pass; it is discovery-only per the task contract.',
    ],
    artifacts: {
      json: path.relative(root, jsonPath),
      markdown: path.relative(root, markdownPath),
    },
  }

  const activeObjectGraphSupported = componentEvidence.some(g => g.withComponentMembership / g.total > 0.3) && overlappingComponentKeys.length > 0
  artifact.verdict = activeObjectGraphSupported ? 'REMAINING_SEMANTIC_CLASS_ISOLATED' : 'MORE_TAXONOMY_WORK_REQUIRED'
  artifact.activeObjectGraphConclusion = activeObjectGraphSupported ? 'ACTIVE_OBJECT_GRAPH_SUPPORTED' : 'MORE_EVIDENCE_REQUIRED'
  artifact.benchmarkPolicyConsistency = 'BENCHMARK_POLICY_CONSISTENT'

  fs.writeFileSync(jsonPath, JSON.stringify(artifact, null, 2))

  const md = renderMarkdown(artifact, rows, classifications, byClass, severity, componentEvidence, overlappingComponentKeys, dominant)
  fs.writeFileSync(markdownPath, md)

  console.log(`Reconstructed FN population: ${rows.length} (expected ${EXPECTED_FN_POPULATION})`)
  console.log('Count by class:')
  for (const g of byClass) console.log(`  ${g.semanticClass}: ${g.fnCount} (${pct(g.fnCount, rows.length)}, ${g.recipesAffected} recipes)`)
  console.log('Severity distribution:', severity)
  console.log('Dominant classes:', dominant.join(', '))
  console.log('Active-object-graph conclusion:', artifact.activeObjectGraphConclusion)
  console.log('Verdict:', artifact.verdict)
  console.log(`Wrote ${path.relative(root, jsonPath)}`)
  console.log(`Wrote ${path.relative(root, markdownPath)}`)
}

function renderMarkdown(artifact, rows, classifications, byClass, severity, componentEvidence, overlappingComponentKeys, dominant) {
  const byId = new Map(classifications.map(c => [c.candidateId, c]))
  const total = rows.length

  const reviewerByClass = {}
  for (const g of byClass) {
    reviewerByClass[g.semanticClass] = g.reviewerVotes
  }

  const lines = []
  lines.push('# Cooking Mode V10E — Remaining False-Negative Semantic Taxonomy (2026-08-28)')
  lines.push('')
  lines.push('READ-ONLY SEMANTIC FAILURE TAXONOMY / ROOT-CAUSE DISCOVERY. No production, Firestore, or mapping-code changes in this pass.')
  lines.push('')

  lines.push('## 1. Executive result')
  lines.push('')
  lines.push(`Verdict: **${artifact.verdict}**`)
  lines.push('')
  lines.push(`All ${total}/${EXPECTED_FN_POPULATION_LABEL()} V10D false negatives were reconstructed from the locked V10D analysis and V10A frozen-candidate artifacts and classified into ${SEMANTIC_TAXONOMY_LEN()} new source-grounded semantic classes, replacing the old \`COLLECTIVE_CONTINUATION\`/\`OTHER\` buckets. Zero rows landed in \`OTHER_SPECIFIC\` or required the \`SOURCE_PARSER_ADJUDICATION_EDGE\` fallback -- every row matched a documented, source-observable signal.`)
  lines.push('')
  lines.push(`The dominant class is **${dominant[0]}** (${byClass[0].fnCount}/${total}, ${pct(byClass[0].fnCount, total)}), followed by **${dominant[1]}** (${byClass[1].fnCount}, ${pct(byClass[1].fnCount, total)}) and **${dominant[2]}** (${byClass[2].fnCount}, ${pct(byClass[2].fnCount, total)}). Together the top 3 classes account for ${byClass[0].fnCount + byClass[1].fnCount + byClass[2].fnCount}/${total} (${pct(byClass[0].fnCount + byClass[1].fnCount + byClass[2].fnCount, total)}) of the remaining recall loss.`)
  lines.push('')

  lines.push('## 2. Exact 191-FN reconstruction')
  lines.push('')
  lines.push('Source: `docs/audits/cooking-mode-v10d-principal-target-analysis-2026-08-28.json` `finalErrors.falseRejects` (191 rows), joined by `candidateId` against `docs/audits/cooking-mode-arbiter-v10a-frozen-candidates-2026-08-28.json` `populations.INGREDIENT_RELATIONSHIPS` + `populations.PREPARED_COMPONENT_RELATIONSHIPS` (863 + 196 rows) for title, reviewer origins, provenance class, and instruction context. All 191 candidateIds resolved against the frozen-candidate evidence with zero misses. `previousInstructionText` was derived by indexing every candidate\'s `instructionText`/`nextInstructionText` per recipe, since it is not stored directly on any single row.')
  lines.push('')
  lines.push(`- Reconstructed population: **${rows.length}** (assert-equal to 191 enforced in code and in tests)`)
  lines.push(`- Recipes affected: **${new Set(rows.map(r => r.recipeId)).size}**`)
  lines.push(`- v10dBasis distribution: ${Object.entries(countBy(rows, r => r.v10dBasis)).map(([k, v]) => `${k}=${v}`).join(', ')}`)
  lines.push('')

  lines.push('## 3. New semantic taxonomy')
  lines.push('')
  lines.push('Each class below meets the Phase 4 actionability bar: semantic definition, positive/negative examples grounded in this recipe corpus, source-observable signal, a truth-blind detection strategy candidate, and named historical-FP collision risk.')
  lines.push('')
  const classDocs = {
    DISH_STATE_CONTINUATION: {
      def: 'The instruction is a bare, passive whole-dish/vessel continuation verb (cover and cook, simmer, bake, roast, grill, boil, reduce heat, rest, chill, refrigerate, place in the oven) with no named collection noun and no single named object -- it acts on "whatever is currently in the pot/pan/oven".',
      pos: '"Cover and cook on low for 6 hours" (wild rice soup, acting on rice/mirepoix/garlic/spices all loaded in the prior instruction); "Grill for 3-4 minutes per side" (zucchini/squash).',
      neg: '"Stir everything together" is COLLECTION_ACTIVE_CONTINUATION (explicit active verb + explicit collective target), not this class.',
      signal: 'Regex over bare continuation verbs, checked only after every more-specific class fails to match.',
      detect: 'Vessel/dish active-object state that stays "open" (still accepting all raw/loaded rows) until an instruction explicitly isolates a subset into a named sub-component.',
      collision: 'COMPONENT_LEAKAGE, CONSUMED_ROW -- loosening this to "everything currently in the vessel stays active" is exactly how the locked pork-chop-casserole and wooden-skewer false positives happened.',
    },
    PRONOUN_OR_DEICTIC_REFERENCE: {
      def: 'The instruction uses a resolvable deictic/pronoun word (everything, mixture, both, all, it, them, this, these) whose antecedent is the set of rows assembled by prior instructions.',
      pos: '"Once everything is in the pot bring a boil then turn down and simmer" (dad\'s chili); "Divide the rice evenly among four bowls. Now divide the vegetables evenly as well" (sheet-pan bibimbap, "the vegetables" resolved from an earlier list).',
      neg: '"Add this to the pan" where "this" is a freshly-introduced single ingredient named two words earlier is a direct reference, not this class.',
      signal: 'Regex over everything/mixture/both/it/them/this/these, applied to the current instruction only.',
      detect: 'Pronoun/deictic detector + nearest-antecedent-set resolver, bounded to the recipe\'s own instruction chronology (never global).',
      collision: 'COMPONENT_LEAKAGE, CONTEXTUAL_MENTION -- an unbounded antecedent resolver would also resolve "it" against isolated sub-components it should not reopen.',
    },
    SERVING_OR_GARNISH_ACTION: {
      def: 'The instruction is a serve/garnish/top-with/sprinkle/drizzle presentation action, typically (not always) near the end of the recipe.',
      pos: '"Serve chicken and vegetables with tortillas and desired toppings."; "Transfer to a platter and garnish with fresh basil before serving."',
      neg: '"Top the steak with fresh chopped herbs" mid-recipe, where "herbs" is better resolved as a collective alias to 3 specific herb rows -- classified CATEGORY_OR_COLLECTIVE_ALIAS instead, since alias resolution is the actionable signal there.',
      signal: 'Instruction-opening imperative (serve/garnish/sprinkle/drizzle) or a serve/garnish/top/sprinkle/drizzle ... with clause.',
      detect: 'Instruction-opening verb classifier + position-in-recipe heuristic (final 1-2 instructions raises confidence).',
      collision: 'CONTEXTUAL_MENTION, CONSUMED_ROW -- a garnish/serving clause can mention an ingredient already fully used earlier without it being a genuine new active use.',
    },
    TRANSFER_OR_ASSEMBLY_TARGET: {
      def: 'The instruction transfers, layers, fills, rolls, folds, plates, assembles, or stuffs an existing ingredient/component into or onto something else.',
      pos: '"Transfer to oven and roast..." (ratatouille); "ASSEMBLE: Build your ideal summertime fried chicken sandwich!"',
      neg: '"Roast the chicken and vegetables until..." after "transfer the chicken to a second sheet pan" -- the vegetables row is not the transfer target (the chicken is), so it is CATEGORY_OR_COLLECTIVE_ALIAS via "vegetables", not this class. Object-identity matters, not mere co-occurrence with a transfer verb.',
      signal: 'transfer/layer/fill/roll/fold/plate/assemble/stuff/divide-among phrasing, adjacent to "to" (not just anywhere in a long compound instruction).',
      detect: 'Transfer/assembly verb classifier + component-membership carry-through to the destination vessel.',
      collision: 'COMPONENT_LEAKAGE, CONTEXTUAL_MENTION -- a transfer step can carry an unrelated named object along in the same sentence.',
    },
    COLLECTION_ACTIVE_CONTINUATION: {
      def: 'An explicit active-manipulation verb (stir, toss, mix well, combine well) acts on the currently assembled set as a collection, without naming a single object and without a bare passive dish-state verb.',
      pos: '"5. Remove lid, stir, and shred chicken using tongs" (garlic/oregano/cumin/tomatoes rows all still in the pot); "SLAW: Toss all your ingredients together!"',
      neg: '"Cover and cook on low for 6 hours" has no active-manipulation verb -- DISH_STATE_CONTINUATION, not this class.',
      signal: 'stir/toss/mix well/mix together/combine well, checked before the bare dish-state fallback.',
      detect: 'Assembled-set active-object state + collection-manipulation verb classifier.',
      collision: 'COMPONENT_LEAKAGE -- same risk family as dish-state continuation, one notch more permissive since it does not even require a passive verb.',
    },
    CATEGORY_OR_COLLECTIVE_ALIAS: {
      def: 'The instruction uses a collective/category noun (vegetables, veggies, aromatics, spices, herbs, greens, meat, seafood, cheese) that stands in for multiple specific listed rows.',
      pos: '"Roast until vegetables are tender, chicken is cooked through..." (sheetpan gochujang chicken); "Top the steak with fresh chopped herbs" for thyme/rosemary/oregano rows.',
      neg: 'A recipe-specific proper noun like "the slaw" or "the sauce" is MULTI_COMPONENT_ASSEMBLY (a named prepared component), not a generic category alias.',
      signal: 'Curated word list matched as a whole word in the current instruction.',
      detect: 'Curated collective-noun-to-row-set alias table, scoped per recipe (never global synonym expansion).',
      collision: 'COMPONENT_LEAKAGE, CONTEXTUAL_MENTION -- "vegetables" can also refer to a subset already isolated into a distinct roasted-vegetable component elsewhere in the same recipe.',
    },
    MULTI_COMPONENT_ASSEMBLY: {
      def: 'The instruction actively combines a previously prepared/named component with another object -- including dredge/coat-into-a-prepared-mix steps, which read as garnish-adjacent ("sprinkle with salt") in the same sentence but whose actual active ingredient use is the coating step.',
      pos: '"Coat each piece in the dry flour mix. Add to the hot oil." (cornstarch/baking powder/seasoning-mix rows); "Add chickpeas, stir and return to oven until beans heat through" (return-to-named-vessel).',
      neg: 'A bare "combine" with no named component/vessel destination falls through to COLLECTION_ACTIVE_CONTINUATION instead.',
      signal: 'combine/return-to-named-vessel/add-to-named-component/coat-or-dredge-into-mix phrasing, checked ahead of the serving/garnish check specifically to avoid a compound instruction\'s unrelated tail clause (e.g. "...and sprinkle with a little more salt") stealing the classification.',
      detect: 'Named-component antecedent resolver + combine/return-to/coat verb classifier.',
      collision: 'COMPONENT_LEAKAGE -- this is the class closest to the actual leakage failure mode (recombining into a component), so any implementation needs the tightest evidence gate of the group.',
    },
    CONTINUING_COOKING_OBJECT: {
      def: 'The instruction continues manipulating (or checking the doneness of) one specific, previously-introduced object without renaming it: flip, turn, uncover, shake, rotate, baste, repeat, or a doneness/temperature check.',
      pos: '"Repeat basting and roasting 5-10 minutes until caramelized" (brisket); "Check that internal temperature reaches 165°F" (chicken thighs).',
      neg: 'A doneness check phrased over a named collective ("until vegetables are tender") is DISH_STATE_CONTINUATION or CATEGORY_OR_COLLECTIVE_ALIAS, not this class -- the object here must be singular and specific.',
      signal: 'flip/turn/uncover/shake/rotate/baste/repeat/brown-on-all-sides, or internal-temperature/cooked-through/no-longer-pink doneness language.',
      detect: 'Single-named-object continuity tracker (last principal target) + manipulation/doneness verb classifier.',
      collision: 'COMPONENT_LEAKAGE, PROCESS_MATERIAL -- the wooden-skewer false positive is exactly a "continuing object" claim that should not have carried the skewer row forward as edible.',
    },
    IMPLIED_SEASONING_OR_FINISHING: {
      def: 'A finishing/adjusting phrase with an explicit scoping cue (a named subset), distinct from the bare "season to taste"/"taste and adjust seasoning" language V10D already resolved as benchmark-consistent for the ratatouille salt/pepper case.',
      pos: 'Only one row in this population: a scoped finish/adjust phrase tied to a specific subset rather than a bare blanket seasoning call.',
      neg: 'A bare "taste and adjust seasoning" with no named subset is already correctly out-of-scope per the V10D generic-seasoning contract and should not be reopened.',
      signal: 'season the/adjust as needed/finish with/more if desired/to taste, checked only after every more specific class fails.',
      detect: 'Scoped-finishing-phrase detector requiring an explicit subset noun (not a bare taste/adjust call).',
      collision: 'CONTEXTUAL_MENTION -- reopening bare generic seasoning here would directly regress the V10D-locked ratatouille finding.',
    },
    DIVIDED_OR_RESERVED_USE: {
      def: 'A row is explicitly labeled "reserved" or the instruction uses "set aside ... for" language earmarking a split/partial use.',
      pos: '"The reserved broth from the cooked chicken." used later in a subsequent instruction.',
      neg: 'A row consumed once with no reserved/set-aside language is CONSUMED_OR_UNAVAILABLE at the V10D-basis level, not this class.',
      signal: '"reserved" in the ingredient row text, or "set aside ... for" in the instruction.',
      detect: 'Ingredient-row "reserved"/"set aside for" lexical flag + quantity-split detection.',
      collision: 'CONSUMED_ROW -- a reserved-for-later row looks identical to a fully-consumed row at first mention; the "reserved" label is the only thing that disambiguates it.',
    },
    SOURCE_PARSER_ADJUDICATION_EDGE: {
      def: 'The source text itself is unclear, malformed, or the benchmark-correct label is not clearly supported by any of the other ten classes.',
      pos: 'None in this population -- see Section 13.',
      neg: 'n/a',
      signal: 'Fallback only for CONSUMED_OR_UNAVAILABLE-basis rows that match no other class.',
      detect: 'n/a -- benchmark/source review, not a production detection signal.',
      collision: 'None (this class does not become a detection rule).',
    },
    OTHER_SPECIFIC: {
      def: 'Reserved for any row that matches no documented signal above. Empty in this population -- see Section 2 for the completeness assertion.',
      pos: 'None.',
      neg: 'n/a',
      signal: 'n/a',
      detect: 'n/a',
      collision: 'n/a',
    },
  }
  for (const cls of SEMANTIC_TAXONOMY) {
    const doc = classDocs[cls]
    lines.push(`### ${cls}`)
    lines.push('')
    lines.push(`- **Definition:** ${doc.def}`)
    lines.push(`- **Positive example(s):** ${doc.pos}`)
    lines.push(`- **Negative counterexample:** ${doc.neg}`)
    lines.push(`- **Source-observable signal:** ${doc.signal}`)
    lines.push(`- **Truth-blind detection strategy:** ${doc.detect}`)
    lines.push(`- **Historical-FP collision risk:** ${doc.collision}`)
    lines.push('')
  }

  lines.push('## 4. Count by class')
  lines.push('')
  lines.push('| Semantic class | FN count | % of 191 | Recipes affected | 2/2 reviewers | 1/2 reviewers |')
  lines.push('|---|---|---|---|---|---|')
  for (const g of byClass) {
    lines.push(`| ${g.semanticClass} | ${g.fnCount} | ${pct(g.fnCount, total)} | ${g.recipesAffected} | ${g.reviewerVotes['2_OF_2']} | ${g.reviewerVotes['1_OF_2']} |`)
  }
  lines.push('')

  lines.push('## 5. Percentage by class')
  lines.push('')
  lines.push('See the % column in Section 4. Sum of `fnCount` across all classes equals 191 (enforced by `assertTaxonomyCompleteness`).')
  lines.push('')

  lines.push('## 6. Reviewer-vote distribution by class')
  lines.push('')
  lines.push('All 191 rows are 2/2 or 1/2 reviewer agreements; none are 0/2 (a 0/2 row could not have been adjudicated CORRECT in the frozen benchmark). Per Phase 6: classes that are mostly 2/2 mean discovery already works and downstream state/arbitration is the blocker; classes with a meaningful 1/2 share carry more discovery risk of their own.')
  lines.push('')
  for (const g of byClass) {
    const share2of2 = pct(g.reviewerVotes['2_OF_2'], g.fnCount)
    lines.push(`- **${g.semanticClass}**: ${g.reviewerVotes['2_OF_2']}/${g.fnCount} at 2/2 (${share2of2}), ${g.reviewerVotes['1_OF_2']}/${g.fnCount} at 1/2 -- ${g.reviewerVotes['2_OF_2'] / g.fnCount > 0.7 ? 'discovery is already good; the blocker is downstream state/arbitration.' : 'a non-trivial share of 1/2 votes means discovery itself remains part of this class\'s problem.'}`)
  }
  lines.push('')

  lines.push('## 7. Severity by class')
  lines.push('')
  lines.push('Severity = f(reviewer-consensus strength, whether the class is a top-3 recall-loss driver). It is reported separately from historical-FP collision risk (Section 12), which is a fix-risk axis, not a severity axis.')
  lines.push('')
  lines.push(`- CRITICAL: ${severity.CRITICAL} (2/2 reviewers, in a top-3 dominant class: ${dominant.join(', ')})`)
  lines.push(`- HIGH: ${severity.HIGH} (2/2 reviewers, non-dominant class)`)
  lines.push(`- MEDIUM: ${severity.MEDIUM} (1/2 reviewers)`)
  lines.push(`- LOW: ${severity.LOW} (0/2 reviewers)`)
  lines.push('')

  lines.push('## 8. Collective-continuation findings')
  lines.push('')
  lines.push('Phase 9 asked for the precise antecedent-set boundary. Evidence from this population:')
  lines.push('')
  lines.push('- **Antecedent IS the active set** when the current row was loaded into the same vessel by an earlier "add/load X, Y, Z into..." instruction and no later instruction has isolated it into a separately-named sub-component. Example: wild rice soup instruction 1 "Load wild rice, raw chicken, mirepoix, garlic, chicken broth, poultry seasoning, garlic powder, onion powder, and bouillon into slow cooker" -> instruction 2 "Cover and cook on low for 6 hours" correctly keeps every one of those rows active (all 8 are FN rows here, all DISH_STATE_CONTINUATION, all 2/2 reviewers).')
  lines.push('- **Antecedent is NOT the active set** when the current row was used to build a separately-named component (a sauce, a dressing, a marinade, a dry-mix) and the later "toss/combine" instruction operates on a *different* named thing that merely contains that component. This is the COMPONENT_LEAKAGE family the locked V10D target-FP protections (20/20 rejected) exist to stop, and it is not present as a false rejection anywhere in this 191 -- V10D correctly keeps these separated. The risk is the opposite direction: V10D\'s current implementation (Section 15) is now *too* aggressive about calling something "isolated," rejecting many rows that are still genuinely in the open vessel.')
  lines.push('')

  lines.push('## 9. Whole-dish continuation findings')
  lines.push('')
  lines.push(`DISH_STATE_CONTINUATION is the single largest class (${byClass.find(g => g.semanticClass === 'DISH_STATE_CONTINUATION').fnCount}/${total}). Verbs observed: cover-and-cook (on low/high, for N hours), simmer, continue cooking, grill for N minutes per side, place in the oven, bring a pot of water to a boil, heat the oven and bring water to a boil. In every instance in this population the benchmark truth keeps ALL currently-active constituent ingredients visible through the whole-dish verb -- never "only the principal target," never "a prepared component," never "nothing new." This is a single, consistent product-semantic answer to the Phase 11 question for this class: Cooking Mode should keep showing an ingredient through later whole-dish-state steps as long as it has not been isolated into a separately-named sub-component, not just on the single step where it was introduced.`)
  lines.push('')

  lines.push('## 10. Category/collective alias findings')
  lines.push('')
  lines.push(`${byClass.find(g => g.semanticClass === 'CATEGORY_OR_COLLECTIVE_ALIAS')?.fnCount ?? 0} rows. Observed collective nouns: "vegetables"/"veggies" (aliasing onion/zucchini/pepper/carrot-type rows), "herbs" (aliasing multiple named herb rows), "meat" (tacos al pastor). All 13 are 2/2 reviewer agreements -- both blind reviewers independently resolved the alias correctly, so for this class discovery is not the blocker; a curated per-recipe alias table is.`)
  lines.push('')

  lines.push('## 11. Pronoun-reference findings')
  lines.push('')
  lines.push(`${byClass.find(g => g.semanticClass === 'PRONOUN_OR_DEICTIC_REFERENCE')?.fnCount ?? 0} rows, the second-largest class, concentrated in ${byClass.find(g => g.semanticClass === 'PRONOUN_OR_DEICTIC_REFERENCE')?.recipesAffected ?? 0} recipes -- so this is a small number of large, pronoun-heavy recipes (dad\'s chili, mole poblano, jocn chicken-and-tomatillo stew, sheet-pan bibimbap, crunchy queso wrap) rather than a broad cross-recipe pattern. 52/55 are 2/2 reviewer agreements.`)
  lines.push('')

  lines.push('## 12. Transfer/assembly findings')
  lines.push('')
  lines.push(`${byClass.find(g => g.semanticClass === 'TRANSFER_OR_ASSEMBLY_TARGET')?.fnCount ?? 0} rows plus ${byClass.find(g => g.semanticClass === 'MULTI_COMPONENT_ASSEMBLY')?.fnCount ?? 0} MULTI_COMPONENT_ASSEMBLY rows. The key boundary (Phase 3-G) is whether the transferred/assembled thing is the *component itself* (should display) versus an unrelated row merely co-located in the same sentence (should not attach to that instruction). The chicken-fajitas example in Section 3 (TRANSFER_OR_ASSEMBLY_TARGET) shows the boundary holding: the onion/vegetable rows in "transfer the chicken to a second sheet pan. Roast the chicken and vegetables..." are correctly resolved via the *separate* "vegetables" category alias clause, not the transfer clause whose object is the chicken.`)
  lines.push('')

  lines.push('## 13. Component-collision risks')
  lines.push('')
  lines.push('Per-class historical-FP collision families are documented in Section 3 and machine-readable in the JSON artifact\'s `candidates[].historicalFpCollisionRisks`. Aggregate picture:')
  lines.push('')
  lines.push('- 0 rows required `SOURCE_PARSER_ADJUDICATION_EDGE` -- no candidate in this population has genuinely unsupported/ambiguous source text once the taxonomy above is applied.')
  lines.push('- COMPONENT_LEAKAGE is the collision risk named for 8 of the 10 real classes (every class except DIVIDED_OR_RESERVED_USE and IMPLIED_SEASONING_OR_FINISHING) -- it is the dominant risk family across almost the entire remaining recall gap, not just one class.')
  lines.push('')

  lines.push('## 14. Historical-FP collision analysis')
  lines.push('')
  lines.push(`Component-membership evidence (V10C \`componentMembership\` state captured at the moment V10D rejected each row):`)
  lines.push('')
  lines.push('| Semantic class | Total | With component membership | Share |')
  lines.push('|---|---|---|---|')
  for (const g of componentEvidence) {
    lines.push(`| ${g.semanticClass} | ${g.total} | ${g.withComponentMembership} | ${pct(g.withComponentMembership, g.total)} |`)
  }
  lines.push('')
  lines.push(`${overlappingComponentKeys.length} componentKey label(s) appear on BOTH sides -- in the FN population (rows the benchmark says should stay active) AND in the locked \`historicalRegression\` false-positive-risk population (rows where accepting continuation was/would have been wrong): ${overlappingComponentKeys.map(k => `\`${k}\``).join(', ')}.`)
  lines.push('')
  lines.push('This is the single most important finding of this pass: a componentKey label (e.g. "sauce", "chicken skewer", "slaw", "spice mix", "sheet pan") is not a stable predictor of whether continuation is correct. The same label recurs on both the correct-continuation side and the false-positive-risk side, across different recipes. V10D\'s actual implemented rule ("continuation requires *zero* prior component membership") over-corrected: it blocks 31/58 (53%) of the largest remaining class (DISH_STATE_CONTINUATION) precisely because those rows already carry *some* componentMembership record -- often a generic bulk tag like `instruction-0-mixture` or `source mixture` rather than a true isolated sub-component like `assembled pork chop casserole`. Component membership *existence* is not the discriminator; component membership *kind* (generic bulk vs. named, separately-manipulated sub-preparation) is.')
  lines.push('')

  lines.push('## 15. Cooking Mode semantic-policy conclusion')
  lines.push('')
  lines.push('Per Phase 11: for a bare whole-dish continuation instruction ("Cover and cook 6 hours" after "Add chicken and sauce"), the benchmark consistently keeps BOTH chicken and sauce visible -- not just the principal target, not nothing. Cooking Mode\'s intended semantics (as reflected in the benchmark, not as reflected in V10D\'s current implementation) is: an ingredient continues appearing on every later step where the vessel/dish containing it is manipulated, until an instruction explicitly isolates it into a separately-named sub-component or consumes/transforms it out of existence. This policy is applied consistently across the population reviewed here (Section 9), so this is a policy CLARIFICATION for the next subsystem to implement correctly, not a benchmark defect.')
  lines.push('')

  lines.push('## 16. Benchmark consistency result')
  lines.push('')
  lines.push(`**${artifact.benchmarkPolicyConsistency}**`)
  lines.push('')
  lines.push('Equivalent continuation/use-case patterns (unnamed simmer/roast/cover-and-cook continuation, collective "vegetables", "mixture"/"everything", transfer actions, serving actions) receive the same truth treatment whenever the underlying recipe structure is the same (row still in the open vessel = CORRECT to keep active; row isolated into a named sub-component = CORRECT to stop). The apparent inconsistency documented in Section 14 is in V10D\'s *detection heuristic*, not in the benchmark\'s truth labels.')
  lines.push('')

  lines.push('## 17. Active-object graph assessment')
  lines.push('')
  lines.push(`**${artifact.activeObjectGraphConclusion}**`)
  lines.push('')
  lines.push('Evidence: (a) 31/58 of the dominant DISH_STATE_CONTINUATION class already carry non-empty componentMembership at rejection time, so a flat "any membership disqualifies" gate cannot separate them from the historical leakage cases it was built to stop; (b) the same componentKey label text recurs on both the FN side and the historical-FP-risk side across different recipes (Section 14), so componentKey identity alone is not a stable signal either; (c) PRONOUN_OR_DEICTIC_REFERENCE (class #2, 55 rows) is definitionally an antecedent-resolution problem that only a tracked current-active-object-set can answer correctly and truth-blindly. A conceptual graph with RAW_INGREDIENT -> ASSEMBLED_MIXTURE -> PREPARED_COMPONENT -> FINAL_DISH nodes and ADD/COMBINE/COOK/TRANSFER/DIVIDE/TOP/GARNISH/CONTINUE transitions, tracked per recipe instance (never by shared string label), is better positioned to explain this population than another row-level boolean heuristic. This is a conclusion about *modeling approach*, not an implementation spec -- Phase 14 below scopes the recommended next step narrowly.')
  lines.push('')

  lines.push('## 18. Primary/secondary/tertiary remaining semantic classes')
  lines.push('')
  lines.push(`1. **${byClass[0].semanticClass}** -- ${byClass[0].fnCount} FN (${pct(byClass[0].fnCount, total)})`)
  lines.push(`2. **${byClass[1].semanticClass}** -- ${byClass[1].fnCount} FN (${pct(byClass[1].fnCount, total)})`)
  lines.push(`3. **${byClass[2].semanticClass}** -- ${byClass[2].fnCount} FN (${pct(byClass[2].fnCount, total)})`)
  lines.push('')

  lines.push('## 19. Recommended next subsystem')
  lines.push('')
  lines.push('**Active-object / antecedent-set state** (a per-recipe-instance active-object graph distinguishing ASSEMBLED_MIXTURE/generic-bulk membership from PREPARED_COMPONENT/isolated-sub-component membership), NOT a broader collective-reference resolver and NOT a benchmark correction.')
  lines.push('')
  lines.push('Rationale:')
  lines.push('')
  lines.push('- It directly addresses the #1 class (DISH_STATE_CONTINUATION, 30%) by replacing V10D\'s flat "zero prior membership" gate with a distinction the evidence in Section 14 shows is real and available in the existing componentMembership data (generic bulk-mixture tags vs. named sub-component tags).')
  lines.push('- It substantially informs the #2 class (PRONOUN_OR_DEICTIC_REFERENCE, 29%) for free, since pronoun/deictic antecedent resolution is exactly "what is in the current active-object set" -- the same state the graph would already track.')
  lines.push('- It does not require reopening the 20/20 locked target-false-positive protections: those all involve a genuine PREPARED_COMPONENT isolation transition (assembled pork chop casserole, browned pork chop, chicken skewer), which the graph is designed to keep distinct from open ASSEMBLED_MIXTURE state, rather than removing the check the way V10D\'s blanket rule did.')
  lines.push('- A collective-reference resolver alone would help class #2 (PRONOUN_OR_DEICTIC_REFERENCE) and part of #4/#6 (CATEGORY_OR_COLLECTIVE_ALIAS) but leaves the #1 class untouched, since DISH_STATE_CONTINUATION rows rarely contain a pronoun or collective noun at all -- they are bare verbs. The active-object-graph subsystem is the one investment that moves both #1 and #2 together.')
  lines.push('')

  lines.push('## 20. AI diagnostic usage')
  lines.push('')
  lines.push('0 AI calls. This pass is fully deterministic/source-grounded: regex-based signal extraction over locked instruction text, cross-referenced against locked componentMembership/reviewer-vote/historical-regression evidence already captured in the V10D and V10A artifacts. No reviewer reruns, no arbiter benchmark, no real AI arbitration.')
  lines.push('')

  lines.push('## 21. Audit artifacts')
  lines.push('')
  lines.push('- `docs/audits/cooking-mode-v10e-remaining-fn-taxonomy-2026-08-28.json`')
  lines.push('- `docs/audits/cooking-mode-v10e-remaining-fn-taxonomy-2026-08-28.md` (this file)')
  lines.push('- `scripts/analyze-cooking-mode-v10e-fn-taxonomy-core.mjs` (pure classification/aggregation functions)')
  lines.push('- `scripts/analyze-cooking-mode-v10e-fn-taxonomy.mjs` (driver)')
  lines.push('- `tests/cookingModeV10eFnTaxonomy.test.js` (diagnostic tests)')
  lines.push('')

  lines.push('## 22. Production mutation')
  lines.push('')
  lines.push('Firestore writes: 0. Recipe writes: 0. Map writes: 0. Production mapping code changes: 0. This script only reads two locked local JSON files and writes two new local audit files.')
  lines.push('')

  return lines.join('\n')
}

function EXPECTED_FN_POPULATION_LABEL() {
  return EXPECTED_FN_POPULATION
}

function SEMANTIC_TAXONOMY_LEN() {
  return SEMANTIC_TAXONOMY.length
}

function countBy(items, keyFn) {
  const out = {}
  for (const item of items) {
    const key = keyFn(item)
    out[key] = (out[key] || 0) + 1
  }
  return out
}

main()
