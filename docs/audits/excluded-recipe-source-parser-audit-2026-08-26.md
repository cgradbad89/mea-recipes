# Excluded Recipe Source/Parser Remediation Audit — 2026-08-26

## Executive result

**READY FOR REMEDIATION DESIGN.** All 49 manifest-defined exclusions were reviewed against current raw production content and the canonical parser. A hybrid architecture is supported: six conservative parser rules repair 28 parser-only recipes without changing any of the 187 mapped recipes; six mixed recipes need those parser rules plus source-data cleanup; the remaining 15 require data repair, source recovery, or owner decisions.

## Corpus summary

- Shared recipes: **236**
- Persisted-map recipes: **187**
- Excluded/unmapped recipes: **49**
- Manifest exclusions reviewed: **49 / 49**
- Primary defect counts: SOURCE_DEFECT **15**, PARSER_DEFECT **28**, SOURCE_AND_PARSER_DEFECT **6**
- Dispositions: PARSER_FIX_ONLY **28**, DATA_FIX_ONLY **7**, PARSER_AND_DATA_FIX **6**, REIMPORT_REQUIRED **5**, MANUAL_SOURCE_REQUIRED **1**, PRODUCT_DECISION_REQUIRED **2**
- Production mutation: **none**

## Exclusion classes

### Source URLs (24)

All 24 are plain standalone HTTP(S) lines at the end of the raw instruction span; none uses Markdown, brackets, or a Source label. The current parser makes each the final instruction. Standalone URL suppression changes all 24 exclusions and **0/187** mapped recipes. Eighteen become parser-clean when combined with the exact page-control filter for Vegetarian Skillet Chili. Six also contain mixed-in storage/tip/note material and therefore require source cleanup: Chicken Enchiladas, Chicken Stew, Couscous Salad With Lime Basil Vinaigrette, Creamy Cauliflower Soup With Rosemary Olive Oil, Pepper Steak, and Pork Fried Rice.

### Review/comment chrome (5)

Four recipes expose exact structural markers (Have you cooked this?, COOKING NOTES, or Comment). Peruvian Roasted Chicken has a bounded author/date line (Anthony4 years ago) before the copied review. The precise terminal rule changes all five exclusions and **0/187** mapped recipes while preserving preceding Tips. A generic first-person rule is rejected: it cuts valid recipe/source notes and does not reliably remove preceding chrome.

### Metadata and notes (8)

- **Page metadata:** nutrition blocks, exact nutritional-information copy, source attribution.
- **Useful recipe notes:** storage/reheating, make-ahead, substitutions, variations, and safety guidance.
- **Actionable cooking steps:** the method preceding those blocks; the Peruvian pepper-handling safety note remains useful guidance and is deliberately retained.

Exact footer metadata rules safely repair Chinese Chili Oil, Peanut Butter Oat Protein Shake, and Peruvian Chicken w/ Green Sauce with zero mapped changes. Chana Masala, Easy Chicken Ramen, Lemongrass Chicken, and Tuscan Bean Soup should be data-re-serialized because their NOTES blocks contain useful guidance. Zesty Quinoa Salad is not a footer-only defect: its stored method belongs to another recipe and requires re-import.

### No ingredients, no instructions, paywall, and structural defects

- **Maple Roasted Candied Pecans** (`maple-roasted-candied-pecans`) — The complete stored content is exactly “Source:” with no URL, ingredients or instructions. Disposition: **MANUAL_SOURCE_REQUIRED**.
- **Smoothies** (`smoothies`) — Raw content contains three independently titled smoothies, three decorated Ingredients headings, nutrition/taste metadata, and no explicit method; the single-recipe parser intentionally rejects multiple ingredient sections. Disposition: **PRODUCT_DECISION_REQUIRED**.
- **Crunchy Queso Wrap** (`crunchy-queso-wrap`) — Raw content has six sequential Step 1–Step 6 directions immediately after the ingredient list, but no recognized instruction heading, so instructions[] is empty. Disposition: **PARSER_FIX_ONLY**.
- **Dad's Chili** (`dads-chili`) — Raw content contains a long ingredient list and seven direction paragraphs, but no instruction heading; the 20-line ingredient-only horizon also truncates the parsed ingredient list. Disposition: **DATA_FIX_ONLY**.
- **Filipino Brased Chicken Tocino** (`filipino-brased-chicken-tocino`) — Raw content has complete action lines under exact PREP and ON THE STOVE phase headings; PREP currently terminates ingredients but is not accepted as instruction start. Disposition: **PARSER_FIX_ONLY**.
- **Mexican Street Corn** (`mexican-street-corn`) — Stored content contains a source URL and eight usable ingredients but no method text. Disposition: **REIMPORT_REQUIRED**.
- **Rising Sun - Mazcal** (`rising-sun-mazcal`) — Stored content contains a source URL and six usable cocktail ingredients but no method text. Disposition: **REIMPORT_REQUIRED**.
- **Speget with fake meat meatballs** (`speget-with-fake-meat-meatballs`) — Stored content has no method heading or directions; a bare “broccoli” line is unquantified and its role is unsupported. A NYT source URL is present. Disposition: **REIMPORT_REQUIRED**.
- **Spaghetti Carbonara** (`spaghetti-carbonara`) — Stored content explicitly labels the six-item ingredient list partial and contains only a NYT paywall-unavailable placeholder as the method. Disposition: **REIMPORT_REQUIRED**.
- **Chipotle Tahini Bowls** (`chipotle-tahini-bowls`) — Ingredients 0–6 are the quantified Chipotle Tahini sauce. “Build the Bowls:” is a subheader; sweet potato, eggs, kale, quinoa, avocado and “Anything else” are options, while notes contain optional component recipes/quantities. Disposition: **PRODUCT_DECISION_REQUIRED**.
- **Lemon Herb Pasta Salad with Marinated Chickpeas** (`lemon-herb-pasta-salad-with-marinated-chickpeas`) — “one 14 ounce can chickpeas, drained and rinsed” exists in raw content under “Marinated Chickpeas” before the sole INGREDIENTS heading, so the parser never sees it; quantity is fully recoverable. Disposition: **DATA_FIX_ONLY**.
- **Mole Poblano** (`mole-poblano`) — Current instruction 1 is the presentation label “For the Mole Sauce”; 0 and 2–17 are actions; 18 is storage guidance; 19–21 are NOTES/tips; raw source otherwise supports the method. Disposition: **DATA_FIX_ONLY**.

## Parser architecture findings

- Ingredient starts: one and only one recognized top-level heading from INGREDIENTS / WHAT YOU NEED / YOU WILL NEED / SHOPPING LIST; multiple headings intentionally refuse composite collapse.
- Ingredient ends: the first recognized instruction heading, or a 20-line fallback horizon. Existing filters handle exact metadata/control lines, bare URLs, audited subheaders, NOTES/PREP/ON THE STOVE boundaries, and two exact terminal page blocks.
- Instruction starts: the first INSTRUCTIONS / PREPARATION / DIRECTIONS / METHOD / STEPS / HOW TO MAKE heading.
- Instruction ends: **end of document only**. There is no instruction URL filter or terminal model.
- Instruction filtering: trim blank lines, require >10 characters before and after stripping Step N; short structural markers disappear without terminating the span.
- Consequence: URLs, reviews, notes, nutrition, storage, and page chrome pass through; PREP-only and Step-1-only methods never start.

## Safe systemic parser opportunities

| Candidate rule | Exclusions improved | Fully repaired alone | Clean/mapped recipes changed | Mapped hashes changed | Risk | Recommendation |
|---|---:|---:|---:|---:|---|---|
| `STANDALONE_URL_FILTER` | 24 | 17 | 0 | 0 | LOW | IMPLEMENT — Every match is a complete standalone URL line; no mapped recipe contains one in instructions. |
| `REVIEW_COMMENT_TERMINATORS` | 5 | 5 | 0 | 0 | LOW | IMPLEMENT — Uses explicit chrome or an anchored author/date line, preserves preceding Tips, and changes no mapped recipe. |
| `GENERIC_FIRST_PERSON_BOUNDARY` | 5 | 0 | 0 | 0 | HIGH | REJECT — Misclassifies valid recipe/source guidance and still leaves preceding chrome; first-person prose is not review evidence. |
| `TIP_TERMINATOR` | 6 | 0 | 4 | 4 | HIGH | REJECT — Removes valid alternate cooking methods and preparation guidance from mapped recipes. |
| `NOTES_TERMINATOR` | 7 | 5 | 9 | 9 | HIGH | REJECT — Changes nine mapped source hashes and removes useful/actionable notes, including alternate cooking methods. |
| `EXPLICIT_FOOTER_METADATA` | 5 | 3 | 0 | 0 | LOW | IMPLEMENT — Evidence-bound labels change no mapped recipe; generic Note/Storage prose is not matched. |
| `PAGE_CHROME_FILTER` | 1 | 0 | 0 | 0 | LOW | IMPLEMENT — Exact source-page controls only; changes no mapped recipe. |
| `PREP_HEADING_FALLBACK` | 1 | 1 | 0 | 0 | LOW | IMPLEMENT — Activates only when no normal instruction heading exists and changes no mapped recipe. |
| `NUMBERED_STEP_FALLBACK` | 1 | 1 | 0 | 0 | LOW | IMPLEMENT — Activates only without a normal instruction heading; implementation must validate a sequential numbered-step run. |

The recommended global package is: standalone URL suppression; precise review/comment terminators; exact footer metadata handling; exact page-control filtering; conservative PREP-phase fallback; and conservative sequential Step-1 fallback. Combined, it fully repairs the 28 PARSER_FIX_ONLY recipes and improves all six mixed URL recipes. It changes **0 parsed ingredients, 0 parsed instructions, and 0 source hashes** in the 187 mapped corpus.

Broad NOTES and Tip termination are rejected. NOTES changes nine mapped recipes and removes alternate methods, thickening guidance, serving steps, substitutions, and other useful content. Tip changes four mapped recipes and removes legitimate grilling/preparation directions. Both would cause meaningful parse changes and invalidate those persisted maps.

## Existing mapped-corpus risk

For every recommended rule: **187 NO_CHANGE / 0 SEMANTICALLY_EQUIVALENT_BUT_HASH_CHANGED / 0 MEANINGFUL_PARSE_CHANGE**. No recommended rule invalidates an existing persisted map. The rejected NOTES rule changes 9 mapped recipes and 9 source hashes; the rejected Tip rule changes 4 and 4. If a later implementation broadens any rule beyond the audited concepts, it must rerun the all-236 simulation and deliberately revalidate/migrate every changed mapped sourceHash.

## Recipe-level remediation table

| Recipe | Historical class | Primary defect | Disposition | Proposed repair |
|---|---|---|---|---|
| `chana-masala` | EXCLUDE_METADATA | SOURCE_DEFECT | DATA_FIX_ONLY | Re-serialize the existing six method lines as instructions and preserve the quoted NOTES material in a non-Cooking-Mode notes area; do not use a broad global NOTES terminator. |
| `chicken-enchiladas` | EXCLUDE_SOURCE_URL | SOURCE_AND_PARSER_DEFECT | PARSER_AND_DATA_FIX | Apply the safe standalone URL parser filter, then perform the recipe-specific existing-text split documented by this audit. |
| `chicken-fajitas` | EXCLUDE_SOURCE_URL | PARSER_DEFECT | PARSER_FIX_ONLY | Apply the standalone HTTP(S)-line instruction filter. |
| `chicken-paprikash` | EXCLUDE_SOURCE_URL | PARSER_DEFECT | PARSER_FIX_ONLY | Apply the standalone HTTP(S)-line instruction filter. |
| `chicken-stew` | EXCLUDE_SOURCE_URL | SOURCE_AND_PARSER_DEFECT | PARSER_AND_DATA_FIX | Apply the safe standalone URL parser filter, then perform the recipe-specific existing-text split documented by this audit. |
| `chicken-tacos-w-pineapple` | EXCLUDE_SOURCE_URL | PARSER_DEFECT | PARSER_FIX_ONLY | Apply the standalone HTTP(S)-line instruction filter. |
| `chimichurri-chicken` | EXCLUDE_REVIEW_COMMENT | PARSER_DEFECT | PARSER_FIX_ONLY | Apply the precise review/comment terminal-boundary rule; never classify generic first-person prose alone as review chrome. |
| `chinese-chili-oil` | EXCLUDE_METADATA | PARSER_DEFECT | PARSER_FIX_ONLY | Add the exact storage-label terminal rule from the zero-collateral footer simulation. |
| `chipotle-tahini-bowls` | EXCLUDE_STRUCTURAL_DEFECT | SOURCE_DEFECT | PRODUCT_DECISION_REQUIRED | Owner must choose sauce-only, configurable template, or a fixed bowl composition; then re-serialize only supported existing source text and quantities. |
| `couscous-salad-with-lime-basil-vinaigrette` | EXCLUDE_SOURCE_URL | SOURCE_AND_PARSER_DEFECT | PARSER_AND_DATA_FIX | Apply the safe standalone URL parser filter, then perform the recipe-specific existing-text split documented by this audit. |
| `crazy-good-dal-adas-spicy-red-lentil-tamarind-soup` | EXCLUDE_SOURCE_URL | PARSER_DEFECT | PARSER_FIX_ONLY | Apply the standalone HTTP(S)-line instruction filter. |
| `creamy-cauliflower-soup-with-rosemary-olive-oil` | EXCLUDE_SOURCE_URL | SOURCE_AND_PARSER_DEFECT | PARSER_AND_DATA_FIX | Apply the safe standalone URL parser filter, then perform the recipe-specific existing-text split documented by this audit. |
| `crisp-gnocchi-with-brussels-sprouts-and-brown-butter` | EXCLUDE_SOURCE_URL | PARSER_DEFECT | PARSER_FIX_ONLY | Apply the standalone HTTP(S)-line instruction filter. |
| `crispy-gnocchi-with-burst-tomatoes-and-mozzarella` | EXCLUDE_SOURCE_URL | PARSER_DEFECT | PARSER_FIX_ONLY | Apply the standalone HTTP(S)-line instruction filter. |
| `crispy-gnocchi-with-sausage-and-broccoli` | EXCLUDE_SOURCE_URL | PARSER_DEFECT | PARSER_FIX_ONLY | Apply the standalone HTTP(S)-line instruction filter. |
| `crunchy-queso-wrap` | EXCLUDE_NO_INSTRUCTIONS | PARSER_DEFECT | PARSER_FIX_ONLY | Add the conservative no-heading fallback: only when no instruction heading exists, start at an exact Step 1 followed by a valid numbered sequence. |
| `curried-red-bean-soup-with-kale` | EXCLUDE_REVIEW_COMMENT | PARSER_DEFECT | PARSER_FIX_ONLY | Apply the precise review/comment terminal-boundary rule; never classify generic first-person prose alone as review chrome. |
| `curry-tomatoes-and-chickpeas-with-cucumber-yogurt` | EXCLUDE_SOURCE_URL | PARSER_DEFECT | PARSER_FIX_ONLY | Apply the standalone HTTP(S)-line instruction filter. |
| `dads-chili` | EXCLUDE_NO_INSTRUCTIONS | SOURCE_DEFECT | DATA_FIX_ONLY | Insert the canonical instruction boundary before the existing “In a large pot…” paragraph and preserve the final author commentary as notes; use only existing text. |
| `easy-chicken-ramen` | EXCLUDE_METADATA | SOURCE_DEFECT | DATA_FIX_ONLY | Re-serialize existing method lines only; retain the existing Notes and Nutrition text outside instructions[]. |
| `filipino-brased-chicken-tocino` | EXCLUDE_NO_INSTRUCTIONS | PARSER_DEFECT | PARSER_FIX_ONLY | Recognize exact PREP as a conservative alternate instruction start and omit exact PREP/ON THE STOVE phase labels from instructions[]. |
| `huevos-rotos-broken-eggs` | EXCLUDE_REVIEW_COMMENT | PARSER_DEFECT | PARSER_FIX_ONLY | Apply the precise review/comment terminal-boundary rule; never classify generic first-person prose alone as review chrome. |
| `kung-pao-tofu` | EXCLUDE_SOURCE_URL | PARSER_DEFECT | PARSER_FIX_ONLY | Apply the standalone HTTP(S)-line instruction filter. |
| `lemon-herb-pasta-salad-with-marinated-chickpeas` | EXCLUDE_STRUCTURAL_DEFECT | SOURCE_DEFECT | DATA_FIX_ONLY | Mechanically rearrange the existing label and chickpea line under the canonical ingredient heading; no inference or external retrieval is needed. |
| `lemongrass-chicken` | EXCLUDE_METADATA | SOURCE_DEFECT | DATA_FIX_ONLY | Re-serialize the existing method and preserve the existing substitutions outside instructions[]. |
| `maple-roasted-candied-pecans` | EXCLUDE_NO_INGREDIENTS | SOURCE_DEFECT | MANUAL_SOURCE_REQUIRED | Obtain the original recipe text or a product-owner-approved trustworthy source; automatic reconstruction is impossible. |
| `mexican-street-corn` | EXCLUDE_NO_INSTRUCTIONS | SOURCE_DEFECT | REIMPORT_REQUIRED | Re-import the linked Serious Eats source or obtain user-provided source text; do not generate directions. |
| `mole-poblano` | EXCLUDE_STRUCTURAL_DEFECT | SOURCE_DEFECT | DATA_FIX_ONLY | Mechanically re-serialize existing action lines, preserve “For the Mole Sauce” as presentation structure, and retain storage/tips as notes. |
| `onepot-chicken-and-lentil` | EXCLUDE_SOURCE_URL | PARSER_DEFECT | PARSER_FIX_ONLY | Apply the standalone HTTP(S)-line instruction filter. |
| `onepot-chicken-and-rice-with-caramelized-lemon` | EXCLUDE_SOURCE_URL | PARSER_DEFECT | PARSER_FIX_ONLY | Apply the standalone HTTP(S)-line instruction filter. |
| `onepot-ratatouille-pasta` | EXCLUDE_SOURCE_URL | PARSER_DEFECT | PARSER_FIX_ONLY | Apply the standalone HTTP(S)-line instruction filter. |
| `peanut-butter-oat-protein-shake` | EXCLUDE_METADATA | PARSER_DEFECT | PARSER_FIX_ONLY | Use the exact Nutrition Estimate terminal rule from the zero-collateral footer simulation. |
| `pearl-couscous-with-creamy-feta-and-chickpeas-meh` | EXCLUDE_SOURCE_URL | PARSER_DEFECT | PARSER_FIX_ONLY | Apply the standalone HTTP(S)-line instruction filter. |
| `pepper-steak` | EXCLUDE_SOURCE_URL | SOURCE_AND_PARSER_DEFECT | PARSER_AND_DATA_FIX | Apply the safe standalone URL parser filter, then perform the recipe-specific existing-text split documented by this audit. |
| `peruvian-chicken-w-green-sauce` | EXCLUDE_METADATA | PARSER_DEFECT | PARSER_FIX_ONLY | Filter the exact nutritional-information note without treating every Note line as a terminator. |
| `peruvian-roasted-chicken-with-spicy-cilantro-sauce` | EXCLUDE_REVIEW_COMMENT | PARSER_DEFECT | PARSER_FIX_ONLY | Apply the precise review/comment terminal-boundary rule; never classify generic first-person prose alone as review chrome. |
| `pork-fried-rice` | EXCLUDE_SOURCE_URL | SOURCE_AND_PARSER_DEFECT | PARSER_AND_DATA_FIX | Apply the safe standalone URL parser filter, then perform the recipe-specific existing-text split documented by this audit. |
| `pozole-verde-wowza` | EXCLUDE_SOURCE_URL | PARSER_DEFECT | PARSER_FIX_ONLY | Apply the standalone HTTP(S)-line instruction filter. |
| `rising-sun-mazcal` | EXCLUDE_NO_INSTRUCTIONS | SOURCE_DEFECT | REIMPORT_REQUIRED | Re-import the linked Saveur source or obtain user-provided source text; do not infer cocktail technique. |
| `roasted-white-bean-and-tomato-pasta` | EXCLUDE_SOURCE_URL | PARSER_DEFECT | PARSER_FIX_ONLY | Apply the standalone HTTP(S)-line instruction filter. |
| `sheetpan-gochujang-chicken-and-roasted-vegetables` | EXCLUDE_SOURCE_URL | PARSER_DEFECT | PARSER_FIX_ONLY | Apply the standalone HTTP(S)-line instruction filter. |
| `smoothies` | EXCLUDE_NO_INGREDIENTS | SOURCE_DEFECT | PRODUCT_DECISION_REQUIRED | Choose whether to split into three recipes or retire/retain a composite note. Source directions must then be supplied; do not invent “blend” steps. |
| `spaghetti-carbonara` | EXCLUDE_PAYWALL | SOURCE_DEFECT | REIMPORT_REQUIRED | Use future authenticated bookmarklet DOM capture, paste user-provided recipe text, or obtain another owner-approved faithful source. Do not fabricate carbonara directions. |
| `speget-with-fake-meat-meatballs` | EXCLUDE_NO_INSTRUCTIONS | SOURCE_DEFECT | REIMPORT_REQUIRED | Recapture the linked source through authenticated DOM/text or obtain user-provided source text, then resolve the broccoli discrepancy. |
| `spicy-ovenfried-rice-with-gochujang-and-fried-eggs` | EXCLUDE_REVIEW_COMMENT | PARSER_DEFECT | PARSER_FIX_ONLY | Apply the precise review/comment terminal-boundary rule; never classify generic first-person prose alone as review chrome. |
| `tuscan-bean-soup` | EXCLUDE_METADATA | SOURCE_DEFECT | DATA_FIX_ONLY | Re-serialize existing method lines and preserve the two existing notes outside instructions[]. |
| `vegetarian-skillet-chili` | EXCLUDE_SOURCE_URL | PARSER_DEFECT | PARSER_FIX_ONLY | Apply standalone URL suppression plus the exact page-chrome filter. |
| `zesty-quinoa-salad` | EXCLUDE_METADATA | SOURCE_DEFECT | REIMPORT_REQUIRED | Re-import the linked Allrecipes source or obtain user-provided source text, then compare title, ingredients and method before replacing content. |
| `zibdiyit-gambari-spicy-shrimp-and-tomato-stew` | EXCLUDE_SOURCE_URL | PARSER_DEFECT | PARSER_FIX_ONLY | Apply the standalone HTTP(S)-line instruction filter. |

Full raw-tail evidence, parsed arrays, detected ingredient subheaders, boundaries, risk, verification, and unverifiable facts are in the companion JSON.

## Recommended implementation sequence

1. **Wave 1A — zero-collateral parser package:** implement the six recommended rules with corpus fixtures and exact all-236/mapped-hash assertions. Do not include generic NOTES, Tip, or first-person rules.
2. **Wave 1B — mixed URL recipes:** after URL suppression, split only the six documented storage/tip/note fragments using existing text; preserve notes outside Cooking Mode.
3. **Wave 2 — recoverable data repairs:** Chana Masala, Easy Chicken Ramen, Lemongrass Chicken, Tuscan Bean Soup, Dad’s Chili, Lemon Herb Pasta Salad, and Mole Poblano. Use only quoted/rearranged stored text.
4. **Wave 3 — source recovery:** re-import Zesty Quinoa Salad, Mexican Street Corn, Rising Sun Mezcal, Speget with Fake Meat Meatballs, and Spaghetti Carbonara; obtain a manual source for Maple Roasted Candied Pecans.
5. **Wave 4 — product decisions:** decide the canonical model for Smoothies and Chipotle Tahini Bowls before any content rewrite.

Each wave needs a new read-only source/parser audit before production content changes. No old v4 manifest candidate may be reused.

## Mapping follow-up

For each repaired recipe: repair/recapture source → parse cleanly → compute fresh sourceHash → deterministic-v4 → prompt-v2 only if eligible → semantic dry run/review → persist a newly reviewed source-bound map. The 49 recipes never had approved v4 candidates, so source repair cannot reuse an old manifest candidate.

## Unverifiable items

- `chipotle-tahini-bowls`: Canonical bowl quantities for kale, quinoa and avocado are absent.
- `chipotle-tahini-bowls`: The intended fixed versus configurable bowl is unresolved.
- `maple-roasted-candied-pecans`: Original source URL, ingredients, quantities and instructions are all absent.
- `mexican-street-corn`: The original method is absent from stored content.
- `rising-sun-mazcal`: The original cocktail method is absent from stored content.
- `smoothies`: No explicit preparation directions are stored.
- `smoothies`: The intended one-document versus three-recipe product model is unresolved.
- `spaghetti-carbonara`: Ingredient completeness and the entire original method cannot be verified from stored content.
- `speget-with-fake-meat-meatballs`: All original directions are absent.
- `speget-with-fake-meat-meatballs`: The quantity and intended role of broccoli cannot be reconstructed.
- `zesty-quinoa-salad`: The original zesty-quinoa-salad method is not present in stored content.

## Production mutation

None. The audit performed one read-only collection query (or deterministic local replay), no AI calls, no Firestore writes, no mapping generation, no backfill, and no deployment.
