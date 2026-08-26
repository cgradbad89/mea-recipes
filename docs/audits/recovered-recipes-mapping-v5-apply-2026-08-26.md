# Recovered 41-recipe hybrid-v5 production map apply — 2026-08-26

## Executive result

**PASS.** The exact approved recovered-v5 manifest populated `cookingStepIngredientMap` on all
41 repaired recipes. There were no skips, errors, readback failures, non-map field changes,
original-map changes, or unresolved-recipe mutations.

## Authorized evidence

- Manifest: `docs/audits/recovered-recipes-mapping-v5-dryrun-2026-08-26.json`
- Expected and actual SHA-256:
  `5d4ddaa10c788f9192ae74a5887859bc2847496706461b655752d86e62741170`
- Population: 41 rows; 41 READY; 28 Wave 1A; six Wave 2; seven Wave 3.
- Starting branch/HEAD: `main` / `87429bad54ea54516dac722a2a0b9757d96d4cf5`.
- Semantic evidence was independently locked at SHA-256
  `d42dffce95bf6195c31d61af8c59347b128f14684c76544b8a547ec551cfb0a6` and supplied only
  reviewed deterministic validator baselines. It never supplied a persisted candidate.

The recovered-v4 manifest remained historical and unauthorized. No other mapping manifest was an
apply input.

## Preflight and production mutation

The production dry run evaluated all 41 rows before any mutation: 41 READY_TO_WRITE, zero skips,
and zero unexpected errors. All recipes existed, lacked a map, matched the manifest source hash,
validated against current live content, and used deterministic-v5 or hybrid-v5.

One Firestore batch attempted and committed 41 update-time-preconditioned writes. Every payload
contained exactly one field, `cookingStepIngredientMap`, whose value was the corresponding immutable
manifest `candidateMap`. No sequential fallback or retry occurred.

AI calls were zero. Deterministic and hybrid mapping generations were zero. Candidate substitutions
were zero.

## Mandatory readback and integrity

- Written rows reread: 41/41.
- Exact manifest candidate matches: 41/41.
- Fresh source-hash matches: 41/41.
- Current validator passes: 41/41.
- Raw non-map document mismatches: 0.
- Unexpected states: 0.

The raw comparison excluded only `cookingStepIngredientMap`, so the zero-mismatch result covers all
modeled and unknown Firestore fields, including content, titles, category/cuisine, image/source
metadata, labels, timestamps, owner metadata, times, servings, nutrition, roles, and historical
nutrition snapshots.

## Corpus safety and idempotency

All 187 original persisted v4 maps remained byte-for-byte unchanged, source-bound, and valid. The
eight unresolved Wave 4/5 recipes remained unchanged and map-free. The independent post-apply dry
run produced zero READY_TO_WRITE rows, 41 MAP_ALREADY_PRESENT skips, zero other skips/errors, and
zero writes.

Final production state is 228 mapped and eight unmapped recipes out of 236. Runtime validation
continues to support the original v4 maps alongside the recovered v5 maps.

## Scope

No Firebase or Vercel deployment occurred; this was an explicitly authorized production data
backfill. Mapping work is complete for the 228 clean/recovered recipes. Wave 4/5 source and product
truth for the remaining eight recipes and personal override mappings remain separate work.
