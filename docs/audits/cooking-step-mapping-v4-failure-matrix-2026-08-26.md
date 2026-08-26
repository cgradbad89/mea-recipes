# Cooking-step mapping v4 failure matrix — 2026-08-26

## Scope and reproduction

This matrix reconstructs the five deterministic-v3 false-positive associations found by the fresh
full-corpus hybrid-v3 audit. Evidence comes from the exact ingredient arrays, instruction arrays,
and deterministic maps in
`docs/audits/cooking-step-mapping-semantic-review-v3-2026-08-26.json`, cross-checked against the
human report in `docs/audits/cooking-step-mapping-dryrun-v3-2026-08-26.md`.

All five associations reproduce at commit `89cce56637d4bbb6452229b2147f018f42754b8c` with
`deterministic-v3`. No production data was written.

## Exact failures

| # | Recipe / ID | Ingredient row | Group / purpose | Instruction | Deterministic-v3 association | Expected safe mapping | Previously used? | Instruction quantity | Root-cause classification | Failed subsystem(s) |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | Mexican Oaxacan Bowl / `mexican-oaxacan-bowl` | 14 — `1 tablespoon olive oil` | `Quick Cabbage Slaw` | 2 — `Place onion, sweet potato and peppers on a parchment lined sheet pan. Drizzle onion and potato with a little olive oil and sprinkle generously with spice mix, tossing to coat all sides well. Use about ½ or ⅔ of the spice.` | Ingredient 14 mapped with high-confidence deterministic provenance. | Omit the oil association. The sheet-pan oil is unlisted; the slaw-purpose oil must remain available for the slaw instruction only. | No. The contradiction is purpose/group identity, not prior consumption. | Unlisted (`a little olive oil` is not a listed sheet-pan row). | `UNLISTED_USE_WRONG_ROW`; `WRONG_COMPONENT_IDENTITY` | Group disambiguation; component identity; purpose context; unlisted-use handling. |
| 2 | Creamy Kale Pasta / `creamy-kale-pasta` | 5 — `1 teaspoon salt` | `For the Sauce` | 3 — `Finish: Add drained, cooked pasta and sauce. Toss to combine. Season to taste with Parmesan, lemon, red pepper flakes, and salt and pepper. Fast, easy, yum.` | Ingredient 5 mapped with high-confidence deterministic provenance; step remains unresolved for the prepared sauce component. | Omit ingredient 5. Preserve the unresolved prepared-sauce relationship; finishing salt and pepper are unlisted. | Yes. Ingredient 5 was mapped as `all` in instruction 0 through the bounded collective `all sauce ingredients`. | Unlisted finishing quantity (`to taste`); the only listed salt quantity belongs to and was consumed by the sauce. | `CONSUMED_ROW_REUSE`; `FRESH_UNLISTED_MATERIAL`; `WRONG_COMPONENT_IDENTITY` | Reuse state; collective lifecycle; quantity disambiguation; group/purpose context. |
| 3 | Schmancy Hot Smoked Salmon / `schmancy-hot-smoked-salmon` | 0 — `2 pounds salmon filet, skin on, pin bones removed` | Ungrouped main protein | 0 — `Make the brine: combine water, salt, and brown sugar in a container large enough to hold the salmon. Stir until dissolved.` | Ingredient 0 mapped with high-confidence deterministic provenance from `hold the salmon`. | Omit salmon. Water, salt, and brown sugar are the actively combined rows; salmon is first actively used in instruction 1. | No. This is a pre-use contextual mention. | Listed salmon quantity is mentioned only as container-size context, not used. | `CONTEXTUAL_MENTION` | Clause-local active-use detection; contextual language. |
| 4 | Schmancy Hot Smoked Salmon / `schmancy-hot-smoked-salmon` | 1 — `1 quart cold water` | Ungrouped brine material | 2 — `Remove salmon from brine, rinse thoroughly under cold water, and pat dry with paper towels.` | Ingredient 1 mapped with high-confidence deterministic provenance from `cold water`. | Omit ingredient 1. The rinse water is fresh process material absent from the ingredient list; salmon may map as active manipulation. | Semantically yes: the listed quart of water is consumed by instruction 0 when making the brine, although deterministic-v3 failed to map that active occurrence. | Unlisted fresh rinse water; it is not the listed measured quart used for brine. | `FRESH_UNLISTED_MATERIAL`; `CONSUMED_ROW_REUSE`; `WRONG_COMPONENT_IDENTITY` | Active-use detection in instruction 0; reuse state; process-material context; quantity/component disambiguation. |
| 5 | Chili Lime Fish / `chili-lime-fish` | 16 — `1 tbsp large red chilli , finely sliced` | `GARNISHES (OPTIONAL)` | 3 — `Sauté aromatics – In the same pan, add sesame oil on medium heat. Cook garlic, chilli and ginger until golden – about 20 seconds.` | Ingredient 16 mapped with high-confidence deterministic provenance alongside sauce sesame oil, garlic, and ginger. | Map sauce rows 5 (sesame oil), 6 (garlic), 7 (ginger), and 8 (chilli flakes); omit garnish row 16. A later explicit garnish instruction may map row 16. | No. The contradiction is form, group, and garnish purpose. | Listed sauce chile-flake quantity is the supported active row; listed fresh garnish chile is not used here. | `OPTIONAL_GARNISH_LEAKAGE`; `WRONG_COMPONENT_IDENTITY` | Normalization/alias loss; food-form distinction; group/purpose disambiguation; optional-garnish context. |

## Root-cause conclusions

- The failures are not title-specific. They arise when lexical identity outranks row availability,
  bounded component scope, ingredient form, or clause-local action.
- A deterministic row lifecycle must include rows confidently consumed by a bounded collective and
  rows whose active use is evident even when v3's occurrence filter missed them.
- A previously used row is not reusable from a later bare noun alone. Reuse requires explicit
  `remaining`/`rest`/`reserved` evidence or an explicitly divided-use structure.
- Purpose markers and ingredient groups are negative evidence against cross-component allocation.
- Fresh process material and other unlisted uses must remain omissions rather than borrowing a
  similar listed row.
- Contextual mentions must not become mappings unless the local clause directs action on that row.
