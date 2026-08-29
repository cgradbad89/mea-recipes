# Cooking Mode Ingredient-Mapping Remediation — Final Closeout

Date: 2026-08-29

## Result

```text
PASS — COOKING MODE MAPPING REMEDIATION CLOSED
```

Corpus-wide remediation is stopped. No V11/V12 mapper, further quality-threshold experiment,
remaining-corpus backfill, or scheduled bulk rollout is planned. Prepared components are a
separate deferred problem and are outside this closeout.

## Why bulk remediation stopped

The pragmatic raw two-reviewer union reached 100% recall but only 46.23% precision, with systemic
component, lifecycle, and collective-reference errors. The lower-complexity additive v4/v5 plus V1
`AUTO_ACCEPT` strategy reached 91.48% aggregate precision but only 54.76% recall; its additions were
79.45% precise and repeated a systemic collective-reference false-positive pattern. These held-out
results reject automatic corpus rollout. They do not invalidate the on-demand review/approval
infrastructure.

## Infrastructure retained

- Automatic same-revision mapping proposals for future recipes.
- Admin `/mapping-review` candidate review, missing-relationship additions, append-only corrections,
  completeness attestation, immutable approved maps, and current-approved pointers.
- Pure approved-map → existing schema-v1 `cookingStepIngredientMap` materialization.
- Fail-closed selective promotion requiring the live recipe revision, approved map ID/hash, current
  pointer, old runtime hash, frozen new runtime hash/value, and independent approved-map hash validation.
- Atomic multi-recipe field-only apply plus exact, current-new-hash-guarded rollback.

Cooking Mode itself is unchanged. It continues to validate and read the embedded legacy runtime
field, with a deterministic browser fallback and zero runtime AI calls.

## Approved-map corrections

### Garlic Butter Herb Steak Bites with Potatoes

The prior immutable approved map remains historical evidence. The false human-added
`salt and pepper → step 3` relationship was superseded by an append-only `REJECT` decision, which
invalidated the prior completeness attestation. A fresh attestation produced the new immutable map:

```text
am1:2e1a048556bb2d533ee6aff418e6b7c7393cd99e48c5ece6cdc0781d804148f3
```

The corrected map contains potatoes on step 1 and steak on step 2; salt and pepper is absent from
step 3.

### Caprese Salad

The source-current, hash-valid approved map and `CURRENT` pointer were reused without AI,
re-review, re-attestation, or reapproval:

```text
am1:ecf8ef1f73f5bc5e5d890872a210def2c4bc7723f018b44c6fff558023f1bc59
```

It contains mozzarella on step 1.

### Grilled Zucchini and Summer Squash

The existing same-revision `READY` proposal was completed without rerunning AI. Full review kept
the active step-2 ingredient set, limited the grill continuation to zucchini/yellow squash, limited
the transfer/garnish step to zucchini/yellow squash/basil, corrected the prior pepper carryover
decision, recorded a completeness attestation, and produced:

```text
am1:592d74d63c9b64c3bb465a92d6dc945efc787aa126d0896d9705d2a5e00f90d1
```

Step 2 contains Italian herbs, black pepper, and yellow summer squash.

## Frozen promotion and production apply

Canonical manifest SHA-256:

```text
eb804ad43b50c42c72f02ab54136ef8d2a5f10a1c84301e4ab7d34a86c512a26
```

The dry-run returned 3/3 `READY`. Production apply rechecked all authoritative preconditions inside
one Firestore transaction and merge-wrote only `cookingStepIngredientMap` for the three authorized
recipe documents. Immediate readback matched all three exact manifest values/hashes, all other root
fields on those documents were unchanged, and the before/after snapshot of all 237 recipe documents
found zero unauthorized recipe changes. No AI or mapping generation ran. Rollback was not executed.

See:

- `cooking-mode-selective-promotion-manifest-2026-08-29.json` / `.md`
- `cooking-mode-selective-promotion-apply-2026-08-29.json` / `.md`

## Production UI verification

The authenticated production site at `https://mea-recipes.vercel.app` was exercised after readback:

- All three recipe pages loaded and Cooking Mode opened/closed.
- Steak step 1 visibly showed potatoes; step 2 visibly showed steak; step 3 showed four intended
  herb/steak rows and no salt-and-pepper row.
- Caprese step 1 visibly showed tomato and mozzarella.
- Zucchini step 2 visibly showed zucchini, yellow summer squash, olive oil, garlic, Italian herbs,
  salt, and black pepper. Nearby step 3 showed only zucchini/yellow squash; step 4 showed only
  zucchini/yellow squash/basil.
- Step navigation moved from step 1 to step 2 and enabled Previous.
- Ingredient checking set the shared ingredient button to its pressed state.
- A four-minute step timer started and paused successfully.
- Nutrition and Add-to-Plan controls remained present; no browser console errors occurred.

The runtime path makes no mapping API or AI call: `CookingMode.tsx` resolves only the passed persisted
map with local deterministic validation/fallback.

## Repository verification

- Fresh baseline: 1,288 passed, 1 skipped, 1 historical V10D failure / 1,290 total.
- Final tests: 1,300 passed, 1 skipped, 1 historical V10D failure / 1,302 total.
- New focused tests: 12, all passed.
- The sole failure is the preserved unrelated V10D dependency on
  `/tmp/cooking-step-arbiter-v10a-2026-08-28-state.json`; no product test failed.
- Lint: passed with the same six pre-existing warnings and zero errors.
- Typecheck: passed.
- Production build: passed under Next.js 16.3.1.
- `git diff --check`: passed.

## Rollback readiness

The immutable manifest retains, for every recipe, the exact old value/hash, exact new value/hash,
write target, and rollback value. The deterministic rollback command is:

```bash
node scripts/cooking-mode-selective-promotion.mjs --rollback
```

It fails closed unless every live current runtime hash equals the manifest's promoted new hash, then
restores all three exact old values in one transaction. Do not run it unless a material production
validation failure is discovered.

## Final operating model

```text
New recipe
→ proposal generated automatically
→ review/correct when useful
→ approve
→ selectively promote when desired

Existing recipe with a concrete visible problem
→ generate or resume the current proposal
→ review/correct
→ approve
→ selectively promote

All other old recipes
→ keep their existing v4/v5 runtime map
```

There is no automatic corpus-wide rollout and no scheduled bulk remediation.

## Explicit stop decision

```text
STOP COOKING MODE INGREDIENT-MAPPING REMEDIATION.
```

The original Cooking Mode mapping problem is finished. Future work requires a new concrete
user-visible defect and targeted authorization; prepared-component work remains separate.
