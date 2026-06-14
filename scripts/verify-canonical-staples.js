#!/usr/bin/env node
/**
 * scripts/verify-canonical-staples.js  (Batch 4)
 *
 * Builds + verifies the curated canonical-staples table (lib/canonicalStaples.ts).
 *
 * For each hand-curated seed it:
 *   1. searches the LIVE USDA FoodData Central API (SR Legacy + Foundation only —
 *      the plain, generic, unsweetened base forms we want),
 *   2. picks the best candidate (data-type weight + token overlap, penalising
 *      sweetened/sauce/branded-style noise via the per-seed `avoid` list, and
 *      REQUIRING every `expect` keyword to appear),
 *   3. fetches that fdcId's authoritative per-100g macros from the detail endpoint,
 *   4. checks the kcal/100g sanity band for the seed's food class.
 *
 * Only entries that pass verification are written to lib/canonicalStaples.ts.
 * Anything that fails is LISTED (with the reason) in scripts/canonical-verify-log.json
 * and the console summary, and is intentionally LEFT OUT of the table so it falls
 * through to the existing fuzzy matcher (status-quo, never a wrong canonical match).
 *
 * Nothing here touches Firestore. It only reads the USDA API + writes two repo files.
 *
 * Usage:  node scripts/verify-canonical-staples.js
 */

const fs = require('fs')
const path = require('path')
const { loadEnv } = require('./_lib')

loadEnv()
const USDA_API_KEY = process.env.USDA_API_KEY
if (!USDA_API_KEY) { console.error('USDA_API_KEY missing from .env.local'); process.exit(1) }

const USDA_SEARCH = 'https://api.nal.usda.gov/fdc/v1/foods/search'
const USDA_DETAIL = 'https://api.nal.usda.gov/fdc/v1/food'

// kcal/100g sanity bands — MUST mirror KCAL_BANDS in lib/nutritionEngine.ts.
const KCAL_BANDS = {
  oil: [700, 950], butter: [600, 800], leafy: [5, 200], legume: [40, 400],
  meat: [80, 450], bacon: [350, 600], cheese: [150, 500], nuts: [450, 750],
  sugar: [300, 420], flour: [300, 400], broth: [0, 60], spice: [100, 600],
  vegetable: [5, 150], fruit: [15, 250], dairy: [30, 350], condiment: [0, 500],
  grain: [80, 400], unknown: [0, 950],
}

// ── Curated seeds ────────────────────────────────────────────────────────────
// key:    canonical display name
// aliases: phrases that should resolve here (tokenised by the engine's keyTokens)
// query:  USDA search query (favour the plain/raw/unsalted base form)
// cls:    FoodClass for the kcal-band sanity check
// expect: ALL of these words must appear in the chosen description (lowercased)
// avoid:  NONE of these words may appear (sweetened/sauce/branded noise)
// guard:  optional regex on the raw ingredient name — skip this entry when the
//         ingredient is a qualified homograph that has no dedicated entry
//         (e.g. "butter beans" must never match dairy butter).
const SEEDS = [
  // ── Oils (macro-identical across types: ~884 kcal, 100% fat, 0 sugar) ──
  { key: 'olive oil', aliases: ['olive oil', 'extra virgin olive oil'], query: 'oil olive salad or cooking', cls: 'oil', expect: ['olive'], avoid: ['spray', 'dressing'] },
  { key: 'vegetable oil', aliases: ['vegetable oil', 'cooking oil', 'neutral oil', 'oil'], query: 'oil soybean salad or cooking', cls: 'oil', expect: ['oil', 'soybean'], avoid: ['palm', 'olive', 'sesame', 'coconut', 'spray', 'fish', 'hydrogenated'] },
  { key: 'canola oil', aliases: ['canola oil'], query: 'oil canola', cls: 'oil', expect: ['canola'], avoid: ['spray'] },
  { key: 'sesame oil', aliases: ['sesame oil', 'toasted sesame oil'], query: 'oil sesame salad or cooking', cls: 'oil', expect: ['sesame'], avoid: ['seed'] },
  { key: 'coconut oil', aliases: ['coconut oil'], query: 'oil coconut', cls: 'oil', expect: ['coconut'], avoid: [] },
  { key: 'peanut oil', aliases: ['peanut oil'], query: 'oil peanut salad or cooking', cls: 'oil', expect: ['peanut', 'oil'], avoid: ['corn', 'olive', 'blend'] },
  { key: 'avocado oil', aliases: ['avocado oil'], query: 'oil avocado', cls: 'oil', expect: ['avocado'], avoid: [] },

  // ── Butter / fats ──
  { key: 'butter', aliases: ['butter', 'unsalted butter', 'salted butter'], query: 'butter without salt', cls: 'butter', expect: ['butter'], avoid: ['peanut', 'almond', 'apple', 'cocoa', 'bean', 'whipped', 'oil', 'powder'], guard: /\b(bean|nut|squash|milk|scotch|cocoa|apple|peanut|almond|cashew|sun)\b/i },

  // ── Flours / starches ──
  // flour guard uses 'wheat' (a SURVIVING token) not 'whole[- ]?wheat' — "whole" is a
  // stripped descriptor, so "whole wheat flour" arrives as "wheat flour"; guarding on
  // 'wheat' correctly routes it to the whole-wheat-flour entry instead of all-purpose.
  { key: 'all-purpose flour', aliases: ['flour', 'all-purpose flour', 'all purpose flour', 'white flour', 'plain flour'], query: 'wheat flour white all-purpose enriched', cls: 'flour', expect: ['flour', 'wheat'], avoid: ['self-rising', 'bread', 'cake', 'whole'], guard: /\b(almond|coconut|oat|rice|chickpea|garbanzo|semolina|tapioca|cassava|buckwheat|corn|wheat|self[- ]?rising|cake|bread)\b/i },
  { key: 'whole wheat flour', aliases: ['whole wheat flour', 'wholemeal flour'], query: 'flour whole wheat', cls: 'flour', expect: ['flour', 'whole', 'wheat'], avoid: ['white', 'pastry'] },
  { key: 'bread flour', aliases: ['bread flour'], query: 'wheat flour bread', cls: 'flour', expect: ['flour', 'bread'], avoid: [] },
  { key: 'cornstarch', aliases: ['cornstarch', 'corn starch', 'cornflour'], query: 'cornstarch', cls: 'flour', expect: ['cornstarch'], avoid: [] },

  // ── Sugars / sweeteners ──
  { key: 'granulated sugar', aliases: ['sugar', 'granulated sugar', 'white sugar', 'caster sugar'], query: 'sugars granulated', cls: 'sugar', expect: ['sugars', 'granulated'], avoid: ['brown', 'powder', 'invert', 'maple', 'pastry', 'cookie'], guard: /\b(brown|powder|powdered|confectioner|coconut|date|palm|maple|invert|snap|snow|peas?|pumpkin|butter|nuts?|almond|peanut|cashew|cookie|free)\b/i },
  { key: 'brown sugar', aliases: ['brown sugar', 'light brown sugar', 'dark brown sugar'], query: 'sugars brown', cls: 'sugar', expect: ['sugars', 'brown'], avoid: ['substitute', 'pastry', 'toaster', 'cereal', 'cookie', 'candies', 'glaze'] },
  { key: 'powdered sugar', aliases: ['powdered sugar', 'confectioners sugar', 'icing sugar'], query: 'sugars powdered', cls: 'sugar', expect: ['sugar', 'powder'], avoid: [] },
  { key: 'honey', aliases: ['honey'], query: 'honey', cls: 'condiment', expect: ['honey'], avoid: ['roasted', 'cereal', 'graham'] },
  { key: 'maple syrup', aliases: ['maple syrup', 'pure maple syrup'], query: 'syrups maple', cls: 'condiment', expect: ['maple'], avoid: ['pancake', 'flavored', 'imitation'] },
  { key: 'molasses', aliases: ['molasses'], query: 'molasses', cls: 'condiment', expect: ['molasses'], avoid: [] },

  // ── Tomato products (the bad-match-prone, sweet-adjacent core) ──
  { key: 'tomato paste', aliases: ['tomato paste'], query: 'tomato products canned paste without salt added', cls: 'vegetable', expect: ['tomato', 'paste', 'products'], avoid: ['sauce', 'soup', 'sun-dried', 'ketchup', 'puree'] },
  { key: 'tomato sauce', aliases: ['tomato sauce', 'plain tomato sauce', 'passata'], query: 'tomato sauce canned', cls: 'vegetable', expect: ['tomato', 'sauce'], avoid: ['spaghetti', 'marinara', 'pasta', 'with', 'meat', 'mushroom', 'cheese'] },
  // "whole peeled tomatoes" dropped — collapses to bare {tomato} (whole/peeled are
  // stripped), which ties with the fresh-tomato entry and catches sun-dried/tomato-soup.
  { key: 'crushed tomatoes', aliases: ['crushed tomatoes', 'canned tomatoes', 'canned whole tomatoes'], query: 'tomatoes canned', cls: 'vegetable', expect: ['tomato', 'canned'], avoid: ['paste', 'sauce', 'soup', 'juice', 'sun-dried', 'green'] },
  // Bare "tomato"/"tomatoes" dropped: with crushed-tomatoes' degenerate {tomato} alias
  // removed, a bare alias here would make plain "tomatoes" (incl. canned forms like
  // "fire-roasted tomatoes", "can tomatoes") resolve to FRESH tomato — an under-count
  // vs the fuzzy matcher's canned match (a new regression). Only the unambiguously-fresh
  // qualified forms are kept; plain "tomatoes" falls through to the fuzzy matcher (= v1).
  { key: 'tomato', aliases: ['roma tomato', 'roma tomatoes', 'plum tomato', 'plum tomatoes', 'cherry tomatoes', 'grape tomatoes'], query: 'tomatoes red ripe raw year round average', cls: 'vegetable', expect: ['tomato', 'red', 'raw'], avoid: ['paste', 'sauce', 'sun-dried', 'dried', 'canned', 'green', 'orange', 'yellow', 'juice', 'soup'], guard: /\b(paste|sauce|sun[- ]?dried|dried|powder|soup|juice|ketchup|canned|crushed|stewed|puree)\b/i },
  { key: 'ketchup', aliases: ['ketchup', 'catsup', 'tomato ketchup'], query: 'catsup', cls: 'condiment', expect: ['catsup'], avoid: ['low sodium', 'reduced'] },

  // ── Sauces / condiments (bad-match-prone) ──
  { key: 'soy sauce', aliases: ['soy sauce', 'shoyu', 'tamari', 'light soy sauce'], query: 'soy sauce made from soy and wheat shoyu', cls: 'condiment', expect: ['soy', 'sauce'], avoid: ['sweet', 'teriyaki'] },
  { key: 'worcestershire sauce', aliases: ['worcestershire sauce', 'worcestershire'], query: 'worcestershire sauce', cls: 'condiment', expect: ['worcestershire'], avoid: [] },
  { key: 'dijon mustard', aliases: ['dijon mustard', 'mustard', 'yellow mustard', 'whole grain mustard'], query: 'mustard prepared yellow', cls: 'condiment', expect: ['mustard', 'prepared'], avoid: ['oil', 'seed', 'powder', 'greens', 'honey', 'dressing'], guard: /\b(seed|powder|green|honey|dry)\b/i },
  { key: 'mayonnaise', aliases: ['mayonnaise', 'mayo'], query: 'salad dressing mayonnaise regular', cls: 'unknown', expect: ['mayonnaise'], avoid: ['tofu', 'light', 'low', 'reduced', 'imitation', 'fat free', 'cholesterol'] },
  { key: 'balsamic vinegar', aliases: ['balsamic vinegar', 'balsamic'], query: 'vinegar balsamic', cls: 'condiment', expect: ['balsamic'], avoid: ['glaze', 'dressing'] },
  { key: 'red wine vinegar', aliases: ['red wine vinegar'], query: 'vinegar red wine', cls: 'condiment', expect: ['vinegar', 'wine'], avoid: [] },
  { key: 'apple cider vinegar', aliases: ['apple cider vinegar', 'cider vinegar'], query: 'vinegar cider', cls: 'condiment', expect: ['vinegar', 'cider'], avoid: [] },
  { key: 'white vinegar', aliases: ['white vinegar', 'distilled vinegar', 'distilled white vinegar'], query: 'vinegar distilled', cls: 'condiment', expect: ['vinegar', 'distilled'], avoid: [] },
  { key: 'rice vinegar', aliases: ['rice vinegar', 'rice wine vinegar'], query: 'vinegar rice', cls: 'condiment', expect: ['vinegar', 'rice'], avoid: ['seasoned', 'balsamic', 'cider'] },
  { key: 'vanilla extract', aliases: ['vanilla extract', 'vanilla'], query: 'vanilla extract', cls: 'condiment', expect: ['vanilla'], avoid: ['imitation', 'pudding', 'sugar', 'soy', 'almond'] },
  { key: 'peanut butter', aliases: ['peanut butter'], query: 'peanut butter smooth style without salt', cls: 'nuts', expect: ['peanut', 'butter'], avoid: ['reduced', 'chocolate', 'low', 'chunk'] },

  // ── Canned beans / legumes (plain, not baked/seasoned) ──
  { key: 'black beans', aliases: ['black beans', 'canned black beans'], query: 'beans black mature seeds canned', cls: 'legume', expect: ['black', 'bean', 'canned'], avoid: ['soup', 'refried', 'sauce', 'soy', 'raw', 'sprouted'] },
  { key: 'kidney beans', aliases: ['kidney beans', 'red kidney beans', 'canned kidney beans'], query: 'beans kidney red mature seeds canned', cls: 'legume', expect: ['kidney', 'bean', 'canned'], avoid: ['soup', 'sauce', 'raw', 'sprouted'] },
  { key: 'chickpeas', aliases: ['chickpeas', 'garbanzo beans', 'canned chickpeas', 'garbanzos'], query: 'chickpeas garbanzo beans bengal gram canned', cls: 'legume', expect: ['chickpea', 'canned'], avoid: ['flour', 'soup', 'hummus', 'raw', 'sprouted'] },
  { key: 'cannellini beans', aliases: ['cannellini beans', 'white beans', 'great northern beans', 'navy beans'], query: 'beans white mature seeds canned', cls: 'legume', expect: ['bean', 'white', 'canned'], avoid: ['soup', 'sauce', 'refried', 'raw', 'sprouted'] },
  { key: 'pinto beans', aliases: ['pinto beans', 'canned pinto beans'], query: 'beans pinto mature seeds canned', cls: 'legume', expect: ['pinto', 'canned'], avoid: ['refried', 'soup', 'sauce', 'raw', 'sprouted'] },
  { key: 'lentils', aliases: ['lentils', 'dried lentils', 'red lentils', 'green lentils', 'brown lentils'], query: 'lentils raw', cls: 'legume', expect: ['lentil', 'raw'], avoid: ['soup', 'sprouted', 'boiled'] },
  { key: 'butter beans', aliases: ['butter beans', 'lima beans'], query: 'beans lima large mature seeds canned', cls: 'legume', expect: ['lima', 'canned'], avoid: ['soup', 'baby food', 'raw', 'sprouted'] },

  // ── Coconut milk / broths ──
  { key: 'coconut milk', aliases: ['coconut milk', 'canned coconut milk', 'full fat coconut milk'], query: 'nuts coconut milk canned', cls: 'dairy', expect: ['coconut', 'milk'], avoid: ['sweetened', 'beverage'] },
  { key: 'chicken broth', aliases: ['chicken broth', 'chicken stock', 'low sodium chicken broth'], query: 'soup chicken broth canned ready to serve', cls: 'broth', expect: ['chicken', 'broth'], avoid: ['noodle', 'rice', 'cream', 'vegetable', 'powder', 'dry', 'cube'] },
  { key: 'beef broth', aliases: ['beef broth', 'beef stock'], query: 'soup beef broth canned ready to serve', cls: 'broth', expect: ['beef', 'broth'], avoid: ['noodle', 'barley', 'vegetable', 'powder', 'dry', 'dehydrated', 'cube', 'mix'] },
  { key: 'vegetable broth', aliases: ['vegetable broth', 'vegetable stock'], query: 'soup vegetable broth', cls: 'broth', expect: ['vegetable'], avoid: ['beef', 'chicken', 'cream'] },

  // ── Dairy + eggs ──
  { key: 'whole milk', aliases: ['milk', 'whole milk'], query: 'milk whole 3.25% milkfat with added vitamin d', cls: 'dairy', expect: ['milk', 'whole'], avoid: ['chocolate', 'dry', 'evaporated', 'condensed', 'buttermilk', 'goat'], guard: /\b(coconut|almond|oat|soy|rice|cashew|condensed|evaporated|powder|dry|buttermilk|goat|chocolate)\b/i },
  { key: 'heavy cream', aliases: ['heavy cream', 'heavy whipping cream', 'whipping cream', 'double cream'], query: 'cream fluid heavy whipping', cls: 'dairy', expect: ['cream', 'whipping'], avoid: ['sour', 'half', 'light', 'whipped topping'] },
  // "half and half" entry REMOVED — both its aliases tokenize to a single {half}
  // ("and" is a stripped descriptor), so it matched any "…in half"/"half-moons" prep
  // fragment → cream (4 spurious hits in the catalog). It cannot be made specific via
  // aliases; "half and half" now falls through to the fuzzy matcher (which handled it).
  { key: 'sour cream', aliases: ['sour cream'], query: 'cream sour cultured', cls: 'dairy', expect: ['sour', 'cream'], avoid: ['reduced', 'fat free', 'imitation', 'light'] },
  { key: 'cream cheese', aliases: ['cream cheese'], query: 'cheese cream', cls: 'dairy', expect: ['cheese', 'cream'], avoid: ['fat free', 'low fat', 'whipped'] },
  { key: 'buttermilk', aliases: ['buttermilk'], query: 'milk buttermilk fluid cultured lowfat', cls: 'dairy', expect: ['buttermilk', 'fluid'], avoid: ['dry', 'powder', 'dried'] },
  { key: 'plain yogurt', aliases: ['plain yogurt', 'yogurt', 'whole milk yogurt'], query: 'yogurt plain whole milk', cls: 'dairy', expect: ['yogurt', 'plain', 'whole'], avoid: ['greek', 'vanilla', 'fruit', 'low fat', 'nonfat', 'skim', 'soy', 'silk', 'almond', 'coconut'], guard: /\b(greek|vanilla|strawberry|frozen|fruit)\b/i },
  { key: 'greek yogurt', aliases: ['greek yogurt', 'plain greek yogurt'], query: 'yogurt greek plain nonfat', cls: 'dairy', expect: ['yogurt', 'greek'], avoid: ['vanilla', 'fruit', 'strawberry'] },
  { key: 'egg', aliases: ['egg', 'eggs', 'large egg', 'large eggs'], query: 'egg whole raw fresh', cls: 'meat', expect: ['egg', 'whole', 'raw'], avoid: ['white', 'yolk', 'substitute', 'dried', 'cooked'], guard: /\b(whites?|yolks?|substitute|powder|dried)\b/i },

  // ── Cheeses ──
  { key: 'parmesan', aliases: ['parmesan', 'parmesan cheese', 'parmigiano reggiano', 'grated parmesan'], query: 'cheese parmesan hard', cls: 'cheese', expect: ['parmesan'], avoid: ['low', 'topping', 'imitation'] },
  { key: 'cheddar cheese', aliases: ['cheddar', 'cheddar cheese', 'sharp cheddar'], query: 'cheese cheddar', cls: 'cheese', expect: ['cheddar'], avoid: ['low', 'fat free', 'imitation'] },
  { key: 'mozzarella', aliases: ['mozzarella', 'mozzarella cheese', 'shredded mozzarella'], query: 'cheese mozzarella whole milk', cls: 'cheese', expect: ['cheese', 'mozzarella'], avoid: ['substitute', 'nonfat', 'non-fat', 'skim', 'low', 'imitation', 'string'] },
  { key: 'feta cheese', aliases: ['feta', 'feta cheese'], query: 'cheese feta', cls: 'cheese', expect: ['feta'], avoid: ['fat free'] },

  // ── Proteins (raw base forms) ──
  { key: 'chicken breast', aliases: ['chicken breast', 'chicken breasts', 'boneless skinless chicken breast'], query: 'chicken broilers or fryers breast meat only raw', cls: 'meat', expect: ['chicken', 'breast', 'raw'], avoid: ['cooked', 'fried', 'canned', 'and skin', 'lunchmeat'] },
  { key: 'chicken thigh', aliases: ['chicken thigh', 'chicken thighs', 'boneless skinless chicken thighs'], query: 'chicken broilers or fryers thigh meat only raw', cls: 'meat', expect: ['chicken', 'thigh', 'raw'], avoid: ['cooked', 'fried', 'skin'] },
  // ground-meat: aliases must contain BOTH "ground"+protein. "minced beef/pork/turkey"
  // dropped — "minced" is a stripped DESCRIPTOR_WORD, so those collapse to a bare
  // {beef}/{pork}/{turkey} catch-all that hijacks whole cuts (brisket, chuck, sirloin,
  // pork shoulder, lard…). "minced beef" etc. now fall through to the fuzzy matcher.
  { key: 'ground beef', aliases: ['ground beef', 'lean ground beef', 'ground chuck'], query: 'beef ground 80% lean meat 20% fat raw', cls: 'meat', expect: ['beef', 'ground', '80%', 'raw'], avoid: ['cooked', 'patty', 'crumbles'] },
  { key: 'ground turkey', aliases: ['ground turkey', 'lean ground turkey'], query: 'turkey ground raw', cls: 'meat', expect: ['turkey', 'ground', 'raw'], avoid: ['cooked', 'patty'] },
  { key: 'ground pork', aliases: ['ground pork'], query: 'pork ground raw', cls: 'meat', expect: ['pork', 'ground', 'raw'], avoid: ['cooked'] },
  { key: 'pork tenderloin', aliases: ['pork tenderloin', 'pork loin', 'pork chop', 'pork chops'], query: 'pork fresh loin tenderloin separable lean only raw', cls: 'meat', expect: ['pork', 'raw'], avoid: ['cooked', 'cured', 'ground'] },
  { key: 'bacon', aliases: ['bacon', 'bacon strips', 'sliced bacon'], query: 'pork cured bacon raw', cls: 'bacon', expect: ['bacon'], avoid: ['cooked', 'canadian', 'turkey', 'pre-cooked'] },
  { key: 'salmon', aliases: ['salmon', 'salmon fillet', 'salmon fillets'], query: 'fish salmon atlantic farmed raw', cls: 'meat', expect: ['salmon', 'atlantic', 'raw'], avoid: ['cooked', 'smoked', 'canned'] },
  { key: 'shrimp', aliases: ['shrimp', 'prawns'], query: 'crustaceans shrimp raw', cls: 'meat', expect: ['shrimp', 'raw'], avoid: ['cooked', 'breaded', 'canned', 'imitation'] },
  { key: 'italian sausage', aliases: ['italian sausage', 'pork sausage', 'sausage'], query: 'sausage italian pork raw', cls: 'meat', expect: ['sausage', 'raw'], avoid: ['cooked', 'turkey', 'smoked', 'egg'], guard: /\b(turkey|chicken|breakfast|smoked|andouille|chorizo)\b/i },

  // ── Grains / pasta / rice ──
  { key: 'white rice', aliases: ['white rice', 'rice', 'long grain rice', 'jasmine rice', 'basmati rice'], query: 'rice white long-grain regular raw enriched', cls: 'grain', expect: ['rice', 'white', 'raw'], avoid: ['cooked', 'brown', 'wild', 'fried', 'flour', 'medium-grain', 'short-grain', 'instant', 'parboiled', 'glutinous'], guard: /\b(brown|wild|vinegar|flour|paper|noodles?|milk|wine|cakes?|pudding|cooked|fried|krispies)\b/i },
  { key: 'brown rice', aliases: ['brown rice'], query: 'rice brown long-grain raw', cls: 'grain', expect: ['rice', 'brown', 'raw'], avoid: ['cooked', 'flour'] },
  // pasta guard: 'wheat' (surviving token) vetoes whole-wheat pasta; 'gluten' vetoes
  // gluten-free. 'fresh'/'whole-wheat'/'chickpea'/'lentil'/'rice' removed: 'fresh' is a
  // stripped descriptor (can't be vetoed post-parse — known limit), and chickpea/lentil/
  // rice pastas now resolve to a SAFE no-match via the tie rule (pasta vs the legume/rice
  // entry both score 1 → fall through), rather than a wrong forced match.
  { key: 'pasta', aliases: ['pasta', 'spaghetti', 'penne', 'macaroni', 'pappardelle', 'fettuccine', 'rigatoni', 'linguine', 'dry pasta'], query: 'pasta dry enriched', cls: 'grain', expect: ['pasta', 'dry'], avoid: ['cooked', 'whole-wheat', 'fresh', 'gluten', 'spinach', 'corn'], guard: /\b(cooked|wheat|gluten|sauce)\b/i },
  // bare "noodles" alias dropped — it over-caught rice/soba/udon/ramen noodles → egg
  // noodles. Now only "egg noodles" matches; other noodles fall through to the matcher.
  { key: 'egg noodles', aliases: ['egg noodles'], query: 'noodles egg dry enriched', cls: 'grain', expect: ['noodle', 'egg'], avoid: ['cooked', 'rice', 'soba', 'spinach', 'chow'] },
  { key: 'rolled oats', aliases: ['rolled oats', 'oats', 'old fashioned oats', 'quick oats'], query: 'oats', cls: 'grain', expect: ['oats'], avoid: ['cookie', 'bread', 'cooked', 'instant flavored'], guard: /\b(milk|flour|bran|drink|cake|cookie|granola)\b/i },
  { key: 'quinoa', aliases: ['quinoa'], query: 'quinoa uncooked', cls: 'grain', expect: ['quinoa', 'uncooked'], avoid: ['flour'] },
  { key: 'panko breadcrumbs', aliases: ['panko', 'panko breadcrumbs', 'breadcrumbs', 'bread crumbs'], query: 'bread crumbs dry grated plain', cls: 'grain', expect: ['bread', 'crumb'], avoid: ['seasoned'] },

  // ── Produce (raw) ──
  { key: 'yellow onion', aliases: ['onion', 'onions', 'yellow onion', 'white onion', 'diced onion'], query: 'onions raw', cls: 'vegetable', expect: ['onion', 'raw'], avoid: ['green', 'powder', 'dried', 'rings', 'spring', 'red', 'soup', 'cooked'], guard: /\b(green|spring|red|powder|dried|rings?|soup|pearl|pickled)\b/i },
  { key: 'red onion', aliases: ['red onion', 'red onions'], query: 'onions red raw', cls: 'vegetable', expect: ['onion'], avoid: ['powder', 'rings'] },
  { key: 'green onion', aliases: ['green onion', 'green onions', 'scallions', 'scallion', 'spring onions'], query: 'onions spring or scallions includes tops and bulb raw', cls: 'vegetable', expect: ['spring', 'scallion'], avoid: ['powder'] },
  { key: 'shallot', aliases: ['shallot', 'shallots'], query: 'shallots raw', cls: 'vegetable', expect: ['shallot'], avoid: ['freeze-dried'] },
  { key: 'garlic', aliases: ['garlic', 'garlic cloves', 'garlic clove', 'minced garlic'], query: 'garlic raw', cls: 'vegetable', expect: ['garlic', 'raw'], avoid: ['powder', 'salt', 'bread', 'oil'], guard: /\b(powder|salt|bread|granulated|oil|chili)\b/i },
  { key: 'carrot', aliases: ['carrot', 'carrots', 'diced carrots', 'shredded carrots', 'baby carrots'], query: 'carrots raw', cls: 'vegetable', expect: ['carrot', 'raw'], avoid: ['juice', 'cake', 'cooked', 'canned'] },
  { key: 'celery', aliases: ['celery', 'celery stalks', 'celery ribs'], query: 'celery raw', cls: 'vegetable', expect: ['celery', 'raw'], avoid: ['seed', 'salt', 'soup'] },
  { key: 'bell pepper', aliases: ['bell pepper', 'bell peppers', 'red bell pepper', 'green bell pepper', 'red pepper', 'green pepper'], query: 'peppers sweet red raw', cls: 'vegetable', expect: ['pepper', 'sweet', 'raw'], avoid: ['hot', 'chili', 'black', 'flakes', 'sauce', 'cooked'], guard: /\b(black|white|cayenne|chili|chile|red pepper flakes|crushed red|flakes|hot|jalapen|serrano|sauce)\b/i },
  { key: 'jalapeno', aliases: ['jalapeno', 'jalapenos', 'jalapeno pepper'], query: 'peppers jalapeno raw', cls: 'vegetable', expect: ['jalapeno'], avoid: ['pickled', 'canned'] },
  { key: 'potato', aliases: ['potato', 'potatoes', 'russet potato', 'yukon gold potato', 'red potato'], query: 'potatoes flesh and skin raw', cls: 'vegetable', expect: ['potato', 'flesh'], avoid: ['sweet', 'chips', 'fries', 'mashed', 'canned', 'cooked'], guard: /\b(sweet|chips?|fries|fried|mashed|flakes|starch|salad)\b/i },
  { key: 'sweet potato', aliases: ['sweet potato', 'sweet potatoes', 'yam', 'yams'], query: 'sweet potato raw unprepared', cls: 'vegetable', expect: ['sweet', 'potato', 'raw'], avoid: ['leaves', 'leaf', 'fries', 'canned', 'cooked', 'candied', 'chips'] },
  { key: 'spinach', aliases: ['spinach', 'baby spinach', 'fresh spinach'], query: 'spinach raw', cls: 'leafy', expect: ['spinach', 'raw'], avoid: ['cooked', 'canned', 'creamed', 'frozen'] },
  { key: 'kale', aliases: ['kale'], query: 'kale raw', cls: 'leafy', expect: ['kale', 'raw'], avoid: ['cooked', 'chips'] },
  { key: 'romaine lettuce', aliases: ['romaine lettuce', 'romaine', 'lettuce'], query: 'lettuce cos or romaine raw', cls: 'leafy', expect: ['lettuce', 'raw'], avoid: ['iceberg', 'wrap'] },
  { key: 'cabbage', aliases: ['cabbage', 'green cabbage', 'shredded cabbage'], query: 'cabbage raw', cls: 'leafy', expect: ['cabbage', 'raw'], avoid: ['red', 'napa', 'chinese', 'cooked', 'slaw'] },
  { key: 'broccoli', aliases: ['broccoli', 'broccoli florets'], query: 'broccoli raw', cls: 'vegetable', expect: ['broccoli', 'raw'], avoid: ['cooked', 'frozen', 'rabe', 'chinese'] },
  { key: 'cauliflower', aliases: ['cauliflower', 'cauliflower florets'], query: 'cauliflower raw', cls: 'vegetable', expect: ['cauliflower', 'raw'], avoid: ['cooked', 'rice', 'frozen'] },
  { key: 'mushroom', aliases: ['mushroom', 'mushrooms', 'white mushrooms', 'button mushrooms', 'cremini mushrooms'], query: 'mushrooms white raw', cls: 'vegetable', expect: ['mushroom', 'raw'], avoid: ['cooked', 'canned', 'dried', 'shiitake', 'portabella'], guard: /\b(soup|cream|gravy|sauce|dried|powder)\b/i },
  { key: 'zucchini', aliases: ['zucchini', 'courgette', 'summer squash'], query: 'squash summer zucchini includes skin raw', cls: 'vegetable', expect: ['zucchini', 'raw'], avoid: ['cooked', 'bread'] },
  { key: 'cucumber', aliases: ['cucumber', 'cucumbers'], query: 'cucumber with peel raw', cls: 'vegetable', expect: ['cucumber', 'raw'], avoid: ['pickle'] },
  { key: 'corn', aliases: ['corn', 'corn kernels', 'sweet corn', 'frozen corn'], query: 'corn sweet yellow raw', cls: 'vegetable', expect: ['corn', 'raw'], avoid: ['canned', 'cream', 'meal', 'flour', 'chip', 'syrup', 'starch', 'bread', 'popcorn'], guard: /\b(meal|flour|starch|syrup|chips?|bread|tortillas?|popcorn|grits|nuts?)\b/i },
  { key: 'green beans', aliases: ['green beans', 'string beans'], query: 'beans snap green raw', cls: 'vegetable', expect: ['bean', 'snap'], avoid: ['canned', 'cooked', 'casserole'] },
  { key: 'ginger', aliases: ['ginger', 'fresh ginger', 'ginger root'], query: 'ginger root raw', cls: 'vegetable', expect: ['ginger', 'raw'], avoid: ['ground', 'ale', 'pickled', 'candied', 'powder'], guard: /\b(ground|powder|ale|candied|crystallized|pickled|dried)\b/i },

  // ── Fruit ──
  { key: 'lemon', aliases: ['lemon', 'lemons'], query: 'lemons raw without peel', cls: 'fruit', expect: ['lemon', 'raw', 'without'], avoid: ['juice', 'zest', 'pepper', 'lime'], guard: /\b(juice|zest|peel|extract|pepper|curd)\b/i },
  { key: 'lime', aliases: ['lime', 'limes'], query: 'limes raw', cls: 'fruit', expect: ['lime', 'raw'], avoid: ['juice', 'leaves', 'zest'], guard: /\b(juice|zest|peel|leaves|leaf)\b/i },
  { key: 'lemon juice', aliases: ['lemon juice'], query: 'lemon juice raw', cls: 'fruit', expect: ['lemon', 'juice'], avoid: ['concentrate', 'pink'] },
  { key: 'lime juice', aliases: ['lime juice'], query: 'lime juice raw', cls: 'fruit', expect: ['lime', 'juice'], avoid: ['concentrate'] },
  { key: 'avocado', aliases: ['avocado', 'avocados'], query: 'avocados raw all commercial varieties', cls: 'fruit', expect: ['avocado', 'raw'], avoid: ['oil', 'dip', 'guacamole'] },
  { key: 'apple', aliases: ['apple', 'apples'], query: 'apples raw with skin', cls: 'fruit', expect: ['apple', 'raw'], avoid: ['juice', 'sauce', 'dried', 'pie', 'cider'], guard: /\b(juice|sauce|dried|pie|cider|butter|vinegar)\b/i },
  { key: 'banana', aliases: ['banana', 'bananas'], query: 'bananas raw', cls: 'fruit', expect: ['banana', 'raw'], avoid: ['pepper', 'dried', 'chips', 'bread', 'baby'], guard: /\b(pepper|chili|bread|squash)\b/i },
  { key: 'orange', aliases: ['orange', 'oranges'], query: 'oranges raw all commercial varieties', cls: 'fruit', expect: ['orange', 'raw'], avoid: ['juice', 'peel', 'mandarin', 'zest'], guard: /\b(juice|peel|zest|extract)\b/i },

  // ── Spices / dried herbs (small grams, but deterministic + avoids weird matches) ──
  { key: 'garlic powder', aliases: ['garlic powder'], query: 'spices garlic powder', cls: 'spice', expect: ['garlic', 'powder'], avoid: ['salt', 'bread'] },
  { key: 'onion powder', aliases: ['onion powder'], query: 'spices onion powder', cls: 'spice', expect: ['onion', 'powder'], avoid: ['salt', 'soup'] },
  { key: 'chili powder', aliases: ['chili powder', 'chile powder'], query: 'spices chili powder', cls: 'spice', expect: ['chili', 'powder'], avoid: ['con carne'] },
  { key: 'ground cumin', aliases: ['cumin', 'ground cumin'], query: 'spices cumin seed', cls: 'spice', expect: ['cumin'], avoid: [] },
  { key: 'paprika', aliases: ['paprika', 'smoked paprika', 'sweet paprika'], query: 'spices paprika', cls: 'spice', expect: ['paprika'], avoid: [] },
  { key: 'dried oregano', aliases: ['oregano', 'dried oregano'], query: 'spices oregano dried', cls: 'spice', expect: ['oregano'], avoid: ['fresh'] },
  { key: 'dried basil', aliases: ['dried basil'], query: 'spices basil dried', cls: 'spice', expect: ['basil'], avoid: ['fresh'] },
  { key: 'dried thyme', aliases: ['dried thyme', 'thyme'], query: 'spices thyme dried', cls: 'spice', expect: ['thyme'], avoid: ['fresh'] },
  { key: 'ground cinnamon', aliases: ['cinnamon', 'ground cinnamon'], query: 'spices cinnamon ground', cls: 'spice', expect: ['cinnamon'], avoid: ['sugar', 'stick'] },
  { key: 'ground ginger', aliases: ['ground ginger'], query: 'spices ginger ground', cls: 'spice', expect: ['ginger', 'ground'], avoid: [] },
  { key: 'ground turmeric', aliases: ['turmeric', 'ground turmeric'], query: 'spices turmeric ground', cls: 'spice', expect: ['turmeric'], avoid: ['root', 'raw'] },
  { key: 'cayenne pepper', aliases: ['cayenne', 'cayenne pepper', 'ground cayenne'], query: 'spices pepper red or cayenne', cls: 'spice', expect: ['cayenne'], avoid: [] },
  { key: 'red pepper flakes', aliases: ['red pepper flakes', 'crushed red pepper'], query: 'spices pepper red or cayenne', cls: 'spice', expect: ['cayenne'], avoid: [] },
  { key: 'curry powder', aliases: ['curry powder'], query: 'spices curry powder', cls: 'spice', expect: ['curry'], avoid: ['paste', 'sauce'] },
  { key: 'ground coriander', aliases: ['coriander', 'ground coriander'], query: 'spices coriander seed', cls: 'spice', expect: ['coriander'], avoid: ['leaf', 'cilantro'] },
  { key: 'cilantro', aliases: ['cilantro', 'fresh cilantro', 'coriander leaves'], query: 'coriander cilantro leaves raw', cls: 'leafy', expect: ['coriander', 'raw'], avoid: ['seed', 'dried', 'ground'] },
  { key: 'parsley', aliases: ['parsley', 'fresh parsley', 'flat leaf parsley'], query: 'parsley fresh raw', cls: 'leafy', expect: ['parsley'], avoid: ['dried', 'spice', 'root'] },
  // "fresh basil" alias dropped — collapses to {basil} ("fresh" stripped), which ties with
  // dried basil. Only the multi-token "basil leaves" remains; plain "basil"/"fresh basil"
  // falls through to the fuzzy matcher (same as before, where the two basil entries tied).
  { key: 'fresh basil', aliases: ['basil leaves'], query: 'basil fresh raw', cls: 'leafy', expect: ['basil'], avoid: ['dried', 'spice', 'seed', 'sauce', 'pesto'] },
]

// ── USDA fetch helpers ───────────────────────────────────────────────────────
const DATATYPE_WEIGHT = { 'SR Legacy': 3, Foundation: 2.5, 'Survey (FNDDS)': 2, Branded: 0 }
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function usdaSearch(query) {
  const params = new URLSearchParams({ api_key: USDA_API_KEY, query, pageSize: '25', dataType: 'SR Legacy,Foundation' })
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${USDA_SEARCH}?${params}`, { signal: AbortSignal.timeout(15000) })
      if (res.ok) { const d = await res.json(); return Array.isArray(d.foods) ? d.foods : [] }
    } catch { /* retry */ }
    await sleep(400)
  }
  return []
}

async function usdaDetail(fdcId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${USDA_DETAIL}/${fdcId}?api_key=${USDA_API_KEY}`, { signal: AbortSignal.timeout(15000) })
      if (res.ok) return await res.json()
    } catch { /* retry */ }
    await sleep(400)
  }
  return null
}

function macrosFromDetail(food) {
  const byNum = {}
  for (const n of food.foodNutrients || []) {
    const num = String(n.nutrient?.number ?? n.nutrientNumber ?? '')
    const amt = typeof n.amount === 'number' ? n.amount : (typeof n.value === 'number' ? n.value : null)
    if (num && amt != null && byNum[num] === undefined) byNum[num] = amt
  }
  const pick = (...nums) => { for (const x of nums) if (byNum[x] != null) return byNum[x]; return 0 }
  return {
    calories: Math.round(pick('208', '957', '958')),
    protein_g: r1(pick('203')),
    carbs_g: r1(pick('205')),
    fat_g: r1(pick('204')),
    fiber_g: r1(pick('291')),
    sugar_g: r1(pick('269', '2000')),
  }
}
function r1(n) { return Math.round(n * 10) / 10 }

function tok(s) {
  return s.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/[\s-]+/).filter(Boolean)
}

// ── Generator lint (Batch 4-fix) ──────────────────────────────────────────────
// Catches the degenerate-alias / defanged-guard CLASS the re-audit found. Uses the
// engine's EXACT keyTokens/stem/DESCRIPTOR_WORDS (kept verbatim in sync with
// lib/nutritionEngine.ts) so it sees aliases/guards the way the matcher will.
const DESCRIPTOR_WORDS = new Set([
  'fresh', 'freshly', 'finely', 'coarsely', 'roughly', 'thinly', 'chopped', 'diced', 'sliced',
  'minced', 'grated', 'shredded', 'peeled', 'seeded', 'trimmed', 'halved', 'quartered', 'cut',
  'into', 'pieces', 'piece', 'inch', 'large', 'medium', 'small', 'extra', 'jumbo', 'ripe',
  'boneless', 'skinless', 'skin-on', 'bone-in', 'lean', 'reduced', 'sodium', 'low', 'unsalted',
  'salted', 'softened', 'melted', 'divided', 'plus', 'more', 'about', 'such', 'as', 'like',
  'preferably', 'optional', 'taste', 'needed', 'serving', 'serve', 'garnish', 'whole', 'a', 'an',
  'the', 'of', 'or', 'and', 'with', 'without', 'your', 'favorite', 'good', 'quality', 'store-bought',
  'homemade', 'packed', 'loosely', 'loose', 'heaping', 'level', 'roomtemperature', 'room', 'temperature',
])
function stem(t) {
  if (t.length <= 3) return t
  if (t.endsWith('ies')) return t.slice(0, -3) + 'y'
  if (t.endsWith('es') && !t.endsWith('ses')) return t.slice(0, -2)
  if (t.endsWith('s')) return t.slice(0, -1)
  return t
}
function keyTokens(name) {
  return name.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/[\s-]+/)
    .filter(t => t.length > 1 && !DESCRIPTOR_WORDS.has(t)).map(stem)
}

/**
 * Lint the generated entries. FAILS on the dangerous class:
 *  (a) a multi-word alias that collapses to ≤1 UNIQUE token whose token is NOT also an
 *      intentional atomic (single-word) alias of the same entry → a bare catch-all
 *      introduced only because a distinguishing word was a stripped DESCRIPTOR_WORD,
 *  (a') an alias that tokenizes to nothing (dead),
 *  (b) a guard alternative that is itself a DESCRIPTOR_WORD (stripped → defanged).
 * Harmless cases (redundant degenerate aliases that collapse to an existing atomic
 * alias, and plain atomic single-noun aliases) are reported as INFO, not failures.
 */
function lintEntries(entries) {
  const fails = []
  let atomic = 0, redundant = 0
  for (const e of entries) {
    const atomicTokens = new Set()
    for (const a of e.aliases) {
      if (a.split(/[\s-]+/).filter(Boolean).length === 1) {
        const tk = keyTokens(a)
        if (tk.length === 1) atomicTokens.add(tk[0])
      }
    }
    for (const a of e.aliases) {
      const srcWords = a.split(/[\s-]+/).filter(Boolean).length
      const uniq = [...new Set(keyTokens(a))]
      if (uniq.length === 0) { fails.push(`${e.key}: alias "${a}" tokenizes to NOTHING (dead alias)`); continue }
      if (srcWords >= 2 && uniq.length <= 1) {
        if (atomicTokens.has(uniq[0])) redundant++          // harmless (same as an intentional atomic alias)
        else fails.push(`${e.key}: alias "${a}" collapses to a bare {${uniq[0]}} catch-all (a distinguishing word is a stripped DESCRIPTOR_WORD)`)
      } else if (srcWords === 1 && uniq.length === 1) atomic++
    }
    if (e.guard) {
      const terms = (e.guard.source.replace(/\\[a-z]/gi, ' ').match(/[a-z]+/gi) || []).map(t => t.toLowerCase())
      for (const t of terms) if (DESCRIPTOR_WORDS.has(t)) {
        fails.push(`${e.key}: guard term "${t}" is a DESCRIPTOR_WORD (stripped before the guard runs → defanged)`)
      }
    }
  }
  return { fails, atomic, redundant }
}

/** Pick the best candidate for a seed (or null). */
function pickCandidate(seed, foods) {
  const keyToks = tok(seed.key)
  let best = null
  for (const f of foods) {
    const desc = String(f.description || '').toLowerCase()
    if (!desc) continue
    // hard filters
    if (seed.expect.some(w => !desc.includes(w))) continue
    if ((seed.avoid || []).some(w => desc.includes(w))) continue
    const dToks = tok(desc)
    const overlap = keyToks.filter(t => dToks.includes(t)).length
    let score = overlap * 10 + (DATATYPE_WEIGHT[f.dataType] ?? 0)
    score -= desc.length / 100
    if (!best || score > best.score) best = { score, food: f, desc }
  }
  return best ? best.food : null
}

// ── Main ─────────────────────────────────────────────────────────────────────
;(async () => {
  const verified = []
  const failed = []
  console.log(`Verifying ${SEEDS.length} canonical-staple seeds against the live USDA API…\n`)

  for (const seed of SEEDS) {
    const foods = await usdaSearch(seed.query)
    await sleep(120)
    const cand = pickCandidate(seed, foods)
    if (!cand) {
      failed.push({ key: seed.key, reason: `no SR Legacy/Foundation candidate matched expect=[${seed.expect}] avoid=[${seed.avoid || []}]` })
      console.log(`  ✗ ${seed.key} — no candidate`)
      continue
    }
    const detail = await usdaDetail(cand.fdcId)
    await sleep(120)
    if (!detail) { failed.push({ key: seed.key, reason: `detail fetch failed for fdcId ${cand.fdcId}` }); console.log(`  ✗ ${seed.key} — detail fetch failed (${cand.fdcId})`); continue }

    const per100g = macrosFromDetail(detail)
    const [lo, hi] = KCAL_BANDS[seed.cls]
    const bandOK = per100g.calories >= lo && per100g.calories <= hi
    const desc = detail.description || cand.description
    const dataType = detail.dataType || cand.dataType

    if (!Number.isFinite(per100g.calories) || per100g.calories <= 0) {
      failed.push({ key: seed.key, reason: `no usable calories from fdcId ${cand.fdcId} (${desc})` })
      console.log(`  ✗ ${seed.key} — no calories (${cand.fdcId})`)
      continue
    }
    if (!bandOK) {
      failed.push({ key: seed.key, reason: `kcal/100g ${per100g.calories} outside ${seed.cls} band [${lo},${hi}] — fdcId ${cand.fdcId} (${desc})` })
      console.log(`  ⚠ ${seed.key} — band fail ${per100g.calories} ∉ [${lo},${hi}] (${desc}) [${cand.fdcId}] — EXCLUDED`)
      continue
    }

    verified.push({ ...seed, fdcId: cand.fdcId, description: desc, dataType, per100g })
    console.log(`  ✓ ${seed.key.padEnd(22)} → ${desc}  [${dataType} ${cand.fdcId}] ${per100g.calories}kcal sugar=${per100g.sugar_g}`)
  }

  // ── Emit lib/canonicalStaples.ts ──
  const stamp = new Date().toISOString().slice(0, 10)
  const entryStr = e => {
    const parts = [
      `key: ${JSON.stringify(e.key)}`,
      `aliases: ${JSON.stringify(e.aliases)}`,
      `fdcId: ${e.fdcId}`,
      `description: ${JSON.stringify(e.description)}`,
      `dataType: ${JSON.stringify(e.dataType)}`,
      `cls: ${JSON.stringify(e.cls)}`,
      `per100g: { calories: ${e.per100g.calories}, protein_g: ${e.per100g.protein_g}, carbs_g: ${e.per100g.carbs_g}, fat_g: ${e.per100g.fat_g}, fiber_g: ${e.per100g.fiber_g}, sugar_g: ${e.per100g.sugar_g} }`,
    ]
    if (e.guard) parts.push(`guard: ${e.guard.toString()}`)
    return `  { ${parts.join(', ')} },`
  }

  const header = `// ─────────────────────────────────────────────────────────────────────────────
// AUTO-GENERATED by scripts/verify-canonical-staples.js — DO NOT EDIT BY HAND.
// Re-run that script to refresh (it re-fetches + re-verifies every entry live).
//
// Canonical staples table (Batch 4). Maps common cooking-staple ingredient names
// to the EXACT correct USDA FoodData Central entry, so the nutrition engine can
// resolve them DIRECTLY (skipping the fuzzy USDA search that mis-ranks sweet /
// jarred / branded look-alikes — the root cause of e.g. Easy Spaghetti's
// implausible sugar). Each entry's fdcId / description / dataType / per100g macros
// were fetched + verified against the live USDA API on ${stamp}:
//   • only SR Legacy / Foundation data types (plain, unsweetened base forms),
//   • per-100g calories confirmed within the food class's kcal sanity band.
//
// per100g is the durable per-100g macro basis used at resolution time (no network
// call needed once verified). The matcher + matching rules live in
// lib/nutritionEngine.ts (matchCanonicalStaple) — see its doc comment.
// ─────────────────────────────────────────────────────────────────────────────

import type { NutritionMacros } from '@/types/recipe'
import type { FoodClass } from './nutritionEngine'

export interface CanonicalStaple {
  /** Canonical display name. */
  key: string
  /** Phrases that should resolve to this entry (tokenised by keyTokens). */
  aliases: string[]
  /** Exact USDA FoodData Central ID (verified live). */
  fdcId: number
  /** FDC description, for human verification. */
  description: string
  /** USDA data type (prefer Foundation / SR Legacy over Branded). */
  dataType: string
  /** Food class — drives the kcal/100g sanity band (KCAL_BANDS). */
  cls: FoodClass
  /** Verified per-100g macros (used directly on a canonical hit). */
  per100g: NutritionMacros
  /** Optional negative guard: skip this entry when a qualified homograph with no
   *  dedicated entry is present (e.g. "butter beans" must not match dairy butter). */
  guard?: RegExp
}

export const CANONICAL_STAPLES: CanonicalStaple[] = [
`
  const body = verified.map(entryStr).join('\n')
  const footer = `\n]\n`
  const out = header + body + footer
  fs.writeFileSync(path.join(__dirname, '..', 'lib', 'canonicalStaples.ts'), out, 'utf8')

  // ── Emit verification log ──
  const log = {
    generatedAt: new Date().toISOString(),
    seeds: SEEDS.length,
    verified: verified.length,
    failed: failed.length,
    verifiedEntries: verified.map(e => ({ key: e.key, fdcId: e.fdcId, description: e.description, dataType: e.dataType, cls: e.cls, per100g: e.per100g })),
    failedEntries: failed,
  }
  fs.writeFileSync(path.join(__dirname, 'canonical-verify-log.json'), JSON.stringify(log, null, 2), 'utf8')

  console.log(`\n──────────────────────────────────────────`)
  console.log(`VERIFIED: ${verified.length}/${SEEDS.length}   FAILED/EXCLUDED: ${failed.length}`)
  if (failed.length) { console.log('\nFailed/excluded (fell through to existing matcher):'); for (const f of failed) console.log(`  • ${f.key}: ${f.reason}`) }
  console.log(`\nWrote lib/canonicalStaples.ts (${verified.length} entries) + scripts/canonical-verify-log.json`)

  // ── Lint the generated table (Batch 4-fix: prevent recurrence of the bug class) ──
  const lint = lintEntries(verified)
  console.log(`\n── LINT (degenerate-alias / defanged-guard class) ──`)
  console.log(`atomic single-noun aliases: ${lint.atomic} (intentional) · redundant degenerate aliases: ${lint.redundant} (harmless, collapse to an existing atomic alias)`)
  if (lint.fails.length) {
    console.log(`\nLINT FAILED (${lint.fails.length}):`)
    for (const f of lint.fails) console.log(`  ✗ ${f}`)
    console.log('\nNo Firestore access. No nutrition data written.')
    process.exit(2)   // non-zero so regeneration is gated on a clean lint
  }
  console.log('LINT PASS — no bare catch-all aliases, no descriptor-word guards.')
  console.log('No Firestore access. No nutrition data written.')
  process.exit(0)
})().catch(err => { console.error('VERIFY ERROR:', err && err.stack || err); process.exit(1) })
