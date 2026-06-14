# AUDIT — Round 2 (MEA Recipes)

Read-and-confirm audit of UX/workflow findings against actual code + schema.
Scope of changes made this session: cosmetic copy + aria-labels only (see §3).
Date: 2026-06-13 · Branch: `main` · Build after edits: **PASSED**.

Method note: every storage claim below was traced through the real read/write
path (`lib/*`, `hooks/*`, the page that calls it) — not from the PRD. Where I
could not observe live Firestore data (this is a code audit with no DB session),
that is stated explicitly.

---

## 1. TWO-USER READINESS SUMMARY (headline)

**Bottom line:** For the five dimensions asked (goals / log / rating / notes /
discover), **all are already keyed per-user today. None need a new `uid`
dimension.** The personal-data layer is structurally two-user-ready. The real
two-user risk is the **shared global recipe catalog** (`recipes/{id}`) and the
**nutrition/servings embedded on it**, which two users mutate in common.

### Per-user vs. global (A–E)

| # | Data | Firestore key today | Per-user or global | Needs a `uid` dimension? | Evidence (file:line) |
|---|---|---|---|---|---|
| A | Nutrition **goals** | `users/{uid}/nutrition/root/goals/daily` | **Per-user** | No — already scoped | `lib/consumptionLog.ts:38-40` (`goalsDocRef(uid)`), read `:162-166`, write `:168-170`; callers pass `user.uid` — `components/GoalsModal.tsx:27,64`, `app/nutrition/page.tsx:52` |
| B | **Consumption log** | `users/{uid}/nutrition/root/log/{entryId}` (+ `userId` field on each doc) | **Per-user** | No | `lib/consumptionLog.ts:34-36` (`logPath(uid)`), write stamps `userId` `:98-104`, range read `:113-124`. Two users get fully separate daily logs ✓ |
| C | Recipe **rating** | `users/{uid}/recipes/root/meta/{recipeID}.rating` | **Per-user** | No | `lib/userdata.ts:53-89` (`RecipeMeta`, `metaPath(uid)` `:69`, `getRecipeMeta`/`saveRecipeMeta`); `hooks/useRecipeMetas.ts:15` reads `users/{user.uid}/.../meta`. **Not** a field on the shared recipe doc. |
| C | Recipe **notes** | `users/{uid}/recipes/root/meta/{recipeID}.note` | **Per-user** | No | Same path/structure as rating (`lib/userdata.ts:53-89`). `overrides` (personal title/content/image/time edits) also live here `:58-66`. |
| D | **Discover / recommendations** | Built client-side from the signed-in user's own data, POSTed to a stateless route | **Per-user (one user only)** | No | `app/discover/page.tsx:365-379` — `cookCounts` from `useCookingHistory()` (own week plans), `ratings` from `useRecipeMetas()` (own meta), `favorites` from `useFavorites()` (own); sent at `:390-396`. `app/api/recommendations/route.ts:9` consumes only the request body — no second-user data, no DB read of another uid. |
| E | Recipes **"Added by me"** source filter | Recipe doc field `addedBy` (creator uid) | Catalog is **global**; `addedBy` tags each recipe | n/a — already uid-aware | Default `'mine'` set once/session `app/recipes/page.tsx:104-117`; filter predicate `r.addedBy === user?.uid` `:161-163`; `addedBy` written in `lib/recipes.ts:81-88` (`saveRecipe(..., addedByUid)`). |

### What is GLOBAL / shared today (the caveat that matters)

- **Recipe catalog `recipes/{id}` is one global collection** — both users read and
  write the same documents (`lib/recipes.ts:18,48-91`; no `uid` in the path). This
  is intentional ("shared catalog, private edits", PRD §4.6).
- **`recipe.nutrition` and `recipe.servings` live on that shared doc.**
  `updateRecipeServings` (`lib/recipes.ts:104-120`) and `saveRecipeNutrition`
  (`:131-137`) write `recipes/{id}.nutrition`. **This is the one genuine cross-user
  data bleed:** if user A corrects a recipe's servings, user B's per-serving macros
  change too. PRD documents this as "safe given the single-user model" — it stops
  being safe with two users.
- **`saveRecipe` overwrites by slugified title** (`lib/recipes.ts:82-88`) and
  **overwrites `addedBy`** whenever a uid is passed. Two users adding/re-saving the
  same title collide on one doc, and `addedBy` flips to whoever saved last — which
  also silently moves the recipe between their "Added by me" views.

### So what does two-user actually require?

Not "add a uid dimension to goals/log/ratings/notes/discover" — that work is
already done. The outstanding decisions are **catalog policy**:
1. slug collisions on same-titled recipes (overwrite vs. namespace),
2. `addedBy` overwrite on edit/re-save,
3. shared `nutrition`/`servings` edits leaking across users (move servings
   correction into per-user `meta.overrides`, or accept shared).

This is covered again in §4 ("Bigger than expected").

---

## 2. Findings A–R

Severity key: **P0** = broken/data-loss · **P1** = wrong data or real workflow
break · **P2** = polish / feature gap / informational confirmation.

| # | Status | Sev | Root cause (file:line) | Explanation | Fix sketch (NOT implemented) |
|---|---|---|---|---|---|
| **A** | CONFIRMED | P2 (info) | `lib/consumptionLog.ts:38-40,162-170` | Goals are one doc per uid at `goals/daily`; read/write both take `userId`. Per-user. | None needed for two-user. |
| **B** | CONFIRMED | P2 (info) | `lib/consumptionLog.ts:34-36,93-124` | Log is a per-uid subcollection; each entry also carries `userId`. Two users → independent daily logs. | None needed. |
| **C** | CONFIRMED | P2 (info) | `lib/userdata.ts:53-89`; `hooks/useRecipeMetas.ts:9-23` | Rating **and** notes are stored in per-user `meta/{recipeID}`, **not** on the shared recipe doc. Discover reads ratings from this per-user map (`app/discover/page.tsx:375-379`). | None needed; note that `meta` doc IDs are sanitized (`sanitizeMetaID` `:73-75`). |
| **D** | CONFIRMED | P2 (info) | `app/discover/page.tsx:365-408`; `app/api/recommendations/route.ts:9-103` | Recommendations use exactly **one** user's history/ratings/favorites (the signed-in user's), assembled client-side and POSTed to a stateless AI route. No blending of two users. | None needed; behaviour is correct per-user. |
| **E** | CONFIRMED | P2 | `app/recipes/page.tsx:104-117,161-163`; `lib/recipes.ts:81-88` | Source filter defaults to `'mine'` once per browser session (guard key `mea_recipes_default_mine_applied`); driven by `r.addedBy === user?.uid`. `addedBy` = creator uid from `saveRecipe`. | Two-user caveat only: `addedBy` is overwritten on re-save (see §4). Consider preserving original `addedBy`. |
| **F** | **REFUTED** | P2 | `components/InsightsTab.tsx:322` → rendered by `components/GoalRing.tsx:80` | **No formatting bug, no string-concat, no unit doubling.** The Today ring passes the *raw daily* goal (`app/nutrition/page.tsx:194`) and `formatNutrient` (`lib/nutrition.ts:24-28`) yields clean decimals — a 50 g goal renders "50 g". The "**500 g**" the auditor saw is the **Insights** tab's intended **compounded** target: `proRatedGoal = (goals[key] || 0) * range.elapsedDays` (e.g. 50 g/day × 10 elapsed days = 500 g), and it is explicitly labelled "Consumed vs. your daily goals compounded over the N days elapsed" (`InsightsTab.tsx:308-313`). | If 500 g reads as alarming, that's an Insights-tab clarity choice (e.g. show "/day" equivalent), not a Today bug. Nothing to fix in `GoalRing`. |
| **G** | **REFUTED** (transposition) | P1 (data quality) | compute `lib/nutritionEngine.ts:491-492,675-676,694`; passthrough `lib/recipes.ts:40`; render `components/NutritionSection.tsx:80-81,108-119` + `lib/nutrition.ts:15-16` | Fiber and sugar are **not** swapped at any layer. USDA mapping is correct (`fiber_g ← #291/1079`, `sugar_g ← #269/2000`), totals/per-serving keep the fields distinct, `docToRecipe` passes `nutrition` verbatim, and the render maps each label to its own key via the `NUTRIENTS` order. The implausible "Fiber 0.9 / Sugar 18.3" for Easy Spaghetti is **estimate/source quality**, not a transposition (a swap would put the *large* number on fiber). Likely an AI/USDA estimate: a sugary sauce or mis-resolved pasta under-counting fiber. | Inspect that recipe's `nutrition.source`/`confidence` and the engine's `unresolved`/matched descriptions; this is a recompute/validation issue, and ties to **H**. (Could not read the live doc in this session.) |
| **H** | CONFIRMED (no guard) | P2 | `components/NutritionSection.tsx:108-119` | All six macros are rendered unconditionally; the only confidence affordances are the `trustBadge` (`lib/nutrition.ts:160-165`) and the "servings were assumed" caveat (`:136-145`). Nothing suppresses low-confidence fiber/sugar. | Add a per-field suppression keyed on `nutrition.confidence === 'low'` — either in `NutritionSection` (render "—" for low-trust fiber/sugar) or upstream (engine nulls low-confidence fields; `formatNutrient` already renders `undefined`→"—"). |
| **I** | CONFIRMED | P1 | `app/grocery/page.tsx:266-282` (AI-cleanup apply) + `lib/userdata.ts:385-417` (add/merge) + render `app/grocery/page.tsx:782-787` | The merge is **not unit-aware**. Recipe ingredients store the whole line in `name` with `quantity:''`/`unit:''` (`userdata.ts:404-414`); dedupe is by sanitized doc ID only (`:392-395`), no quantity math. The AI cleanup is the only writer that *populates* `quantity`/`unit` (`grocery/page.tsx:277-282`) — when it sets `quantity:"6"` on an item whose `name` already contains "4 ears…", the render concatenates `{quantity} {name}` → "6 4 ears shucked corn". | Parse a leading quantity+unit off the ingredient line at write time (a real unit-aware parser shared by `addRecipeIngredientsToGrocery` and the AI-apply path); merge by normalized noun + summed quantity. Structural, not a one-liner (see §4). |
| **J** | CONFIRMED (with one correction) | P1 | taxonomy `lib/groceryCategories.ts:2-11`; matcher `categorizeIngredient`; AI prompt `app/api/grocery-cleanup/route.ts:4-7,19-49`; manual add `app/grocery/page.tsx:319,52` | (a) **8 categories, no "Spices"/"Pantry"/"Seasonings"** — spices are meant to fall in **Staples**, which is *auto-only* (excluded from manual choice). (b) **Correction to the Round-1 hypothesis:** the *local* matcher routes "chile powder" → **Other** (it misses Staples keyword `'chili powder'` purely on the `chile`≠`chili` spelling) and "chipotle" → **Other** (no keyword). The reported **Beverages** came from the **AI cleanup**, whose `category` is written to `manualSection` and *overrides* the local matcher (`grocery/page.tsx:47-50,281`); the route never validates the returned category against `CATEGORIES`. (c) **"1 black beans" drops "can"** because the manual Add-Item form has no unit input — `unit:''` is hardcoded (`grocery/page.tsx:319`) and `MEASUREMENT_WORDS` strips `can\|cans` (`:52`). | Add a "Spices & Seasonings" (or make Staples manual-selectable); validate AI-returned category ∈ `CATEGORIES` before writing `manualSection`; add `'chile'`/`'chipotle'`/`'ancho'` keywords; give the Add-Item form a unit field (the *edit* form already has one, `:743-752`). Full category list + AI prompt quoted in §5. |
| **K** | CONFIRMED | P1 | `lib/userdata.ts:94-100` (`WeekPlan`) | The plan is a flat per-week doc with two `string[]`s (`plannedRecipeIDs`, `cookedRecipeIDs`) keyed by Monday ISO date — **no day index, no meal slot**. The page renders only "Planned" vs "Cooked" buckets (`app/plan/page.tsx:279-282`). A slot-aware `useMealPlan.ts` exists but is **dead code** (localStorage-backed, imported nowhere). | A `string[]` can't carry day/slot. Change element shape to `{recipeID, day, slot}[]` (or add a parallel map) — breaks `arrayUnion`/`arrayRemove` and needs a data migration. Impact in §4. |
| **L** | CONFIRMED (missing fallback, not a data gap) | P2 | `app/plan/page.tsx:559-562` | The **Planned** thumbnail is `&&`-gated on an image URL and its `onError` only hides the `<img>` — so a recipe with no/failed image renders **nothing** (no placeholder). The item *is* resolved in the catalog (`:554-555 return null` if missing), so it's not a data gap. The **Friends'** (`:741-750`) and **Cooked** (`:669-671`) sections *do* have a `bg-card` placeholder. | Give the Planned thumbnail the same `: (<div className="...bg-card" />)` else-branch; ideally a shared image component (ties to **P**). |
| **M** | CONFIRMED | P2 (feature gap) | `app/recipes/[id]/page.tsx:395-414` | Ingredients render as static `<li>` bullets; a full grep of the detail page finds no grocery/cart action. The only path ingredients reach grocery is whole-recipe via Plan (`addRecipeIngredientsToGrocery`/`rebuildGroceryFromPlan` on `app/plan/page.tsx`). | Add a per-row "+ grocery" button in the non-header `<li>` (`:407-412`) calling `addGroceryItem` (`lib/userdata.ts:267-275`) or `addRecipeIngredientsToGrocery([ing])` (`:385`); `user.uid` is already in scope. |
| **N** | CONFIRMED **present** | P2 (no action) | `components/CookingMode.tsx:63-93` | Cooking Mode **does** acquire a screen Wake Lock (`navigator.wakeLock.request('screen')` `:72`), feature-detected (`:70`), with re-acquire on `visibilitychange` (`:78-86`) and cleanup release (`:88-92`). Correct, complete implementation. | None. (iOS Safari historically no-ops silently — inherent, not a defect.) |
| **O** | CONFIRMED **absent** | P2 (feature gap) | `components/CookingMode.tsx:230-235` | Steps render as plain `{step}` text. No `setInterval`/`setTimeout`/duration regex anywhere in the component (only match for "minute/parse*" is `parseFloat(servingsInput)` `:47`, unrelated). "3 minutes" in a step is inert text. | Parse durations from step text (e.g. `/(\d+)\s*(min|minute|sec)/`) and render a tap-to-start countdown per step. |
| **P** | CONFIRMED | P2 | shared component: none; `components/RecipeCard.tsx:158-168` + table below | **No shared `<Image>` component.** Every image is a raw `<img>` (zero `next/image` usage) with a hand-rolled `onError` that varies: hide-img, swap-to-placeholder, or **nothing**. None fall back to the category-emoji used by the `imageURL`-absent branch. Three sites have **no `onError` at all**. | Build one `<RecipeImage>` with an emoji/`bg-card` fallback; replace all 14 sites. |
| **Q** | CONFIRMED | P2 | `components/Navigation.tsx:10-20` (array) + `:73-96` (mobile render) | `NAV_ITEMS` has **9** entries; the mobile bottom nav maps all 9 **plus** an "Add" button = **10** equal-width `flex-1` cells at `text-[9px]`, **no "More"/overflow**. Desktop uses a separate sidebar (`:29-70`) and is fine. | Cap the bottom bar at ~4–5 primary items + a "More" sheet for the rest. |
| **R** | CONFIRMED | P2 | `app/recipes/[id]/page.tsx:152-158` | Detail loading is a single centered `Loader2` over `min-h-screen` — a **full-page spinner, not a skeleton**. (Note the *recipes list* page **does** use skeletons: `app/recipes/page.tsx:45-55,315-318` — so the two pages are inconsistent.) | Render a skeleton (hero block + title + ingredient lines), reusing the list page's `skeleton` class. |

### One-line flag (no analysis)

**Does a `firestore.rules` file exist in the repo? → NO.** Confirmed absent
anywhere under the repo (excluding `node_modules`/`.next`/`.claude`); there is
also **no `firestore.indexes.json`**. (Consistent with PRD: rules are
console-only for the shared `malignant-metro` DB.)

---

## 3. Trivial fixes applied this session

Only visible copy + aria-labels; no logic/layout/data changes. Build re-run after: **PASSED**.

| File:line | Change | Why |
|---|---|---|
| `app/recipes/page.tsx:231` | Subtitle "Your personal collection" → **"Your shared recipe collection"** | The catalog is a single global `recipes/{id}` collection shared across users; "personal" is inaccurate (the audit's own example fix). |
| `app/recipes/[id]/page.tsx` (edit button, ~:252) | Added `aria-label="Edit recipe"` | Icon-only button (Pencil) had no accessible name. |
| `app/recipes/[id]/page.tsx` (delete button, ~:260) | Added `aria-label="Delete recipe"` | Icon-only button (Trash2) had no accessible name. |
| `app/recipes/[id]/page.tsx` (favorite toggle, ~:278) | Added `aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}` | Icon-only button (Heart) had no accessible name. |

(Today-view and GoalsModal icon buttons already had aria-labels — left untouched.)

---

## 4. "Bigger than expected" callouts

1. **Two-user readiness is further along than a "add uid everywhere" framing
   assumes — but the real work is catalog policy, which is bigger.** Goals, log,
   ratings, notes, favorites, grocery, plans, queue and overrides are *already*
   per-user. The unsolved part is the **shared global catalog**:
   `recipes/{id}` slug collisions (`lib/recipes.ts:82-88`), `addedBy` overwrite on
   re-save (changes who "owns" a recipe and which user's "Added by me" it shows
   in), and **shared `nutrition`/`servings` edits bleeding across users**
   (`lib/recipes.ts:104-120,131-137`). These are design decisions (namespace the
   catalog? move servings into per-user `meta.overrides`?), not field additions.

2. **K (day + meal-slot) is a cross-cutting migration, not a localized field.**
   The flat `string[]` model is read/written in ~3 type copies (`lib/userdata.ts:94-100`,
   `hooks/useCookingHistory.ts:8-13`, the dead `hooks/useMealPlan.ts:10-16`),
   ~6 writer functions (`addRecipeToWeekPlan`, `removeRecipeFromWeekPlan`,
   `moveRecipeToWeek`, `markRecipeCooked`, `publishSharedPlan`,
   `rebuildGroceryFromPlan`), ~8 page/render files (plan, insights, history,
   discover, grocery, favorites, recipes), and the shared-plan mirror + `logCookEvent`
   orchestration (`lib/consumptionLog.ts:255-279`). Element-as-object also breaks
   `arrayUnion`/`arrayRemove` and requires migrating existing Firestore docs. The
   dead slot-aware `useMealPlan.ts` is a tempting-but-wrong shortcut (it's a
   separate localStorage model, never wired in).

3. **I + J share one structural root: nothing parses an ingredient line into
   `name`/`quantity`/`unit` at write time.** The three-field grocery model exists
   (`lib/userdata.ts:230-241`) but recipe-add stores the whole line in `name`
   (`:404-414`) and manual-add hardcodes `unit:''` (`app/grocery/page.tsx:319`).
   Only the AI cleanup ever writes `quantity`/`unit`, which then collides with
   names that already embed a quantity ("6 4 ears…"). A proper fix is a unit-aware
   parser applied at *every* write site + unit-aware merge — broader than the
   display patch Round 1 may have assumed.

4. **P (broken-image fallback) is 14 hand-rolled sites, not one.** There is no
   shared image component, so a real fix means introducing one and migrating every
   `<img>` (cards, discover ×2, detail, plan ×3, queue, history, insights ×2,
   auth avatar, add/edit modals). Three currently have no `onError` at all
   (`app/insights/page.tsx:279,313`, `components/AuthButton.tsx:25`).

5. **G's premise was wrong, which redirects the fix.** There is no fiber/sugar
   transposition to "unswap." The implausible values are an
   estimate/low-confidence quality problem, so the useful work is recompute +
   confidence-gating (finding **H**) and validating ingredient resolution — a
   data-trust effort, not a field-mapping fix.

---

## 5. Required verbatim quotes (finding J)

### Grocery category taxonomy — `lib/groceryCategories.ts:2-11`

```ts
export const GROCERY_CATEGORIES = [
  'Produce',
  'Meat & Seafood',
  'Dairy & Eggs',
  'Bakery & Bread',
  'Canned / Jarred / Sauces',
  'Beverages',
  'Staples',
  'Other',
] as const
```

8 categories. **No "Spices", "Pantry", or "Seasonings".** Spices are intended to
land in **Staples**, which per PRD §5.9 is *auto-assigned only* (excluded from
`MANUAL_CATEGORIES`, so a user cannot pick it manually).

### AI cleanup category constant — `app/api/grocery-cleanup/route.ts:4-7`

```ts
const CATEGORIES = [
  'Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Bakery & Bread',
  'Canned / Jarred / Sauces', 'Beverages', 'Staples', 'Other'
]
```

A **hand-duplicated copy** of `GROCERY_CATEGORIES` (not imported) — the two can drift.

### AI grocery-cleanup prompt — `app/api/grocery-cleanup/route.ts:19-49`

```
You are a grocery list organizer. Clean up this grocery list and return improved data.

GROCERY ITEMS:
${items.map((item, i) => `${i}: "${item.name}" (qty: ${item.quantity || ''} ${item.unit || ''})`).join('\n')}

TASKS:
1. Deduplicate similar items (e.g. "garlic cloves grated" + "4 cloves garlic" = "garlic")
2. Normalize names (e.g. "CRUSH and mince the garlic" → "garlic", remove instruction text)
3. Assign the best category from this exact list: ${CATEGORIES.join(', ')}
4. Note: "Staples" = oils, vinegars, spices, sugars, flours, salts — things people usually have

Return ONLY a JSON array, no markdown:
[
  {
    "originalIndex": 0,
    "name": "cleaned name",
    "quantity": "combined quantity or empty string",
    "unit": "unit or empty string",
    "category": "exact category from list above",
    "action": "keep" | "merge" | "normalize" | "remove",
    "mergedWith": [1, 2] // indices of items merged into this one, or empty array
  }
]

Rules:
- If merging items, include all original indices in mergedWith
- action "remove" = clearly not a grocery item (e.g. instruction text like "ON THE STOVE")
- action "merge" = combined with another item
- action "normalize" = cleaned up name but kept as-is
- action "keep" = no changes needed
- Return ONLY the JSON array
```

The only category *guidance* is line 4 ("Staples" = …spices…). There is **no
guidance for chiles, chipotle, dried-spice powders, or beans**, and the route
**does not validate** the returned `category` against `CATEGORIES` before writing
it to `GroceryItem.manualSection` — which is why "chile powder" → Beverages slips
through and overrides the local matcher.
