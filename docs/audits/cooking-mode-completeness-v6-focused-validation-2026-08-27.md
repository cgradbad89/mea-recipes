# Cooking Mode completeness v6 focused validation — 2026-08-27

## Executive result

**FAIL — focused release gate not met.**

The blind whole-recipe completeness architecture was implemented locally and exercised against a 36-recipe, source-hash-matching production sample. All six required named associations were present, but the final candidate set did not preserve 100% precision and did not meet the CRITICAL, HIGH, explicit-active-use, or seasoning recall gates. Per the governing specification, the full 228-recipe run was not started, no migration manifest was created, and the implementation was not pushed.

Firestore writes, recipe writes, and map writes: **0**.

## Production baseline

The live read-only count on 2026-08-27 was 237 shared recipes, 229 mapped, and eight unmapped. Persisted engines were 148 `deterministic-v4`, 39 `hybrid-v4`, 33 `deterministic-v5`, and nine `hybrid-v5` (187 v4 and 42 v5 total). The one mapped recipe added after the 228-recipe benchmark was `5-ingredient-hot-honey-chicken`; it was not silently evaluated against missing adjudicated truth.

The authoritative 228-recipe adjudicated baseline remains:

- TP / FP / FN: 1,375 / 12 / 2,677
- Precision: 99.13%
- Recall: 33.93%
- F1: 50.56%
- Explicit-active-use recall: 38.41%
- CRITICAL recall: 24.90%
- Seasoning/herb recall: 36.61%
- Prepared-component recall: 4.07%

## Architecture exercised

The local implementation uses:

`deterministic-v5` → targeted mapping AI v2 when eligible → blind whole-recipe completeness AI v1 on every valid recipe → additive deterministic safety validation → `hybrid-v6` only after a complete successful review.

The completeness request contains only the full numbered ingredient list, group/header metadata, and full numbered instructions. It contains no deterministic, targeted, persisted, or UI candidate indexes. Existing candidate references are never removed. Completeness failure returns the safe pre-completeness `deterministic-v5` or `hybrid-v5` candidate and does not stamp `hybrid-v6`. Runtime remains AI-free and accepts v4, v5, and v6 maps.

## Focused coverage and final metrics

- Recipes: 36
- Effective source-hash matches: 36/36
- Shared audit source-hash matches: 36/36
- TP / FP / FN: 729 / 16 / 139
- Precision: 97.85%
- Recall: 83.99%
- F1: 90.39%
- Explicit-active-use recall: 94.60% (613/648)
- CRITICAL recall: 89.36% (252/282)
- HIGH recall: 77.42% (192/248)
- Seasoning/herb recall: 82.18% (226/275)
- Prepared-component recall: 1.82% (3/165)
- Remaining false negatives: 139
- AI completeness misses: 116
- Correct proposals rejected by validation: 23

Validator rejection classes were duplicate-proposal conflicts (11), duplicate-row lifecycle conflicts (5), duplicate-row scope conflict (1), consumed-row safety conflicts (4), and source-row classification conflicts (2).

## Named regressions

All required focused candidates passed:

- Steak Bites step 1 includes potatoes.
- Steak Bites step 2 includes steak.
- Caprese Salad step 1 includes mozzarella.
- Grilled Zucchini/Summer Squash step 2 includes Italian herbs.
- Grilled Zucchini/Summer Squash step 2 includes black pepper.
- Grilled Zucchini/Summer Squash step 2 includes yellow summer squash.

## Iteration evidence and AI usage

Four bounded 36-recipe prompt/validator variants were evaluated. The attempts progressively tested the minimal preferred schema, narrowed deterministic validation, the audit-proven assessment schema, and a one-call independent omission/safety reconciliation. Across those runs, 246 model calls consumed 331,577 input tokens and 224,701 output tokens (556,278 total). Each recipe attempt used one completeness call plus zero or one targeted call; normal pipeline maximum remained two calls.

The final architecture still admitted false positives and missed CRITICAL associations. Increasing validator strictness restored some precision but recreated low recall; relaxing it recovered correct semantic associations but admitted carry-forward, duplicate-row, and prepared-component errors. This is the exact failure mode the release gate was designed to catch.

## Decision

- Future recipe ingestion activation: **blocked**
- Full 228-recipe v6 dry run: **not authorized because focused gate failed**
- Existing 228-map migration: **blocked**
- V6 manifest/report: **not created**
- Manifest SHA: **not applicable**
- Production mutation: **0**

## Next action

Redesign the one-call completeness contract or validator so a fresh focused run achieves 100% precision and 100% CRITICAL recall before spending on the full cohort. Prepared-component grounding also needs a broader, independently safe lifecycle model; the current canonical component validator accepted only 3/165 expected focused associations.
