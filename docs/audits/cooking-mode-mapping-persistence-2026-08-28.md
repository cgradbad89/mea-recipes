# Cooking Mode — Mapping Proposal, Review, and Approved-Map Persistence

**Date:** 2026-08-28
**Type:** IMPLEMENTATION (persistence/services only — no UI, no runtime cutover, no AI changes)

## Result

```
MAPPING PERSISTENCE LAYER IMPLEMENTED
```

This task resolves the physical persistence model that
`docs/architecture/cooking-mode-review-routing-contract.md` §20 deliberately deferred, and
implements it as production TypeScript services. It changes no reviewer prompt, no routing
precedence, no risk contract, and no Cooking Mode runtime behavior. The new paths are written and
readable but **inactive** — nothing reads them at request time yet.

## Starting state

Branch `main`, HEAD/`origin/main` both at `73192b688837078daaa5f7d99712462c78f79809` (the expected
checkpoint). Working tree carried two unrelated pre-existing items, both preserved untouched:
a modified `docs/audits/cooking-mode-v10f-lite-active-object-go-no-go-2026-08-28.json` and an
untracked `.eslintrc.json` (legacy config coexisting with `eslint.config.mjs`).

## Physical Firestore model

```text
recipes/{recipeId}/mappingProposals/{proposalId}
recipes/{recipeId}/mappingProposals/{proposalId}/candidates/{candidateId}
recipes/{recipeId}/mappingProposals/{proposalId}/reviewEvents/{decisionId}
recipes/{recipeId}/approvedMappings/{mapId}
recipes/{recipeId}/cookingModeMappingPointer/current
```

Kept under the shared `recipes/{id}` catalog root (not `users/{uid}`) because these are shared
catalog artifacts with exactly one recipe-admin identity in this app. Subcollections — never one
embedded array — because a candidate population of dozens of relationships per recipe must not grow
inside the `recipes/{id}` document itself or hit an array-growth/document-size risk. Every query is
either a get-by-known-id or an unfiltered read of one small, bounded subcollection, so **no new
composite index is required or was created**. See PRD.md §3 and architecture-contract §25 for the
full write-up, including the two documented naming deviations from the task's illustrative
snippets (kept the already-normative §14/§15 names/shapes; added `Persisted…` for the Firestore
variants).

## Files created

- `types/cookingModeMappingPersistence.ts` — persistence contracts: `PersistedMappingProposalV1`,
  `PersistedMappingCandidateV1`, `PersistedMappingReviewDecisionV1`,
  `PersistedApprovedCookingStepMapV1`, `ApprovedIngredientStepRelationshipV1`,
  `ApprovedMapProvenanceV1`, `CurrentApprovedMappingPointerV1`, plus service I/O types.
- `lib/cookingModeMappingFirestore.ts` — physical path builders and the minimal
  `MappingFirestoreLike` dependency-injection interface (a structural subset of the Admin SDK
  `Firestore` type) that every persistence service is written against.
- `lib/cookingModeMappingPersistenceErrors.ts` — shared `MappingPersistenceConflictError` /
  `MappingPersistenceFailureError` classes (one identity across every service file).
- `lib/cookingModeMappingPersistenceIdentity.ts` — `mr1:` review-decision identity, `am1:`
  approved-map identity/hash/version, canonical relationship sort/dedup.
- `lib/cookingModeMappingProposalPersistence.ts` — `saveMappingProposal`, `getMappingProposal`,
  `getMappingCandidate`, `listMappingCandidates`, `listReviewRequiredCandidates`.
- `lib/cookingModeMappingReviewPersistence.ts` — `appendMappingReviewDecision`,
  `getMappingReviewHistory`, `listAllMappingReviewEvents`, `computeProposalCompletion`.
- `lib/cookingModeMappingApprovedPersistence.ts` — `buildApprovedMapping` (pure),
  `persistApprovedMapping`, `getApprovedMapping`, `updateCurrentApprovedMappingPointer`,
  `getCurrentApprovedMappingPointer`.
- `tests/helpers/fakeMappingFirestore.ts` — in-memory `MappingFirestoreLike` test double.
- `tests/helpers/mappingPersistenceFixtures.ts` — deterministic (zero-AI) `MappingProposalV1`
  fixture builder reusing the already-tested pure `buildMappingProposal` constructor.
- `tests/cookingModeMappingPersistenceIdentity.test.ts` (18 tests)
- `tests/cookingModeMappingProposalPersistence.test.ts` (12 tests)
- `tests/cookingModeMappingReviewPersistence.test.ts` (14 tests)
- `tests/cookingModeMappingApprovedPersistence.test.ts` (18 tests)

## Files modified

- `PRD.md` — new Data Model subsection for the five paths above; new manual Console rules under
  "Firestore rules"; updated the "Cooking Mode recall remediation" Feature Backlog row.
- `docs/architecture/cooking-mode-review-routing-contract.md` — new §25 documenting the resolved
  persistence model, identity/hash rules, authorization, and the two naming deviations.

## Design gate

`no UI impact` — confirmed. No `app/**/page.tsx`, no `components/**`, no new `app/api/**/route.ts`
were added or changed.

## Key behaviors verified by the new tests

- **Identity/immutability**: review-decision id and approved-map hash are both deterministic and
  order/duplicate-insensitive; changing any identity-relevant field changes the hash; recipe
  revision and proposal changes always change the map's identity.
- **Proposal persistence**: header + full candidate population written; a partial candidate write
  (simulated via a doc-write-dropping test double) never leaves the header claiming `READY`; exact
  replay is idempotent and never resets a candidate a human has since decided; conflicting
  identity/content fails closed without any partial mutation.
- **Review decisions**: ACCEPT/REJECT recorded and materialized; note required only when
  `reasonCode` is `OTHER`; only `REVIEW_REQUIRED` candidates accept a decision; stale revision and
  unknown-candidate calls are rejected; exact-replay is idempotent; a correction requires and
  validates `supersedesDecisionId`; the full append-only chain is reconstructable and the
  superseded event's original content is never edited.
- **Completion/approval**: an unresolved `REVIEW_REQUIRED` candidate blocks the map; a proposal-level
  reviewer-incomplete flag blocks the map; any `AUTO_REJECT` candidate blocks the map; a fully
  resolved proposal builds exactly its accepted set with a completeness attestation and a
  deterministic hash.
- **Approved-map persistence**: first write, exact-replay idempotency, fail-closed on corrupted
  same-`mapId` content, and multiple immutable maps preserved across two different recipe
  revisions.
- **Pointer**: only updates after a persisted, hash-reverified map; reports `CURRENT`/`STALE`/
  `NOT_FOUND` correctly; refuses to point at a map that was never persisted or belongs to a
  different recipe.

## Architecture safety

AI calls in these tests: **0** (fixtures use the existing pure `buildMappingProposal` with synthetic
reviewer results — no `generateMappingProposal`, no AI Gateway call). Production Firestore writes:
**0** (all tests run against an in-memory test double). Cooking Mode runtime/UI: **unchanged**.
Review UI: **none added**. Existing-corpus remediation: **not run**.

## Firestore rules

**Not deployed.** The `malignant-metro` project's rules are managed manually in the Firebase
Console and shared with other apps; this repo is contractually forbidden from adding a deployable
`firestore.rules` file or running `firebase deploy`. The required manual addition is documented
verbatim in PRD.md "Firestore rules". Because the repo has no rules file to test against, genuine
`@firebase/rules-unit-testing` emulator coverage of these new paths is **not possible without first
performing the forbidden manual deployment** — this is a documented manual blocker, not an
oversight. Persistence *logic* (identity, idempotency, atomicity, conflict handling) is instead
fully covered by the in-memory Firestore test double, which has no concept of rules or auth by
design.

## Indexes

None required; none created; none deployed. See "Physical Firestore model" above.

## Tests, lint, typecheck, build

- New focused tests: **62** (identity 18, proposal 12, review 14, approved-map/pointer 18).
- Full suite: `npm test` → **1149 passed, 1 skipped / 1150 total** (up from the prior session's
  1087 passed / 1088 total — the skip is the same pre-existing, unrelated skip).
- `npm run lint` → 0 errors, the same 6 pre-existing warnings unrelated to this session.
- `npm run typecheck` → PASSED.
- `npm run build` → PASSED (Next.js 16.3.1 / Turbopack, 27 routes — unchanged route count).

## Next task

Design and implement the human-review UI (candidate context, votes/evidence display, decision
submission, map-level completeness attestation) as a separate, explicitly-scoped design task —
this persistence layer already exposes the read/write surface it needs
(`getMappingProposal`, `listReviewRequiredCandidates`, `getMappingCandidate`,
`getMappingReviewHistory`, `appendMappingReviewDecision`, `getApprovedMapping`,
`getCurrentApprovedMappingPointer`). Runtime cutover, existing-corpus remediation, and production
activation remain separately gated and out of scope until the end-to-end recall/severity gates in
architecture-contract §23 are met.
