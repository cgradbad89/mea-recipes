# Cooking Mode V10D Principal-Target / Generic-Seasoning Analysis — 2026-08-28

## Executive result

**MORE INGREDIENT PRECISION WORK REQUIRED**

V10D remained audit-only: no production mappings, recipes, Firestore documents, routes, runtime engines, or reviewer populations were mutated. V10C reproduced exactly at 669 TP / 2 FP / 164 FN, 18/20 target false positives rejected, 9/9 quantity regressions repaired.

V10D measured 642 TP / 0 FP / 191 FN, 100.00% precision, and 77.07% candidate recall.

## 164-FN taxonomy

| Category | Count |
|---|---:|
| COLLECTIVE_CONTINUATION | 49 |
| DIRECT_ALIAS_MISS | 1 |
| DIVIDED_OR_RESERVED_USE | 3 |
| OTHER | 87 |
| PRINCIPAL_TARGET_CONTINUATION | 11 |
| TRUE_PASSIVE_COMPONENT_CARRY_MISCLASSIFIED | 13 |

Total classified: 164.

## Ratatouille salt/pepper benchmark review

| Candidate | Ingredient row | Benchmark truth | Finding |
|---|---|---|---|
| ingredient::chickpea-and-fennel-ratatouille::2::7 | 1 teaspoon salt, more to taste | INCORRECT | BENCHMARK_APPEARS_CORRECT |
| ingredient::chickpea-and-fennel-ratatouille::2::8 | Black pepper to taste | INCORRECT | BENCHMARK_APPEARS_CORRECT |

Salt and pepper are combined into the roasting pan at instruction 0 (their sole CORRECT link) and are consistently INCORRECT at instruction 1 (unnamed "roast" continuation) despite every roasted vegetable row remaining CORRECT there. Instruction 2's generic "Taste and adjust seasoning" continues that same pattern: it does not re-target salt/pepper even though the row itself reads "more to taste." The truth label is internally consistent across all three sibling candidates for both rows and is not evidence of a labeling error.

## Broader generic-language benchmark review

Bare generic seasoning phrasing ("taste and adjust seasoning" / "adjust seasoning" with no ingredient named) occurs at only 2 distinct instructions in the entire frozen 863-candidate population: chickpea-and-fennel-ratatouille instruction 2 and mapo-rag-crazy-good instruction 3. All other "season to taste"-style matches explicitly name the row ("season to taste with salt and pepper" / "Season to taste with salt"), which are direct mentions already handled by exact-token matching, not generic seasoning. No inconsistency was found in how the benchmark treats implicit generic seasoning language given this small population; both instances are internally consistent with sibling-candidate truth for the same rows.

## Benchmark-integrity result

BENCHMARK REVIEW NOT REQUIRED — the ratatouille salt/pepper truth labels are internally consistent with their own sibling candidates (CORRECT only at the row's first active-combination instruction) and are not evidence of an adjudication error.

## Twenty V10A target false positives

| Candidate | Root cause | V10C | V10D |
|---|---|---|---|
| ingredient::157::4::0 | CONSUMED_ROW | REJECT | REJECT / TARGET_SWITCHED |
| ingredient::chicken-tikka::5::15 | PROCESS_MATERIAL | REJECT | REJECT / PASSIVE_COMPONENT_CARRY |
| ingredient::chickpea-and-fennel-ratatouille::1::7 | CONSUMED_ROW | REJECT | REJECT / CONTEXT_ONLY |
| ingredient::chickpea-and-fennel-ratatouille::1::8 | CONSUMED_ROW | REJECT | REJECT / CONTEXT_ONLY |
| ingredient::chickpea-and-fennel-ratatouille::1::9 | CONSUMED_ROW | REJECT | REJECT / CONTEXT_ONLY |
| ingredient::chickpea-and-fennel-ratatouille::2::7 | CONTEXTUAL_MENTION | ACCEPT | REJECT / CONTEXT_ONLY |
| ingredient::chickpea-and-fennel-ratatouille::2::8 | CONTEXTUAL_MENTION | ACCEPT | REJECT / CONTEXT_ONLY |
| ingredient::crunchy-queso-wrap::2::11 | COMPONENT_LEAKAGE | REJECT | REJECT / PASSIVE_COMPONENT_CARRY |
| ingredient::crunchy-queso-wrap::4::13 | COMPONENT_LEAKAGE | REJECT | REJECT / TARGET_SWITCHED |
| ingredient::cucumber-tomato-salad-with-red-wine-vinaigrette::2::0 | COMPONENT_LEAKAGE | REJECT | REJECT / PASSIVE_COMPONENT_CARRY |
| ingredient::cucumber-tomato-salad-with-red-wine-vinaigrette::2::1 | COMPONENT_LEAKAGE | REJECT | REJECT / PASSIVE_COMPONENT_CARRY |
| ingredient::cucumber-tomato-salad-with-red-wine-vinaigrette::2::2 | COMPONENT_LEAKAGE | REJECT | REJECT / TARGET_SWITCHED |
| ingredient::dads-chili::6::15 | CONTEXTUAL_MENTION | REJECT | REJECT / TARGET_SWITCHED |
| ingredient::jocn-chicken-and-tomatillo-stew::4::2 | COMPONENT_LEAKAGE | REJECT | REJECT / PASSIVE_COMPONENT_CARRY |
| ingredient::jocn-chicken-and-tomatillo-stew::4::3 | COMPONENT_LEAKAGE | REJECT | REJECT / PASSIVE_COMPONENT_CARRY |
| ingredient::jocn-chicken-and-tomatillo-stew::4::4 | COMPONENT_LEAKAGE | REJECT | REJECT / PASSIVE_COMPONENT_CARRY |
| ingredient::jocn-chicken-and-tomatillo-stew::4::5 | COMPONENT_LEAKAGE | REJECT | REJECT / PASSIVE_COMPONENT_CARRY |
| ingredient::mole-poblano::13::19 | COMPONENT_LEAKAGE | REJECT | REJECT / PASSIVE_COMPONENT_CARRY |
| ingredient::sheetpan-gochujang-chicken-and-roasted-vegetables::3::9 | COMPONENT_LEAKAGE | REJECT | REJECT / PASSIVE_COMPONENT_CARRY |
| ingredient::tacos-al-pastor::4::0 | CONTEXTUAL_MENTION | REJECT | REJECT / CONTEXT_ONLY |

Target protection: 20/20 rejected.

## Correct-candidate protection and strategy comparison

| Strategy | TP | FP | FN | Precision | Candidate recall | AI decisions |
|---|---:|---:|---:|---:|---:|---:|
| Reviewer union | 833 | 28 | 0 | 96.75% | 100.00% | 0 |
| Reviewer intersection | 763 | 9 | 70 | 98.83% | 91.60% | 0 |
| V10A disagreement-only | 831 | 20 | 2 | 97.65% | 99.76% | 91 |
| V10B state-aware | 748 | 9 | 85 | 98.81% | 89.80% | 477 |
| V10C active-target state | 669 | 2 | 164 | 99.70% | 80.31% | 392 |
| V10D principal/generic | 642 | 0 | 191 | 100.00% | 77.07% | 392 |

## Historical false-positive regression

Locked truth rejected: 4/12. The remaining 70 rows are reported as SOURCE_SIGNAL_ONLY because the artifact has origins but no manual truth label.

## Transport and controls

- Logical batches: 67
- Gateway requests: 71
- Retries: 0
- Parse failures: 0
- Schema failures: 0
- Local rejections: 0
- Recipe 190: 4/4 successful
- AI tokens: 401658 total (346532 input / 55126 output)

## Prepared-component diagnostic note

Prepared-component establishment/identity/reuse precision remains out of scope. Component membership is used only to prevent ingredient-row leakage into a containing component.

## Production mutation and next action

Production mutation: zero. Existing persisted v4/v5 maps and runtime behavior remain unchanged.

Identify the remaining semantic class that prevents zero-FP/high-recall separation before another bounded experiment.
