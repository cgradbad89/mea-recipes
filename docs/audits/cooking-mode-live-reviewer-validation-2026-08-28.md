# Cooking Mode — Live Blind-Reviewer Transport & Schema Validation

**Date:** 2026-08-28
**Type:** VALIDATION (not accuracy tuning, not persistence)
**Full machine-readable record:** [`cooking-mode-live-reviewer-validation-2026-08-28.json`](./cooking-mode-live-reviewer-validation-2026-08-28.json)

## Result

```
PASS — LIVE REVIEWER PIPELINE VALIDATED
```

The implemented two-reviewer transport, prompt, schema, coverage attestation, parsing,
retry behavior, candidate union, and routing orchestration were exercised end to end against
the real, currently configured Vercel AI Gateway model (`openai/gpt-5.6-luna`) via the actual
production call path — `generateMappingProposal` → `executeBlindMappingReviewers` →
`executeMappingReviewer` → `buildMappingProposal` → `routeMappingCandidate` — and worked
correctly on every call.

## Starting state

- Branch: `main`. HEAD and `origin/main` both matched the expected checkpoint
  `7763ca5304c6e7e22866b3a43cf64954634e1c5d` before this session began.
- The worktree carried unrelated pre-existing dirty state: one modified, unrelated audit JSON
  (`docs/audits/cooking-mode-v10f-lite-active-object-go-no-go-2026-08-28.json`) and a set of
  untracked files. Investigation found most of the untracked files to be byte-identical
  duplicate junk (macOS-style `" 2"`-suffixed copies of already-tracked files —
  `app/error 2.tsx`, `lib/admin 2.ts`, three `firebase-debug *.log` files, etc.) that were
  corrupting Next's generated route types and blocking `npm run typecheck`/`npm run build`.
  With the user's explicit approval, these verified-duplicate files were deleted; nothing
  unique or unrelated to this pollution was touched. `.eslintrc.json` (a legitimate, non-dup
  legacy ESLint config coexisting with `eslint.config.mjs`) was left alone.

## Validation set (5 recipes)

Read verbatim (recipeId, exact parsed `ingredients`/`instructions` arrays) from the existing
repository audit evidence in
[`cooking-mode-completeness-audit-2026-08-26.json`](./cooking-mode-completeness-audit-2026-08-26.json),
itself produced by running the real production parser. No Firestore reads were performed and
no recipe was mutated or rewritten.

| Recipe | Rows / Steps | Why selected |
|---|---|---|
| Garlic Butter Herb Steak Bites with Potatoes | 9 / 3 | Straightforward direct ingredient use (named example) |
| Grilled Zucchini and Summer Squash | 8 / 4 | Whole-dish / continuation semantics — marinade then grill (named example) |
| Caprese Salad | 7 / 4 | Pronoun / collective reference — simple assembly + a final whole-dish seasoning step (named example) |
| Sheet-Pan Bibimbap | 11 / 4 | Component-boundary / leakage risk — sauce + bowl assembly; sourced from the frozen v10e remaining-FN taxonomy |
| Chickpea and Fennel Ratatouille | 12 / 3 | Seasoning historically-difficult case — sourced from the frozen v10b 20-false-positive set (generic salt/pepper/oil "to taste" re-triggers) |

## Locked implementation

SHA-256 of the 8 frozen implementation files was recorded before the first live call and
recomputed after all 6 orchestration runs completed. **All 8 hashes are identical pre- and
post-run** — zero implementation drift, because the pipeline worked correctly on the first
live attempt and no defect was discovered that required a fix.

| File | SHA-256 (pre = post) |
|---|---|
| `lib/cookingModeMappingReviewer.ts` | `55782c87d893e4d0432d06547e62e87d0c98d32f04c32071ff1a5d9b148daf24` |
| `lib/cookingModeMappingOrchestrator.ts` | `5bd532a156a9a1180a10504019a316439841936abbc1d854b2c9c33289445526` |
| `lib/cookingModeMappingProposal.ts` | `65c9362fac35f37e4dce12dace730440ca19cd52af881298dc4791000317c032` |
| `lib/cookingModeMappingRouter.ts` | `542a055a1313f7a3e5478b048dabb0c5eca0dc61719d061e86e9db0a6e848d49` |
| `lib/cookingModeMappingEvidence.ts` | `5f5abd205e1ea53b4d1e197f4e15e720132c4ed1887c93c18f7c20440b122abc` |
| `lib/cookingModeMappingRiskFacts.ts` | `047ed65007bd0fcf0f00faf143f05f9e827c3f34fd008e1b4a30023836c45957` |
| `lib/ai.ts` | `468185b2d9cf1c66b4c211347b6da73c6f7daecb9b1b8de8960868dd1fcb1958` |
| `lib/aiConfig.ts` | `b482196a3daa3139f9c7cb899c8f6722d23a1d6ba2947898d2d3008b61fa674b` |

## Live AI execution

- Model: `openai/gpt-5.6-luna` (Vercel AI Gateway), matching `lib/aiConfig.ts` and PRD §1.
- **12 live calls total** = 5 recipes × 2 blind reviewers (10) + 1 repeated recipe pair
  (Caprese Salad, run a second time) × 2 blind reviewers (2). Exactly the hard cap; the
  sample was not expanded after seeing results.
- **0 retries.** Every one of the 12 reviewer executions succeeded on attempt 1 with
  `parseStatus: VALID`.
- Token usage across all 12 calls: 9,406 input / 7,567 output / 16,973 total. Dollar cost was
  not fabricated — the existing AI helper doesn't track it.

## Schema / coverage

- All 12 reviewer executions returned schema-valid, coverage-complete output on the first
  attempt. `reviewedCellCount === nonHeaderIngredientRowCount * stepCount` held for every
  execution (e.g. Chickpea and Fennel Ratatouille: 12 × 3 = 36, matched exactly).
- No missing coverage was ever silently treated as a semantic `REJECT` — every reviewer result
  used for voting had `parseStatus === 'VALID'`.
- Out-of-range-index rejection and empty-exhaustive-output legality were **not exercised
  live** (no provider response happened to trigger either case in this run); both are
  enforced by `parseMappingReviewerOutput`/schema code inspected directly, and are covered by
  the existing mocked unit tests, which were re-run and pass (see Tests below).
- Output-hash correctness was directly confirmed live: two reviewer executions (across
  different runs) that produced byte-identical normalized relationship sets produced
  byte-identical `normalizedOutputHash` values, and every execution with a different accepted
  set produced a different hash.

## Blindness

**PASS.** `executeBlindMappingReviewers` takes one immutable source snapshot and starts
reviewer A and reviewer B concurrently via `Promise.all` from that same snapshot; neither
branch ever sees the other's result. `buildMappingReviewerPrompt(source, recipeRevision)` is a
pure function of the source snapshot alone — it has no `reviewerSlot` parameter and cannot
reference the other reviewer's identity or output, so A and B are byte-identical in prompt
content by construction. Empirically: every execution recorded identical
`reviewerContractVersion`/`promptVersion`/`modelId` for both slots, distinct `runId`/`attemptId`
per slot and per run, and — most tellingly — reviewer A and reviewer B produced genuinely
different accepted-relationship sets on 3 of the 6 orchestration runs, which is only possible
if each executed independently.

## Per-recipe results

| Recipe | A accepted | B accepted | ∩ | ∪ (candidates) | AUTO_ACCEPT | REVIEW_REQUIRED | AUTO_REJECT | approvalBlocked |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Garlic Butter Herb Steak Bites w/ Potatoes | 13 | 13 | 13 | 13 | 8 | 5 | 0 | true |
| Grilled Zucchini and Summer Squash | 12 | 22 | 12 | 22 | 8 | 14 | 0 | true |
| Caprese Salad | 12 | 7 | 7 | 12 | 7 | 5 | 0 | true |
| Sheet-Pan Bibimbap | 18 | 18 | 18 | 18 | 4 | 14 | 0 | true |
| Chickpea and Fennel Ratatouille | 32 | 32 | 32 | 32 | 9 | 23 | 0 | true |

Union math was cross-checked programmatically for every recipe (`|A ∪ B| == candidateCount`),
and every candidate's `routingDecision` was cross-checked against the contract's stated
precedence rules (both-ACCEPT + no risk → `AUTO_ACCEPT`; both-ACCEPT + any risk →
`REVIEW_REQUIRED`; disagreement → `REVIEW_REQUIRED`) — **zero mismatches** across all 97 unique
candidates generated. `approvalBlocked` was `true` for all 6 proposals with
`CANDIDATE_REVIEW_REQUIRED` in `blockingReasons`, exactly as required whenever any candidate
needs human review; none silently proceeded toward approval.

Zero `AUTO_REJECT` candidates were produced (no structurally invalid index existed in the real
parsed recipe data used) — structural-invalidity `AUTO_REJECT` behavior therefore was not
exercised live in this run, only via the existing (re-run, passing) router unit tests.

## Repeat-run result (nondeterminism, diagnostic only)

Caprese Salad's full two-reviewer orchestration was run a second time, same source/contract
versions.

- **Identical across runs:** `recipeRevision`, `proposalId`
  (`mp1:5704eb103bca47150b5b250b3210c94159a857cd186e0b6915d6156d4e7d7de2`), and the full set of
  12 `candidateId`s.
- **Different across runs (expected):** reviewer `runId`/`attemptId` on both slots (fresh per
  call, as designed).
- **Reviewer output:** reviewer A returned byte-identical accepted relationships and output
  hash in both runs. Reviewer B accepted 5 additional relationships in run 2 that it had
  rejected in run 1 — moving those 5 candidates from reviewer-disagreement to reviewer-
  agreement. In **all 5 cases the `routingDecision` stayed `REVIEW_REQUIRED` in both runs**,
  because deterministic `LIFECYCLE_RISK` evidence was present regardless of reviewer
  agreement — the risk-gate correctly prevented the agreement flip from silently becoming
  `AUTO_ACCEPT`.
- **Operational conclusion:** logical identity (proposal/candidate) is stable and idempotent
  across reruns as designed; reviewer-level semantic nondeterminism exists (as the contract
  explicitly accepts) but never bypassed the deterministic risk gate. No byte-identical AI
  output was required or expected.

## Semantic spot check (not a new benchmark)

No obviously nonsensical relationships were observed in any `AUTO_ACCEPT` set across the 5
recipes. The single most notable finding: on **Chickpea and Fennel Ratatouille**, both live
reviewers *agreed* to accept a generic-seasoning re-trigger (salt, pepper, and olive oil rows
re-fired against the later roasting step) — the exact `CONSUMED_ROW`-style false-positive
class the prior offline v10b audit flagged for this recipe. The deterministic V1 risk gate
(`COMPONENT_CONTAINMENT_RISK` + `LIFECYCLE_RISK`) correctly downgraded all three to
`REVIEW_REQUIRED` instead of `AUTO_ACCEPT`. This is direct live evidence that the risk gate
does its job even when both real reviewers agree on a historically-difficult case — a positive
result, not a systemic concern. **No systemic semantic failure observed.**

## Failure-closed behavior

- Risk always won over agreement: every candidate with both reviewers `ACCEPT` and any
  non-empty `deterministicEvidence.risks` routed to `REVIEW_REQUIRED`, never `AUTO_ACCEPT`.
- Disagreement always routed to review.
- No proposal reached an implicit/partial approved state; every proposal with any
  `REVIEW_REQUIRED` candidate correctly reported `approvalBlocked: true`.
- Structural-invalidity `AUTO_REJECT` was not triggered live (clean source data) — verified
  instead via the existing, re-run, passing router unit tests.

## Architecture safety

Firestore reads for the new mapping pipeline: **0**. Firestore writes: **0**. Recipe writes:
**0**. Map writes: **0**. Review-record writes: **0**. Deployments: **0**. Recipe source data
came from an already-committed local audit JSON file, not Firestore.

## Tests, lint, typecheck, build

- Focused mapping tests (`cookingModeMappingOrchestration`, `cookingModeMappingCore`,
  `cookingStepBlindReviewerAi`, `cookingModeReviewRoutingContract`): **129 / 129 passed**,
  before and after the live run (no code change occurred between the two runs).
- No implementation defect was found, so **0 new tests were added** (Phase 15's "no code
  change required → no new tests required" applies).
- Full suite: `npm test` → **1087 passed, 1 skipped / 1088 total** (pre-existing skip,
  unrelated).
- `npm run lint` → 0 errors, 6 pre-existing warnings unrelated to this session.
- `npm run typecheck` → **PASSED** (after removing the pre-existing duplicate-file pollution
  described above, with the user's approval).
- `npm run build` → **PASSED** (Next.js 16.3.1 / Turbopack, 27 routes).

## Gate

```
PASS — LIVE REVIEWER PIPELINE VALIDATED
```

## Next task

```
DESIGN AND IMPLEMENT MAPPING PROPOSAL / REVIEW / APPROVED-MAP PERSISTENCE
```
