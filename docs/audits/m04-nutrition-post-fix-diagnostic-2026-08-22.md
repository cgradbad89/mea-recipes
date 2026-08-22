# M-04 Nutrition Post-Fix Diagnostic — 2026-08-22

> Read-only diagnostic of the exact 13 Prompt 4B recipe IDs after Prompt 4D engine remediation.
> It called `computeRecipeNutrition(recipeId)` directly, performed no route call, passed no
> `apply=true` parameter, and executed zero Firestore mutations. Existing recipe content,
> including `maple-roasted-candied-pecans` and `smoothies`, was not modified.

- Population: 13 recipes
- Proposed confidence: 2 high / 10 medium / 1 low
- Raw evidence: `m04-nutrition-post-fix-raw-2026-08-22.json`

## Per-recipe results

| Recipe | Proposed kcal/serving | Protein | Carbs | Fat | Fiber | Sugar | Confidence | Unresolved | Canonical hits |
|---|---:|---:|---:|---:|---:|---:|---|---:|---:|
| Heart-Healthy Peanut Butter Protein Bars (`hearthealthy-peanut-butter-protein-bars`) | 618 | 21.6g | 40.4g | 45g | 7.7g | 10.5g | medium | 2 | 2 |
| Peanut Butter Oat Protein Shake (`peanut-butter-oat-protein-shake`) | 382 | 11g | 48g | 18.6g | 9.6g | 11.7g | medium | 2 | 3 |
| Spaghetti Carbonara (`spaghetti-carbonara`) | 889 | 42.5g | 87.2g | 39.8g | 3.6g | 3.7g | medium | 0 | 2 |
| Bread! (`bread`) | 343 | 9.8g | 71.9g | 0.9g | 2.6g | 0.3g | high | 0 | 1 |
| Chicken Chickpea Salad (`chicken-chickpea-salad`) | 433 | 10.8g | 30.4g | 31.5g | 9.3g | 6.7g | low | 4 | 13 |
| Chicken Meatballs with Peppers and Orzo (`chicken-meatballs-with-peppers-and-orzo`) | 572 | 40.8g | 62.6g | 18.2g | 8.3g | 8.1g | medium | 1 | 8 |
| Chinese Chili Oil (`chinese-chili-oil`) | 93 | 0.6g | 1.1g | 9.9g | 0.3g | 0.1g | medium | 3 | 2 |
| HONEY SRIRACHA ROASTED BRUSSELS SPROUTS (`honey-sriracha-roasted-brussels-sprouts`) | 190 | 6g | 30.7g | 7.4g | 7g | 17.5g | high | 0 | 3 |
| Chopped Thai Shrimp Salad with Garlic Lime Dressing (`chopped-thai-shrimp-salad-with-garlic-lime-dressing`) | 530 | 27.3g | 37.4g | 31.7g | 5.9g | 7.8g | medium | 3 | 8 |
| Intsa Punjabi Chole (`intsa-punjabi-chole`) | 117 | 4.7g | 16.7g | 4.4g | 5.1g | 2.7g | medium | 0 | 8 |
| Rising Sun - Mazcal (`rising-sun-mazcal`) | 133 | 0.2g | 9.1g | 0.1g | 0.5g | 5.7g | medium | 1 | 1 |
| Speget with fake meat meatballs (`speget-with-fake-meat-meatballs`) | 397 | 27.2g | 31.5g | 19.3g | 7.6g | 9.2g | medium | 1 | 6 |
| yogurt Dill sauce (`yogurt-dill-sauce`) | 25 | 1g | 4.2g | 0.6g | 0.2g | 1.8g | medium | 3 | 2 |

## Apply decision

Nutrition was not applied. Review the raw ingredient-level resolutions and retain the existing apply block until each remaining semantic mismatch is resolved.
