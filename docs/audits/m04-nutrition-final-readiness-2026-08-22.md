# M-04 Nutrition Final Readiness — Prompt 4D.1

## Executive summary

The exact 13-recipe diagnostic was rerun read-only after four narrowly confirmed residual engine fixes:

- USDA candidates must contain every semantic food-identity token, preventing `orzo → teff`, `ground chili → emu`, `green chiles → beet greens`, and `black rice vinegar → rice`.
- Known contradictory USDA descriptors are rejected, including chocolate for almond milk.
- Dried chickpeas no longer resolve to the curated canned/drained canonical record.
- Quantity qualifiers before units and comma-separated seasoning clauses no longer hide a food noun, including the cooked-chicken line.

```text
READY_FOR_APPLY: 5
REVIEW_REQUIRED: 0
BLOCKED: 8

Residual engine defects found: 4
Residual engine defects fixed: 4
Residual engine defects remaining: 0
Material unresolved ingredients: 15
Immaterial unresolved ingredients: 16
```

Nutrition remains unapplied. The diagnostic made zero recipe, nutrition, canonical, or Firestore mutations.

## Per-recipe readiness

Macros are proposed per serving in the order kcal / protein / carbs / fat / fiber / sugar.

| Recipe | Proposed macros | Unresolved | Material unresolved | Servings basis | Classification | Reason |
|---|---:|---:|---:|---|---|---|
| Heart-Healthy Peanut Butter Protein Bars | 575 / 20.9 / 36.1 / 42.2 / 7.2 / 6.9 | 4 | 3 | 4, stored | BLOCKED | Protein powder is unspecified; flaxseed and almond milk fallback resolution was unavailable in this run. |
| Peanut Butter Oat Protein Shake | 382 / 10.8 / 47.8 / 18.5 / 10.8 / 11.9 | 4 | 3 | 1, stored | BLOCKED | Protein powder is unspecified; flax/chia and psyllium are nutritionally relevant. |
| Spaghetti Carbonara | 867 / 43.9 / 87.5 / 37.3 / 3.6 / 3.7 | 0 | 0 | 4, stored | READY_FOR_APPLY | Pasta, eggs, guanciale/pancetta, cheese, and quantities resolved with plausible arithmetic. |
| Bread! | 344 / 9.9 / 72 / 1 / 2.7 / 0.3 | 0 | 0 | 4, stored | BLOCKED | Source yield is 8 while stored/default servings is 4; requires a servings decision. |
| Chicken Chickpea Salad | 391 / 10.1 / 28.5 / 27.9 / 7.8 / 6.4 | 6 | 4 | 4, assumed | BLOCKED | Chicken, chiles, arugula, and olives remain unresolved; source serving basis is assumed. |
| Chicken Meatballs with Peppers and Orzo | 451 / 36.9 / 38.3 / 17.4 / 5.5 / 6.2 | 1 | 0 | 4, stored | READY_FOR_APPLY | Orzo now falls to a semantically correct AI estimate; only finishing salt/Parmesan/parsley is unresolved. |
| Chinese Chili Oil | 98 / 0.7 / 2.3 / 10.2 / 1.4 / 0.3 | 3 | 0 | 24, stored | READY_FOR_APPLY | Oil and chili base are accounted for; only star anise, cassia, and ginger remain as immaterial aromatics. |
| HONEY SRIRACHA ROASTED BRUSSELS SPROUTS | 190 / 6 / 30.7 / 7.4 / 7 / 17.5 | 0 | 0 | 4, stored | READY_FOR_APPLY | All material ingredients and quantities are resolved; sriracha uses the existing AI fallback. |
| Chopped Thai Shrimp Salad with Garlic Lime Dressing | 547 / 34.7 / 26.6 / 35.9 / 8 / 9.9 | 3 | 2 | 5, stored | BLOCKED | Pan oil is unquantified and the lime/wonton composite remains unresolved. |
| Intsa Punjabi Chole | 190 / 9 / 27.9 / 5.3 / 6.2 / 5 | 4 | 0 | 5, stored | READY_FOR_APPLY | Dried chickpea quantity is preserved, ghee/chickpeas resolve through fallback, and only low-contribution spice/chile lines remain. |
| Rising Sun - Mazcal | 133 / 0.2 / 9.1 / 0.1 / 0.5 / 5.7 | 2 | 1 | 1, stored | BLOCKED | Mezcal is unresolved in the final run; alcohol is a material calorie source. |
| Speget with fake meat meatballs | 397 / 28.6 / 31.5 / 19.3 / 9 / 9.2 | 1 | 1 | 5, stored | BLOCKED | Standalone broccoli has no quantity, so its contribution cannot be defensibly estimated. |
| yogurt Dill sauce | 25 / 1 / 4.2 / 0.6 / 0.2 / 1.8 | 3 | 1 | 4, stored | BLOCKED | Unquantified olive-oil drizzle may materially change fat/calories. |

## Exact apply allowlist

```text
READY_FOR_APPLY:
- spaghetti-carbonara
- chicken-meatballs-with-peppers-and-orzo
- chinese-chili-oil
- honey-sriracha-roasted-brussels-sprouts
- intsa-punjabi-chole
```

## Blockers and next actions

| Recipe | Blocker type | Next action |
|---|---|---|
| Heart-Healthy Peanut Butter Protein Bars | SOURCE_REQUIRED | Specify protein-powder product/type and retain source quantities. |
| Peanut Butter Oat Protein Shake | SOURCE_REQUIRED | Specify protein-powder product/type; validate fiber ingredients. |
| Bread! | SERVINGS_DECISION | Decide whether authoritative source yield 8 supersedes stored/default 4. |
| Chicken Chickpea Salad | SOURCE_REQUIRED | Resolve source ingredient sections and authoritative serving count. |
| Chopped Thai Shrimp Salad | QUANTITY_MISSING | Supply pan-oil quantity and decide whether optional wontons are included. |
| Rising Sun - Mazcal | AI_FALLBACK_LIMITATION | Re-run with a successful alcohol fallback or provide a source-backed mezcal basis. |
| Speget with fake meat meatballs | QUANTITY_MISSING | Provide broccoli quantity or confirm the line is source junk. |
| yogurt Dill sauce | QUANTITY_MISSING | Provide the olive-oil drizzle amount; do not invent one. |

## Safety counts

```text
Recipe writes: 0
Recipe creates: 0
Recipe deletes: 0
Maple changes: 0
Smoothies changes: 0
Nutrition writes: 0
Canonical production writes: 0
Firestore mutation: 0
?apply=true calls: 0
```

## Next path

PATH C applies: engine remediation is closed for this population, and the five-item allowlist can proceed in a separate controlled apply prompt. The eight blocked recipes remain untouched pending their stated source, servings, or quantity decisions. Nutrition apply was not performed in Prompt 4D.1.

Raw evidence: `docs/audits/m04-nutrition-final-raw-2026-08-22.json`.
