# Cooking Mode — Existing-Corpus Remediation Planning — 2026-08-29

**Type:** DISCOVERY / REMEDIATION PLANNING — no AI corpus calls, no proposal generation, no writes.
**Full machine-readable record:** [`cooking-mode-existing-corpus-remediation-planning-2026-08-29.json`](./cooking-mode-existing-corpus-remediation-planning-2026-08-29.json)
**Normative plan:** [`docs/architecture/cooking-mode-existing-corpus-remediation-plan.md`](../architecture/cooking-mode-existing-corpus-remediation-plan.md)

## Result

```
READY FOR PILOT CORPUS REMEDIATION
```

## Starting state

Branch `main`, HEAD and `origin/main` both `c3a1e8a` — matched the expected checkpoint exactly. All
pre-existing unrelated dirty state preserved untouched: modified
`docs/audits/cooking-mode-v10f-lite-active-object-go-no-go-2026-08-28.json`, untracked
`.claude/launch.json`, `.eslintrc.json`, `firebase-debug 2.log`, `firestore-debug.log`.

## Current corpus (read-only, re-measured 2026-08-29T13:15:37Z)

| Metric | Count |
|---|---:|
| Total shared `recipes/{id}` docs | 237 |
| Malformed/non-recipe docs | 1 |
| Usable recipes | 236 |
| Recipes with a current v4/v5 persisted map | 229 |
| — `deterministic-v4` | 148 |
| — `hybrid-v4` | 39 |
| — `deterministic-v5` | 33 |
| — `hybrid-v5` | 9 |
| Recipes without a persisted map | 7 |
| Recipes with new-system proposal data | 3 |
| Recipes with new-system approved map | 2 |
| Recipes with current-approved pointer | 2 |

229 mapped + 7 unresolved + 1 malformed = 237. This **corrects** the historical undifferentiated
"8 unresolved" figure: one of those eight (`maple-roasted-candied-pecans`) is not a source problem
at all — its `content` field is the literal 4-character placeholder `"Source:"`, with no ingredients
or instructions. The other seven are genuinely unresolved recipes with real (if sometimes defective)
content.

This reconciles exactly against the second historical checkpoint (237 shared / 229 mapped / 8
unresolved) — the corpus has been stable since that checkpoint, net of this session's split of the 8
into 7 unresolved + 1 malformed.

## Remediation scope

| Group | Count | Disposition |
|---|---:|---|
| A — existing mapped usable recipes | 229 | Primary remediation population |
| B — new-system approved (subset of A) | 2 | Already remediated — skip |
| A minus B, resume-only (subset of A) | 1 | `grilled-zucchini-and-summer-squash` — READY proposal, unapproved; resume review, no fresh generation |
| A minus B minus resume-only | 226 | Requires fresh proposal generation |
| C — unresolved source-truth problem | 7 | Excluded unless source is separately fixed |
| D — malformed/non-recipe | 1 | Excluded |
| E — newly added without old mapping | 0 (policy-only) | New recipes already enter the new-system pipeline automatically via Implementation 6's ingestion trigger — never need batch remediation |

## Already-remediated recipes (the 3 end-to-end-validation recipes)

| Recipe | New-system state | Recommendation |
|---|---|---|
| Garlic Butter Herb Steak Bites with Potatoes | Approved, `HUMAN_ASSISTED`, 14 relationships (8 auto, 5 human-reviewed, 1 human-added) | **Count as remediated** |
| Caprese Salad | Approved, `AUTO`, 7 relationships (all auto) | **Count as remediated** |
| Grilled Zucchini and Summer Squash | READY proposal, unapproved, genuine reviewer disagreement partially reviewed | **Resume in pilot**, not fresh-generated |

All three were produced through the real production pipeline — live AI Gateway reviewer calls,
admin-verified persistence, and a real admin decision-maker — during the 2026-08-29 end-to-end
validation. The end-to-end validation audit records no fabricated votes or invented provenance, so
their standing as production truth does not depend on the task label ("validation" vs.
"remediation") that produced them. Recommend a zero-cost live-revision recompute check immediately
before pilot kickoff to reconfirm the two approved pointers still resolve `CURRENT` (not `STALE`)
before formally treating them as skippable — no AI call is required for that check.

## Estimated workload

**Measured** (36-recipe frozen reviewer-union benchmark, `docs/audits/cooking-mode-review-routing-contract-analysis-2026-08-28.md`):

- 44.37% of union candidates `AUTO_ACCEPT`, 55.63% `REVIEW_REQUIRED`
- 34/36 recipes have at least one review item
- 14.09 review items per affected recipe
- 18.76 union candidates/recipe average, 18 median (full 228-recipe corpus)

**Projected** for the 226 recipes needing fresh generation (extrapolation, not measurement — labeled
as such throughout the JSON record):

- ≈4,240 projected union candidates (226 × 18.76)
- ≈2,359 projected review-required relationships (4,240 × 55.63%)
- ≈213 recipes projected to need candidate-level review (226 × 34/36)
- ≈13 recipes projected to need only final completeness review

No human review time-per-item estimate is given — this repository has no authoritative seconds/
minutes-per-relationship data, and none is fabricated here.

## Batch size and ordering

**Default batch size: 10 recipes.** Caps nominal AI calls at 20/batch (bounded max 40 with full
retry), keeps projected review burden to roughly 100 relationships/batch, and yields 23 batches for
the 221 fresh-generation recipes remaining after the pilot.

**Ordering:** descending known severity, ranked by the 2026-08-26 completeness audit's per-recipe
false-negative count, derived programmatically at execution time (the audit JSON is 5.3MB — not
hand-enumerated here beyond the illustrative top 12, reproduced in the JSON record). Round-robin
severity distribution across batches was considered, to smooth per-batch review burden, and rejected
in favor of the simpler front-loaded-risk approach the task instructions favor.

**Concurrency:** sequential recipe generation during the pilot (max 1 in flight); up to 3 concurrent
recipe generations for post-pilot batches (bounded, not unlimited — no existing orchestration
harness runs multiple `/api/mapping/generate` calls concurrently today). Generation and human review
are sequential per batch (generate the whole batch, then review the whole batch) — favoring
operational simplicity and a clean stop point over pipelining, at least until the pilot proves the
mechanism.

## Pilot set (8 recipes)

| Recipe | Action | Why |
|---|---|---|
| Garlic Butter Herb Steak Bites with Potatoes | Reuse/validate | Original problem recipe, already approved |
| Caprese Salad | Reuse/validate | Original problem recipe, already approved |
| Grilled Zucchini and Summer Squash | Resume review only | Original problem recipe, in-progress with genuine disagreement |
| Mole Poblano | Fresh generation | Largest known omission (FN 91), documented parser defect — deliberately exercises the source-remediation failure path |
| Dad's Chili | Fresh generation | FN 49, ambiguous-source semantic difficulty |
| Chicken Stew | Fresh generation | FN 20, component/lifecycle complexity |
| Mediterranean Quinoa Bowl | Fresh generation | 3 steps, 0 currently-mapped ingredients — seasoning/collective-reference case |
| Peanut Butter Oat Protein Shake | Fresh generation | 1 step — simple-recipe case |

Only 5 of the 8 pilot recipes need fresh AI calls (nominal 10, bounded max 20) — the plan
deliberately avoids regenerating the 2 already-approved recipes and the 1 in-progress one, per the
task's explicit "do not duplicate already-approved current maps unnecessarily" instruction.

## Pilot pass/fail gate

All of: valid proposals for all 5 fresh-generation recipes with no unretried transport/schema
failure; every review completable through the existing `/mapping-review` UI; every one of the 8
maps completeness-attested and approved; a source-semantic spot check against the completeness
audit's documented expected values for the 3 original problem recipes; zero identity-collision or
persistence-conflict errors; zero unexpected Firestore index requirements; zero writes to any old
v4/v5 field. Quality gate: 0 known false positives, 0 known CRITICAL false negatives, no regression
on the 3 recipes' originally-reported missing ingredients.

## AI call budget

Nominal 2 calls/recipe (one per reviewer slot); bounded max 4/recipe (2 slots × at most 2 attempts/
slot, per the implemented coordinator). Pilot: 10 nominal / 20 bounded max. Remaining 221
fresh-generation recipes after the pilot: 442 nominal / 884 bounded max. No dollar cost is estimated
— no authoritative pricing metadata exists in this repository.

## Cutover architecture recommendation (tentative, flagged for the cutover task)

iOS/shared-backend compatibility is **not** an open question — PRD.md states explicitly that the
deprecated iOS client is not a compatibility constraint. The real open question is Cooking Mode's
runtime read shape: reading the new pointer/approved-map path directly (Option A) vs. materializing
the approved relationships back onto the existing `cookingStepIngredientMap` field via the same
SHA-locked field-only-apply pattern this repo's v4/v5 tooling already implements (Option B). This
plan tentatively recommends **Option B** for its zero runtime-code-churn and reuse of an
already-proven operational pattern, but flags this as an explicit decision the cutover task must
reconfirm, not silently inherit.

## Remediation UX

**Existing `/mapping-review` UI is sufficient.** No `REMEDIATION UX BLOCKER` is raised. The queue is
a flat, unfiltered list with no batch-grouping or cross-batch progress view, but batches are small
(≤10 recipes) and short-lived enough that external ledger tracking (not new product UI) covers the
gap without risking feature creep.

## Files created

- `docs/architecture/cooking-mode-existing-corpus-remediation-plan.md`
- `docs/audits/cooking-mode-existing-corpus-remediation-planning-2026-08-29.json`
- `docs/audits/cooking-mode-existing-corpus-remediation-planning-2026-08-29.md` (this file)

## Files modified

None (planning/documentation only).

## Production mutation

- Firestore writes: **0**
- AI calls: **0**
- Proposal/candidate/review/attestation/approval writes: **0**
- Pointer/migration writes: **0**
- Read-only inventory queries: `recipes` collection (237 docs) + bounded per-recipe subcollection
  reads for `mappingProposals`/`approvedMappings`/`cookingModeMappingPointer` — no composite index
  used or required.

## Unverifiable items

- Exact full-226-recipe review burden until batches actually run (labeled estimate only).
- Whether the 2 already-approved pointers remain `CURRENT` at the moment the pilot actually executes
  (time has passed since this session's readback; recommend a zero-cost recheck immediately before
  pilot start).
- Human review time-per-relationship (no authoritative data exists).
- Whether any of the 7 Group C unresolved recipes have a fixable, well-scoped source defect —
  only `chipotle-tahini-bowls` has a documented defect in this repository's existing tooling.

## Deferred

Pilot generation itself, all subsequent batches, full-corpus quality validation, migration-manifest
construction, and any production apply/cutover — all deliberately out of scope per this task's
instructions.

## Next task

```
RUN PILOT CORPUS REMEDIATION
```

Pilot recipe set and batch size are specified above and in the architecture plan document.
