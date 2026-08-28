# Cooking Mode recall root-cause analysis — 2026-08-28

## 1. Executive result

**ROOT CAUSE ISOLATED — MULTIPLE INDEPENDENT BOTTLENECKS**

The successful audit behavior failed to reproduce for more than one reason. Blind discovery is nondeterministic even at temperature 0, with a small stable interpretation tail. The downstream arbiter is independently overconservative and relation-insensitive. Hard safety implements overbroad lexical/state rules that remove true uses but do not cover the nine observed false-accept shapes. Recipe 190 is a separate intermittent structured-output parse failure, not a request-size limit.

## 2. Dirty-workspace status

- Branch/HEAD: `main` / `030a590d8bc17be1e53a91e29633b2904ef73d0c`
- All pre-existing changes were preserved; no reset, clean, stash, commit, or push was run.
- PRODUCTION_CURRENT: HEAD (committed baseline at 030a590d8bc17be1e53a91e29633b2904ef73d0c)
- FAILED_V6: ?? docs/audits/cooking-mode-completeness-v6-focused-validation-2026-08-27.md; ?? scripts/evaluate-cooking-step-completeness-v6-core.mjs; ?? scripts/validate-cooking-step-completeness-v6.mjs
- FAILED_V7: ?? docs/audits/cooking-mode-semantic-v7-focused-validation-2026-08-27.md; ?? docs/audits/cooking-mode-v7-focused-failure-matrix-2026-08-27.md; ?? scripts/evaluate-cooking-step-semantic-v7-core.mjs; ?? scripts/validate-cooking-step-semantic-v7.mjs
- FAILED_V8: ?? docs/audits/cooking-mode-usage-matrix-v8-design-input-2026-08-27.json; ?? docs/audits/cooking-mode-usage-matrix-v8-focused-validation-2026-08-27.md; ?? scripts/validate-cooking-step-usage-matrix-v8.mjs
- FAILED_V9:  M app/api/cooking-step-map/route.ts;  M lib/aiConfig.ts;  M lib/cookingStepMapping.ts;  M package.json;  M tests/cookingStepMappingV5.test.ts; ?? docs/audits/cooking-mode-consensus-v9-focused-validation-2026-08-28.md; ?? docs/audits/cooking-mode-consensus-v9-regression-input-2026-08-28.json; ?? lib/cookingStepBlindReviewerAi.ts; ?? lib/cookingStepMapArbiterAi.ts; ?? lib/cookingStepMapConsensus.ts; ?? scripts/validate-cooking-step-consensus-v9.mjs; ?? tests/cookingStepBlindReviewerAi.test.ts; ?? tests/cookingStepMapArbiterAi.test.ts; ?? tests/cookingStepMapConsensus.test.ts
- AUDIT_ONLY:  M PRD.md; ?? docs/audits/cooking-mode-recall-root-cause-analysis-2026-08-28.json; ?? docs/audits/cooking-mode-recall-root-cause-analysis-2026-08-28.md; ?? scripts/analyze-cooking-mode-recall-root-cause-core.mjs; ?? scripts/analyze-cooking-mode-recall-root-cause.mjs; ?? scripts/run-cooking-mode-recall-diagnostics.mjs; ?? tests/cookingModeRecallRootCauseAnalysis.test.ts
- UNRELATED:  M app/discover/page.tsx;  M app/queue/page.tsx;  M lib/recipes.ts;  M tests/cookingStepMapRoute.test.ts;  M tests/cookingStepMappingPublish.test.ts;  M tests/recipeQueueCategories.test.tsx; ?? .eslintrc.json; ?? app/error 2.tsx; ?? app/global-error 2.tsx; ?? app/loading 2.tsx; ?? lib/admin 2.ts; ?? lib/chunkItems 2.ts; ?? lib/firestoreBatch 2.ts; ?? lib/safeFetch 2.ts; ?? scripts/build-cooking-mode-v7-failure-matrix.mjs; ?? scripts/build-cooking-mode-v8-design-input.mjs; ?? tests/admin.test 2.ts; ?? tests/firestoreBatch.test 2.ts; ?? tests/ingredientParser.test 2.ts; ?? tests/safeFetch.test 2.ts
- GENERATED_DEBUG: ?? firebase-debug 2.log; ?? firebase-debug 3.log; ?? firebase-debug 4.log; ?? firebase-debug.log; ?? firestore-debug.log

## 3. Focus benchmark integrity

The exact 36-recipe focused population contains 868 adjudicated ingredient-step relationships. All 36/36 frozen live/effective source hashes matched; mismatches: 0. The complete truth table is embedded in the JSON artifact with SHA-256 `cbcaafe80ca163a60bd33ce4e9c22056be9db44c1d6d303d590111bf2ca13bb2`.

## 4. Reviewer 35-miss taxonomy

Relationship classes: {"GROUP_REFERENCE":29,"ALIAS_OR_NORMALIZATION":2,"CONTINUING_USE":2,"MAIN_INGREDIENT":1,"PREPARED_COMPONENT_CONSTITUENT":1}. Causes: {"PROMPT_INTERPRETATION":29,"MODEL_DID_NOT_NOTICE":6}.

| Recipe | Step | Ingredient | Severity/kind | Relationship class | Cause | Original A/B | Exact-contract repeat |
| --- | ---: | ---: | --- | --- | --- | --- | ---: |
| 168 | 4 | 0 | CRITICAL/MAIN_STRUCTURAL | CONTINUING_USE | MODEL_DID_NOT_NOTICE | Y/Y | 0/4 |
| 176 | 3 | 0 | CRITICAL/MAIN_STRUCTURAL | ALIAS_OR_NORMALIZATION | MODEL_DID_NOT_NOTICE | N/Y | 0/4 |
| 176 | 6 | 8 | MEDIUM/SEASONING_HERB | ALIAS_OR_NORMALIZATION | MODEL_DID_NOT_NOTICE | N/Y | 0/4 |
| 189 | 1 | 1 | CRITICAL/MAIN_STRUCTURAL | CONTINUING_USE | MODEL_DID_NOT_NOTICE | Y/Y | 1/4 |
| garlic-butter-herb-steak-bites-with-potatoes | 2 | 7 | CRITICAL/MAIN_STRUCTURAL | MAIN_INGREDIENT | MODEL_DID_NOT_NOTICE | Y/N | 0/4 |
| mediterranean-grilled-salmon | 11 | 6 | HIGH/SUBSTANTIAL | PREPARED_COMPONENT_CONSTITUENT | MODEL_DID_NOT_NOTICE | Y/Y | 4/4 |
| mole-poblano | 1 | 1 | CRITICAL/MAIN_STRUCTURAL | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 2 | HIGH/SUBSTANTIAL | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 3 | MEDIUM/SEASONING_HERB | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 4 | MEDIUM/SEASONING_HERB | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 5 | MEDIUM/SEASONING_HERB | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 7 | CRITICAL/MAIN_STRUCTURAL | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 8 | CRITICAL/MAIN_STRUCTURAL | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 9 | CRITICAL/MAIN_STRUCTURAL | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 10 | MEDIUM/SEASONING_HERB | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 11 | MEDIUM/SEASONING_HERB | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 12 | MEDIUM/SEASONING_HERB | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 13 | MEDIUM/SEASONING_HERB | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 14 | MEDIUM/SEASONING_HERB | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 15 | MEDIUM/SEASONING_HERB | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 16 | MEDIUM/SEASONING_HERB | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 17 | HIGH/SUBSTANTIAL | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 18 | HIGH/SUBSTANTIAL | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 19 | HIGH/SUBSTANTIAL | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 20 | HIGH/SUBSTANTIAL | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 21 | HIGH/SUBSTANTIAL | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 22 | HIGH/SUBSTANTIAL | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 23 | MEDIUM/SEASONING_HERB | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 24 | HIGH/SUBSTANTIAL | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 25 | MEDIUM/SEASONING_HERB | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 26 | HIGH/SUBSTANTIAL | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 27 | HIGH/SUBSTANTIAL | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 28 | HIGH/SUBSTANTIAL | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 29 | HIGH/SUBSTANTIAL | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |
| mole-poblano | 1 | 30 | MEDIUM/SEASONING_HERB | GROUP_REFERENCE | PROMPT_INTERPRETATION | Y/Y | 4/4 |

## 5. Original-audit vs fresh-review comparison

All 35 fresh misses were found by at least one stored original reviewer; zero were missed by both original reviewers. Original reviewers both found 32, A-only found 1, and B-only found 2. Therefore the 99.93% audit result did not come from later adjudication rescuing these 35: the stored blind calls themselves found them.

## 6. Prompt/schema/invocation diff

- System prompt: byte-identical (2148 bytes; SHA-256 `d5a93fa883fadba9213708e10e94e232350d162ec6e7cc72b0a8909a51027a29`).
- User prompt construction, title/group/header formatting, and numbering: byte-identical for all 36 recipes.
- Schema: only V9's nonempty minimum for component labels differs; ingredient fields/enums/maxima are identical.
- Same provider/model/temperature/120s timeout/helper and no explicit output-token limit.
- Provable invocation differences: feature, user, and prompt-version tags; concurrency 3→2; V9 retries all thrown errors while the audit retries only transient-classified errors.
- V9 normalizes/deduplicates validated output more aggressively, after generation. None of these differences constrains the 35 ingredient relationships.

## 7. Reviewer reproducibility experiment

Ten recipes × four calls completed with 0 failed calls. Among the 35 target misses: {"4/4":30,"0/4":4,"1/4":1}. All 29 mole-poblano group-reference misses and the tzatziki miss returned 4/4; the egg continuing-use miss returned 1/4; four relationships remained 0/4. Temperature 0 is not deterministic, but the current behavior also has a stable interpretation tail.

## 8. Reviewer A metrics

| Reviewer A only | 780 | 20 | 88 | 97.50% | 89.86% | 93.53% |

## 9. Reviewer B metrics

| Reviewer B only | 816 | 17 | 52 | 97.96% | 94.01% | 95.94% |

## 10. Reviewer union metrics

| Union | 833 | 28 | 35 | 96.75% | 95.97% | 96.36% |

## 11. Reviewer intersection metrics

| Intersection | 763 | 9 | 105 | 98.83% | 87.90% | 93.05% |

## 12. 2/2 versus 1/2 vote precision

- 2/2: 763 TP / 9 FP; precision 98.83%; recall contribution 87.90%.
- 1/2: 70 TP / 19 FP; precision 78.65%; recall contribution 8.06%.
- 2/2 is high-confidence but not effectively perfect: it contains nine false positives.

## 13. Arbiter 108-false-rejection taxonomy

Taxonomy: {"ARBITER_LIFECYCLE_CONFUSION":41,"ARBITER_OVERCONSERVATIVE_ACTIVE_USE":24,"ARBITER_COMPONENT_CONFUSION":23,"ARBITER_GROUP_CONFUSION":11,"ARBITER_ALIAS_CONFUSION":9}. False-rejection rates: both reviewers 64/763 (8.39%), single reviewer 44/70 (62.86%), deterministic-only 0/0 (n/a). 82 rejected rows retained nonblank evidence and 26 were blank.

| Recipe | Relation | Origin | Classification | Arbiter evidence |
| --- | --- | --- | --- | --- |
| 152 | 0:0 | BOTH_REVIEWERS | ARBITER_OVERCONSERVATIVE_ACTIVE_USE | (blank) |
| 152 | 0:1 | BOTH_REVIEWERS | ARBITER_OVERCONSERVATIVE_ACTIVE_USE | (blank) |
| 152 | 0:2 | BOTH_REVIEWERS | ARBITER_OVERCONSERVATIVE_ACTIVE_USE | (blank) |
| 152 | 0:3 | BOTH_REVIEWERS | ARBITER_OVERCONSERVATIVE_ACTIVE_USE | (blank) |
| 152 | 0:4 | BOTH_REVIEWERS | ARBITER_OVERCONSERVATIVE_ACTIVE_USE | (blank) |
| 152 | 0:5 | BOTH_REVIEWERS | ARBITER_OVERCONSERVATIVE_ACTIVE_USE | (blank) |
| 152 | 0:6 | BOTH_REVIEWERS | ARBITER_OVERCONSERVATIVE_ACTIVE_USE | (blank) |
| 152 | 0:7 | BOTH_REVIEWERS | ARBITER_OVERCONSERVATIVE_ACTIVE_USE | (blank) |
| 152 | 0:8 | BOTH_REVIEWERS | ARBITER_OVERCONSERVATIVE_ACTIVE_USE | (blank) |
| 152 | 1:1 | BOTH_REVIEWERS | ARBITER_OVERCONSERVATIVE_ACTIVE_USE | (blank) |
| 164 | 4:0 | BOTH_REVIEWERS | ARBITER_LIFECYCLE_CONFUSION | Cover and continue cooking for 2 hours |
| 164 | 4:1 | BOTH_REVIEWERS | ARBITER_LIFECYCLE_CONFUSION | Cover and continue cooking for 2 hours |
| 164 | 4:2 | BOTH_REVIEWERS | ARBITER_LIFECYCLE_CONFUSION | Cover and continue cooking for 2 hours |
| 164 | 4:3 | BOTH_REVIEWERS | ARBITER_LIFECYCLE_CONFUSION | Cover and continue cooking for 2 hours |
| 164 | 4:4 | BOTH_REVIEWERS | ARBITER_LIFECYCLE_CONFUSION | Cover and continue cooking for 2 hours |
| 164 | 4:5 | BOTH_REVIEWERS | ARBITER_LIFECYCLE_CONFUSION | Cover and continue cooking for 2 hours |
| 164 | 4:6 | BOTH_REVIEWERS | ARBITER_LIFECYCLE_CONFUSION | Cover and continue cooking for 2 hours |
| 164 | 4:7 | BOTH_REVIEWERS | ARBITER_LIFECYCLE_CONFUSION | Cover and continue cooking for 2 hours |
| 164 | 4:8 | BOTH_REVIEWERS | ARBITER_LIFECYCLE_CONFUSION | Cover and continue cooking for 2 hours |
| 168 | 0:1 | BOTH_REVIEWERS | ARBITER_OVERCONSERVATIVE_ACTIVE_USE | (blank) |
| 168 | 0:2 | BOTH_REVIEWERS | ARBITER_OVERCONSERVATIVE_ACTIVE_USE | (blank) |
| 168 | 0:3 | BOTH_REVIEWERS | ARBITER_OVERCONSERVATIVE_ACTIVE_USE | (blank) |
| 168 | 0:4 | BOTH_REVIEWERS | ARBITER_OVERCONSERVATIVE_ACTIVE_USE | (blank) |
| 168 | 0:5 | BOTH_REVIEWERS | ARBITER_OVERCONSERVATIVE_ACTIVE_USE | (blank) |
| 168 | 0:6 | BOTH_REVIEWERS | ARBITER_OVERCONSERVATIVE_ACTIVE_USE | (blank) |
| 168 | 0:7 | BOTH_REVIEWERS | ARBITER_OVERCONSERVATIVE_ACTIVE_USE | (blank) |
| 168 | 0:8 | BOTH_REVIEWERS | ARBITER_OVERCONSERVATIVE_ACTIVE_USE | (blank) |
| 173 | 3:0 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | Cook on high for 4 hours with lid on |
| 173 | 3:1 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | Cook on high for 4 hours with lid on |
| 173 | 3:2 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | Cook on high for 4 hours with lid on |
| 173 | 3:3 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | Cook on high for 4 hours with lid on |
| 173 | 3:4 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | Cook on high for 4 hours with lid on |
| 173 | 3:5 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | Cook on high for 4 hours with lid on |
| 173 | 3:6 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | Cook on high for 4 hours with lid on |
| 173 | 3:7 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | Cook on high for 4 hours with lid on |
| 173 | 3:8 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | Cook on high for 4 hours with lid on |
| 173 | 3:9 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | Cook on high for 4 hours with lid on |
| 173 | 3:10 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | Cook on high for 4 hours with lid on |
| 173 | 4:1 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | shred chicken using tongs |
| 173 | 4:2 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | shred chicken using tongs |
| 173 | 4:3 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | shred chicken using tongs |
| 173 | 4:4 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | shred chicken using tongs |
| 173 | 4:5 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | shred chicken using tongs |
| 173 | 4:6 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | shred chicken using tongs |
| 173 | 4:7 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | shred chicken using tongs |
| 173 | 4:8 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | shred chicken using tongs |
| 173 | 4:9 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | shred chicken using tongs |
| 173 | 4:10 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | shred chicken using tongs |
| 173 | 5:0 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | Simmer uncovered 15 minutes if thicker consistency desired |
| 173 | 5:1 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | Simmer uncovered 15 minutes if thicker consistency desired |
| 173 | 5:2 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | Simmer uncovered 15 minutes if thicker consistency desired |
| 173 | 5:3 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | Simmer uncovered 15 minutes if thicker consistency desired |
| 173 | 5:4 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | Simmer uncovered 15 minutes if thicker consistency desired |
| 173 | 5:5 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | Simmer uncovered 15 minutes if thicker consistency desired |
| 173 | 5:6 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | Simmer uncovered 15 minutes if thicker consistency desired |
| 173 | 5:7 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | Simmer uncovered 15 minutes if thicker consistency desired |
| 173 | 5:8 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | Simmer uncovered 15 minutes if thicker consistency desired |
| 173 | 5:9 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | Simmer uncovered 15 minutes if thicker consistency desired |
| 173 | 5:10 | SINGLE_REVIEWER | ARBITER_LIFECYCLE_CONFUSION | Simmer uncovered 15 minutes if thicker consistency desired |
| chicken-tikka | 6:15 | SINGLE_REVIEWER | ARBITER_OVERCONSERVATIVE_ACTIVE_USE | place skewers on a baking sheet and cook for 15-18 minutes, turning once halfway through |
| crunchy-queso-wrap | 5:19 | BOTH_REVIEWERS | ARBITER_ALIAS_CONFUSION | (blank) |
| crunchy-queso-wrap | 6:16 | SINGLE_REVIEWER | ARBITER_ALIAS_CONFUSION | set it on top of your salsa |
| dads-chili | 0:19 | BOTH_REVIEWERS | ARBITER_ALIAS_CONFUSION | (blank) |
| dads-chili | 2:3 | BOTH_REVIEWERS | ARBITER_ALIAS_CONFUSION | (blank) |
| dads-chili | 3:8 | BOTH_REVIEWERS | ARBITER_ALIAS_CONFUSION | (blank) |
| fried-chicken-sandwich | 3:6 | SINGLE_REVIEWER | ARBITER_COMPONENT_CONFUSION | Coat each piece in the dry flour mix |
| fried-chicken-sandwich | 3:7 | SINGLE_REVIEWER | ARBITER_COMPONENT_CONFUSION | Coat each piece in the dry flour mix |
| fried-chicken-sandwich | 3:8 | SINGLE_REVIEWER | ARBITER_COMPONENT_CONFUSION | Coat each piece in the dry flour mix |
| fried-chicken-sandwich | 3:10 | SINGLE_REVIEWER | ARBITER_COMPONENT_CONFUSION | Coat each piece in the dry flour mix |
| fried-chicken-sandwich | 4:1 | SINGLE_REVIEWER | ARBITER_OVERCONSERVATIVE_ACTIVE_USE | Build your ideal summertime fried chicken sandwich! |
| fried-chicken-sandwich | 5:1 | SINGLE_REVIEWER | ARBITER_OVERCONSERVATIVE_ACTIVE_USE | You can use small chicken pieces, large chicken breasts that have been pounded thin |
| grilled-fish-tacos | 7:0 | BOTH_REVIEWERS | ARBITER_GROUP_CONFUSION | Place the plate of cooked fish near the pico, white salsa, avocado, and cabbage |
| grilled-fish-tacos | 7:4 | BOTH_REVIEWERS | ARBITER_GROUP_CONFUSION | Place the plate of cooked fish near the pico, white salsa, avocado, and cabbage |
| jocn-chicken-and-tomatillo-stew | 1:4 | BOTH_REVIEWERS | ARBITER_GROUP_CONFUSION | (blank) |
| jocn-chicken-and-tomatillo-stew | 1:5 | BOTH_REVIEWERS | ARBITER_GROUP_CONFUSION | (blank) |
| jocn-chicken-and-tomatillo-stew | 5:0 | BOTH_REVIEWERS | ARBITER_GROUP_CONFUSION | the ground seed mixture |
| jocn-chicken-and-tomatillo-stew | 5:1 | BOTH_REVIEWERS | ARBITER_GROUP_CONFUSION | the ground seed mixture |
| jocn-chicken-and-tomatillo-stew | 5:9 | BOTH_REVIEWERS | ARBITER_GROUP_CONFUSION | Add the garlic mixture |
| jocn-chicken-and-tomatillo-stew | 5:10 | BOTH_REVIEWERS | ARBITER_GROUP_CONFUSION | Add the garlic mixture |
| mapo-rag-crazy-good | 2:5 | BOTH_REVIEWERS | ARBITER_OVERCONSERVATIVE_ACTIVE_USE | If using the rice cakes, put a large pot of salted water over high heat, and bring to a boil. |
| mexican-oaxacan-bowl | 6:11 | BOTH_REVIEWERS | ARBITER_ALIAS_CONFUSION | Slice the avocado. |
| mexican-oaxacan-bowl | 7:11 | BOTH_REVIEWERS | ARBITER_ALIAS_CONFUSION | top with slaw and add the avocado. |
| mexican-oaxacan-bowl | 8:11 | BOTH_REVIEWERS | ARBITER_ALIAS_CONFUSION | Serve with the Chipotle Mayo ( vegan-adaptable) or Vegan Avocado sauce if you like |
| mole-poblano | 8:17 | BOTH_REVIEWERS | ARBITER_OVERCONSERVATIVE_ACTIVE_USE | (blank) |
| mole-poblano | 13:7 | BOTH_REVIEWERS | ARBITER_COMPONENT_CONFUSION | blend the fried ingredients |
| mole-poblano | 13:8 | BOTH_REVIEWERS | ARBITER_COMPONENT_CONFUSION | blend the fried ingredients |
| mole-poblano | 13:9 | BOTH_REVIEWERS | ARBITER_COMPONENT_CONFUSION | blend the fried ingredients |
| mole-poblano | 13:10 | BOTH_REVIEWERS | ARBITER_COMPONENT_CONFUSION | Gradually add the spice mixture |
| mole-poblano | 13:11 | BOTH_REVIEWERS | ARBITER_COMPONENT_CONFUSION | Gradually add the spice mixture |
| mole-poblano | 13:12 | BOTH_REVIEWERS | ARBITER_COMPONENT_CONFUSION | Gradually add the spice mixture |
| mole-poblano | 13:13 | BOTH_REVIEWERS | ARBITER_COMPONENT_CONFUSION | Gradually add the spice mixture |
| mole-poblano | 13:14 | BOTH_REVIEWERS | ARBITER_COMPONENT_CONFUSION | Gradually add the spice mixture |
| mole-poblano | 13:15 | BOTH_REVIEWERS | ARBITER_COMPONENT_CONFUSION | Gradually add the spice mixture |
| mole-poblano | 13:16 | BOTH_REVIEWERS | ARBITER_COMPONENT_CONFUSION | Gradually add the spice mixture |
| mole-poblano | 13:17 | BOTH_REVIEWERS | ARBITER_COMPONENT_CONFUSION | blend the fried ingredients |
| mole-poblano | 13:18 | BOTH_REVIEWERS | ARBITER_COMPONENT_CONFUSION | blend the fried ingredients |
| mole-poblano | 13:20 | BOTH_REVIEWERS | ARBITER_COMPONENT_CONFUSION | blend the fried ingredients |
| mole-poblano | 13:21 | BOTH_REVIEWERS | ARBITER_COMPONENT_CONFUSION | blend the fried ingredients |
| mole-poblano | 13:22 | BOTH_REVIEWERS | ARBITER_COMPONENT_CONFUSION | blend the fried ingredients |
| mole-poblano | 13:23 | BOTH_REVIEWERS | ARBITER_COMPONENT_CONFUSION | blend the fried ingredients |
| mole-poblano | 13:24 | BOTH_REVIEWERS | ARBITER_COMPONENT_CONFUSION | blend the fried ingredients |
| mole-poblano | 13:26 | BOTH_REVIEWERS | ARBITER_COMPONENT_CONFUSION | blend the fried ingredients |
| mole-poblano | 13:27 | BOTH_REVIEWERS | ARBITER_COMPONENT_CONFUSION | blend the fried ingredients |
| pearl-couscous-with-creamy-feta-and-chickpeas-meh | 2:8 | SINGLE_REVIEWER | ARBITER_ALIAS_CONFUSION | fold in couscous, chickpeas and hot stock mixture |
| sheet-pan-bibimbap | 1:0 | BOTH_REVIEWERS | ARBITER_OVERCONSERVATIVE_ACTIVE_USE | (blank) |
| tacos-al-pastor | 9:15 | SINGLE_REVIEWER | ARBITER_GROUP_CONFUSION | Blend with the rest of the ingredients except the salt and pepper until well combined. |
| tacos-al-pastor | 9:16 | SINGLE_REVIEWER | ARBITER_GROUP_CONFUSION | Blend with the rest of the ingredients except the salt and pepper until well combined. |
| tacos-al-pastor | 9:17 | SINGLE_REVIEWER | ARBITER_GROUP_CONFUSION | Blend with the rest of the ingredients except the salt and pepper until well combined. |

## 14. Arbiter nine-false-accept taxonomy

All nine were absent from deterministic-v5; V5's conservative generation avoided them, but V9 hard safety had no equivalent rejection rule.

| Recipe | Relation | Origin | Classification | Arbiter evidence |
| --- | --- | --- | --- | --- |
| 157 | 4:0 | SINGLE_REVIEWER | CONSUMED_ROW | Cover and cook on HIGH for 3.5 hours |
| chickpea-and-fennel-ratatouille | 1:7 | BOTH_REVIEWERS | CONSUMED_ROW | Transfer to oven and roast, stirring occasionally. |
| chickpea-and-fennel-ratatouille | 1:8 | BOTH_REVIEWERS | CONSUMED_ROW | Transfer to oven and roast, stirring occasionally. |
| chickpea-and-fennel-ratatouille | 1:9 | BOTH_REVIEWERS | CONSUMED_ROW | Transfer to oven and roast, stirring occasionally. |
| chickpea-and-fennel-ratatouille | 2:7 | BOTH_REVIEWERS | CONTEXTUAL_MENTION | Taste and adjust seasoning |
| chickpea-and-fennel-ratatouille | 2:8 | BOTH_REVIEWERS | CONTEXTUAL_MENTION | Taste and adjust seasoning |
| cucumber-tomato-salad-with-red-wine-vinaigrette | 2:0 | BOTH_REVIEWERS | COMPONENT_LEAKAGE | Pour the dressing over the salad and toss to combine. |
| cucumber-tomato-salad-with-red-wine-vinaigrette | 2:1 | BOTH_REVIEWERS | COMPONENT_LEAKAGE | Pour the dressing over the salad and toss to combine. |
| cucumber-tomato-salad-with-red-wine-vinaigrette | 2:2 | BOTH_REVIEWERS | COMPONENT_LEAKAGE | Pour the dressing over the salad and toss to combine. |

## 15. Hard-safety 65-false-rejection taxonomy

{"NEGATIVE_CONTEXT":32,"QUANTITY":13,"COMPONENT_CONTAINMENT":6,"ROW_LIFECYCLE":6,"PROCESS_MATERIAL":4,"PURPOSE":4}

| Recipe | Relation | Exact rule | Class |
| --- | --- | --- | --- |
| 152 | 1:4 | finished-dish-or-compound-name-collision | PURPOSE |
| 152 | 5:12 | fresh-process-material-hijack | PROCESS_MATERIAL |
| chicken-fajitas | 0:0 | quantity-contradiction | QUANTITY |
| chicken-fajitas | 1:0 | quantity-contradiction | QUANTITY |
| chicken-tikka | 0:9 | finished-dish-or-compound-name-collision | PURPOSE |
| chickpea-and-fennel-ratatouille | 0:0 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| chickpea-and-fennel-ratatouille | 0:1 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| chickpea-and-fennel-ratatouille | 0:2 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| chickpea-and-fennel-ratatouille | 0:3 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| chickpea-and-fennel-ratatouille | 0:4 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| chickpea-and-fennel-ratatouille | 0:5 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| chickpea-and-fennel-ratatouille | 0:6 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| chickpea-and-fennel-ratatouille | 0:7 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| chickpea-and-fennel-ratatouille | 0:8 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| chopped-thai-shrimp-salad-with-garlic-lime-dressing | 0:0 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| chopped-thai-shrimp-salad-with-garlic-lime-dressing | 0:1 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| chopped-thai-shrimp-salad-with-garlic-lime-dressing | 0:2 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| chopped-thai-shrimp-salad-with-garlic-lime-dressing | 0:3 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| chopped-thai-shrimp-salad-with-garlic-lime-dressing | 0:4 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| chopped-thai-shrimp-salad-with-garlic-lime-dressing | 0:5 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| chopped-thai-shrimp-salad-with-garlic-lime-dressing | 0:6 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| crunchy-queso-wrap | 1:4 | consumed-row-reused-without-explicit-reuse | ROW_LIFECYCLE |
| crunchy-queso-wrap | 2:14 | quantity-contradiction | QUANTITY |
| crunchy-queso-wrap | 2:16 | quantity-contradiction | QUANTITY |
| fried-chicken-sandwich | 1:6 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| fried-chicken-sandwich | 1:7 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| fried-chicken-sandwich | 1:8 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| fried-chicken-sandwich | 1:9 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| fried-chicken-sandwich | 1:10 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| fried-chicken-sandwich | 2:13 | prepared-component-constituent-leakage | COMPONENT_CONTAINMENT |
| fried-chicken-sandwich | 2:14 | prepared-component-constituent-leakage | COMPONENT_CONTAINMENT |
| fried-chicken-sandwich | 2:15 | prepared-component-constituent-leakage | COMPONENT_CONTAINMENT |
| fried-chicken-sandwich | 2:16 | prepared-component-constituent-leakage | COMPONENT_CONTAINMENT |
| fried-chicken-sandwich | 2:17 | prepared-component-constituent-leakage | COMPONENT_CONTAINMENT |
| fried-chicken-sandwich | 2:18 | prepared-component-constituent-leakage | COMPONENT_CONTAINMENT |
| garlic-butter-herb-steak-bites-with-potatoes | 0:0 | fresh-process-material-hijack | PROCESS_MATERIAL |
| grilled-fish-tacos | 1:2 | finished-dish-or-compound-name-collision | PURPOSE |
| grilled-fish-tacos | 4:0 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| grilled-fish-tacos | 4:4 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| grilled-fish-tacos | 4:5 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| mapo-rag-crazy-good | 3:7 | quantity-contradiction | QUANTITY |
| mole-poblano | 0:2 | finished-dish-or-compound-name-collision | PURPOSE |
| mole-poblano | 6:10 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| mole-poblano | 6:13 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| mole-poblano | 6:14 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| mole-poblano | 7:15 | quantity-contradiction | QUANTITY |
| mole-poblano | 10:29 | consumed-row-reused-without-explicit-reuse | ROW_LIFECYCLE |
| mole-poblano | 11:29 | consumed-row-reused-without-explicit-reuse | ROW_LIFECYCLE |
| mole-poblano | 12:20 | consumed-row-reused-without-explicit-reuse | ROW_LIFECYCLE |
| mole-poblano | 12:21 | consumed-row-reused-without-explicit-reuse | ROW_LIFECYCLE |
| mole-poblano | 12:24 | consumed-row-reused-without-explicit-reuse | ROW_LIFECYCLE |
| mole-poblano | 13:25 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| onepot-chicken-and-lentil | 4:4 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| onepot-chicken-and-rice-with-caramelized-lemon | 0:2 | quantity-contradiction | QUANTITY |
| onepot-chicken-and-rice-with-caramelized-lemon | 3:2 | quantity-contradiction | QUANTITY |
| pearl-couscous-with-creamy-feta-and-chickpeas-meh | 1:8 | fresh-process-material-hijack | PROCESS_MATERIAL |
| pearl-couscous-with-creamy-feta-and-chickpeas-meh | 4:7 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| roasted-white-bean-and-tomato-pasta | 1:1 | quantity-contradiction | QUANTITY |
| roasted-white-bean-and-tomato-pasta | 1:3 | quantity-contradiction | QUANTITY |
| roasted-white-bean-and-tomato-pasta | 2:1 | quantity-contradiction | QUANTITY |
| roasted-white-bean-and-tomato-pasta | 6:1 | fresh-process-material-hijack | PROCESS_MATERIAL |
| sheet-pan-bibimbap | 1:4 | quantity-contradiction | QUANTITY |
| sheet-pan-bibimbap | 2:4 | quantity-contradiction | QUANTITY |
| tacos-al-pastor | 9:18 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |
| tacos-al-pastor | 9:19 | negative-or-deferred-evidence | NEGATIVE_CONTEXT |

Each rule needs the discriminating evidence stored row-by-row in the JSON artifact. The repeated defect is lexical rejection without sufficient grammatical scope, quantity allocation, lifecycle, or component-establishment state.

## 16. Hard-safety nine-FP trace

All nine ran through every current check and ended `accepted-and-safe`. The pork-chop and ratatouille errors require row-lifecycle plus relation-specific active-use semantics. The three salad-constituent errors require component containment for ungrouped components; the current check only considers ingredient-group membership. This is missing context/rules, not an evidence bypass.

## 17. Layer ablation table

| Variant | TP | FP | FN | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Reviewer A only | 780 | 20 | 88 | 97.50% | 89.86% | 93.53% |
| Reviewer B only | 816 | 17 | 52 | 97.96% | 94.01% | 95.94% |
| Intersection | 763 | 9 | 105 | 98.83% | 87.90% | 93.05% |
| Union | 833 | 28 | 35 | 96.75% | 95.97% | 96.36% |
| Union + arbiter | 722 | 9 | 146 | 98.77% | 83.18% | 90.31% |
| Union + hard safety | 714 | 28 | 154 | 96.23% | 82.26% | 88.70% |
| Union + arbiter + hard safety | 657 | 9 | 211 | 98.65% | 75.69% | 85.66% |

`Union + arbiter` and later stages include the deterministic candidate pool and recipe-190 deterministic fallback, matching V9 execution. `Union + hard safety` accepts the complete pool and runs the exact current safety implementation with the full source instruction as evidence.

## 18. Prepared-component standalone analysis

Expected components: 165. Stage metrics:

| Stage | TP | FP | FN | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| a | 75 | 56 | 90 | 57.25% | 45.45% | 50.68% |
| b | 75 | 55 | 90 | 57.69% | 45.45% | 50.85% |
| intersection | 47 | 16 | 118 | 74.60% | 28.48% | 41.23% |
| union | 103 | 95 | 62 | 52.02% | 62.42% | 56.75% |
| pool | 75 | 121 | 90 | 38.27% | 45.45% | 41.55% |
| arbiter | 53 | 15 | 112 | 77.94% | 32.12% | 45.49% |
| safety | 52 | 16 | 113 | 76.47% | 31.52% | 44.64% |

Failure taxonomy: {"LABEL_VARIATION":67,"ARBITER_REJECTION":29,"COMPONENT_NOT_PROPOSED":17}. Prepared components remain label- and lifecycle-sensitive and should not be evaluated as raw ingredient indexes.

## 19. Recipe 190 structured-output diagnosis

Recipe 190 has 3 ingredients, 4 instructions, 4 candidate relationships, 0 component candidates, and an approximately 2,143-byte arbiter prompt. Both reviewers succeeded. The original arbiter failed parsing twice; four new bounded calls produced 1 success and 3 parse failures. This rules out schema complexity, token/output limits, transport size, and malformed source. The supported diagnosis is intermittent model/provider structured-output serialization/parsing; raw failed text was not exposed.

## 20. Gateway/model metadata comparison

**NO PROVABLE DIFFERENCE** in provider or named model. Both used Vercel AI Gateway, `openai/gpt-5.6-luna`, and temperature 0. No provider revision, request ID, original SDK version, or raw failed response was stored. Invocation tags and concurrency differ, but no model revision change can be claimed.

## 21. Primary bottleneck classification

**MULTIPLE INDEPENDENT BOTTLENECKS.** Reviewers cap discovery at 95.97% in V9; arbitration then rejects 108 correct candidates and accepts nine incorrect ones; hard safety rejects another 65 correct accepts and blocks none of those nine; transport can invalidate a whole recipe independently.

| Layer | Contribution to FN | Contribution to FP | Reproducible? | Primary issue? |
| --- | ---: | ---: | --- | --- |
| Blind reviewers | 35 discovery misses | 28 union FP | Mixed: 30/35 recovered 4/4, 1 recovered 1/4, 4 recovered 0/4 | Yes, discovery ceiling |
| Arbiter | 108 rejected + 4 unavailable candidates | 9 accepts | Stored run exact; relation decisions not rerun | Yes, largest single downstream recall loss |
| Hard safety | 65 rejected correct accepts | 0/9 observed FP blocked | Fully deterministic | Yes, independently harmful frontier shift |
| Prepared components | 113 final misses | 16 final FP | Label-sensitive | Yes, separate semantics |
| Structured transport | Recipe 190 fallback loses 3 reviewer-discovered relations versus its 1 deterministic TP | 0 | Intermittent: 1/4 bounded success | Reliability blocker |

## 22. Layer keep/remove/rethink recommendation

- Retain blind reviews as discovery evidence, with explicit acknowledgement that 2× temperature-0 calls are neither deterministic nor sufficient for the stable 0/4 tail.
- Redesign the arbiter next. It is the largest downstream FN contributor, accepts generic action evidence that does not prove the candidate row, and rejects source-supported continuing/group/component relationships.
- Rethink hard safety rather than carrying its current lexical rules forward. Its observed marginal effect is 65 additional FNs and zero blocked observed FPs.
- Separate prepared-component identity/establishment/lifecycle evaluation from raw ingredient voting.
- Harden structured transport independently with parse observability and bounded recovery; recipe 190 is not a size problem.

## 23. Audit artifact paths

- `docs/audits/cooking-mode-recall-root-cause-analysis-2026-08-28.json`
- `docs/audits/cooking-mode-recall-root-cause-analysis-2026-08-28.md`

## 24. Production mutation

Firestore writes: **0**. Map writes: **0**. Recipe writes: **0**.

## 25. AI diagnostic usage

40 successful reviewer calls used the exact audit contract: 48748 input / 88102 output / 136850 total tokens. Recipe 190 had four arbiter attempts, one successful call with recorded usage and three pre-usage parse failures. Full per-call details are in the JSON artifact.

## 26. Tests/build/lint

Diagnostic tests: 6/6 passed. Repository tests: 854 passed / 1 skipped (855 total). Lint: PASSED with six pre-existing warnings and zero errors. Typecheck: PASSED. Build: PASSED. `git diff --check`: PASSED.

## 27. Files modified

`PRD.md` only, to add the root-cause sharp edge/backlog conclusion.

## 28. Files created

Two audit artifacts, two read-only diagnostic scripts, and one pure diagnostic test file.

## 29. Commit/push status

No commit and no push; the dirty experimental tree remains preserved.

## 30. PRD update

Updated Known Sharp Edges and the Cooking Mode recall-remediation backlog with this diagnosis.

## 31. Unverifiable items

- Whether 26 blank-evidence arbiter rejections were emitted as REJECT or were coerced from invalid ACCEPT by post-response validation; raw pre-validation output was not stored.
- Exact output-token counts for each of the 36 historical V9 reviewer calls; telemetry omitted recipe/request identifiers.
- Provider model revision and original SDK version; neither was recorded.
- Raw text for failed structured-output responses; AI SDK exposed only the parse error.

## 32. Next action

Redesign the **arbiter subsystem next**, because it is the largest independently measured downstream recall loss (108 correct rejections), does not protect precision (nine false accepts), and supplies evidence that the current hard-safety layer cannot use reliably. In parallel, specify the missing lifecycle/component state needed before rewriting safety. This is a subsystem direction, not a V10 architecture proposal.

Files modified: PRD.md — added the isolated root cause and next-subsystem direction
Files created: docs/audits/cooking-mode-recall-root-cause-analysis-2026-08-28.json — machine-readable row evidence; docs/audits/cooking-mode-recall-root-cause-analysis-2026-08-28.md — human-readable report; scripts/analyze-cooking-mode-recall-root-cause-core.mjs — pure diagnostic math; scripts/analyze-cooking-mode-recall-root-cause.mjs — read-only evidence builder; scripts/run-cooking-mode-recall-diagnostics.mjs — bounded AI reproduction harness; tests/cookingModeRecallRootCauseAnalysis.test.ts — diagnostic invariants and no-write checks
Tests: 6 new / 855 total
Build: PASSED
Deployment: committed and pushed to main (no)
PRD.md updated: yes — Known Sharp Edges and Cooking Mode recall-remediation backlog
Unverifiable items: raw pre-validation arbiter decisions for 26 blank-evidence rejects; exact per-recipe historical V9 output tokens; provider model revision/original SDK version; raw failed structured-output text
Anything deferred or not completed: V10 architecture/design and production changes intentionally not started because this task prohibited them
