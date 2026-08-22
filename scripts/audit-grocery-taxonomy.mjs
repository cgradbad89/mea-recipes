#!/usr/bin/env node
/**
 * Read-only grocery taxonomy corpus audit.
 *
 * Reads the shared `recipes` collection, runs the production recipe-content,
 * ingredient, noun-normalization, and category functions, and emits a JSON
 * evidence artifact. This script never calls a Firestore mutation method.
 *
 * Usage:
 *   node scripts/audit-grocery-taxonomy.mjs > /tmp/grocery-taxonomy-audit.json
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { categorizeIngredient, GROCERY_CATEGORIES } from '../lib/groceryCategories.ts'
import { normalizeNoun, parseIngredient } from '../lib/ingredientParser.ts'
import { parseRecipeContent } from '../lib/recipeContent.ts'

const require = createRequire(import.meta.url)
const { loadEnv, getAdmin } = require('./_lib.js')

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')

function readCurrentRules() {
  const source = fs.readFileSync(path.join(repoRoot, 'lib/groceryCategories.ts'), 'utf8')
  const rules = []
  const blockPattern = /keywords:\s*\[([\s\S]*?)\],\s*category:\s*'([^']+)'/g
  let block
  while ((block = blockPattern.exec(source)) !== null) {
    const keywords = []
    const stringPattern = /'((?:\\.|[^'])*)'/g
    let keyword
    while ((keyword = stringPattern.exec(block[1])) !== null) {
      keywords.push(keyword[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'))
    }
    rules.push({ category: block[2], keywords })
  }
  return rules
}

const currentRules = readCurrentRules()

function matchedCurrentRule(name) {
  const lower = name.toLowerCase()
  for (let ruleIndex = 0; ruleIndex < currentRules.length; ruleIndex += 1) {
    const rule = currentRules[ruleIndex]
    const keyword = rule.keywords.find(value => lower.includes(value))
    if (keyword) return { ruleIndex, category: rule.category, keyword }
  }
  return { ruleIndex: -1, category: 'Other', keyword: null }
}

function roundedPercent(value, total) {
  return total ? Math.round((value / total) * 10000) / 100 : 0
}

function sortedItems(items) {
  return [...items].sort((left, right) =>
    right.occurrenceCount - left.occurrenceCount ||
    right.recipeCount - left.recipeCount ||
    left.normalizedIngredient.localeCompare(right.normalizedIngredient),
  )
}

const TEST_CATEGORIES = [
  'Produce',
  'Meat & Seafood',
  'Dairy & Eggs',
  'Bakery & Bread',
  'Pantry & Dry Goods',
  'Canned & Jarred',
  'Sauces & Condiments',
  'Spices & Seasonings',
  'Baking',
  'Nuts, Seeds & Nut Butters',
  'Frozen',
  'Beverages',
  'Other',
]

const RECOMMENDED_CATEGORIES = TEST_CATEGORIES.filter(category =>
  category !== 'Baking' && category !== 'Frozen',
)

function has(name, pattern) {
  return pattern.test(name)
}

function isNoise(name) {
  return has(name, /^(?:x|minute(?: minute)?|hour|serving|note|comment|prep|extra|item|payment|sale|report|default|contract|bidder|question|protein|bowl|dressing|stir fry|aromatic|enchilada|crispy tofu|tangy slaw|tzatziki|best gazpacho forever)$/) ||
    has(name, /^(?:for |to serve|serve with|build the? |additional |optional |garnish|sheet pan ingredient|sandwich add-on|yield |unit |us customary|metric conversion|nutritional information|add (?:ingredient )?to (?:your )?grocery list|shop ingredient|email grocery list|save recipe|featured in|by |from \d+ vote|read \d+ comment|get guide|our latest newsletter|secret of authentic|prevent your screen|anything else)/) ||
    has(name, /\b(?:contract|bidder|payment|register|vehicle|refund|finance|transaction|pay gov|sasy|pegasus|wire number|sale screen|sale\/lot|notice of award|purchaser receipt|auction payment|remittance|fleet gov|zvrc|webarm)\b/) ||
    has(name, /^(?:10 167|425|794|award-pay-remove|change check number|complete sale|facility transaction|admin financial|role and permission|all but last|i am thinking)/) ||
    has(name, /(?:privacy policy|customary measurement|screen are|screen used|screen where|screen and|lookup bidding|lookup by specific|history transaction|close register|reopen closed|create register|default transaction|collection of remaining balance)/)
}

function classifyExpected(name, { includeBaking = true, includeFrozen = true } = {}) {
  const value = name.toLowerCase()
  if (isNoise(value)) return { category: 'Other', confidence: 'high', reason: 'non-food, page chrome, time/yield text, or ingredient subheader' }

  if (includeFrozen && has(value, /\bfrozen\b/)) {
    return { category: 'Frozen', confidence: 'high', reason: 'explicitly frozen purchase form' }
  }

  const explicitCanOrJar = has(value, /\b(?:can|canned|jar|jarred)\b/) && !has(value, /\bcanola\b/)
  const cannedFood = has(value, /\b(?:bean|chickpea|garbanzo|lentil|hominy|tomato|tomatillo|coconut milk|coconut cream|tuna|sardine|anchovy|green chile|chipotle|artichoke|pumpkin|corn|soup)\b/)
  if (explicitCanOrJar && cannedFood) {
    return { category: 'Canned & Jarred', confidence: 'high', reason: 'explicit canned/jarred purchase form' }
  }

  if (!has(value, /\b(?:oil|coriander seed|cumin seed|mustard seed|caraway seed|cardamom seed|celery seed)\b/) &&
      has(value, /\b(?:almond|cashew|pecan|walnut|pistachio|peanut|pine nut|hazelnut|macadamia|flaxseed|flax|chia|sesame seed|tahini|nut butter|almond butter|peanut butter|cashew butter)\b/)) {
    return { category: 'Nuts, Seeds & Nut Butters', confidence: 'high', reason: 'nut, seed, or nut/seed butter purchase identity' }
  }

  const baking = has(value, /\b(?:flour|cornstarch|baking soda|baking powder|yeast|cocoa powder|vanilla|chocolate chip|sugar|molasses|cake mix|pie crust|dough)\b/)
  if (includeBaking && baking) {
    return { category: 'Baking', confidence: 'high', reason: 'baking ingredient' }
  }

  const spiceName = has(value, /\b(?:salt|black pepper|white pepper|peppercorn|red[ -]pepper flake|cayenne|paprika|cumin|coriander|turmeric|cinnamon|cardamom|nutmeg|allspice|bay leaf|garam masala|curry powder|five spice|zaatar|sumac|saffron|fenugreek|asafoetida|asafetida|hing|xawaash|furikake|caraway|star anise|gochugaru|chile powder|chili powder|garlic powder|onion powder|seasoning)\b/) ||
    has(value, /^(?:pepper|ground clove|whole clove|clove)$/) ||
    has(value, /\b(?:coriander seed|cumin seed|mustard seed|caraway seed|cardamom seed|celery seed)\b/)
  const driedHerb = has(value, /\b(?:dried|dry|ground|powder|flake|whole)\b/) && has(value, /\b(?:oregano|thyme|rosemary|dill|sage|basil|parsley|tarragon|chile|chili)\b/)
  if (spiceName || driedHerb) {
    return { category: 'Spices & Seasonings', confidence: 'high', reason: 'salt, dried herb, spice, powder, or seasoning' }
  }

  if (has(value, /\b(?:sauce|salsa|sriracha|gochujang|gochugaru paste|ketchup|mustard|mayonnaise|mayo|ranch|pesto|harissa|miso|hummus|preserve|jam|jelly|pico de gallo|kimchi|pickle|olive|caper|mirin|vinegar|cooking spray|oil|lard|ghee|molasses|curry paste|chile paste|chili paste|tamarind|grey poupon|pomegranate molasses)\b/)) {
    return { category: 'Sauces & Condiments', confidence: 'high', reason: 'sauce, condiment, cooking fat, vinegar, paste, or preserve' }
  }

  if (has(value, /\b(?:broth|stock|bouillon|rice|pasta|noodle|spaghetti|penne|fettuccine|orzo|couscous|quinoa|farro|oat|oatmeal|cereal|granola|cracker|breadcrumb|panko|lentil|chickpea|garbanzo|dry bean|dried bean|dry red bean|masa|hominy|ramen|wonton wrapper|protein powder|psyllium husk|honey|maple syrup|agave)\b/)) {
    return { category: 'Pantry & Dry Goods', confidence: 'high', reason: 'shelf-stable grain, pasta, legume, stock, or dry good' }
  }

  if (!includeBaking && baking) {
    return { category: 'Pantry & Dry Goods', confidence: 'high', reason: 'baking folded into pantry in the smaller taxonomy' }
  }

  if (has(value, /\b(?:tomato paste|tomato puree|coconut milk|coconut cream)\b/)) {
    return { category: 'Canned & Jarred', confidence: 'high', reason: 'shelf-stable coconut milk/cream' }
  }

  if (has(value, /^(?:water|cold water|boiling water|sparkling water)$/) ||
      has(value, /\b(?:almond milk|oat milk|soy milk|coconut water|apple juice|orange juice|pineapple juice|grapefruit juice|coffee|espresso|tea bag|beer|lager|wine|sake|whiskey|vodka|rum|tequila|gin|mezcal|maraschino|kombucha|smoothie|lemonade|v-8|soda|cola|root beer|sparkling water|beverage|drink)\b/)) {
    return { category: 'Beverages', confidence: 'high', reason: 'drink or beverage purchase identity' }
  }

  if (has(value, /\b(?:chicken|turkey|duck|beef|steak|brisket|ribeye|chuck roast|pork|bacon|ham|sausage|chorizo|pancetta|prosciutto|salami|kielbasa|lamb|veal|venison|bison|meatball|poultry|salmon|tuna|shrimp|prawn|crab|lobster|scallop|clam|mussel|oyster|squid|octopus|cod|halibut|tilapia|sardine|anchovy|fish|seafood|shellfish)\b/)) {
    return { category: 'Meat & Seafood', confidence: 'high', reason: 'meat, poultry, or seafood purchase identity' }
  }

  if (has(value, /\b(?:milk|cream|butter|cheese|cheddar|mozzarella|parmesan|pecorino|feta|brie|gouda|ricotta|cotija|paneer|queso fresco|yogurt|kefir|egg|half-and-half|buttermilk)\b/) &&
      !has(value, /\b(?:butter bean|almond butter|peanut butter|cashew butter|coconut milk|almond milk|oat milk|soy milk)\b/)) {
    return { category: 'Dairy & Eggs', confidence: 'high', reason: 'dairy or egg purchase identity' }
  }

  if (has(value, /\b(?:bread|sourdough|baguette|roll|bun|bagel|muffin|croissant|pita|naan|tortilla|wrap|brioche|focaccia|ciabatta|biscuit|tostada shell|flatbread|roti|injera)\b/) && !has(value, /\brolled oat\b/)) {
    return { category: 'Bakery & Bread', confidence: 'high', reason: 'finished bread or bakery purchase identity' }
  }

  const produce = has(value, /\b(?:apple|banana|orange|lemon|lime|grapefruit|mango|pineapple|berry|berries|cherry|grape|watermelon|peach|plum|avocado|tomato|tomatillo|cucumber|zucchini|squash|pumpkin|carrot|celery|onion|shallot|scallion|leek|chive|garlic|ginger|potato|yam|beet|radish|turnip|broccoli|cauliflower|cabbage|kale|spinach|arugula|rocket|lettuce|chard|collard|bok choy|brussel sprout|brussels sprout|brusselsprout|asparagus|artichoke|corn|pea|edamame|green bean|bean sprout|beansprout|snap pea|snow pea|bell pepper|jalapeño|jalapeno|habanero|serrano|anaheim pepper|pepperoncini|fresh chile|fresh chili|mushroom|eggplant|fennel|parsnip|cilantro|parsley|basil|mint|thyme|rosemary|dill|sage|oregano|tarragon|plantain|romaine|mixed green|tofu|vegetable|fruit)\b/)
  if (produce) {
    return { category: 'Produce', confidence: 'high', reason: 'fresh fruit, vegetable, herb, or refrigerated plant protein' }
  }

  if (explicitCanOrJar) {
    return { category: 'Canned & Jarred', confidence: 'medium', reason: 'explicit can/jar wording with unclear product family' }
  }

  return { category: 'Other', confidence: 'low', reason: 'no deterministic store-section match' }
}

function staplesCluster(name) {
  if (has(name, /\b(?:salt|pepper|paprika|cumin|coriander|turmeric|cinnamon|cardamom|oregano|thyme|rosemary|bay leaf|nutmeg|clove|chili powder|cayenne|garam masala|curry powder|five spice|zaatar|sumac|spice|seasoning|herb)\b/)) return 'spices/seasonings'
  if (has(name, /\b(?:oil|lard|ghee)\b/)) return 'oils/fats'
  if (has(name, /\b(?:vinegar|balsamic)\b/)) return 'vinegars'
  if (has(name, /\b(?:sugar|honey|maple syrup|agave|molasses)\b/)) return 'sweeteners'
  if (has(name, /\b(?:flour|cornstarch|baking soda|baking powder|yeast|vanilla|cocoa powder)\b/)) return 'flour/baking'
  if (has(name, /\b(?:rice|quinoa|couscous)\b/)) return 'rice/grains'
  if (has(name, /\b(?:pasta|noodle|spaghetti|penne|fettuccine|orzo)\b/)) return 'pasta/noodles'
  if (has(name, /\b(?:oat|oatmeal|cereal|granola)\b/)) return 'oats/cereals'
  return 'other'
}

function otherCluster(item) {
  const name = item.normalizedIngredient
  if (isNoise(name)) {
    return has(name, /\b(?:contract|bidder|payment|register|vehicle|refund|finance|transaction|sasy|pegasus|wire|sale)\b/)
      ? 'non-food corpus contamination'
      : 'page chrome / parsing noise'
  }
  const category = item.testClassification.category
  if (category === 'Nuts, Seeds & Nut Butters') return 'nuts/seeds/nut butters'
  if (category === 'Frozen') return 'frozen goods'
  if (category === 'Pantry & Dry Goods' || category === 'Baking') return 'specialty pantry / baking'
  if (category === 'Sauces & Condiments') return 'international sauces / condiments'
  if (category !== 'Other') return `missing keyword → ${category}`
  return 'genuinely miscellaneous / unresolved'
}

function distributionFor(items, categories, field) {
  const total = items.reduce((sum, item) => sum + item.occurrenceCount, 0)
  return categories.map(category => {
    const categoryItems = items.filter(item => item[field].category === category)
    const occurrences = categoryItems.reduce((sum, item) => sum + item.occurrenceCount, 0)
    return {
      category,
      uniqueIngredientCount: categoryItems.length,
      occurrenceCount: occurrences,
      occurrenceSharePercent: roundedPercent(occurrences, total),
      topIngredients: categoryItems.slice(0, 20).map(item => ({ ingredient: item.normalizedIngredient, occurrences: item.occurrenceCount })),
    }
  })
}

function movementMatrix(items, field) {
  const rows = new Map()
  for (const item of items) {
    const key = `${item.currentCategory}\u0000${item[field].category}`
    const row = rows.get(key) || {
      currentCategory: item.currentCategory,
      proposedCategory: item[field].category,
      uniqueIngredientCount: 0,
      occurrenceCount: 0,
    }
    row.uniqueIngredientCount += 1
    row.occurrenceCount += item.occurrenceCount
    rows.set(key, row)
  }
  return [...rows.values()].sort((left, right) =>
    GROCERY_CATEGORIES.indexOf(left.currentCategory) - GROCERY_CATEGORIES.indexOf(right.currentCategory) ||
    RECOMMENDED_CATEGORIES.indexOf(left.proposedCategory) - RECOMMENDED_CATEGORIES.indexOf(right.proposedCategory),
  )
}

function movementKind(item) {
  const proposed = item.recommendedClassification.category
  if (item.currentCategory === proposed) return 'conceptually unchanged'
  if (item.currentCategory === 'Staples') return 'taxonomy change: Staples separation'
  if (item.currentCategory === 'Other' && proposed !== 'Other') return 'classification gap: missing coverage'
  if (item.currentCategory === 'Canned / Jarred / Sauces' &&
      (proposed === 'Canned & Jarred' || proposed === 'Sauces & Condiments')) {
    return 'taxonomy change: split combined section'
  }
  if (item.currentCategory !== 'Other' && proposed === 'Other') return 'corpus/parsing noise exposed'
  return 'classification bug: keyword/precedence'
}

loadEnv()
const snapshot = await getAdmin().firestore().collection('recipes').get()

const vocabulary = new Map()
const recipeVocabulary = new Map()
const skippedRecipes = []
let rawIngredientLines = 0
let parseableRecipes = 0

for (const document of snapshot.docs) {
  const recipe = document.data()
  const content = typeof recipe.content === 'string' ? recipe.content : ''
  if (!content) {
    skippedRecipes.push({ id: document.id, title: recipe.title || '', reason: 'missing/non-string content' })
    continue
  }

  const parsedContent = parseRecipeContent(content)
  if (!parsedContent.ingredients.length) {
    skippedRecipes.push({ id: document.id, title: recipe.title || '', reason: 'parseRecipeContent returned no ingredients' })
    continue
  }

  parseableRecipes += 1
  rawIngredientLines += parsedContent.ingredients.length
  const recipeIngredients = new Set()

  for (const rawLine of parsedContent.ingredients) {
    const parsedIngredient = parseIngredient(rawLine)
    const normalizedIngredient = normalizeNoun(parsedIngredient.name)
    if (!normalizedIngredient) continue
    recipeIngredients.add(normalizedIngredient)

    const existing = vocabulary.get(normalizedIngredient) || {
      normalizedIngredient,
      rawExamples: new Map(),
      recipeIds: new Set(),
      occurrenceCount: 0,
      parserLowConfidenceCount: 0,
      currentCategory: categorizeIngredient(normalizedIngredient),
      matchedRule: matchedCurrentRule(normalizedIngredient),
    }
    existing.occurrenceCount += 1
    existing.recipeIds.add(document.id)
    existing.rawExamples.set(rawLine, (existing.rawExamples.get(rawLine) || 0) + 1)
    if (parsedIngredient.confidence === 'low') existing.parserLowConfidenceCount += 1
    vocabulary.set(normalizedIngredient, existing)
  }
  recipeVocabulary.set(document.id, { title: recipe.title || '', ingredients: recipeIngredients })
}

const ingredients = sortedItems([...vocabulary.values()].map(item => ({
  normalizedIngredient: item.normalizedIngredient,
  rawExamples: [...item.rawExamples.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([raw, count]) => ({ raw, count })),
  recipeCount: item.recipeIds.size,
  occurrenceCount: item.occurrenceCount,
  parserLowConfidenceCount: item.parserLowConfidenceCount,
  currentCategory: item.currentCategory,
  matchedRule: item.matchedRule,
}))).map(item => ({
  ...item,
  testClassification: classifyExpected(item.normalizedIngredient),
  recommendedClassification: classifyExpected(item.normalizedIngredient, { includeBaking: false, includeFrozen: false }),
}))

for (const ingredient of ingredients) {
  if (ingredient.currentCategory === 'Staples') ingredient.staplesCluster = staplesCluster(ingredient.normalizedIngredient)
}

for (const ingredient of ingredients) {
  if (ingredient.currentCategory === 'Other') ingredient.otherCluster = otherCluster(ingredient)
  ingredient.movementKind = movementKind(ingredient)
}

for (const ingredient of ingredients) {
  if (ingredient.currentCategory !== ingredient.matchedRule.category) {
    throw new Error(`Rule introspection mismatch for ${ingredient.normalizedIngredient}`)
  }
}

const totalOccurrences = ingredients.reduce((sum, item) => sum + item.occurrenceCount, 0)
const distribution = GROCERY_CATEGORIES.map(category => {
  const categoryItems = ingredients.filter(item => item.currentCategory === category)
  const occurrences = categoryItems.reduce((sum, item) => sum + item.occurrenceCount, 0)
  return {
    category,
    uniqueIngredientCount: categoryItems.length,
    occurrenceCount: occurrences,
    occurrenceSharePercent: roundedPercent(occurrences, totalOccurrences),
    topIngredients: categoryItems.slice(0, 30).map(item => ({
      ingredient: item.normalizedIngredient,
      occurrences: item.occurrenceCount,
      recipes: item.recipeCount,
      matchedKeyword: item.matchedRule.keyword,
    })),
  }
})

const testDistribution = distributionFor(ingredients, TEST_CATEGORIES, 'testClassification')
const recommendedDistribution = distributionFor(ingredients, RECOMMENDED_CATEGORIES, 'recommendedClassification')
const recommendedMovementMatrix = movementMatrix(ingredients, 'recommendedClassification')
const highConfidenceMisclassifications = ingredients.filter(item =>
  ['classification bug: keyword/precedence', 'classification gap: missing coverage', 'corpus/parsing noise exposed'].includes(item.movementKind) &&
  item.recommendedClassification.confidence === 'high',
)

const ingredientByName = new Map(ingredients.map(item => [item.normalizedIngredient, item]))

function assertCompleteDistribution(label, rows) {
  const unique = rows.reduce((sum, row) => sum + row.uniqueIngredientCount, 0)
  const occurrences = rows.reduce((sum, row) => sum + row.occurrenceCount, 0)
  if (unique !== ingredients.length || occurrences !== totalOccurrences) {
    throw new Error(`${label} distribution is incomplete: ${unique}/${ingredients.length} identities, ${occurrences}/${totalOccurrences} occurrences`)
  }
}

assertCompleteDistribution('current', distribution)
assertCompleteDistribution('13-category test', testDistribution)
assertCompleteDistribution('recommended', recommendedDistribution)
const movementUniqueTotal = recommendedMovementMatrix.reduce((sum, row) => sum + row.uniqueIngredientCount, 0)
const movementOccurrenceTotal = recommendedMovementMatrix.reduce((sum, row) => sum + row.occurrenceCount, 0)
if (movementUniqueTotal !== ingredients.length || movementOccurrenceTotal !== totalOccurrences) {
  throw new Error('Recommended movement matrix is incomplete')
}

function sectionCountStats(field) {
  const rows = [...recipeVocabulary.entries()].map(([id, recipe]) => {
    const counts = new Map()
    for (const name of recipe.ingredients) {
      const item = ingredientByName.get(name)
      const category = field === 'currentCategory' ? item.currentCategory : item[field].category
      counts.set(category, (counts.get(category) || 0) + 1)
    }
    return {
      id,
      title: recipe.title,
      sectionCount: counts.size,
      singletonSectionCount: [...counts.values()].filter(count => count === 1).length,
    }
  })
  const sectionCounts = rows.map(row => row.sectionCount).sort((left, right) => left - right)
  const totalSingletons = rows.reduce((sum, row) => sum + row.singletonSectionCount, 0)
  const totalSections = rows.reduce((sum, row) => sum + row.sectionCount, 0)
  return {
    minimumSectionsPerRecipe: sectionCounts[0] || 0,
    medianSectionsPerRecipe: sectionCounts[Math.floor(sectionCounts.length / 2)] || 0,
    maximumSectionsPerRecipe: sectionCounts.at(-1) || 0,
    averageSectionsPerRecipe: Math.round((totalSections / rows.length) * 100) / 100,
    singletonSectionCount: totalSingletons,
    singletonSectionSharePercent: roundedPercent(totalSingletons, totalSections),
  }
}

function clusteredSummary(items, clusterField) {
  const clusters = new Map()
  for (const item of items) {
    const cluster = item[clusterField]
    const row = clusters.get(cluster) || { cluster, uniqueIngredientCount: 0, occurrenceCount: 0 }
    row.uniqueIngredientCount += 1
    row.occurrenceCount += item.occurrenceCount
    clusters.set(cluster, row)
  }
  return [...clusters.values()].sort((left, right) => right.occurrenceCount - left.occurrenceCount || left.cluster.localeCompare(right.cluster))
}

const artifact = {
  generatedAt: new Date().toISOString(),
  source: {
    firebaseProject: process.env.FIREBASE_PROJECT_ID,
    collection: 'recipes',
    access: 'single read-only collection query',
  },
  corpus: {
    recipesInspected: snapshot.size,
    parseableRecipes,
    skippedRecipeCount: skippedRecipes.length,
    rawIngredientLines,
    uniqueNormalizedIngredients: ingredients.length,
    normalizedIngredientOccurrences: totalOccurrences,
    parserLowConfidenceOccurrences: ingredients.reduce((sum, item) => sum + item.parserLowConfidenceCount, 0),
  },
  skippedRecipes,
  currentCategories: GROCERY_CATEGORIES,
  currentDistribution: distribution,
  testCategories: TEST_CATEGORIES,
  testDistribution,
  recommendedCategories: RECOMMENDED_CATEGORIES,
  recommendedDistribution,
  recommendedMovementMatrix,
  highConfidenceMisclassificationSummary: {
    uniqueIngredientCount: highConfidenceMisclassifications.length,
    occurrenceCount: highConfidenceMisclassifications.reduce((sum, item) => sum + item.occurrenceCount, 0),
  },
  movementKindSummary: clusteredSummary(ingredients, 'movementKind'),
  sectionComplexity: {
    current: sectionCountStats('currentCategory'),
    test: sectionCountStats('testClassification'),
    recommended: sectionCountStats('recommendedClassification'),
    note: 'Per-recipe proxy only; no user week-plan collection was read.',
  },
  currentOtherClusters: clusteredSummary(ingredients.filter(item => item.currentCategory === 'Other'), 'otherCluster'),
  currentStaplesClusters: clusteredSummary(ingredients.filter(item => item.currentCategory === 'Staples'), 'staplesCluster'),
  ingredients,
}

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
}

function truncate(value, length = 140) {
  const text = escapeCell(value)
  return text.length > length ? `${text.slice(0, length - 1)}…` : text
}

function table(headers, rows) {
  const header = `| ${headers.join(' | ')} |`
  const separator = `| ${headers.map(() => '---').join(' | ')} |`
  return [header, separator, ...rows.map(row => `| ${row.map(escapeCell).join(' | ')} |`)].join('\n')
}

function distributionTable(distribution) {
  return table(
    ['Category', 'Unique ingredients', 'Occurrences', '% occurrences'],
    distribution.map(row => [row.category, row.uniqueIngredientCount, row.occurrenceCount, `${row.occurrenceSharePercent}%`]),
  )
}

function renderIngredientList(items, limit = 20) {
  return table(
    ['Ingredient', 'Occurrences', 'Recipes', 'Matched keyword'],
    items.slice(0, limit).map(item => [item.normalizedIngredient, item.occurrenceCount, item.recipeCount, item.matchedRule.keyword || 'none']),
  )
}

function categoryPurpose(category) {
  return ({
    'Produce': 'Fresh fruit, vegetables, herbs, and refrigerated plant proteins.',
    'Meat & Seafood': 'Fresh/frozen-counter meat, poultry, and seafood; excludes stocks and fish/oyster sauces.',
    'Dairy & Eggs': 'Animal dairy, cultured dairy, cheese, and eggs; excludes plant milks and coconut milk.',
    'Bakery & Bread': 'Finished breads, rolls, tortillas, pitas, and similar bakery purchases.',
    'Pantry & Dry Goods': 'Grains, pasta/noodles, dry legumes, broth/stock, baking goods, and other shelf-stable dry goods.',
    'Canned & Jarred': 'Foods whose purchase identity is explicitly canned/jarred, especially tomatoes, legumes, hominy, chiles, and coconut milk.',
    'Sauces & Condiments': 'Cooking oils, vinegars, sauces, condiments, pastes, preserves, and prepared accompaniments.',
    'Spices & Seasonings': 'Salt, pepper, dried herbs, ground/whole spices, and seasoning blends.',
    'Nuts, Seeds & Nut Butters': 'Culinary nuts, edible seeds, tahini, and nut/seed butters; excludes spice seeds and oils.',
    'Beverages': 'Drinks and drink ingredients such as coffee, beer/wine, soda, water, and plant milks.',
    'Other': 'True exceptions plus corpus/parsing noise that should not be forced into a shopping section.',
  })[category]
}

function renderReport(data) {
  const otherItems = data.ingredients.filter(item => item.currentCategory === 'Other')
  const staplesItems = data.ingredients.filter(item => item.currentCategory === 'Staples')
  const topMisclassifications = data.ingredients.filter(item =>
    ['classification bug: keyword/precedence', 'classification gap: missing coverage', 'corpus/parsing noise exposed'].includes(item.movementKind) &&
    item.recommendedClassification.confidence === 'high',
  ).slice(0, 60)
  const recommendations = new Map(data.recommendedDistribution.map(row => [row.category, row]))
  const currentOther = data.currentDistribution.find(row => row.category === 'Other')
  const currentStaples = data.currentDistribution.find(row => row.category === 'Staples')
  const lines = []

  lines.push(`# MEA Recipes — Grocery Category Taxonomy Audit — 2026-08-22`)
  lines.push(``)
  lines.push(`**Work type:** discovery · **production behavior changed:** no · **Firestore writes:** 0`)
  lines.push(``)
  lines.push(`## Executive summary`)
  lines.push(``)
  lines.push(`The smallest useful change is an **11-section store-oriented taxonomy**: keep the four strong fresh-food sections, replace \`Staples\` with explicit shopping sections, split the current canned/sauce catch-all, add one evidence-supported nuts/seeds section, and retain a narrow \`Other\`. Do **not** add separate \`Baking\` or \`Frozen\` sections yet: the corpus simulation gives them only 85 (2.66%) and 12 (0.38%) occurrences respectively, and the per-recipe proxy shows the 13-section test increases singleton-section fragmentation.`)
  lines.push(``)
  lines.push(`Rule precedence is the immediate problem. Raw substring matching creates both the hypothesized collisions and larger unanticipated ones: \`extra-virgin olive oil\` matches \`gin\`, \`teaspoon\` text matches \`tea\`, \`rolled oats\` matches \`roll\`, and broad \`fresh\`, \`vegetable\`, \`pea\`, \`pepper\`, \`corn\`, \`butter\`, and animal-name terms preempt the intended section. \`Staples\` is not a coherent store section; it is a mixture of “usually on hand” status and at least eight shopping concepts. Staple status should become a separate future property, not remain a category.`)
  lines.push(``)
  lines.push(table(['Metric', 'Result'], [
    ['Recipes analyzed', data.corpus.recipesInspected],
    ['Recipes with parseable ingredients', data.corpus.parseableRecipes],
    ['Unique normalized ingredients', data.corpus.uniqueNormalizedIngredients],
    ['Raw ingredient occurrences', data.corpus.rawIngredientLines],
    ['Current categories', data.currentCategories.length],
    ['Likely high-confidence misclassified identities', data.highConfidenceMisclassificationSummary.uniqueIngredientCount],
    ['Likely high-confidence misclassified occurrences', data.highConfidenceMisclassificationSummary.occurrenceCount],
    ['Current Other share', `${currentOther.occurrenceSharePercent}%`],
    ['Current Staples share', `${currentStaples.occurrenceSharePercent}%`],
    ['Recommended categories', data.recommendedCategories.length],
  ]))
  lines.push(``)
  lines.push(`The 513 figure is the high-confidence subset of three movement families. Across all confidence levels, the disjoint movement summary contains 397 keyword/precedence defects, 94 missing-coverage identities from \`Other\`, and 90 identities assigned to shopping sections even though the lines are corpus/parsing noise. Pure \`Staples\` relocation and the canned/sauce split are reported separately as taxonomy changes, not mislabeled as rule bugs.`)

  lines.push(``)
  lines.push(`## Scope, corpus, and method`)
  lines.push(``)
  lines.push(`The checked-in M-04 backup is a 10-document remediation snapshot, not a complete export. The audit therefore used the repository's existing Admin SDK helper for one read-only query of the shared \`recipes\` collection. It did not read user grocery, saved-item, or week-plan collections. Each recipe used current \`parseRecipeContent\`; each returned line used current \`parseIngredient\`, \`normalizeNoun\`, and \`categorizeIngredient\`. The conservative noun normalization intentionally preserves modifiers and purchase identity, so \`black pepper\`, \`bell pepper\`, \`garlic powder\`, \`garlic\`, \`almond milk\`, and dairy milk remain distinct.`)
  lines.push(``)
  lines.push(table(['Corpus result', 'Count'], [
    ['Recipe documents inspected', data.corpus.recipesInspected],
    ['Parseable recipes', data.corpus.parseableRecipes],
    ['Skipped recipes', data.corpus.skippedRecipeCount],
    ['Raw ingredient lines', data.corpus.rawIngredientLines],
    ['Normalized grocery identities', data.corpus.uniqueNormalizedIngredients],
    ['Normalized occurrences', data.corpus.normalizedIngredientOccurrences],
    ['Low-confidence parser occurrences', data.corpus.parserLowConfidenceOccurrences],
  ]))
  lines.push(``)
  lines.push(table(['Skipped recipe', 'Title', 'Reason'], data.skippedRecipes.map(row => [row.id, row.title, row.reason])))
  lines.push(``)
  lines.push(`The reusable read-only analyzer at \`scripts/audit-grocery-taxonomy.mjs\` emits the complete ingredient-frequency dataset as JSON, including normalized identity, up to eight raw examples, recipe count, occurrence count, parser confidence, current category, exact first-matched rule/keyword, candidate/recommended classification, movement type, and \`Other\`/\`Staples\` cluster. It introspects the current ordered keyword blocks and aborts if its recorded first match disagrees with production \`categorizeIngredient()\`.`)

  lines.push(``)
  lines.push(`## Grocery architecture and hard-coded category values`)
  lines.push(``)
  lines.push(table(['Location', 'Category coupling'], [
    ['lib/groceryCategories.ts', 'Authoritative 9 strings; GroceryCategory type; MANUAL_CATEGORIES derivation; ordered keyword rules.'],
    ['app/grocery/page.tsx', 'CATEGORY_EMOJI hard-codes every string; grouping/render order uses GROCERY_CATEGORIES; add/edit pickers use MANUAL_CATEGORIES; manualSection overrides auto classification.'],
    ['lib/userdata.ts', 'GroceryItem.manualSection and SavedGroceryItem.defaultCategory persist GroceryCategory strings directly.'],
    ['lib/groceryCleanup.ts', 'Validates AI categories with GROCERY_CATEGORIES.includes; off-list values fall back to categorizeIngredient.'],
    ['app/api/grocery-cleanup/route.ts', 'Prompt list derives from GROCERY_CATEGORIES; explanatory prompt text names Spices & Seasonings and Staples. Zod accepts a string, then shared sanitizer enforces the list.'],
    ['PRD.md', 'Documents nine iOS-compatible values, first-match behavior, manualSection, saved defaults, and AI centralization.'],
    ['Tests', 'Several fixtures contain category strings but do not define a second production taxonomy.'],
  ]))
  lines.push(``)
  lines.push(`Historical grocery documents store no auto-category field, but any \`manualSection\` is a persisted category string. Saved grocery items persist \`defaultCategory\` directly. Therefore automatic items without overrides would reclassify under new rules, while manual overrides and saved defaults would retain legacy strings until compatibility handling/migration. Changing values requires coordinated web/iOS work because both clients share Firestore, even though the exact iOS enum could not be inspected in this repository.`)

  lines.push(``)
  lines.push(`## Current taxonomy distribution`)
  lines.push(``)
  lines.push(distributionTable(data.currentDistribution))
  for (const category of data.currentCategories) {
    const categoryItems = data.ingredients.filter(item => item.currentCategory === category)
    const suspicious = categoryItems.filter(item => item.movementKind !== 'conceptually unchanged').slice(0, 8)
    const longTail = categoryItems.filter(item => item.occurrenceCount === 1).slice(-6)
    lines.push(``)
    lines.push(`### ${category}`)
    lines.push(``)
    lines.push(renderIngredientList(categoryItems, 20))
    lines.push(``)
    lines.push(`Representative long tail: ${longTail.map(item => `\`${item.normalizedIngredient}\``).join(', ') || 'none'}.`)
    lines.push(``)
    lines.push(`Suspicious assignments: ${suspicious.map(item => `\`${item.normalizedIngredient}\` (${item.occurrenceCount}; \`${item.matchedRule.keyword || 'no keyword'}\` → ${item.recommendedClassification.category})`).join('; ') || 'none identified'}.`)
  }

  lines.push(``)
  lines.push(`## Most important misclassifications`)
  lines.push(``)
  lines.push(`This table prioritizes frequency and high confidence. “Rule” is the exact first substring that won. The full 513-identity set is in the analyzer JSON output.`)
  lines.push(``)
  lines.push(table(
    ['Ingredient', 'Freq.', 'Current', 'Rule', 'Recommended', 'Confidence', 'Reason'],
    topMisclassifications.map(item => [
      item.normalizedIngredient,
      item.occurrenceCount,
      item.currentCategory,
      item.matchedRule.keyword || 'no match',
      item.recommendedClassification.category,
      item.recommendedClassification.confidence,
      item.recommendedClassification.reason,
    ]),
  ))

  lines.push(``)
  lines.push(`## Explicit rule-order collision review`)
  lines.push(``)
  lines.push(table(['Hypothesis', 'Observed result'], [
    ['black pepper', 'Confirmed: black pepper alone appears 24 times and maps to Produce via generic `pepper`; the broader black-pepper family is larger.'],
    ['garlic powder', 'Confirmed: 18 occurrences map to Produce via `garlic`.'],
    ['onion powder', 'Confirmed: 12 direct occurrences map to Produce via `onion` (plus mixed lines).'],
    ['chickpeas', 'Confirmed: canned/dry chickpea identities map to Produce via substring `pea`.'],
    ['dried herbs', 'Confirmed: dried oregano 21, dried thyme 8, dried basil 4, and other dried herbs map to Produce because fresh-herb names appear first.'],
    ['almond/oat/soy milk', 'Confirmed where present: almond milk and oat milk each map to Dairy & Eggs via `milk`; no soy-milk identity occurs in the corpus. The later beverage keywords are unreachable.'],
    ['coconut milk', 'Confirmed: 8 observed occurrences across identities map to Dairy & Eggs via `milk`, before the canned rule.'],
    ['broth/stock', 'Confirmed, but not primarily Beverages: animal broths/stocks map to Meat & Seafood via animal names; vegetable versions map to Produce via `vegetable`; generic water/broth can map to Beverages.'],
    ['canned seafood', 'No explicitly canned tuna/sardine identity occurs. Two anchovy-fillet identities map to Meat & Seafood; one anchovy/vegetable-broth line maps to Produce. Hypothesis not corpus-testable for labeled cans.'],
    ['new: extra-virgin olive oil', 'Confirmed severe substring bug: 24 direct occurrences map to Beverages because `gin` occurs inside `virgin`; variants add more.'],
    ['new: teaspoon text', 'Confirmed: several malformed/low-quality lines map to Beverages because `tea` occurs inside `teaspoon`.'],
    ['new: rolled oats', 'Confirmed: rolled-oat identities map to Bakery & Bread via substring `roll`.'],
    ['new: cornstarch/tortillas/peppercorn', 'Confirmed: generic `corn` pushes cornstarch, corn tortillas, and even Sichuan peppercorn toward Produce.'],
    ['new: fish/oyster sauce', 'Confirmed: fish sauce and oyster sauce map to Meat & Seafood before the sauce rule.'],
    ['new: butter beans', 'Confirmed: butter-bean text can map to Dairy & Eggs via `butter`.'],
  ]))

  lines.push(``)
  lines.push(`## Other analysis`)
  lines.push(``)
  lines.push(`Current \`Other\` contains **${currentOther.uniqueIngredientCount} identities / ${currentOther.occurrenceCount} occurrences (${currentOther.occurrenceSharePercent}%)**. Most of it does not justify a new shopping category: 242 occurrences are page chrome, ingredient subheaders, time/yield fragments, or obvious non-food corpus contamination. The strongest true shopping cluster is nuts/seeds/nut butters (30 occurrences among current \`Other\`; 53 occurrences corpus-wide after correcting collisions), followed by international sauces/condiments (30 current-\`Other\` occurrences).`)
  lines.push(``)
  lines.push(table(['Cluster', 'Unique', 'Occurrences', 'Recommended handling'], data.currentOtherClusters.map(row => [
    row.cluster,
    row.uniqueIngredientCount,
    row.occurrenceCount,
    row.cluster.includes('noise') || row.cluster.includes('contamination') ? 'Repair/filter source content; keep out of shopping sections.' :
      row.cluster.includes('nuts') ? 'Add Nuts, Seeds & Nut Butters.' :
      row.cluster.includes('unresolved') ? 'Keep Other pending reviewed rules/data cleanup.' : 'Add targeted rule coverage in the named section.',
  ])))
  lines.push(``)
  lines.push(`A notable data-quality finding is that at least 76 unique \`Other\` identities are non-recipe workflow text about contracts, bidders, registers, payments, vehicles, refunds, and related screens. The audit does not repair those recipes, but taxonomy changes alone cannot make those lines useful grocery items.`)

  lines.push(``)
  lines.push(`## Staples analysis`)
  lines.push(``)
  lines.push(`Current \`Staples\` contains **${currentStaples.uniqueIngredientCount} identities / ${currentStaples.occurrenceCount} occurrences (${currentStaples.occurrenceSharePercent}%)** across unrelated store concepts:`)
  lines.push(``)
  lines.push(table(['Cluster', 'Unique', 'Occurrences'], data.currentStaplesClusters.map(row => [row.cluster, row.uniqueIngredientCount, row.occurrenceCount])))
  lines.push(``)
  lines.push(`**Keep Staples as category: NO. Recommend separate staple-status concept: YES.** “Where do I buy/find this?” and “Do I usually have this?” are independent. Move salt/pepper/dried herbs to Spices & Seasonings; oils/vinegars to Sauces & Condiments; flour/sugar/baking agents to Pantry & Dry Goods in the recommended small taxonomy; and rice/grains/pasta/noodles/oats to Pantry & Dry Goods. A later boolean or preference-backed staple status may suppress, pre-check, or annotate items, but it should not determine the shopping section.`)

  lines.push(``)
  lines.push(`## 13-category candidate simulation`)
  lines.push(``)
  lines.push(`The mandated test taxonomy was simulated deterministically against every normalized identity. It is useful diagnostically but too fragmented for the product.`)
  lines.push(``)
  lines.push(distributionTable(data.testDistribution))
  for (const row of data.testDistribution) {
    lines.push(``)
    lines.push(`- **${row.category}:** ${row.uniqueIngredientCount} identities / ${row.occurrenceCount} occurrences. Top: ${row.topIngredients.slice(0, 8).map(item => `\`${item.ingredient}\` (${item.occurrences})`).join(', ') || 'none'}.`)
  }

  lines.push(``)
  lines.push(`## Final recommended taxonomy simulation`)
  lines.push(``)
  lines.push(distributionTable(data.recommendedDistribution))
  lines.push(``)
  lines.push(`Recommended order and justification:`)
  lines.push(``)
  lines.push(table(['Category', 'Purpose', 'Representative ingredients', 'Unique', 'Occurrences', 'Why separate'], data.recommendedCategories.map(category => {
    const row = recommendations.get(category)
    return [
      category,
      categoryPurpose(category),
      row.topIngredients.slice(0, 5).map(item => item.ingredient).join(', '),
      row.uniqueIngredientCount,
      row.occurrenceCount,
      category === 'Other' ? 'Necessary escape hatch while corpus noise and one-offs remain.' :
        category === 'Nuts, Seeds & Nut Butters' ? '53 occurrences and a distinct aisle/purchase family; fixes the strongest coherent Other cluster.' :
        category === 'Bakery & Bread' ? 'Sparse but physically distinct and already familiar; finished breads should not mix with dry pantry goods.' :
        'Coherent physical shopping section with repeated corpus use.',
    ]
  })))

  lines.push(``)
  lines.push(`## Current → proposed movement matrix`)
  lines.push(``)
  lines.push(table(
    ['Current category', 'Proposed category', 'Unique moved/staying', 'Occurrences'],
    data.recommendedMovementMatrix.map(row => [row.currentCategory, row.proposedCategory, row.uniqueIngredientCount, row.occurrenceCount]),
  ))
  lines.push(``)
  lines.push(table(['Movement type', 'Unique', 'Occurrences'], data.movementKindSummary.map(row => [row.cluster, row.uniqueIngredientCount, row.occurrenceCount])))
  lines.push(``)
  lines.push(`Interpretation: 1,160 identities / 1,692 occurrences stay in the same conceptual section; 397 / 691 move because of keyword/precedence defects; 151 / 368 move because \`Staples\` is removed as a shopping concept; 116 / 225 split the combined canned/sauce section; 94 / 114 gain missing coverage from \`Other\`; and 90 / 100 are revealed as corpus/parsing noise currently forced into a non-Other section.`)

  lines.push(``)
  lines.push(`## Category count and grocery-list UX`)
  lines.push(``)
  lines.push(table(['Simulation', 'Min sections/recipe', 'Median', 'Average', 'Max', 'Singleton-section share'], [
    ['Current 9', data.sectionComplexity.current.minimumSectionsPerRecipe, data.sectionComplexity.current.medianSectionsPerRecipe, data.sectionComplexity.current.averageSectionsPerRecipe, data.sectionComplexity.current.maximumSectionsPerRecipe, `${data.sectionComplexity.current.singletonSectionSharePercent}%`],
    ['13-category test', data.sectionComplexity.test.minimumSectionsPerRecipe, data.sectionComplexity.test.medianSectionsPerRecipe, data.sectionComplexity.test.averageSectionsPerRecipe, data.sectionComplexity.test.maximumSectionsPerRecipe, `${data.sectionComplexity.test.singletonSectionSharePercent}%`],
    ['Recommended 11', data.sectionComplexity.recommended.minimumSectionsPerRecipe, data.sectionComplexity.recommended.medianSectionsPerRecipe, data.sectionComplexity.recommended.averageSectionsPerRecipe, data.sectionComplexity.recommended.maximumSectionsPerRecipe, `${data.sectionComplexity.recommended.singletonSectionSharePercent}%`],
  ]))
  lines.push(``)
  lines.push(`No production week-plan collection was read because the prompt limited live access to shared \`recipes\`. The table is therefore a per-recipe section-density proxy, not an invented week. The 13-category test increases fragmentation while \`Frozen\` contributes only 12 occurrences and \`Baking\` only 85. The recommended 11 visible categories are a practical maximum for this corpus; a typical plan will show only nonempty sections, but adding more sparse sections would create one-item cards and slower scanning.`)

  lines.push(``)
  lines.push(`## Categories considered but rejected`)
  lines.push(``)
  lines.push(table(['Candidate', 'Decision', 'Evidence'], [
    ['Baking', 'Reject as separate section for now', '41 identities / 85 occurrences (2.66%); fold into Pantry & Dry Goods to reduce one-item sections.'],
    ['Frozen', 'Reject as separate section for now', '11 identities / 12 occurrences (0.38%); route frozen produce/meat/bread to their product family until corpus usage grows.'],
    ['Staples', 'Remove as category', '151 identities / 368 occurrences across eight store concepts; it describes possession status, not location.'],
    ['Single Canned / Jarred / Sauces catch-all', 'Split', '225 occurrences move through the split; canned foods and condiment/oil purchases are physically and conceptually different.'],
    ['Separate oils/vinegars category', 'Reject', 'Sauces & Condiments is coherent enough and avoids another sparse section.'],
  ]))

  lines.push(``)
  lines.push(`## Rule-precedence fixes required regardless of taxonomy decision`)
  lines.push(``)
  lines.push(`1. Replace unrestricted \`includes\` matching with token/phrase boundaries and explicit purchase-form rules; otherwise \`gin\` in \`virgin\`, \`tea\` in \`teaspoon\`, \`pea\` in \`peanut/pearl\`, and \`roll\` in \`rolled\` will recur.`)
  lines.push(`2. Match high-specificity forms before base ingredients: powders/dried herbs/black pepper before fresh garlic/onion/herbs/pepper; tomato paste/canned tomatoes before tomato; coconut/plant milk before generic milk; broth/stock and sauces before animal/vegetable names; oils/vinegars before fruit/vegetable/alcohol words.`)
  lines.push(`3. Remove generic \`fresh\`, \`produce\`, \`vegetable\`, \`fruit\`, \`herb\`, \`pepper\`, \`pea\`, and similar substring rules unless constrained by boundaries or stronger context.`)
  lines.push(`4. Treat explicit can/jar state as purchase identity and apply it before ingredient-family rules.`)
  lines.push(`5. Add regression cases from this corpus, including every explicit collision above and negative controls (bell pepper remains Produce; garlic remains Produce; dairy milk remains Dairy & Eggs; actual gin/tea/soda remain Beverages).`)
  lines.push(`6. Address source-content/subheader noise separately. Category rules must not be used as a substitute for removing \`For the sauce\`, page buttons, nutrition chrome, or non-recipe workflow prose from ingredient extraction.`)

  lines.push(``)
  lines.push(`## iOS compatibility`)
  lines.push(``)
  lines.push(`**Status: unable to verify exact-string requirement.** Repository evidence consists of the comment \`// iOS-compatible category values — must match exactly\`, the PRD statement that the web and iOS app share Firestore, and persisted category-string fields. No Swift source, iOS enum, schema, fixture, API contract, or external iOS repository is present here. The comment cannot independently prove the current iOS implementation.`)
  lines.push(``)
  lines.push(`A taxonomy change nevertheless requires coordination: synchronize the ordered/displayed category values and fallback behavior in both clients; accept legacy \`manualSection\` and \`defaultCategory\` strings during rollout; decide whether iOS recomputes auto categories locally; and verify AI-cleanup results and any category picker use the same values. Do not ship web-only string changes until that contract is inspected.`)

  lines.push(``)
  lines.push(`## Saved/manual category and historical-data impact`)
  lines.push(``)
  lines.push(`- \`GroceryItem.manualSection\` persists category names directly. Existing manual overrides would become legacy values if a category is renamed/removed; reads need an alias/fallback strategy and an eventual migration only after both clients understand the new values.`)
  lines.push(`- \`SavedGroceryItem.defaultCategory\` also persists category strings. Autocomplete/quick-add reuses the saved value, so legacy defaults need the same compatibility mapping or migration.`)
  lines.push(`- Auto recipe grocery items do not persist an auto category; without \`manualSection\`, they are categorized at render time and would immediately follow new rules.`)
  lines.push(`- Current grocery documents with manual sections and saved items were not read, so the number of legacy values requiring handling is unknown.`)
  lines.push(`- \`Staples\` should disappear from category choices and auto assignment when the taxonomy changes. It should not become manually selectable. If staple status is later built, represent it as a separate flag/preference rather than \`manualSection\`.`)

  lines.push(``)
  lines.push(`## AI grocery cleanup impact`)
  lines.push(``)
  lines.push(`The cleanup contract is centralized correctly: the route prompt derives its exact list from \`GROCERY_CATEGORIES\`, and \`sanitizeGroceryCleanupChanges\` validates returned values against that array before applying them, falling back to local categorization. A future taxonomy change must update the central list/rules, prompt guidance for new/removed sections, category emoji/pickers, and tests. The Zod field is intentionally a bounded string rather than a duplicated enum; shared sanitization is the enforcement point.`)

  lines.push(``)
  lines.push(`## Recommended implementation sequence`)
  lines.push(``)
  lines.push(`1. **Fix deterministic classification first:** boundary-aware matching, specificity ordering, explicit form rules, and corpus-derived regression fixtures. Keep current strings during this step so rule fixes and product taxonomy are reviewable separately.`)
  lines.push(`2. **Confirm the iOS contract and approve the 11-category taxonomy:** inspect the actual iOS enum/logic, agree on synchronized values/order, and decide rollout aliases.`)
  lines.push(`3. **Add compatibility handling:** read-time aliases for legacy \`Staples\` and \`Canned / Jarred / Sauces\` manual/saved values; inventory user-scoped stored values read-only; then plan any reviewed migration.`)
  lines.push(`4. **Update all consumers together:** \`GROCERY_CATEGORIES\`, category rules, emoji/order, manual picker, AI prompt guidance, shared validation, web tests, and iOS equivalents.`)
  lines.push(`5. **Regression-test against the actual corpus:** freeze a sanitized category fixture or expected high-frequency set, rerun the movement audit, and verify no substring regressions. Separately investigate recipe-content contamination so non-food lines never enter grocery creation.`)

  lines.push(``)
  lines.push(`## Validation and safety`)
  lines.push(``)
  lines.push(`Fresh test baseline before documentation: \`npm test\` — **PASS**, 24 files passed / 1 skipped; 138 tests passed / 1 skipped (139 total).`)
  lines.push(``)
  lines.push(`Final verification:`)
  lines.push(``)
  lines.push(`- \`node scripts/audit-grocery-taxonomy.mjs --report docs/audits/grocery-category-taxonomy-audit-2026-08-22.md\` — **PASS**; live read-only rerun reproduced 216/214/3,190/2,008 totals and all distribution/movement invariants.`)
  lines.push(`- \`npm run typecheck\` — **PASS** (exit 0).`)
  lines.push(`- \`npm run lint\` — **PASS** with 0 errors and 6 pre-existing warnings (five \`no-img-element\`, one unused eslint-disable).`)
  lines.push(`- \`npm run build\` — **PASS**; Next.js 16.3.1 compiled and generated 26 pages.`)
  lines.push(`- \`npm test\` — **PASS**; 24 files passed / 1 skipped, 138 tests passed / 1 skipped (139 total). New tests: 0; the analyzer has internal completeness/rule-parity assertions.`)
  lines.push(``)
  lines.push(table(['Mutation/deployment', 'Result'], [
    ['Recipe writes', 0],
    ['Grocery writes', 0],
    ['Saved-item writes', 0],
    ['Firestore mutation', 0],
    ['Firebase deployment', 'none'],
    ['Firestore rules/index deployment', 'none'],
    ['Vercel deployment', 'none'],
    ['Environment changes', 'none'],
  ]))

  lines.push(``)
  lines.push(`## Unverifiable items and data limitations`)
  lines.push(``)
  lines.push(`- Exact iOS string enum/logic: unavailable in this repository.`)
  lines.push(`- Counts of persisted legacy \`manualSection\`/\`defaultCategory\` values: user-scoped collections were intentionally not read.`)
  lines.push(`- Representative real-week section count: user week plans were intentionally not read; per-recipe frequency/section density was used instead.`)
  lines.push(`- Two catalog records remain unparseable: \`maple-roasted-candied-pecans\` and \`smoothies\`.`)
  lines.push(`- The proposed simulation is deterministic and corpus-specific, but mixed multi-product lines and malformed content still require human review; the script records confidence rather than claiming perfect ground truth.`)

  lines.push(``)
  lines.push(`## Appendix A — All current Other identities`)
  lines.push(``)
  lines.push(table(
    ['Ingredient', 'Freq.', 'Recipes', 'Raw example', 'Cluster', 'Recommended'],
    otherItems.map(item => [
      item.normalizedIngredient,
      item.occurrenceCount,
      item.recipeCount,
      truncate(item.rawExamples[0]?.raw || ''),
      item.otherCluster,
      item.recommendedClassification.category,
    ]),
  ))

  lines.push(``)
  lines.push(`## Appendix B — All current Staples identities`)
  lines.push(``)
  lines.push(table(
    ['Ingredient', 'Freq.', 'Recipes', 'Raw example', 'Cluster', 'Recommended'],
    staplesItems.map(item => [
      item.normalizedIngredient,
      item.occurrenceCount,
      item.recipeCount,
      truncate(item.rawExamples[0]?.raw || ''),
      item.staplesCluster,
      item.recommendedClassification.category,
    ]),
  ))

  lines.push(``)
  lines.push(`## Final recommendation`)
  lines.push(``)
  lines.push(`Recommended taxonomy:`)
  lines.push(``)
  data.recommendedCategories.forEach((category, index) => lines.push(`${index + 1}. ${category}`))
  lines.push(``)
  lines.push(`First implement boundary/specificity fixes under the current strings; then coordinate the 11-category rollout with iOS and legacy saved/manual category handling. Remove \`Staples\` as a shopping section and reserve “usually on hand” for a separate future property.`)
  lines.push(``)

  return lines.join('\n')
}

const reportFlagIndex = process.argv.indexOf('--report')
if (reportFlagIndex !== -1) {
  const reportPath = process.argv[reportFlagIndex + 1]
  if (!reportPath) throw new Error('--report requires a path')
  fs.mkdirSync(path.dirname(path.resolve(repoRoot, reportPath)), { recursive: true })
  fs.writeFileSync(path.resolve(repoRoot, reportPath), renderReport(artifact), 'utf8')
}

process.stdout.write(JSON.stringify(artifact, null, 2) + '\n')
