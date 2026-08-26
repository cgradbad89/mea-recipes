# Excluded Recipe Parser Wave 1A Validation — 2026-08-26

## Executive result

**PASS WITH LIMITATION.** The six approved zero-collateral parser rules are implemented. The live
236-recipe before/after simulation found no unexpected changes, and all 187 persisted-map recipes
retained byte-identical ingredient arrays, instruction arrays, and canonical source hashes.

## Implemented rules

- Standalone absolute HTTP(S) instruction-line filtering.
- Exact review/comment terminal boundaries, including the audited author/date footer shape.
- Exact storage/nutrition/source footer metadata handling.
- Exact known page-control filtering.
- PREP + ON THE STOVE method fallback when no ordinary instruction heading exists.
- Sequential standalone Step 1…N method fallback when no ordinary instruction heading exists.

## Corpus impact

- Total recipes: **236**
- Persisted-map recipes: **187**
- Previously excluded recipes: **49**
- NO_CHANGE: **200**
- EXPECTED_EXCLUDED_REPAIR: **36**
- UNEXPECTED_CHANGE: **0**
- Mapped ingredient-array changes: **0**
- Mapped instruction-array changes: **0**
- Mapped sourceHash changes: **0**
- Existing mapped hash mismatches: **0**
- Parser-only repaired: **28**
- Still excluded: **21**
- Unexpected changes: **none**

## Recipe-level results

| Recipe | Before exclusion | After parse status | Remaining defect |
|---|---|---|---|
| `chana-masala` | EXCLUDE_METADATA | IMPROVED_STILL_EXCLUDED | notes_appended_to_instruction_section |
| `chicken-enchiladas` | EXCLUDE_SOURCE_URL | IMPROVED_STILL_EXCLUDED | standalone_url_plus_mixed_note_content |
| `chicken-fajitas` | EXCLUDE_SOURCE_URL | PARSE_CLEAN | None |
| `chicken-paprikash` | EXCLUDE_SOURCE_URL | PARSE_CLEAN | None |
| `chicken-stew` | EXCLUDE_SOURCE_URL | IMPROVED_STILL_EXCLUDED | standalone_url_plus_mixed_note_content |
| `chicken-tacos-w-pineapple` | EXCLUDE_SOURCE_URL | PARSE_CLEAN | None |
| `chimichurri-chicken` | EXCLUDE_REVIEW_COMMENT | PARSE_CLEAN | None |
| `chinese-chili-oil` | EXCLUDE_METADATA | PARSE_CLEAN | None |
| `couscous-salad-with-lime-basil-vinaigrette` | EXCLUDE_SOURCE_URL | IMPROVED_STILL_EXCLUDED | standalone_url_plus_mixed_note_content |
| `crazy-good-dal-adas-spicy-red-lentil-tamarind-soup` | EXCLUDE_SOURCE_URL | PARSE_CLEAN | None |
| `creamy-cauliflower-soup-with-rosemary-olive-oil` | EXCLUDE_SOURCE_URL | IMPROVED_STILL_EXCLUDED | standalone_url_plus_mixed_note_content |
| `crisp-gnocchi-with-brussels-sprouts-and-brown-butter` | EXCLUDE_SOURCE_URL | PARSE_CLEAN | None |
| `crispy-gnocchi-with-burst-tomatoes-and-mozzarella` | EXCLUDE_SOURCE_URL | PARSE_CLEAN | None |
| `crispy-gnocchi-with-sausage-and-broccoli` | EXCLUDE_SOURCE_URL | PARSE_CLEAN | None |
| `crunchy-queso-wrap` | EXCLUDE_NO_INSTRUCTIONS | PARSE_CLEAN | None |
| `curried-red-bean-soup-with-kale` | EXCLUDE_REVIEW_COMMENT | PARSE_CLEAN | None |
| `curry-tomatoes-and-chickpeas-with-cucumber-yogurt` | EXCLUDE_SOURCE_URL | PARSE_CLEAN | None |
| `filipino-brased-chicken-tocino` | EXCLUDE_NO_INSTRUCTIONS | PARSE_CLEAN | None |
| `huevos-rotos-broken-eggs` | EXCLUDE_REVIEW_COMMENT | PARSE_CLEAN | None |
| `kung-pao-tofu` | EXCLUDE_SOURCE_URL | PARSE_CLEAN | None |
| `onepot-chicken-and-lentil` | EXCLUDE_SOURCE_URL | PARSE_CLEAN | None |
| `onepot-chicken-and-rice-with-caramelized-lemon` | EXCLUDE_SOURCE_URL | PARSE_CLEAN | None |
| `onepot-ratatouille-pasta` | EXCLUDE_SOURCE_URL | PARSE_CLEAN | None |
| `peanut-butter-oat-protein-shake` | EXCLUDE_METADATA | PARSE_CLEAN | None |
| `pearl-couscous-with-creamy-feta-and-chickpeas-meh` | EXCLUDE_SOURCE_URL | PARSE_CLEAN | None |
| `pepper-steak` | EXCLUDE_SOURCE_URL | IMPROVED_STILL_EXCLUDED | standalone_url_plus_mixed_note_content |
| `peruvian-chicken-w-green-sauce` | EXCLUDE_METADATA | PARSE_CLEAN | None |
| `peruvian-roasted-chicken-with-spicy-cilantro-sauce` | EXCLUDE_REVIEW_COMMENT | PARSE_CLEAN | None |
| `pork-fried-rice` | EXCLUDE_SOURCE_URL | IMPROVED_STILL_EXCLUDED | standalone_url_plus_mixed_note_content |
| `pozole-verde-wowza` | EXCLUDE_SOURCE_URL | PARSE_CLEAN | None |
| `roasted-white-bean-and-tomato-pasta` | EXCLUDE_SOURCE_URL | PARSE_CLEAN | None |
| `sheetpan-gochujang-chicken-and-roasted-vegetables` | EXCLUDE_SOURCE_URL | PARSE_CLEAN | None |
| `spicy-ovenfried-rice-with-gochujang-and-fried-eggs` | EXCLUDE_REVIEW_COMMENT | PARSE_CLEAN | None |
| `vegetarian-skillet-chili` | EXCLUDE_SOURCE_URL | PARSE_CLEAN | None |
| `zesty-quinoa-salad` | EXCLUDE_METADATA | IMPROVED_STILL_EXCLUDED | wrong_recipe_method |
| `zibdiyit-gambari-spicy-shrimp-and-tomato-stew` | EXCLUDE_SOURCE_URL | PARSE_CLEAN | None |

## Rejected broad rules

Generic first-person termination, generic NOTES termination, and generic Tip termination remain
unimplemented. The baseline audit showed that NOTES and Tip would invalidate 9 and 4 mapped source
hashes respectively; first-person prose is not reliable review evidence.

## Parser version

`recipe-content-v1` is retained because every currently mapped recipe remains byte-identical in
canonical mapping source and sourceHash. No persisted cooking map is invalidated.

## Production mutation

- Firestore writes: **0**
- Recipe content writes: **0**
- Cooking-map writes: **0**
- AI calls: **0**
- Mapping recomputation/persistence: **0**
