# MEA Recipes — Grocery Category Taxonomy Audit — 2026-08-22

> **Implementation status:** The approved 11-category recommendation was implemented in Phase 2.
> See `docs/audits/grocery-category-taxonomy-migration-2026-08-22.md` for the final classifier,
> legacy read-compatibility behavior, corrected-corpus movement review, and verification evidence.

**Work type:** discovery · **production behavior changed:** no · **Firestore writes:** 0

## Executive summary

The smallest useful change is an **11-section store-oriented taxonomy**: keep the four strong fresh-food sections, replace `Staples` with explicit shopping sections, split the current canned/sauce catch-all, add one evidence-supported nuts/seeds section, and retain a narrow `Other`. Do **not** add separate `Baking` or `Frozen` sections yet: the corpus simulation gives them only 85 (2.66%) and 12 (0.38%) occurrences respectively, and the per-recipe proxy shows the 13-section test increases singleton-section fragmentation.

Rule precedence is the immediate problem. Raw substring matching creates both the hypothesized collisions and larger unanticipated ones: `extra-virgin olive oil` matches `gin`, `teaspoon` text matches `tea`, `rolled oats` matches `roll`, and broad `fresh`, `vegetable`, `pea`, `pepper`, `corn`, `butter`, and animal-name terms preempt the intended section. `Staples` is not a coherent store section; it is a mixture of “usually on hand” status and at least eight shopping concepts. Staple status should become a separate future property, not remain a category.

| Metric | Result |
| --- | --- |
| Recipes analyzed | 216 |
| Recipes with parseable ingredients | 214 |
| Unique normalized ingredients | 2008 |
| Raw ingredient occurrences | 3190 |
| Current categories | 9 |
| Likely high-confidence misclassified identities | 513 |
| Likely high-confidence misclassified occurrences | 835 |
| Current Other share | 12.23% |
| Current Staples share | 11.54% |
| Recommended categories | 11 |

The 513 figure is the high-confidence subset of three movement families. Across all confidence levels, the disjoint movement summary contains 397 keyword/precedence defects, 94 missing-coverage identities from `Other`, and 90 identities assigned to shopping sections even though the lines are corpus/parsing noise. Pure `Staples` relocation and the canned/sauce split are reported separately as taxonomy changes, not mislabeled as rule bugs.

## Scope, corpus, and method

The checked-in M-04 backup is a 10-document remediation snapshot, not a complete export. The audit therefore used the repository's existing Admin SDK helper for one read-only query of the shared `recipes` collection. It did not read user grocery, saved-item, or week-plan collections. Each recipe used current `parseRecipeContent`; each returned line used current `parseIngredient`, `normalizeNoun`, and `categorizeIngredient`. The conservative noun normalization intentionally preserves modifiers and purchase identity, so `black pepper`, `bell pepper`, `garlic powder`, `garlic`, `almond milk`, and dairy milk remain distinct.

| Corpus result | Count |
| --- | --- |
| Recipe documents inspected | 216 |
| Parseable recipes | 214 |
| Skipped recipes | 2 |
| Raw ingredient lines | 3190 |
| Normalized grocery identities | 2008 |
| Normalized occurrences | 3190 |
| Low-confidence parser occurrences | 5 |

| Skipped recipe | Title | Reason |
| --- | --- | --- |
| maple-roasted-candied-pecans | Maple Roasted Candied Pecans | parseRecipeContent returned no ingredients |
| smoothies | Smoothies | parseRecipeContent returned no ingredients |

The reusable read-only analyzer at `scripts/audit-grocery-taxonomy.mjs` emits the complete ingredient-frequency dataset as JSON, including normalized identity, up to eight raw examples, recipe count, occurrence count, parser confidence, current category, exact first-matched rule/keyword, candidate/recommended classification, movement type, and `Other`/`Staples` cluster. It introspects the current ordered keyword blocks and aborts if its recorded first match disagrees with production `categorizeIngredient()`.

## Grocery architecture and hard-coded category values

| Location | Category coupling |
| --- | --- |
| lib/groceryCategories.ts | Authoritative 9 strings; GroceryCategory type; MANUAL_CATEGORIES derivation; ordered keyword rules. |
| app/grocery/page.tsx | CATEGORY_EMOJI hard-codes every string; grouping/render order uses GROCERY_CATEGORIES; add/edit pickers use MANUAL_CATEGORIES; manualSection overrides auto classification. |
| lib/userdata.ts | GroceryItem.manualSection and SavedGroceryItem.defaultCategory persist GroceryCategory strings directly. |
| lib/groceryCleanup.ts | Validates AI categories with GROCERY_CATEGORIES.includes; off-list values fall back to categorizeIngredient. |
| app/api/grocery-cleanup/route.ts | Prompt list derives from GROCERY_CATEGORIES; explanatory prompt text names Spices & Seasonings and Staples. Zod accepts a string, then shared sanitizer enforces the list. |
| PRD.md | Documents nine iOS-compatible values, first-match behavior, manualSection, saved defaults, and AI centralization. |
| Tests | Several fixtures contain category strings but do not define a second production taxonomy. |

Historical grocery documents store no auto-category field, but any `manualSection` is a persisted category string. Saved grocery items persist `defaultCategory` directly. Therefore automatic items without overrides would reclassify under new rules, while manual overrides and saved defaults would retain legacy strings until compatibility handling/migration. Changing values requires coordinated web/iOS work because both clients share Firestore, even though the exact iOS enum could not be inspected in this repository.

## Current taxonomy distribution

| Category | Unique ingredients | Occurrences | % occurrences |
| --- | --- | --- | --- |
| Produce | 989 | 1456 | 45.64% |
| Meat & Seafood | 134 | 173 | 5.42% |
| Dairy & Eggs | 124 | 158 | 4.95% |
| Bakery & Bread | 28 | 30 | 0.94% |
| Canned / Jarred / Sauces | 141 | 259 | 8.12% |
| Beverages | 58 | 123 | 3.86% |
| Spices & Seasonings | 98 | 233 | 7.3% |
| Staples | 151 | 368 | 11.54% |
| Other | 285 | 390 | 12.23% |

### Produce

| Ingredient | Occurrences | Recipes | Matched keyword |
| --- | --- | --- | --- |
| black pepper | 24 | 23 | pepper |
| dried oregano | 21 | 21 | oregano |
| garlic clove minced | 20 | 20 | garlic |
| garlic powder | 18 | 18 | garlic |
| tomato paste | 17 | 17 | tomato |
| garlic minced | 14 | 14 | garlic |
| onion powder | 12 | 11 | onion |
| vegetable oil | 12 | 11 | vegetable |
| freshly ground black pepper | 11 | 11 | pepper |
| garlic | 10 | 10 | garlic |
| kosher salt and black pepper | 10 | 10 | pepper |
| salt and black pepper | 10 | 10 | pepper |
| salt and pepper | 10 | 10 | pepper |
| cayenne pepper | 9 | 9 | pepper |
| cornstarch | 9 | 9 | corn |
| lemon juice | 9 | 9 | lemon |
| dried thyme | 8 | 8 | thyme |
| garlic clove grated | 8 | 8 | garlic |
| salt and pepper to taste | 8 | 8 | pepper |
| cherry tomato halved | 7 | 7 | cherry |

Representative long tail: `yellow or red onion thinly sliced`, `yukon gold potato sliced about ½ inch in thickness`, `zest and juice of 1 lime about 2 tablespoon juice`, `zest from 1 orange`, `zest from 2 lemon`, `zucchini cut into large chunk`.

Suspicious assignments: `black pepper` (24; `pepper` → Spices & Seasonings); `dried oregano` (21; `oregano` → Spices & Seasonings); `garlic powder` (18; `garlic` → Spices & Seasonings); `tomato paste` (17; `tomato` → Canned & Jarred); `onion powder` (12; `onion` → Spices & Seasonings); `vegetable oil` (12; `vegetable` → Sauces & Condiments); `freshly ground black pepper` (11; `pepper` → Spices & Seasonings); `kosher salt and black pepper` (10; `pepper` → Spices & Seasonings).

### Meat & Seafood

| Ingredient | Occurrences | Recipes | Matched keyword |
| --- | --- | --- | --- |
| chicken broth | 10 | 10 | chicken |
| boneless skinless chicken thigh | 9 | 9 | chicken |
| boneless skinless chicken breast | 6 | 6 | chicken |
| for chicken | 5 | 5 | chicken |
| oyster sauce | 4 | 4 | oyster |
| fish sauce | 3 | 3 | fish |
| bacon cut into small piece | 2 | 2 | bacon |
| chicken or veggie stock | 2 | 2 | chicken |
| chicken stock | 2 | 2 | chicken |
| ground chicken | 2 | 2 | chicken |
| ground pork | 2 | 2 | pork |
| large shrimp peeled and deveined | 2 | 2 | shrimp |
| poultry seasoning | 2 | 2 | poultry |
| reduced-sodium chicken broth | 2 | 2 | chicken |
| / 11 oz thin white fish fillet ~1 cm / 0 4 thick skinless cut into 6 cm / 2 5 or so square piece note 1 | 1 | 1 | fish |
| 1 2 oz package dry beef gravy mix | 1 | 1 | beef |
| 1/2 pound firm white fish- halibut black cod sea bass thicker cut are best | 1 | 1 | cod |
| 2 5 pound boneless beef chuck roast | 1 | 1 | beef |
| 3 1/2- to 4 1/2-pound chicken halved see note or 4 pound bone-in skin-on chicken part | 1 | 1 | chicken |
| 32 ounce chicken broth | 1 | 1 | chicken |

Representative long tail: `to 2 pound boneless skinless chicken thigh or breast`, `to 3 pound bone-in skin-on chicken thigh drumstick or breast patted dry`, `water of more just enough to cover meat`, `wet ingredient for chicken`, `white wine or chicken broth`, `whole chicken`.

Suspicious assignments: `chicken broth` (10; `chicken` → Pantry & Dry Goods); `for chicken` (5; `chicken` → Other); `oyster sauce` (4; `oyster` → Sauces & Condiments); `fish sauce` (3; `fish` → Sauces & Condiments); `chicken or veggie stock` (2; `chicken` → Pantry & Dry Goods); `chicken stock` (2; `chicken` → Pantry & Dry Goods); `poultry seasoning` (2; `poultry` → Spices & Seasonings); `reduced-sodium chicken broth` (2; `chicken` → Pantry & Dry Goods).

### Dairy & Eggs

| Ingredient | Occurrences | Recipes | Matched keyword |
| --- | --- | --- | --- |
| large egg | 7 | 7 | egg |
| butter | 6 | 6 | butter |
| egg | 6 | 6 | egg |
| unsalted butter | 6 | 6 | butter |
| crumbled feta | 3 | 3 | feta |
| greek yogurt | 3 | 3 | yogurt |
| heavy cream | 3 | 3 | cream |
| sour cream | 3 | 3 | cream |
| 14-ounce can full-fat coconut milk | 2 | 2 | milk |
| egg lightly beaten | 2 | 2 | egg |
| grated parmesan | 2 | 2 | parmesan |
| sour cream or greek yogurt | 2 | 2 | cream |
| whole milk | 2 | 2 | milk |
| / 1 stick unsalted butter melted | 1 | 1 | butter |
| 1 14 ounce can coconut milk liquid and solid | 1 | 1 | milk |
| 110 g finely crumbled cotija or feta cheese plus more for serving | 1 | 1 | cheese |
| 13 5-ounce can full-fat coconut milk | 1 | 1 | milk |
| 14-ounce can coconut milk or unsweetened coconut cream | 1 | 1 | milk |
| 2% milk | 1 | 1 | milk |
| 3 cup sharp cheddar shredded | 1 | 1 | cheddar |

Representative long tail: `unsalted butter cubed`, `unsalted butter sliced into 6 piece`, `unsalted butter softened`, `unsweetened almond milk add more as needed`, `up to 2 cup additional milk or water`, `whole egg at room temperature`.

Suspicious assignments: `14-ounce can full-fat coconut milk` (2; `milk` → Canned & Jarred); `1 14 ounce can coconut milk liquid and solid` (1; `milk` → Canned & Jarred); `13 5-ounce can full-fat coconut milk` (1; `milk` → Canned & Jarred); `14-ounce can coconut milk or unsweetened coconut cream` (1; `milk` → Canned & Jarred); `about bean click here to read my article science of bean for tip on working with bean and equivalent for dry canned and cooked bean decide which you will use if you plan to use dried bean follow instruction there for preparing them feel free to substitute pinto bean for butter bean` (1; `butter` → Canned & Jarred); `butter bean two 15-ounce can` (1; `butter` → Canned & Jarred); `buttermilk or 1 cup milk + 1 teaspoon vinegar` (1; `milk` → Sauces & Condiments); `coconut milk` (1; `milk` → Canned & Jarred).

### Bakery & Bread

| Ingredient | Occurrences | Recipes | Matched keyword |
| --- | --- | --- | --- |
| crusty bread | 2 | 2 | bread |
| thick slice sourdough cut into cube | 2 | 2 | sourdough |
| baguette or rustic crusty loaf | 1 | 1 | baguette |
| brioche bun | 1 | 1 | bun |
| crushed tortilla chip | 1 | 1 | tortilla |
| crusty bread for serving | 1 | 1 | bread |
| crusty bread or cooked rice for serving | 1 | 1 | bread |
| diced rustic country bread ¾-inch piece | 1 | 1 | bread |
| extra-large burrito-size 10-inch flour tortilla see tip | 1 | 1 | tortilla |
| flatbread or plain white rice optional for serving | 1 | 1 | bread |
| flour tortilla plus more as needed | 1 | 1 | tortilla |
| for crouton optional | 1 | 1 | crouton |
| for dough | 1 | 1 | dough |
| frozen cylindrical rice cake optional or rice noodle or pasta or steamed rice | 1 | 1 | cake |
| injera pita naan or rice for serving | 1 | 1 | pita |
| masa harina for tortilla | 1 | 1 | tortilla |
| panko | 1 | 1 | panko |
| panko bread crumb | 1 | 1 | bread |
| pita bread | 1 | 1 | bread |
| rice focaccia or flatbread such as roti or double for serving | 1 | 1 | bread |

Representative long tail: `slightly crushed pita chip`, `small slice of french bread`, `small tortilla`, `warm pita optional`, `warm pita or rice for serving`, `warmed naan for serving optional`.

Suspicious assignments: `crusty bread or cooked rice for serving` (1; `bread` → Pantry & Dry Goods); `extra-large burrito-size 10-inch flour tortilla see tip` (1; `tortilla` → Pantry & Dry Goods); `flatbread or plain white rice optional for serving` (1; `bread` → Pantry & Dry Goods); `flour tortilla plus more as needed` (1; `tortilla` → Pantry & Dry Goods); `for crouton optional` (1; `crouton` → Other); `for dough` (1; `dough` → Other); `frozen cylindrical rice cake optional or rice noodle or pasta or steamed rice` (1; `cake` → Pantry & Dry Goods); `injera pita naan or rice for serving` (1; `pita` → Pantry & Dry Goods).

### Canned / Jarred / Sauces

| Ingredient | Occurrences | Recipes | Matched keyword |
| --- | --- | --- | --- |
| olive oil | 51 | 48 | olive |
| soy sauce | 25 | 22 | sauce |
| red lentil rinsed | 5 | 5 | lentil |
| dijon mustard | 5 | 4 | mustard |
| for sauce | 4 | 4 | sauce |
| worcestershire sauce | 4 | 4 | sauce |
| ketchup | 3 | 3 | ketchup |
| light soy sauce | 3 | 3 | sauce |
| olive oil divided | 3 | 3 | olive |
| olive oil plus more for drizzling | 3 | 3 | olive |
| sauce | 3 | 3 | sauce |
| good olive oil | 3 | 2 | olive |
| low sodium soy sauce | 3 | 2 | sauce |
| mustard powder | 3 | 2 | mustard |
| 15-ounce can black bean drained and rinsed | 2 | 2 | black bean |
| adobo sauce | 2 | 2 | sauce |
| dark soy sauce | 2 | 2 | sauce |
| for soup | 2 | 2 | soup |
| hoisin sauce | 2 | 2 | sauce |
| hot sauce for serving | 2 | 2 | sauce |

Representative long tail: `to 1 ½ cup homemade or store-bought barbecue sauce`, `well-stirred chinese sesame paste or tahini`, `white or yellow miso`, `whole chipotle chily canned in adobo sauce plus 2 tablespoon sauce stem and seed removed`, `worcestershire or soy sauce`, `worchestershire sauce 2 tbsp`.

Suspicious assignments: `olive oil` (51; `olive` → Sauces & Condiments); `soy sauce` (25; `sauce` → Sauces & Condiments); `red lentil rinsed` (5; `lentil` → Pantry & Dry Goods); `dijon mustard` (5; `mustard` → Sauces & Condiments); `for sauce` (4; `sauce` → Other); `worcestershire sauce` (4; `sauce` → Sauces & Condiments); `ketchup` (3; `ketchup` → Sauces & Condiments); `light soy sauce` (3; `sauce` → Sauces & Condiments).

### Beverages

| Ingredient | Occurrences | Recipes | Matched keyword |
| --- | --- | --- | --- |
| water | 25 | 24 | water |
| extra-virgin olive oil | 24 | 24 | gin |
| red wine vinegar | 7 | 7 | wine |
| extra virgin olive oil | 6 | 5 | gin |
| extra-virgin olive oil plus more for drizzling | 4 | 4 | gin |
| baking soda | 2 | 2 | soda |
| extra-virgin olive oil for drizzling | 2 | 2 | gin |
| extra-virgin olive oil plus more as needed | 2 | 2 | gin |
| splash white wine | 2 | 2 | wine |
| -1 teaspoon chaat masala optional but recommended | 1 | 1 | tea |
| -1 teaspoon kashmiri red chili powder | 1 | 1 | tea |
| 12 fl oz can or bottle beer | 1 | 1 | beer |
| about 8 cup of water | 1 | 1 | water |
| aji panca paste or 1 teaspoon pasilla chile powder | 1 | 1 | tea |
| beer 1/2 bottle | 1 | 1 | beer |
| black tea bag for color indian tea - optional | 1 | 1 | tea |
| black vinegar or rice wine vinegar | 1 | 1 | wine |
| boiling water | 1 | 1 | water |
| broth or water for thinning sauce | 1 | 1 | water |
| coconut oil or extra-virgin olive oil | 1 | 1 | gin |

Representative long tail: `water and ice to blend`, `water chestnut`, `water or broth`, `white wine reserved cooking water broth or any combination`, `white wine vinegar`, `wooden skewer soaked in water for 30 minute`.

Suspicious assignments: `extra-virgin olive oil` (24; `gin` → Sauces & Condiments); `red wine vinegar` (7; `wine` → Sauces & Condiments); `extra virgin olive oil` (6; `gin` → Sauces & Condiments); `extra-virgin olive oil plus more for drizzling` (4; `gin` → Sauces & Condiments); `baking soda` (2; `soda` → Pantry & Dry Goods); `extra-virgin olive oil for drizzling` (2; `gin` → Sauces & Condiments); `extra-virgin olive oil plus more as needed` (2; `gin` → Sauces & Condiments); `-1 teaspoon chaat masala optional but recommended` (1; `tea` → Other).

### Spices & Seasonings

| Ingredient | Occurrences | Recipes | Matched keyword |
| --- | --- | --- | --- |
| ground cumin | 40 | 38 | cumin |
| cumin | 15 | 15 | cumin |
| chili powder | 13 | 13 | chili |
| ground turmeric | 12 | 12 | turmeric |
| smoked paprika | 12 | 12 | paprika |
| ground coriander | 11 | 11 | coriander |
| paprika | 8 | 8 | paprika |
| bay leaf | 7 | 7 | bay leaf |
| ground cinnamon | 7 | 7 | cinnamon |
| sweet paprika | 6 | 6 | paprika |
| garam masala | 5 | 5 | garam masala |
| 3 clove | 2 | 2 | clove |
| coriander | 2 | 2 | coriander |
| coriander seed | 2 | 2 | coriander |
| cumin powder | 2 | 2 | cumin |
| ground allspice | 2 | 2 | allspice |
| ground cayenne | 2 | 2 | cayenne |
| ground cayenne or to taste | 2 | 2 | cayenne |
| pinch of cayenne | 2 | 2 | cayenne |
| turmeric powder | 2 | 2 | turmeric |

Representative long tail: `tsao-ko aka chinese black cardamom optional`, `turmeric`, `whole clove`, `whole tianjin chile or chile de árbol crushed`, `yellow curry powder`, `yellow curry powder - see note 3`.

Suspicious assignments: `3 clove` (2; `clove` → Other); `16 oz can chili bean` (1; `chili` → Canned & Jarred); `4-ounce can diced green chile` (1; `chile` → Canned & Jarred); `4oz can diced green chile` (1; `chile` → Canned & Jarred); `aji amarillo or other chile paste see headnote` (1; `chile` → Sauces & Condiments); `ancho chile boiled de-seeded and cleaned` (1; `chile` → Other); `ancho powder` (1; `ancho` → Other); `chile crisp or chili oil` (1; `chile` → Sauces & Condiments).

### Staples

| Ingredient | Occurrences | Recipes | Matched keyword |
| --- | --- | --- | --- |
| salt | 62 | 57 | salt |
| kosher salt | 22 | 21 | salt |
| honey | 18 | 18 | honey |
| sesame oil | 15 | 15 | sesame oil |
| brown sugar | 13 | 13 | sugar |
| salt to taste | 10 | 8 | salt |
| rice vinegar | 9 | 8 | vinegar |
| baking powder | 7 | 7 | baking powder |
| canola oil | 6 | 6 | canola oil |
| kosher salt such as diamond crystal | 6 | 6 | salt |
| maple syrup | 6 | 6 | maple syrup |
| sugar | 6 | 6 | sugar |
| fine sea salt | 6 | 5 | salt |
| all-purpose flour | 5 | 5 | flour |
| flour | 5 | 5 | flour |
| neutral oil | 5 | 5 | neutral oil |
| quinoa | 5 | 5 | quinoa |
| salt more to taste | 4 | 4 | salt |
| sea salt | 4 | 4 | salt |
| all purpose flour | 3 | 3 | flour |

Representative long tail: `uncooked wild rice rinsed`, `unsalted dry roasted pistachio roughly chopped`, `vanilla extract`, `white distilled vinegar`, `white long grain rice`, `white rice for serving`.

Suspicious assignments: `salt` (62; `salt` → Spices & Seasonings); `kosher salt` (22; `salt` → Spices & Seasonings); `honey` (18; `honey` → Pantry & Dry Goods); `sesame oil` (15; `sesame oil` → Sauces & Condiments); `brown sugar` (13; `sugar` → Pantry & Dry Goods); `salt to taste` (10; `salt` → Spices & Seasonings); `rice vinegar` (9; `vinegar` → Sauces & Condiments); `baking powder` (7; `baking powder` → Pantry & Dry Goods).

### Other

| Ingredient | Occurrences | Recipes | Matched keyword |
| --- | --- | --- | --- |
| x | 18 | 6 | none |
| nutritional information | 10 | 10 | none |
| add to your grocery list | 9 | 9 | none |
| serving | 8 | 8 | none |
| sesame seed | 8 | 8 | none |
| minute | 7 | 4 | none |
| shop ingredient on instacart | 6 | 6 | none |
| add ingredient to your grocery list | 4 | 4 | none |
| oil | 4 | 4 | none |
| comment | 3 | 3 | none |
| farro | 3 | 3 | none |
| for salad | 3 | 3 | none |
| gochujang | 3 | 3 | none |
| metric conversion | 3 | 3 | none |
| note | 3 | 3 | none |
| these recipe were created in us customary measurement and conversion to metric is being done by calculation they should be accurate but it is possible there could be error if you find one please let us know in comment at bottom of page | 3 | 3 | none |
| minute minute | 3 | 1 | none |
| 14-ounce block extra-firm tofu pressed and cubed | 2 | 2 | none |
| add ingredient to grocery list | 2 | 2 | none |
| bowl | 2 | 2 | none |

Representative long tail: `what supplemental reports/email do we need for refund`, `when they get real number via email go through lot number individually to update`, `white sesame seed`, `whole walnut`, `xawaash`, `yield 4 serving`.

Suspicious assignments: `sesame seed` (8; `no keyword` → Nuts, Seeds & Nut Butters); `oil` (4; `no keyword` → Sauces & Condiments); `farro` (3; `no keyword` → Pantry & Dry Goods); `gochujang` (3; `no keyword` → Sauces & Condiments); `14-ounce block extra-firm tofu pressed and cubed` (2; `no keyword` → Produce); `cashew` (2; `no keyword` → Nuts, Seeds & Nut Butters); `hummus` (2; `no keyword` → Sauces & Condiments); `mirin` (2; `no keyword` → Sauces & Condiments).

## Most important misclassifications

This table prioritizes frequency and high confidence. “Rule” is the exact first substring that won. The full 513-identity set is in the analyzer JSON output.

| Ingredient | Freq. | Current | Rule | Recommended | Confidence | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| extra-virgin olive oil | 24 | Beverages | gin | Sauces & Condiments | high | sauce, condiment, cooking fat, vinegar, paste, or preserve |
| black pepper | 24 | Produce | pepper | Spices & Seasonings | high | salt, dried herb, spice, powder, or seasoning |
| dried oregano | 21 | Produce | oregano | Spices & Seasonings | high | salt, dried herb, spice, powder, or seasoning |
| garlic powder | 18 | Produce | garlic | Spices & Seasonings | high | salt, dried herb, spice, powder, or seasoning |
| tomato paste | 17 | Produce | tomato | Canned & Jarred | high | shelf-stable coconut milk/cream |
| onion powder | 12 | Produce | onion | Spices & Seasonings | high | salt, dried herb, spice, powder, or seasoning |
| vegetable oil | 12 | Produce | vegetable | Sauces & Condiments | high | sauce, condiment, cooking fat, vinegar, paste, or preserve |
| freshly ground black pepper | 11 | Produce | pepper | Spices & Seasonings | high | salt, dried herb, spice, powder, or seasoning |
| chicken broth | 10 | Meat & Seafood | chicken | Pantry & Dry Goods | high | shelf-stable grain, pasta, legume, stock, or dry good |
| kosher salt and black pepper | 10 | Produce | pepper | Spices & Seasonings | high | salt, dried herb, spice, powder, or seasoning |
| salt and black pepper | 10 | Produce | pepper | Spices & Seasonings | high | salt, dried herb, spice, powder, or seasoning |
| salt and pepper | 10 | Produce | pepper | Spices & Seasonings | high | salt, dried herb, spice, powder, or seasoning |
| cayenne pepper | 9 | Produce | pepper | Spices & Seasonings | high | salt, dried herb, spice, powder, or seasoning |
| cornstarch | 9 | Produce | corn | Pantry & Dry Goods | high | baking folded into pantry in the smaller taxonomy |
| dried thyme | 8 | Produce | thyme | Spices & Seasonings | high | salt, dried herb, spice, powder, or seasoning |
| salt and pepper to taste | 8 | Produce | pepper | Spices & Seasonings | high | salt, dried herb, spice, powder, or seasoning |
| sesame seed | 8 | Other | no match | Nuts, Seeds & Nut Butters | high | nut, seed, or nut/seed butter purchase identity |
| red pepper flake | 7 | Produce | pepper | Spices & Seasonings | high | salt, dried herb, spice, powder, or seasoning |
| red wine vinegar | 7 | Beverages | wine | Sauces & Condiments | high | sauce, condiment, cooking fat, vinegar, paste, or preserve |
| kosher salt such as diamond crystal and black pepper | 6 | Produce | pepper | Spices & Seasonings | high | salt, dried herb, spice, powder, or seasoning |
| pepper | 6 | Produce | pepper | Spices & Seasonings | high | salt, dried herb, spice, powder, or seasoning |
| extra virgin olive oil | 6 | Beverages | gin | Sauces & Condiments | high | sauce, condiment, cooking fat, vinegar, paste, or preserve |
| apple cider vinegar | 5 | Produce | apple | Sauces & Condiments | high | sauce, condiment, cooking fat, vinegar, paste, or preserve |
| for chicken | 5 | Meat & Seafood | chicken | Other | high | non-food, page chrome, time/yield text, or ingredient subheader |
| red lentil rinsed | 5 | Canned / Jarred / Sauces | lentil | Pantry & Dry Goods | high | shelf-stable grain, pasta, legume, stock, or dry good |
| 15-ounce can chickpea drained and rinsed | 4 | Produce | pea | Canned & Jarred | high | explicit canned/jarred purchase form |
| corn tortilla | 4 | Produce | corn | Bakery & Bread | high | finished bread or bakery purchase identity |
| dried basil | 4 | Produce | basil | Spices & Seasonings | high | salt, dried herb, spice, powder, or seasoning |
| extra-virgin olive oil plus more for drizzling | 4 | Beverages | gin | Sauces & Condiments | high | sauce, condiment, cooking fat, vinegar, paste, or preserve |
| for sauce | 4 | Canned / Jarred / Sauces | sauce | Other | high | non-food, page chrome, time/yield text, or ingredient subheader |
| ground black pepper | 4 | Produce | pepper | Spices & Seasonings | high | salt, dried herb, spice, powder, or seasoning |
| oil | 4 | Other | no match | Sauces & Condiments | high | sauce, condiment, cooking fat, vinegar, paste, or preserve |
| oyster sauce | 4 | Meat & Seafood | oyster | Sauces & Condiments | high | sauce, condiment, cooking fat, vinegar, paste, or preserve |
| red-pepper flake | 4 | Produce | pepper | Spices & Seasonings | high | salt, dried herb, spice, powder, or seasoning |
| 15-ounce can chickpea drained | 3 | Produce | pea | Canned & Jarred | high | explicit canned/jarred purchase form |
| black pepper to taste | 3 | Produce | pepper | Spices & Seasonings | high | salt, dried herb, spice, powder, or seasoning |
| farro | 3 | Other | no match | Pantry & Dry Goods | high | shelf-stable grain, pasta, legume, stock, or dry good |
| fish sauce | 3 | Meat & Seafood | fish | Sauces & Condiments | high | sauce, condiment, cooking fat, vinegar, paste, or preserve |
| freshly cracked black pepper | 3 | Produce | pepper | Spices & Seasonings | high | salt, dried herb, spice, powder, or seasoning |
| gochujang | 3 | Other | no match | Sauces & Condiments | high | sauce, condiment, cooking fat, vinegar, paste, or preserve |
| peanut butter | 3 | Produce | pea | Nuts, Seeds & Nut Butters | high | nut, seed, or nut/seed butter purchase identity |
| pineapple juice | 3 | Produce | apple | Beverages | high | drink or beverage purchase identity |
| salt and ground black pepper to taste | 3 | Produce | pepper | Spices & Seasonings | high | salt, dried herb, spice, powder, or seasoning |
| 14-ounce block extra-firm tofu pressed and cubed | 2 | Other | no match | Produce | high | fresh fruit, vegetable, herb, or refrigerated plant protein |
| 14-ounce can diced tomato | 2 | Produce | tomato | Canned & Jarred | high | explicit canned/jarred purchase form |
| 14-ounce can full-fat coconut milk | 2 | Dairy & Eggs | milk | Canned & Jarred | high | explicit canned/jarred purchase form |
| baking soda | 2 | Beverages | soda | Pantry & Dry Goods | high | baking folded into pantry in the smaller taxonomy |
| black pepper plus more to taste | 2 | Produce | pepper | Spices & Seasonings | high | salt, dried herb, spice, powder, or seasoning |
| cashew | 2 | Other | no match | Nuts, Seeds & Nut Butters | high | nut, seed, or nut/seed butter purchase identity |
| chicken or veggie stock | 2 | Meat & Seafood | chicken | Pantry & Dry Goods | high | shelf-stable grain, pasta, legume, stock, or dry good |
| chicken stock | 2 | Meat & Seafood | chicken | Pantry & Dry Goods | high | shelf-stable grain, pasta, legume, stock, or dry good |
| crushed red pepper flake more to taste | 2 | Produce | pepper | Spices & Seasonings | high | salt, dried herb, spice, powder, or seasoning |
| dried parsley | 2 | Produce | parsley | Spices & Seasonings | high | salt, dried herb, spice, powder, or seasoning |
| dried sage | 2 | Produce | sage | Spices & Seasonings | high | salt, dried herb, spice, powder, or seasoning |
| extra-virgin olive oil for drizzling | 2 | Beverages | gin | Sauces & Condiments | high | sauce, condiment, cooking fat, vinegar, paste, or preserve |
| extra-virgin olive oil plus more as needed | 2 | Beverages | gin | Sauces & Condiments | high | sauce, condiment, cooking fat, vinegar, paste, or preserve |
| finely ground black pepper | 2 | Produce | pepper | Spices & Seasonings | high | salt, dried herb, spice, powder, or seasoning |
| for soup | 2 | Canned / Jarred / Sauces | soup | Other | high | non-food, page chrome, time/yield text, or ingredient subheader |
| freshly grated parmesan cheese | 2 | Produce | fresh | Dairy & Eggs | high | dairy or egg purchase identity |
| hummus | 2 | Other | no match | Sauces & Condiments | high | sauce, condiment, cooking fat, vinegar, paste, or preserve |

## Explicit rule-order collision review

| Hypothesis | Observed result |
| --- | --- |
| black pepper | Confirmed: black pepper alone appears 24 times and maps to Produce via generic `pepper`; the broader black-pepper family is larger. |
| garlic powder | Confirmed: 18 occurrences map to Produce via `garlic`. |
| onion powder | Confirmed: 12 direct occurrences map to Produce via `onion` (plus mixed lines). |
| chickpeas | Confirmed: canned/dry chickpea identities map to Produce via substring `pea`. |
| dried herbs | Confirmed: dried oregano 21, dried thyme 8, dried basil 4, and other dried herbs map to Produce because fresh-herb names appear first. |
| almond/oat/soy milk | Confirmed where present: almond milk and oat milk each map to Dairy & Eggs via `milk`; no soy-milk identity occurs in the corpus. The later beverage keywords are unreachable. |
| coconut milk | Confirmed: 8 observed occurrences across identities map to Dairy & Eggs via `milk`, before the canned rule. |
| broth/stock | Confirmed, but not primarily Beverages: animal broths/stocks map to Meat & Seafood via animal names; vegetable versions map to Produce via `vegetable`; generic water/broth can map to Beverages. |
| canned seafood | No explicitly canned tuna/sardine identity occurs. Two anchovy-fillet identities map to Meat & Seafood; one anchovy/vegetable-broth line maps to Produce. Hypothesis not corpus-testable for labeled cans. |
| new: extra-virgin olive oil | Confirmed severe substring bug: 24 direct occurrences map to Beverages because `gin` occurs inside `virgin`; variants add more. |
| new: teaspoon text | Confirmed: several malformed/low-quality lines map to Beverages because `tea` occurs inside `teaspoon`. |
| new: rolled oats | Confirmed: rolled-oat identities map to Bakery & Bread via substring `roll`. |
| new: cornstarch/tortillas/peppercorn | Confirmed: generic `corn` pushes cornstarch, corn tortillas, and even Sichuan peppercorn toward Produce. |
| new: fish/oyster sauce | Confirmed: fish sauce and oyster sauce map to Meat & Seafood before the sauce rule. |
| new: butter beans | Confirmed: butter-bean text can map to Dairy & Eggs via `butter`. |

## Other analysis

Current `Other` contains **285 identities / 390 occurrences (12.23%)**. Most of it does not justify a new shopping category: 242 occurrences are page chrome, ingredient subheaders, time/yield fragments, or obvious non-food corpus contamination. The strongest true shopping cluster is nuts/seeds/nut butters (30 occurrences among current `Other`; 53 occurrences corpus-wide after correcting collisions), followed by international sauces/condiments (30 current-`Other` occurrences).

| Cluster | Unique | Occurrences | Recommended handling |
| --- | --- | --- | --- |
| page chrome / parsing noise | 81 | 160 | Repair/filter source content; keep out of shopping sections. |
| non-food corpus contamination | 76 | 82 | Repair/filter source content; keep out of shopping sections. |
| genuinely miscellaneous / unresolved | 34 | 34 | Keep Other pending reviewed rules/data cleanup. |
| international sauces / condiments | 23 | 30 | Add targeted rule coverage in the named section. |
| nuts/seeds/nut butters | 21 | 30 | Add Nuts, Seeds & Nut Butters. |
| missing keyword → Produce | 19 | 21 | Add targeted rule coverage in the named section. |
| specialty pantry / baking | 7 | 9 | Add targeted rule coverage in the named section. |
| missing keyword → Spices & Seasonings | 8 | 8 | Add targeted rule coverage in the named section. |
| missing keyword → Beverages | 4 | 4 | Add targeted rule coverage in the named section. |
| missing keyword → Canned & Jarred | 4 | 4 | Add targeted rule coverage in the named section. |
| missing keyword → Dairy & Eggs | 4 | 4 | Add targeted rule coverage in the named section. |
| missing keyword → Bakery & Bread | 2 | 2 | Add targeted rule coverage in the named section. |
| missing keyword → Meat & Seafood | 2 | 2 | Add targeted rule coverage in the named section. |

A notable data-quality finding is that at least 76 unique `Other` identities are non-recipe workflow text about contracts, bidders, registers, payments, vehicles, refunds, and related screens. The audit does not repair those recipes, but taxonomy changes alone cannot make those lines useful grocery items.

## Staples analysis

Current `Staples` contains **151 identities / 368 occurrences (11.54%)** across unrelated store concepts:

| Cluster | Unique | Occurrences |
| --- | --- | --- |
| spices/seasonings | 38 | 154 |
| sweeteners | 23 | 64 |
| oils/fats | 16 | 43 |
| rice/grains | 33 | 39 |
| flour/baking | 10 | 26 |
| pasta/noodles | 17 | 19 |
| vinegars | 10 | 19 |
| other | 4 | 4 |

**Keep Staples as category: NO. Recommend separate staple-status concept: YES.** “Where do I buy/find this?” and “Do I usually have this?” are independent. Move salt/pepper/dried herbs to Spices & Seasonings; oils/vinegars to Sauces & Condiments; flour/sugar/baking agents to Pantry & Dry Goods in the recommended small taxonomy; and rice/grains/pasta/noodles/oats to Pantry & Dry Goods. A later boolean or preference-backed staple status may suppress, pre-check, or annotate items, but it should not determine the shopping section.

## 13-category candidate simulation

The mandated test taxonomy was simulated deterministically against every normalized identity. It is useful diagnostically but too fragmented for the product.

| Category | Unique ingredients | Occurrences | % occurrences |
| --- | --- | --- | --- |
| Produce | 695 | 932 | 29.22% |
| Meat & Seafood | 104 | 121 | 3.79% |
| Dairy & Eggs | 119 | 153 | 4.8% |
| Bakery & Bread | 21 | 26 | 0.82% |
| Pantry & Dry Goods | 121 | 173 | 5.42% |
| Canned & Jarred | 89 | 113 | 3.54% |
| Sauces & Condiments | 234 | 446 | 13.98% |
| Spices & Seasonings | 224 | 645 | 20.22% |
| Baking | 41 | 85 | 2.66% |
| Nuts, Seeds & Nut Butters | 41 | 53 | 1.66% |
| Frozen | 11 | 12 | 0.38% |
| Beverages | 23 | 51 | 1.6% |
| Other | 285 | 380 | 11.91% |

- **Produce:** 695 identities / 932 occurrences. Top: `garlic clove minced` (20), `garlic minced` (14), `garlic` (10), `lemon juice` (9), `garlic clove grated` (8), `cherry tomato halved` (7), `garlic clove thinly sliced` (7), `minced garlic` (7).

- **Meat & Seafood:** 104 identities / 121 occurrences. Top: `boneless skinless chicken thigh` (9), `boneless skinless chicken breast` (6), `bacon cut into small piece` (2), `ground chicken` (2), `ground pork` (2), `large shrimp peeled and deveined` (2), `/ 11 oz thin white fish fillet ~1 cm / 0 4 thick skinless cut into 6 cm / 2 5 or so square piece note 1` (1), `1 2 oz package dry beef gravy mix` (1).

- **Dairy & Eggs:** 119 identities / 153 occurrences. Top: `large egg` (7), `butter` (6), `egg` (6), `unsalted butter` (6), `crumbled feta` (3), `greek yogurt` (3), `heavy cream` (3), `sour cream` (3).

- **Bakery & Bread:** 21 identities / 26 occurrences. Top: `corn tortilla` (4), `crusty bread` (2), `thick slice sourdough cut into cube` (2), `6-inch corn tortilla` (1), `baguette or rustic crusty loaf` (1), `blue corn tortilla` (1), `blue corn tortilla chip for yummy dippin` (1), `brioche bun` (1).

- **Pantry & Dry Goods:** 121 identities / 173 occurrences. Top: `honey` (18), `chicken broth` (10), `maple syrup` (6), `quinoa` (5), `red lentil rinsed` (5), `farro` (3), `noodle` (3), `chicken or veggie stock` (2).

- **Canned & Jarred:** 89 identities / 113 occurrences. Top: `tomato paste` (17), `15-ounce can chickpea drained and rinsed` (4), `15-ounce can chickpea drained` (3), `14-ounce can diced tomato` (2), `14-ounce can full-fat coconut milk` (2), `15-ounce can black bean drained and rinsed` (2), `- 1 15 oz can diced tomato` (1), `1 14 ounce can black bean rinsed and drained` (1).

- **Sauces & Condiments:** 234 identities / 446 occurrences. Top: `olive oil` (51), `soy sauce` (25), `extra-virgin olive oil` (24), `sesame oil` (15), `vegetable oil` (12), `rice vinegar` (9), `red wine vinegar` (7), `canola oil` (6).

- **Spices & Seasonings:** 224 identities / 645 occurrences. Top: `salt` (62), `ground cumin` (40), `black pepper` (24), `kosher salt` (22), `dried oregano` (21), `garlic powder` (18), `cumin` (15), `chili powder` (13).

- **Baking:** 41 identities / 85 occurrences. Top: `brown sugar` (13), `cornstarch` (9), `baking powder` (7), `sugar` (6), `all-purpose flour` (5), `flour` (5), `all purpose flour` (3), `granulated sugar` (3).

- **Nuts, Seeds & Nut Butters:** 41 identities / 53 occurrences. Top: `sesame seed` (8), `peanut butter` (3), `cashew` (2), `sesame seed toasted` (2), `tahini` (2), `almond` (1), `cashew if you can find them trader joe’ thai lime and chili cashew are bomb` (1), `chia seed optional` (1).

- **Frozen:** 11 identities / 12 occurrences. Top: `frozen pea` (2), `17-ounce package shelf-stable or frozen potato gnocchi` (1), `corn kernel fresh frozen or roasted` (1), `corn kernel fresh thawed from frozen or canned` (1), `fresh spinach or frozen thawed and squeezed dry` (1), `frozen corn` (1), `frozen cylindrical rice cake optional or rice noodle or pasta or steamed rice` (1), `frozen pea optional` (1).

- **Beverages:** 23 identities / 51 occurrences. Top: `water` (25), `pineapple juice` (3), `orange juice` (2), `splash white wine` (2), `⁄2 oz maraschino` (1), `⁄4 oz fresh grapefruit juice` (1), `1⁄2 oz mezcal` (1), `12 fl oz can or bottle beer` (1).

- **Other:** 285 identities / 380 occurrences. Top: `x` (18), `nutritional information` (10), `add to your grocery list` (9), `serving` (8), `minute` (7), `shop ingredient on instacart` (6), `for chicken` (5), `add ingredient to your grocery list` (4).

## Final recommended taxonomy simulation

| Category | Unique ingredients | Occurrences | % occurrences |
| --- | --- | --- | --- |
| Produce | 703 | 941 | 29.5% |
| Meat & Seafood | 105 | 122 | 3.82% |
| Dairy & Eggs | 119 | 153 | 4.8% |
| Bakery & Bread | 21 | 26 | 0.82% |
| Pantry & Dry Goods | 159 | 255 | 7.99% |
| Canned & Jarred | 90 | 114 | 3.57% |
| Sauces & Condiments | 237 | 449 | 14.08% |
| Spices & Seasonings | 225 | 646 | 20.25% |
| Nuts, Seeds & Nut Butters | 41 | 53 | 1.66% |
| Beverages | 23 | 51 | 1.6% |
| Other | 285 | 380 | 11.91% |

Recommended order and justification:

| Category | Purpose | Representative ingredients | Unique | Occurrences | Why separate |
| --- | --- | --- | --- | --- | --- |
| Produce | Fresh fruit, vegetables, herbs, and refrigerated plant proteins. | garlic clove minced, garlic minced, garlic, lemon juice, garlic clove grated | 703 | 941 | Coherent physical shopping section with repeated corpus use. |
| Meat & Seafood | Fresh/frozen-counter meat, poultry, and seafood; excludes stocks and fish/oyster sauces. | boneless skinless chicken thigh, boneless skinless chicken breast, bacon cut into small piece, ground chicken, ground pork | 105 | 122 | Coherent physical shopping section with repeated corpus use. |
| Dairy & Eggs | Animal dairy, cultured dairy, cheese, and eggs; excludes plant milks and coconut milk. | large egg, butter, egg, unsalted butter, crumbled feta | 119 | 153 | Coherent physical shopping section with repeated corpus use. |
| Bakery & Bread | Finished breads, rolls, tortillas, pitas, and similar bakery purchases. | corn tortilla, crusty bread, thick slice sourdough cut into cube, 6-inch corn tortilla, baguette or rustic crusty loaf | 21 | 26 | Sparse but physically distinct and already familiar; finished breads should not mix with dry pantry goods. |
| Pantry & Dry Goods | Grains, pasta/noodles, dry legumes, broth/stock, baking goods, and other shelf-stable dry goods. | honey, brown sugar, chicken broth, cornstarch, baking powder | 159 | 255 | Coherent physical shopping section with repeated corpus use. |
| Canned & Jarred | Foods whose purchase identity is explicitly canned/jarred, especially tomatoes, legumes, hominy, chiles, and coconut milk. | tomato paste, 15-ounce can chickpea drained and rinsed, 15-ounce can chickpea drained, 14-ounce can diced tomato, 14-ounce can full-fat coconut milk | 90 | 114 | Coherent physical shopping section with repeated corpus use. |
| Sauces & Condiments | Cooking oils, vinegars, sauces, condiments, pastes, preserves, and prepared accompaniments. | olive oil, soy sauce, extra-virgin olive oil, sesame oil, vegetable oil | 237 | 449 | Coherent physical shopping section with repeated corpus use. |
| Spices & Seasonings | Salt, pepper, dried herbs, ground/whole spices, and seasoning blends. | salt, ground cumin, black pepper, kosher salt, dried oregano | 225 | 646 | Coherent physical shopping section with repeated corpus use. |
| Nuts, Seeds & Nut Butters | Culinary nuts, edible seeds, tahini, and nut/seed butters; excludes spice seeds and oils. | sesame seed, peanut butter, cashew, sesame seed toasted, tahini | 41 | 53 | 53 occurrences and a distinct aisle/purchase family; fixes the strongest coherent Other cluster. |
| Beverages | Drinks and drink ingredients such as coffee, beer/wine, soda, water, and plant milks. | water, pineapple juice, orange juice, splash white wine, ⁄2 oz maraschino | 23 | 51 | Coherent physical shopping section with repeated corpus use. |
| Other | True exceptions plus corpus/parsing noise that should not be forced into a shopping section. | x, nutritional information, add to your grocery list, serving, minute | 285 | 380 | Necessary escape hatch while corpus noise and one-offs remain. |

## Current → proposed movement matrix

| Current category | Proposed category | Unique moved/staying | Occurrences |
| --- | --- | --- | --- |
| Produce | Produce | 682 | 918 |
| Produce | Meat & Seafood | 11 | 11 |
| Produce | Dairy & Eggs | 19 | 20 |
| Produce | Bakery & Bread | 6 | 9 |
| Produce | Pantry & Dry Goods | 28 | 40 |
| Produce | Canned & Jarred | 51 | 73 |
| Produce | Sauces & Condiments | 46 | 63 |
| Produce | Spices & Seasonings | 90 | 260 |
| Produce | Nuts, Seeds & Nut Butters | 13 | 15 |
| Produce | Beverages | 8 | 11 |
| Produce | Other | 35 | 36 |
| Meat & Seafood | Meat & Seafood | 92 | 109 |
| Meat & Seafood | Pantry & Dry Goods | 20 | 32 |
| Meat & Seafood | Sauces & Condiments | 10 | 15 |
| Meat & Seafood | Spices & Seasonings | 2 | 3 |
| Meat & Seafood | Other | 10 | 14 |
| Dairy & Eggs | Dairy & Eggs | 96 | 129 |
| Dairy & Eggs | Pantry & Dry Goods | 2 | 2 |
| Dairy & Eggs | Canned & Jarred | 8 | 9 |
| Dairy & Eggs | Sauces & Condiments | 10 | 10 |
| Dairy & Eggs | Spices & Seasonings | 3 | 3 |
| Dairy & Eggs | Nuts, Seeds & Nut Butters | 2 | 2 |
| Dairy & Eggs | Other | 3 | 3 |
| Bakery & Bread | Bakery & Bread | 13 | 15 |
| Bakery & Bread | Pantry & Dry Goods | 11 | 11 |
| Bakery & Bread | Other | 4 | 4 |
| Canned / Jarred / Sauces | Produce | 2 | 2 |
| Canned / Jarred / Sauces | Pantry & Dry Goods | 4 | 8 |
| Canned / Jarred / Sauces | Canned & Jarred | 23 | 24 |
| Canned / Jarred / Sauces | Sauces & Condiments | 93 | 201 |
| Canned / Jarred / Sauces | Spices & Seasonings | 4 | 4 |
| Canned / Jarred / Sauces | Nuts, Seeds & Nut Butters | 3 | 4 |
| Canned / Jarred / Sauces | Other | 12 | 16 |
| Beverages | Pantry & Dry Goods | 8 | 9 |
| Beverages | Sauces & Condiments | 23 | 62 |
| Beverages | Spices & Seasonings | 5 | 5 |
| Beverages | Beverages | 11 | 36 |
| Beverages | Other | 11 | 11 |
| Spices & Seasonings | Canned & Jarred | 4 | 4 |
| Spices & Seasonings | Sauces & Condiments | 4 | 4 |
| Spices & Seasonings | Spices & Seasonings | 75 | 209 |
| Spices & Seasonings | Other | 15 | 16 |
| Staples | Pantry & Dry Goods | 80 | 145 |
| Staples | Sauces & Condiments | 27 | 63 |
| Staples | Spices & Seasonings | 38 | 154 |
| Staples | Nuts, Seeds & Nut Butters | 2 | 2 |
| Staples | Other | 4 | 4 |
| Other | Produce | 19 | 21 |
| Other | Meat & Seafood | 2 | 2 |
| Other | Dairy & Eggs | 4 | 4 |
| Other | Bakery & Bread | 2 | 2 |
| Other | Pantry & Dry Goods | 6 | 8 |
| Other | Canned & Jarred | 4 | 4 |
| Other | Sauces & Condiments | 24 | 31 |
| Other | Spices & Seasonings | 8 | 8 |
| Other | Nuts, Seeds & Nut Butters | 21 | 30 |
| Other | Beverages | 4 | 4 |
| Other | Other | 191 | 276 |

| Movement type | Unique | Occurrences |
| --- | --- | --- |
| conceptually unchanged | 1160 | 1692 |
| classification bug: keyword/precedence | 397 | 691 |
| taxonomy change: Staples separation | 151 | 368 |
| taxonomy change: split combined section | 116 | 225 |
| classification gap: missing coverage | 94 | 114 |
| corpus/parsing noise exposed | 90 | 100 |

Interpretation: 1,160 identities / 1,692 occurrences stay in the same conceptual section; 397 / 691 move because of keyword/precedence defects; 151 / 368 move because `Staples` is removed as a shopping concept; 116 / 225 split the combined canned/sauce section; 94 / 114 gain missing coverage from `Other`; and 90 / 100 are revealed as corpus/parsing noise currently forced into a non-Other section.

## Category count and grocery-list UX

| Simulation | Min sections/recipe | Median | Average | Max | Singleton-section share |
| --- | --- | --- | --- | --- | --- |
| Current 9 | 2 | 5 | 5.14 | 8 | 43.6% |
| 13-category test | 2 | 6 | 6 | 9 | 48.75% |
| Recommended 11 | 2 | 6 | 5.79 | 9 | 45.4% |

No production week-plan collection was read because the prompt limited live access to shared `recipes`. The table is therefore a per-recipe section-density proxy, not an invented week. The 13-category test increases fragmentation while `Frozen` contributes only 12 occurrences and `Baking` only 85. The recommended 11 visible categories are a practical maximum for this corpus; a typical plan will show only nonempty sections, but adding more sparse sections would create one-item cards and slower scanning.

## Categories considered but rejected

| Candidate | Decision | Evidence |
| --- | --- | --- |
| Baking | Reject as separate section for now | 41 identities / 85 occurrences (2.66%); fold into Pantry & Dry Goods to reduce one-item sections. |
| Frozen | Reject as separate section for now | 11 identities / 12 occurrences (0.38%); route frozen produce/meat/bread to their product family until corpus usage grows. |
| Staples | Remove as category | 151 identities / 368 occurrences across eight store concepts; it describes possession status, not location. |
| Single Canned / Jarred / Sauces catch-all | Split | 225 occurrences move through the split; canned foods and condiment/oil purchases are physically and conceptually different. |
| Separate oils/vinegars category | Reject | Sauces & Condiments is coherent enough and avoids another sparse section. |

## Rule-precedence fixes required regardless of taxonomy decision

1. Replace unrestricted `includes` matching with token/phrase boundaries and explicit purchase-form rules; otherwise `gin` in `virgin`, `tea` in `teaspoon`, `pea` in `peanut/pearl`, and `roll` in `rolled` will recur.
2. Match high-specificity forms before base ingredients: powders/dried herbs/black pepper before fresh garlic/onion/herbs/pepper; tomato paste/canned tomatoes before tomato; coconut/plant milk before generic milk; broth/stock and sauces before animal/vegetable names; oils/vinegars before fruit/vegetable/alcohol words.
3. Remove generic `fresh`, `produce`, `vegetable`, `fruit`, `herb`, `pepper`, `pea`, and similar substring rules unless constrained by boundaries or stronger context.
4. Treat explicit can/jar state as purchase identity and apply it before ingredient-family rules.
5. Add regression cases from this corpus, including every explicit collision above and negative controls (bell pepper remains Produce; garlic remains Produce; dairy milk remains Dairy & Eggs; actual gin/tea/soda remain Beverages).
6. Address source-content/subheader noise separately. Category rules must not be used as a substitute for removing `For the sauce`, page buttons, nutrition chrome, or non-recipe workflow prose from ingredient extraction.

## iOS compatibility

**Status: unable to verify exact-string requirement.** Repository evidence consists of the comment `// iOS-compatible category values — must match exactly`, the PRD statement that the web and iOS app share Firestore, and persisted category-string fields. No Swift source, iOS enum, schema, fixture, API contract, or external iOS repository is present here. The comment cannot independently prove the current iOS implementation.

A taxonomy change nevertheless requires coordination: synchronize the ordered/displayed category values and fallback behavior in both clients; accept legacy `manualSection` and `defaultCategory` strings during rollout; decide whether iOS recomputes auto categories locally; and verify AI-cleanup results and any category picker use the same values. Do not ship web-only string changes until that contract is inspected.

## Saved/manual category and historical-data impact

- `GroceryItem.manualSection` persists category names directly. Existing manual overrides would become legacy values if a category is renamed/removed; reads need an alias/fallback strategy and an eventual migration only after both clients understand the new values.
- `SavedGroceryItem.defaultCategory` also persists category strings. Autocomplete/quick-add reuses the saved value, so legacy defaults need the same compatibility mapping or migration.
- Auto recipe grocery items do not persist an auto category; without `manualSection`, they are categorized at render time and would immediately follow new rules.
- Current grocery documents with manual sections and saved items were not read, so the number of legacy values requiring handling is unknown.
- `Staples` should disappear from category choices and auto assignment when the taxonomy changes. It should not become manually selectable. If staple status is later built, represent it as a separate flag/preference rather than `manualSection`.

## AI grocery cleanup impact

The cleanup contract is centralized correctly: the route prompt derives its exact list from `GROCERY_CATEGORIES`, and `sanitizeGroceryCleanupChanges` validates returned values against that array before applying them, falling back to local categorization. A future taxonomy change must update the central list/rules, prompt guidance for new/removed sections, category emoji/pickers, and tests. The Zod field is intentionally a bounded string rather than a duplicated enum; shared sanitization is the enforcement point.

## Recommended implementation sequence

1. **Fix deterministic classification first:** boundary-aware matching, specificity ordering, explicit form rules, and corpus-derived regression fixtures. Keep current strings during this step so rule fixes and product taxonomy are reviewable separately.
2. **Confirm the iOS contract and approve the 11-category taxonomy:** inspect the actual iOS enum/logic, agree on synchronized values/order, and decide rollout aliases.
3. **Add compatibility handling:** read-time aliases for legacy `Staples` and `Canned / Jarred / Sauces` manual/saved values; inventory user-scoped stored values read-only; then plan any reviewed migration.
4. **Update all consumers together:** `GROCERY_CATEGORIES`, category rules, emoji/order, manual picker, AI prompt guidance, shared validation, web tests, and iOS equivalents.
5. **Regression-test against the actual corpus:** freeze a sanitized category fixture or expected high-frequency set, rerun the movement audit, and verify no substring regressions. Separately investigate recipe-content contamination so non-food lines never enter grocery creation.

## Validation and safety

Fresh test baseline before documentation: `npm test` — **PASS**, 24 files passed / 1 skipped; 138 tests passed / 1 skipped (139 total).

Final verification:

- `node scripts/audit-grocery-taxonomy.mjs --report docs/audits/grocery-category-taxonomy-audit-2026-08-22.md` — **PASS**; live read-only rerun reproduced 216/214/3,190/2,008 totals and all distribution/movement invariants.
- `npm run typecheck` — **PASS** (exit 0).
- `npm run lint` — **PASS** with 0 errors and 6 pre-existing warnings (five `no-img-element`, one unused eslint-disable).
- `npm run build` — **PASS**; Next.js 16.3.1 compiled and generated 26 pages.
- `npm test` — **PASS**; 24 files passed / 1 skipped, 138 tests passed / 1 skipped (139 total). New tests: 0; the analyzer has internal completeness/rule-parity assertions.

| Mutation/deployment | Result |
| --- | --- |
| Recipe writes | 0 |
| Grocery writes | 0 |
| Saved-item writes | 0 |
| Firestore mutation | 0 |
| Firebase deployment | none |
| Firestore rules/index deployment | none |
| Vercel deployment | none |
| Environment changes | none |

## Unverifiable items and data limitations

- Exact iOS string enum/logic: unavailable in this repository.
- Counts of persisted legacy `manualSection`/`defaultCategory` values: user-scoped collections were intentionally not read.
- Representative real-week section count: user week plans were intentionally not read; per-recipe frequency/section density was used instead.
- Two catalog records remain unparseable: `maple-roasted-candied-pecans` and `smoothies`.
- The proposed simulation is deterministic and corpus-specific, but mixed multi-product lines and malformed content still require human review; the script records confidence rather than claiming perfect ground truth.

## Appendix A — All current Other identities

| Ingredient | Freq. | Recipes | Raw example | Cluster | Recommended |
| --- | --- | --- | --- | --- | --- |
| x | 18 | 6 | 1 x | page chrome / parsing noise | Other |
| nutritional information | 10 | 10 | Nutritional Information | page chrome / parsing noise | Other |
| add to your grocery list | 9 | 9 | Add to Your Grocery List | page chrome / parsing noise | Other |
| serving | 8 | 8 | 4 servings | page chrome / parsing noise | Other |
| sesame seed | 8 | 8 | 1 tablespoon sesame seeds | nuts/seeds/nut butters | Nuts, Seeds & Nut Butters |
| minute | 7 | 4 | 30 minutes | page chrome / parsing noise | Other |
| shop ingredient on instacart | 6 | 6 | Shop ingredients on Instacart | page chrome / parsing noise | Other |
| add ingredient to your grocery list | 4 | 4 | Add ingredients to your Grocery List | page chrome / parsing noise | Other |
| oil | 4 | 4 | - 1/4 cup oil | international sauces / condiments | Sauces & Condiments |
| comment | 3 | 3 | Comments | page chrome / parsing noise | Other |
| farro | 3 | 3 | 1 cup farro | specialty pantry / baking | Pantry & Dry Goods |
| for salad | 3 | 3 | For the Salad | page chrome / parsing noise | Other |
| gochujang | 3 | 3 | 3 tablespoons gochujang | international sauces / condiments | Sauces & Condiments |
| metric conversion | 3 | 3 | Metric conversion: | page chrome / parsing noise | Other |
| note | 3 | 3 | Notes: | page chrome / parsing noise | Other |
| these recipe were created in us customary measurement and conversion to metric is being done by calculation they should be accurate but it is possible there could be error if you find one please let us know in comment at bottom of page | 3 | 3 | These recipes were created in US Customary measurements and the conversion to metric is being done by calculations. They should be accurate… | page chrome / parsing noise | Other |
| minute minute | 3 | 1 | 10 minutes minutes | page chrome / parsing noise | Other |
| 14-ounce block extra-firm tofu pressed and cubed | 2 | 2 | 1 (14-ounce) block extra-firm tofu, pressed and cubed | missing keyword → Produce | Produce |
| add ingredient to grocery list | 2 | 2 | Add ingredients to Grocery List | page chrome / parsing noise | Other |
| bowl | 2 | 2 | Bowl: | page chrome / parsing noise | Other |
| cashew | 2 | 2 | - 2 tablespoons cashews | nuts/seeds/nut butters | Nuts, Seeds & Nut Butters |
| extra | 2 | 2 | Extras | page chrome / parsing noise | Other |
| for stir-fry | 2 | 2 | For the stir-fry | page chrome / parsing noise | Other |
| get guide for free | 2 | 2 | Get the guide for FREE | page chrome / parsing noise | Other |
| hour | 2 | 2 | 1 hour | page chrome / parsing noise | Other |
| hummus | 2 | 2 | hummus | international sauces / condiments | Sauces & Condiments |
| mirin | 2 | 2 | 2 tablespoons mirin | international sauces / condiments | Sauces & Condiments |
| opt out or contact us anytime see our privacy policy | 2 | 2 | Opt out or contact us anytime. See our Privacy Policy. | page chrome / parsing noise | Other |
| our latest newsletter | 2 | 2 | OUR LATEST NEWSLETTER | page chrome / parsing noise | Other |
| secret of authentic chinese cooking | 2 | 2 | 5 Secrets of Authentic Chinese Cooking | page chrome / parsing noise | Other |
| sesame seed toasted | 2 | 2 | 1 tablespoon sesame seeds, toasted | nuts/seeds/nut butters | Nuts, Seeds & Nut Butters |
| tomatillo | 2 | 2 | 2 pounds tomatillos | missing keyword → Produce | Produce |
| unit usm | 2 | 2 | UNITS USM | page chrome / parsing noise | Other |
| us customary - metric | 2 | 2 | US Customary - Metric | page chrome / parsing noise | Other |
| award-pay-remove single contract transaction | 2 | 1 | - Award-Pay-Remove single contract transactions | non-food corpus contamination | Other |
| bidder | 2 | 1 | - Bidder | non-food corpus contamination | Other |
| change contract amount | 2 | 1 | - Change Contract amount | non-food corpus contamination | Other |
| notice of award screen are 2 screen we need | 2 | 1 | - Notice of award screen are the 2 screens we need. | page chrome / parsing noise | Other |
| payment | 2 | 1 | - Payments | non-food corpus contamination | Other |
| sale | 2 | 1 | - Sales | non-food corpus contamination | Other |
| sale transaction screen and | 2 | 1 | - Sales Transaction screen and | non-food corpus contamination | Other |
| — action such as update wire amount could be done here | 1 | 1 | - — Actions such as update wire amount could be done here | genuinely miscellaneous / unresolved | Other |
| — default bidder | 1 | 1 | - — Default a bidder | non-food corpus contamination | Other |
| — see history of vehicle | 1 | 1 | - — See the history of a vehicle | non-food corpus contamination | Other |
| “close register” button to close register | 1 | 1 | - “Close Register” button to close the register | non-food corpus contamination | Other |
| ⁄2 oz maraschino | 1 | 1 | 1⁄2 oz. maraschino | missing keyword → Beverages | Beverages |
| 0 7 oz package dry italian-style salad dressing mix | 1 | 1 | - 1 (0.7 oz) package dry Italian-style salad dressing mix | genuinely miscellaneous / unresolved | Other |
| 1⁄2 oz mezcal | 1 | 1 | 1 1⁄2 oz. mezcal | missing keyword → Beverages | Beverages |
| 10 167 | 1 | 1 | (10,167) | page chrome / parsing noise | Other |
| 12-ounce can or bottle of mexican lager such as tecate or modelo | 1 | 1 | 1 (12-ounce) can or bottle of Mexican lager, such as Tecate or Modelo | missing keyword → Beverages | Beverages |
| 12-ounce package soft or silken tofu | 1 | 1 | 1 (12-ounce) package soft or silken tofu | missing keyword → Produce | Produce |
| 14- to 16-ounce block extra-firm tofu cut into ½-inch cube and patted dry | 1 | 1 | 1 (14- to 16-ounce) block extra-firm tofu, cut into ½-inch cubes and patted dry | missing keyword → Produce | Produce |
| 14- to 16-ounce block extrafirm tofu cut into ½-inch cube | 1 | 1 | 1 (14- to 16-ounce) block extrafirm tofu, cut into ½-inch cubes | missing keyword → Produce | Produce |
| 14-ounce package extra-firm tofu | 1 | 1 | 1 (14-ounce) package extra-firm tofu | missing keyword → Produce | Produce |
| 15 oz hominy drained | 1 | 1 | - 1 can (15 oz) hominy, drained | specialty pantry / baking | Pantry & Dry Goods |
| 15-ounce can bean drained | 1 | 1 | 2 (15-ounce) cans beans, drained | missing keyword → Canned & Jarred | Canned & Jarred |
| 15-ounce can hominy drained | 1 | 1 | 2 (15-ounce) cans hominy, drained | missing keyword → Canned & Jarred | Canned & Jarred |
| 15oz can great northern bean drained and rinsed | 1 | 1 | - 2 15oz cans great Northern beans, drained and rinsed | missing keyword → Canned & Jarred | Canned & Jarred |
| 425 | 1 | 1 | (425) | page chrome / parsing noise | Other |
| 794 | 1 | 1 | (794) | page chrome / parsing noise | Other |
| additional optional add ins | 1 | 1 | Additional optional add ins: | page chrome / parsing noise | Other |
| additional topping optional | 1 | 1 | Additional Toppings (Optional) | page chrome / parsing noise | Other |
| admin financial function | 1 | 1 | - Admin, Financial Functions | page chrome / parsing noise | Other |
| all but last 2 | 1 | 1 | - All but last 2 | page chrome / parsing noise | Other |
| allow for manual collection of remaining balance for pay amend | 1 | 1 | - Allows for manual collection of remaining balance for the pay amend | page chrome / parsing noise | Other |
| almond | 1 | 1 | 1/2 cup almonds | nuts/seeds/nut butters | Nuts, Seeds & Nut Butters |
| anything else you want | 1 | 1 | Anything else you want! | page chrome / parsing noise | Other |
| apricot preserve | 1 | 1 | 1/3 cup apricot preserves | international sauces / condiments | Sauces & Condiments |
| are we getting 3rd party internet auction payment data via sasy how do we know how much internet sale was for | 1 | 1 | - ARE WE GETTING 3rd PARTY INTERNET AUCTION PAYMENT DATA?! VIA SASY??? How do we know how much an internet sale was for???? | non-food corpus contamination | Other |
| aromatic | 1 | 1 | Aromatics | page chrome / parsing noise | Other |
| basically activity tracker for contract who did what need to know what lvl they need show each action per row | 1 | 1 | - Basically an activity tracker for the contract. Who did what. Need to know what lvl they need. Shows each action per row. | non-food corpus contamination | Other |
| bean sprout | 1 | 1 | 1 cup bean sprouts | missing keyword → Produce | Produce |
| bean sprout about 1 ½ cup | 1 | 1 | 80 g bean sprouts, about 1 ½ cup | missing keyword → Produce | Produce |
| best gazpacho forever | 1 | 1 | Best Gazpacho Forever | page chrome / parsing noise | Other |
| bidder lookup | 1 | 1 | - Bidder lookup | non-food corpus contamination | Other |
| block of extra firm tofu high protein tofu work really well in this recipe if you can find it | 1 | 1 | 1 block of extra firm tofu (high protein tofu works really well in this recipe, if you can find it!) | missing keyword → Produce | Produce |
| boneless chuck roast cut into 6 piece | 1 | 1 | - 4 pound boneless chuck roast, cut into 6 pieces | missing keyword → Meat & Seafood | Meat & Seafood |
| brussel sprout | 1 | 1 | 1 ½ pounds Brussels sprouts | missing keyword → Produce | Produce |
| brussel sprout thinly sliced about 1 1/2 cup | 1 | 1 | ¼ pound brussels sprouts, thinly sliced (about 1 1/2 cups) | missing keyword → Produce | Produce |
| brussel sprout trimmed and very thinly sliced about 5 tightly packed cup | 1 | 1 | 1 pound brussels sprouts, trimmed and very thinly sliced (about 5 tightly packed cups) | missing keyword → Produce | Produce |
| brusselsprout | 1 | 1 | brusselsprouts | missing keyword → Produce | Produce |
| build bowl | 1 | 1 | Build the Bowls: | genuinely miscellaneous / unresolved | Other |
| by alyssa river | 1 | 1 | By: Alyssa Rivers | page chrome / parsing noise | Other |
| can we see example of register creation and register closure | 1 | 1 | - Can we see an example of register creation and register closure | non-food corpus contamination | Other |
| can’t sell vehicle again till pegasus is cleared | 1 | 1 | - Can’t sell vehicle again till Pegasus is cleared. | non-food corpus contamination | Other |
| canollini bean | 1 | 1 | Canollini beans | genuinely miscellaneous / unresolved | Other |
| caraway seed | 1 | 1 | ½ teaspoon caraway seeds | missing keyword → Spices & Seasonings | Spices & Seasonings |
| change check number cd cc or wire transfer | 1 | 1 | - Change Check Number, CD, CC or Wire Transfer | non-food corpus contamination | Other |
| change wire number | 1 | 1 | - Change Wire number | non-food corpus contamination | Other |
| change wire number from dummy number which sco may have to do to real wire number | 1 | 1 | - Change the wire number from dummy number (which the SCO may have to do) to the real wire number | non-food corpus contamination | Other |
| chia seed optional | 1 | 1 | 1–2 tbsp chia seeds (optional) | nuts/seeds/nut butters | Nuts, Seeds & Nut Butters |
| chopped pistachio nut ½ cup | 1 | 1 | 70 grams chopped pistachio nuts (½ cup) | nuts/seeds/nut butters | Nuts, Seeds & Nut Butters |
| chopped pistachio optional | 1 | 1 | 1/2 cup chopped pistachios (optional) | nuts/seeds/nut butters | Nuts, Seeds & Nut Butters |
| chopped walnut | 1 | 1 | ¼ cup chopped walnuts | nuts/seeds/nut butters | Nuts, Seeds & Nut Butters |
| classic memorable must-make salad | 1 | 1 | 23 Classic, Memorable, Must-Make Salads | genuinely miscellaneous / unresolved | Other |
| close register when sco say sale is done | 1 | 1 | - close a register when SCO says the sale is done | non-food corpus contamination | Other |
| closing register mean register is ready for finance | 1 | 1 | - Closing the register means the register is ready for Finance | non-food corpus contamination | Other |
| compare to 3169 to make sure everything match | 1 | 1 | - Compare to 3169 to make sure everything matches | genuinely miscellaneous / unresolved | Other |
| complete sale resolution overnight report which is used in sale file not sure what it include | 1 | 1 | - Complete Sales Resolution: Overnight report which is used in sale file. NOT SURE WHAT IT INCLUDES | non-food corpus contamination | Other |
| contract | 1 | 1 | - Contracts | non-food corpus contamination | Other |
| contract about 7 min in | 1 | 1 | - Contracts (about 7 mins in) | non-food corpus contamination | Other |
| contract history | 1 | 1 | - Contract history | non-food corpus contamination | Other |
| contract history transaction screen | 1 | 1 | - Contracts History Transaction Screen | non-food corpus contamination | Other |
| contract transaction | 1 | 1 | - Contract Transaction | non-food corpus contamination | Other |
| contract transaction refund around 29 min | 1 | 1 | - Contract Transactions (REFUNDS) (around 29 mins) | non-food corpus contamination | Other |
| cooked biscuit for serving | 1 | 1 | - Cooked biscuits for serving | missing keyword → Bakery & Bread | Bakery & Bread |
| cooking spray | 1 | 1 | - cooking spray | international sauces / condiments | Sauces & Condiments |
| create register for that default payment | 1 | 1 | - Creates a register for that default payment | non-food corpus contamination | Other |
| crispy tofu | 1 | 1 | Crispy Tofu: | page chrome / parsing noise | Other |
| default | 1 | 1 | - Defaults | page chrome / parsing noise | Other |
| default payment collection | 1 | 1 | - Default payment collection | non-food corpus contamination | Other |
| default transaction | 1 | 1 | - Defaults transaction | non-food corpus contamination | Other |
| do they need check and credit card number change | 1 | 1 | - DO THEY NEED CHECK and CREDIT CARD NUMBER CHANGES??? | genuinely miscellaneous / unresolved | Other |
| doesn’t use “return item” or “load” under “items” section | 1 | 1 | - Doesn’t use “Return Item” or “Load” under “Items” section | genuinely miscellaneous / unresolved | Other |
| doesn’t use lot of this | 1 | 1 | - Doesn’t use a lot of this | genuinely miscellaneous / unresolved | Other |
| dressing | 1 | 1 | Dressing: | page chrome / parsing noise | Other |
| dressing of choice see note | 1 | 1 | dressing of choice (see notes) | genuinely miscellaneous / unresolved | Other |
| dried cranberry | 1 | 1 | - 1 cup dried cranberries | genuinely miscellaneous / unresolved | Other |
| dried fig | 1 | 1 | - 1 cup dried figs | genuinely miscellaneous / unresolved | Other |
| dried red chily optional | 1 | 1 | 3 dried red chilies (optional) | genuinely miscellaneous / unresolved | Other |
| dry red bean | 1 | 1 | - 1 pound dry red beans | specialty pantry / baking | Pantry & Dry Goods |
| email grocery list | 1 | 1 | Email Grocery List | page chrome / parsing noise | Other |
| enchilada | 1 | 1 | Enchiladas | page chrome / parsing noise | Other |
| enter sale/contract and bidder information | 1 | 1 | - enter sale/contract and bidder information. | non-food corpus contamination | Other |
| extra for serving | 1 | 1 | Extras for Serving: | genuinely miscellaneous / unresolved | Other |
| facility transaction | 1 | 1 | - Facility Transactions | non-food corpus contamination | Other |
| farfalle | 1 | 1 | 8 ounces farfalle | genuinely miscellaneous / unresolved | Other |
| featured in 5 easy meal for distracted cook | 1 | 1 | Featured in: 5 Easy Meals for the Distracted Cook | page chrome / parsing noise | Other |
| final sale/lot status when everything is paid you run this report to breakdown every vehicle who got it and how they paid | 1 | 1 | - Final Sale/Lot Status: When everything is paid you run this report to breakdown every vehicle who got it and how they paid | non-food corpus contamination | Other |
| firm tofu cut into 3 cm / 1 1/4″ baton see photo | 1 | 1 | 1/2 cup firm tofu, cut into 3 cm / 1 1/4″ batons (see photo) | missing keyword → Produce | Produce |
| flaxseed or chia | 1 | 1 | 1 tbsp flaxseed or chia | nuts/seeds/nut butters | Nuts, Seeds & Nut Butters |
| for assembly | 1 | 1 | For Assembly | page chrome / parsing noise | Other |
| for dressing | 1 | 1 | FOR THE DRESSING | page chrome / parsing noise | Other |
| for filling | 1 | 1 | For the Filling | page chrome / parsing noise | Other |
| for mediterranean bowl build your own bowl based on what you like | 1 | 1 | For the Mediterranean Bowls (build your own bowls based on what you like) | page chrome / parsing noise | Other |
| for ramen | 1 | 1 | FOR THE RAMEN: | page chrome / parsing noise | Other |
| for serving= | 1 | 1 | FOR SERVING=: | page chrome / parsing noise | Other |
| for stir fry | 1 | 1 | For the stir fry | page chrome / parsing noise | Other |
| for taco | 1 | 1 | For the Tacos | page chrome / parsing noise | Other |
| for topping | 1 | 1 | For the Toppings | page chrome / parsing noise | Other |
| from 77 vote | 1 | 1 | 4.82 from 77 votes | page chrome / parsing noise | Other |
| furikake | 1 | 1 | furikake | missing keyword → Spices & Seasonings | Spices & Seasonings |
| garnish optional | 1 | 1 | GARNISHES (OPTIONAL): | page chrome / parsing noise | Other |
| gochugaru | 1 | 1 | 4 teaspoons gochugaru | missing keyword → Spices & Seasonings | Spices & Seasonings |
| gochujang optional | 1 | 1 | 1 tablespoon gochujang (optional) | international sauces / condiments | Sauces & Condiments |
| gochujang plus more to taste for serving | 1 | 1 | 4 teaspoons gochujang, plus more to taste, for serving | international sauces / condiments | Sauces & Condiments |
| grated pecorino romano | 1 | 1 | 1 cup grated Pecorino Romano | missing keyword → Dairy & Eggs | Dairy & Eggs |
| green chilly | 1 | 1 | - 2 green chillies | genuinely miscellaneous / unresolved | Other |
| grey poupon 1 tbsp | 1 | 1 | Grey Poupon 1 TBSP | international sauces / condiments | Sauces & Condiments |
| ground fenugreek | 1 | 1 | ¼ teaspoon ground fenugreek | missing keyword → Spices & Seasonings | Spices & Seasonings |
| ground flaxseed | 1 | 1 | ¼ cup ground flaxseed | nuts/seeds/nut butters | Nuts, Seeds & Nut Butters |
| half-and-half | 1 | 1 | - 1/2 cup half-and-half | missing keyword → Dairy & Eggs | Dairy & Eggs |
| history of vehicle including bidder info for winner | 1 | 1 | - history of vehicle including bidder info for the winner. | non-food corpus contamination | Other |
| homemade or storebought pico de gallo drained | 1 | 1 | ¾ cup homemade or storebought pico de gallo, drained | international sauces / condiments | Sauces & Condiments |
| how can we allow sco to lookup pay gov info such as transaction data | 1 | 1 | - How can we allow SCO to lookup pay.gov info such as transaction data. | non-food corpus contamination | Other |
| how do we have to communicate with kc if we reopen | 1 | 1 | - How do we have to communicate with KC if we reopen???? | genuinely miscellaneous / unresolved | Other |
| i am thinking | 1 | 1 | - I am thinking: | page chrome / parsing noise | Other |
| i don’t think they would need it as amount can be changed by updating run sale amount | 1 | 1 | - I don’t think they would need it as amounts can be changed by updating the run sale amount | missing keyword → Canned & Jarred | Canned & Jarred |
| i don’t think we allow for dummy eft number in fleet gov - do we need to confirm | 1 | 1 | - I don’t think we allow for dummy EFT numbers in fleet.gov - do we need to? CONFIRM | page chrome / parsing noise | Other |
| i guess it is for sale date change for sale transaction but i feel like this can be done in sale event mgmt screen and it will alway feed this screen | 1 | 1 | - I guess it is for sale date change for sales transactions. But I feel like this can be done in Sale event mgmt screen and it will always … | non-food corpus contamination | Other |
| i think this is for refund only need to confirm | 1 | 1 | - I think this is for refunds only. Need to confirm | non-food corpus contamination | Other |
| i wonder if we are just going continue register by sale we can just have access to vehicle listing page organized by sale maybe sale event mgmt page and sale listing page for sasy but emulated from sco view | 1 | 1 | - I wonder if we are just going continue registers by sale we can just have access to vehicle listing pages organized by sale. Maybe sale e… | non-food corpus contamination | Other |
| if contract has been awarded but there are remaining balance | 1 | 1 | - If a contract has been awarded but there are remaining balance | non-food corpus contamination | Other |
| invitation for bid request info about vehicle | 1 | 1 | - Invitation for bid request: Info about vehicles | non-food corpus contamination | Other |
| item | 1 | 1 | - Items | page chrome / parsing noise | Other |
| item query | 1 | 1 | - Item Query | genuinely miscellaneous / unresolved | Other |
| kc are one that actually do refund | 1 | 1 | - KC are the ones that actually do the refund. | non-food corpus contamination | Other |
| kimchi | 1 | 1 | ½ cup kimchi | international sauces / condiments | Sauces & Condiments |
| kimchi for serving optional | 1 | 1 | Kimchi, for serving (optional) | international sauces / condiments | Sauces & Condiments |
| kimchi roughly chopped | 1 | 1 | ½ cup kimchi, roughly chopped | international sauces / condiments | Sauces & Condiments |
| lard | 1 | 1 | 1 ⅓ cup of Lard | international sauces / condiments | Sauces & Condiments |
| large red chilli finely sliced | 1 | 1 | 1 tbsp large red chilli , finely sliced | genuinely miscellaneous / unresolved | Other |
| large ripe dark-skinned plantain peeled thickly sliced | 1 | 1 | ½ Large ripe dark-skinned plantain peeled, thickly sliced | missing keyword → Produce | Produce |
| lightly toasted almond chopped | 1 | 1 | ¼ cup lightly toasted almonds, chopped | nuts/seeds/nut butters | Nuts, Seeds & Nut Butters |
| lightly toasted pistachio | 1 | 1 | ¼ cup lightly toasted pistachios | nuts/seeds/nut butters | Nuts, Seeds & Nut Butters |
| likely don’t need it | 1 | 1 | - Likely don’t need it | genuinely miscellaneous / unresolved | Other |
| liquidated damage payment | 1 | 1 | - Liquidated damages payments | non-food corpus contamination | Other |
| lock it down or have associated locations/zone for close out leave it open | 1 | 1 | - Lock it down or have associated locations/zones for close out? Leave it open | genuinely miscellaneous / unresolved | Other |
| look up individual vehicle by tag vin sale number | 1 | 1 | - Look up individual vehicle by tag; Vin; Sale Number | non-food corpus contamination | Other |
| lookup bidding history of specific bidder do we need that | 1 | 1 | - Lookup bidding history of a specific bidder. DO WE NEED THAT? | non-food corpus contamination | Other |
| lookup by specific contract vehicle | 1 | 1 | - Lookup by specific contract (vehicle) | non-food corpus contamination | Other |
| make all sco report pullable from zvrc | 1 | 1 | - Make all the SCO reports pullable from the ZVRC | page chrome / parsing noise | Other |
| manually awarding contract | 1 | 1 | - Manually awarding a contract | non-food corpus contamination | Other |
| masa | 1 | 1 | 2 to 3 tablespoons masa | specialty pantry / baking | Pantry & Dry Goods |
| maybe automatically create register for each sale and allow user to “split” register if needed and they will select which vehicle to split off into new register | 1 | 1 | - Maybe automatically create a register for each sale and allow user to “split” the register if needed and they will select which vehicles … | non-food corpus contamination | Other |
| minute including 30 minute marinating | 1 | 1 | 40 minutes (including 30 minutes' marinating) | genuinely miscellaneous / unresolved | Other |
| mung bean sprout | 1 | 1 | 100 g mung bean sprouts | missing keyword → Produce | Produce |
| need clarity on why they use sale transaction | 1 | 1 | - Need clarity on why they use Sales Transaction | non-food corpus contamination | Other |
| non-pay gov transaction are handled by kc who write check to buyer | 1 | 1 | - NON-Pay.gov transactions are handled by KC who writes a check to the buyer | non-food corpus contamination | Other |
| nonstick cooking spray for greasing | 1 | 1 | nonstick cooking spray, for greasing | international sauces / condiments | Sauces & Condiments |
| note this should be trigger to pegaysus and lifecycle indicator moving forward | 1 | 1 | - NOTE: THIS SHOULD BE THE TRIGGER TO PEGAYSUS AND LIFECYCLE INDICATOR MOVING FORWARD | genuinely miscellaneous / unresolved | Other |
| notice of award or purchaser receipt | 1 | 1 | - notice of award or purchasers receipt. | page chrome / parsing noise | Other |
| oil for deep-fat frying | 1 | 1 | - Oil for deep-fat frying | international sauces / condiments | Sauces & Condiments |
| oil for pan | 1 | 1 | oil for the pan | international sauces / condiments | Sauces & Condiments |
| oil or lard to fry ingredient | 1 | 1 | ½ Cup of oil or lard to fry the ingredients | international sauces / condiments | Sauces & Condiments |
| on stove | 1 | 1 | ON THE STOVE | genuinely miscellaneous / unresolved | Other |
| optional 2–3 tbsp chopped walnut or dark chocolate chip | 1 | 1 | Optional: 2–3 tbsp chopped walnuts or dark chocolate chips | page chrome / parsing noise | Other |
| optional addition | 1 | 1 | Optional Additions: | page chrome / parsing noise | Other |
| optional extra | 1 | 1 | Optional Extras: | page chrome / parsing noise | Other |
| or 2 pinch asafetida or hing optional | 1 | 1 | 1 or 2 pinches asafetida or hing (optional) | missing keyword → Spices & Seasonings | Spices & Seasonings |
| paneer sliced thick optional | 1 | 1 | - 1 cup paneer, sliced thick (optional) | missing keyword → Dairy & Eggs | Dairy & Eggs |
| pay and remove transaction | 1 | 1 | - Pay and Remove Transaction | non-food corpus contamination | Other |
| pay gov payment can be automatically refunded from sasy to buyer | 1 | 1 | - Pay.gov payments can be automatically refunded from SASy to the buyer | non-food corpus contamination | Other |
| payment type and when those were collected | 1 | 1 | - Payment types and when those were collected | non-food corpus contamination | Other |
| pecan | 1 | 1 | ½ cup pecans | nuts/seeds/nut butters | Nuts, Seeds & Nut Butters |
| pegasus update are manually done by finance kc | 1 | 1 | - Pegasus updates are manually done by Finance (KC) | non-food corpus contamination | Other |
| pico de gallo | 1 | 1 | 2 cups Pico de Gallo | international sauces / condiments | Sauces & Condiments |
| pico de gallo for serving optional | 1 | 1 | Pico de gallo, for serving (optional) | international sauces / condiments | Sauces & Condiments |
| pinch of asafoetida | 1 | 1 | Pinch of asafoetida | missing keyword → Spices & Seasonings | Spices & Seasonings |
| pine nut | 1 | 1 | 1/4 cup pine nuts | nuts/seeds/nut butters | Nuts, Seeds & Nut Butters |
| pine nut or walnut | 1 | 1 | 2 tablespoons pine nuts or walnuts | nuts/seeds/nut butters | Nuts, Seeds & Nut Butters |
| pomegranate molasses | 1 | 1 | 1 teaspoon pomegranate molasses | specialty pantry / baking | Sauces & Condiments |
| prep | 1 | 1 | PREP | page chrome / parsing noise | Other |
| prevent your screen from going dark | 1 | 1 | Prevent your screen from going dark | page chrome / parsing noise | Other |
| protein | 1 | 1 | Proteins | page chrome / parsing noise | Other |
| psyllium husk | 1 | 1 | 1 tsp psyllium husk | specialty pantry / baking | Pantry & Dry Goods |
| purchase order processing from sas | 1 | 1 | - Purchase order processing from SAS | genuinely miscellaneous / unresolved | Other |
| queso fresco about 3 tablespoon per bowl | 1 | 1 | Queso fresco (about 3 tablespoons per bowl) | missing keyword → Dairy & Eggs | Dairy & Eggs |
| question | 1 | 1 | - Questions: | page chrome / parsing noise | Other |
| raisin | 1 | 1 | ½ Cup of raisins | genuinely miscellaneous / unresolved | Other |
| read 140 comment | 1 | 1 | Read 140 comments | page chrome / parsing noise | Other |
| read 221 comment | 1 | 1 | Read 221 comments | page chrome / parsing noise | Other |
| read 782 comment | 1 | 1 | Read 782 comments | page chrome / parsing noise | Other |
| red curry paste | 1 | 1 | 1 tablespoon red curry paste | international sauces / condiments | Sauces & Condiments |
| red curry paste currently loving maesri or thai kitchen brand | 1 | 1 | 1 1/2 tablespoons red curry paste (currently loving Maesri or Thai Kitchen brand) | international sauces / condiments | Sauces & Condiments |
| refer to other note for this info | 1 | 1 | - Refer to other notes for this info. | genuinely miscellaneous / unresolved | Other |
| refund are done in sasy | 1 | 1 | - Refunds are done in SASy | non-food corpus contamination | Other |
| register creation for refund and claim how are they created and managed | 1 | 1 | - Register creation for refunds and claims. How are they created and managed? | non-food corpus contamination | Other |
| register listing screen which is were user can create register associate vehicle to register | 1 | 1 | - Register listing screen which is were a user can create registers; associate vehicles to registers; | non-food corpus contamination | Other |
| register mgmt page - see all vehicle associated with register and all relevant info for those vehicle register closure tab | 1 | 1 | - Register mgmt page - see all vehicles associated with registers and all relevant info for those vehicles; register closure tab | non-food corpus contamination | Other |
| register of remitiance closure | 1 | 1 | - Register of Remitiances closure | non-food corpus contamination | Other |
| register of remittance - reprint register same as report they print in register of remittance tab under previous admin/financial section | 1 | 1 | - Register of Remittance - Reprint the register: Same as the report they print in the register of remittance tab under previous admin/finan… | non-food corpus contamination | Other |
| reopen closed register | 1 | 1 | - Reopen closed register | non-food corpus contamination | Other |
| reopen closed register for whatever reason | 1 | 1 | - Reopen a closed register for whatever reason | non-food corpus contamination | Other |
| report | 1 | 1 | - Reports | page chrome / parsing noise | Other |
| report are run and lynn say she doesn’t run any other report from sasy for sale | 1 | 1 | - 4 reports are run and Lynn says she doesn’t run any other reports from SASy for the sale | non-food corpus contamination | Other |
| resolve default | 1 | 1 | - Resolves the default | genuinely miscellaneous / unresolved | Other |
| review finance package that lynn send to sale | 1 | 1 | - Review Finance package that Lynn sends to sales | non-food corpus contamination | Other |
| role and permission | 1 | 1 | - Roles and permissions? | page chrome / parsing noise | Other |
| romaine or mixed green | 1 | 1 | 2 cups romaine or mixed greens | missing keyword → Produce | Produce |
| sale can have multiple register | 1 | 1 | - 1 sale can have multiple registers | non-food corpus contamination | Other |
| sandwich add-on | 1 | 1 | Sandwich Add-Ons: | page chrome / parsing noise | Other |
| sasy screen used by fleet | 1 | 1 | - SASy Screens used by Fleet | non-food corpus contamination | Other |
| save recipe | 1 | 1 | Save Recipe | page chrome / parsing noise | Other |
| scoop protein powder | 1 | 1 | 1 scoop protein powder | specialty pantry / baking | Pantry & Dry Goods |
| send package to finance not sure what is included | 1 | 1 | - Send a package to Finance (not sure what is included) | non-food corpus contamination | Other |
| serve with | 1 | 1 | SERVE WITH: | page chrome / parsing noise | Other |
| sesame seed for finishing | 1 | 1 | 1 tablespoon sesame seeds for finishing | nuts/seeds/nut butters | Nuts, Seeds & Nut Butters |
| sheet pan ingredient | 1 | 1 | Sheet Pan ingredients | page chrome / parsing noise | Other |
| show history of contract | 1 | 1 | - Shows the history of the contract | non-food corpus contamination | Other |
| show most recent change to contract | 1 | 1 | - Shows most recent change to the contract. | non-food corpus contamination | Other |
| slivered almond | 1 | 1 | - Slivered almonds | nuts/seeds/nut butters | Nuts, Seeds & Nut Butters |
| small hot dried chily like arbol or cascabel stem and seed removed | 1 | 1 | 2 small hot dried chilies like Arbol or Cascabel, stems and seeds removed | genuinely miscellaneous / unresolved | Other |
| soft or silken tofu | 1 | 1 | 4 ounces soft or silken tofu | missing keyword → Produce | Produce |
| sometime reprint notice of award or purchaser receipt so make that | 1 | 1 | - Sometime reprint notice of award or purchasers receipt. So make that | page chrome / parsing noise | Other |
| sow credit card wire transfer and such | 1 | 1 | - Sows credit card, wire transfer and such | genuinely miscellaneous / unresolved | Other |
| star anise | 1 | 1 | 1 star anise | missing keyword → Spices & Seasonings | Spices & Seasonings |
| stir fry | 1 | 1 | STIR FRY: | page chrome / parsing noise | Other |
| summary view of register broken down by total of payment | 1 | 1 | - Summary view of the register broken down by totals of payments | non-food corpus contamination | Other |
| tamarind puree not concentrate note 2 | 1 | 1 | 1 1/2 tbsp tamarind puree , NOT concentrate (Note 2) | international sauces / condiments | Sauces & Condiments |
| tangy slaw | 1 | 1 | Tangy Slaw: | page chrome / parsing noise | Other |
| thai chily smashed | 1 | 1 | 2–3 Thai chilies, smashed | genuinely miscellaneous / unresolved | Other |
| they can also bulk update wire transfer number of all cash contract to whatever wire number they enter | 1 | 1 | - They can also bulk update wire transfer number of all cash contracts to whatever wire number they enter. | non-food corpus contamination | Other |
| this could be sale or register lvl action with module pop up to enter new wire | 1 | 1 | - This could be a sale or register lvl action with module pop up to enter new wire | non-food corpus contamination | Other |
| this print te default letter and email | 1 | 1 | - This prints te default letter and emails. | genuinely miscellaneous / unresolved | Other |
| this will show all cash/check/cc received for entire register | 1 | 1 | - This will show all the cash/check/CC received for the entire register | non-food corpus contamination | Other |
| to 1 pound smoked kielbasa diagonally sliced ¼-inch thick | 1 | 1 | 8 ounces to 1 pound smoked kielbasa, diagonally sliced ¼-inch thick | missing keyword → Meat & Seafood | Meat & Seafood |
| to serve | 1 | 1 | To Serve: | page chrome / parsing noise | Other |
| toasted sesame seed for serving optional | 1 | 1 | Toasted sesame seeds, for serving (optional) | nuts/seeds/nut butters | Nuts, Seeds & Nut Butters |
| tomatillo about 9 medium husked and washed | 1 | 1 | 1 pound tomatillos (about 9 medium), husked and washed | missing keyword → Produce | Produce |
| tostada shell | 1 | 1 | 4 tostada shells | missing keyword → Bakery & Bread | Bakery & Bread |
| tzatziki | 1 | 1 | Tzatziki: | page chrome / parsing noise | Other |
| unskinned almond | 1 | 1 | ⅓ Cup unskinned almonds | nuts/seeds/nut butters | Nuts, Seeds & Nut Butters |
| used in occasion for correction but we don’t need that since it will be same system | 1 | 1 | - Used in occasion for corrections. But we don’t need that since it will be same system | genuinely miscellaneous / unresolved | Other |
| v-8 17 oz | 1 | 1 | V-8 17 oz. | missing keyword → Beverages | Beverages |
| vehicle listing screen where they can see all vehicles… maybe just make sale vehicle inventory page accessible to zvrc | 1 | 1 | - Vehicle listing screen where they can see all vehicles… Maybe just make the sales vehicle inventory page accessible to the ZVRC? | non-food corpus contamination | Other |
| way to receive payment if it doesn’t push over from webarm | 1 | 1 | - Way to receive payment if it doesn’t push over from WebARM | non-food corpus contamination | Other |
| we don’t do partial refund in sasy only full refund in sasy currently | 1 | 1 | - We don’t do partial refunds in SASy only full refunds in SASy currently. | non-food corpus contamination | Other |
| what is dedicated register | 1 | 1 | - What is a dedicated register? | non-food corpus contamination | Other |
| what supplemental reports/email do we need for refund | 1 | 1 | - What supplemental reports/emails do we need for refunds? | non-food corpus contamination | Other |
| when they get real number via email go through lot number individually to update | 1 | 1 | - When they get the real number via email the go through the lot numbers individually to update. | genuinely miscellaneous / unresolved | Other |
| white sesame seed | 1 | 1 | ¼ cup white sesame seeds | nuts/seeds/nut butters | Nuts, Seeds & Nut Butters |
| whole walnut | 1 | 1 | 1 cup whole walnuts | nuts/seeds/nut butters | Nuts, Seeds & Nut Butters |
| xawaash | 1 | 1 | 4 teaspoons xawaash | missing keyword → Spices & Seasonings | Spices & Seasonings |
| yield 4 serving | 1 | 1 | Yield: 4 servings | page chrome / parsing noise | Other |

## Appendix B — All current Staples identities

| Ingredient | Freq. | Recipes | Raw example | Cluster | Recommended |
| --- | --- | --- | --- | --- | --- |
| salt | 62 | 57 | Salt | spices/seasonings | Spices & Seasonings |
| kosher salt | 22 | 21 | Kosher salt | spices/seasonings | Spices & Seasonings |
| honey | 18 | 18 | 2 tablespoons honey | sweeteners | Pantry & Dry Goods |
| sesame oil | 15 | 15 | 1 tablespoon sesame oil | oils/fats | Sauces & Condiments |
| brown sugar | 13 | 13 | - 1 tbsp brown sugar | sweeteners | Pantry & Dry Goods |
| salt to taste | 10 | 8 | Salt to taste | spices/seasonings | Spices & Seasonings |
| rice vinegar | 9 | 8 | 1 tablespoon rice vinegar | vinegars | Sauces & Condiments |
| baking powder | 7 | 7 | 1 teaspoon baking powder | flour/baking | Pantry & Dry Goods |
| canola oil | 6 | 6 | - 1 tablespoon canola oil | oils/fats | Sauces & Condiments |
| kosher salt such as diamond crystal | 6 | 6 | 1 teaspoon kosher salt (such as Diamond Crystal) | spices/seasonings | Spices & Seasonings |
| maple syrup | 6 | 6 | 2 tablespoons maple syrup | sweeteners | Pantry & Dry Goods |
| sugar | 6 | 6 | 1 ½ teaspoons sugar | sweeteners | Pantry & Dry Goods |
| fine sea salt | 6 | 5 | ½ teaspoon fine sea salt | spices/seasonings | Spices & Seasonings |
| all-purpose flour | 5 | 5 | - 1/4 cup all-purpose flour | flour/baking | Pantry & Dry Goods |
| flour | 5 | 5 | - 1/2 cup flour | flour/baking | Pantry & Dry Goods |
| neutral oil | 5 | 5 | 2 tablespoons neutral oil | oils/fats | Sauces & Condiments |
| quinoa | 5 | 5 | - 1 3/4 cups quinoa | rice/grains | Pantry & Dry Goods |
| salt more to taste | 4 | 4 | 1/2 teaspoon salt (more to taste) | spices/seasonings | Spices & Seasonings |
| sea salt | 4 | 4 | - 0.5 tsp sea salt | spices/seasonings | Spices & Seasonings |
| all purpose flour | 3 | 3 | - 4 tablespoons all purpose flour | flour/baking | Pantry & Dry Goods |
| cooking oil | 3 | 3 | - 2 tablespoons cooking oil | oils/fats | Sauces & Condiments |
| granulated sugar | 3 | 3 | - 1/4 cup granulated sugar | sweeteners | Pantry & Dry Goods |
| noodle | 3 | 3 | Noodles: | pasta/noodles | Pantry & Dry Goods |
| salt plus more to taste | 3 | 3 | 2 teaspoons salt, plus more to taste | spices/seasonings | Spices & Seasonings |
| about salt remember kosher salt is half concentration of table salt so if you use table salt use half as much click here to read more about salt and how it work | 2 | 2 | About the salt. Remember, kosher salt is half the concentration of table salt so if you use table salt, use half as much. Click here to rea… | spices/seasonings | Spices & Seasonings |
| fine sea salt more to taste | 2 | 2 | 1 ½ teaspoons fine sea salt, more to taste | spices/seasonings | Spices & Seasonings |
| flaky salt | 2 | 2 | Flaky salt | spices/seasonings | Spices & Seasonings |
| kosher salt plus more as needed | 2 | 2 | 1 ½ teaspoons kosher salt, plus more as needed | spices/seasonings | Spices & Seasonings |
| long-grain white rice rinsed | 2 | 2 | 1 ½ cups long-grain white rice, rinsed | rice/grains | Pantry & Dry Goods |
| morton coarse kosher salt | 2 | 2 | 1 tablespoon Morton Coarse Kosher Salt | spices/seasonings | Spices & Seasonings |
| neutral cooking oil divided | 2 | 2 | 2 tablespoon neutral cooking oil, divided | oils/fats | Sauces & Condiments |
| pinch of salt | 2 | 2 | a pinch of salt | spices/seasonings | Spices & Seasonings |
| pinch salt | 2 | 2 | 1 pinch salt | spices/seasonings | Spices & Seasonings |
| toasted sesame oil | 2 | 2 | 2 teaspoons toasted sesame oil | oils/fats | Sauces & Condiments |
| white vinegar | 2 | 2 | 1 tablespoon white vinegar | vinegars | Sauces & Condiments |
| wild rice | 2 | 2 | - 0.5 cup wild rice | rice/grains | Pantry & Dry Goods |
| / 4 oz chang’ pad thai dried rice stick note 1 | 1 | 1 | 125 g / 4 oz Chang’s Pad Thai dried rice sticks (Note 1) | rice/grains | Pantry & Dry Goods |
| balsamic vinegar | 1 | 1 | 1 tablespoon balsamic vinegar | vinegars | Sauces & Condiments |
| balsamic vinegar plus more for serving | 1 | 1 | 1 tablespoon balsamic vinegar, plus more for serving | vinegars | Sauces & Condiments |
| basmati rice soaked and drained | 1 | 1 | - 1 cup basmati rice, soaked and drained | rice/grains | Pantry & Dry Goods |
| brown sugar more to taste | 1 | 1 | 1 tablespoon brown sugar (more to taste) | sweeteners | Pantry & Dry Goods |
| brown sugar or honey | 1 | 1 | 1 tablespoon brown sugar or honey | sweeteners | Pantry & Dry Goods |
| brown sugar packed | 1 | 1 | - 1/2 cup brown sugar, packed | sweeteners | Pantry & Dry Goods |
| brown sugar tightly packed | 1 | 1 | 1/2 cup brown sugar , tightly packed | sweeteners | Pantry & Dry Goods |
| brown sugar to taste approximately 1/2 cup | 1 | 1 | - Brown sugar to taste (approximately 1/2 cup) | sweeteners | Pantry & Dry Goods |
| chinkiang vinegar or balsamic vinegar | 1 | 1 | ½ teaspoon Chinkiang vinegar or balsamic vinegar | vinegars | Sauces & Condiments |
| cider vinegar | 1 | 1 | ¼ cup cider vinegar | vinegars | Sauces & Condiments |
| coarse kosher salt | 1 | 1 | 2 teaspoons coarse kosher salt | spices/seasonings | Spices & Seasonings |
| coarse sea salt | 1 | 1 | - 1 teaspoon coarse sea salt | spices/seasonings | Spices & Seasonings |
| coconut oil or neutral-flavored oil such as canola | 1 | 1 | 2 tablespoons coconut oil (or neutral-flavored oil such as canola) | oils/fats | Sauces & Condiments |
| cold cooked white rice - about 400 g/14 oz see note 2 | 1 | 1 | 3 cups cold cooked white rice - about 400 g/14 oz (see note 2) | rice/grains | Pantry & Dry Goods |
| cooked jasmine or sushi rice warm | 1 | 1 | 2 cups cooked jasmine or sushi rice, warm | rice/grains | Pantry & Dry Goods |
| cooked medium-grain white rice preferably cold leftover | 1 | 1 | 4 cups cooked medium-grain white rice, preferably cold leftovers | rice/grains | Pantry & Dry Goods |
| cooked quinoa | 1 | 1 | 2 cups cooked quinoa | rice/grains | Pantry & Dry Goods |
| cooked rice or quinoa | 1 | 1 | 2 cups cooked rice or quinoa | rice/grains | Pantry & Dry Goods |
| cooked sushi or short-grain rice | 1 | 1 | 2 cups cooked sushi or short-grain rice | rice/grains | Pantry & Dry Goods |
| cooked white rice | 1 | 1 | 2 cups cooked white rice | rice/grains | Pantry & Dry Goods |
| cooked white rice preferably leftover | 1 | 1 | 4 cups cooked white rice, preferably leftovers | rice/grains | Pantry & Dry Goods |
| cooking/kosher salt | 1 | 1 | 1/4 tsp cooking/kosher salt | spices/seasonings | Spices & Seasonings |
| couscous | 1 | 1 | 3/4 cup couscous | rice/grains | Pantry & Dry Goods |
| cup/125 gram all-purpose flour | 1 | 1 | 1 cup/125 grams all-purpose flour | flour/baking | Pantry & Dry Goods |
| cup/84 gram honey | 1 | 1 | ¼ cup/84 grams honey | sweeteners | Pantry & Dry Goods |
| dark sesame oil for drizzling | 1 | 1 | Dark sesame oil, for drizzling | oils/fats | Sauces & Condiments |
| ditalini or other short pasta | 1 | 1 | ½ cup ditalini, or other short pasta | pasta/noodles | Pantry & Dry Goods |
| dried rice vermicelli mei fun - see note 1 | 1 | 1 | 90 g dried rice vermicelli (Mei Fun) - see note 1 | rice/grains | Pantry & Dry Goods |
| dried tagliatelle pasta | 1 | 1 | 8 ounces dried tagliatelle pasta | pasta/noodles | Pantry & Dry Goods |
| everyday quinoa taste great here or rice | 1 | 1 | Everyday Quinoa (tastes great here) or rice, | rice/grains | Pantry & Dry Goods |
| farfalle pasta delallo | 1 | 1 | 8 ounces farfalle pasta (DeLallo) | pasta/noodles | Pantry & Dry Goods |
| fine sea salt to taste | 1 | 1 | ½ teaspoon fine sea salt, to taste | spices/seasonings | Spices & Seasonings |
| flaky sea salt for serving | 1 | 1 | Flaky sea salt, for serving | spices/seasonings | Spices & Seasonings |
| flaky sea salt to finish | 1 | 1 | Flaky sea salt, to finish | spices/seasonings | Spices & Seasonings |
| flour plain / all-purpose | 1 | 1 | 1 1/2 cups flour (plain / all-purpose) | flour/baking | Pantry & Dry Goods |
| for pasta | 1 | 1 | For the Pasta: | pasta/noodles | Other |
| good-quality balsamic vinegar plus more as needed | 1 | 1 | 2 teaspoons good-quality balsamic vinegar, plus more as needed | vinegars | Sauces & Condiments |
| granulated sugar plus more to taste | 1 | 1 | 1 teaspoon granulated sugar, plus more to taste | sweeteners | Pantry & Dry Goods |
| healthy pinch sea salt | 1 | 1 | 1 healthy pinch sea salt | spices/seasonings | Spices & Seasonings |
| honey dijonnaise easy – see note | 1 | 1 | Honey dijonnaise (easy – see notes) | sweeteners | Pantry & Dry Goods |
| honey or brown sugar | 1 | 1 | 1 tablespoon honey or brown sugar | sweeteners | Pantry & Dry Goods |
| honey or granulated sugar | 1 | 1 | 1 ½ teaspoons honey or granulated sugar | sweeteners | Pantry & Dry Goods |
| honey or mirin | 1 | 1 | 1 tablespoon honey or mirin | sweeteners | Sauces & Condiments |
| instant yeast | 1 | 1 | 1/2 teaspoon instant yeast | flour/baking | Pantry & Dry Goods |
| jasmine rice uncooked | 1 | 1 | 1 1/2 cups jasmine rice, uncooked | rice/grains | Pantry & Dry Goods |
| kosher salt more as needed | 1 | 1 | 2 teaspoons kosher salt, more as needed | spices/seasonings | Spices & Seasonings |
| kosher salt more or less to taste | 1 | 1 | 1 teaspoon kosher salt (more or less to taste) | spices/seasonings | Spices & Seasonings |
| kosher salt more to taste | 1 | 1 | 2 ½ teaspoons kosher salt, more to taste | spices/seasonings | Spices & Seasonings |
| kosher salt plus more | 1 | 1 | 2 tsp. kosher salt, plus more | spices/seasonings | Spices & Seasonings |
| kosher salt plus more to taste | 1 | 1 | 1 tablespoon kosher salt, plus more to taste | spices/seasonings | Spices & Seasonings |
| kosher salt such as diamond crystal plus more to taste | 1 | 1 | 2 teaspoons kosher salt (such as Diamond Crystal), plus more to taste | spices/seasonings | Spices & Seasonings |
| kosher salt to taste | 1 | 1 | kosher salt to taste | spices/seasonings | Spices & Seasonings |
| large pinch of kosher salt | 1 | 1 | Large pinch of kosher salt | spices/seasonings | Spices & Seasonings |
| light or dark brown sugar | 1 | 1 | 2 to 3 tablespoons (light or dark) brown sugar | sweeteners | Pantry & Dry Goods |
| long-grain rice preferably basmati | 1 | 1 | 2 cups long-grain rice (preferably basmati) | rice/grains | Pantry & Dry Goods |
| maldon or other flaky sea salt for finishing | 1 | 1 | Maldon or other flaky sea salt, for finishing | spices/seasonings | Spices & Seasonings |
| minute brown rice | 1 | 1 | - 1.5 cups Minute brown rice | rice/grains | Pantry & Dry Goods |
| more salt to taste | 1 | 1 | more salt to taste | spices/seasonings | Spices & Seasonings |
| muufo or cooked white rice optional for serving | 1 | 1 | Muufo or cooked white rice (optional), for serving | rice/grains | Pantry & Dry Goods |
| neutral cooking oil - divided | 1 | 1 | 2 tablespoon neutral cooking oil - divided | oils/fats | Sauces & Condiments |
| neutral oil like canola | 1 | 1 | 3 tablespoons neutral oil, like canola | oils/fats | Sauces & Condiments |
| neutral oil plus more for stir-frying | 1 | 1 | 2 tablespoons neutral oil, plus more for stir-frying | oils/fats | Sauces & Condiments |
| oats | 1 | 1 | ¼ cup oats | other | Other |
| organic brown sugar or coconut sugar | 1 | 1 | 1 teaspoon organic brown sugar or coconut sugar | sweeteners | Pantry & Dry Goods |
| orzo | 1 | 1 | 1½ cups orzo | pasta/noodles | Pantry & Dry Goods |
| packed brown sugar | 1 | 1 | 3 tbsp (packed) brown sugar | sweeteners | Pantry & Dry Goods |
| packed dark brown sugar | 1 | 1 | ½ cup packed dark brown sugar | sweeteners | Pantry & Dry Goods |
| packet ramen or stir fry noodle just noodle | 1 | 1 | 2 packets ramen or stir fry noodles (just the noodles) | pasta/noodles | Pantry & Dry Goods |
| palm sugar or brown sugar | 1 | 1 | 1–2 tablespoons palm sugar or brown sugar | sweeteners | Pantry & Dry Goods |
| pasta | 1 | 1 | Pasta | pasta/noodles | Pantry & Dry Goods |
| penne pasta | 1 | 1 | - 8 oz penne pasta | pasta/noodles | Pantry & Dry Goods |
| pinch morton coarse kosher salt | 1 | 1 | 2 pinches Morton Coarse Kosher Salt | spices/seasonings | Spices & Seasonings |
| pinch of kosher salt or to taste | 1 | 1 | Pinch of kosher salt, or to taste | spices/seasonings | Spices & Seasonings |
| pink salt kala namak adjust to taste - see note for substitute | 1 | 1 | 1 teaspoon pink salt (kala namak) adjust to taste - see notes for substitute | spices/seasonings | Spices & Seasonings |
| quinoa long-grain white rice or mix of two rinsed | 1 | 1 | 1 cup quinoa, long-grain white rice or a mix of the two, rinsed | rice/grains | Pantry & Dry Goods |
| ramen udon or soba noodle | 1 | 1 | 8 ounces ramen, udon or soba noodles | pasta/noodles | Pantry & Dry Goods |
| raw or roasted and salted pistachio coarsely chopped optional | 1 | 1 | 3 tablespoons raw (or roasted and salted pistachios), coarsely chopped (optional) | other | Nuts, Seeds & Nut Butters |
| red quinoa or rainbow quinoa rinsed | 1 | 1 | 1 cup red quinoa or rainbow quinoa, rinsed | rice/grains | Pantry & Dry Goods |
| rice and/or salad green for serving | 1 | 1 | Rice and/or salad greens, for serving | rice/grains | Pantry & Dry Goods |
| rice flour or ordinary flour note 2 | 1 | 1 | 1/4 cup rice flour or ordinary flour (Note 2) | flour/baking | Pantry & Dry Goods |
| rice of choice jasmine white brown | 1 | 1 | Rice of choice (jasmine, white, brown) | rice/grains | Pantry & Dry Goods |
| rice optional for serving | 1 | 1 | Rice (optional), for serving | rice/grains | Pantry & Dry Goods |
| rotini pasta cooked al dente | 1 | 1 | - 1 lb rotini pasta, cooked al dente | pasta/noodles | Pantry & Dry Goods |
| salt - or to taste | 1 | 1 | ¼ teaspoon salt - or to taste | spices/seasonings | Spices & Seasonings |
| salt more as needed | 1 | 1 | ¾ teaspoon salt, more as needed | spices/seasonings | Spices & Seasonings |
| salt or to taste | 1 | 1 | ¾ teaspoon salt or to taste | spices/seasonings | Spices & Seasonings |
| scoop protein powder vanilla or chocolate | 1 | 1 | 2 scoops protein powder (vanilla or chocolate) | flour/baking | Pantry & Dry Goods |
| seasoned rice vinegar | 1 | 1 | 2 tablespoons seasoned rice vinegar | vinegars | Sauces & Condiments |
| serve with jasmine rice | 1 | 1 | Serve with jasmine rice. | rice/grains | Other |
| sesame oil optional | 1 | 1 | 1 tablespoon sesame oil (optional) | oils/fats | Sauces & Condiments |
| sherry vinegar | 1 | 1 | 2 teaspoons sherry vinegar | vinegars | Sauces & Condiments |
| short pasta such as rotini | 1 | 1 | 1 pound short pasta, such as rotini | pasta/noodles | Pantry & Dry Goods |
| small pinch of granulated sugar | 1 | 1 | Small pinch of granulated sugar | sweeteners | Pantry & Dry Goods |
| soba noodle | 1 | 1 | 8 ounces soba noodles | pasta/noodles | Pantry & Dry Goods |
| spaghetti | 1 | 1 | 1 pound spaghetti | pasta/noodles | Pantry & Dry Goods |
| spaghetti pappardelle or other long pasta | 1 | 1 | 12 ounces spaghetti, pappardelle or other long pasta | pasta/noodles | Pantry & Dry Goods |
| steel cut oats | 1 | 1 | - 1 cup steel cut oats | other | Other |
| sugar or honey | 1 | 1 | 1 tablespoon sugar or honey | sweeteners | Pantry & Dry Goods |
| sushi rice | 1 | 1 | 2 cups sushi rice | rice/grains | Pantry & Dry Goods |
| to 2 tablespoon coconut oil or neutral-flavored oil such as canola | 1 | 1 | 1½ to 2 tablespoons coconut oil (or neutral-flavored oil such as canola) | oils/fats | Sauces & Condiments |
| toasted sesame oil plus more for serving | 1 | 1 | 1 tablespoon toasted sesame oil, plus more for serving | oils/fats | Sauces & Condiments |
| toasted sesame oil plus more to taste for serving | 1 | 1 | 4 teaspoons toasted sesame oil, plus more to taste, for serving | oils/fats | Sauces & Condiments |
| toasted sesame oil to taste i like about 1-2 tablespoon | 1 | 1 | toasted sesame oil to taste (I like about 1-2 tablespoons) | oils/fats | Sauces & Condiments |
| tubular dried pasta such as mezzi rigatoni paccheri or penne | 1 | 1 | 1 pound tubular dried pasta such as mezzi rigatoni, paccheri or penne | pasta/noodles | Pantry & Dry Goods |
| uncooked brown basmati rice for serving rice is optional i like to cook extra to have on hand for other meal | 1 | 1 | 1 cup uncooked brown basmati rice, for serving (rice is optional, I like to cook extra to have on hand for other meals) | rice/grains | Pantry & Dry Goods |
| uncooked orzo | 1 | 1 | 8 ounces uncooked orzo | pasta/noodles | Pantry & Dry Goods |
| uncooked short-grain brown rice or 4 cup cooked chilled white rice | 1 | 1 | 1 ½ cups uncooked short-grain brown rice, or 4 cups cooked, chilled white rice | rice/grains | Pantry & Dry Goods |
| uncooked wild rice | 1 | 1 | 1 cup uncooked wild rice | rice/grains | Pantry & Dry Goods |
| uncooked wild rice rinsed | 1 | 1 | - 3/4 cup uncooked wild rice, rinsed | rice/grains | Pantry & Dry Goods |
| unsalted dry roasted pistachio roughly chopped | 1 | 1 | ¼ cup unsalted, dry roasted pistachios, roughly chopped | other | Nuts, Seeds & Nut Butters |
| vanilla extract | 1 | 1 | - 1 tsp vanilla extract | flour/baking | Pantry & Dry Goods |
| white distilled vinegar | 1 | 1 | 2 tablespoons white distilled vinegar | vinegars | Sauces & Condiments |
| white long grain rice | 1 | 1 | - 1.5 cups white long grain rice | rice/grains | Pantry & Dry Goods |
| white rice for serving | 1 | 1 | White rice, for serving | rice/grains | Pantry & Dry Goods |

## Final recommendation

Recommended taxonomy:

1. Produce
2. Meat & Seafood
3. Dairy & Eggs
4. Bakery & Bread
5. Pantry & Dry Goods
6. Canned & Jarred
7. Sauces & Condiments
8. Spices & Seasonings
9. Nuts, Seeds & Nut Butters
10. Beverages
11. Other

First implement boundary/specificity fixes under the current strings; then coordinate the 11-category rollout with iOS and legacy saved/manual category handling. Remove `Staples` as a shopping section and reserve “usually on hand” for a separate future property.
