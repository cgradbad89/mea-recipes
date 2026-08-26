# Excluded Recipe Wave 2 Dry Run — 2026-08-26

## Executive result

**PASS** — exact six-recipe immutable content-repair manifest. Production was read-only during this phase.

- Manifest SHA-256: `04108a7264db428862c7d5c52da0c3191f005ad138edb5bf290dba7ec292b151`
- READY: **6**
- SKIP: **0**
- Mapped corpus: **187**
- Mapped stored sourceHash mismatches: **0**
- Parser changes: **0**
- Mapping generation/writes: **0 / 0**
- AI calls: **0**

## Rows

| Recipe | Operation | Classification | Ingredients | Instructions |
|---|---|---:|---:|---:|
| `chicken-enchiladas` | MOVE_EXISTING_TEXT | READY | 11 | 4 |
| `chicken-stew` | MOVE_EXISTING_TEXT | READY | 20 | 4 |
| `couscous-salad-with-lime-basil-vinaigrette` | NORMALIZE_SECTION_STRUCTURE | READY | 18 | 4 |
| `creamy-cauliflower-soup-with-rosemary-olive-oil` | MOVE_EXISTING_TEXT | READY | 14 | 6 |
| `pepper-steak` | MOVE_EXISTING_TEXT | READY | 13 | 4 |
| `pork-fried-rice` | NORMALIZE_SECTION_STRUCTURE | READY | 16 | 7 |

Every READY proposal is derived from its exact live content plus formatting-only section/step labels. Useful storage/tip/notes text is preserved before the ingredient section so it does not enter Cooking Mode.
