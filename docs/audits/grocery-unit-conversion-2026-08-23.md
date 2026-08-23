# Grocery Unit Conversion — Real Corpus Analysis (2026-08-23)

Read-only analysis of the shared `recipes` collection using the production
`parseRecipeContent`, `parseIngredient`, `normalizeNoun`, `unitCanonical`, and
`convertQuantity` functions. No Firestore write, batch, update, set, or delete
call is made anywhere in this script or during this analysis.

## Corpus summary

| Metric | Count |
|---|---:|
| Recipes inspected | 216 |
| Parseable recipes (has an ingredient section) | 214 |
| Total ingredient-line occurrences | 2985 |
| Measurement-unit occurrences (volume/mass) | 1702 |
| Countable-unit occurrences (can, jar, clove…) | 98 |
| Unitless occurrences | 1180 |
| Unknown-unit / low-confidence occurrences | 5 |

## Same-identity, multi-unit opportunity

1884 distinct normalized-noun identities were seen across the corpus.
72 of them appear in more than one CANONICAL unit across recipes
(identities repeated in only one canonical unit — e.g. "cup" and "cups" — already
merge via same-unit summing today and are not counted here):

| Classification | Count |
|---|---:|
| **Newly convertible** by this feature (compatible different measurement units) | 67 |
| Incompatible (cross-dimension or mixed with countable/unitless) | 4 |
| Countable, multiple different countable units (never convertible) | 1 |

### Representative newly-convertible identities

| Ingredient identity | Units seen | Recipes |
|---|---|---:|
| ground cumin | tablespoon, tsp | 38 |
| garlic powder | teaspoon, tablespoon | 18 |
| onion powder | teaspoon, tablespoon | 11 |
| butter | tablespoons, cup | 6 |
| all purpose flour | tablespoons, cups | 3 |
| salt | teaspoon, tablespoons | 57 |
| oregano | tbsp, tsp | 4 |
| cumin | tbsp, tsp | 15 |
| all-purpose flour | cup, tablespoons | 5 |
| water | cup, tablespoon | 24 |
| cooking oil | tbsp, cup | 3 |
| pepper | tsp, tablespoon | 6 |
| dried thyme | tsp, tablespoon | 8 |
| chili powder | tsp, tbsp | 13 |
| tomato paste | tbsp, cup, teaspoons | 17 |
| flour | cup, tbsp | 5 |
| dried oregano | tsp, tablespoon | 21 |
| ground black pepper | teaspoon, tablespoon | 4 |
| olive oil | tbsp, cup | 48 |
| brown sugar | tbsp, cup, teaspoons | 13 |
| apple cider vinegar | cup, tablespoons | 5 |
| ketchup | cups, tbsp | 3 |
| worcestershire sauce | tbsp, teaspoons | 4 |
| kosher salt | teaspoon, tablespoon, cup | 21 |
| oil | cup, tablespoon | 4 |

### Representative incompatible identities (not converted — different dimensions)

| Ingredient identity | Units seen | Recipes |
|---|---|---:|
| minced garlic | tsp, tbsp, cloves | 7 |
| garlic grated | tablespoon, clove | 3 |
| crumbled feta | ounces, cup | 3 |
| cherry or grape tomato halved | pint, ounces | 2 |

## Notes

- This analysis approximates real grocery-list behavior using per-recipe parsed
  ingredient lines grouped by normalized-noun identity across the whole corpus —
  it is a proxy for "would these merge on the grocery list," not a simulation of
  actual week-plan selections (which recipes a user actually adds together).
- The 23 previously identified ingredient-parser artifacts remain deferred by
  product decision; any raw line the deterministic parser marks `confidence: 'low'`
  is counted under "unknown-unit / low-confidence" above rather than guessed at.
- No Firestore data was mutated. No recipe content was changed.
