# MEA Recipes — Nutrition Tracker Design Spec

**Status:** Draft for review · **Owner:** TacoJuan · **Last updated:** 2026-06-09
**Merge policy:** This is a standalone spec. Merge relevant sections into `PRD.md` (merge, not overwrite).

---

## How to use this document

This spec describes one product vision (a lightweight nutrition tracker built into the recipe app) broken into **five independently-buildable surfaces**. It is written so that each surface section is self-contained: it states what data it reads and writes, what it does, how you know it's done, and what it depends on. When a surface is ready to build, its section becomes the basis for a **single Claude Code prompt** — appended with the standard build rules (work on main, merge any auto-branch before pushing, `npm run build` must pass, output report format).

**Surfaces are NOT independent at runtime — they form a dependency chain.** Build them in the order below. Each is gated by the one before it because a tracker is worthless without logged data, and logged data is worthless without nutrition on recipes.

**Two surfaces require schema inspection before any code is written** (recipe schema field names; the existing plan "cooked" checkmark). Those are flagged inline and must lead their Claude Code prompt with a read-only inspection step.

---

## Problem Statement

Recipes in MEA Recipes have no nutritional information, and there is no way to track what was actually eaten — only what was planned. The user wants to (a) see per-serving nutrition on every recipe, (b) log what they actually consume (recipes they cooked, plus non-recipe food like a Big Mac), and (c) see consumption totals against personal goals over time. This turns the recipe/grocery app into a single place to manage "food," replacing the need for a separate tracker like MyFitnessPal.

## Goals

- Every recipe surfaces per-serving macros (calories, protein, carbs, fat, fiber, sugar) with a visible trust indicator (source + confidence).
- The user can log any consumed item — a cooked recipe, a serving of an existing recipe, or arbitrary food — in a few taps, with servings captured.
- The user can see "today" against daily goals, and "insights" over week/month/YTD/custom ranges, including which foods drove each nutrient.
- Nutrition logic (recipe → ingredients → USDA + AI estimate) is built once and reused by backfill, recipe display, and live food lookup.

## Non-Goals (v1)

- **Barcode scanning / packaged-product database.** Quick-food lookup is name-based (USDA) + AI fallback. Barcodes are a future consideration.
- **Micronutrients beyond the six tracked macros.** No vitamins, minerals, cholesterol, etc. in v1 — schema allows adding later.
- **Multi-user / social nutrition.** This is a single-user tracker (`folstromjohn@gmail.com`); no sharing of consumption data. (Separately, the open "Everyone's plan this week" feature decision still stands.)
- **Automatic "for serving" side calculation.** Recipe nutrition is "as-written"; uncounted sides (rice, bread) are logged separately as consumption entries when eaten.
- **Editing historical log entries' nutrition by editing a recipe.** Log entries store a snapshot; editing a recipe never rewrites past consumption.

---

## Shared Data Models

These are referenced by multiple surfaces. Defined once here.

### `nutrition` object (embedded on each recipe doc) — VALIDATED by backfill pilot

```
nutrition: {
  calories:     number,   // per serving
  protein_g:    number,
  carbs_g:      number,
  fat_g:        number,
  fiber_g:      number,
  sugar_g:      number,
  serving_size: string,   // human-readable, e.g. "1 of 4" or "1 of 4 (assumed)"
  servings:     number,   // count used to derive per-serving (may be assumed default of 4)
  total:        { calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g },  // whole-recipe basis — durable source of truth
  source:       string,   // "source_site" | "usda" | "usda+ai" | "manual" (+ optional suffix "+recovered_servings" | "+default_servings")
  confidence:   string,   // "high" | "medium" | "low"
  computed_at:  timestamp
}
```

**Critical design note:** `total` (whole-recipe) is the durable basis. Per-serving values are derived as `total / servings`. When the user later corrects `servings` in the UI, per-serving recomputes from `total` — so a defaulted-to-4 recipe corrects cleanly without re-running the backfill.

### `consumption_log` collection (NEW)

```
consumption_log/{entryId}
  date:           timestamp   // when it was eaten (date-level granularity for the dashboard)
  meal:           "breakfast" | "lunch" | "snack" | "dinner"   // for Today-view grouping
  type:           "recipe" | "quick_food" | "manual"
  is_cook_event:  boolean     // true only when logged via "mark cooked"; drives plan integration. false for leftover/quick logs.
  recipe_id:      string | null   // set when type=recipe
  name:           string          // "Chicken Tacos" or "Big Mac"
  servings_eaten: number
  nutrition:      { calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g },  // SNAPSHOT, totals for this entry (per-serving × servings_eaten)
  source:         string          // "recipe" | "usda" | "ai_estimate" | "manual"
  created_at:     timestamp
```

**Critical design note — snapshot, not reference:** the entry copies nutrition numbers at log time. Editing the source recipe later never changes historical entries. You ate what you ate.

**Two ways a recipe enters the log:**
- **Cook event** (`is_cook_event: true`) — via Cooking Mode completion or plan checkbox. Writes the log entry AND updates the plan / cooked status.
- **Eat-a-serving** (`is_cook_event: false`) — via Today view, "log a serving of one of my recipes" (leftovers). Writes the log entry ONLY; does not touch the plan or increment cooked count.

### `goals` (single doc, per-user) — NEW

```
goals/{userId}
  calories:  number,   // daily target
  protein_g: number,
  carbs_g:   number,
  fat_g:     number,
  fiber_g:   number,
  sugar_g:   number,   // may function as a ceiling rather than a floor
  updated_at: timestamp
}
```

Goals are **daily targets**. Over a multi-day range they **compound**: target for a range = daily goal × number of days in range. For incomplete/current periods, attainment is computed against elapsed days (see Surface 5).

### Plan integration touchpoint — ⚠️ SCHEMA INSPECTION REQUIRED

The plan page already has a "cooked" checkmark. Its write behavior is **unknown** and must be inspected before building Surface 2. Do not assume field names. The Claude Code prompt for Surface 2 must lead with reading the plan item schema and reporting what the existing checkmark writes.

---

## Shared Module: Nutrition Lookup Engine

**Build as:** a server-side module + API route, reusing the logic validated in the Cowork backfill. **Depends on:** `ANTHROPIC_API_KEY`, `USDA_API_KEY` (both in Vercel + local `.env.local`).

This is the single engine behind backfill, recipe re-computation, and live quick-food lookup. It must implement, as proven necessary during backfill:

- Ingredient parsing (format-aware; handles messy `content`, unicode fractions, mixed numbers, ranges→midpoint, parenthetical can/package sizes; strips blog/promo junk and serving-multiplier widgets; flags "for serving / garnish / optional" sides; sums split "plus" quantities for high-calorie ingredients only).
- USDA lookup with **match validation** (token-stem matching, candidate scoring favoring generic SR-Legacy foods, kcal-per-100g band checks by food class, zero-calorie penalty, a small canonical staples table for items USDA mis-ranks). Reject-and-fall-through to AI estimate on validation failure.
- AI estimate fallback (tag `usda+ai` / `ai_estimate`, confidence `medium`).
- Persistent ingredient cache.
- Servings recovery from non-blocklisted source pages (NYT Cooking is blocklisted); midpoint of ranges; tag `+recovered_servings`, confidence `medium`. Default to 4 servings as a tagged last resort (`+default_servings`, confidence `low`), storing whole-recipe `total` so UI correction re-divides accurately.

**Acceptance criteria:**
- [ ] Given a recipe's ingredient list, returns a populated `nutrition` object with correct `source`/`confidence` per the rules above.
- [ ] Given an arbitrary food name ("Big Mac"), returns macros via USDA branded/survey data, or AI estimate if unresolved, with the source tagged.
- [ ] Bad USDA matches (e.g. butter→"Fruit butter") are rejected, not returned.
- [ ] The same module is callable from the app's server routes; no logic is duplicated between backfill and app.

---

## UI Shell: Unified "Nutrition" Page (settled via mockups)

Surfaces 4 and 5 are **two tabs of a single Nutrition page**, not separate destinations:
- **Today tab** (Surface 4) is the default landing tab — log list + today's goal rings + entry points.
- **Insights tab** (Surface 5) is the analytical view — ranges, donut, goal attainment.
- A **persistent "＋ Log food" button lives in the page header**, available from both tabs. It opens the entry sheet (Surface 3) as a modal over whatever tab is active, so logging is always one tap away.

This shell should be built as part of Surface 4 (the first of the two to be built) and host the Insights tab when Surface 5 lands.

## Surface 1 — Recipe Detail + Edit (Nutrition Section)

**Depends on:** backfill data (in progress) + `nutrition` model. **Buildable now in parallel with backfill** (it's display + edit, not lookup).

### What it does
- On the recipe detail page, show a nutrition section: per-serving calories + the five macros, the `serving_size` label, and a **trust indicator** showing `source` and `confidence` (e.g. a small badge: "USDA · high", "estimated · low").
- In **edit mode**, expose a **servings field**. When the user sets/changes it, per-serving values recompute live from the stored whole-recipe `total` (`total / servings`), and `serving_size` updates. This is how defaulted-to-4 and missing-servings recipes get corrected over time.
- If a recipe has no `nutrition` object yet, show an empty state with a "Calculate nutrition" action (calls the shared engine via Surface-2/engine route once available).

### User stories
- As the user, I want to see per-serving macros on a recipe so I know what I'm about to eat.
- As the user, I want to see whether a number is authoritative or estimated so I know how much to trust it.
- As the user, I want to enter the real servings count on a recipe whose servings were assumed, so its per-serving nutrition becomes accurate.

### Acceptance criteria
- [ ] Given a recipe with a `nutrition` object, detail page shows all six values per serving + source/confidence badge.
- [ ] Given a recipe with `confidence: low` and `+default_servings`, the badge/label makes clear servings were assumed.
- [ ] Given edit mode, when servings is changed, per-serving values recompute from `total` without a re-fetch and persist on save.
- [ ] Given a recipe with no nutrition, detail page shows an empty state, not zeros or errors.

### ⚠️ Inspection note
Lead the Claude Code prompt with reading the actual recipe schema (field names for id, ingredients, servings, source URL) per the inspect-before-writing principle. Field names are not predictable.

---

## Surface 2 — Cooked Capture (Cooking Mode + Plan Integration)

**Depends on:** `consumption_log` model + Surface 1. **⚠️ Requires plan-schema inspection first.**

### What it does
- Add a "Mark as cooked" action at the end of **Cooking Mode** (the existing full-screen cook flow) and tie it to the existing **plan page checkmark** so they're one system:
  - Marking cooked in Cooking Mode marks the recipe cooked on the plan page.
  - If the recipe is already on this week's plan → update that plan item to cooked.
  - If it's not planned → auto-add it to the plan's "cooked" section.
- On marking cooked, prompt for **servings eaten**, then write a `consumption_log` entry with `is_cook_event: true`, `type: "recipe"`, and a nutrition **snapshot** (per-serving × servings_eaten).

### User stories
- As the user, when I finish cooking in Cooking Mode, I want to mark it cooked and have it reflected on my plan, so I don't track in two places.
- As the user, I want to record how many servings I ate when I mark something cooked, so my consumption totals are accurate.

### Acceptance criteria
- [ ] Given a planned recipe, when marked cooked, the existing plan item updates to cooked (using the real field discovered via inspection).
- [ ] Given an unplanned recipe, when marked cooked, it is added to the plan's cooked section.
- [ ] Marking cooked writes exactly one `consumption_log` entry with `is_cook_event: true` and a snapshot.
- [ ] Editing the recipe afterward does not change the logged entry.

### ⚠️ Inspection note (BLOCKING)
The Claude Code prompt MUST begin by reading the plan item schema and reporting what the existing "cooked" checkmark writes today, before writing any code. Do not assume field names or that a "cooked section" exists.

---

## Surface 3 — Quick / Manual Food Entry

**Depends on:** shared lookup engine + `consumption_log`.

### What it does
- A "log food" entry point (lives in the Today view, Surface 4) for non-recipe consumption.
- **Name path:** user types "Big Mac" → engine looks up USDA → returns macros (or AI estimate if unresolved) → user confirms servings → writes a `consumption_log` entry (`type: "quick_food"`, `is_cook_event: false`).
- **Manual path:** user enters macros directly → entry written with `source: "manual"`.
- **Log-a-recipe-serving path:** user picks one of their own recipes and a serving count → entry written (`type: "recipe"`, `is_cook_event: false`, snapshot from recipe). Does NOT increment cooked count or touch the plan.

### User stories
- As the user, I want to log a Big Mac without creating a recipe, so eating out is still tracked.
- As the user, I want to log leftovers of a recipe I already cooked, without it counting as cooking it again.
- As the user, I want to hand-enter macros when lookup fails, so nothing is untrackable.

### Acceptance criteria
- [ ] Given a typed food name, returns macros with source tagged, or an AI estimate, or lets the user enter manually.
- [ ] Logging a recipe serving here writes `is_cook_event: false` and does not change plan/cooked state.
- [ ] All three paths write a snapshot to `consumption_log` with correct `type` and `source`.

---

## Surface 4 — Today View

**Depends on:** `consumption_log` + `goals` + Surface 3.

### What it does
- Default tab of the Nutrition page. Shows everything consumed **today**: log entries **grouped by meal** (breakfast / lunch / snack / dinner), each with per-entry macros and a source badge; cook-events carry a "cooked" tag to distinguish "I made this" from "I ate this."
- Today's totals vs. **daily goals** as rings, using floor/ceiling logic: protein & fiber are floors (fill toward target, behind = red); calories, fat, sugar are ceilings (over = red). (Sugar-as-ceiling is the assumed default — see open questions.)
- Hosts the persistent "＋ Log food" button (header) which opens the Surface-3 entry sheet.
- Entries are editable/deletable (correct a servings count, remove a mistaken entry).

### User stories
- As the user, I want to see what I've eaten today and how it stacks against my goals, so I can decide what to eat next.
- As the user, I want to add a non-meal food to today quickly, so my daily total is complete.

### Acceptance criteria
- [ ] Given today's log entries, shows each entry grouped by meal + correct running totals for all six nutrients.
- [ ] Shows consumed-vs-goal rings using the `goals` doc, with floor/ceiling color logic.
- [ ] Adding/editing/deleting an entry updates totals and rings immediately.
- [ ] The "＋ Log food" button is reachable from both Today and Insights tabs.
- [ ] Empty state (nothing logged today) is handled gracefully.

---

## Surface 5 — Insights Dashboard

**Depends on:** `consumption_log` + `goals` + Surface 4 (needs real logged data to be meaningful — build last).

### What it does
- Range selector: **week (default), month, YTD, custom**.
- For the selected range: total consumed per nutrient, and **goal attainment** = total vs. (daily goal × days), with **elapsed-vs-remaining** handling so a mid-week view reads "on track" correctly rather than appearing to fail until the period ends.
- **Donut graph filtered by nutrient.** Select a nutrient (e.g. protein) → donut shows **which foods/recipes contributed that nutrient** (e.g. "Chicken Tacos 40g, Big Mac 25g, …"), with an accompanying ranked table of the top contributing foods. (Data provenance — usda vs. ai vs. recipe — is available as a secondary detail, not the primary slice.)
- Goals/thresholds are a supporting element here; the dashboard's primary job is: how much did I consume, did I hit goals, and which foods drove each nutrient.

### User stories
- As the user, I want to see weekly/monthly consumption vs. compounded goals, so I know if I'm on track over time.
- As the user, I want to filter by a nutrient and see which foods gave me the most of it, so I understand my intake sources.

### Acceptance criteria
- [ ] Given a range, shows totals per nutrient and attainment vs. (daily goal × days in range).
- [ ] Mid-period, attainment accounts for elapsed days (does not show a full-period shortfall on day 2 of 7).
- [ ] Selecting a nutrient redraws the donut + table to that nutrient's top food/recipe contributors.
- [ ] Custom date range produces correct totals and attainment.
- [ ] Empty/sparse ranges are handled (no logged data → clear empty state).

---

## Build Sequence & Tooling

| Order | Surface | Tool | Gated by |
|---|---|---|---|
| 0 | Nutrition backfill (data) | **Cowork** (in progress) | — |
| 1 | Shared lookup engine (server route) | Claude Code | engine logic from backfill |
| 2 | Recipe detail + edit nutrition | Claude Code | backfill data, `nutrition` model — *buildable in parallel now* |
| 3 | Consumption log + goals models + cooked capture | Claude Code | #1, ⚠️ plan-schema inspection |
| 4 | Quick / manual food entry | Claude Code | #1, log model |
| 5 | Today view | Claude Code | #3, #4 |
| 6 | Insights dashboard | Claude Code | #3, #4 (real data) |

Each Claude Code prompt is single-feature, includes the standard build rules verbatim (work on main; merge any auto-branch before pushing; `npm run build` must pass; stop after 3 build failures and output the log), defines its output report format, and — for surfaces 2 and 3/recipe-edit — leads with a read-only schema inspection step.

## Open Questions

- **(Engineering / inspection)** What does the existing plan "cooked" checkmark write, and does a plan "cooked section" already exist? — BLOCKING for Surface 2.
- **(Engineering / inspection)** Exact recipe schema field names (id, ingredients, servings, source URL)? — needed for Surface 1.
- **(Product)** Should `sugar_g` be treated as a ceiling (warn when exceeded) rather than a floor goal? — non-blocking, affects Surface 4/5 display.
- **(Product)** Should the engine's "Calculate nutrition" action on Surface 1 be available for recipes the backfill skipped, or is backfill the only population path? — non-blocking.

## Future Considerations (P2 — design to allow, don't build)

- Barcode / packaged-product scanning for quick-food entry.
- Micronutrients (vitamins, minerals, sodium, cholesterol) — schema already nests macros so adding fields is non-breaking.
- Per-day-of-week or goal-cycling targets (current `goals` is a single daily set).
- Trends across multiple periods (e.g. week-over-week protein) beyond the single-range view.
