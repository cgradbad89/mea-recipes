# Nutrition Re-validation — Dry-Run Report (Task C, Batch 3)

> Generated artifact — **not committed** (per Batch-3 instructions: "Do NOT commit
> large generated data"). Reproduce any time with the route below.
>
> Route: `app/api/nutrition-revalidate/route.ts` · **DRY-RUN by default** ·
> writing requires the explicit `?apply=true` flag.

## How to run

```bash
# DRY RUN (no writes) — first batch of 25:
curl -s -X POST "https://mea-recipes.vercel.app/api/nutrition-revalidate?limit=25&offset=0" \
  -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" | tee nutrition-revalidation-dryrun.json

# page through the rest: offset=25, 50, 75, 100
# APPLY (persist improved estimates) only after reviewing the dry-run diff:
curl -s -X POST "https://mea-recipes.vercel.app/api/nutrition-revalidate?apply=true&limit=25" \
  -H "Authorization: Bearer <FIREBASE_ID_TOKEN>"
```

The route returns the full diff as JSON and also `console.log`s a human-readable
summary to the server logs. `ANTHROPIC_API_KEY` must be present in the runtime
env (it is in Vercel; **not** in local `.env.local`) for the AI-fallback tier.

## Population (VERIFIED — read-only admin probe, 2026-06-13)

| Metric | Count |
|---|---|
| Recipes total | 208 |
| …with stored `nutrition` | 205 |
| …with **no** nutrition (out of scope — use "Calculate nutrition") | 3 |
| **Match re-validation predicate** (`servingsAssumed` OR source contains `ai`) | **107** |
| …of those, `confidence === 'low'` | 49 |

Breakdown of the 107 candidates by `source | confidence`:

| Count | source | confidence | What a recompute will do |
|---|---|---|---|
| 40 | `usda+ai` | medium | Re-resolve; may stay medium (AI used) or lift to high if all ingredients now match USDA. |
| 29 | `usda+default_servings` | **low** | **Servings recovered** from stored `nutrition.servings` → `servingsDefaulted=false` → typically lifts to **high** (no AI). Totals re-resolved via the same validated cascade. |
| 20 | `usda+ai+default_servings` | **low** | Servings recovered → lifts toward **medium** (AI still used for ≥1 ingredient). |
| 18 | `usda+ai+recovered_servings` | medium | Already servings-recovered; re-resolve only. |

So the bulk of the **49 low-confidence** recipes are low *because servings were
assumed at first compute*, not because the macro totals are bad. Re-running now
recovers the stored servings and legitimately lifts most of them.

## Target case — Easy Spaghetti With Meat Sauce (VERIFIED old / PREDICTED proposed)

Doc id: `easy-spaghetti-with-meat-sauce`

**OLD (verified, stored today):**

| | source | conf | servings | cal | protein | carbs | fat | fiber | sugar |
|---|---|---|---|---|---|---|---|---|---|
| per-serving | `usda+default_servings` | **low** | 4 (assumed) | 311 | 14.6 | 23.7 | 18 | **0.9** | **18.3** |
| total | | | | 1244 | 58.3 | 94.9 | 72 | 3.7 | 73.2 |

**PREDICTED proposed (from reading the engine — confirm by running the route):**

- `nutrition.servings = 4` is now stored, so on recompute `prevServings = 4` →
  `servingsDefaulted = false` → **source `usda`, confidence `high`** (no AI tier,
  assuming the same ingredients resolve and none go unresolved).
- The matched tier is **USDA (validated match)** — same deterministic cascade, so
  the **totals are expected to be ≈ unchanged** (sugar ≈ 73.2 total / 18.3 per
  serving).

> ⚠️ **Reviewer takeaway (important, honest caveat):** the implausible sugar is a
> **USDA semantic mis-match** (a sweet/jarred-sauce match that passes the engine's
> kcal-band + token-stem validation), **not** a servings problem. Re-validation via
> the *same engine* recovers servings and lifts confidence `low → high`, but does
> **not** re-judge macro plausibility, so it will **not** fix the sugar — and would
> stamp a `high` label on it. The dry-run diff makes this visible (confidence jumps
> while `sugar` is unchanged). **Do not blind-apply**: a true fix for this recipe is
> a canonical-staples / ingredient-resolution correction in the engine (a separate,
> deliberate change — out of scope for this re-run tool per the Batch-3 hard stop).

## Diff shape (per recipe, as returned by the route)

```jsonc
{
  "recipeId": "easy-spaghetti-with-meat-sauce",
  "title": "Easy Spaghetti With Meat Sauce",
  "old":      { "source": "usda+default_servings", "confidence": "low",
                "servings": 4, "perServing": {…6 macros…}, "total": {…} },
  "proposed": { "source": "usda", "confidence": "high",
                "servings": 4, "matchedTier": "usda (validated USDA match)",
                "perServing": {…}, "total": {…},
                "unresolvedCount": 0, "flaggedCount": n, "unresolved": [] },
  "improved": true,      // proposed confidence !== "low"
  "wouldWrite": true,    // what apply=true WOULD persist
  "written": false       // true only when apply=true actually persisted (+ improved)
}
```

## Write gate (apply mode)

A recipe is persisted **only when** `apply=true` **and** the recompute is no longer
`low` confidence. A recompute that is still `low` is **left untouched** (Task B dims
it) rather than swapping in another rough value. Batches are bounded (default 25,
max 50) and processed sequentially so USDA/AI calls are never sprayed.
