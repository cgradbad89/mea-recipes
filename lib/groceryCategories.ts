// Grocery categories are owned by the MEA Recipes web application. The former
// iOS client is deprecated and is not a compatibility constraint.
export const GROCERY_CATEGORIES = [
  'Produce',
  'Meat & Seafood',
  'Dairy & Eggs',
  'Bakery & Bread',
  'Pantry & Dry Goods',
  'Canned & Jarred',
  'Sauces & Condiments',
  'Spices & Seasonings',
  'Nuts, Seeds & Nut Butters',
  'Beverages',
  'Other',
] as const

export type GroceryCategory = typeof GROCERY_CATEGORIES[number]

export const MANUAL_CATEGORIES: readonly GroceryCategory[] = GROCERY_CATEGORIES

export const LEGACY_GROCERY_CATEGORIES = [
  'Staples',
  'Canned / Jarred / Sauces',
] as const

export type LegacyGroceryCategory = typeof LEGACY_GROCERY_CATEGORIES[number]

export function isGroceryCategory(value: unknown): value is GroceryCategory {
  return typeof value === 'string' && GROCERY_CATEGORIES.includes(value as GroceryCategory)
}

// Keyword mapping rules. Matching is token/phrase-aware and the longest
// matching phrase wins across every category. Array order is only the
// deterministic tie-breaker for equally specific matches.
const RULES: { keywords: string[]; category: GroceryCategory }[] = [
  // Produce — fresh foods. Specific fresh pepper/herb phrases outrank dried
  // forms only when they contain more tokens; otherwise the ordered tie goes
  // to the fresh store section.
  {
    keywords: [
      'apple', 'pear', 'banana', 'orange', 'lemon', 'lime', 'grapefruit', 'mango', 'pineapple',
      'strawberry', 'blueberry', 'raspberry', 'blackberry', 'cherry', 'grape', 'watermelon',
      'peach', 'plum', 'avocado', 'tomato', 'cucumber', 'zucchini', 'squash', 'pumpkin',
      'carrot', 'celery', 'onion', 'shallot', 'scallion', 'green onion', 'leek', 'chive',
      'garlic', 'ginger', 'potato', 'sweet potato', 'yam', 'beet', 'radish', 'turnip',
      'broccoli', 'broccolini', 'cauliflower', 'cabbage', 'kale', 'spinach', 'arugula', 'lettuce',
      'chard', 'collard', 'bok choy', 'brussels sprout', 'asparagus', 'artichoke',
      'corn', 'pea', 'edamame', 'green bean', 'bean sprout', 'mung bean sprout',
      'beansprout', 'snap pea', 'snow pea', 'bell pepper',
      'red bell pepper', 'green bell pepper', 'yellow bell pepper', 'orange bell pepper',
      'red pepper', 'green pepper', 'sweet pepper', 'anaheim pepper', 'poblano pepper',
      'pasilla pepper', 'mulato pepper', 'pepperoncini pepper', 'pepperoncini',
      'red chilli', 'green chilli', 'thai chilli', 'sliced pepper',
      'jalapeño', 'jalapeno', 'habanero', 'serrano pepper', 'serrano', 'chili pepper',
      'fresh chile', 'fresh chili', 'fresh chilli',
      'mushroom', 'eggplant', 'fennel', 'parsnip', 'cilantro', 'parsley', 'basil',
      'mint', 'thyme', 'rosemary', 'dill', 'sage', 'oregano', 'tarragon', 'curry leaf',
      'lemongrass', 'herb', 'tomatillo', 'plantain', 'romaine', 'mixed green',
      'brussel sprout', 'tofu', 'water chestnut',
      'vegetable', 'fruit',
    ],
    category: 'Produce',
  },
  // Meat & Seafood
  {
    keywords: [
      'chicken', 'turkey', 'duck', 'beef', 'steak', 'ground beef', 'brisket', 'ribeye',
      'pork', 'bacon', 'ham', 'sausage', 'chorizo', 'pancetta', 'prosciutto', 'salami',
      'lamb', 'veal', 'venison', 'bison', 'meat', 'poultry',
      'salmon', 'tuna', 'shrimp', 'prawn', 'crab', 'lobster', 'scallop', 'clam',
      'mussel', 'oyster', 'squid', 'octopus', 'cod', 'halibut', 'tilapia', 'sardine',
      'anchovy', 'fish', 'seafood', 'shellfish',
    ],
    category: 'Meat & Seafood',
  },
  // Dairy & Eggs
  {
    keywords: [
      'milk', 'cream', 'half and half', 'half-and-half', 'buttermilk', 'heavy cream', 'sour cream',
      'butter', 'cheese', 'cheddar', 'mozzarella', 'parmesan', 'pecorino', 'feta',
      'brie', 'gouda', 'ricotta', 'cottage cheese', 'cream cheese', 'goat cheese',
      'cotija', 'paneer', 'queso fresco', 'yogurt', 'kefir', 'ice cream', 'whipped cream',
      'egg', 'eggs',
    ],
    category: 'Dairy & Eggs',
  },
  // Bakery & Bread
  {
    keywords: [
      'bread', 'sourdough', 'baguette', 'roll', 'bun', 'bagel', 'muffin', 'croissant',
      'pita', 'naan', 'tortilla', 'wrap', 'brioche', 'focaccia', 'ciabatta',
      'flatbread', 'roti', 'injera',
      'corn tortilla',
      'crouton', 'biscuit', 'tostada shell',
      'cake', 'cookie', 'brownie', 'pastry', 'pie crust',
    ],
    category: 'Bakery & Bread',
  },
  // Pantry & Dry Goods — grains, pasta, dry legumes, broths/stocks, baking
  // ingredients, and other shelf-stable dry goods.
  {
    keywords: [
      'rice', 'pasta', 'noodle', 'spaghetti', 'penne', 'fettuccine', 'farfalle', 'ditalini',
      'tagliatelle', 'rotini', 'rigatoni', 'orzo', 'couscous', 'quinoa', 'farro',
      'oat', 'oats', 'rolled oats', 'steel cut oats', 'oatmeal', 'cereal', 'granola',
      'ramen', 'udon', 'soba', 'rice vermicelli', 'rice cake',
      'cracker', 'breadcrumb', 'bread crumb', 'panko', 'cornmeal', 'masa', 'masa harina',
      'wonton wrapper', 'psyllium husk', 'protein powder',
      'chicken broth', 'chicken stock', 'chicken base', 'beef broth', 'beef stock',
      'beef base', 'vegetable broth', 'vegetable stock', 'veggie broth', 'veggie stock',
      'bone broth', 'chicken bouillon', 'beef bouillon', 'broth', 'stock', 'bouillon', 'gravy mix',
      'dry bean', 'dried bean', 'lentil', 'chickpea', 'garbanzo', 'bean', 'hominy',
      'flour', 'all-purpose flour', 'all purpose flour', 'bread flour', 'rice flour',
      'almond flour', 'cornstarch', 'baking soda', 'baking powder', 'yeast',
      'sugar', 'brown sugar', 'powdered sugar', 'granulated sugar', 'coconut sugar',
      'cocoa powder', 'vanilla extract', 'vanilla', 'chocolate chip',
      'honey', 'maple syrup', 'agave', 'molasses',
    ],
    category: 'Pantry & Dry Goods',
  },
  // Canned & Jarred — explicit packaged foods plus strong store-convention
  // identities. Ordinary bottled/jarred sauces stay in Sauces & Condiments.
  {
    keywords: [
      'canned bean', 'can bean', 'canned chickpea', 'can chickpea', 'canned garbanzo',
      'can garbanzo', 'canned lentil', 'can lentil', 'canned hominy', 'can hominy',
      'can black bean', 'can kidney bean', 'can white bean', 'can cannellini bean',
      'can pinto bean', 'can navy bean', 'can great northern bean', 'can chili bean',
      'can seasoned black bean',
      'canned tomato', 'can tomato', 'can diced tomato', 'can whole tomato',
      'can whole plum tomato', 'can whole peeled plum tomato', 'can diced fire roasted tomato',
      'can crushed fire roasted tomato', 'fire roasted tomato',
      'canned tuna', 'can tuna', 'canned sardine', 'can sardine',
      'canned anchovy', 'can anchovy', 'canned artichoke', 'can artichoke',
      'canned pumpkin', 'can pumpkin', 'canned corn', 'can corn', 'can whole kernel corn',
      'canned green chile', 'can green chile', 'can diced green chile',
      'canned chipotle', 'chipotle in adobo', 'chipotle pepper in adobo',
      'tomato paste', 'crushed tomato', 'diced tomato', 'whole peeled tomato',
      'coconut milk', 'coconut cream',
      'butter bean',
      'jarred roasted pepper', 'jar roasted pepper', 'jar roasted red pepper',
      'jarred artichoke', 'jarred tomato',
      'pickle', 'olive', 'caper', 'sundried tomato', 'sun dried tomato',
    ],
    category: 'Canned & Jarred',
  },
  // Sauces & Condiments — sauces, cooking fats, vinegars, condiments, pastes,
  // dressings, preserves, and similar shelf-stable accompaniments.
  {
    keywords: [
      'sauce', 'salsa', 'hot sauce', 'sriracha', 'soy sauce', 'fish sauce',
      'oyster sauce', 'hoisin', 'teriyaki', 'worcestershire', 'tabasco',
      'ketchup', 'mustard', 'mayo', 'mayonnaise', 'ranch', 'dressing',
      'pasta sauce', 'tomato sauce', 'marinara', 'pesto', 'harissa', 'miso', 'gochujang',
      'chile garlic sauce', 'chili garlic sauce', 'chili bean paste',
      'curry paste', 'chile paste', 'chili paste', 'miso paste', 'chile crisp', 'chili crisp',
      'hummus', 'mirin', 'kimchi', 'pico de gallo',
      'oil', 'olive oil', 'vegetable oil', 'canola oil', 'sesame oil', 'coconut oil',
      'neutral oil', 'peanut oil', 'avocado oil', 'cooking oil', 'grapeseed oil',
      'sunflower oil', 'chili oil', 'chile oil', 'cooking spray', 'lard', 'ghee',
      'vinegar', 'apple cider vinegar', 'balsamic vinegar', 'balsamic', 'rice vinegar',
      'red wine vinegar', 'white wine vinegar', 'wine vinegar', 'black vinegar',
      'sherry vinegar', 'chinkiang vinegar',
      'preserve', 'jam', 'jelly', 'tamarind', 'pomegranate molasses',
    ],
    category: 'Sauces & Condiments',
  },
  // Spices & Seasonings — explicit processed forms outrank fresh/base produce
  // identities because their phrases contain more tokens.
  {
    keywords: [
      'chile', 'chili', 'chilli', 'chipotle', 'ancho', 'guajillo', 'chile powder', 'chili powder',
      'paprika', 'smoked paprika', 'cayenne', 'cayenne pepper', 'cumin', 'coriander', 'turmeric',
      'cinnamon', 'cardamom', 'nutmeg', 'clove', 'allspice', 'bay leaf', 'oregano',
      'garam masala', 'curry powder', 'five spice', 'zaatar', 'sumac', 'saffron',
      'fenugreek', 'asafoetida', 'asafetida', 'hing', 'xawaash', 'furikake',
      'star anise', 'gochugaru',
      'black pepper', 'white pepper', 'red pepper flake', 'peppercorn', 'pepper',
      'crushed red pepper',
      'garlic powder', 'onion powder', 'mustard powder', 'poultry seasoning',
      'coriander seed', 'cumin seed', 'mustard seed', 'caraway seed', 'cardamom seed',
      'celery seed',
      'dried oregano', 'dried thyme', 'dried rosemary', 'dried dill', 'dried basil',
      'dried parsley', 'dried sage', 'dried tarragon',
      'salt', 'spice', 'seasoning',
    ],
    category: 'Spices & Seasonings',
  },
  // Nuts, Seeds & Nut Butters — explicit culinary nuts/seeds and their butters.
  // Cooking oils and spice seeds are handled by the more-specific rules above.
  {
    keywords: [
      'almond', 'cashew', 'pecan', 'walnut', 'pistachio', 'peanut', 'pine nut',
      'hazelnut', 'macadamia', 'brazil nut',
      'sesame seed', 'chia seed', 'flaxseed', 'flax seed', 'sunflower seed', 'pumpkin seed',
      'peanut butter', 'almond butter', 'cashew butter', 'sunflower butter', 'nut butter',
      'seed butter', 'tahini',
    ],
    category: 'Nuts, Seeds & Nut Butters',
  },
  // Beverages — actual drinks and beverage ingredients, including plant milk.
  {
    keywords: [
      'juice', 'soda', 'water', 'sparkling water', 'coffee', 'tea', 'espresso',
      'beer', 'lager', 'wine', 'sake', 'whiskey', 'vodka', 'rum', 'tequila', 'gin',
      'mezcal', 'maraschino', 'kombucha', 'smoothie', 'lemonade', 'coconut water',
      'almond milk', 'oat milk', 'soy milk', 'pineapple juice', 'orange juice',
      'apple juice', 'grapefruit juice', 'v-8', 'dark soda', 'dr pepper', 'drink', 'beverage',
    ],
    category: 'Beverages',
  },
]

const UNCOUNTABLE_TOKENS = new Set([
  'asparagus', 'bass', 'bison', 'bread', 'cheese', 'couscous', 'fish', 'hummus',
  'molasses', 'oats', 'rice', 'salmon', 'shrimp', 'squid', 'tuna', 'watercress',
])

const IRREGULAR_TOKENS: Record<string, string> = {
  leaves: 'leaf',
  loaves: 'loaf',
  potatoes: 'potato',
  tomatoes: 'tomato',
}

function normalizeToken(token: string): string {
  if (UNCOUNTABLE_TOKENS.has(token)) return token
  if (IRREGULAR_TOKENS[token]) return IRREGULAR_TOKENS[token]
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`
  if (token.length > 4 && token.endsWith('oes')) return token.slice(0, -2)
  if (token.length > 4 && /(?:ches|shes|xes|zes)$/.test(token)) return token.slice(0, -2)
  if (token.length > 3 && token.endsWith('s') && !/(?:ss|us|is)$/.test(token)) {
    return token.slice(0, -1)
  }
  return token
}

function ingredientTokens(value: string): string[] {
  return (value || '')
    .normalize('NFKC')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.map(normalizeToken) ?? []
}

function containsPhrase(tokens: string[], phrase: string[]): boolean {
  if (!phrase.length || phrase.length > tokens.length) return false
  for (let start = 0; start <= tokens.length - phrase.length; start += 1) {
    if (phrase.every((token, offset) => tokens[start + offset] === token)) return true
  }
  return false
}

const MATCHERS = RULES.flatMap((rule, ruleIndex) =>
  rule.keywords.map((keyword, keywordIndex) => ({
    category: rule.category,
    keyword,
    ruleIndex,
    keywordIndex,
    phrase: ingredientTokens(keyword),
  })),
)

export interface GroceryCategoryMatch {
  category: GroceryCategory
  keyword: string
  ruleIndex: number
  keywordIndex: number
  tokenCount: number
}

/** Diagnostic companion used by the read-only corpus audit. */
export function matchGroceryCategory(name: string): GroceryCategoryMatch | null {
  const tokens = ingredientTokens(name)
  let best: GroceryCategoryMatch | null = null

  for (const matcher of MATCHERS) {
    if (!containsPhrase(tokens, matcher.phrase)) continue
    if (!best || matcher.phrase.length > best.tokenCount) {
      best = {
        category: matcher.category,
        keyword: matcher.keyword,
        ruleIndex: matcher.ruleIndex,
        keywordIndex: matcher.keywordIndex,
        tokenCount: matcher.phrase.length,
      }
    }
  }

  return best
}

export function categorizeIngredient(name: string): GroceryCategory {
  return matchGroceryCategory(name)?.category ?? 'Other'
}

/**
 * Read-time compatibility boundary for persisted category strings.
 *
 * Current values remain authoritative. Both retired values, and any unknown
 * stored string, are deterministically reclassified from the item name. This
 * helper is intentionally pure: callers must not write the normalized value
 * back merely because a legacy document was read.
 */
export function normalizePersistedGroceryCategory(
  value: unknown,
  itemName: string,
): GroceryCategory {
  if (isGroceryCategory(value)) return value
  return categorizeIngredient(itemName)
}
