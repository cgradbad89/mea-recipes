# Cooking Step Mapping V4 Production Apply — 2026-08-26

## Executive result

**PASS.** The exact approved v4 manifest populated `cookingStepIngredientMap` on all 187 live
READY recipes. There were no precondition skips, unexpected errors, readback failures, non-map
field changes, or excluded-recipe mutations.

## Authorized evidence

- Manifest: `docs/audits/cooking-step-mapping-dryrun-v4-2026-08-26.json`
- Expected and actual manifest SHA-256:
  `b07208384369183e70782f2e017fcea141d9436d43d7ea523133c72cd6435a88`
- Manifest population: 236 rows; 187 READY; 49 EXCLUDED; 0 REVIEW; 0 ERROR; 0 EXISTING_MAP.
- Starting branch/HEAD: `main` / `4a333704537873444f7e2d531ff8f96ad5486caf`.
- The reviewed semantic artifact was separately byte-locked at SHA-256
  `2ccd255d9606960e9ac32fcc4ffa49937bbd3e2ffaf3ea2a95bbb620b31f60ae` and supplied only the
  already-computed deterministic-v4 baselines required by the production validator. It did not
  select a row or supply a persisted candidate.

Historical v1, v2, and v3 manifests were rejected by the tooling contract and were not loaded as
apply inputs or modified.

## Pre-apply gate

The read-only production dry run evaluated all 187 READY rows before any write. Results were 187
READY_TO_WRITE, 0 SKIP, and 0 unexpected errors. All 49 EXCLUDED rows had no persisted map at the
preflight read. The dry run performed zero Firestore writes.

Each planned row existed, had no current map, reproduced the exact manifest `sourceHash` from live
shared content, passed `validateCookingStepIngredientMap` against its reviewed deterministic-v4
baseline, and used an approved v4 engine. Raw live document state excluding only
`cookingStepIngredientMap` was canonically hashed before mutation.

## Production mutation

One atomic Firestore batch attempted and committed all 187 writes. Every operation used
`update()` with the preflight document update-time precondition. The only payload field was
`cookingStepIngredientMap`, and its value was the exact corresponding manifest candidate. There was
no sequential fallback or retry.

AI calls were 0. Deterministic mapping generation was 0. Hybrid mapping generation was 0. Manifest
candidate substitutions were 0.

## Mandatory readback and integrity

All 187 manifest READY recipes were reread. Results:

- Exact manifest candidate matches: 187/187.
- Fresh source-hash matches: 187/187.
- Candidate validation passes against live parsed content: 187/187.
- Raw non-map document mismatches: 0.
- Unexpected READY states: 0.
- EXCLUDED rows reread: 49; writes by this apply: 0; before/after mutations: 0.
- REVIEW, ERROR, and EXISTING_MAP writes: 0.

Because the raw comparison excluded only `cookingStepIngredientMap`, the zero-mismatch result covers
content, title, category, cuisine, image/source fields, labels, `hasImage`, created/modified metadata,
owner metadata, preparation/cook time, servings, nutrition fields, role fields, and every unknown
field present in Firestore.

## Idempotency

The separate post-apply `--dry-run` produced 0 READY_TO_WRITE rows, 187
`MAP_ALREADY_PRESENT` skips, 0 other skips, and 0 unexpected errors. It performed zero writes. The
49 EXCLUDED recipes still had no map. A rerun therefore has no write candidate.

## Runtime artifacts and scope

The fixed local runtime reports used to finalize this durable evidence were
`/tmp/cooking-step-mapping-v4-apply-execution.json` and
`/tmp/cooking-step-mapping-v4-apply-dry-run.json`. They contain no credentials. No Firebase or
Vercel deployment occurred; the production data backfill was not a deployment. The 49
source/parser-excluded recipes and personal override-specific maps remain deferred.
