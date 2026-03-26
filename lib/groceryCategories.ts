// iOS-compatible category values — must match exactly
export const GROCERY_CATEGORIES = [
  'Produce',
  'Meat & Seafood',
  'Dairy & Eggs',
  'Bakery & Bread',
  'Canned / Jarred / Sauces',
  'Beverages',
  'Staples',
  'Other',
] as const

export type GroceryCategory = typeof GROCERY_CATEGORIES[number]

// Staples are auto-assigned only — not manually selectable
export const MANUAL_CATEGORIES = GROCERY_CATEGORIES.filter(c => c !== 'Staples')

// Keyword mapping rules — order matters (first match wins)
const RULES: { keywords: string[]; category: GroceryCategory }[] = [
  // Produce
  {
    keywords: [
      'apple', 'banana', 'orange', 'lemon', 'lime', 'grapefruit', 'mango', 'pineapple',
      'strawberr', 'blueberr', 'raspberr', 'blackberr', 'cherry', 'grape', 'watermelon',
      'peach', 'plum', 'avocado', 'tomato', 'cucumber', 'zucchini', 'squash', 'pumpkin',
      'carrot', 'celery', 'onion', 'shallot', 'scallion', 'green onion', 'leek', 'chive',
      'garlic', 'ginger', 'potato', 'sweet potato', 'yam', 'beet', 'radish', 'turnip',
      'broccoli', 'cauliflower', 'cabbage', 'kale', 'spinach', 'arugula', 'lettuce',
      'chard', 'collard', 'bok choy', 'brussels sprout', 'asparagus', 'artichoke',
      'corn', 'pea', 'edamame', 'green bean', 'snap pea', 'snow pea', 'bell pepper',
      'jalapeño', 'jalapen', 'habanero', 'serrano', 'chili pepper', 'pepper',
      'mushroom', 'eggplant', 'fennel', 'parsnip', 'cilantro', 'parsley', 'basil',
      'mint', 'thyme', 'rosemary', 'dill', 'sage', 'oregano', 'tarragon', 'herb',
      'fresh', 'produce', 'vegetable', 'fruit',
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
      'soy milk', 'drink', 'beverage', 'broth', 'stock', 'bone broth',
    ],
    category: 'Beverages',
  },
  // Canned / Jarred / Sauces
  {
    keywords: [
      'canned', 'can of', 'jar', 'tomato paste', 'tomato sauce', 'crushed tomato',
      'diced tomato', 'whole tomato', 'coconut milk', 'coconut cream',
      'beans', 'chickpea', 'lentil', 'black bean', 'kidney bean', 'pinto bean',
      'white bean', 'cannellini', 'navy bean',
      'tuna', 'sardine', 'anchovy',
      'sauce', 'salsa', 'hot sauce', 'sriracha', 'soy sauce', 'fish sauce',
      'oyster sauce', 'hoisin', 'teriyaki', 'worcestershire', 'tabasco',
      'ketchup', 'mustard', 'mayo', 'mayonnaise', 'ranch',
      'pasta sauce', 'marinara', 'pesto', 'tahini', 'harissa', 'miso',
      'pickle', 'olive', 'caper', 'sundried', 'roasted pepper',
      'soup', 'broth',
    ],
    category: 'Canned / Jarred / Sauces',
  },
  // Staples — auto-assigned only
  {
    keywords: [
      'salt', 'pepper', 'black pepper', 'white pepper', 'red pepper flake',
      'olive oil', 'vegetable oil', 'canola oil', 'sesame oil', 'coconut oil',
      'neutral oil', 'peanut oil', 'avocado oil', 'cooking oil',
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
      'couscous', 'quinoa', 'oat', 'oatmeal', 'cereal', 'granola',
      'bread crumb', 'panko',
    ],
    category: 'Staples',
  },
]

export function categorizeIngredient(name: string): GroceryCategory {
  const lower = name.toLowerCase()
  for (const rule of RULES) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return rule.category
    }
  }
  return 'Other'
}
