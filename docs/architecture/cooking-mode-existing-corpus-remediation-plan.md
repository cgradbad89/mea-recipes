# Cooking Mode — Existing-Corpus Mapping Remediation Plan

**Date:** 2026-08-29
**Type:** REMEDIATION PLANNING — defines batches, gates, rollback boundaries, and eventual
migration-manifest requirements. Performs zero AI corpus calls, zero proposal generation, zero
writes. Does not begin pilot generation.
**Precondition satisfied:** `docs/audits/cooking-mode-end-to-end-workflow-validation-2026-08-29.md`
— PASS, end-to-end mapping workflow validated.
**Machine-readable planning record:** [`docs/audits/cooking-mode-existing-corpus-remediation-planning-2026-08-29.json`](../audits/cooking-mode-existing-corpus-remediation-planning-2026-08-29.json)

## 1. Purpose

Replace incomplete old persisted v4/v5 Cooking Mode ingredient-to-step mappings with reviewed,
immutable mappings generated through the validated AI-at-ingestion-with-review architecture
(`docs/architecture/cooking-mode-review-routing-contract.md`), for the existing production recipe
corpus. This is a **one-time remediation** of the pre-Implementation-6 backlog — new recipes already
enter the reviewed pipeline automatically at ingestion (§27 of the routing contract) and never need
this process.

Explicitly **not** in scope: running the corpus, calling AI across the corpus, creating proposals for
hundreds of recipes, migrating maps, changing Cooking Mode runtime, writing production mapping data,
or prepared-component remediation. This document plans that future work; it does not perform it.

## 2. Conceptual remediation flow

```text
freeze current recipe source revision
        ↓
generate new mapping proposal (2 blind reviewers, deterministic risk routing)
        ↓
persist proposal/candidates
        ↓
human review of REVIEW_REQUIRED candidates
        ↓
complete-map (completeness) inspection
        ↓
human add/remove corrections if needed
        ↓
completeness attestation
        ↓
immutable approved map
        ↓
approved/current pointer exists
        ↓
migration manifest built  (separate future task, §12-13)
        ↓
separate production runtime cutover/apply  (separate future task, §14)
```

**Proposal generation is not migration. Approval is not runtime cutover. Current-approved pointer
existence is not yet Cooking Mode activation.** The old v4/v5 runtime maps remain untouched and
Cooking Mode continues reading them throughout every phase of this plan, including full corpus
completion — until an explicit, separately-gated cutover task runs.

## 3. Current corpus (measured 2026-08-29, read-only)

| Metric | Count |
|---|---:|
| Total shared `recipes/{id}` docs | 237 |
| Malformed/non-recipe docs | 1 (`maple-roasted-candied-pecans` — content is the placeholder `"Source:"`) |
| Usable recipes | 236 |
| Recipes with a current v4/v5 persisted map | 229 (`deterministic-v4` 148, `hybrid-v4` 39, `deterministic-v5` 33, `hybrid-v5` 9) |
| Recipes without a persisted map | 7 |
| Recipes with new-system proposal data | 3 |
| Recipes with new-system approved map | 2 |
| Recipes with a current-approved pointer | 2 |

This corrects the historical undifferentiated "8 unresolved" figure into 7 genuinely unresolved
source recipes plus 1 malformed placeholder document, and reconciles exactly with the most recent
prior checkpoint (237 shared / 229 mapped / 8 unresolved-or-malformed). See the planning JSON record
for exact recipe IDs.

## 4. Remediation scope groups

| Group | Definition | Count | Rule |
|---|---|---:|---|
| **A** | Existing mapped usable recipes (old v4/v5 map) | 229 | Primary remediation population |
| **B** | New-system approved recipes (subset of A) | 2 | Skip — already remediated (§5) |
| **A resume-only** | Has old map + a READY, unapproved new-system proposal (subset of A) | 1 | Resume review, no fresh generation |
| **A fresh-generation** | A minus B minus resume-only | 226 | Requires fresh proposal generation |
| **C** | Unresolved source-truth problem recipes (no old map, real content) | 7 | Excluded unless source fixed |
| **D** | Malformed/non-recipe documents | 1 | Excluded |
| **E** | Newly added recipes without old mapping | 0 today | Use ordinary `/mapping-review` ingestion path, never batch remediation (§6) |

## 5. Already-remediated recipes (2026-08-29 end-to-end validation)

| Recipe | State | Recommendation |
|---|---|---|
| Garlic Butter Herb Steak Bites with Potatoes | Approved, `HUMAN_ASSISTED`, 14 relationships | Count as remediated |
| Caprese Salad | Approved, `AUTO`, 7 relationships | Count as remediated |
| Grilled Zucchini and Summer Squash | READY proposal, unapproved | Resume review in the pilot |

These were produced through the real production pipeline (live AI Gateway calls, admin-verified
persistence, a real admin decision-maker) — not synthetic data. Their standing as production truth
does not depend on the originating task's label. Recommend one zero-cost live-revision recompute
check immediately before pilot kickoff to reconfirm the two pointers still resolve `CURRENT` (not
`STALE`) rather than assuming this planning session's readback still holds by the time execution
starts.

## 6. Group E — future ingestion boundary

`lib/recipes.ts` still unconditionally computes a deterministic v4/v5-style map at save time, and as
of Implementation 6 (2026-08-29) every `saveRecipe()` call site also triggers
`POST /api/mapping/generate`. A genuinely new recipe therefore already enters the new-system
pipeline automatically at creation. It should be reviewed through ordinary `/mapping-review`, never
folded into a batch-remediation run — batch remediation exists solely for the pre-Implementation-6
backlog (Group A). No current recipe qualifies as Group E; this is a forward-looking boundary
definition only.

## 7. Estimated workload

**Measured** (36-recipe frozen reviewer-union benchmark,
`docs/audits/cooking-mode-review-routing-contract-analysis-2026-08-28.md`): 44.37% `AUTO_ACCEPT` /
55.63% `REVIEW_REQUIRED`; 34/36 recipes have at least one review item; 14.09 review items per
affected recipe; 18.76 average union candidates/recipe across the full 228-recipe corpus.

**Projected** for the 226 fresh-generation recipes (explicitly an extrapolation, not a measurement):

- ≈4,240 projected union candidates (226 × 18.76)
- ≈2,359 projected review-required relationships (× 55.63%)
- ≈213 recipes projected to need candidate-level review (226 × 34/36)
- ≈13 recipes projected to need only final completeness review

No per-relationship review-time estimate is given; none is fabricated.

## 8. Batching strategy

**Default batch size: 10 recipes.** Evaluated against 5 (too many batches, high per-batch
operational overhead) and 20 (a single batch could carry ~280 projected review items, too much to
lose on a bad batch). 10 caps nominal AI calls at 20/batch (bounded max 40 with full retry), keeps
projected review burden to roughly 100 relationships/batch, and yields 23 batches for the 221
fresh-generation recipes remaining after the pilot.

- **Max concurrent recipe generations:** 1 during the pilot (sequential, for auditability); up to 3
  for post-pilot batches. No existing orchestration harness in this repo runs multiple
  `/api/mapping/generate` calls concurrently today — concurrency is bounded, never assumed
  unlimited.
- **Max reviewer AI concurrency:** unchanged from the implemented coordinator — each recipe's own 2
  reviewer slots (A/B) already execute independently; this plan does not alter that.
- **Generation vs. review sequencing:** sequential per batch — generate the whole batch first
  (bounded concurrency), then review the whole batch, then completeness-review/attest/approve the
  whole batch, before starting the next batch's generation. Favors operational simplicity and a
  clean stop point; pipelining across batches may be revisited after the pilot, not adopted now.

## 9. Batch ordering

Descending known severity: rank Group A's 226 fresh-generation recipes by the 2026-08-26
completeness audit's per-recipe false-negative count (highest first), derived programmatically at
execution time from `docs/audits/cooking-mode-completeness-audit-2026-08-26.json` (5.3MB — not
hand-enumerated here). This front-loads risk reduction and early validation value, per the task's
stated priorities, over operational-simplicity-only orderings (alphabetical/random) or a
review-burden-smoothing round robin (considered and rejected as unnecessary complexity unless a
specific batch proves unmanageable in practice). Illustrative top-12 (from the completeness audit,
IDs in the JSON record): Mole Poblano (FN 91), Dad's Chili (FN 49), Slow Cooker Chicken Ropa Vieja
(FN 37), Easy Slow Cooker Turkey Chili (FN 34), Fried Chicken Sandwich (FN 30), Pozole Verde (FN 29),
Slow Cooker Chicken Taco Soup (FN 27), Slow Cooker Beef Brisket with BBQ Sauce (FN 26), Crockpot
Chicken Wild Rice Soup (FN 25), Creamy Chickpea Spinach Masala with Tadka (FN 25), Mediterranean
Quinoa Bowl (FN 24), Tacos Al Pastor (FN 24).

## 10. Pilot batch (8 recipes)

| Recipe | Action | Rationale |
|---|---|---|
| Garlic Butter Herb Steak Bites with Potatoes | Reuse/validate | Original problem recipe, already approved |
| Caprese Salad | Reuse/validate | Original problem recipe, already approved |
| Grilled Zucchini and Summer Squash | Resume review only | Original problem recipe, in-progress with genuine disagreement |
| Mole Poblano | Fresh generation | Largest known omission (FN 91) + documented parser defect — deliberately exercises the source-remediation failure path (§13) |
| Dad's Chili | Fresh generation | FN 49, ambiguous-source semantic difficulty |
| Chicken Stew | Fresh generation | FN 20, component/lifecycle complexity |
| Mediterranean Quinoa Bowl | Fresh generation | 3 steps, 0 currently-mapped ingredients — seasoning/collective-reference case |
| Peanut Butter Oat Protein Shake | Fresh generation | 1 step — simple-recipe case |

Only 5 of 8 need fresh AI calls (nominal 10, bounded max 20) — the plan deliberately does not
duplicate the 2 already-approved maps or regenerate the 1 in-progress proposal, per instruction. The
pilot's purpose is not architecture research (that is already validated); it measures real review
burden, reviewer behavior across actual production content, review-UX density, approval throughput,
and manifest-generation inputs.

## 11. Pilot pass/fail gate

Expand beyond the pilot only if **all** of the following hold:

- All 5 fresh-generation pilot recipes produce valid `READY` proposals.
- No proposal-generation transport/schema failure survives the existing bounded per-slot retry.
- All required reviews for all 8 pilot recipes complete through the existing `/mapping-review` UI.
- All 8 pilot maps receive a valid completeness attestation matching the live `reviewStateHash`.
- All 8 approved maps pass a source-semantic spot check, including against the completeness audit's
  documented expected values for the 3 original problem recipes.
- No `CANDIDATE_ID_COLLISION` or persistence-identity conflict occurs.
- No unexpected Firestore query/index requirement surfaces.
- Zero writes occur to any recipe's old `cookingStepIngredientMap` field or to Cooking Mode runtime
  code.

**Quality gate:** 0 known false positives, 0 known CRITICAL false negatives, no regression on the 3
original problem recipes' documented missing ingredients (`docs/audits/cooking-mode-completeness-audit-2026-08-26.md`).

Do not expand to the rest of the corpus if the pilot exposes a systemic issue (§20).

## 12. AI-call budget

Nominal 2 calls/recipe (1 per reviewer slot); bounded max 4/recipe (2 slots × at most 2 attempts/
slot, matching the implemented coordinator's actual retry semantics — architecture contract §16,
§25.3). Pilot: 10 nominal / 20 bounded max. Remaining 221 fresh-generation recipes after the pilot:
442 nominal / 884 bounded max across 23 batches. No dollar cost is estimated — this repository has no
authoritative current provider pricing metadata.

## 13. Proposal reuse rules

Before generating any recipe in a batch:

1. Compute the recipe's current `recipeRevision` from its live parsed content.
2. If a current-approved pointer resolves `CURRENT` for that exact revision → skip remediation
   entirely (Group B pattern).
3. Else if a `READY` proposal exists at that exact revision → reuse it; resume/continue human review
   from its existing state (the Grilled Zucchini and Summer Squash pattern).
4. Else if a `WRITING`/`FAILED` proposal header exists at that identity → do not trust it; fall
   through and generate fresh — this is already the implemented behavior of
   `generateAndPersistCookingModeMappingProposal` (architecture contract §27.1 step 2), not new
   logic this plan invents.
5. Else → generate fresh (the standard Group A case).

Never regenerate a current approved map merely to standardize timestamps or provenance.

## 14. Review workflow

Use the existing `/mapping-review` workflow exactly — no second remediation-specific review UI. Per
batch: generate proposals → review `Needs review` recipes → completeness review for all → add/remove
relationships where necessary → attest → approve. Track batch progress externally via a durable
remediation ledger (§17), not by adding a second authoritative product lifecycle field.

## 15. Remediation batch statuses (planning-level only)

```text
PLANNED → GENERATING → READY_FOR_REVIEW → REVIEWING → READY_FOR_APPROVAL → APPROVED → VALIDATED
FAILED (terminal, per-item or per-batch)
```

These are audit/ledger states, not a new persisted production lifecycle — the actual per-recipe/
per-proposal state remains exactly the existing `MappingProposalStatus`/queue-derived states the
persistence layer and `/mapping-review` UI already compute (design doc §11).

## 16. Immutable remediation ledger

Every remediation run (pilot and each subsequent batch) must produce a durable audit artifact
(JSON, alongside a readable `.md` companion, following this session's own file-naming convention)
containing at minimum: batch ID; recipe IDs; source revisions; proposal IDs; generation outcomes;
candidate counts; `AUTO_ACCEPT`/`REVIEW_REQUIRED` counts; review completion; human-added
relationships; approved map IDs and hashes; current-pointer states; validation result. This ledger is
audit evidence, not runtime truth.

## 17. Resume/retry behavior

The remediation process must be safely restartable, using the deterministic identities the
persistence layer already guarantees (§13 above):

- If interrupted after N of M proposals generated in a batch, the next run reuses the N and
  continues the remaining M−N (proposal identity is deterministic over recipe/revision/contract
  version — no re-generation of already-`READY` proposals).
- If interrupted after partial review, existing review decisions remain (append-only,
  supersession-chained — architecture contract §25.4).
- If some maps are already approved, do not rebuild or reapprove them.

No destructive restart at any point.

## 18. Per-item failure handling

Each recipe is handled independently within a batch:

- **Generation fails after the bounded retry limit** → mark that recipe failed for the batch;
  continue the remaining recipes.
- **Review reveals a source/parser issue** (e.g. the Mole Poblano case deliberately included in the
  pilot) → remove the recipe from automatic remediation; classify `SOURCE_REMEDIATION_REQUIRED`;
  continue the batch.
- **Approval fails on a persistence/integrity issue** → stop changes to that specific recipe; continue
  unrelated recipes only if doing so is safe.
- After three evidence-based attempts on the same item, stop that item and report it. One bad recipe
  never halts the whole remediation run.

## 19. Source-revision freeze

Record each batch recipe's `recipeRevision` before generation. The existing contract already
re-verifies live revision at every downstream step (`addHumanMappingRelationship`,
`recordMappingCompletenessAttestation`, and the approve route — architecture contract §26.4, §26.6,
§27.3). If source changes mid-review, the prior proposal becomes stale by the existing `STALE`
pointer classification (§25.6); the recipe leaves the current batch and re-enters a later
remediation cycle as a fresh-generation case. Stale mappings are never approved.

## 20. Existing v4/v5 preservation

No step in this plan writes `recipe.cookingStepIngredientMap` or any other v4/v5 runtime field. All
remediation writes are confined to `recipes/{id}/mappingProposals/**`, `approvedMappings/**`, and
`cookingModeMappingPointer/current` — the exact subcollections the 2026-08-29 end-to-end validation
confirmed are fully isolated from Cooking Mode runtime reads
(`components/CookingMode.tsx`/`app/recipes/[id]/page.tsx` have zero references to the new paths).
Cooking Mode continues serving the old v4/v5 maps, unaffected, through the entire remediation effort.

## 21. Full-corpus validation gates (unchanged, not lowered here)

After every in-scope recipe has an approved new-system map, run a separate validation phase before
any cutover — measuring precision, overall recall, explicit-active-use recall, CRITICAL recall, HIGH
recall, and seasoning/herb recall against the authoritative adjudicated corpus where available.
Intended eventual gates (`docs/architecture/cooking-mode-review-routing-contract.md` §23):

- Precision = 100%
- Explicit-active-use recall ≥ 99%
- CRITICAL recall = 100%
- HIGH recall ≥ 99%
- Seasoning/herb recall ≥ 98%
- A separately defined prepared-component gate (not this task — §24 below)
- Exact source/version/provenance coverage
- Zero AI calls in Cooking Mode runtime and production apply

## 22. Migration-manifest contract (future task, not built here)

Required fields: `manifestVersion`, `generatedAt`, source repository commit, `recipeId`,
`recipeRevision`, `approvedMapId`, `approvedMapHash`, the current old-runtime map's
engine version/`sourceHash` if available, the new approved relationships, the expected write target,
and preconditions. The manifest is immutable once approved — a correction requires a new manifest
version, never an edit in place.

## 23. Manifest SHA lock (future task)

Before any runtime cutover/apply: serialize the manifest canonically (fixed key order), compute
SHA-256, record the expected hash. Production apply must require the exact manifest hash as a
precondition. Apply performs **zero** AI calls, zero mapping recomputation, zero candidate
rerouting, and zero review decisions — a purely deterministic manifestation of already-approved
truth, following the same pattern this repository's existing v4/v5 apply tooling
(`scripts/apply-cooking-step-mapping-v4-core.mjs`, `scripts/apply-recovered-recipe-mapping-v5-core.mjs`)
already implements.

## 24. Future runtime cutover strategy (decision flagged, not made)

**Option A — pointer-direct:** Cooking Mode reads `cookingModeMappingPointer/current` →
`approvedMappings/{mapId}` at request time. Cleaner (never mutates the shared recipe document), but
adds a new runtime read path and at least 2 additional reads/view unless denormalized; offline/cache
behavior needs verification.

**Option B — materialize:** production apply writes the approved relationships back onto the
existing `cookingStepIngredientMap` field, reusing the exact field Cooking Mode already validates and
safely falls back from. Zero runtime code changes, unchanged read count/offline/cache behavior;
requires a real (SHA-locked, field-only, precondition-guarded) mutation to the shared recipe
document, which is exactly what §22-23's manifest architecture exists to make safe.

**iOS/shared-backend compatibility is not an open question** — PRD.md states explicitly that "the
deprecated iOS client is not a compatibility constraint." The genuinely open question is Cooking Mode
web runtime code shape only.

**Tentative recommendation: Option B.** It reuses an already-implemented, already-audited operational
pattern in this exact repository and requires zero Cooking Mode runtime code changes. This is a
tentative preference, not a final decision — the cutover task must explicitly reconfirm it (or choose
Option A) rather than silently inheriting this recommendation.

## 25. Rollback (future task, requirements defined now)

- Old v4/v5 map value and its own `sourceHash`/`engineVersion` must be captured verbatim in the
  manifest's old-runtime-map fields before any apply, including "field absent" for excluded groups.
- New approved map remains immutable regardless of rollback — `approvedMappings` documents are never
  deleted or edited.
- The manifest records both old and new state so a reverse-manifest can be constructed without
  re-deriving anything.
- Rollback meaning depends on the eventual cutover option: under Option B it means restoring the old
  materialized field value from the manifest's captured snapshot (a real, field-only, SHA-locked
  reverse write); under Option A it means repointing the runtime read back to the old field, since
  that field was never mutated in the first place.
- Rollback never invokes AI, recomputes nothing, and only replays already-captured values.

## 26. Existing validation recipes — explicit disposition

See §5. Recommendation: count Garlic Butter Herb Steak Bites with Potatoes and Caprese Salad as
already remediated (Group B); resume, don't regenerate, Grilled Zucchini and Summer Squash in the
pilot. This is an explicit recommendation, not an assumption — their validation-only origin was
reviewed against the real persistence/authorization/provenance evidence in the end-to-end validation
audit before reaching this conclusion.

## 27. Review burden and operational UX

**Existing `/mapping-review` UI is sufficient.** No `REMEDIATION UX BLOCKER` is raised. The queue is
a flat, unfiltered list (`loadMappingReviewQueue` — a bounded, unfiltered collection-group scan, no
composite index) with no batch-grouping, severity-sort, or cross-batch progress view built in, but
batches are small (≤10 recipes) and short-lived enough that the external remediation ledger (§16)
covers the gap without needing new product UI. Revisit only if batch cadence or size substantially
increases later — not now, to avoid feature creep.

## 28. Execution prompt sequence

| Prompt | Name | Scope |
|---|---|---|
| A | Pilot corpus remediation | Generate the 5 fresh-generation pilot proposals; resume Grilled Zucchini and Summer Squash's review; reconfirm the 2 already-approved pointers `CURRENT`. Review/attest/approve all 8. No migration. Produce a pilot remediation ledger. |
| B | Pilot validation | Measure the pilot's actual review burden, quality, and operational results against §11. Decide GO/NO-GO. |
| C | Remaining corpus generation/review | Execute the ~23 remaining bounded batches (221 recipes) in descending-severity order. Potentially repeated across sessions. |
| D | Full approved-corpus quality validation | Measure precision/recall/severity-class recall of the complete approved-map population against §21. No runtime cutover. |
| E | Build immutable migration manifest | Construct and SHA-lock the manifest per §22-23, for the in-scope approved population only. |
| F | Production apply/cutover | Execute the deterministic, zero-AI, zero-recomputation manifest apply. Requires §24's decision explicitly confirmed first. |
| G | Post-cutover production verification | Confirm Cooking Mode runtime reads the new source of truth correctly, with rollback evidence in hand. |

Deliberately not collapsed into one execution prompt.

## 29. Stop conditions

Stop rather than push through: a reviewer transport/schema failure rate the existing bounded
per-slot retry doesn't absorb cleanly; a systematic false-positive pattern in more than one
recipe's approved map; a systematic critical-omission pattern; review burden substantially worse than
the 14.09-items/affected-recipe model across a full batch; the `/mapping-review` UI becoming
operationally unusable at observed scale; source/parser corruption beyond the already-known cases
(`chipotle-tahini-bowls`, `mole-poblano`); a `CANDIDATE_ID_COLLISION` or identity conflict; an
unexpected Firestore scaling/index requirement. Do not improvise past the pilot — reassess against
this list.

## 30. Prepared-component boundary

Explicitly excluded from this plan and the entire ingredient-mapping remediation effort. Ingredient
remediation must not wait on prepared-component quality (current V10A arbiter precision ~40.49%,
`docs/audits/cooking-mode-mapping-architecture-reassessment-2026-08-28.md`) unless a specific
recipe's Cooking Mode correctness is found to actually require a prepared-component relationship —
no such requirement has surfaced in this planning task. Prepared components need their own,
separately versioned candidate/review contract and quality gate.

## 31. Production mutation summary

Zero AI corpus calls, zero mapping-proposal generation, zero candidate writes, zero review writes,
zero map approvals, zero runtime-map writes, zero pointer updates, zero migration writes. Read-only
production inventory only — 237 recipe docs plus per-recipe subcollection existence checks, no
composite index used or required.

## 32. Recommended next step

```
READY FOR PILOT CORPUS REMEDIATION
```

Pilot recipe set (8): `garlic-butter-herb-steak-bites-with-potatoes` (reuse/validate),
`caprese-salad` (reuse/validate), `grilled-zucchini-and-summer-squash` (resume review),
`mole-poblano`, `dads-chili`, `chicken-stew`, `mediterranean-quinoa-bowl`,
`peanut-butter-oat-protein-shake` (fresh generation). Default batch size for subsequent batches: 10
recipes. Pilot generation itself is **not** begun by this document — see Prompt A (§28).
