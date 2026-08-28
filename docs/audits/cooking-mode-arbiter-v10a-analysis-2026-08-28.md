# Cooking Mode arbiter V10A analysis — 2026-08-28

## 1. Executive result

**MORE ARBITER WORK REQUIRED**

Ingredient candidate arbitration accepted 828/833 correct candidates (99.40%) and 20/30 incorrect candidates (66.67%). The architecture decision is **MORE ARBITER WORK REQUIRED**.

## 2. Dirty-workspace status

Branch/HEAD: `main` / `030a590d8bc17be1e53a91e29633b2904ef73d0c`. The pre-existing dirty tree was preserved. V10A edited no production file and made no Firestore/map/recipe writes.

## 3. Exact frozen candidate population

Ingredient candidates: 863 total — 833 correct and 30 incorrect. Prepared-component candidates: 196 total — 75 exact-canonical correct and 121 exact-canonical incorrect.

## 4. Historical count discrepancy

The 833/28 reviewer-union summary is not the arbiter pool. Deterministic-only additions make the exact ingredient pool 863: 833 correct and 30 incorrect. Recipe 190 contributes four correct candidates with unavailable V9 decisions. Therefore V9 outcomes are 721 correct ACCEPT, 108 correct REJECT, 4 correct UNAVAILABLE, 9 incorrect ACCEPT, and 21 incorrect REJECT.

## 5. V9 arbiter-error taxonomy

Correct rejects: {"CONTINUING_USE":41,"PREPARED_COMPONENT":23,"GROUP_REFERENCE":11,"ALIAS_NORMALIZATION":9,"SEASONING_HERB":9,"MAIN_INGREDIENT":7,"OBVIOUS_EXPLICIT_ACTIVE_USE":7,"QUANTITY_OR_PARTIAL_USE":1}. Incorrect accepts: {"CONSUMED_ROW":4,"COMPONENT_LEAKAGE":3,"CONTEXTUAL_MENTION":2}. Full row evidence is in the error-matrix artifact.

## 6–8. Zero-AI baselines and provenance truth rates

| Strategy | TP | FP | FN | Precision | Candidate recall | AI candidates |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Reviewer union | 833 | 28 | 0 | 96.75% | 100.00% | 0 |
| Reviewer intersection | 763 | 9 | 70 | 98.83% | 91.60% | 0 |

- 2/2: 763 correct / 9 incorrect.
- 1/2: 70 correct / 19 incorrect.
- Deterministic-only: 0 correct / 2 incorrect.

## 9–10. Minimal architecture and structured output

Candidate-centric, binary ACCEPT/REJECT, flat results, maximum 15 candidates per request, exact ID coverage validation, and one bounded retry. Hard safety was excluded from primary evaluation. 107/107 logical batches succeeded after retry (100.00%); 122 requests, 5 retries, 0 parse/schema failures.

## 11–15. Experiments A–C

Experiment A: 828 correct ACCEPT, 5 correct REJECT, 20 incorrect ACCEPT, 10 incorrect REJECT, 0 unavailable. Correct acceptance 99.40%; incorrect acceptance 66.67%.

| Strategy | TP | FP | FN | Precision | Candidate recall | AI candidates |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Reviewer union | 833 | 28 | 0 | 96.75% | 100.00% | 0 |
| Reviewer intersection | 763 | 9 | 70 | 98.83% | 91.60% | 0 |
| 2/2 auto + arbitrate disagreement | 831 | 20 | 2 | 97.65% | 99.76% | 91 |
| Arbitrate everything | 828 | 20 | 5 | 97.64% | 99.40% | 863 |

## 16–17. Mandatory historical regression

Recovered 107/108 prior V9 correct rejections. Rejected 0/9 prior V9 false accepts. Rejected 2/13 historical candidate-level FP cases that were present in the frozen pool.

## 18. Prepared components

Exact-canonical component candidates: 66 correct ACCEPT, 9 correct REJECT, 97 incorrect ACCEPT, 24 incorrect REJECT; precision 40.49%, candidate recall 88.00%. Component label variants remain a separate subsystem limitation.

## 19. Hard-safety ablation

Arbiter alone: 828 correct ACCEPT / 20 incorrect ACCEPT. Adding current hard safety: 755 correct ACCEPT / 20 incorrect ACCEPT; removed 73 arbiter accepts.

## 20. Recipe 190 transport

4 independent micro-batch requests: 4 successful structured outputs and 0 failures.

## 21–23. AI usage, necessity, and next subsystem

122 requests; 111 successful calls; 337275 input / 91326 output / 428601 total recorded tokens. Decision: **MORE ARBITER WORK REQUIRED**. Best frontier: **disagreementOnly**. Next: Continue isolated arbiter work; do not build V10 production architecture.

## 24–33. Audit/production/verification status

Artifacts: `docs/audits/cooking-mode-arbiter-v10a-frozen-candidates-2026-08-28.json`, `docs/audits/cooking-mode-arbiter-v10a-error-matrix-2026-08-28.md`, `docs/audits/cooking-mode-arbiter-v10a-analysis-2026-08-28.json`, and `docs/audits/cooking-mode-arbiter-v10a-analysis-2026-08-28.md`. Production mutations: zero. No commit or push. PRD update and final repository verification are recorded in the session handoff after commands complete.

Unverifiable: Prepared-component truth is evaluated against the audit's exact normalized canonical labels; semantically equivalent unadjudicated label variants cannot be promoted without new manual adjudication. The provider supplied token usage but no authoritative dollar cost or model-revision identifier.

## Required output checklist

1. Executive result: **MORE ARBITER WORK REQUIRED**.
2. Dirty-workspace status: pre-existing V6–V9 and unrelated changes preserved; V10A used no reset, clean, stash, commit, or push.
3. Exact frozen candidate population: 863 ingredients (833 correct/30 incorrect) and 196 exact-canonical components (75 correct/121 incorrect).
4. Historical count discrepancies: The 833/28 reviewer-union summary is not the arbiter pool. Deterministic-only additions make the exact ingredient pool 863: 833 correct and 30 incorrect. Recipe 190 contributes four correct candidates with unavailable V9 decisions. Therefore V9 outcomes are 721 correct ACCEPT, 108 correct REJECT, 4 correct UNAVAILABLE, 9 incorrect ACCEPT, and 21 incorrect REJECT.
5. V9 arbiter-error taxonomy: {"correctRejects":{"CONTINUING_USE":41,"PREPARED_COMPONENT":23,"GROUP_REFERENCE":11,"ALIAS_NORMALIZATION":9,"SEASONING_HERB":9,"MAIN_INGREDIENT":7,"OBVIOUS_EXPLICIT_ACTIVE_USE":7,"QUANTITY_OR_PARTIAL_USE":1},"incorrectAccepts":{"CONSUMED_ROW":4,"COMPONENT_LEAKAGE":3,"CONTEXTUAL_MENTION":2}}.
6. Reviewer-union baseline: 833 TP / 28 FP / 0 candidate FN.
7. Reviewer-intersection baseline: 763 TP / 9 FP / 70 candidate FN.
8. 2/2 versus 1/2 truth rates: 763/9 and 70/19 correct/incorrect respectively; deterministic-only 0/2.
9. Minimal arbiter architecture: flat candidate-centric binary decisions, maximum 15 candidates, exact IDs, one retry, no primary hard safety.
10. Micro-batch/structured-output behavior: 107/107 logical batches succeeded; 0 parse/schema failures; 11 separately recorded local configuration failures.
11. Experiment A metrics: 828 correct ACCEPT / 5 correct REJECT / 20 incorrect ACCEPT / 10 incorrect REJECT.
12. Experiment B metrics: 831 TP / 20 FP / 2 FN; 91 AI candidates.
13. Experiment C strategy comparison: reviewer union 833/28; intersection 763/9; disagreement-only 831/20; arbitrate-all 828/20.
14. Correct-candidate acceptance rate: 99.40%.
15. Incorrect-candidate acceptance rate: 66.67%.
16. 108 prior false-rejection recovery: 107/108.
17. Nine prior false-accept rejection: 0/9.
18. Prepared-component arbiter metrics: 66 correct ACCEPT / 9 correct REJECT / 97 incorrect ACCEPT / 24 incorrect REJECT; precision 40.49%, candidate recall 88.00%.
19. Hard-safety ablation: arbiter alone 828/20 correct/incorrect accepts; with current safety 755/20; 73 accepts removed.
20. Recipe 190 transport result: 4/4 structured successes, 0 failures.
21. AI usage: 122 requests, 111 successful; 337275/91326/428601 input/output/total tokens.
22. Arbiter necessity decision: **MORE ARBITER WORK REQUIRED**.
23. Recommended next subsystem: Continue isolated arbiter work; do not build V10 production architecture.
24. Audit artifacts: docs/audits/cooking-mode-arbiter-v10a-frozen-candidates-2026-08-28.json, docs/audits/cooking-mode-arbiter-v10a-error-matrix-2026-08-28.md, docs/audits/cooking-mode-arbiter-v10a-analysis-2026-08-28.json, docs/audits/cooking-mode-arbiter-v10a-analysis-2026-08-28.md.
25. Production mutation: zero writes and zero V10A production-file edits.
26. Tests/lint/typecheck/build: 8/8 new tests and 862/862 runnable repository tests passed (1 skipped); lint, typecheck, build, and diff check passed.
27. Files modified: PRD.md only for V10A conclusions.
28. Files created: three V10A diagnostic scripts, one V10A test, and four V10A audit artifacts.
29. Commit/push status: no commit and no push.
30. PRD update: yes — Cooking Mode mapping history, Known Sharp Edges, and recall-remediation backlog.
31. Unverifiable items: Prepared-component truth is evaluated against the audit's exact normalized canonical labels; semantically equivalent unadjudicated label variants cannot be promoted without new manual adjudication. The provider supplied token usage but no authoritative dollar cost or model-revision identifier.
32. Deferred work: prompt tuning, V10 production architecture, reviewer reruns, full 228 run, migration, and safety redesign.
33. Next action: continue isolated arbiter error analysis; do not build V10 production architecture.
