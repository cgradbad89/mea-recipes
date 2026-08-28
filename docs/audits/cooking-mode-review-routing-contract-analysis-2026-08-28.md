# Cooking Mode Review-Routing Contract Analysis — 2026-08-28

## Executive result

**REVIEW-ROUTING CONTRACT DEFINED**

Selected initial policy: **both blind reviewers accept + complete V1 deterministic evidence + no V1 risk flags → `AUTO_ACCEPT`**.

On the exact frozen 36-recipe reviewer-union benchmark this policy auto-accepts **382/861 candidates**, all correct: **382 TP / 0 FP / 100% observed precision**. The remaining **479** candidates (451 correct, 28 incorrect) require review. Structural invalidity is absent from the benchmark, so `AUTO_REJECT` is zero in every measured policy and is reserved by contract for structural errors only.

No AI, Firestore, recipe, map, runtime, or UI action occurred. The 228-recipe corpus was not rerun.

## Evidence and population reconciliation

The candidate benchmark is the V10A reviewer union, not the 863-member deterministic-augmented arbiter pool:

- 36 recipes;
- 861 reviewer-union ingredient-step candidates;
- 833 correct and 28 incorrect candidates;
- 3,802 possible non-header ingredient-step cells;
- 868 adjudicated positive relationships;
- 35 truth relationships missed by both reviewers.

The read-only analysis recomputes V1 risk routing with the frozen V10B truth-blind extractor. It routes 475 union candidates: 447 correct and all 28 incorrect. The exact extractor source SHA-256 is `423b0934c1e7f2f6ba3a224b43e0c9343ce58508d50ee549c97861f40abeacad`.

## Reviewer agreement

| Vote bucket | Correct | Incorrect | Total | Precision / correct-rejection rate | Candidate share |
|---|---:|---:|---:|---:|---:|
| Both accept | 763 | 9 | 772 | 98.83% | 89.66% |
| A only accepts | 17 | 11 | 28 | 60.71% | 3.25% |
| B only accepts | 53 | 8 | 61 | 86.89% | 7.08% |
| Both reject | 35 truth misses | 2,906 correct omissions | 2,941 possible cells | 98.81% | not a union-candidate bucket |

Both-reject is measured against all 3,802 possible cells because neither-accepted relationships are absent from the candidate union. Agreement is useful but cannot be canonical truth: nine agreed frozen candidates are false positives.

## Routing-policy comparison

| Policy | Auto accept TP / FP | Precision | Review correct / incorrect | Auto share | Review share | Recipes with review | Avg items/affected recipe |
|---|---:|---:|---:|---:|---:|---:|---:|
| Agreement only | 763 / 9 | 98.83% | 70 / 19 | 89.66% | 10.34% | 18 | 4.94 |
| **Agreement + no V1 risk** | **382 / 0** | **100%** | **451 / 28** | **44.37%** | **55.63%** | **34** | **14.09** |
| Any reviewer + no V1 risk | 386 / 0 | 100% | 447 / 28 | 44.83% | 55.17% | 34 | 13.97 |
| Recorded V10G combined frontier | 773 / 0 | 100% | 60 / 28 | 89.78% | 10.22% | 21 | 4.19 |

Agreement-only is rejected because it contains nine known false positives. Allowing single-reviewer low-risk candidates gains only four auto-accepts, so it is not worth weakening the positive-signal requirement. The V10G combined frontier is diagnostic-only because its 642-candidate baseline contains bounded V10D AI-arbiter decisions and is not a standalone deterministic router.

## Exact V1 risk frontier

The following finite risks force review and never directly reject a semantic candidate:

- component containment;
- lifecycle/reuse;
- context-only language;
- process material;
- duplicate row identity;
- ingredient-group conflict;
- row-scoped quantity conflict;
- collective reference;
- partial identity match.

These are the frozen V10B source-risk classes. The contract maps generic seasoning, passive carry, isolated components, ambiguous reference, transfer/assembly, and serving/garnish evidence into these routing risks and/or finite diagnostic tags rather than adding unmeasured vetoes.

## V10G role

| Combination | Correct | Incorrect | Observed precision/positive share |
|---|---:|---:|---:|
| Union candidate + V10G accept | 773 | 0 | 100% |
| Reviewer disagreement + V10G accept | 62 | 0 | 100% |
| Both accept + V10G accept | 711 | 0 | 100% |
| Both accept + V10G reject | 52 | 9 | 85.25% positive |
| Disagreement + V10G reject | 8 | 19 | 29.63% positive |
| Standalone active-object rescue signal | 131 | 0 | 100% |

V10G is retained as `REVIEW_PRIORITY_SIGNAL` and diagnostic metadata. V10G rejection cannot support `AUTO_REJECT`; it contains correct relationships. The 131-row deterministic rescue-positive subset is promising, but V1 does not allow it to override a risk flag because the experiment failed its precommitted pronoun/deictic gate and was not frozen as an independent candidate-union routing policy.

## Routing decisions

- `AUTO_ACCEPT`: structurally valid ingredient-step candidate; two complete valid reviewer `ACCEPT` votes; complete exact-version evidence; zero V1 risks.
- `REVIEW_REQUIRED`: any disagreement, risk, incomplete/invalid reviewer, unavailable evidence, unsupported relationship class, or both-reject/positive-evidence conflict.
- `AUTO_REJECT`: verified structural invalidity only. Semantic uncertainty is never auto-rejected.

Risk and failure take precedence over auto-accept. Reviewer output failure blocks the proposal; it does not silently reduce the contract to one reviewer.

## Human and map approval semantics

Human decisions are candidate-level append-only events. Corrections append a superseding event. Bulk review may submit many explicit candidate decisions atomically but cannot create a wildcard approval.

Approval is map-level. A map becomes approved only after both complete reviewer outputs, complete normalization/evidence, every candidate resolved, every review item human-decided, exact source reread, required whole-source completeness attestation, immutable persistence, and exact readback. Approved maps never mutate in place.

The mapping revision is `${parserVersion}:sha256:${mappingSourceHash}`, using the repository's current exact `JSON.stringify({ ingredients, instructions })` SHA-256 canonicalization. Any parsed ingredient/instruction text/order/header or parser-version change creates a new revision. Metadata-only changes do not.

## Failure closure and runtime boundary

Reviewer, schema, normalization, evidence, review-data, persistence, or revision failures all mean **not approved**. Same-revision ingestion is idempotent; reviewer attempts and human decisions are append-only; candidate and approved-map identities are deterministic.

The future runtime must consume only an exact-revision approved map and make zero AI calls. A stale prior map cannot drive a changed source. Current v4/v5 runtime behavior is unchanged by this documentation task.

## Prepared components

Deferred to a separately versioned candidate/review contract. V10A component arbitration accepted 66/75 correct and 97/121 incorrect candidates, approximately 40.49% precision, so ingredient routing cannot safely absorb component semantics.

## Review burden and quality caveat

The initial measured design target is:

- 44.37% candidate relationships auto-accepted;
- 55.63% candidate relationships reviewed;
- 34/36 frozen recipes with review;
- 14.09 review items per affected recipe.

This is higher than the architecture reassessment's V10G planning estimate because the selected policy excludes the non-standalone AI-arbiter frontier. The contract protects auto-accept precision; it does not repair the 35 frozen relationships missed by both reviewers. Production activation therefore still requires end-to-end recall/severity gates and map-level completeness behavior.

## Durable artifacts and verification

- Normative contract: `docs/architecture/cooking-mode-review-routing-contract.md`
- Machine-readable evidence: `docs/audits/cooking-mode-review-routing-contract-analysis-2026-08-28.json`
- Readable analysis: this file
- Pure arithmetic: `scripts/analyze-cooking-mode-review-routing-contract-core.mjs`
- Focused tests: `tests/cookingModeReviewRoutingContract.test.js`

## Next implementation prompt

Add contract types, candidate/revision ID helpers, the frozen V1 evidence adapter, a pure routing table, and focused serialization/policy tests. Do not add Firestore, AI, UI, runtime integration, or production activation.

Design gate: **no UI impact**.
