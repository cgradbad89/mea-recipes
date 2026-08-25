# Recipe Category Migration Production Dry Run — 2026-08-25

> READY FOR HUMAN MIGRATION REVIEW
>
> Review-only evidence. This report authorizes no Firestore writes and the tool has no apply mode.

## Production baseline

- Shared recipe documents: 236
- Usable recipes: 234
- Distinct raw categories: 20
- Personal meta documents: 114
- Category overrides: 25

## Shared category dry run

- READY: 66
- ALREADY_MIGRATED: 0
- PRECONDITION_MISMATCH: 0
- UNRESOLVED/MISSING: 0
- UNEXPECTED: 0

| recipeID | title | expected old | observed | proposed | status | approved reason |
| --- | --- | --- | --- | --- | --- | --- |
| 151 | The BEST Black Bean Chili | Vegetarian | Vegetarian | Vegetarian Mains | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Vegetarian" to "Vegetarian Mains". |
| 152 | Crockpot Chicken Wild Rice Soup | Soup/Stew | Soup/Stew | Soups, Stews & Chili | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Soup/Stew" to "Soups, Stews & Chili". |
| 155 | Slow Cooker Carnitas (Mexican Pulled Pork) | Pork | Pork | Beef & Pork | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Pork" to "Beef & Pork". |
| 156 | Easy Slow Cooker Pot Roast | Beef | Beef | Beef & Pork | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Beef" to "Beef & Pork". |
| 157 | Slow Cooker Minnesota Pork Chop Casserole | Pork | Pork | Beef & Pork | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Pork" to "Beef & Pork". |
| 158 | Creamy Crockpot White Chicken Chili | Soup/Stew | Soup/Stew | Soups, Stews & Chili | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Soup/Stew" to "Soups, Stews & Chili". |
| 159 | Easy Slow Cooker Turkey Chili | Soup/Stew | Soup/Stew | Soups, Stews & Chili | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Soup/Stew" to "Soups, Stews & Chili". |
| 161 | Slow Cooker Beef Stew | Beef | Beef | Beef & Pork | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Beef" to "Beef & Pork". |
| 162 | Easy Slow Cooker Chicken Pot Pie | Chicken | Chicken | Chicken & Poultry | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Chicken" to "Chicken & Poultry". |
| 164 | Slow Cooker Chicken Taco Soup | Soup/Stew | Soup/Stew | Soups, Stews & Chili | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Soup/Stew" to "Soups, Stews & Chili". |
| 167 | Slow Cooker Pumpkin Applesauce | Other | Other | Snacks | READY | Approved exact recipe-specific compatibility in lib/recipeCategories.ts maps "Other" to "Snacks" for this recipe ID only. |
| 168 | Slow Cooker Garlic Butter Chicken Pasta | Chicken | Chicken | Chicken & Poultry | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Chicken" to "Chicken & Poultry". |
| 171 | Slow Cooker Beef Brisket with BBQ Sauce | Beef | Beef | Beef & Pork | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Beef" to "Beef & Pork". |
| 173 | Slow Cooker Chicken Ropa Vieja | Chicken | Chicken | Chicken & Poultry | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Chicken" to "Chicken & Poultry". |
| 176 | Garlic Butter Roasted Chicken Thighs with Charred Lemon Salsa Verde + Asparagus | Chicken | Chicken | Chicken & Poultry | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Chicken" to "Chicken & Poultry". |
| 180 | Garlic Parmesan Kale Pasta | Vegetarian | Vegetarian | Vegetarian Mains | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Vegetarian" to "Vegetarian Mains". |
| 182 | Spicy Quinoa with Sweet Potatoes | Vegetarian | Vegetarian | Vegetarian Mains | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Vegetarian" to "Vegetarian Mains". |
| 184 | Pressure-Cooker Spring-Thyme Chicken Stew | Soup/Stew | Soup/Stew | Soups, Stews & Chili | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Soup/Stew" to "Soups, Stews & Chili". |
| 185 | Instant Pot Red Beans and Rice | Pork | Pork | Beef & Pork | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Pork" to "Beef & Pork". |
| 186 | Instant Pot Lemon Chicken Thighs | Chicken | Chicken | Chicken & Poultry | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Chicken" to "Chicken & Poultry". |
| 187 | Instant Pot Mississippi Pot Roast | Beef | Beef | Beef & Pork | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Beef" to "Beef & Pork". |
| 188 | Instant Pot BBQ Pulled Pork | Pork | Pork | Beef & Pork | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Pork" to "Beef & Pork". |
| 190 | Instant Pot Boiled Potatoes | Other | Other | Sides | READY | Approved exact recipe-specific compatibility in lib/recipeCategories.ts maps "Other" to "Sides" for this recipe ID only. |
| 191 | Chicken Tinga Tacos | Chicken | Chicken | Chicken & Poultry | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Chicken" to "Chicken & Poultry". |
| 192 | Easy Instant Pot Vegetable Biryani | Vegetarian | Vegetarian | Vegetarian Mains | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Vegetarian" to "Vegetarian Mains". |
| 194 | Pressure-Cooker Easy Pork Posole | Soup/Stew | Soup/Stew | Soups, Stews & Chili | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Soup/Stew" to "Soups, Stews & Chili". |
| 195 | Pressure-Cooker White Bean Chicken Chili | Soup/Stew | Soup/Stew | Soups, Stews & Chili | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Soup/Stew" to "Soups, Stews & Chili". |
| 197 | Instant Pot Pineapple Chicken | Chicken | Chicken | Chicken & Poultry | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Chicken" to "Chicken & Poultry". |
| 198 | Instant Pot Orange Chicken | Chicken | Chicken | Chicken & Poultry | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Chicken" to "Chicken & Poultry". |
| 199 | Hush Puppies | Other | Other | Sides | READY | Approved exact recipe-specific compatibility in lib/recipeCategories.ts maps "Other" to "Sides" for this recipe ID only. |
| air-fried-sweet-potato-fries-with-rosemary-and-garlic | Air Fried Sweet Potato Fries with Rosemary and Garlic | Breakfast Snacks & Sides | Breakfast Snacks & Sides | Sides | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Breakfast Snacks & Sides" to "Sides". |
| best-black-bean-soup | Best Black Bean Soup | Soups Stews & Chili | Soups Stews & Chili | Soups, Stews & Chili | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Soups Stews & Chili" to "Soups, Stews & Chili". |
| bread | Bread! | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sides | READY | Approved exact recipe-specific compatibility in lib/recipeCategories.ts maps "Breakfast, Snacks & Sides" to "Sides" for this recipe ID only. |
| cauliflower-breakfast-muffins | Cauliflower Breakfast Muffins | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Breakfast | READY | Approved exact recipe-specific compatibility in lib/recipeCategories.ts maps "Breakfast, Snacks & Sides" to "Breakfast" for this recipe ID only. |
| chinese-chili-oil | Chinese Chili Oil | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sauces & Condiments | READY | Approved exact recipe-specific compatibility in lib/recipeCategories.ts maps "Breakfast, Snacks & Sides" to "Sauces & Condiments" for this recipe ID only. |
| classic-bbq-corn | Classic BBQ Corn | Breakfast Snacks & Sides | Breakfast Snacks & Sides | Sides | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Breakfast Snacks & Sides" to "Sides". |
| dan-dan-noodles | Dan Dan Noodles | Pasta Noodles & Rice | Pasta Noodles & Rice | Pasta, Noodles & Rice | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Pasta Noodles & Rice" to "Pasta, Noodles & Rice". |
| easy-spaghetti-with-meat-sauce | Easy Spaghetti With Meat Sauce | Pasta Noodles & Rice | Pasta Noodles & Rice | Pasta, Noodles & Rice | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Pasta Noodles & Rice" to "Pasta, Noodles & Rice". |
| garlic-bread | Garlic Bread | Breakfast Snacks & Sides | Breakfast Snacks & Sides | Sides | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Breakfast Snacks & Sides" to "Sides". |
| grownup-mustard-sauce-recipe | Grownup Mustard Sauce Recipe | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sauces & Condiments | READY | Approved exact recipe-specific compatibility in lib/recipeCategories.ts maps "Breakfast, Snacks & Sides" to "Sauces & Condiments" for this recipe ID only. |
| hearthealthy-peanut-butter-protein-bars | Heart-Healthy Peanut Butter Protein Bars | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Snacks | READY | Approved exact recipe-specific compatibility in lib/recipeCategories.ts maps "Breakfast, Snacks & Sides" to "Snacks" for this recipe ID only. |
| honey-sriracha-roasted-brussels-sprouts | HONEY SRIRACHA ROASTED BRUSSELS SPROUTS | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sides | READY | Approved exact recipe-specific compatibility in lib/recipeCategories.ts maps "Breakfast, Snacks & Sides" to "Sides" for this recipe ID only. |
| huevos-rotos-broken-eggs | Huevos Rotos (Broken Eggs) | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Breakfast | READY | Approved exact recipe-specific compatibility in lib/recipeCategories.ts maps "Breakfast, Snacks & Sides" to "Breakfast" for this recipe ID only. |
| indian-spiced-roasted-vegetables | Indian Spiced Roasted Vegetables | Breakfast Snacks & Sides | Breakfast Snacks & Sides | Sides | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Breakfast Snacks & Sides" to "Sides". |
| jalape-o-cheddar-cornbread | Jalapeño Cheddar Cornbread | Breakfast Snacks & Sides | Breakfast Snacks & Sides | Sides | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Breakfast Snacks & Sides" to "Sides". |
| jam-oat-bars | Jam Oat Bars | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Snacks | READY | Approved exact recipe-specific compatibility in lib/recipeCategories.ts maps "Breakfast, Snacks & Sides" to "Snacks" for this recipe ID only. |
| kimchi-ramen | Kimchi Ramen | Soups Stews & Chili | Soups Stews & Chili | Soups, Stews & Chili | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Soups Stews & Chili" to "Soups, Stews & Chili". |
| maple-roasted-candied-pecans | Maple Roasted Candied Pecans | Vegetarian Mains | Vegetarian Mains | Snacks | READY | Approved content correction encoded for this exact recipe ID: candied pecans are Snacks, not Vegetarian Mains. |
| maraq-misir-red-lentil-soup | Maraq Misir (Red Lentil Soup) | Soups Stews & Chili | Soups Stews & Chili | Soups, Stews & Chili | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Soups Stews & Chili" to "Soups, Stews & Chili". |
| mexican-roasted-cauliflower | Mexican Roasted Cauliflower | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sides | READY | Approved exact recipe-specific compatibility in lib/recipeCategories.ts maps "Breakfast, Snacks & Sides" to "Sides" for this recipe ID only. |
| mexican-roasted-zucchini | Mexican Roasted Zucchini | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sides | READY | Approved exact recipe-specific compatibility in lib/recipeCategories.ts maps "Breakfast, Snacks & Sides" to "Sides" for this recipe ID only. |
| mexican-street-corn | Mexican Street Corn | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sides | READY | Approved exact recipe-specific compatibility in lib/recipeCategories.ts maps "Breakfast, Snacks & Sides" to "Sides" for this recipe ID only. |
| peanut-butter-oat-protein-shake | Peanut Butter Oat Protein Shake | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Drinks | READY | Approved exact recipe-specific compatibility in lib/recipeCategories.ts maps "Breakfast, Snacks & Sides" to "Drinks" for this recipe ID only. |
| pesto | Pesto | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sauces & Condiments | READY | Approved exact recipe-specific compatibility in lib/recipeCategories.ts maps "Breakfast, Snacks & Sides" to "Sauces & Condiments" for this recipe ID only. |
| queso-chicken-chili-with-roasted-corn-and-jalape-o | Queso Chicken Chili with Roasted Corn and Jalapeño | Soups Stews & Chili | Soups Stews & Chili | Soups, Stews & Chili | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Soups Stews & Chili" to "Soups, Stews & Chili". |
| ribollita-tuscan-white-bean-soup | Ribollita (Tuscan White Bean Soup) | Soups Stews & Chili | Soups Stews & Chili | Soups, Stews & Chili | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Soups Stews & Chili" to "Soups, Stews & Chili". |
| rising-sun-mazcal | Rising Sun - Mazcal | Non-Recipe / Notes | Non-Recipe / Notes | Drinks | READY | Approved exact recipe-specific compatibility in lib/recipeCategories.ts maps "Non-Recipe / Notes" to "Drinks" for this recipe ID only. |
| saucy-gochujang-noodles-with-chicken | Saucy Gochujang Noodles with Chicken | Pasta Noodles & Rice | Pasta Noodles & Rice | Pasta, Noodles & Rice | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Pasta Noodles & Rice" to "Pasta, Noodles & Rice". |
| sausage-rag | Sausage Ragù | Pasta Noodles & Rice | Pasta Noodles & Rice | Pasta, Noodles & Rice | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Pasta Noodles & Rice" to "Pasta, Noodles & Rice". |
| seared-broccoli-and-potato-soup | Seared Broccoli and Potato Soup | Soups Stews & Chili | Soups Stews & Chili | Soups, Stews & Chili | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Soups Stews & Chili" to "Soups, Stews & Chili". |
| sheet-pan-bibimbap | Sheet-Pan Bibimbap | Pasta Noodles & Rice | Pasta Noodles & Rice | Pasta, Noodles & Rice | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Pasta Noodles & Rice" to "Pasta, Noodles & Rice". |
| smoothies | Smoothies | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Drinks | READY | Approved exact recipe-specific compatibility in lib/recipeCategories.ts maps "Breakfast, Snacks & Sides" to "Drinks" for this recipe ID only. |
| taco-soup | Taco Soup | Soups Stews & Chili | Soups Stews & Chili | Soups, Stews & Chili | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Soups Stews & Chili" to "Soups, Stews & Chili". |
| toor-dal-split-yellow-pigeon-peas | Toor Dal (Split Yellow Pigeon Peas) | Soups Stews & Chili | Soups Stews & Chili | Soups, Stews & Chili | READY | Approved deterministic direct alias in lib/recipeCategories.ts maps "Soups Stews & Chili" to "Soups, Stews & Chili". |
| traditional-southern-butter-butter-beans-recipe | Traditional Southern Butter Butter Beans Recipe | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sides | READY | Approved exact recipe-specific compatibility in lib/recipeCategories.ts maps "Breakfast, Snacks & Sides" to "Sides" for this recipe ID only. |
| yogurt-dill-sauce | yogurt Dill sauce | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sauces & Condiments | READY | Approved exact recipe-specific compatibility in lib/recipeCategories.ts maps "Breakfast, Snacks & Sides" to "Sauces & Condiments" for this recipe ID only. |

## Personal override cleanup dry run

- Proposed removals: 24
- Already clean: 0
- Preserved: 1
- Review required: 0
- Precondition mismatches: 0

### Exact proposed removal set

| recipeID | expected override | observed override | shared before | shared after | action | reason |
| --- | --- | --- | --- | --- | --- | --- |
| air-fried-sweet-potato-fries-with-rosemary-and-garlic | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Breakfast Snacks & Sides | Sides | REMOVE_LEGACY | For this exact recipe, the canonical shared category after migration is Sides, so the historic combined override adds no remaining personal distinction. |
| balsamic-roasted-beets | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sides | Sides | REMOVE_LEGACY | For this exact recipe, the canonical shared category after migration is Sides, so the historic combined override adds no remaining personal distinction. |
| best-black-bean-soup | Soups, Stews & Chili | Soups, Stews & Chili | Soups Stews & Chili | Soups, Stews & Chili | REMOVE_REDUNDANT | The canonical override is identical to the shared category after migration and adds no personal distinction. |
| braised-red-cabbage | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sides | Sides | REMOVE_LEGACY | For this exact recipe, the canonical shared category after migration is Sides, so the historic combined override adds no remaining personal distinction. |
| buttered-peas-with-mint | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sides | Sides | REMOVE_LEGACY | For this exact recipe, the canonical shared category after migration is Sides, so the historic combined override adds no remaining personal distinction. |
| caprese-salad | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sides | Sides | REMOVE_LEGACY | For this exact recipe, the canonical shared category after migration is Sides, so the historic combined override adds no remaining personal distinction. |
| classic-bbq-corn | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Breakfast Snacks & Sides | Sides | REMOVE_LEGACY | For this exact recipe, the canonical shared category after migration is Sides, so the historic combined override adds no remaining personal distinction. |
| cucumber-tomato-salad-with-red-wine-vinaigrette | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sides | Sides | REMOVE_LEGACY | For this exact recipe, the canonical shared category after migration is Sides, so the historic combined override adds no remaining personal distinction. |
| garlic-butter-roasted-broccoli | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sides | Sides | REMOVE_LEGACY | For this exact recipe, the canonical shared category after migration is Sides, so the historic combined override adds no remaining personal distinction. |
| garlic-parmesan-roasted-potatoes | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sides | Sides | REMOVE_LEGACY | For this exact recipe, the canonical shared category after migration is Sides, so the historic combined override adds no remaining personal distinction. |
| grilled-zucchini-and-summer-squash | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sides | Sides | REMOVE_LEGACY | For this exact recipe, the canonical shared category after migration is Sides, so the historic combined override adds no remaining personal distinction. |
| herb-roasted-cauliflower | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sides | Sides | REMOVE_LEGACY | For this exact recipe, the canonical shared category after migration is Sides, so the historic combined override adds no remaining personal distinction. |
| honey-butter-glazed-carrots | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sides | Sides | REMOVE_LEGACY | For this exact recipe, the canonical shared category after migration is Sides, so the historic combined override adds no remaining personal distinction. |
| honey-glazed-roasted-parsnips | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sides | Sides | REMOVE_LEGACY | For this exact recipe, the canonical shared category after migration is Sides, so the historic combined override adds no remaining personal distinction. |
| lemon-garlic-roasted-artichokes | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sides | Sides | REMOVE_LEGACY | For this exact recipe, the canonical shared category after migration is Sides, so the historic combined override adds no remaining personal distinction. |
| rice-pilaf | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sides | Sides | REMOVE_LEGACY | For this exact recipe, the canonical shared category after migration is Sides, so the historic combined override adds no remaining personal distinction. |
| roasted-acorn-squash-with-brown-butter | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sides | Sides | REMOVE_LEGACY | For this exact recipe, the canonical shared category after migration is Sides, so the historic combined override adds no remaining personal distinction. |
| roasted-asparagus-with-lemon | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sides | Sides | REMOVE_LEGACY | For this exact recipe, the canonical shared category after migration is Sides, so the historic combined override adds no remaining personal distinction. |
| roasted-brussels-sprouts-with-bacon | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sides | Sides | REMOVE_LEGACY | For this exact recipe, the canonical shared category after migration is Sides, so the historic combined override adds no remaining personal distinction. |
| roasted-radishes-with-herb-butter | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sides | Sides | REMOVE_LEGACY | For this exact recipe, the canonical shared category after migration is Sides, so the historic combined override adds no remaining personal distinction. |
| roasted-root-vegetable-medley | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sides | Sides | REMOVE_LEGACY | For this exact recipe, the canonical shared category after migration is Sides, so the historic combined override adds no remaining personal distinction. |
| saut-ed-garlic-green-beans | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sides | Sides | REMOVE_LEGACY | For this exact recipe, the canonical shared category after migration is Sides, so the historic combined override adds no remaining personal distinction. |
| saut-ed-kale-with-garlic-and-lemon | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sides | Sides | REMOVE_LEGACY | For this exact recipe, the canonical shared category after migration is Sides, so the historic combined override adds no remaining personal distinction. |
| simple-house-salad-with-vinaigrette | Breakfast, Snacks & Sides | Breakfast, Snacks & Sides | Sides | Sides | REMOVE_LEGACY | For this exact recipe, the canonical shared category after migration is Sides, so the historic combined override adds no remaining personal distinction. |

### Preserved overrides

| recipeID | override | shared after | status | reason |
| --- | --- | --- | --- | --- |
| 182 | Salads & Bowls | Vegetarian Mains | PRESERVED | Explicitly approved intentional personal classification: Spicy Quinoa remains Salads & Bowls. |

## Historical-audit reconciliation

- No count-level differences: 66 shared changes, 24 override removals, and 1 preserved override match.

- Fresh shared READY: 66
- Already migrated: 0
- Precondition mismatches: 0
- New unexpected candidates: 0
- Missing previously expected candidates: 0

The prior audit supplied count baselines and approved special cases but no checked-in exact row manifest. This run freezes the complete exact production proposal and verifies it with a second read; row-level historical identity comparison is therefore unavailable.

## Preconditions and unexpected records

### Precondition failures

None.

### Unexpected records

None.

## Safety evidence

- Exact later shared precondition: `recipeID + expectedOldCategory`
- Exact later override precondition: `uid + recipeID + expectedOverrideCategory`
- Any mismatch must refuse that row.
- Shared recipe writes: 0
- Personal override writes/deletes: 0
- Week-plan writes: 0
- Firestore rule/index changes: 0
- Firebase deployments: 0
- Relevant production fingerprints equal before/after: true
