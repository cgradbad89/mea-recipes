# Recipe Category Migration Apply — 2026-08-25

> PASS — CATEGORY MIGRATION COMPLETE

## Approved manifest

- Path: `docs/audits/recipe-category-migration-dryrun-2026-08-25.json`
- SHA-256: `e1f266550d037b7683e2f4640e7aeca1d84471879399bb75522441ef69470e67`
- Rows: 91 (66 shared writes, 24 override removals, 1 preserved override)
- Apply-tool commit: `382b553a84e3b917df1375cd7bfe0441bcf945f8`

## Pre-apply gate

- Shared READY: 66
- Override removals READY: 24
- Preserved overrides verified: 1
- Precondition mismatches: 0
- Unexpected records: 0
- Unresolved records: 0

## Transaction

- Started: 2026-08-25T12:13:12.600Z
- Completed: 2026-08-25T12:13:13.322Z
- Result: COMMITTED
- Shared category updates: 66
- Override category deletions: 24
- Total document writes: 90
- Preserved-override writes: 0
- Partial writes: 0

## Post-apply verification

- Shared documents: 236
- Canonical shared categories: 236
- Noncanonical shared categories: 0
- Missing shared categories: 0
- Category overrides remaining: 1
- Recipe 182 shared category: Vegetarian Mains
- Recipe 182 override category: Salads & Bowls
- Shared readback rows verified: 66
- Override-deletion rows verified: 24

| Category | Count |
| --- | --- |
| Beef & Pork | 20 |
| Breakfast | 4 |
| Chicken & Poultry | 38 |
| Drinks | 3 |
| Pasta, Noodles & Rice | 23 |
| Salads & Bowls | 33 |
| Sauces & Condiments | 4 |
| Seafood | 12 |
| Sides | 34 |
| Snacks | 4 |
| Soups, Stews & Chili | 34 |
| Vegetarian Mains | 27 |

## Unrelated-data safety

- Week-plan writes: 0
- Week-plan stable projection unchanged: true
- Stored role changes: 0
- defaultRole changes: 0
- Other recipe-field changes: 0
- Other RecipeMeta-field changes: 0

## Recovery

- Revert manifest: `docs/audits/recipe-category-migration-revert-2026-08-25.json`
- Rows covered: 90
- Revert executed: no (separate explicit authorization required)
