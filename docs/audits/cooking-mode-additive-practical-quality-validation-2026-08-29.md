# Cooking Mode — Additive Practical-Quality Validation

**Date:** 2026-08-29
**Type:** VALIDATION / PRODUCT SIMPLIFICATION DECISION
**Machine-readable record:** [`cooking-mode-additive-practical-quality-validation-2026-08-29.json`](./cooking-mode-additive-practical-quality-validation-2026-08-29.json)

## 1. Executive result

```text
FAIL — ADDITIVE HIGH-CONFIDENCE MAPPING DOES NOT REACH PRACTICAL FLOOR
```

The fixed additive strategy measured **161 TP / 15 FP / 133 FN**, or **91.48% precision, 54.76% recall, and 68.51% F1**. Precision clears the practical 90% floor, but recall is below both the 80% pass floor and the 70% conditional floor. The augmentation itself was only **79.45% precise**, and 13 of its 15 false positives repeat collective-reference overmapping across two recipes. The strategy therefore fails both the recall and no-systemic-error requirements.

## 2. Starting state

- Branch: `main`.
- `HEAD`: `9590090f2129d3ec9bed90355badeb94fa5571c1`.
- `origin/main`: `9590090f2129d3ec9bed90355badeb94fa5571c1`.
- Expected checkpoint matched exactly.
- Pre-existing unrelated changes were preserved: the modified V10F-Lite audit JSON and untracked local config/debug files were not changed or staged.

## 3. Practical quality standard

- PASS: precision ≥90%, recall ≥80%, and no systemic semantic failure.
- CONDITIONAL PASS: precision ≥90%, recall ≥70% but <80%, original visible defects improve, and no systemic new false-positive pattern.
- FAIL: precision <90%, recall <70%, or systemic new false positives.
- Isolated errors are acceptable; systemic nonsense is not. These thresholds were fixed before scoring.

## 4. Held-out sample

The exact frozen 10-recipe sample and its already-recorded current-revision reviewer outputs were reused. No recipes were selected or replaced and no AI was run. The sample contains 294 adjudicated true relationships.

| Recipe | Truth | Old engine |
|---|---:|---|
| Pozole Verde - WOWZA | 39 | `deterministic-v5` |
| Easy Slow Cooker Turkey Chili | 36 | `deterministic-v4` |
| Creamy Chickpea Spinach Masala With Tadka | 34 | `hybrid-v4` |
| Chicken Gyro Chopped Salad | 28 | `hybrid-v4` |
| Peruvian Roasted Chicken With Spicy Cilantro Sauce | 28 | `hybrid-v5` |
| Best Black Bean Soup | 27 | `hybrid-v4` |
| Korean Bulgogi Beef Bowls | 27 | `hybrid-v4` |
| Doro Wat (Ethiopian-Style Spicy Chicken) | 26 | `deterministic-v4` |
| Easy Chicken Ramen | 25 | `deterministic-v5` |
| Singapore Mei Fun | 24 | `hybrid-v4` |

For all 10 recipes, the completeness audit's persisted-map source hash equals its adjudicated source hash, and the later frozen validation's exact recipe revision carries the same hash. There are **zero source/map-version mismatches**. The JSON record includes every truth, old-map, `AUTO_ACCEPT`, and additive relationship as `ingredientRowIndex:zeroBasedStepIndex`.

## 5–7. Fixed-strategy comparison

| Strategy | TP | FP | FN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|
| A — Existing v4/v5 | 103 | 0 | 191 | 100.00% | 35.03% | 51.89% |
| B — `AUTO_ACCEPT` only | 118 | 15 | 176 | 88.72% | 40.14% | 55.27% |
| C — v4/v5 + `AUTO_ACCEPT` | 161 | 15 | 133 | 91.48% | 54.76% | 68.51% |

These are micro-aggregates over the same 10 recipes, not averages of per-recipe percentages. Strategy C is an exact canonical-identity union and removes nothing from the existing map.

## 8. Incremental `AUTO_ACCEPT` quality

Strategy D (`AUTO_ACCEPT` minus existing v4/v5) contributed:

- 73 new relationships;
- 58 new true positives;
- 15 new false positives;
- **79.45% incremental precision**;
- 58 previously missing true relationships recovered.

The augmentation is not high precision under the accepted 90% product standard.

## 9. Per-recipe additive results

| Recipe | Old TP/FP/FN | New TP/FP/FN | Precision | Recall | Added | Recovered | FP introduced |
|---|---:|---:|---:|---:|---:|---:|---:|
| Pozole Verde - WOWZA | 10/0/29 | 19/4/20 | 82.61% | 48.72% | 13 | 9 | 4 |
| Easy Slow Cooker Turkey Chili | 2/0/34 | 2/0/34 | 100.00% | 5.56% | 0 | 0 | 0 |
| Creamy Chickpea Spinach Masala With Tadka | 9/0/25 | 24/10/10 | 70.59% | 70.59% | 25 | 15 | 10 |
| Chicken Gyro Chopped Salad | 10/0/18 | 12/0/16 | 100.00% | 42.86% | 2 | 2 | 0 |
| Peruvian Roasted Chicken With Spicy Cilantro Sauce | 13/0/15 | 14/0/14 | 100.00% | 50.00% | 1 | 1 | 0 |
| Best Black Bean Soup | 10/0/17 | 16/0/11 | 100.00% | 59.26% | 6 | 6 | 0 |
| Korean Bulgogi Beef Bowls | 14/0/13 | 24/0/3 | 100.00% | 88.89% | 10 | 10 | 0 |
| Doro Wat (Ethiopian-Style Spicy Chicken) | 8/0/18 | 17/0/9 | 100.00% | 65.38% | 9 | 9 | 0 |
| Easy Chicken Ramen | 11/0/14 | 14/0/11 | 100.00% | 56.00% | 3 | 3 | 0 |
| Singapore Mei Fun | 16/0/8 | 19/1/5 | 95.00% | 79.17% | 4 | 3 | 1 |

Masala is the precision outlier: 10 false positives among 25 additions. Turkey Chili is the recall outlier: `AUTO_ACCEPT` adds nothing and recall stays 5.56%. Pozole adds four false positives. Seven recipes introduce no false positives, but the repeated errors in the other three are material and patterned.

## 10. Recall improvement

- Old-map recall: **35.03%**.
- Additive recall: **54.76%**.
- Absolute recall gain: **19.73 percentage points**.
- False negatives: **191 → 133**.
- Relative FN reduction: **30.37%**.
- Previously missing true relationships recovered: **58**.
- Remaining false negatives: **133**.

The gain is real but far too small for the 80% floor.

## 11. Severity metrics

| Diagnostic | Existing v4/v5 | Additive | Change |
|---|---:|---:|---:|
| CRITICAL recall | 7/40 — 17.50% | 19/40 — 47.50% | +30.00 points |
| HIGH recall | 35/92 — 38.04% | 43/92 — 46.74% | +8.70 points |
| Seasoning/herb recall | 48/127 — 37.80% | 75/127 — 59.06% | +21.26 points |

No severity metric becomes worse, as expected from an additive union. All three remain diagnostics rather than separate gates, and all remain incomplete.

## 12. Original visible defects

| Relationship | OLD MAP | `AUTO_ACCEPT` | ADDITIVE MAP |
|---|---|---|---|
| Steak Bites step 1 → potatoes | missing | yes | fixed |
| Steak Bites step 2 → steak | missing | yes | fixed |
| Caprese step 1 → mozzarella | missing | yes | fixed |
| Zucchini step 2 → Italian herbs | missing | yes | fixed |
| Zucchini step 2 → pepper | missing | yes | fixed |
| Zucchini step 2 → yellow summer squash | missing | yes | fixed |

The `AUTO_ACCEPT` classifications were read from the existing exact-revision persisted proposal candidates; no reviewer was rerun.

## 13. New false positives

| Semantic class | Count | Recipes affected |
|---|---:|---|
| `COLLECTIVE_REFERENCE` | 13 | Pozole; Masala |
| `COMPONENT_LEAKAGE` | 1 | Masala |
| `LIFECYCLE` | 1 | Singapore Mei Fun |

The 13 collective-reference errors are a repeated pattern: previously introduced ingredients are incorrectly attached to later transfer/continuation steps. This occurs across two recipes and dominates the incremental errors. **Systemic: yes.** The exact 15 relationship IDs and source texts remain traceable to the prior raw-union false-positive ledger; the IDs are listed in the JSON artifact.

## 14. Human review avoided

Under the hypothetical additive path, `REVIEW_REQUIRED` relationships would be ignored rather than reviewed. Extrapolation—not a corpus measurement:

- recipes needing AI generation: **226**;
- nominal AI calls: **452**; bounded maximum attempts: **904**;
- human candidate-review decisions: **0**;
- likely new `AUTO_ACCEPT` additions: approximately **1,650** by direct held-out per-recipe scaling (73 additions / 10 recipes × 226);
- normalized cross-check: approximately **1,032** using the prior 4,240-candidate corpus projection, 44.37% frozen-benchmark `AUTO_ACCEPT` rate, and the held-out 54.89% new-beyond-old share;
- remaining manual work: a small spot-check and known-problem verification.

The held-out set is intentionally difficult, so neither relationship estimate is presented as a measured corpus count.

## 15. Operational complexity comparison

The perfection-oriented path projected 226 fresh proposals, approximately 2,359 candidate-review decisions, near-universal recipe review, completeness attestation, and approval.

The additive path would generate proposals, retain only `AUTO_ACCEPT`, merge with v4/v5, spot-check, and create an immutable SHA-locked migration manifest for deterministic apply. It eliminates **100% of the projected candidate-review decisions** plus near-universal completeness attestation and approval. AI generation, deterministic merging, spot-checking, manifest construction, and apply verification remain. No human-hour estimate is fabricated.

## 16. Practical gate

| Criterion | Result |
|---|---|
| Precision ≥90% | PASS — 91.48% |
| Recall ≥80% | FAIL — 54.76% |
| Conditional recall ≥70% | FAIL — 54.76% |
| No systemic new FP pattern | FAIL — repeated collective-reference errors |

## 17. Product decision

Do not roll out additive automatic augmentation to the existing corpus. Keep current v4/v5 maps as production truth. The additive strategy improves recall but still omits 133/294 true relationships and introduces a repeated false-positive class.

Per the stop rule, do not resume V10/V11-style mapper research unless the product owner explicitly chooses more investment.

## 18. Recommended production path

1. Keep existing v4/v5 maps for the current corpus.
2. Keep `/mapping-review` available.
3. Use the new workflow for future recipes, targeted manual corrections, and spot checks.
4. Do not create an additive migration manifest, write maps, or cut over Cooking Mode from this validation.

## 19. Estimated remaining work

No additive corpus rollout is authorized. The remaining product decision is whether to stop current-corpus mapping remediation while retaining the implemented workflow for future/manual use.

## 20. Files modified

- `PRD.md` — records the accepted 90%/80% practical standard and failed additive validation.
- `tests/cookingModeAdditivePracticalQuality.test.ts` — deterministic replay of the frozen reviewers through the production proposal builder and audit-metric assertions.

## 21. Files created

- `docs/audits/cooking-mode-additive-practical-quality-validation-2026-08-29.json`
- `docs/audits/cooking-mode-additive-practical-quality-validation-2026-08-29.md`

## 22. Design gate

**No UI impact.**

## 23. AI calls

**Exactly 0.**

## 24. Production data mutation

- Firestore writes: **0**.
- Review events: **0**.
- Map approvals: **0**.
- Pointer updates: **0**.
- Old-map writes: **0**.

## 25–29. Repository verification

- Tests: **1,288 passed, 1 failed, 1 skipped / 1,290 total**. The only failure is the unchanged historical V10D dependency on missing `/tmp/cooking-step-arbiter-v10a-2026-08-28-state.json`; the new deterministic replay test passed.
- Lint: **PASSED** with zero errors and the same six pre-existing warnings.
- Typecheck: **PASSED** after the build regenerated the known duplicate `.next/types/* 2.ts` pollution; the final run passed.
- Build: **PASSED** under Next.js 16.3.1.
- `git diff --check`: **PASSED**.

## 30. Commit

- SHA: recorded in the final session report (a commit cannot embed its own SHA without changing it).
- Pushed: recorded in the final session report.

## 31. PRD updates

`PRD.md` changes the practical standard to precision ≥90% / recall ≥80%, documents the conditional 70–<80% product-owner range, records the measured additive failure and systemic FP pattern, updates the backlog/next decision, and leaves migration incomplete.

## 32. Unverifiable items

None in the held-out scoring or exact-revision original-defect routing checks. Full-corpus `AUTO_ACCEPT` addition volume remains explicitly extrapolated, not measured.

## 33. Deferred

Production rollout, migration, runtime cutover, new semantic rules, new AI calls, and production data mutation were not performed.

## 34. Next task

```text
DECIDE WHETHER TO STOP COOKING MODE MAPPING REMEDIATION
```

Do not begin that task in this session.
