# Cooking Mode V10E — Remaining False-Negative Semantic Taxonomy (2026-08-28)

READ-ONLY SEMANTIC FAILURE TAXONOMY / ROOT-CAUSE DISCOVERY. No production, Firestore, or mapping-code changes in this pass.

## 1. Executive result

Verdict: **REMAINING_SEMANTIC_CLASS_ISOLATED**

All 191/191 V10D false negatives were reconstructed from the locked V10D analysis and V10A frozen-candidate artifacts and classified into 12 new source-grounded semantic classes, replacing the old `COLLECTIVE_CONTINUATION`/`OTHER` buckets. Zero rows landed in `OTHER_SPECIFIC` or required the `SOURCE_PARSER_ADJUDICATION_EDGE` fallback -- every row matched a documented, source-observable signal.

The dominant class is **DISH_STATE_CONTINUATION** (58/191, 30.37%), followed by **PRONOUN_OR_DEICTIC_REFERENCE** (55, 28.80%) and **SERVING_OR_GARNISH_ACTION** (20, 10.47%). Together the top 3 classes account for 133/191 (69.63%) of the remaining recall loss.

## 2. Exact 191-FN reconstruction

Source: `docs/audits/cooking-mode-v10d-principal-target-analysis-2026-08-28.json` `finalErrors.falseRejects` (191 rows), joined by `candidateId` against `docs/audits/cooking-mode-arbiter-v10a-frozen-candidates-2026-08-28.json` `populations.INGREDIENT_RELATIONSHIPS` + `populations.PREPARED_COMPONENT_RELATIONSHIPS` (863 + 196 rows) for title, reviewer origins, provenance class, and instruction context. All 191 candidateIds resolved against the frozen-candidate evidence with zero misses. `previousInstructionText` was derived by indexing every candidate's `instructionText`/`nextInstructionText` per recipe, since it is not stored directly on any single row.

- Reconstructed population: **191** (assert-equal to 191 enforced in code and in tests)
- Recipes affected: **27**
- v10dBasis distribution: CONTEXT_ONLY=58, PASSIVE_COMPONENT_CARRY=91, TARGET_SWITCHED=36, V10A_BASE_REJECTION=2, CONSUMED_OR_UNAVAILABLE=4

## 3. New semantic taxonomy

Each class below meets the Phase 4 actionability bar: semantic definition, positive/negative examples grounded in this recipe corpus, source-observable signal, a truth-blind detection strategy candidate, and named historical-FP collision risk.

### DIVIDED_OR_RESERVED_USE

- **Definition:** A row is explicitly labeled "reserved" or the instruction uses "set aside ... for" language earmarking a split/partial use.
- **Positive example(s):** "The reserved broth from the cooked chicken." used later in a subsequent instruction.
- **Negative counterexample:** A row consumed once with no reserved/set-aside language is CONSUMED_OR_UNAVAILABLE at the V10D-basis level, not this class.
- **Source-observable signal:** "reserved" in the ingredient row text, or "set aside ... for" in the instruction.
- **Truth-blind detection strategy:** Ingredient-row "reserved"/"set aside for" lexical flag + quantity-split detection.
- **Historical-FP collision risk:** CONSUMED_ROW -- a reserved-for-later row looks identical to a fully-consumed row at first mention; the "reserved" label is the only thing that disambiguates it.

### SERVING_OR_GARNISH_ACTION

- **Definition:** The instruction is a serve/garnish/top-with/sprinkle/drizzle presentation action, typically (not always) near the end of the recipe.
- **Positive example(s):** "Serve chicken and vegetables with tortillas and desired toppings."; "Transfer to a platter and garnish with fresh basil before serving."
- **Negative counterexample:** "Top the steak with fresh chopped herbs" mid-recipe, where "herbs" is better resolved as a collective alias to 3 specific herb rows -- classified CATEGORY_OR_COLLECTIVE_ALIAS instead, since alias resolution is the actionable signal there.
- **Source-observable signal:** Instruction-opening imperative (serve/garnish/sprinkle/drizzle) or a serve/garnish/top/sprinkle/drizzle ... with clause.
- **Truth-blind detection strategy:** Instruction-opening verb classifier + position-in-recipe heuristic (final 1-2 instructions raises confidence).
- **Historical-FP collision risk:** CONTEXTUAL_MENTION, CONSUMED_ROW -- a garnish/serving clause can mention an ingredient already fully used earlier without it being a genuine new active use.

### TRANSFER_OR_ASSEMBLY_TARGET

- **Definition:** The instruction transfers, layers, fills, rolls, folds, plates, assembles, or stuffs an existing ingredient/component into or onto something else.
- **Positive example(s):** "Transfer to oven and roast..." (ratatouille); "ASSEMBLE: Build your ideal summertime fried chicken sandwich!"
- **Negative counterexample:** "Roast the chicken and vegetables until..." after "transfer the chicken to a second sheet pan" -- the vegetables row is not the transfer target (the chicken is), so it is CATEGORY_OR_COLLECTIVE_ALIAS via "vegetables", not this class. Object-identity matters, not mere co-occurrence with a transfer verb.
- **Source-observable signal:** transfer/layer/fill/roll/fold/plate/assemble/stuff/divide-among phrasing, adjacent to "to" (not just anywhere in a long compound instruction).
- **Truth-blind detection strategy:** Transfer/assembly verb classifier + component-membership carry-through to the destination vessel.
- **Historical-FP collision risk:** COMPONENT_LEAKAGE, CONTEXTUAL_MENTION -- a transfer step can carry an unrelated named object along in the same sentence.

### MULTI_COMPONENT_ASSEMBLY

- **Definition:** The instruction actively combines a previously prepared/named component with another object -- including dredge/coat-into-a-prepared-mix steps, which read as garnish-adjacent ("sprinkle with salt") in the same sentence but whose actual active ingredient use is the coating step.
- **Positive example(s):** "Coat each piece in the dry flour mix. Add to the hot oil." (cornstarch/baking powder/seasoning-mix rows); "Add chickpeas, stir and return to oven until beans heat through" (return-to-named-vessel).
- **Negative counterexample:** A bare "combine" with no named component/vessel destination falls through to COLLECTION_ACTIVE_CONTINUATION instead.
- **Source-observable signal:** combine/return-to-named-vessel/add-to-named-component/coat-or-dredge-into-mix phrasing, checked ahead of the serving/garnish check specifically to avoid a compound instruction's unrelated tail clause (e.g. "...and sprinkle with a little more salt") stealing the classification.
- **Truth-blind detection strategy:** Named-component antecedent resolver + combine/return-to/coat verb classifier.
- **Historical-FP collision risk:** COMPONENT_LEAKAGE -- this is the class closest to the actual leakage failure mode (recombining into a component), so any implementation needs the tightest evidence gate of the group.

### PRONOUN_OR_DEICTIC_REFERENCE

- **Definition:** The instruction uses a resolvable deictic/pronoun word (everything, mixture, both, all, it, them, this, these) whose antecedent is the set of rows assembled by prior instructions.
- **Positive example(s):** "Once everything is in the pot bring a boil then turn down and simmer" (dad's chili); "Divide the rice evenly among four bowls. Now divide the vegetables evenly as well" (sheet-pan bibimbap, "the vegetables" resolved from an earlier list).
- **Negative counterexample:** "Add this to the pan" where "this" is a freshly-introduced single ingredient named two words earlier is a direct reference, not this class.
- **Source-observable signal:** Regex over everything/mixture/both/it/them/this/these, applied to the current instruction only.
- **Truth-blind detection strategy:** Pronoun/deictic detector + nearest-antecedent-set resolver, bounded to the recipe's own instruction chronology (never global).
- **Historical-FP collision risk:** COMPONENT_LEAKAGE, CONTEXTUAL_MENTION -- an unbounded antecedent resolver would also resolve "it" against isolated sub-components it should not reopen.

### CATEGORY_OR_COLLECTIVE_ALIAS

- **Definition:** The instruction uses a collective/category noun (vegetables, veggies, aromatics, spices, herbs, greens, meat, seafood, cheese) that stands in for multiple specific listed rows.
- **Positive example(s):** "Roast until vegetables are tender, chicken is cooked through..." (sheetpan gochujang chicken); "Top the steak with fresh chopped herbs" for thyme/rosemary/oregano rows.
- **Negative counterexample:** A recipe-specific proper noun like "the slaw" or "the sauce" is MULTI_COMPONENT_ASSEMBLY (a named prepared component), not a generic category alias.
- **Source-observable signal:** Curated word list matched as a whole word in the current instruction.
- **Truth-blind detection strategy:** Curated collective-noun-to-row-set alias table, scoped per recipe (never global synonym expansion).
- **Historical-FP collision risk:** COMPONENT_LEAKAGE, CONTEXTUAL_MENTION -- "vegetables" can also refer to a subset already isolated into a distinct roasted-vegetable component elsewhere in the same recipe.

### CONTINUING_COOKING_OBJECT

- **Definition:** The instruction continues manipulating (or checking the doneness of) one specific, previously-introduced object without renaming it: flip, turn, uncover, shake, rotate, baste, repeat, or a doneness/temperature check.
- **Positive example(s):** "Repeat basting and roasting 5-10 minutes until caramelized" (brisket); "Check that internal temperature reaches 165°F" (chicken thighs).
- **Negative counterexample:** A doneness check phrased over a named collective ("until vegetables are tender") is DISH_STATE_CONTINUATION or CATEGORY_OR_COLLECTIVE_ALIAS, not this class -- the object here must be singular and specific.
- **Source-observable signal:** flip/turn/uncover/shake/rotate/baste/repeat/brown-on-all-sides, or internal-temperature/cooked-through/no-longer-pink doneness language.
- **Truth-blind detection strategy:** Single-named-object continuity tracker (last principal target) + manipulation/doneness verb classifier.
- **Historical-FP collision risk:** COMPONENT_LEAKAGE, PROCESS_MATERIAL -- the wooden-skewer false positive is exactly a "continuing object" claim that should not have carried the skewer row forward as edible.

### COLLECTION_ACTIVE_CONTINUATION

- **Definition:** An explicit active-manipulation verb (stir, toss, mix well, combine well) acts on the currently assembled set as a collection, without naming a single object and without a bare passive dish-state verb.
- **Positive example(s):** "5. Remove lid, stir, and shred chicken using tongs" (garlic/oregano/cumin/tomatoes rows all still in the pot); "SLAW: Toss all your ingredients together!"
- **Negative counterexample:** "Cover and cook on low for 6 hours" has no active-manipulation verb -- DISH_STATE_CONTINUATION, not this class.
- **Source-observable signal:** stir/toss/mix well/mix together/combine well, checked before the bare dish-state fallback.
- **Truth-blind detection strategy:** Assembled-set active-object state + collection-manipulation verb classifier.
- **Historical-FP collision risk:** COMPONENT_LEAKAGE -- same risk family as dish-state continuation, one notch more permissive since it does not even require a passive verb.

### DISH_STATE_CONTINUATION

- **Definition:** The instruction is a bare, passive whole-dish/vessel continuation verb (cover and cook, simmer, bake, roast, grill, boil, reduce heat, rest, chill, refrigerate, place in the oven) with no named collection noun and no single named object -- it acts on "whatever is currently in the pot/pan/oven".
- **Positive example(s):** "Cover and cook on low for 6 hours" (wild rice soup, acting on rice/mirepoix/garlic/spices all loaded in the prior instruction); "Grill for 3-4 minutes per side" (zucchini/squash).
- **Negative counterexample:** "Stir everything together" is COLLECTION_ACTIVE_CONTINUATION (explicit active verb + explicit collective target), not this class.
- **Source-observable signal:** Regex over bare continuation verbs, checked only after every more-specific class fails to match.
- **Truth-blind detection strategy:** Vessel/dish active-object state that stays "open" (still accepting all raw/loaded rows) until an instruction explicitly isolates a subset into a named sub-component.
- **Historical-FP collision risk:** COMPONENT_LEAKAGE, CONSUMED_ROW -- loosening this to "everything currently in the vessel stays active" is exactly how the locked pork-chop-casserole and wooden-skewer false positives happened.

### IMPLIED_SEASONING_OR_FINISHING

- **Definition:** A finishing/adjusting phrase with an explicit scoping cue (a named subset), distinct from the bare "season to taste"/"taste and adjust seasoning" language V10D already resolved as benchmark-consistent for the ratatouille salt/pepper case.
- **Positive example(s):** Only one row in this population: a scoped finish/adjust phrase tied to a specific subset rather than a bare blanket seasoning call.
- **Negative counterexample:** A bare "taste and adjust seasoning" with no named subset is already correctly out-of-scope per the V10D generic-seasoning contract and should not be reopened.
- **Source-observable signal:** season the/adjust as needed/finish with/more if desired/to taste, checked only after every more specific class fails.
- **Truth-blind detection strategy:** Scoped-finishing-phrase detector requiring an explicit subset noun (not a bare taste/adjust call).
- **Historical-FP collision risk:** CONTEXTUAL_MENTION -- reopening bare generic seasoning here would directly regress the V10D-locked ratatouille finding.

### SOURCE_PARSER_ADJUDICATION_EDGE

- **Definition:** The source text itself is unclear, malformed, or the benchmark-correct label is not clearly supported by any of the other ten classes.
- **Positive example(s):** None in this population -- see Section 13.
- **Negative counterexample:** n/a
- **Source-observable signal:** Fallback only for CONSUMED_OR_UNAVAILABLE-basis rows that match no other class.
- **Truth-blind detection strategy:** n/a -- benchmark/source review, not a production detection signal.
- **Historical-FP collision risk:** None (this class does not become a detection rule).

### OTHER_SPECIFIC

- **Definition:** Reserved for any row that matches no documented signal above. Empty in this population -- see Section 2 for the completeness assertion.
- **Positive example(s):** None.
- **Negative counterexample:** n/a
- **Source-observable signal:** n/a
- **Truth-blind detection strategy:** n/a
- **Historical-FP collision risk:** n/a

## 4. Count by class

| Semantic class | FN count | % of 191 | Recipes affected | 2/2 reviewers | 1/2 reviewers |
|---|---|---|---|---|---|
| DISH_STATE_CONTINUATION | 58 | 30.37% | 9 | 27 | 31 |
| PRONOUN_OR_DEICTIC_REFERENCE | 55 | 28.80% | 5 | 52 | 3 |
| SERVING_OR_GARNISH_ACTION | 20 | 10.47% | 7 | 17 | 3 |
| TRANSFER_OR_ASSEMBLY_TARGET | 17 | 8.90% | 6 | 15 | 2 |
| COLLECTION_ACTIVE_CONTINUATION | 14 | 7.33% | 2 | 6 | 8 |
| CATEGORY_OR_COLLECTIVE_ALIAS | 13 | 6.81% | 7 | 13 | 0 |
| MULTI_COMPONENT_ASSEMBLY | 8 | 4.19% | 3 | 5 | 3 |
| CONTINUING_COOKING_OBJECT | 3 | 1.57% | 2 | 1 | 2 |
| DIVIDED_OR_RESERVED_USE | 2 | 1.05% | 1 | 2 | 0 |
| IMPLIED_SEASONING_OR_FINISHING | 1 | 0.52% | 1 | 1 | 0 |

## 5. Percentage by class

See the % column in Section 4. Sum of `fnCount` across all classes equals 191 (enforced by `assertTaxonomyCompleteness`).

## 6. Reviewer-vote distribution by class

All 191 rows are 2/2 or 1/2 reviewer agreements; none are 0/2 (a 0/2 row could not have been adjudicated CORRECT in the frozen benchmark). Per Phase 6: classes that are mostly 2/2 mean discovery already works and downstream state/arbitration is the blocker; classes with a meaningful 1/2 share carry more discovery risk of their own.

- **DISH_STATE_CONTINUATION**: 27/58 at 2/2 (46.55%), 31/58 at 1/2 -- a non-trivial share of 1/2 votes means discovery itself remains part of this class's problem.
- **PRONOUN_OR_DEICTIC_REFERENCE**: 52/55 at 2/2 (94.55%), 3/55 at 1/2 -- discovery is already good; the blocker is downstream state/arbitration.
- **SERVING_OR_GARNISH_ACTION**: 17/20 at 2/2 (85.00%), 3/20 at 1/2 -- discovery is already good; the blocker is downstream state/arbitration.
- **TRANSFER_OR_ASSEMBLY_TARGET**: 15/17 at 2/2 (88.24%), 2/17 at 1/2 -- discovery is already good; the blocker is downstream state/arbitration.
- **COLLECTION_ACTIVE_CONTINUATION**: 6/14 at 2/2 (42.86%), 8/14 at 1/2 -- a non-trivial share of 1/2 votes means discovery itself remains part of this class's problem.
- **CATEGORY_OR_COLLECTIVE_ALIAS**: 13/13 at 2/2 (100.00%), 0/13 at 1/2 -- discovery is already good; the blocker is downstream state/arbitration.
- **MULTI_COMPONENT_ASSEMBLY**: 5/8 at 2/2 (62.50%), 3/8 at 1/2 -- a non-trivial share of 1/2 votes means discovery itself remains part of this class's problem.
- **CONTINUING_COOKING_OBJECT**: 1/3 at 2/2 (33.33%), 2/3 at 1/2 -- a non-trivial share of 1/2 votes means discovery itself remains part of this class's problem.
- **DIVIDED_OR_RESERVED_USE**: 2/2 at 2/2 (100.00%), 0/2 at 1/2 -- discovery is already good; the blocker is downstream state/arbitration.
- **IMPLIED_SEASONING_OR_FINISHING**: 1/1 at 2/2 (100.00%), 0/1 at 1/2 -- discovery is already good; the blocker is downstream state/arbitration.

## 7. Severity by class

Severity = f(reviewer-consensus strength, whether the class is a top-3 recall-loss driver). It is reported separately from historical-FP collision risk (Section 12), which is a fix-risk axis, not a severity axis.

- CRITICAL: 96 (2/2 reviewers, in a top-3 dominant class: DISH_STATE_CONTINUATION, PRONOUN_OR_DEICTIC_REFERENCE, SERVING_OR_GARNISH_ACTION)
- HIGH: 43 (2/2 reviewers, non-dominant class)
- MEDIUM: 52 (1/2 reviewers)
- LOW: 0 (0/2 reviewers)

## 8. Collective-continuation findings

Phase 9 asked for the precise antecedent-set boundary. Evidence from this population:

- **Antecedent IS the active set** when the current row was loaded into the same vessel by an earlier "add/load X, Y, Z into..." instruction and no later instruction has isolated it into a separately-named sub-component. Example: wild rice soup instruction 1 "Load wild rice, raw chicken, mirepoix, garlic, chicken broth, poultry seasoning, garlic powder, onion powder, and bouillon into slow cooker" -> instruction 2 "Cover and cook on low for 6 hours" correctly keeps every one of those rows active (all 8 are FN rows here, all DISH_STATE_CONTINUATION, all 2/2 reviewers).
- **Antecedent is NOT the active set** when the current row was used to build a separately-named component (a sauce, a dressing, a marinade, a dry-mix) and the later "toss/combine" instruction operates on a *different* named thing that merely contains that component. This is the COMPONENT_LEAKAGE family the locked V10D target-FP protections (20/20 rejected) exist to stop, and it is not present as a false rejection anywhere in this 191 -- V10D correctly keeps these separated. The risk is the opposite direction: V10D's current implementation (Section 15) is now *too* aggressive about calling something "isolated," rejecting many rows that are still genuinely in the open vessel.

## 9. Whole-dish continuation findings

DISH_STATE_CONTINUATION is the single largest class (58/191). Verbs observed: cover-and-cook (on low/high, for N hours), simmer, continue cooking, grill for N minutes per side, place in the oven, bring a pot of water to a boil, heat the oven and bring water to a boil. In every instance in this population the benchmark truth keeps ALL currently-active constituent ingredients visible through the whole-dish verb -- never "only the principal target," never "a prepared component," never "nothing new." This is a single, consistent product-semantic answer to the Phase 11 question for this class: Cooking Mode should keep showing an ingredient through later whole-dish-state steps as long as it has not been isolated into a separately-named sub-component, not just on the single step where it was introduced.

## 10. Category/collective alias findings

13 rows. Observed collective nouns: "vegetables"/"veggies" (aliasing onion/zucchini/pepper/carrot-type rows), "herbs" (aliasing multiple named herb rows), "meat" (tacos al pastor). All 13 are 2/2 reviewer agreements -- both blind reviewers independently resolved the alias correctly, so for this class discovery is not the blocker; a curated per-recipe alias table is.

## 11. Pronoun-reference findings

55 rows, the second-largest class, concentrated in 5 recipes -- so this is a small number of large, pronoun-heavy recipes (dad's chili, mole poblano, jocn chicken-and-tomatillo stew, sheet-pan bibimbap, crunchy queso wrap) rather than a broad cross-recipe pattern. 52/55 are 2/2 reviewer agreements.

## 12. Transfer/assembly findings

17 rows plus 8 MULTI_COMPONENT_ASSEMBLY rows. The key boundary (Phase 3-G) is whether the transferred/assembled thing is the *component itself* (should display) versus an unrelated row merely co-located in the same sentence (should not attach to that instruction). The chicken-fajitas example in Section 3 (TRANSFER_OR_ASSEMBLY_TARGET) shows the boundary holding: the onion/vegetable rows in "transfer the chicken to a second sheet pan. Roast the chicken and vegetables..." are correctly resolved via the *separate* "vegetables" category alias clause, not the transfer clause whose object is the chicken.

## 13. Component-collision risks

Per-class historical-FP collision families are documented in Section 3 and machine-readable in the JSON artifact's `candidates[].historicalFpCollisionRisks`. Aggregate picture:

- 0 rows required `SOURCE_PARSER_ADJUDICATION_EDGE` -- no candidate in this population has genuinely unsupported/ambiguous source text once the taxonomy above is applied.
- COMPONENT_LEAKAGE is the collision risk named for 8 of the 10 real classes (every class except DIVIDED_OR_RESERVED_USE and IMPLIED_SEASONING_OR_FINISHING) -- it is the dominant risk family across almost the entire remaining recall gap, not just one class.

## 14. Historical-FP collision analysis

Component-membership evidence (V10C `componentMembership` state captured at the moment V10D rejected each row):

| Semantic class | Total | With component membership | Share |
|---|---|---|---|
| PRONOUN_OR_DEICTIC_REFERENCE | 55 | 39 | 70.91% |
| DISH_STATE_CONTINUATION | 58 | 31 | 53.45% |
| SERVING_OR_GARNISH_ACTION | 20 | 11 | 55.00% |
| MULTI_COMPONENT_ASSEMBLY | 8 | 8 | 100.00% |
| TRANSFER_OR_ASSEMBLY_TARGET | 17 | 7 | 41.18% |
| COLLECTION_ACTIVE_CONTINUATION | 14 | 6 | 42.86% |
| CATEGORY_OR_COLLECTIVE_ALIAS | 13 | 6 | 46.15% |
| CONTINUING_COOKING_OBJECT | 3 | 3 | 100.00% |
| DIVIDED_OR_RESERVED_USE | 2 | 2 | 100.00% |
| IMPLIED_SEASONING_OR_FINISHING | 1 | 1 | 100.00% |

14 componentKey label(s) appear on BOTH sides -- in the FN population (rows the benchmark says should stay active) AND in the locked `historicalRegression` false-positive-risk population (rows where accepting continuation was/would have been wrong): `assembly`, `chicken skewer`, `cooked chicken skewer`, `grilled zucchini and summer squash`, `hot mole sauce`, `mole sauce`, `quick cabbage slaw`, `reserved chicken broth`, `sauce`, `sheet pan`, `slaw`, `soaked pepper and chocolate mixture`, `spice mix`, `sure the meat mixture`.

This is the single most important finding of this pass: a componentKey label (e.g. "sauce", "chicken skewer", "slaw", "spice mix", "sheet pan") is not a stable predictor of whether continuation is correct. The same label recurs on both the correct-continuation side and the false-positive-risk side, across different recipes. V10D's actual implemented rule ("continuation requires *zero* prior component membership") over-corrected: it blocks 31/58 (53%) of the largest remaining class (DISH_STATE_CONTINUATION) precisely because those rows already carry *some* componentMembership record -- often a generic bulk tag like `instruction-0-mixture` or `source mixture` rather than a true isolated sub-component like `assembled pork chop casserole`. Component membership *existence* is not the discriminator; component membership *kind* (generic bulk vs. named, separately-manipulated sub-preparation) is.

## 15. Cooking Mode semantic-policy conclusion

Per Phase 11: for a bare whole-dish continuation instruction ("Cover and cook 6 hours" after "Add chicken and sauce"), the benchmark consistently keeps BOTH chicken and sauce visible -- not just the principal target, not nothing. Cooking Mode's intended semantics (as reflected in the benchmark, not as reflected in V10D's current implementation) is: an ingredient continues appearing on every later step where the vessel/dish containing it is manipulated, until an instruction explicitly isolates it into a separately-named sub-component or consumes/transforms it out of existence. This policy is applied consistently across the population reviewed here (Section 9), so this is a policy CLARIFICATION for the next subsystem to implement correctly, not a benchmark defect.

## 16. Benchmark consistency result

**BENCHMARK_POLICY_CONSISTENT**

Equivalent continuation/use-case patterns (unnamed simmer/roast/cover-and-cook continuation, collective "vegetables", "mixture"/"everything", transfer actions, serving actions) receive the same truth treatment whenever the underlying recipe structure is the same (row still in the open vessel = CORRECT to keep active; row isolated into a named sub-component = CORRECT to stop). The apparent inconsistency documented in Section 14 is in V10D's *detection heuristic*, not in the benchmark's truth labels.

## 17. Active-object graph assessment

**ACTIVE_OBJECT_GRAPH_SUPPORTED**

Evidence: (a) 31/58 of the dominant DISH_STATE_CONTINUATION class already carry non-empty componentMembership at rejection time, so a flat "any membership disqualifies" gate cannot separate them from the historical leakage cases it was built to stop; (b) the same componentKey label text recurs on both the FN side and the historical-FP-risk side across different recipes (Section 14), so componentKey identity alone is not a stable signal either; (c) PRONOUN_OR_DEICTIC_REFERENCE (class #2, 55 rows) is definitionally an antecedent-resolution problem that only a tracked current-active-object-set can answer correctly and truth-blindly. A conceptual graph with RAW_INGREDIENT -> ASSEMBLED_MIXTURE -> PREPARED_COMPONENT -> FINAL_DISH nodes and ADD/COMBINE/COOK/TRANSFER/DIVIDE/TOP/GARNISH/CONTINUE transitions, tracked per recipe instance (never by shared string label), is better positioned to explain this population than another row-level boolean heuristic. This is a conclusion about *modeling approach*, not an implementation spec -- Phase 14 below scopes the recommended next step narrowly.

## 18. Primary/secondary/tertiary remaining semantic classes

1. **DISH_STATE_CONTINUATION** -- 58 FN (30.37%)
2. **PRONOUN_OR_DEICTIC_REFERENCE** -- 55 FN (28.80%)
3. **SERVING_OR_GARNISH_ACTION** -- 20 FN (10.47%)

## 19. Recommended next subsystem

**Active-object / antecedent-set state** (a per-recipe-instance active-object graph distinguishing ASSEMBLED_MIXTURE/generic-bulk membership from PREPARED_COMPONENT/isolated-sub-component membership), NOT a broader collective-reference resolver and NOT a benchmark correction.

Rationale:

- It directly addresses the #1 class (DISH_STATE_CONTINUATION, 30%) by replacing V10D's flat "zero prior membership" gate with a distinction the evidence in Section 14 shows is real and available in the existing componentMembership data (generic bulk-mixture tags vs. named sub-component tags).
- It substantially informs the #2 class (PRONOUN_OR_DEICTIC_REFERENCE, 29%) for free, since pronoun/deictic antecedent resolution is exactly "what is in the current active-object set" -- the same state the graph would already track.
- It does not require reopening the 20/20 locked target-false-positive protections: those all involve a genuine PREPARED_COMPONENT isolation transition (assembled pork chop casserole, browned pork chop, chicken skewer), which the graph is designed to keep distinct from open ASSEMBLED_MIXTURE state, rather than removing the check the way V10D's blanket rule did.
- A collective-reference resolver alone would help class #2 (PRONOUN_OR_DEICTIC_REFERENCE) and part of #4/#6 (CATEGORY_OR_COLLECTIVE_ALIAS) but leaves the #1 class untouched, since DISH_STATE_CONTINUATION rows rarely contain a pronoun or collective noun at all -- they are bare verbs. The active-object-graph subsystem is the one investment that moves both #1 and #2 together.

## 20. AI diagnostic usage

0 AI calls. This pass is fully deterministic/source-grounded: regex-based signal extraction over locked instruction text, cross-referenced against locked componentMembership/reviewer-vote/historical-regression evidence already captured in the V10D and V10A artifacts. No reviewer reruns, no arbiter benchmark, no real AI arbitration.

## 21. Audit artifacts

- `docs/audits/cooking-mode-v10e-remaining-fn-taxonomy-2026-08-28.json`
- `docs/audits/cooking-mode-v10e-remaining-fn-taxonomy-2026-08-28.md` (this file)
- `scripts/analyze-cooking-mode-v10e-fn-taxonomy-core.mjs` (pure classification/aggregation functions)
- `scripts/analyze-cooking-mode-v10e-fn-taxonomy.mjs` (driver)
- `tests/cookingModeV10eFnTaxonomy.test.js` (diagnostic tests)

## 22. Production mutation

Firestore writes: 0. Recipe writes: 0. Map writes: 0. Production mapping code changes: 0. This script only reads two locked local JSON files and writes two new local audit files.
