# Cooking Mode Completeness Audit — 2026-08-26

## Executive verdict

**COMPLETENESS REMEDIATION REQUIRED**

The actual runtime map across all 228 mapped production recipes contains 2677 adjudicated missing ingredient associations and 12 incorrect displayed associations. Precision remains 99.13%, while recall is 33.93%.

## Production/runtime baseline

- Shared recipes: 236
- Mapped recipes: 228
- Unmapped recipes (out of scope): 8
- Persisted v4 maps: 187
- Persisted v5 maps: 41
- Active owner content overrides among mapped recipes: 7
- Deterministic-v5 runtime fallbacks: 4

## User-reported regressions

### GARLIC BUTTER HERB STEAK BITES WITH POTATOES

- Step 1: Heat a large cast iron skillet over medium high heat and add olive oil and butter, potatoes, garlic, thyme, rosemary, and oregano. Cook for about 3 minutes, stir and cook and additional 3 minutes until fork tender. Remove and set aside on a plate.
  - Current: 1 tablespoon olive oil; 2 tablespoons butter, divided; 3 garlic cloves, minced; 1 teaspoon thyme, chopped; 1 teaspoon rosemary, chopped; 1 teaspoon oregano, chopped
  - Expected: 1 tablespoon olive oil; 2 tablespoons butter, divided; 1 pound yukon gold potatoes, sliced about ½ inch in thickness; 3 garlic cloves, minced; 1 teaspoon thyme, chopped; 1 teaspoon rosemary, chopped; 1 teaspoon oregano, chopped
  - Missing: 1 pound yukon gold potatoes, sliced about ½ inch in thickness
  - Reviewer A: [0, 1, 2, 3, 4, 5, 6]; Reviewer B: [0, 1, 2, 3, 4, 5, 6]; adjudication: [0, 1, 2, 3, 4, 5, 6]
  - Root causes: PERSISTED_MAP_FALSE_NEGATIVE, ACTIVE_USE_DETECTION_MISS, AI_NEVER_ELIGIBLE, DETERMINISTIC_CLASSIFIED_STEP_RESOLVED_TOO_EARLY
- Step 2: Turn the skillet to high heat. Add the 1 tablespoon butter and steak bites. Let the steak sear for a minute and then continue to stir the steak until they are golden brown.
  - Current: 2 tablespoons butter, divided
  - Expected: 2 tablespoons butter, divided; 1 ¼ pounds sirloin steaks, cut into 1 inch cubes
  - Missing: 1 ¼ pounds sirloin steaks, cut into 1 inch cubes
  - Reviewer A: [1, 7]; Reviewer B: [1, 7]; adjudication: [1, 7]
  - Root causes: PERSISTED_MAP_FALSE_NEGATIVE, ACTIVE_USE_DETECTION_MISS, AI_NEVER_ELIGIBLE, DETERMINISTIC_CLASSIFIED_STEP_RESOLVED_TOO_EARLY
- Step 3: Top the steak with fresh chopped herbs.
  - Current: none
  - Expected: 1 teaspoon thyme, chopped; 1 teaspoon rosemary, chopped; 1 teaspoon oregano, chopped; 1 ¼ pounds sirloin steaks, cut into 1 inch cubes
  - Missing: 1 teaspoon thyme, chopped; 1 teaspoon rosemary, chopped; 1 teaspoon oregano, chopped; 1 ¼ pounds sirloin steaks, cut into 1 inch cubes
  - Reviewer A: [4, 5, 6, 7]; Reviewer B: [4, 5, 6]; adjudication: [4, 5, 6, 7]
  - Root causes: PERSISTED_MAP_FALSE_NEGATIVE, SEASONING_RECALL_MISS, AI_NEVER_ELIGIBLE, DETERMINISTIC_CLASSIFIED_STEP_RESOLVED_TOO_EARLY, ACTIVE_USE_DETECTION_MISS
  - Manual adjudication: Primary-agent adjudication added listed steak: the instruction explicitly acts on it as the object being topped.

### Caprese Salad

- Step 1: Arrange alternating slices of tomato and mozzarella on a serving platter.
  - Current: 4 large tomatoes, sliced
  - Expected: 4 large tomatoes, sliced; 8 oz fresh mozzarella, sliced
  - Missing: 8 oz fresh mozzarella, sliced
  - Reviewer A: [0, 1]; Reviewer B: [0, 1]; adjudication: [0, 1]
  - Root causes: PERSISTED_MAP_FALSE_NEGATIVE, ACTIVE_USE_DETECTION_MISS, DETERMINISTIC_CLASSIFIED_STEP_RESOLVED_TOO_EARLY, AI_NEVER_ELIGIBLE
- Step 2: Tuck fresh basil leaves between the slices.
  - Current: none
  - Expected: 1/4 cup fresh basil leaves
  - Missing: 1/4 cup fresh basil leaves
  - Reviewer A: [2]; Reviewer B: [2]; adjudication: [2]
  - Root causes: PERSISTED_MAP_FALSE_NEGATIVE, ACTIVE_USE_DETECTION_MISS, DETERMINISTIC_CLASSIFIED_STEP_RESOLVED_TOO_EARLY, AI_NEVER_ELIGIBLE
- Step 4: Season with salt and pepper, and serve immediately.
  - Current: 1/2 tsp salt
  - Expected: 1/2 tsp salt; 1/4 tsp black pepper
  - Missing: 1/4 tsp black pepper
  - Reviewer A: [5, 6]; Reviewer B: [5, 6]; adjudication: [5, 6]
  - Root causes: PERSISTED_MAP_FALSE_NEGATIVE, SEASONING_RECALL_MISS, DETERMINISTIC_CLASSIFIED_STEP_RESOLVED_TOO_EARLY, AI_NEVER_ELIGIBLE

### Grilled Zucchini and Summer Squash

- Step 1: Preheat a grill or grill pan to medium-high heat.
  - Current: none
  - Expected: none
  - Reviewer A: []; Reviewer B: []; adjudication: []
  - Root causes: none
- Step 2: Toss zucchini and squash slices with olive oil, garlic, Italian herbs, salt, and pepper.
  - Current: 2 medium zucchini, sliced lengthwise; 3 tbsp olive oil; 2 cloves garlic, minced; 1/2 tsp salt
  - Expected: 2 medium zucchini, sliced lengthwise; 2 medium yellow summer squash, sliced lengthwise; 3 tbsp olive oil; 2 cloves garlic, minced; 1 tsp dried Italian herbs; 1/2 tsp salt; 1/4 tsp black pepper
  - Missing: 2 medium yellow summer squash, sliced lengthwise; 1 tsp dried Italian herbs; 1/4 tsp black pepper
  - Reviewer A: [0, 1, 2, 3, 4, 5, 6]; Reviewer B: [0, 1, 2, 3, 4, 5, 6]; adjudication: [0, 1, 2, 3, 4, 5, 6]
  - Root causes: PERSISTED_MAP_FALSE_NEGATIVE, GROUP_SCOPE_OVERRESTRICTION, DETERMINISTIC_CLASSIFIED_STEP_RESOLVED_TOO_EARLY, AI_NEVER_ELIGIBLE, SEASONING_RECALL_MISS
- Step 3: Grill for 3-4 minutes per side, until tender and grill marks appear.
  - Current: none
  - Expected: 2 medium zucchini, sliced lengthwise; 2 medium yellow summer squash, sliced lengthwise
  - Missing: 2 medium zucchini, sliced lengthwise; 2 medium yellow summer squash, sliced lengthwise
  - Reviewer A: [0, 1]; Reviewer B: [0, 1]; adjudication: [0, 1]
  - Root causes: PERSISTED_MAP_FALSE_NEGATIVE, PREPARED_COMPONENT_OVERRESTRICTION, DETERMINISTIC_CLASSIFIED_STEP_RESOLVED_TOO_EARLY, AI_NEVER_ELIGIBLE
- Step 4: Transfer to a platter and garnish with fresh basil before serving.
  - Current: 1 tbsp fresh basil, chopped
  - Expected: 2 medium zucchini, sliced lengthwise; 2 medium yellow summer squash, sliced lengthwise; 1 tbsp fresh basil, chopped
  - Missing: 2 medium zucchini, sliced lengthwise; 2 medium yellow summer squash, sliced lengthwise
  - Reviewer A: [0, 1, 7]; Reviewer B: [0, 1, 7]; adjudication: [0, 1, 7]
  - Root causes: PERSISTED_MAP_FALSE_NEGATIVE, PREPARED_COMPONENT_OVERRESTRICTION, DETERMINISTIC_CLASSIFIED_STEP_RESOLVED_TOO_EARLY, AI_NEVER_ELIGIBLE

The production browser was opened for all three recipes and Cooking Mode ingredient drawers were expanded. The stored/runtime evidence and rendered UI agreed. In addition to the requested Zucchini/Squash checks, Step 2 also omits yellow summer squash.

## Audit coverage

- Review A: 228/228 recipes
- Review B: 228/228 recipes
- Recipes with discrepancy adjudication: 228
- No-discrepancy controls independently re-inspected: 0
- Provider/output format incidents: 1 (recovered; final validated coverage remains 228/228)

Every recipe had at least one current/A/B discrepancy, so the no-discrepancy population was empty; the required control rule therefore reviewed all zero available recipes. All 228 recipes instead received full discrepancy adjudication.

## Corpus precision

TP 1375; FP 12; precision 99.13%.

## Corpus recall

TP 1375; FN 2677; recall 33.93%; F1 50.56%.

## Explicit-active-use recall

1355/3528 present; 2173 missing; recall 38.41%.

## Critical ingredient recall

244/980 present; 736 missing; recall 24.90%.

## Seasoning/herb recall

529/1445 present; 916 missing; recall 36.61%.

## Prepared-component recall

27/663 present; 636 missing; recall 4.07%.

## Per-engine analysis

| Runtime segment | Recipes | TP | FP | FN | Precision | Recall |
|---|---:|---:|---:|---:|---:|---:|
| deterministic-v4 | 145 | 758 | 6 | 1525 | 99.21% | 33.20% |
| hybrid-v4 | 39 | 293 | 3 | 494 | 98.99% | 37.23% |
| deterministic-v5-runtime-fallback | 4 | 26 | 2 | 34 | 92.86% | 43.33% |
| deterministic-v5 | 31 | 221 | 1 | 424 | 99.55% | 34.26% |
| hybrid-v5 | 9 | 77 | 0 | 200 | 100.00% | 27.80% |

## Personal override/runtime fallback analysis

| Recipe | Shared engine | Shared map accepted | Runtime source | FP | FN |
|---|---|---|---|---:|---:|
| Air Fryer Falafel (air-fryer-falafel) | deterministic-v4 | yes | deterministic-v5-fallback | 0 | 5 |
| Best Black Bean Soup (best-black-bean-soup) | hybrid-v4 | yes | persisted | 0 | 17 |
| Blue Corn Green Chili Chicken Enchiladas (blue-corn-green-chili-chicken-enchiladas) | deterministic-v4 | yes | deterministic-v5-fallback | 0 | 2 |
| Crunchy Queso Wrap (crunchy-queso-wrap) | deterministic-v5 | yes | deterministic-v5-fallback | 1 | 21 |
| Garlic Herb Shrimp with White Beans and Spinach (garlic-herb-shrimp-with-white-beans-and-spinach) | deterministic-v4 | yes | persisted | 0 | 8 |
| Kimchi Ramen (kimchi-ramen) | deterministic-v4 | yes | deterministic-v5-fallback | 1 | 6 |
| Peruvian Chicken w/ green sauce (peruvian-chicken-w-green-sauce) | hybrid-v5 | yes | persisted | 0 | 19 |

## Root-cause taxonomy

- PERSISTED_MAP_FALSE_NEGATIVE: 2643
- DETERMINISTIC_CLASSIFIED_STEP_RESOLVED_TOO_EARLY: 1965
- AI_NEVER_ELIGIBLE: 1965
- ACTIVE_USE_DETECTION_MISS: 464
- SEASONING_RECALL_MISS: 372
- PREPARED_COMPONENT_OVERRESTRICTION: 320
- GROUP_SCOPE_OVERRESTRICTION: 227
- INGREDIENT_IDENTITY_NORMALIZATION: 42
- RUNTIME_PERSISTED_MAP_REJECTED: 36
- SOURCE_HASH_OR_OVERRIDE_FALLBACK: 36
- DETERMINISTIC_FALLBACK_FALSE_NEGATIVE: 34
- ROW_LIFECYCLE_OVERRESTRICTION: 14
- PERSISTED_MAP_FALSE_POSITIVE: 10
- DETERMINISTIC_FALLBACK_FALSE_POSITIVE: 2
- OTHER: 1

## False negatives

Total 2677 across 228 recipes: CRITICAL 736, HIGH 801, MEDIUM 969, LOW 171.

## False positives

Total 12 across 11 recipes.

## Worst affected recipes

### Top 20 by false-negative count

- Mole Poblano (mole-poblano): FN 91, FP 0, grade MATERIAL_OMISSIONS
- Dad's Chili (dads-chili): FN 49, FP 0, grade AMBIGUOUS_SOURCE
- Slow Cooker Chicken Ropa Vieja (173): FN 37, FP 0, grade MATERIAL_OMISSIONS
- Easy Slow Cooker Turkey Chili (159): FN 34, FP 0, grade MATERIAL_OMISSIONS
- Fried Chicken Sandwich (fried-chicken-sandwich): FN 30, FP 0, grade AMBIGUOUS_SOURCE
- Pozole Verde - WOWZA (pozole-verde-wowza): FN 29, FP 0, grade MATERIAL_OMISSIONS
- Slow Cooker Chicken Taco Soup (164): FN 27, FP 0, grade MATERIAL_OMISSIONS
- Slow Cooker Beef Brisket with BBQ Sauce (171): FN 26, FP 0, grade MATERIAL_OMISSIONS
- Crockpot Chicken Wild Rice Soup (152): FN 25, FP 0, grade MATERIAL_OMISSIONS
- Creamy Chickpea Spinach Masala With Tadka (creamy-chickpea-spinach-masala-with-tadka): FN 25, FP 0, grade MATERIAL_OMISSIONS
- Mediterranean Quinoa Bowl (mediterranean-quinoa-bowl): FN 24, FP 0, grade MATERIAL_OMISSIONS
- Tacos Al Pastor (tacos-al-pastor): FN 24, FP 0, grade MATERIAL_OMISSIONS
- Grownup Mustard Sauce Recipe (grownup-mustard-sauce-recipe): FN 23, FP 0, grade AMBIGUOUS_SOURCE
- Butter-Soy Chicken and Asparagus Stir-Fry (buttersoy-chicken-and-asparagus-stirfry): FN 22, FP 0, grade MATERIAL_OMISSIONS
- Mediterranean Grilled Salmon (mediterranean-grilled-salmon): FN 22, FP 0, grade MATERIAL_OMISSIONS
- Crunchy Queso Wrap (crunchy-queso-wrap): FN 21, FP 1, grade UNSAFE
- Spicy Shrimp Tacos with Garlic Cilantro Lime Slaw (178): FN 21, FP 0, grade AMBIGUOUS_SOURCE
- Grilled fish tacos (grilled-fish-tacos): FN 21, FP 0, grade MATERIAL_OMISSIONS
- Chicken Stew (chicken-stew): FN 20, FP 0, grade MATERIAL_OMISSIONS
- Chopped Thai Shrimp Salad with Garlic Lime Dressing (chopped-thai-shrimp-salad-with-garlic-lime-dressing): FN 20, FP 0, grade MATERIAL_OMISSIONS

### All recipes with CRITICAL omissions

- The BEST Black Bean Chili (151)
- Crockpot Chicken Wild Rice Soup (152)
- Slow Cooker Carnitas (Mexican Pulled Pork) (155)
- Easy Slow Cooker Pot Roast (156)
- Slow Cooker Minnesota Pork Chop Casserole (157)
- Creamy Crockpot White Chicken Chili (158)
- Easy Slow Cooker Turkey Chili (159)
- Slow Cooker Beef Stew (161)
- Easy Slow Cooker Chicken Pot Pie (162)
- Slow Cooker Chicken Taco Soup (164)
- Overnight Oatmeal (166)
- Slow Cooker Pumpkin Applesauce (167)
- Slow Cooker Garlic Butter Chicken Pasta (168)
- Slow Cooker Beef Brisket with BBQ Sauce (171)
- Slow Cooker Chicken Ropa Vieja (173)
- Garlic Butter Roasted Chicken Thighs with Charred Lemon Salsa Verde + Asparagus (176)
- Spicy Shrimp Tacos with Garlic Cilantro Lime Slaw (178)
- Spicy Fish Taco Bowls with Cilantro Lime Slaw (179)
- Garlic Parmesan Kale Pasta (180)
- Spicy Quinoa with Sweet Potatoes (182)
- Pressure-Cooker Spring-Thyme Chicken Stew (184)
- Instant Pot Red Beans and Rice (185)
- Instant Pot Lemon Chicken Thighs (186)
- Instant Pot Mississippi Pot Roast (187)
- Instant Pot BBQ Pulled Pork (188)
- Instant Pot Perfect Hard Boiled Eggs (189)
- Instant Pot Boiled Potatoes (190)
- Chicken Tinga Tacos (191)
- Easy Instant Pot Vegetable Biryani (192)
- Pressure-Cooker Easy Pork Posole (194)
- Instant Pot Orange Chicken (198)
- Hush Puppies (199)
- Air Fried Sweet Potato Fries with Rosemary and Garlic (air-fried-sweet-potato-fries-with-rosemary-and-garlic)
- Balsamic Roasted Beets (balsamic-roasted-beets)
- Best Black Bean Soup (best-black-bean-soup)
- Black Lentil and Harissa-Roasted Veggie Bowl (black-lentil-and-harissa-roasted-veggie-bowl)
- Blackened Chicken Breasts (blackened-chicken-breasts)
- Blue Corn Green Chili Chicken Enchiladas (blue-corn-green-chili-chicken-enchiladas)
- Braised Red Cabbage (braised-red-cabbage)
- Bread! (bread)
- Broccoli Salad (broccoli-salad)
- Brown Butter Lentil and Sweet Potato Salad (brown-butter-lentil-and-sweet-potato-salad)
- Buttered Peas with Mint (buttered-peas-with-mint)
- Butter-Soy Chicken and Asparagus Stir-Fry (buttersoy-chicken-and-asparagus-stirfry)
- Caprese Salad (caprese-salad)
- Caramelized Brussels Sprouts Pasta With Toasted Chickpeas (caramelized-brussels-sprouts-pasta-with-toasted-chickpeas)
- Cauliflower Breakfast Muffins (cauliflower-breakfast-muffins)
- Cauliflower Curry (cauliflower-curry)
- Chana Masala (chana-masala)
- Charlie Bird's Farro Salad (charlie-bird-s-farro-salad)
- Charred Corn and Chickpea Salad With Lime Crema (charred-corn-and-chickpea-salad-with-lime-crema)
- Chicken Chickpea Salad (chicken-chickpea-salad)
- Chicken Chow Mein (chicken-chow-mein)
- Chicken Enchiladas (chicken-enchiladas)
- Chicken Fajitas (chicken-fajitas)
- Chicken Gyro Chopped Salad (chicken-gyro-chopped-salad)
- Chicken Meatballs with Peppers and Orzo (chicken-meatballs-with-peppers-and-orzo)
- Chicken Souvlaki Bowl with Tzatziki (chicken-souvlaki-bowl-with-tzatziki)
- Chicken Stew (chicken-stew)
- Chicken Tacos w/ Pineapple (chicken-tacos-w-pineapple)
- Chicken Tikka (chicken-tikka)
- chicken wild rice (chicken-wild-rice)
- Chickpea and Fennel Ratatouille (chickpea-and-fennel-ratatouille)
- Chickpea Curry (chickpea-curry)
- Chile-Crisp Tofu, Tomatoes and Cucumbers (chilecrisp-tofu-tomatoes-and-cucumbers)
- Chili Lime Fish (chili-lime-fish)
- Chimichurri Chicken (chimichurri-chicken)
- Chinese Chili Oil (chinese-chili-oil)
- Chopped Thai Shrimp Salad with Garlic Lime Dressing (chopped-thai-shrimp-salad-with-garlic-lime-dressing)
- Citrusy Couscous Salad With Broccoli and Feta (citrusy-couscous-salad-with-broccoli-and-feta)
- Classic BBQ Corn (classic-bbq-corn)
- Couscous Salad With Lime Basil Vinaigrette (couscous-salad-with-lime-basil-vinaigrette)
- Crazy good Dal Adas (Spicy Red Lentil Tamarind Soup) (crazy-good-dal-adas-spicy-red-lentil-tamarind-soup)
- Creamy Cauliflower Soup With Rosemary Olive Oil (creamy-cauliflower-soup-with-rosemary-olive-oil)
- Creamy Chickpea Spinach Masala With Tadka (creamy-chickpea-spinach-masala-with-tadka)
- Creamy Kale Pasta (creamy-kale-pasta)
- Crisp Gnocchi With Brussels Sprouts and Brown Butter (crisp-gnocchi-with-brussels-sprouts-and-brown-butter)
- Crispy Gnocchi With Burst Tomatoes and Mozzarella (crispy-gnocchi-with-burst-tomatoes-and-mozzarella)
- Crispy Gnocchi With Sausage and Broccoli (crispy-gnocchi-with-sausage-and-broccoli)
- Crispy Gnocchi With Tomato and Red Onion (crispy-gnocchi-with-tomato-and-red-onion)
- Crunchy Queso Wrap (crunchy-queso-wrap)
- Cucumber Salad (cucumber-salad)
- Curried Red Bean Soup With Kale (curried-red-bean-soup-with-kale)
- Curry Tomatoes and Chickpeas With Cucumber Yogurt (curry-tomatoes-and-chickpeas-with-cucumber-yogurt)
- Dad's Chili (dads-chili)
- Dan Dan Noodles (dan-dan-noodles)
- Doro Wat (Ethiopian-Style Spicy Chicken) (doro-wat-ethiopianstyle-spicy-chicken)
- Easy Chicken Ramen (easy-chicken-ramen)
- Easy Spaghetti With Meat Sauce (easy-spaghetti-with-meat-sauce)
- Filipino Brased Chicken Tocino (filipino-brased-chicken-tocino)
- Fried Chicken Sandwich (fried-chicken-sandwich)
- GARLIC BUTTER HERB STEAK BITES WITH POTATOES (garlic-butter-herb-steak-bites-with-potatoes)
- Garlic Butter Roasted Broccoli (garlic-butter-roasted-broccoli)
- Garlic Herb Shrimp with White Beans and Spinach (garlic-herb-shrimp-with-white-beans-and-spinach)
- Garlic Parmesan Roasted Potatoes (garlic-parmesan-roasted-potatoes)
- Gochugaru Salmon With Crispy Rice (gochugaru-salmon-with-crispy-rice)
- Gochujang Noodles with Crispy Tofu (gochujang-noodles-with-crispy-tofu)
- Green Goddess Roasted Chicken (green-goddess-roasted-chicken)
- Grilled Chicken Salad (grilled-chicken-salad)
- Grilled fish tacos (grilled-fish-tacos)
- Grilled Salmon (grilled-salmon)
- Grilled Zucchini and Summer Squash (grilled-zucchini-and-summer-squash)
- Grownup Mustard Sauce Recipe (grownup-mustard-sauce-recipe)
- Heart-Healthy Peanut Butter Protein Bars (hearthealthy-peanut-butter-protein-bars)
- Herb-Roasted Cauliflower (herb-roasted-cauliflower)
- Honey Butter Glazed Carrots (honey-butter-glazed-carrots)
- Honey Glazed Roasted Parsnips (honey-glazed-roasted-parsnips)
- HONEY SRIRACHA ROASTED BRUSSELS SPROUTS (honey-sriracha-roasted-brussels-sprouts)
- Hot Mustard Grilled Chicken (hot-mustard-grilled-chicken)
- Huevos Rotos (Broken Eggs) (huevos-rotos-broken-eggs)
- Indian Spiced Roasted Vegetables (indian-spiced-roasted-vegetables)
- Intsa Punjabi Chole (intsa-punjabi-chole)
- Italian Sausage and White Bean Salad (italian-sausage-and-white-bean-salad)
- Jalapeño Cheddar Cornbread (jalape-o-cheddar-cornbread)
- Jam Oat Bars (jam-oat-bars)
- Japanese Cold Soba Noodle Salad (japanese-cold-soba-noodle-salad)
- Japanese Teriyaki Salmon Bowl (japanese-teriyaki-salmon-bowl)
- Jocón (Chicken and Tomatillo Stew) - Amazing (jocn-chicken-and-tomatillo-stew)
- Kale and Quinoa Salad With Plums and Herbs (kale-and-quinoa-salad-with-plums-and-herbs)
- Kimchi Ramen (kimchi-ramen)
- Korean Bulgogi Beef Bowls (korean-bulgogi-beef-bowls)
- Korean Sundubu Jjigae (Soft Tofu Stew) (korean-sundubu-jjigae-soft-tofu-stew)
- Kung Pao Tofu (kung-pao-tofu)
- Lebanese Lemon Garlic Chicken Thighs (lebanese-lemon-garlic-chicken-thighs)
- Lemon Garlic Roasted Artichokes (lemon-garlic-roasted-artichokes)
- Lemon Herb Pasta Salad with Marinated Chickpeas (lemon-herb-pasta-salad-with-marinated-chickpeas)
- Mango Black Bean Quinoa Bowl (mango-black-bean-quinoa-bowl)
- Mapo Ragù - crazy good (mapo-rag-crazy-good)
- Maraq Misir (Red Lentil Soup) (maraq-misir-red-lentil-soup)
- Mediterranean Grilled Salmon (mediterranean-grilled-salmon)
- Mediterranean Quinoa Bowl (mediterranean-quinoa-bowl)
- Megan's wild rice & Kale Salad (megans-wild-rice-kale-salad)
- Mexican Oaxacan Bowl (mexican-oaxacan-bowl)
- Mexican Roasted Cauliflower (mexican-roasted-cauliflower)
- Mexican Roasted Zucchini (mexican-roasted-zucchini)
- Michelada Chicken (michelada-chicken)
- Miso Glazed Eggplant (miso-glazed-eggplant)
- Mole Poblano (mole-poblano)
- Moqueca - Brazilian Fish Stew (moqueca-brazilian-fish-stew)
- Moroccan Spiced Carrot and Chickpea Soup (moroccan-spiced-carrot-and-chickpea-soup)
- One-Pot Beans, Greens and Grains (onepot-beans-greens-and-grains)
- One-Pot Chicken and Lentil (onepot-chicken-and-lentil)
- One-Pot Chicken and Rice With Caramelized Lemon (onepot-chicken-and-rice-with-caramelized-lemon)
- One-Pot Ratatouille Pasta (onepot-ratatouille-pasta)
- One-Pot Tofu and Broccoli Rice (onepot-tofu-and-broccoli-rice)
- Original Texas Chili Con Carne (original-texas-chili-con-carne)
- Orzo Salad (orzo-salad)
- Pad Thai (pad-thai)
- Peanut Butter Oat Protein Shake (peanut-butter-oat-protein-shake)
- Pearl Couscous Skillet With Tomatoes, Chickpeas, And Feta (pearl-couscous-skillet-with-tomatoes-chickpeas-and-feta)
- Pearl Couscous With Creamy Feta and Chickpeas - meh (pearl-couscous-with-creamy-feta-and-chickpeas-meh)
- Pepper Steak (pepper-steak)
- Peruvian Chicken w/ green sauce (peruvian-chicken-w-green-sauce)
- Peruvian Roasted Chicken With Spicy Cilantro Sauce (peruvian-roasted-chicken-with-spicy-cilantro-sauce)
- Pesto (pesto)
- Pork Fried Rice (pork-fried-rice)
- Pozole Verde - WOWZA (pozole-verde-wowza)
- Pulled pork (pulled-pork)
- Queso Chicken Chili with Roasted Corn and Jalapeño (queso-chicken-chili-with-roasted-corn-and-jalape-o)
- Rainbow Quinoa Salad (rainbow-quinoa-salad)
- Ramen Carbonara (ramen-carbonara)
- Ribollita (Tuscan White Bean Soup) (ribollita-tuscan-white-bean-soup)
- Rice Pilaf (rice-pilaf)
- Roasted Acorn Squash with Brown Butter (roasted-acorn-squash-with-brown-butter)
- Roasted Asparagus with Lemon (roasted-asparagus-with-lemon)
- Roasted Broccoli Salad (roasted-broccoli-salad)
- Roasted Brussels Sprouts with Bacon (roasted-brussels-sprouts-with-bacon)
- Roasted Cauliflower Tacos with Chipotle Crema (roasted-cauliflower-tacos-with-chipotle-crema)
- Roasted Radishes with Herb Butter (roasted-radishes-with-herb-butter)
- Roasted Root Vegetable Medley (roasted-root-vegetable-medley)
- Roasted Veggie Bowl (roasted-veggie-bowl)
- Roasted White Bean and Tomato Pasta (roasted-white-bean-and-tomato-pasta)
- Saucy Gochujang Noodles with Chicken (saucy-gochujang-noodles-with-chicken)
- Sausage Ragù (sausage-rag)
- Sautéed Garlic Green Beans (saut-ed-garlic-green-beans)
- Sautéed Kale with Garlic and Lemon (saut-ed-kale-with-garlic-and-lemon)
- Schmancy Hot Smoked Salmon (schmancy-hot-smoked-salmon)
- Seared Broccoli and Potato Soup (seared-broccoli-and-potato-soup)
- Sesame Apricot Tofu (sesame-apricot-tofu)
- Shakshucka (shakshucka)
- Shakshuka With Feta (shakshuka-with-feta)
- Sheet-Pan Bibimbap (sheet-pan-bibimbap)
- Sheet Pan Chicken Tinga Bowls (sheet-pan-chicken-tinga-bowls)
- Sheet-Pan Kielbasa With Cabbage and Beans (sheet-pan-kielbasa-with-cabbage-and-beans)
- Sheet-Pan Gochujang Chicken and Roasted Vegetables (sheetpan-gochujang-chicken-and-roasted-vegetables)
- Shrimp Pullao (shrimp-pullao)
- Simple House Salad with Vinaigrette (simple-house-salad-with-vinaigrette)
- Singapore Mei Fun (singapore-mei-fun)
- Skillet Chicken and Pearl Couscous With Moroccan Spices (skillet-chicken-and-pearl-couscous-with-moroccan-spices)
- Skillet Gnocchi With Miso Butter and Asparagus (skillet-gnocchi-with-miso-butter-and-asparagus)
- Slow Cooker Creamy Tomato Lentil Soup (slow-cooker-creamy-tomato-lentil-soup)
- Smashed Cucumber Edamame Rice Bowl (smashed-cucumber-edamame-rice-bowl)
- Smashed Zucchini With Chickpeas and Peanuts (smashed-zucchini-with-chickpeas-and-peanuts)
- Spanish Chickpea and Spinach (Espinacas con Garbanzos) (spanish-chickpea-and-spinach-espinacas-con-garbanzos)
- Spicy Coconut Lentil Soup (spicy-coconut-lentil-soup)
- Spicy Oven-Fried Rice With Gochujang and Fried Eggs (spicy-ovenfried-rice-with-gochujang-and-fried-eggs)
- Sticky Miso Salmon Bowl (sticky-miso-salmon-bowl)
- Sticky Pineapple Ribs (sticky-pineapple-ribs)
- Suadero Tacos (suadero-tacos)
- Taco Soup (taco-soup)
- Tacos Al Pastor (tacos-al-pastor)
- Tamales - chicken (tamales-chicken)
- Thai Basil Chicken (Pad Kra Pao) (thai-basil-chicken-pad-kra-pao)
- Thai Salad (thai-salad)
- The Easiest Vegetable Stir Fry (the-easiest-vegetable-stir-fry)
- Tom Kha Gai (Thai Coconut Chicken Soup) (tom-kha-gai-thai-coconut-chicken-soup)
- tomato avo salad (tomato-avo-salad)
- Toor Dal (Split Yellow Pigeon Peas) (toor-dal-split-yellow-pigeon-peas)
- Traditional Southern Butter Butter Beans Recipe (traditional-southern-butter-butter-beans-recipe)
- Turkish Red Lentil Soup (Mercimek Çorbası) (turkish-red-lentil-soup)
- Tuscan Bean Soup (tuscan-bean-soup)
- Tzatziki Chickpea Salad (tzatziki-chickpea-salad)
- Vegetarian Skillet Chili (vegetarian-skillet-chili)
- West African Peanut Stew (west-african-peanut-stew)
- Zibdiyit Gambari (Spicy Shrimp and Tomato Stew) (zibdiyit-gambari-spicy-shrimp-and-tomato-stew)

### All recipes with false positives

- Garlic Butter Roasted Chicken Thighs with Charred Lemon Salsa Verde + Asparagus (176): 1
- Easy Instant Pot Vegetable Biryani (192): 1
- Chicken Meatballs with Peppers and Orzo (chicken-meatballs-with-peppers-and-orzo): 1
- Chicken Paprikash (chicken-paprikash): 1
- Crunchy Queso Wrap (crunchy-queso-wrap): 1
- Kimchi Ramen (kimchi-ramen): 1
- Moqueca - Brazilian Fish Stew (moqueca-brazilian-fish-stew): 1
- Pad Thai (pad-thai): 1
- Pearl Couscous Skillet With Tomatoes, Chickpeas, And Feta (pearl-couscous-skillet-with-tomatoes-chickpeas-and-feta): 2
- Sesame Apricot Tofu (sesame-apricot-tofu): 1
- Turkish Red Lentil Soup (Mercimek Çorbası) (turkish-red-lentil-soup): 1

## AI reviewer effectiveness

Of 2677 confirmed omissions: A found 2620; B found 2630; either found 2675; both found 2575; both missed 2.

## AI eligibility analysis

712 confirmed omissions were on currently AI-eligible deterministic-v5 steps; 1965 were not AI-eligible. Current deterministic-v5 would recover 23 omissions and would still miss 2654.

## Architecture recommendation

Use a bounded whole-recipe AI completeness pass after deterministic/hybrid candidate generation, followed by the existing deterministic safety validator plus explicit completeness gates. First regenerate legacy v4 persisted maps only where the read-only v5 comparison proves an improvement; regeneration alone is insufficient for omissions v5 still misses. Expand AI eligibility as a compatibility measure, but do not rely on eligibility expansion alone when resolved-too-early steps dominate. Do not patch individual recipes first.

- Option A (deterministic-v6 rules): use only for repeated, text-grounded safe patterns from the candidate taxonomy.
- Option B (expanded AI eligibility): useful but cannot inspect steps the deterministic engine declares resolved unless eligibility semantics change broadly.
- Option C (whole-recipe completeness pass): recommended because the blind reviewers recovered the measured majority of confirmed omissions.
- Option D (AI-first map): unnecessary risk to the current precision protections.
- Option E (manual legacy cleanup): useful one-time hygiene, not a future architecture.

## Proposed quality gates

- Overall precision: 100% on adjudicated production evidence.
- Explicit-active-use recall: at least 98%.
- CRITICAL ingredient recall: 100%.
- HIGH ingredient recall: at least 99%.
- Seasoning/herb recall: at least 98%, with no named explicit-use seasoning miss.
- Every future apply requires source-hash validation and a zero-write dry run.

## AI usage

Review A validated outputs: 228; requests: 231. Review B validated outputs: 228; requests: 231. Controls: 0 validated / 0 requests. Adjudications: 228 validated / 228 requests. Recorded retry attempts: 5; recovered format incidents: 1; unrecovered failures: 0.
Input tokens: 1657889; output tokens: 1352522; total tokens: 3010411. The provider emitted no authoritative dollar cost, so none is estimated.

## Production mutation

**0.** Firestore recipe/map/meta writes: 0. Parser, mapping engine, validator, and UI changes: 0.

## Audit artifacts

- docs/audits/cooking-mode-completeness-audit-2026-08-26.json
- docs/audits/cooking-mode-completeness-audit-2026-08-26.md
- docs/audits/cooking-mode-completeness-remediation-candidates-2026-08-26.json (2677 review-only candidates; not an apply manifest)

## Verification

- `npm run lint` — PASS with six existing warnings (five `no-img-element`, one unused eslint-disable).
- `npm run typecheck` — PASS.
- `npm run build` — PASS.
- `npm test` — PASS: 60 files passed / 1 skipped; 826 tests passed / 1 skipped (827 total).
- New audit tests — 15.
- `git diff --check` — PASS.

## Unverifiable items

None. The one recorded format incident was recovered and all 228 Review B outputs validate.

## Next action

> Create a new architecture/remediation prompt from the measured false-negative taxonomy. Do not patch individual recipes first.
