# Cooking Mode usage-matrix v8 focused validation — 2026-08-27

## Executive result

**FAIL — V8 FOCUSED GATE**

This run was read-only. Firestore recipe writes: **0**. Firestore map writes: **0**.

## Focused metrics

- Recipes: 36
- TP / FP / FN: 383 / 1 / 485
- Precision / recall / F1: 99.74% / 44.12% / 61.18%
- Explicit-active-use recall: 58.64%
- CRITICAL recall: 42.55%
- HIGH recall: 42.34%
- Seasoning/herb recall: 44.00%
- Prepared-component recall: 2.42%
- Prepared-component false positives: 1

## Raw AI matrix

- expectedBenchmarkAssociations: 868
- useNowCorrect: 758
- useNowIncorrect: 55
- expectedUsesClassifiedNotThisStep: 110
- expectedUsesClassifiedUncertain: 0
- expectedUsesUnavailableFromFailedMatrix: 0
- correctUseNowAccepted: 380
- correctUseNowRejected: 378
- incorrectUseNowAccepted: 0
- incorrectUseNowRejected: 55
- componentEstablishmentsCorrect: 15
- componentEstablishmentsIncorrect: 15
- componentUsesCorrect: 21
- componentUsesIncorrect: 22
- correctComponentUsesAccepted: 4
- correctComponentUsesRejected: 17
- incorrectComponentUsesAccepted: 1
- incorrectComponentUsesRejected: 21

## Gate checks

- precision: FAIL
- overallRecall: FAIL
- explicitActiveUseRecall: FAIL
- criticalRecall: FAIL
- highRecall: FAIL
- seasoningRecall: FAIL
- preparedComponentRecall: FAIL
- preparedComponentPrecision: FAIL
- incorrectUseNowAccepted: PASS
- incorrectComponentUsesAccepted: FAIL
- historicalFalsePositivesRejected: PASS
- userRegressions: PASS
- completeMatrices: FAIL

## Safety and regressions

- Historical V6/V7 false-positive cases rejected: 25/25
- User regressions present: 6/6
- Complete structurally valid matrices: 31/36

## Errors

- Ingredient false positives: 1
- Ingredient false negatives: 485
- Prepared-component misses: 161
- Matrix/generation failures: 5

## AI usage

- Successful calls: 36
- Input / output / total tokens: 55814 / 145659 / 201473
- Model: openai/gpt-5.6-luna
- Temperature: 0
- Prompt version: v1

## Decision

STOP. Primary remaining blocker: **AI classification recall**. Stability, the full 228-recipe run, manifest/SHA, migration prompt, production activation, commit, and push are not authorized.
