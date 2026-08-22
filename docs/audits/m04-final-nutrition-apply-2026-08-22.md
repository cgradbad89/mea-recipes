# M-04 Final Controlled Nutrition Apply — Prompt 4E

## Executive result

**PASS WITH DEFERRED ITEMS**

- M-04 parser remediation: **COMPLETE**
- M-04 recipe-data remediation: **COMPLETE FOR SAFE POPULATION / DEFERRED ITEMS REMAIN**
- M-04 nutrition-engine remediation: **COMPLETE**
- M-04 controlled nutrition apply: **PARTIAL — 2 of 5 applied and verified**
- Further nutrition work recommended now: **NO**

The authoritative final-readiness report contained exactly five IDs. A guarded direct Admin SDK harness
backed up those five documents, ran a fresh non-persistent computation immediately before each possible
write, applied only recipes passing the gate, and read back every successful write. No route with
`?apply=true` was used.

## Exact final allowlist

1. `spaghetti-carbonara`
2. `chicken-meatballs-with-peppers-and-orzo`
3. `chinese-chili-oil`
4. `honey-sriracha-roasted-brussels-sprouts`
5. `intsa-punjabi-chole`

Allowlist count: **5**.

## Backup

Backup path: `docs/audits/m04-final-nutrition-apply-backup-2026-08-22.json`.

Five recipe documents were backed up before computation, including the full existing document plus
`recipeID`, title, nutrition, nutrition status, servings, modified, and `nutrition_prev`. Firestore
Timestamp values were serialized with seconds and nanoseconds. The artifact contains recipe data only;
credential scan: **no credentials or environment values included**.

## Final pre-write dry-run and gate

| Recipe ID | Reviewed result | Fresh result | Material change? | Gate |
|---|---|---|---|---|
| `spaghetti-carbonara` | 867 kcal / medium / 0 unresolved | 490 kcal / medium; guanciale and Pecorino unresolved | Yes | **FAIL — skipped** |
| `chicken-meatballs-with-peppers-and-orzo` | 451 kcal / medium / finishing garnish unresolved | 451 kcal / medium / same unresolved garnish | No | **PASS** |
| `chinese-chili-oil` | 98 kcal / medium / immaterial aromatics unresolved | 97 kcal / medium; ground chili and bay leaves unresolved | Yes | **FAIL — skipped** |
| `honey-sriracha-roasted-brussels-sprouts` | 190 kcal / medium / 0 unresolved | 190 kcal / high / 0 unresolved | No | **PASS** |
| `intsa-punjabi-chole` | 190 kcal / medium / low-contribution spices unresolved | 199 kcal / medium; salt and tamarind unresolved | Yes | **FAIL — skipped** |

The skipped results were documented and not investigated further, per the finality rule.

## Per-recipe apply

| Recipe ID | Gate | Write | Read-back | Final status |
|---|---|---|---|---|
| `spaghetti-carbonara` | failed | 0 | not applicable | `SKIPPED_CHANGED_RESULT` |
| `chicken-meatballs-with-peppers-and-orzo` | passed | 1 | verified | `APPLIED_VERIFIED` |
| `chinese-chili-oil` | failed | 0 | not applicable | `SKIPPED_CHANGED_RESULT` |
| `honey-sriracha-roasted-brussels-sprouts` | passed | 1 | verified | `APPLIED_VERIFIED` |
| `intsa-punjabi-chole` | failed | 0 | not applicable | `SKIPPED_CHANGED_RESULT` |

## Stored before → applied after

| Recipe ID | Servings | Calories | Protein | Carbs | Fat | Fiber | Sugar | Source | Confidence |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| `chicken-meatballs-with-peppers-and-orzo` | 4 → 4 | 695 → 451 | 45.8 → 36.9 | 93.4 → 38.3 | 15.7 → 17.4 | 7.7 → 5.5 | 9.4 → 6.2 | `usda+ai+recovered_servings` → `usda+canonical+ai` | medium → medium |
| `honey-sriracha-roasted-brussels-sprouts` | 4 → 4 | 189 → 190 | 6 → 6 | 30.7 → 30.7 | 7.3 → 7.4 | 7 → 7 | 17.5 → 17.5 | `usda+recovered_servings` → `usda+canonical+ai` | medium → high |

Values are per serving. Totals, source, confidence, serving basis, and `nutritionStatus: computed` were
verified after each write. Unrelated recipe fields were byte-for-byte equivalent under the harness's
Firestore-aware comparison.

## Scope and denylist verification

- Nutrition writes: **2**; maximum authorized: 5.
- Recipe creates: **0**.
- Recipe deletes: **0**.
- Recipe content writes: **0**.
- Canonical writes: **0**.
- Nutrition-log writes: **0**.
- Maple Pecans changes: **0**.
- Smoothies changes: **0**.
- Non-allowlisted document changes: **0**.
- Firestore rules/indexes or infrastructure deployments: **0**.

Machine evidence: `docs/audits/m04-final-nutrition-apply-results-2026-08-22.json`.

## Deferred by choice or source limitation

The three allowlisted recipes that failed fresh safety gates remain unchanged. The eight final-readiness
blocked recipes remain deferred for their documented source, servings, or quantity decisions. Maple Roasted
Candied Pecans remains source-deficient, and `smoothies` remains an intentionally untouched composite.

M-04 is **resolved for the safely remediable population; source/data-deficient recipes explicitly deferred**.
No further nutrition-focused investigation is recommended in this cleanup sequence.
