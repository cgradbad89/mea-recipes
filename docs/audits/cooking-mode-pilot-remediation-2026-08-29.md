# Cooking Mode — Pilot Corpus Remediation — 2026-08-29

**Batch:** `cooking-mode-pilot-2026-08-29`

**Scope:** exactly the eight approved pilot recipes

**Status:** `NO_GO`

**Machine-readable ledger:** [`cooking-mode-pilot-remediation-2026-08-29.json`](./cooking-mode-pilot-remediation-2026-08-29.json)

## 1. Executive result

**FAIL — PILOT CORPUS REMEDIATION NOT VALIDATED**

All five required fresh proposals were generated and identity, persistence, runtime isolation, and
old-map preservation passed. The pilot stopped because review burden was 3.57× the approved
benchmark and a known false positive was routed `AUTO_ACCEPT` with no supported correction control.

## 2. GO / NO-GO

**NO-GO — REMAINING CORPUS REMEDIATION BLOCKED**

Do not begin the remaining corpus until the blockers are remediated and these eight recipes pass.

## 3. Starting state

The production readback at `2026-08-29T14:16:19Z` matched the plan: two source-current approved
maps, one source-current resumable proposal, and five recipes requiring fresh generation. All eight
live revisions matched and every old runtime map was source-current.

| Recipe | Starting disposition | Existing approved map | Old map |
|---|---|---|---|
| Steak Bites | `REUSE_APPROVED_CURRENT` | `am1:6a144c3d…a386` | `deterministic-v4` |
| Caprese | `REUSE_APPROVED_CURRENT` | `am1:ecf8ef1f…bc59` | `deterministic-v4` |
| Zucchini | `RESUME_EXISTING_PROPOSAL` | none | `deterministic-v4` |
| Mole | `GENERATE_FRESH` | none | `hybrid-v5` |
| Dad's Chili | `GENERATE_FRESH` | none | `deterministic-v5` |
| Chicken Stew | `GENERATE_FRESH` | none | `deterministic-v5` |
| Mediterranean Quinoa | `GENERATE_FRESH` | none | `deterministic-v4` |
| Protein Shake | `GENERATE_FRESH` | none | `deterministic-v5` |

## 4. Pilot population

Exactly the eight named pilot recipes were included; none was added, substituted, or removed.

## 5. State changes from plan

There was no starting-state drift. Five fresh proposal documents and 405 candidate documents were
created. The stop conditions prevented new review decisions, human additions, attestations, approved
maps, and pointer updates.

## 6. AI execution

All five fresh generations succeeded. Reviewer A ran five times and reviewer B six times: 11 total
attempts, including one bounded reviewer-B retry for Dad's Chili, within the limit of 20. There were
zero unrecovered failures. The successful response did not retain the retry's upstream failure code.

## 7. Proposal reuse

The two current approved recipes were reused. Zucchini proposal `mp1:bb9d6d27…a1b4` was resumed.
Fresh generation was limited to the five recipes classified `GENERATE_FRESH`.

## 8. Candidate counts

| Recipe | Documents | Auto accept | Review required | Human added |
|---|---:|---:|---:|---:|
| Steak Bites | 14 | 8 | 5 | 1 existing |
| Caprese | 7 | 7 | 0 | 0 |
| Zucchini | 22 | 8 | 14 | 0 |
| Mole | 233 | 27 | 206 | 0 |
| Dad's Chili | 80 | 25 | 55 | 0 |
| Chicken Stew | 47 | 17 | 30 | 0 |
| Mediterranean Quinoa | 36 | 2 | 34 | 0 |
| Protein Shake | 9 | 1 | 8 | 0 |
| **Total** | **448** | **95** | **352** | **1** |

The reviewer-union denominator is 447 because the existing human-added steak relationship is not an
AI candidate. Auto accept was 21.25%; review required was 78.75%.

## 9. Review burden

There were 352 review-required candidates across seven affected recipes: 50.29 per affected recipe,
36.20 above and 3.57× the 14.09 planning benchmark. Fresh proposals alone produced 333, or 66.60 per
recipe (4.73×). At stop, 345 remained across six recipes (57.50 each); Mole alone required 206.
This triggered the authoritative plan's substantially-worse-than-baseline stop condition.

## 10. Human review

No new review event was written. Historical state remained: steak had five effective includes, zero
excludes, six append-only events, and one correction; zucchini had one include, one exclude, and 12
unresolved. Reloading zucchini preserved both decisions and `10/22` progress exactly.

## 11. Human-added relationships

No new human-added relationship was created. Steak's existing row-8 `salt and pepper` → step-2
relationship remained; adjudicated truth identifies it as a false positive.

## 12. Attestation

Only the existing steak `ma1:df9d1925…ef25` and Caprese `ma1:028ce561…d6fc3` attestations exist.
Both remain valid for their current review-state hashes. No new attestation was written.

## 13. Approved maps

Only the starting maps remain current: steak `am1:6a144c3d…a386` (14 relationships) and Caprese
`am1:ecf8ef1f…bc59` (7). Their pointers are `CURRENT`; no new map or pointer was written.

## 14. Known truth

The two approved maps aggregate to TP 20, FP 1, FN 0, precision 95.24%, recall 100%. Caprese is
7/0/0; steak is 13/1/0, so zero-known-FP already fails. Diagnostic, unapproved reviewer-union values
are zucchini 12/10/0, Mole 95/138/0, Dad's Chili 59/21/0, Chicken Stew 29/18/0, Mediterranean
Quinoa 24/12/0, and Protein Shake 9/0/0.

Mole's auto-accept subset is TP 26 / FP 1. The FP links row 14, `¼ Teaspoonanises seeds`, to step 7,
whose instruction refers to sesame seeds; truth expects row 15 only. Both reviewers accepted it.

## 15. Original visible defects

The approved steak map contains step-1 potatoes and step-2 steak. The approved Caprese map contains
step-1 mozzarella. Zucchini's step-2 yellow squash, herbs, and pepper exist only in the unapproved
proposal union, so its original visible defect is not fixed in an approved map.

## 16. Pilot gate

| Criterion | Result |
|---|---|
| Five fresh proposals generated | PASS |
| All eight approved/current | FAIL — 2 of 8 |
| Zero known false positives | FAIL |
| Zero critical false negatives | PASS for two approved maps only |
| Original omissions fixed in approved maps | FAIL |
| Identity and persistence | PASS |
| Reviewer transport/schema recovery | PASS |
| Firestore index/scaling | PASS |
| Old runtime maps preserved | PASS |
| Runtime isolation | PASS |
| Review UX sufficient | FAIL |

## 17. Remediation UX

**REMEDIATION UX BLOCKER**

The queue and review flow loaded and persisted state, but Mole presented 206 decisions. Its full-map
view exposed the incorrect auto-accepted anise relationship without removal/override. The approved
steak FP likewise had no reopen/correction control. The workflow cannot produce a zero-known-FP map.

## 18. Resumability

PASS. Zucchini opened at `10/22` with its black-pepper include and olive-oil exclude. After a full
reload, progress and both decisions were unchanged.

## 19. Revision freeze

PASS. Every proposal revision still equaled the corresponding live recipe revision; no stale proposal,
revision mismatch, or identity conflict was observed.

## 20. Old v4/v5 preservation

Direct before/after reads produced identical value hashes:

| Recipe | Version | Before/after hash |
|---|---|---|
| Steak | `deterministic-v4` | `4e8adac0…3478f` |
| Caprese | `deterministic-v4` | `17c735d3…781c` |
| Zucchini | `deterministic-v4` | `042946e2…0d` |
| Mole | `hybrid-v5` | `ab5d3059…1c3b` |
| Dad's Chili | `deterministic-v5` | `47e54094…7dc9` |
| Chicken Stew | `deterministic-v5` | `f85b0779…c403` |
| Mediterranean Quinoa | `deterministic-v4` | `96538253…1a36` |
| Protein Shake | `deterministic-v5` | `8cbb3dd4…9c38` |

## 21. Runtime isolation

PASS. Production steak Cooking Mode still rendered the old map behavior: step 1 showed six
ingredients and step 2 one, despite the approved remediation map containing omission fixes. The
session was closed without completion/logging. The runtime read path was unchanged.

## 22. Data readback

All fresh proposals were `READY` with exactly 233/80/47/36/9 candidate documents. Existing state
remained 14 steak candidates and 9 historical review events, 7 Caprese candidates and no events, and
22 zucchini candidates and 2 events. Only steak and Caprese had attestations, maps, and pointers.

## 23. Data mutation inventory

Authorized production writes were five mapping proposals and 405 candidates through the existing
generation endpoint. No recipe, old map, review event, human addition, attestation, approved map,
pointer, rule, index, prompt, routing rule, or runtime/UI code changed.

## 24. Files modified

- `PRD.md` — records the NO-GO, blockers, and required follow-up.

The pre-existing v10f-lite audit modification and unrelated local configuration/debug files were not
touched.

## 25. Files created

- `docs/audits/cooking-mode-pilot-remediation-2026-08-29.json`
- `docs/audits/cooking-mode-pilot-remediation-2026-08-29.md`

## 26. Tests

`npm test -- --reporter=dot` maintained the required baseline: 1,287 passed, 1 failed, and 1
skipped (1,289 total). The sole failure is the explicitly excluded historical
`tests/cookingModeV10DPrincipalTarget.test.js` dependency on missing
`/tmp/cooking-step-arbiter-v10a-2026-08-28-state.json`; no task change touches that test.

## 27. Lint

`npm run lint` passed with 0 errors and the same 6 pre-existing warnings.

## 28. Typecheck

`npm run typecheck` passed.

## 29. Build

`npm run build` passed under Next.js 16.3.1 and produced all 34 routes.

## 30. Git diff check

`git diff --check` passed. Intended tracked changes are `PRD.md` and these two new ledgers;
unrelated pre-existing files remain excluded from staging.

## 31. Commit SHA and push status

The final session report records the commit SHA after creation. A commit cannot embed its own final
SHA without changing that SHA.

## 32. Deployment

No deployment was requested or performed. No Firebase deployment ran.

## 33. PRD updates

`PRD.md` records the empirical burden, uncorrectable auto-accept FP, exact NO-GO, and required
remediation/re-pilot sequence.

## 34. Unverifiable items

Approved-map metrics and complete-map behavior are unavailable for six unapproved recipes because
the stop prevented approval. Practical add/remove coverage could not pass because removal is absent
for auto-accepted/approved relationships. Dad's Chili's transient retry code was not persisted. All
other required identity, persistence, count, hash, and isolation evidence was verified.

## 35. Failed or deferred

Review, attestation, and approval were deliberately deferred for zucchini and the five fresh
proposals, preserving evidence and avoiding hundreds of actions on proposals that cannot pass. The
remaining corpus was not started.

## 36. Next task

**REMEDIATE PILOT CORPUS BLOCKERS**

Add a bounded, auditable correction path for auto-accepted and already-approved relationships; reduce
the false-positive/review-required surface; then rerun this exact pilot from preserved proposal state
and require all eight recipes to pass before broader rollout.
