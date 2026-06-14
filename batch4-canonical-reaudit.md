# Batch 4 — Canonical Staples Table · INDEPENDENT ADVERSARIAL RE-AUDIT

> READ-ONLY verification of the committed table (`lib/canonicalStaples.ts`, commit
> 64a45c0) re-derived from the LIVE USDA FoodData Central API (not the committed
> verify-log). **No code changed, no Firestore writes, nothing applied.** Findings
> are flagged for the human to decide — no entry was "fixed".
>
> Evidence scripts (uncommitted, reproducible): `scripts/reaudit-canonical.js`
> (Task 1, live re-fetch of all 123 fdcIds → `scripts/reaudit-task1.json`),
> `scripts/reaudit-homographs.js` (Task 3 matcher harness, verbatim logic).

## VERDICT (TL;DR)

**NOT safe to apply as-is.** The FDC IDs and macros are all solid (Task 1: 123/123
real, correct dataType, macros match live exactly — 0 drift). The problem is the
**matcher/alias layer**: several aliases collapse to an over-generic single token and
hijack ingredients the *existing* fuzzy matcher already resolved correctly. This would
**regress ~13 catalog recipes** if applied. Safe after fixing **3 must-fix items**
(below); **~6 latent items** should also be fixed to prevent future mis-resolution.

---

## TASK 1 — Live re-verification of all 123 entries

Method: for each committed entry, fetch `GET /v1/food/{fdcId}` live and compare the
stored description / dataType / per-100g macros to what the API returns NOW.

| Check | Result |
|---|---|
| fdcId resolves to the stored food (no ID drift) | **123/123 OK** |
| dataType is SR Legacy / Foundation (no Branded) | **123/123 OK** (118 SR Legacy, 5 Foundation) |
| stored per-100g macros == live macros now (no stale/hand-edited values) | **123/123 MATCH** |
| plain-form heuristic | 119 clean; **4 false-positive flags** (below) |

**The 4 "flags" are all substring false-positives of my heuristic, not real problems:**

| entry | live description | why it's a FALSE positive |
|---|---|---|
| dijon mustard | "Mustard, prepared, yellow" | "prepared" = *prepared mustard* = the correct base (vs mustard seed/powder) |
| bacon | "Pork, cured, bacon, **un**prepared" | "unprepared" = raw = correct (substring hit on "prepared") |
| sweet potato | "Sweet potato, raw, **un**prepared …" | raw/unprepared = correct (substring hit) |
| mushroom | "Mushroom, white, exposed to ultraviolet **light**, raw" | "light" is from "ultraviolet light", not a low-fat product |

**Task 1 conclusion: every FDC ID is real, current, the right dataType, and the baked
macros are faithful to the live API. The original build's IDs/macros are corroborated
by independent re-derivation.** All defects found are in the *matching* layer (Task 3).

---

## TASK 2 — Targeted scrutiny of the previously-flagged entries

All confirmed against the live API; every flagged delta is a genuine **correction of a
pre-existing fuzzy-matcher error**, not a bad canonical match.

| item | live canonical entry | the delta is explained by… | verdict |
|---|---|---|---|
| **sweet potato** | `168482` "Sweet potato, raw, unprepared" (4.2 g sug/100g) | baseline mis-matched "yam sweet potato cubes" → **"Sweet potato *leaves*, raw"** (0 sug). Canonical fixes leaves→tuber. | ✅ correct |
| **coconut milk** | `170172` "Nuts, coconut milk, raw (liquid expressed from grated meat and water)" — full-fat **unsweetened** (230 kcal, 23.8 g fat, 3.3 g sug/100g) | Tom Kha Gai: baseline matched coconut milk → **"Cream, sour"** (0 sug); Cauliflower Curry: → **"Puddings, coconut cream, dry mix"**. Canonical fixes both. Not a sweetened/beverage variant. | ✅ correct (note: SR-Legacy "raw expressed" form ≈ canned full-fat; appropriate) |
| **eggs** | `171287` "Egg, whole, raw, fresh" (0.4 g sug/100g) | Hard-Boiled Eggs −29.3 g sugar: baseline matched "eggs" → **"Egg, white, *dried*"** (5.4 g sug, concentrated). Canonical fixes dried-white→whole-egg. | ✅ correct |

**High-frequency staples (widest blast radius) — all confirmed correct plain base forms:**
olive oil `171413` (884/100% fat) · butter `173430` "without salt" · ground beef `174036`
"80/20 raw" · chicken breast `171077` "skinless boneless meat only raw" · chicken thigh
`173627` "thigh meat only raw" · tomato paste `170459` "canned, without salt added" (12.2 sug)
· pasta `169736` "dry, enriched" · white rice `168877` "long-grain raw enriched" · whole
milk `171265` "3.25% milkfat" · black beans `175188` / kidney `173741` / chickpeas `173800`
(drained) / pinto `175201` / cannellini `175204` — **all canned, plain**. No issues.

---

## TASK 3 — Adversarial homograph / wrong-match sweep

Matcher replicated verbatim (`keyTokens` + `matchCanonicalStaple` + real guards), run on
adversarial phrasings AND cross-checked against every canonical resolution in the live
catalog (1,477 resolutions across 195 recomputed recipes).

### 🔴 MUST-FIX — catalog-real regressions (canonical is WORSE than the existing matcher)

**M1. Ground-meat bare-protein catch-all — 11 recipes (HIGH severity).**
Root cause: aliases `"minced beef"`→`{beef}`, `"minced pork"`→`{pork}`, `"minced turkey"`→`{turkey}`
collapse to the bare protein noun, because `minced` is a stripped DESCRIPTOR_WORD. The
ground-meat entries therefore match **any** "beef …"/"pork …" cut and override the baseline's
correct specific-cut match. All 11 below were CHANGED by canonical vs baseline:

| recipe | ingredient (g) | baseline (existing matcher) → canonical | impact |
|---|---|---|---|
| Slow Cooker Beef Brisket | "beef brisket" (1750g) | corned-beef brisket → **ground beef 80/20** | over-counts (brisket lean ≪ 254) ×1750g |
| Texas-Style Chili con Carne | "beef chuck" (1814g) | beef chuck for stew → **ground beef** | accidental |
| Korean Bulgogi Beef Bowls | "ribeye sirloin beef" (454g) | top sirloin steak (~130) → **ground beef (254)** | ~2× cal over-count |
| Pepper Steak | "beef flank skirt steak" (454g) | flank steak lean (~120) → **ground beef (254)** | ~2× cal over-count |
| Easy Slow Cooker Pot Roast | "dry beef gravy mix" (34g) | **Gravy, onion, dry mix** → **ground beef** | wrong category |
| Instant Pot BBQ Pulled Pork | "pork shoulder" (1814g) | pork shoulder lean → **ground pork** | accidental |
| Slow Cooker Carnitas | "pork butt roast" (1361g) | pork shoulder Boston butt → **ground pork** | accidental |
| Pulled pork | "pork shoulder pork butt" (1588g) | pork shoulder → **ground pork** | accidental |
| Pressure-Cooker Pork Posole | "pork shoulder" (227g) | pork shoulder lean → **ground pork** | accidental |
| Chicken Paprikash | "pork lard" (28g) | salt pork (~700) → **ground pork (263)** | under-count (small qty) |
| Pork Fried Rice | "pork - /" (237g) | (unresolved) → ground pork | guess (baseline gave nothing) |

> Note: for fatty pork shoulder the macro is *coincidentally* near ground pork, but the
> resolution is by accident and overrides a more-specific baseline. For lean beef cuts
> (sirloin/flank/brisket) at 0.45–1.8 kg it's a clear, large over-count.
>
> Proposed fix (DO NOT APPLY): drop the `"minced …"` aliases (require `{ground, X}` 2-token
> match) and/or add a guard to the ground-meat entries vetoing
> `/\b(brisket|chuck|sirloin|loin|steak|roast|shoulder|tenderloin|lard|gravy|ribeye|flank|skirt|butt|shank|rib|chop)\b/i`.
> "minced beef/pork" would then fall through to the (correct) fuzzy matcher.

**M2. `half and half` degenerate `{half}` catch-all — 4 spurious cream matches (MED-HIGH).**
Root cause: `"half and half"` and `"half-and-half"` both tokenize to `['half','half']`
(`and` is a stripped descriptor; the hyphen splits) — so the entry matches **any fragment
containing the word "half"**, and the duplicate inflates its score to 2 (beating single-token
competitors). The parser's comma-segment heuristic emits prep fragments as food-names, which
this entry then turns into half-and-half **cream**:

| recipe | fragment (g) | baseline → canonical | regression? |
|---|---|---|---|
| Mediterranean Grilled Salmon | "one tomato in half" (160g) | **Tomatoes, canned** → **Cream, half-and-half** | ✗ YES (tomato→cream) |
| Mediterranean Grilled Salmon | "one lemon- in half" (84g) | Lemon peel → **Cream, half-and-half** | ✗ YES (lemon→cream) |
| Chicken Gyro Chopped Salad | "horizontally in half" (454g) | half-and-half → half-and-half | pre-existing (baseline also wrong) |
| Smashed Zucchini w/ Chickpeas | "stemmed -inch-thick half-moons" (14g) | half-and-half → half-and-half | pre-existing |

(The 2 *legitimate* half-and-half uses — "half half", "half-and-half" — resolve correctly.)
> Proposed fix (DO NOT APPLY): this entry can't be made specific via aliases (keyTokens always
> collapses it to `{half}`). Either drop the `half and half` canonical entry (the fuzzy matcher
> handled the real cases) or special-case it. The deeper cause (parser turning "cut in half"
> into a food-name) is a `parseIngredientLine` issue, out of scope here.

**M3. `cream of mushroom soup` → raw mushroom — 1 recipe (MED).**
Slow Cooker Minnesota Pork Chop Casserole: "cream mushroom soup" (595g) — **baseline correctly
matched "Soup, cream of mushroom, canned, condensed"**, but the canonical bare `mushroom`
alias (no guard) hijacked it to **"Mushroom, white, raw"**. canonicalΔ = **−563 cal** (per-serving
960 → 672). A clear regression.
> Proposed fix (DO NOT APPLY): guard the mushroom entry, e.g. `/\b(soup|cream|gravy|dried|sauce)\b/i`.

### 🟡 SHOULD-FIX — latent (NOT in the current catalog, but real matcher bugs)

These do not affect the current 210 recipes (verified by content scan + resolution scan) but
will mis-resolve future recipes:

- **`oats`→`{oat}` (rolled oats, no guard):** "oat milk"/"oat flour" → rolled oats (382 kcal).
  Two recipes (*Peanut Butter Oat Protein Shake*, *Smoothies*) DO contain "oat milk" but both
  currently **error out** ("no parseable ingredient list"), so the bug is dormant — it would
  activate if those recipes ever parse. Fix: guard `/\b(milk|flour|bran|cake|cookie|bar|granola)\b/i`.
- **crushed-tomatoes alias `"whole peeled tomatoes"`→`{tomato}` (degenerate):** makes
  crushed-tomatoes a `{tomato}` catch-all. Effects: plain "tomatoes" now **ties** (fresh vs
  crushed) → falls through (benign miss), and "sun-dried tomatoes"/"tomato soup" → crushed
  tomatoes (fresh is guarded, crushed is not). Not in catalog. Fix: drop that alias; optionally
  guard crushed against `/\b(sun[- ]?dried|dried|soup|paste)\b/i`.
- **egg guard plural miss:** `\bwhite\b` does not match "white**s**", so "egg whites" → whole egg
  (143 vs 52 kcal). The 1 catalog "egg white" is singular and correctly vetoed. Fix: `whites?`/`yolks?`.
- **`banana`→`{banana}` (no guard):** "banana pepper" (a vegetable) → banana. Not in catalog.
  Fix: guard `/\b(pepper|bread|squash)\b/i`.
- **pasta guard defanged by descriptor-strip:** "fresh pasta"/"whole wheat pasta" → dry pasta
  (the guard words `fresh`/`whole` are stripped before the guard runs). Macros are close; not in
  catalog. (Same mechanism makes the flour `whole-wheat` guard moot, but the dedicated
  whole-wheat-flour entry wins by specificity, so flour is safe.)
- **`noodles`→`{noodl}` (egg noodles, no guard):** any "X noodles" → egg noodles. "rice noodles"
  is ≈ macro-equivalent (dry); soba/udon/ramen would differ. Low impact.

### ✅ Confirmed solid (no action)

- All earlier-fixed guards hold: "sugar snap peas", "almond butter", "corn tortillas",
  "cauliflower rice", "almond/oat/soy milk", "coconut sugar" all correctly fall through.
- 1,477 catalog resolutions scanned: besides M1–M3, no other semantic category mismatches.

---

## TASK 4 — Verdict & enumerated fix list

**Recommendation: SAFE-AFTER-FIXING.** Do **not** run the catalog-wide apply yet. The data
(fdcId + macros) is trustworthy; the alias/matcher layer needs 3 fixes first.

**Must-fix before apply (catalog-real regressions, ~13 recipes):**
1. **Ground-meat bare-protein aliases** (`minced beef/pork/turkey` → `{beef}/{pork}/{turkey}`) — 11 recipes regressed. Drop the "minced …" aliases and/or add a cut-name guard.
2. **`half and half` degenerate `{half}` alias** — 4 spurious cream matches (2 regressions). Drop/neutralize the entry.
3. **`mushroom` missing guard** — "cream of mushroom soup" regression (1 recipe). Add `soup|cream|gravy|sauce|dried` guard.

**Should-fix (latent, prevent future mis-resolution):**
4. rolled-oats guard (`oat milk`/`oat flour`).
5. crushed-tomatoes degenerate `whole peeled tomatoes` alias + guard.
6. egg guard plural (`whites?`/`yolks?`).
7. banana guard (`pepper|bread|squash`).
8. pasta `fresh`/`whole wheat` (descriptor-stripped guard) — minor.
9. `noodles` alias breadth — minor.

**Systemic note for the maintainer:** the recurring root cause is **aliases whose
distinguishing word is a DESCRIPTOR_WORD** (`minced`, `and`, `whole`, `peeled`, `fresh`) — those
words are stripped by `keyTokens`/`parseIngredientLine` *before* matching, collapsing the alias
to a bare token and defanging guards that rely on the same words. A good generator-side check:
flag any alias whose `keyTokens()` length is 1 (or whose tokens are all common non-food words),
and any guard term that is itself a DESCRIPTOR_WORD. (`scripts/reaudit-homographs.js` lists all
single-token aliases.)

---

## Confirmation

- **READ-ONLY.** No code was changed. `lib/canonicalStaples.ts` and `lib/nutritionEngine.ts`
  are untouched. No Firestore writes. Nothing applied. No commits.
- Verified against the **live USDA API** (123 detail fetches) and the live Firestore catalog
  (read-only), not the committed verify-log.
- Audit evidence scripts are uncommitted local files (`scripts/reaudit-*.js`,
  `scripts/reaudit-task1.json`).
