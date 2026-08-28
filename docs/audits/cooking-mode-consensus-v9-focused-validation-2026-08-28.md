# Cooking Mode consensus v9 focused validation — 2026-08-28

## Executive result

**FAIL — V9 FOCUSED GATE**

This run was read-only. Firestore recipe writes: **0**. Firestore map writes: **0**.

## Reviewer discovery before arbitration

- Expected associations: 868
- Reviewer A: 780 (89.86%)
- Reviewer B: 816 (94.01%)
- Union: 833 (95.97%)
- Intersection: 763 (87.90%)
- Missed by both: 35

## Arbiter metrics

- correctCandidateRelationshipsPresented: 833
- incorrectCandidateRelationshipsPresented: 30
- correctAccept: 721
- correctReject: 108
- correctUncertain: 0
- correctUnavailable: 4
- incorrectAccept: 9
- incorrectReject: 21
- incorrectUncertain: 0
- incorrectUnavailable: 0
- correctAcceptanceRate: 86.55%

## Hard-safety metrics

- correctArbiterAcceptRetained: 656
- correctArbiterAcceptRejected: 65
- incorrectArbiterAcceptRetained: 9
- incorrectArbiterAcceptBlocked: 0
- correctArbiterAcceptRejectionRate: 9.02%

## Final quality

- Recipes: 36
- TP / FP / FN: 657 / 9 / 211
- Precision / recall / F1: 98.65% / 75.69% / 85.66%
- Explicit-active-use recall: 85.80%
- CRITICAL recall: 83.69%
- HIGH recall: 68.55%
- Seasoning/herb recall: 74.55%
- Prepared-component recall: 31.52%
- Prepared-component false positives: 16

## Regression gates

- Named UI regressions: 6/6
- Historical ingredient false positives rejected: 66/72
- Historical component false positives rejected: 1/1
- Former V7 correct validator rejections accepted and retained: 44/52

## Gate checks

- reviewerUnionRecall: FAIL
- arbiterIncorrectAccept: FAIL
- arbiterCorrectAcceptance: FAIL
- hardSafetyIncorrectFinalAccepted: FAIL
- hardSafetyCorrectRejectionRate: FAIL
- precision: FAIL
- overallRecall: FAIL
- explicitActiveUseRecall: FAIL
- criticalRecall: FAIL
- highRecall: FAIL
- seasoningRecall: FAIL
- preparedComponentRecall: FAIL
- preparedComponentPrecision: FAIL
- userRegressions: PASS
- historicalIngredientFalsePositives: FAIL
- historicalComponentFalsePositives: PASS
- validatorPositiveRegressions: FAIL
- completeRuns: FAIL

## Remaining errors

- Ingredient false positives: 9
- Ingredient false negatives: 211
- Component false positives: 16
- Component misses: 113
- Generation/validation failures: 1

## AI usage

- Successful requests: 113
- Input / output / total tokens: 243858 / 216076 / 459934
- Model: openai/gpt-5.6-luna
- Temperature: 0
- Blind reviewer prompt: v1
- Map arbiter prompt: v1

## Decision

STOP. Do not run later gates, generate a migration manifest, activate V9, commit, or push.
