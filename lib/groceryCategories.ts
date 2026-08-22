// Grocery categories are owned by the MEA Recipes web application. The former
// iOS client is deprecated and is not a compatibility constraint.
export const GROCERY_CATEGORIES = [
  'Produce',
  'Meat & Seafood',
  'Dairy & Eggs',
  'Bakery & Bread',
  'Canned / Jarred / Sauces',
  'Beverages',
  'Spices & Seasonings',
  'Staples',
  'Other',
] as const

export type GroceryCategory = typeof GROCERY_CATEGORIES[number]

// Staples are auto-assigned only — not manually selectable
export const MANUAL_CATEGORIES = GROCERY_CATEGORIES.filter(c => c !== 'Staples')

// Keyword mapping rules. Matching is token/phrase-aware and the longest
// matching phrase wins across every category. Array order is only the
// deterministic tie-breaker for equally specific matches.
const RULES: { keywords: string[]; category: GroceryCategory }[] = [
  // Produce
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
      'lemongrass', 'herb',
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
      'milk', 'cream', 'half and half', 'buttermilk', 'heavy cream', 'sour cream',
      'butter', 'ghee', 'cheese', 'cheddar', 'mozzarella', 'parmesan', 'feta',
      'brie', 'gouda', 'ricotta', 'cottage cheese', 'cream cheese', 'goat cheese',
      'yogurt', 'kefir', 'ice cream', 'whipped cream',
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
      'cracker', 'breadcrumb', 'panko', 'crouton',
      'cake', 'cookie', 'brownie', 'pastry', 'pie crust', 'dough',
    ],
    category: 'Bakery & Bread',
  },
  // Beverages
  {
    keywords: [
      'juice', 'soda', 'water', 'sparkling water', 'coffee', 'tea', 'espresso',
      'beer', 'wine', 'sake', 'whiskey', 'vodka', 'rum', 'tequila', 'gin',
      'kombucha', 'smoothie', 'lemonade', 'coconut water', 'almond milk', 'oat milk',
      'soy milk', 'pineapple juice', 'drink', 'beverage',
    ],
    category: 'Beverages',
  },
  // Canned / Jarred / Sauces
  {
    keywords: [
      'canned', 'can of', 'can diced tomato', 'can whole tomato', 'jar', 'jarred',
      'tomato paste', 'tomato sauce', 'crushed tomato',
      'coconut milk', 'coconut cream',
      'chicken broth', 'chicken stock', 'beef broth', 'beef stock',
      'vegetable broth', 'vegetable stock', 'bone broth', 'broth', 'stock',
      'butter bean',
      'beans', 'chickpea', 'lentil', 'black bean', 'kidney bean', 'pinto bean',
      'white bean', 'cannellini', 'navy bean',
      'tuna', 'sardine', 'anchovy',
      'sauce', 'salsa', 'hot sauce', 'sriracha', 'soy sauce', 'fish sauce',
      'oyster sauce', 'hoisin', 'teriyaki', 'worcestershire', 'tabasco',
      'ketchup', 'mustard', 'mayo', 'mayonnaise', 'ranch',
      'pasta sauce', 'marinara', 'pesto', 'tahini', 'harissa', 'miso', 'gochujang',
      'chipotle pepper in adobo', 'chile garlic sauce', 'chili bean paste',
      'pickle', 'olive', 'caper', 'sundried', 'roasted pepper',
      'soup', 'broth',
    ],
    category: 'Canned / Jarred / Sauces',
  },
  // Spices & Seasonings — explicit processed forms outrank fresh/base produce
  // identities because their phrases contain more tokens.
  {
    keywords: [
      'chile', 'chili', 'chilli', 'chipotle', 'ancho', 'guajillo', 'chile powder', 'chili powder',
      'paprika', 'smoked paprika', 'cayenne', 'cayenne pepper', 'cumin', 'coriander', 'turmeric',
      'cinnamon', 'cardamom', 'nutmeg', 'clove', 'allspice', 'bay leaf', 'oregano',
      'garam masala', 'curry powder', 'five spice', 'zaatar', 'sumac',
      'black pepper', 'white pepper', 'red pepper flake', 'peppercorn', 'pepper',
      'garlic powder', 'onion powder', 'mustard powder', 'poultry seasoning',
      'dried oregano', 'dried thyme', 'dried rosemary', 'dried dill', 'dried basil',
      'dried parsley', 'dried sage', 'dried tarragon',
      'spice', 'seasoning',
    ],
    category: 'Spices & Seasonings',
  },
  // Staples — auto-assigned only
  {
    keywords: [
      'salt', 'pepper', 'black pepper', 'white pepper', 'red pepper flake',
      'oil', 'olive oil', 'vegetable oil', 'canola oil', 'sesame oil', 'coconut oil',
      'neutral oil', 'peanut oil', 'avocado oil', 'cooking oil',
      'grapeseed oil', 'sunflower oil',
      'vinegar', 'apple cider vinegar', 'balsamic', 'rice vinegar', 'red wine vinegar',
      'sugar', 'brown sugar', 'powdered sugar', 'honey', 'maple syrup', 'agave',
      'flour', 'all-purpose flour', 'bread flour', 'cornstarch', 'baking soda',
      'baking powder', 'yeast', 'vanilla', 'cocoa powder',
      'cumin', 'paprika', 'turmeric', 'cinnamon', 'cardamom', 'coriander',
      'oregano', 'thyme', 'rosemary', 'bay leaf', 'nutmeg', 'clove',
      'chili powder', 'cayenne', 'smoked paprika', 'garlic powder', 'onion powder',
      'garam masala', 'curry powder', 'five spice', 'zaatar', 'sumac',
      'spice', 'seasoning', 'herb',
      'rice', 'pasta', 'noodle', 'spaghetti', 'penne', 'fettuccine', 'orzo',
      'couscous', 'quinoa', 'oat', 'oats', 'rolled oats', 'steel cut oats',
      'oatmeal', 'cereal', 'granola',
      'cornmeal', 'wonton wrapper',
    ],
    category: 'Staples',
  },
  // The current taxonomy has no nuts/nut-butters section. These explicit
  // identities intentionally fall back to Other instead of matching dairy
  // "butter". The future category migration remains separate work.
  {
    keywords: ['peanut butter', 'almond butter', 'cashew butter', 'nut butter'],
    category: 'Other',
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
