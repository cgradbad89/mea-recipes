# Cooking Mode V10G — Active-Object Rescue: Full Frozen-Benchmark Validation

**Verdict:** FAIL — ACTIVE-OBJECT RESCUE DOES NOT GENERALIZE

**Architecture recommendation:** STOP ACTIVE-OBJECT DETERMINISTIC REFINEMENT — REASSESS AI-AT-INGESTION ARCHITECTURE

## 1. Locked rule

- Core: `scripts/analyze-cooking-mode-v10f-lite-active-object-core.mjs`
- SHA-256 before: `f9fa2e1926adfa27e2e391565038c050ec58ae8e4ed1a91da129d19dee0d6420`
- SHA-256 after: `f9fa2e1926adfa27e2e391565038c050ec58ae8e4ed1a91da129d19dee0d6420`
- Byte-identical: YES

## 2. Frozen population

- Total: 863 (historical: 863)
- Correct: 833 (historical: 833)
- Incorrect: 30 (historical: 30)
- Recipe coverage: 36 recipes
- Matches historical: YES

## 3. V10D baseline reproduction

- Reconstructed: TP=642 FP=0 FN=191 precision=1 recall=0.7707
- Historical: TP=642 FP=0 FN=191 precision=1 recall=0.7707082833133253
- Exact historical match: YES

## 4. V10D + active-object rescue result

- TP=773 FP=0 FN=60 precision=1 recall=0.928 F1=0.9627

## 5. Delta

- TP gained: 131
- FP added: 0
- FN removed: 131
- Precision delta: 0
- Recall delta: 0.1573

## 6. Semantic-class recovery (V10E taxonomy, all 191 V10D false negatives)

| Class | Eligible | Rescued | Missed | Recovery % |
|---|---|---|---|---|
| DISH_STATE_CONTINUATION | 58 | 56 | 2 | 96.55 |
| PRONOUN_OR_DEICTIC_REFERENCE | 55 | 46 | 9 | 83.64 |
| SERVING_OR_GARNISH_ACTION | 20 | 11 | 9 | 55 |
| TRANSFER_OR_ASSEMBLY_TARGET | 17 | 4 | 13 | 23.53 |
| COLLECTION_ACTIVE_CONTINUATION | 14 | 8 | 6 | 57.14 |
| CATEGORY_OR_COLLECTIVE_ALIAS | 13 | 2 | 11 | 15.38 |
| MULTI_COMPONENT_ASSEMBLY | 8 | 0 | 8 | 0 |
| CONTINUING_COOKING_OBJECT | 3 | 2 | 1 | 66.67 |
| DIVIDED_OR_RESERVED_USE | 2 | 2 | 0 | 100 |
| IMPLIED_SEASONING_OR_FINISHING | 1 | 0 | 1 | 0 |

## 7. New false positives

None — 0 of the 30 frozen INCORRECT candidates were rescued.

## 8. Target false positive protection

20/20 rejected

## 9. Quantity regression protection

9/9 remain repaired

## 10. Historical locked-truth cases

Baseline protected (matches V10D): 4/12. Of those, 1 verified still-protected post-rescue and 3 unverifiable (no raw source text — cannot confirm rescue does not flip them). 8/12 were already unprotected ACCEPTs under V10D and are unaffected by rescue-only. V10D baseline was 4/12.

## 11. Ratatouille generic-seasoning policy

Pass: YES

## 12. Remaining FN taxonomy (largest classes)

- TRANSFER_OR_ASSEMBLY_TARGET: 13 still missed
- CATEGORY_OR_COLLECTIVE_ALIAS: 11 still missed
- PRONOUN_OR_DEICTIC_REFERENCE: 9 still missed
- SERVING_OR_GARNISH_ACTION: 9 still missed
- MULTI_COMPONENT_ASSEMBLY: 8 still missed
- COLLECTION_ACTIVE_CONTINUATION: 6 still missed
- DISH_STATE_CONTINUATION: 2 still missed
- CONTINUING_COOKING_OBJECT: 1 still missed
- IMPLIED_SEASONING_OR_FINISHING: 1 still missed

## 13. Complexity

- Semantic rule count unchanged: YES (6)
- Recipe-specific exceptions: 0
- AI calls: 0
- Production integration: 0

## 14. Full-frozen gate

- v10dBaselineReproducedExactly: PASS
- zeroNewFalsePositives: PASS
- allTargetFpRejected: PASS
- allQuantityRegressionsRepaired: PASS
- dscRecoveryAtLeast85: PASS
- pronounRecoveryAtLeast85: FAIL
- recallMateriallyImprovedOver7707: PASS
- ruleByteIdentical: PASS

## 15. Preferred thresholds

- dscRecoveryAtLeast90: YES
- pronounRecoveryAtLeast90: no

## 16. Unverifiable items

- Three of the 12 historical locked-truth candidates (historical::192::1::20, historical::chicken-paprikash::3::1, historical::pearl-couscous-skillet-with-tomatoes-chickpeas-and-feta::4::12) have no raw ingredientText/instructionText in any frozen artifact — only extracted state facts. They could not be evaluated against the text-based rescue rule without regenerating from recipe source, which is out of scope. Their V10D-recorded decision (REJECT) is reported as-is; rescue applicability is UNKNOWN, not assumed safe.
- Instruction chronology per recipe is reconstructed only from text fragments already present across the frozen V10A/V10D/V10E artifacts (instructionText/previousInstructionText/nextInstructionText/priorCandidateInstructions). A recipe instruction that never appears in any candidate's fragments is not reconstructable without a corpus rerun (out of scope), so `reconstructedEarlierInstructionCount` on each rescue result is a lower bound on the true earlier-instruction count for that recipe.
