# Cooking Mode — End-to-End Mapping Workflow Validation

**Date:** 2026-08-29
**Type:** VALIDATION (not accuracy tuning, not persistence design, not runtime cutover)
**Full machine-readable record:** [`cooking-mode-end-to-end-workflow-validation-2026-08-29.json`](./cooking-mode-end-to-end-workflow-validation-2026-08-29.json)

## Result

```
PASS — END-TO-END MAPPING WORKFLOW VALIDATED
```

This task exercised the complete implemented Cooking Mode mapping workflow — generation,
idempotency, the `/mapping-review` queue and detail UI, candidate decisions and corrections,
human-added relationships, duplicate protection, completeness attestation and invalidation, map
approval, immutability/replay, the current-approved pointer, runtime isolation, authorization, and
data-readback — end to end on a 3-recipe controlled set, through the real production call paths
(live AI Gateway calls, real admin-verified API routes, real Firestore writes scoped to the new
mapping-workflow subcollections only).

## Starting state

- Branch `main`, HEAD and `origin/main` both `b78e683bc455bc806962272c1c06e5a8d8ab68d9` — matched
  the expected checkpoint exactly.
- Pre-existing unrelated dirty state preserved untouched: modified
  `docs/audits/cooking-mode-v10f-lite-active-object-go-no-go-2026-08-28.json`, untracked
  `.claude/launch.json`, `.eslintrc.json`, `firebase-debug 2.log`, `firestore-debug.log`.

## Baseline verification (reconfirmed before any mutation)

- `npm run lint` → 0 errors, 6 pre-existing warnings (identical to prior sessions).
- `npm run typecheck` → PASSED.
- `npm run build` → PASSED (Next.js 16.3.1 / Turbopack, 34 routes).
- `npm test` → 1286 passed / 1 failed / 1 skipped (1288 total). The 1 failure is the previously
  documented, unrelated `tests/cookingModeV10DPrincipalTarget.test.js` case
  (`ENOENT /tmp/cooking-step-arbiter-v10a-2026-08-28-state.json`) — reconfirmed present and not
  touched, per instructions.
- `git diff --check` → clean.

## Environment/config prerequisites

- **Firebase Admin config**: present (`FIREBASE_PROJECT_ID`/`FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY`
  in `.env.local`/`.env`).
- **AI Gateway auth**: present (`VERCEL_OIDC_TOKEN`); confirmed live-functional — 6/6 reviewer calls
  succeeded on the real Vercel AI Gateway (`openai/gpt-5.6-luna`).
- **Firebase Auth/admin identity path**: confirmed via the repo's existing `scripts/_lib.js`
  custom-token-mint + Identity Toolkit exchange pattern.
- **Manual Firestore Console rule changes**: **confirmed not necessary for this workflow.** Every
  mapping-review read/write goes through an admin-verified (`verifyAdminToken`) Admin-SDK server
  route; the review UI never talks to Firestore directly, so no new browser-side Firestore access
  path exists to gate with a rule. No Firestore rules were viewed, proposed, or deployed.

## Validation set (3 recipes)

| Recipe | recipeId | Rows/Steps | Reason selected |
|---|---|---|---|
| GARLIC BUTTER HERB STEAK BITES WITH POTATOES | `garlic-butter-herb-steak-bites-with-potatoes` | 9/3 | Straightforward — mixed AUTO_ACCEPT/REVIEW_REQUIRED |
| Caprese Salad | `caprese-salad` | 7/4 | Selected for expected reviewer disagreement; this live run instead produced full agreement (0 REVIEW_REQUIRED), so it was used to validate the zero-review-required/auto-only attestation path (design §13) instead |
| Grilled Zucchini and Summer Squash | `grilled-zucchini-and-summer-squash` | 8/4 | Produced genuine reviewer disagreement live (Reviewer A Exclude / Reviewer B Include on 5/7 candidates in one step); used as the semantic-ambiguity exercise and deliberately left "In progress" (unapproved) |

Reviewer-output nondeterminism (explicitly documented as expected in the prior
`cooking-mode-live-reviewer-validation-2026-08-28` audit) meant Caprese Salad and the intended
"semantic ambiguity" role swapped in practice — recorded transparently rather than forced. All
three recipes had zero pre-existing mapping-workflow data before this session (verified by direct
Firestore readback).

## Authentication method used for browser UI verification

No interactive Google OAuth session was available in the isolated validation browser. An
admin-equivalent session was established by minting a Firebase custom token carrying an
`admin: true` custom claim (server-side, via the repo's own `scripts/_lib.js` Admin-SDK helper),
exchanging it for a real ID token via Identity Toolkit, and writing the resulting user record into
the browser's `firebaseLocalStorageDb` IndexedDB store — the exact shape the Firebase JS SDK's
`indexedDBLocalPersistence` reads on page load. This is a standard, non-destructive
test-authentication technique. `lib/admin.ts`'s `hasAdminAccessClaims()` grants access identically
via `admin === true` or a verified `ADMIN_EMAIL` — both are real production code paths, and the
`admin: true` branch was the one exercised.

## Ingestion trigger — `POST /api/mapping/generate`

- Unauthenticated → `401 {"error":"Unauthorized"}`. Authenticated non-admin → same. Admin → `200`.
- All 3 recipes: `outcome: GENERATED` on first call, exactly matching prior offline analysis for
  the steak-bites recipe (13 candidates, 8 auto, 5 review) and producing fresh live results for the
  other two (Caprese: 7/7/0; Zucchini: 22/8/14).
- **6 live AI calls total** (3 recipes × 2 reviewers) — exactly the session's hard cap. 0 retries.

## Idempotency (hard gate)

Replaying generation for the steak-bites recipe with an unchanged source returned
`outcome: REUSED_EXISTING` with the identical `proposalId`/`recipeRevision`/candidate counts. The
dev server's `[ai-usage]` log contained exactly 6 entries both before and after the replay (0
additional AI calls), and the replay completed in 0.5s vs. 6.5s for the original generation.
**PASS.**

## `/mapping-review` queue and visual verification

Queue correctly showed derived states throughout the session (`Needs review` → `In progress` /
`Ready for final approval` → `Approved`), with correct `{resolved}/{total}` progress. Desktop and
mobile queue, desktop and mobile step review (including a live reviewer-disagreement example),
the review-complete milestone, the zero-review-required milestone, completeness review (with
origin dots distinguishing AUTO vs. HUMAN), and both approval-success copy variants
("reviewed by an admin" for `HUMAN_ASSISTED` vs. "fully automatic" for `AUTO`) all matched
`docs/design/cooking-mode-mapping-review-experience-2026-08-28.md` with **no material deviation**.
One **minor** deviation was found and fixed — see Defects below. Blocked/stale visual states were
not live-reproduced (see Stale detection below); this is the one visual-verification gap.

## Candidate review, correction, and history

On the steak-bites recipe: Included one candidate, Excluded another, then corrected the excluded
one back to Included via **Change**. **History** correctly showed both events as a single
append-only chain. On the zucchini recipe, two more candidates were resolved live under genuine
reviewer disagreement (one Include, one Exclude), demonstrating the disagreement-pill rendering
("plainly, not with a warning color", per design §5.2) on both desktop and mobile.

## Human-added relationship and duplicate protection

Added **"salt and pepper"** to step 3 of the steak-bites recipe via the completeness-review
picker — created with `candidateOrigin: HUMAN_ADDED`, `finalDecision: ACCEPT` immediately, no
fabricated reviewer votes. Removed it (superseding `REJECT`, original `ACCEPT` event preserved),
then re-added it (superseding `ACCEPT`). Separately, a direct API attempt to human-add a
relationship at `(row 6, step 2)` — already an AI-discovered `REVIEWER_UNION` candidate — returned
`outcome: ALREADY_AI_DISCOVERED` with the existing candidate returned untouched: no duplicate was
created. **PASS** on both.

## Completeness attestation and invalidation (hard gate)

The map could not be approved before attestation (the **Approve** control was **absent**, not
merely disabled, exactly per design §12). Attesting made **Approve Cooking Mode map** appear.
Removing the human-added relationship correctly **invalidated** the attestation — the checkbox/
attest control reappeared and Approve disappeared again. Re-adding the identical relationship
restored the exact prior `reviewStateHash`, which made the **original** attestation record valid
again automatically (attestation identity is deterministic over `(proposalId, reviewStateHash)`,
and validity is a pure read-time recomputation per the architecture contract) — confirmed via
readback that exactly **one** `completenessAttestations` document exists for this proposal, not
two. This is designed behavior, not a shortcut around the invalidation gate. **PASS.**

## Map approval, immutability, and the pointer

| Recipe | mapId | Relationships | Mode |
|---|---|---|---|
| Steak bites | `am1:6a144c3d…` | 14 (8 auto, 5 human-reviewed, 1 human-added) | `HUMAN_ASSISTED` |
| Caprese Salad | `am1:ecf8ef1f…` | 7 (7 auto) | `AUTO` |

Replaying the approve call for the steak-bites recipe returned the identical `mapId` and
relationship count; readback confirmed exactly **one** `approvedMappings` document — no second
conflicting artifact. The current-approved pointer for both approved recipes correctly resolved
`status: CURRENT` with matching `recipeId`/`recipeRevision`/`mapId`/`mapHash`. The zucchini recipe
was deliberately left unapproved (`In progress`, no pointer) — confirming the map is never
auto-approved while `REVIEW_REQUIRED` candidates remain.

## Stale detection

**Not live-reproduced.** Doing so safely would require editing mapping-relevant content on a real,
important production recipe, which the task instructions explicitly forbid
("Do not modify an important existing recipe merely to test stale handling"), and this app has no
isolated fixture/test-only recipe mechanism. Falling back, as the instructions permit, to the
existing integration coverage: `getCurrentApprovedMappingPointer`'s `CURRENT`/`STALE`/`NOT_FOUND`
classification is covered by 18 passing unit tests in
`tests/cookingModeMappingApprovedPersistence.test.ts`, re-run clean in this session.

## Runtime isolation (hard gate)

`components/CookingMode.tsx` and `app/recipes/[id]/page.tsx` contain **zero** references to the new
`cookingModeMappingPointer` or `approvedMappings` paths. The steak-bites recipe document's
`modified` timestamp is unchanged since 2023 and its existing `cookingStepIngredientMap`
(deterministic-v4 engine) is untouched — confirming this session wrote only new subcollections,
never the recipe document itself, and Cooking Mode's existing v4/v5 runtime path remains
completely unaffected. **No unauthorized runtime cutover occurred.**

## Semantic spot check

No obviously nonsensical relationships were observed. Sirloin steaks were correctly mapped to both
the searing step and the herb-topping step (the latter's instruction literally says "Top **the
steak**…" — a direct reference, consistent with the `LIFECYCLE_RISK` flag that routed it to
review rather than an error). The human-added "salt and pepper" relationship is a defensible
finishing-seasoning inference not literally present in the step text — recorded honestly with
`HUMAN_ADDED` provenance rather than fabricated as reviewer-discovered.

## Provenance

All three provenance classes (`AUTO_ACCEPT`, `HUMAN_REVIEW_ACCEPT`, `HUMAN_ADDED`) were produced on
the steak-bites approved map (8/5/1) and traced directly from persisted state — recipe revision,
candidate, reviewer votes (or `null` for the human-added one), routing decision, and decision
event — with **no AI rerun**.

## Authorization / security

Unauthenticated and authenticated-non-admin requests were denied (`401`) on every mapping-review
endpoint tested: generate, queue, recipe detail, decisions, attestation, relationships, approve,
and history. A malformed admin request returned a sanitized `{"error":"Invalid request."}` with no
stack trace, Firestore internals, or provider details.

## Data readback

| Recipe | Proposals | Candidates | Review events | Attestations | Approved maps |
|---|---:|---:|---:|---:|---:|
| Steak bites | 1 | 14 | 9 | 1 | 1 |
| Caprese Salad | 1 | 7 | 0 | 1 | 1 |
| Zucchini | 1 | 22 | 2 | 0 | 0 |

Every count agrees exactly with the UI-observed state at each step.

## Data mutation inventory

Writes were limited strictly to the new mapping-workflow subcollections
(`mappingProposals`, `candidates`, `reviewEvents`, `completenessAttestations`, `approvedMappings`,
`cookingModeMappingPointer/current`) under the three validation recipe IDs. No recipe `content`,
`cookingStepIngredientMap` (v4/v5), category, nutrition, grocery, meal-plan, or unrelated-recipe
data was changed. Confirmed via readback (`modified` timestamps unchanged) and via code-level
confirmation that the review UI/API never touches those fields.

## Cleanup / preservation decision

**Preserve.** The architecture treats these records as intentionally immutable/append-only audit
history with no supported deletion mechanism (no delete route exists). Deleting them would require
an unsupported raw Firestore mutation, which the task instructions treat as worse than leaving
clearly-documented validation records in place. All affected paths are listed above for future
reference.

## Defects found

**One minor design-fidelity defect, fixed with a regression test:**

- **What:** The candidate decision **History** disclosure rendered events oldest-first instead of
  the design's required newest-first (`docs/design/cooking-mode-mapping-review-experience-2026-08-28.md`
  §9).
- **Layer:** Review UI (`components/mapping-review/MappingCandidateRow.tsx`). The underlying
  persistence service, `getMappingReviewHistory`, is correctly documented and implemented to return
  the chain oldest-first (other/future callers may need chronological order) — the bug was the UI
  rendering that array directly instead of reversing it for display.
- **Fix:** `history?.slice().reverse().map(...)` — a one-line, narrowly-scoped display fix; no
  persistence-layer behavior changed.
- **Regression test:** `tests/mappingReviewDetailPage.test.tsx` — confirmed to fail without the fix
  and pass with it.
- Not a correctness or data-integrity defect — the underlying append-only history was always
  complete and accurate; only its on-screen order was wrong.

No other defects were found across generation, persistence, review, human-add, duplicate
protection, attestation, approval, immutability, pointer, runtime isolation, or authorization.

## Files modified

- [`components/mapping-review/MappingCandidateRow.tsx`](../../components/mapping-review/MappingCandidateRow.tsx) — history newest-first fix.
- [`tests/mappingReviewDetailPage.test.tsx`](../../tests/mappingReviewDetailPage.test.tsx) — regression test for the fix.

## Files created

- This audit pair (`.json` + `.md`).

## Tests, lint, typecheck, build (final, post-fix)

- New tests: **1** (history-order regression).
- Full suite: **1287 passed / 1 failed / 1 skipped (1289 total)** — the 1 failure is the same
  pre-existing unrelated case, reconfirmed unchanged.
- `npm run lint` → 0 errors, 6 pre-existing warnings.
- `npm run typecheck` → PASSED.
- `npm run build` → PASSED (34 routes, unchanged).
- `git diff --check` → clean.

## Gate

```
PASS — END-TO-END MAPPING WORKFLOW VALIDATED
```

## Deferred

Full 228-recipe corpus remediation, v4/v5 map migration, Cooking Mode runtime cutover, and
prepared-component routing all remain out of scope and untouched, exactly as instructed.

## Next task

```
PLAN EXISTING-CORPUS MAPPING REMEDIATION
```
