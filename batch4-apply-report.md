# Batch 4-apply — Canonical Staples APPLY Report

> **WROTE** recomputed nutrition to Firestore via
> `https://mea-recipes.vercel.app/api/nutrition-canonical-dryrun?apply=true` — full three-tier engine (canonical → USDA → **AI on**, Vercel).

## Counts

| metric | count |
|---|---|
| Catalog | 210 |
| Processed | 210 |
| **WRITTEN** | **136** |
| skipped: no canonical hit | 3 |
| skipped: no canonical effect (change was engine-drift, not the table) | 7 |
| skipped: would downgrade confidence | 49 |
| skipped: no material change vs stored | 0 |
| skipped: no stored total | 0 |
| skipped: invalid recompute | 0 |
| skipped: parse error | 15 |

## Confidence distribution after

- medium: 98
- high: 93
- low: 3
- none: 1

## Easy Spaghetti With Meat Sauce (headline)

- old (stored): total sugar 73.2, fiber 3.7, cal 1244, conf low
- written: total sugar 14.8, fiber 14.6, cal 1973, conf high, source usda+canonical
- decision: WRITTEN

## Revert

- **Primary:** each written doc has a `nutrition_prev` field = its exact pre-apply nutrition. Revert = set `nutrition = nutrition_prev` then delete `nutrition_prev`.
- **Backup:** `batch4-apply-revert-manifest.json` (keyed by recipeId → `prev`) captures the same 136 prior values.

## Largest corrections written (by |sugar Δ| vs stored)

| recipe | sugar stored→new | cal stored→new | conf old→new |
|---|---|---|---|
| Overnight Oatmeal | 55.1→232 | 1015→1480 | low→high |
| Slow Cooker Pumpkin Applesauce | 27.1→159.7 | 689→914 | medium→high |
| Black Lentil and Harissa-Roasted Veggie Bowl | 165.1→63.9 | 3381→2669 | medium→high |
| Saucy Gochujang Noodles with Chicken | 135.8→41.2 | 1887→1391 | medium→medium |
| Slow Cooker Beef Brisket with BBQ Sauce | 125.4→200 | 4798→4563 | low→high |
| Creamy Chickpea Spinach Masala With Tadka | 103→36 | 2621→2559 | medium→medium |
| One-Pot Ratatouille Pasta | 89.2→24.6 | 2288→2402 | medium→medium |
| Zesty Quinoa Salad | 71.2→10.8 | 2210→1885 | low→high |
| Easy Spaghetti With Meat Sauce | 73.2→14.8 | 1244→1973 | low→high |
| Roasted White Bean and Tomato Pasta | 81.5→30.9 | 4256→4038 | medium→medium |
| Quinoa Sweet Potato Salad | 43.6→87.4 | 1819→1112 | medium→medium |
| 1-Hour Pressure Cooker Texas-Style Chili con Carne | 51.2→7.7 | 5563→2843 | low→medium |
| Megan's wild rice & Kale Salad | 69.3→27 | 1705→1250 | medium→high |
| Orzo Salad | 15.1→54.5 | 3690→3579 | medium→medium |
| Skillet Chicken and Pearl Couscous With Moroccan Spices | 48.2→9.4 | 2958→3837 | low→medium |

