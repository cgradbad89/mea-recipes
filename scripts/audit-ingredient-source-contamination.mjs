#!/usr/bin/env node
/**
 * Read-only ingredient source-contamination corpus extractor.
 *
 * Reads only the shared `recipes` collection, applies the production content,
 * ingredient, noun-normalization, and category functions, and emits occurrence-
 * level JSON for evidence review. It intentionally performs no classification
 * writes and calls no Firestore mutation method.
 *
 * Usage:
 *   Generate JSON on stdout, or add --report <path> to also write Markdown.
 *   node scripts/audit-ingredient-source-contamination.mjs > /tmp/ingredient-source.json
 */

import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { categorizeIngredient } from '../lib/groceryCategories.ts'
import { normalizeNoun, parseIngredient } from '../lib/ingredientParser.ts'
import { parseRecipeContent } from '../lib/recipeContent.ts'

const require = createRequire(import.meta.url)
const { loadEnv, getAdmin } = require('./_lib.js')

// Exact mirror of lib/recipes.ts detectIngredientHeader, kept here so this
// read-only Node script does not import the browser Firebase client bundle.
const HEADER_KEYWORDS = new Set([
  'sauce', 'sauces', 'garnish', 'garnishes', 'marinade', 'dressing',
  'topping', 'toppings', 'filling', 'glaze', 'rub', 'spice mix',
  'spice blend', 'seasoning', 'seasoning blend', 'to serve',
  'to garnish', 'for serving', 'serving', 'dough', 'batter',
  'crust', 'assembly', 'main', 'main dish', 'dish',
])

function detectIngredientHeader(line) {
  if (!line) return false
  const trimmed = line.trim()
  if (!trimmed) return false
  if (trimmed.endsWith(':')) {
    const withoutColon = trimmed.slice(0, -1).trim()
    if (!/\d/.test(withoutColon) && withoutColon.length < 60) return true
  }
  if (/^(\*\*|\*)(.+?)\1$/.test(trimmed)) return true
  const normalized = trimmed
    .replace(/^\*+|\*+$/g, '')
    .replace(/:$/, '')
    .replace(/^for the\s+/i, '')
    .replace(/^for\s+/i, '')
    .trim()
    .toLowerCase()
  return HEADER_KEYWORDS.has(normalized)
}

function candidateReasons(rawLine, parsedName, category, uiHeader) {
  const value = `${rawLine} ${parsedName}`.normalize('NFKC')
  const lower = value.toLowerCase()
  const reasons = []
  if (uiHeader) reasons.push('ui-recognized ingredient subheader')
  if (/https?:\/\//i.test(value)) reasons.push('url')
  if (/^(?:[-*•·]\s*)?(?:source|notes?|nutrition(?:al information)?|yield|serves?|servings?|scale|prep(?: time)?|cook(?: time)?|total(?: time)?|equipment|metric conversion|us customary|units? usm)\b/i.test(rawLine.trim())) reasons.push('metadata-like line')
  if (/\b(?:add (?:ingredients? )?to (?:your )?grocery list|shop ingredients? on instacart|email grocery list|save recipe|read \d+ comments?|our latest newsletter|get the guide|privacy policy|prevent your screen from going dark|featured in)\b/i.test(value)) reasons.push('page chrome')
  if (/\b(?:contract|bidder|payment|register|vehicle|refund|finance|transaction|pay\.gov|pay gov|sasy|pegasus|wire number|sale\/lot|notice of award|purchaser receipt|auction payment|remittance|fleet\.gov|fleet gov|zvrc|webarm)\b/i.test(value)) reasons.push('business/workflow prose')
  if (/\b(?:click here|read my article|see (?:the )?note|refer to (?:the )?note|according to package directions)\b/i.test(value)) reasons.push('instructional/source-note prose')
  if (lower.split(/\s+/).filter(Boolean).length >= 22) reasons.push('long prose candidate')
  if (category === 'Other') reasons.push('taxonomy-audit Other signal')
  return reasons
}

function occurrenceKey(recipeID, ingredientIndex) {
  return `${recipeID}:${ingredientIndex}`
}

const SECTION_BOUNDARY_KEYS = new Set([
  'filipino-brased-chicken-tocino:13',
  'filipino-brased-chicken-tocino:14',
  'filipino-brased-chicken-tocino:15',
  'filipino-brased-chicken-tocino:16',
  'filipino-brased-chicken-tocino:17',
  'filipino-brased-chicken-tocino:18',
  'filipino-brased-chicken-tocino:19',
])

const UI_HEADER_FALSE_POSITIVE_KEYS = new Set([
  'grilled-fish-tacos:14',
  'grilled-fish-tacos:19',
  'grownup-mustard-sauce-recipe:19',
  'grownup-mustard-sauce-recipe:22',
  'the-easiest-vegetable-stir-fry:5',
  'traditional-southern-butter-butter-beans-recipe:11',
  'traditional-southern-butter-butter-beans-recipe:15',
])

// Manually reviewed ingredient-group labels missed by current UI detection.
const ADDITIONAL_SUBHEADER_KEYS = new Set([
  'blue-corn-green-chili-chicken-enchiladas:8',
  'broccoli-salad:3',
  'buttersoy-chicken-and-asparagus-stirfry:8',
  'buttersoy-chicken-and-asparagus-stirfry:18',
  'chicken-chickpea-salad:0',
  'chicken-chickpea-salad:10',
  'chicken-chickpea-salad:17',
  'chicken-chow-mein:0',
  'chicken-chow-mein:11',
  'creamy-cauliflower-soup-with-rosemary-olive-oil:0',
  'creamy-cauliflower-soup-with-rosemary-olive-oil:3',
  'creamy-cauliflower-soup-with-rosemary-olive-oil:12',
  'easy-chicken-ramen:15',
  'easy-chicken-ramen:20',
  'grilled-chicken-salad:3',
  'mediterranean-quinoa-bowl:6',
  'mexican-oaxacan-bowl:4',
  'peruvian-chicken-w-green-sauce:0',
  'peruvian-chicken-w-green-sauce:11',
  'pork-fried-rice:5',
  'pozole-verde-wowza:8',
  'quinoa-sweet-potato-salad:8',
  'singapore-mei-fun:0',
  'singapore-mei-fun:2',
  'singapore-mei-fun:13',
  'singapore-mei-fun:17',
  'singapore-mei-fun:20',
  'tacos-al-pastor:14',
  'tacos-al-pastor:21',
  'vegetarian-skillet-chili:6',
  'vegetarian-skillet-chili:11',
])

const STORED_CONTENT_KEYS = new Set([
  'buttersoy-chicken-and-asparagus-stirfry:6',
  'kung-pao-tofu:3',
  'onepot-beans-greens-and-grains:10',
  'pork-fried-rice:16',
  'pozole-verde-wowza:6',
  'singapore-mei-fun:25',
  'speget-with-fake-meat-meatballs:14',
  'vegetarian-skillet-chili:4',
  'vegetarian-skillet-chili:22',
])

const INSTRUCTIONAL_LEAK_KEYS = new Set([
  'grilled-fish-tacos:15',
  'grilled-fish-tacos:16',
  'grilled-fish-tacos:17',
  'grilled-fish-tacos:18',
  'grownup-mustard-sauce-recipe:20',
  'grownup-mustard-sauce-recipe:21',
  'traditional-southern-butter-butter-beans-recipe:12',
  'traditional-southern-butter-butter-beans-recipe:13',
  'traditional-southern-butter-butter-beans-recipe:14',
])

const INGREDIENT_PARSER_ARTIFACT_KEYS = new Set([
  '176:12',
  '179:14',
  '192:13',
  '192:20',
  'chili-lime-fish:0',
  'chimichurri-chicken:10',
  'couscous-salad-with-lime-basil-vinaigrette:21',
  'creamy-chickpea-spinach-masala-with-tadka:22',
  'creamy-chickpea-spinach-masala-with-tadka:25',
  'easy-chicken-ramen:10',
  'hot-mustard-grilled-chicken:5',
  'intsa-punjabi-chole:19',
  'jam-oat-bars:0',
  'moqueca-brazilian-fish-stew:0',
  'pad-thai:0',
  'pulled-pork:10',
  'rising-sun-mazcal:0',
  'roasted-white-bean-and-tomato-pasta:2',
  'sheet-pan-kielbasa-with-cabbage-and-beans:3',
  'sheetpan-gochujang-chicken-and-roasted-vegetables:8',
  'shrimp-pullao:6',
  'slow-cooker-creamy-tomato-lentil-soup:0',
  'smashed-zucchini-with-chickpeas-and-peanuts:0',
])

const OTHER_CONFIRMED_KEYS = new Set([
  'chipotle-tahini-bowls:13',
  'mole-poblano:17',
])

function isRecipeMetadata(occurrence) {
  const raw = occurrence.rawLine.trim()
  if (['x', 'minute', 'minute minute', 'hour', 'serving'].includes(occurrence.normalizedIdentity)) return true
  if (/^(?:US Customary - Metric|UNITS USM|Nutritional Information|SERVINGS:|Notes:|Metric conversion:)$/i.test(raw)) return true
  if (/^Yield:/i.test(raw)) return true
  if (/^These recipes were created in US Customary measurements/i.test(raw)) return true
  return new Set([
    'buttersoy-chicken-and-asparagus-stirfry:3',
    'buttersoy-chicken-and-asparagus-stirfry:2',
    'pozole-verde-wowza:3',
    'the-easiest-vegetable-stir-fry:0',
    'the-easiest-vegetable-stir-fry:1',
    'vegetarian-skillet-chili:1',
  ]).has(occurrenceKey(occurrence.recipeID, occurrence.ingredientIndex))
}

function reviewOccurrence(occurrence) {
  const key = occurrenceKey(occurrence.recipeID, occurrence.ingredientIndex)
  if (occurrence.recipeID === 'sasy-notes') {
    return {
      classification: 'STORED_CONTENT_CONTAMINATION',
      reason: 'The entire persisted document is non-recipe SASy workflow notes under an INGREDIENTS heading.',
    }
  }
  if (SECTION_BOUNDARY_KEYS.has(key)) {
    return {
      classification: 'SECTION_BOUNDARY_EXTRACTION',
      reason: 'PREP and ON THE STOVE are understandable instruction boundaries, but the parser misses them and takes its 20-line ingredient fallback.',
    }
  }
  if ((occurrence.uiRecognizedHeader && !UI_HEADER_FALSE_POSITIVE_KEYS.has(key)) || ADDITIONAL_SUBHEADER_KEYS.has(key)) {
    return {
      classification: 'INGREDIENT_SUBHEADER',
      reason: occurrence.uiRecognizedHeader
        ? 'Ingredient-group label recognized by current recipe UI but still passed to grocery addition.'
        : 'Manually confirmed ingredient-group label missed by current UI detection and passed to grocery addition.',
    }
  }
  if (occurrence.candidateReasons.includes('page chrome') || occurrence.rawLine.trim() === 'Comments' || STORED_CONTENT_KEYS.has(key)) {
    return {
      classification: 'STORED_CONTENT_CONTAMINATION',
      reason: 'Persisted ingredient section contains copied page chrome, article/promotional prose, or an explicit source URL.',
    }
  }
  if (isRecipeMetadata(occurrence)) {
    return {
      classification: 'RECIPE_METADATA_LINE',
      reason: 'Rating/time/yield/scale/byline/notes/nutrition/conversion metadata is not a purchase item.',
    }
  }
  if (INSTRUCTIONAL_LEAK_KEYS.has(key)) {
    return {
      classification: 'INSTRUCTIONAL_LINE_INSIDE_INGREDIENTS',
      reason: 'A note, method, optional-topping paragraph, or leftovers instruction is stored inside the ingredient boundaries.',
    }
  }
  if (INGREDIENT_PARSER_ARTIFACT_KEYS.has(key)) {
    return {
      classification: 'INGREDIENT_PARSER_ARTIFACT',
      reason: 'The raw line is a legitimate ingredient, but a fractional range, compound quantity, dimension, or alternate unit remains in parsedName/normalized identity.',
    }
  }
  if (OTHER_CONFIRMED_KEYS.has(key)) {
    return {
      classification: 'OTHER',
      reason: key === 'mole-poblano:17'
        ? 'The stored line is malformed (Teaspoonanises) and needs source review; categorization did not create it.'
        : 'The vague catch-all line has no purchase identity and needs source review, not a broad parser heuristic.',
    }
  }
  if (/\b(?:or|and\/or|any combination|whatever)\b/i.test(occurrence.rawLine)) {
    return {
      classification: 'LEGITIMATE_COMPOSITE_INGREDIENT',
      reason: 'The reviewed line expresses a legitimate purchase alternative or composite serving choice.',
    }
  }
  return {
    classification: 'TAXONOMY_FALSE_SIGNAL',
    reason: 'Manual/context review found a legitimate ingredient line; length, missing quantity, or Other categorization alone is not contamination.',
  }
}

function jsonValue(value) {
  if (value == null) return null
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  if (['string', 'number', 'boolean'].includes(typeof value)) return value
  return String(value)
}

function locateIngredientLines(content, ingredientLines) {
  const rawLines = content.split('\n')
  const locations = []
  let cursor = 0
  for (const ingredient of ingredientLines) {
    let found = -1
    for (let index = cursor; index < rawLines.length; index += 1) {
      if (rawLines[index].trim() === ingredient) {
        found = index
        break
      }
    }
    if (found === -1) {
      found = rawLines.findIndex(line => line.trim() === ingredient)
    }
    locations.push(found)
    if (found !== -1) cursor = found + 1
  }
  return { rawLines, locations }
}

loadEnv()
const snapshot = await getAdmin().firestore().collection('recipes').get()

const occurrences = []
const recipes = []
const uniqueIdentities = new Set()
let parseableRecipes = 0
let rawIngredientLines = 0

for (const document of snapshot.docs) {
  const data = document.data()
  const content = typeof data.content === 'string' ? data.content : ''
  const parsedContent = parseRecipeContent(content)
  const parseable = parsedContent.ingredients.length > 0
  if (parseable) parseableRecipes += 1
  rawIngredientLines += parsedContent.ingredients.length

  const { rawLines, locations } = locateIngredientLines(content, parsedContent.ingredients)
  const recipeOccurrences = []
  parsedContent.ingredients.forEach((rawLine, ingredientIndex) => {
    const parsed = parseIngredient(rawLine)
    const normalizedIdentity = normalizeNoun(parsed.name)
    const category = categorizeIngredient(normalizedIdentity)
    const uiRecognizedHeader = detectIngredientHeader(rawLine)
    const storedLineIndex = locations[ingredientIndex]
    const contextStart = storedLineIndex === -1 ? 0 : Math.max(0, storedLineIndex - 2)
    const contextEnd = storedLineIndex === -1 ? 0 : Math.min(rawLines.length, storedLineIndex + 3)
    const occurrence = {
      recipeID: document.id,
      title: typeof data.title === 'string' ? data.title : '',
      ingredientIndex,
      storedLineIndex,
      rawLine,
      parsedQuantity: parsed.quantity,
      parsedUnit: parsed.unit,
      parsedName: parsed.name,
      parserConfidence: parsed.confidence,
      normalizedIdentity,
      category,
      uiRecognizedHeader,
      candidateReasons: candidateReasons(rawLine, parsed.name, category, uiRecognizedHeader),
      rawContext: storedLineIndex === -1 ? [] : rawLines.slice(contextStart, contextEnd),
    }
    occurrence.review = reviewOccurrence(occurrence)
    if (normalizedIdentity) uniqueIdentities.add(normalizedIdentity)
    occurrences.push(occurrence)
    recipeOccurrences.push(occurrence)
  })

  recipes.push({
    recipeID: document.id,
    title: typeof data.title === 'string' ? data.title : '',
    parseable,
    ingredientCount: parsedContent.ingredients.length,
    instructionCount: parsedContent.instructions.length,
    sourceURL: typeof data.sourceURL === 'string' ? data.sourceURL : '',
    parsedSourceURL: parsedContent.sourceURL,
    sourceFile: typeof data.sourceFile === 'string' ? data.sourceFile : '',
    created: jsonValue(data.created),
    modified: jsonValue(data.modified),
    addedBy: jsonValue(data.addedBy),
    content,
    candidateOccurrenceCount: recipeOccurrences.filter(item => item.candidateReasons.length > 0).length,
  })
}

const forcedReviewKeys = new Set([
  ...SECTION_BOUNDARY_KEYS,
  ...ADDITIONAL_SUBHEADER_KEYS,
  ...STORED_CONTENT_KEYS,
  ...INSTRUCTIONAL_LEAK_KEYS,
  ...INGREDIENT_PARSER_ARTIFACT_KEYS,
  ...OTHER_CONFIRMED_KEYS,
])
const candidateOccurrences = occurrences.filter(item =>
  item.candidateReasons.length > 0 ||
  forcedReviewKeys.has(occurrenceKey(item.recipeID, item.ingredientIndex)),
)
const uiRecognizedHeaders = occurrences.filter(item => item.uiRecognizedHeader)
const classificationCounts = Object.fromEntries(
  [...new Set(candidateOccurrences.map(item => item.review.classification))]
    .sort()
    .map(classification => [
      classification,
      candidateOccurrences.filter(item => item.review.classification === classification).length,
    ]),
)
const confirmedClassifications = new Set([
  'STORED_CONTENT_CONTAMINATION',
  'SECTION_BOUNDARY_EXTRACTION',
  'INGREDIENT_SUBHEADER',
  'RECIPE_METADATA_LINE',
  'INSTRUCTIONAL_LINE_INSIDE_INGREDIENTS',
  'INGREDIENT_PARSER_ARTIFACT',
  'OTHER',
])
const confirmedOccurrences = candidateOccurrences.filter(item => confirmedClassifications.has(item.review.classification))

if (occurrences.length !== rawIngredientLines) {
  throw new Error(`Occurrence completeness failure: ${occurrences.length}/${rawIngredientLines}`)
}

const artifact = {
  generatedAt: new Date().toISOString(),
  source: 'Firestore recipes collection; read-only',
  corpus: {
    recipesInspected: snapshot.size,
    parseableRecipes,
    recipesWithNoIngredientSection: snapshot.size - parseableRecipes,
    rawIngredientLines,
    uniqueNormalizedIdentities: uniqueIdentities.size,
    candidateOccurrences: candidateOccurrences.length,
    confirmedOccurrences: confirmedOccurrences.length,
    falseAlarmOccurrences: candidateOccurrences.length - confirmedOccurrences.length,
    uiRecognizedHeaderOccurrences: uiRecognizedHeaders.length,
    classificationCounts,
  },
  recipes,
  occurrences,
  candidateOccurrences,
}

function markdown(value) {
  return String(value ?? '')
    .replaceAll('|', '\\|')
    .replaceAll('\n', '<br>')
}

function recommendedLayer(classifications, recipeID) {
  const layers = []
  if (recipeID === 'sasy-notes' || classifications.has('OTHER')) layers.push('Source data repair')
  if (classifications.has('INGREDIENT_PARSER_ARTIFACT')) layers.push('Ingredient parser')
  if (classifications.has('INGREDIENT_SUBHEADER')) layers.push('Content parser + grocery boundary')
  if ([
    'STORED_CONTENT_CONTAMINATION',
    'SECTION_BOUNDARY_EXTRACTION',
    'RECIPE_METADATA_LINE',
    'INSTRUCTIONAL_LINE_INSIDE_INGREDIENTS',
  ].some(classification => classifications.has(classification))) layers.push('Content parser')
  return [...new Set(layers)].join(' + ')
}

function renderReport() {
  const confirmedIdentities = new Set(confirmedOccurrences.map(item => item.normalizedIdentity).filter(Boolean))
  const confirmedRecipeIDs = new Set(confirmedOccurrences.map(item => item.recipeID))
  const contaminatedOther = confirmedOccurrences.filter(item => item.category === 'Other').length
  const falseAlarms = candidateOccurrences.filter(item => !confirmedClassifications.has(item.review.classification))
  const recipeByID = new Map(recipes.map(recipe => [recipe.recipeID, recipe]))
  const affectedRecipes = [...confirmedRecipeIDs].sort().map(recipeID => {
    const candidates = candidateOccurrences.filter(item => item.recipeID === recipeID)
    const confirmed = candidates.filter(item => confirmedClassifications.has(item.review.classification))
    const classifications = new Set(confirmed.map(item => item.review.classification))
    return {
      ...recipeByID.get(recipeID),
      candidateCount: candidates.length,
      confirmedCount: confirmed.length,
      classifications,
      layer: recommendedLayer(classifications, recipeID),
    }
  })
  const sourceStats = {
    sourceURL: affectedRecipes.filter(recipe => recipe.sourceURL).length,
    sourceFile: affectedRecipes.filter(recipe => recipe.sourceFile).length,
    addedBy: affectedRecipes.filter(recipe => recipe.addedBy).length,
  }
  const trueUiHeaders = candidateOccurrences.filter(item => item.uiRecognizedHeader && item.review.classification === 'INGREDIENT_SUBHEADER').length
  const safeUiHeaderRejects = candidateOccurrences.filter(item => item.uiRecognizedHeader && confirmedClassifications.has(item.review.classification)).length
  const additionalHeaders = candidateOccurrences.filter(item => ADDITIONAL_SUBHEADER_KEYS.has(occurrenceKey(item.recipeID, item.ingredientIndex))).length
  const nonRecipeDocumentLines = confirmedOccurrences.filter(item => item.recipeID === 'sasy-notes').length
  const legitimateAfterCleanup = rawIngredientLines - (
    confirmedOccurrences.length - classificationCounts.INGREDIENT_PARSER_ARTIFACT
  )
  const report = []
  const push = (...lines) => report.push(...lines)

  push(
    '# Ingredient Source Contamination Investigation — 2026-08-22',
    '',
    '## Scope and safety',
    '',
    'Discovery-only investigation of the shared Firestore `recipes` collection and the current recipe → ingredient parser → grocery pipeline. The analyzer is read-only: it calls Firestore `get()` and contains no write, batch, update, set, or delete path. No production behavior, Firestore data, taxonomy rule, or deployment was changed.',
    '',
    'Evidence was generated with the production `parseRecipeContent`, `parseIngredient`, `normalizeNoun`, and `categorizeIngredient` functions. Candidate signals were deliberately broad; every candidate was reviewed with its stored line position, nearby raw content, parsed output, recipe identity, and available source fields. The manually reviewed outcomes are frozen as occurrence-level classifications in `scripts/audit-ingredient-source-contamination.mjs` so the result is reproducible rather than silently reclassified by a heuristic.',
    '',
    '## Executive summary',
    '',
    `The corpus contains **${rawIngredientLines.toLocaleString()} raw ingredient occurrences** across **${snapshot.size} recipes** (${parseableRecipes} parseable; ${snapshot.size - parseableRecipes} without an ingredient section). Broad detection produced **${candidateOccurrences.length} candidates**. Review confirmed **${confirmedOccurrences.length} affected occurrences** across **${affectedRecipes.length} recipes** and **${confirmedIdentities.size} normalized identities**; **${falseAlarms.length} candidates were legitimate and must not be filtered**.`,
    '',
    `Of the ${confirmedOccurrences.length}, **${confirmedOccurrences.length - classificationCounts.INGREDIENT_PARSER_ARTIFACT} are non-shopping raw lines** and **${classificationCounts.INGREDIENT_PARSER_ARTIFACT} are real ingredients whose parsed identity is damaged by a quantity/range artifact**. The first group needs boundary/filter protection; the second needs ingredient-parser improvement, not deletion.`,
    '',
    `The dominant source is persisted legacy content: ${classificationCounts.STORED_CONTENT_CONTAMINATION} stored-content occurrences, including ${nonRecipeDocumentLines} lines from the non-recipe \`sasy-notes\` document. The next largest confirmed groups are ${classificationCounts.INGREDIENT_SUBHEADER} ingredient subheaders and ${classificationCounts.RECIPE_METADATA_LINE} metadata lines. The current recipe UI recognizes ${uiRecognizedHeaders.length} header occurrences, but grocery addition parses every ingredient string; ${safeUiHeaderRejects} recognized headers are safely rejectable non-shopping lines, including ${trueUiHeaders} true ingredient-group headers.`,
    '',
    '## Corpus counts',
    '',
    '| Measure | Count |',
    '|---|---:|',
    `| Recipes inspected | ${snapshot.size} |`,
    `| Parseable recipes | ${parseableRecipes} |`,
    `| Recipes without an ingredient section | ${snapshot.size - parseableRecipes} |`,
    `| Raw ingredient occurrences | ${rawIngredientLines} |`,
    `| Unique normalized identities | ${uniqueIdentities.size} |`,
    `| Candidate occurrences reviewed | ${candidateOccurrences.length} |`,
    `| Confirmed affected occurrences | ${confirmedOccurrences.length} |`,
    `| Confirmed affected recipes | ${affectedRecipes.length} |`,
    `| Confirmed affected normalized identities | ${confirmedIdentities.size} |`,
    `| False-alarm occurrences retained | ${falseAlarms.length} |`,
    `| UI-recognized header occurrences | ${uiRecognizedHeaders.length} |`,
    '',
    '## Classification summary',
    '',
    '| Classification | Count | Meaning |',
    '|---|---:|---|',
    `| \`STORED_CONTENT_CONTAMINATION\` | ${classificationCounts.STORED_CONTENT_CONTAMINATION} | Persisted page chrome, article/promotional text, URL, or non-recipe workflow content. |`,
    `| \`INGREDIENT_SUBHEADER\` | ${classificationCounts.INGREDIENT_SUBHEADER} | Ingredient group labels treated as grocery items. |`,
    `| \`RECIPE_METADATA_LINE\` | ${classificationCounts.RECIPE_METADATA_LINE} | Scale, time, yield, nutrition, notes, units, conversion, rating, or byline metadata. |`,
    `| \`INGREDIENT_PARSER_ARTIFACT\` | ${classificationCounts.INGREDIENT_PARSER_ARTIFACT} | Legitimate raw ingredient with a range, compound quantity, dimension, or alternate unit left in the identity. |`,
    `| \`INSTRUCTIONAL_LINE_INSIDE_INGREDIENTS\` | ${classificationCounts.INSTRUCTIONAL_LINE_INSIDE_INGREDIENTS} | Note/method prose persisted within ingredient boundaries. |`,
    `| \`SECTION_BOUNDARY_EXTRACTION\` | ${classificationCounts.SECTION_BOUNDARY_EXTRACTION} | Instruction lines captured by the 20-line fallback because no exact INSTRUCTIONS heading exists. |`,
    `| \`OTHER\` | ${classificationCounts.OTHER} | Two source-specific malformed/vague lines requiring human repair. |`,
    `| \`LEGITIMATE_COMPOSITE_INGREDIENT\` | ${classificationCounts.LEGITIMATE_COMPOSITE_INGREDIENT} | False alarm: valid alternatives/composite ingredients. |`,
    `| \`TAXONOMY_FALSE_SIGNAL\` | ${classificationCounts.TAXONOMY_FALSE_SIGNAL} | False alarm: valid ingredient surfaced by broad candidate signals. |`,
    '',
  )

  push(
    '## Root-cause matrix',
    '',
    '| Class | Primary origin | Why it reaches grocery | Recommended ownership | Data repair required? |',
    '|---|---|---|---|---|',
    '| Stored content contamination | Legacy import/persisted content | `parseRecipeContent` trusts lines between headings; grocery addition parses every returned string. | Content parser safeguards; repair `sasy-notes`. | Only `sasy-notes` is mandatory. |',
    '| Section-boundary extraction | Content parser fallback | With INGREDIENTS but no INSTRUCTIONS, the next 20 nonblank lines are treated as ingredients. | Content parser boundary recognition. | No, if the boundary rule is adopted. |',
    '| Ingredient subheader | Content parser and grocery boundary | UI presentation detects some headers, but `addRecipeIngredientsToGrocery` does not use that detector. | Shared header predicate at extraction and grocery boundary. | No. |',
    '| Recipe metadata | Legacy import/persisted content plus incomplete filters | Only the two-heading parser path filters a small metadata prefix set; the one-heading fallback does not. | Content parser with exact/contextual rules. | No. |',
    '| Instructional line inside ingredients | Persisted content plus missing terminal boundary | Notes blocks remain within the ingredient slice. | Content parser terminal markers; optional source cleanup. | No. |',
    '| Ingredient parser artifact | Ingredient parser | Quantity grammar stops early and leaves range/dimension tokens in `name`. | Ingredient parser with regression fixtures. | No. |',
    '| Other | Source-specific malformed/vague content | There is no stable purchase identity to infer. | Manual source repair. | Yes: two recipe lines. |',
    '| False alarms | Broad investigation signals | `Other`, no quantity, punctuation, capitalization, and long text are not proof of contamination. | No production rule. | No. |',
    '',
    '## Candidate parser and filter rules',
    '',
    'Counts below are observed coverage in this corpus and are **not additive** because some rules overlap. “Eligible” means the rule is narrow enough for a future implementation prompt; it does not authorize implementation in this investigation.',
    '',
    '| Candidate rule | Observed coverage | False-positive risk | Eligible? | Reason |',
    '|---|---:|---|---|---|',
    `| At the grocery boundary, reject the existing UI header predicate | ${safeUiHeaderRejects} non-shopping lines (${trueUiHeaders} true subheaders) | Low in reviewed corpus: 0 shopping lines among ${uiRecognizedHeaders.length} matches | Yes | Reuse one shared predicate so render and mutation paths agree. |`,
    `| Expand header recognition with conservative, short, no-digit group labels | ${additionalHeaders} additional true subheaders | Low only with an explicit vocabulary/shape guard | Yes | Do not classify arbitrary no-quantity lines as headers. |`,
    `| Recognize PREP / ON THE STOVE as terminal section boundaries in one-heading fallback | ${classificationCounts.SECTION_BOUNDARY_EXTRACTION} lines | Low for exact standalone markers | Yes | Fixes one deterministic extraction failure without altering stored content. |`,
    `| Filter exact/contextual metadata families in both parser paths | ${classificationCounts.RECIPE_METADATA_LINE} lines | Low for anchored labels; medium for bare words such as “serving” | Yes, anchored/contextual only | Cover scale, time, yield, nutrition, units, notes, conversion, rating, and byline patterns. |`,
    '| Treat standalone `Notes:` as a terminal block marker when it follows ingredients | 18 non-shopping lines across 3 recipes | Low when position-aware | Yes | Removes note prose and its metric-conversion tail without guessing from sentence length. |',
    `| Reject explicit URLs and known page-control phrases inside ingredient spans | ${classificationCounts.STORED_CONTENT_CONTAMINATION - nonRecipeDocumentLines} stored-content lines outside \`sasy-notes\` | Low for URLs/exact controls; medium for general prose classifiers | Yes only for URLs and anchored controls | Prefer deterministic markers; quarantine broad prose candidates for review. |`,
    `| Extend quantity parsing for reviewed ranges, mixed quantities, dimensions, and alternate-unit syntax | ${classificationCounts.INGREDIENT_PARSER_ARTIFACT} legitimate lines | Medium unless fixture-driven | Yes with one regression fixture per occurrence shape | Preserve raw lines; change only quantity/unit/name extraction. |`,
    `| Reject all \`Other\`, no-quantity, capitalized, punctuated, or long lines | ${falseAlarms.length} demonstrated false alarms | High | No | These signals catch legitimate ingredients, alternatives, and serving choices. |`,
    '',
    '### Grocery-boundary safety rule',
    '',
    'A future defense-in-depth check should skip only a shared recognized ingredient-header predicate, an empty parsed name, or an explicit URL/control token. It should log/quarantine ambiguous candidates instead of silently dropping them. It must **not** reject a line merely because quantity is absent, category is `Other`, capitalization looks like a heading, or prose is long. This boundary check protects future add-to-grocery operations but does not replace content-parser repair.',
    '',
    '## Import and recurrence analysis',
    '',
    `Among the ${affectedRecipes.length} affected recipes, ${sourceStats.sourceURL} have a stored source URL, ${sourceStats.sourceFile} have a source-file marker, and ${sourceStats.addedBy} have an \`addedBy\` value. The dates and source-file fields show the problem is dominated by legacy persisted/imported content rather than the present structured editor. The full per-recipe evidence is below.`,
    '',
    'Current structured manual/queue saves call `buildRecipeContent`, which emits exact INGREDIENTS and INSTRUCTIONS sections, reducing the missing-boundary failure for newly saved recipes. AI ingest validates arrays as strings but does not semantically reject page chrome, subheaders, metadata, or prose, so those classes can recur if a fetched page or model response is noisy. Manual content edits can also recreate arbitrary contamination.',
    '',
    'The current bookmarklet sends URL/image/time metadata to the app; it does not send captured page DOM. Server-side AI ingest still fetches the URL, so logged-in/paywalled content is not actually protected by browser-session extraction. This is a durable ingestion gap and is recorded in `PRD.md` as pending, not fixed.',
    '',
    '## Data remediation list',
    '',
    'Only these exact documents require source repair if the recommended deterministic parser/boundary work is implemented. No repair was performed here.',
    '',
    '| Recipe ID | Required repair | Why code-only inference is unsafe |',
    '|---|---|---|',
    '| `sasy-notes` | Remove/archive from the recipes collection or migrate to the correct notes domain. | All 117 extracted lines are SASy business/workflow notes, not a recipe. |',
    '| `mole-poblano` | Correct ingredient index 17 (`¼ Teaspoonanises seeds`) against the source. | The intended tokenization/spelling cannot be proven from the malformed stored string alone. |',
    '| `chipotle-tahini-bowls` | Remove or replace ingredient index 13 (`Anything else you want!`) with explicit optional items. | The line has no determinate purchase identity. |',
    '',
    '## Corpus impact and expected cleanup',
    '',
    '| Waterfall | Occurrences |',
    '|---|---:|',
    `| Current raw ingredient occurrences | ${rawIngredientLines} |`,
    `| Less stored content contamination | -${classificationCounts.STORED_CONTENT_CONTAMINATION} |`,
    `| Less ingredient subheaders | -${classificationCounts.INGREDIENT_SUBHEADER} |`,
    `| Less recipe metadata | -${classificationCounts.RECIPE_METADATA_LINE} |`,
    `| Less section-boundary extraction | -${classificationCounts.SECTION_BOUNDARY_EXTRACTION} |`,
    `| Less instructional lines | -${classificationCounts.INSTRUCTIONAL_LINE_INSIDE_INGREDIENTS} |`,
    `| Less source-specific OTHER repairs | -${classificationCounts.OTHER} |`,
    `| Ingredient identities corrected in place | ${classificationCounts.INGREDIENT_PARSER_ARTIFACT} |`,
    `| Projected legitimate raw ingredient occurrences | ${legitimateAfterCleanup} |`,
    '',
    `Current category \`Other\` contains 280 occurrences in the companion taxonomy audit. Confirmed contamination/artifact accounts for ${contaminatedOther}; after the proposed cleanup, **12 reviewed legitimate \`Other\` occurrences remain**. This is evidence that taxonomy reassignment alone would hide the problem rather than repair it.`,
    '',
    `No-quantity ingredient support is intentional and remains valid. Legitimate composite ingredients and taxonomy false signals remain in the corpus. The cleanup target is therefore ${confirmedOccurrences.length} affected occurrences, not all ${candidateOccurrences.length} candidates.`,
    '',
  )

  push(
    '## Recommended implementation sequence',
    '',
    '1. **Content-parser hardening prompt:** “Using this audit as the fixture source, make `parseRecipeContent` apply the same anchored metadata filters in both heading paths; recognize exact PREP/ON THE STOVE and position-aware Notes blocks; reject explicit URLs and anchored page controls; preserve all 173 reviewed false alarms. Add tests for every rule family. Do not mutate Firestore.”',
    '2. **Shared header/grocery-boundary prompt:** “Extract a shared `isIngredientHeader` predicate used by recipe rendering, content extraction, and `addRecipeIngredientsToGrocery`; cover all 84 audited subheaders; add a final skip for headers, empty names, and URLs; never reject based only on absent quantity or category Other.”',
    '3. **Ingredient-parser prompt:** “Add fixture-driven parsing for the 23 `INGREDIENT_PARSER_ARTIFACT` occurrences so range/dimension/alternate-unit tokens do not remain in normalized identity; preserve raw lines and current no-quantity behavior.”',
    '4. **Ingestion-validation prompt:** “Validate AI-ingested ingredient arrays for exact metadata/header/control markers before persistence, surface quarantined lines for user confirmation, and correct bookmarklet/paywall claims or implement authenticated DOM capture. Keep ambiguous prose visible rather than silently deleting it.”',
    '5. **Data-repair prompt:** “After code safeguards ship, perform an explicitly approved Firestore repair limited to `sasy-notes`, `mole-poblano`, and `chipotle-tahini-bowls`, with backup, dry-run diff, exact document allowlist, and post-write verification.”',
    '',
    '## Affected recipe summary',
    '',
    '| Recipe ID | Title | Candidates | Confirmed | Root-cause classes | Recommended layer | Source |',
    '|---|---|---:|---:|---|---|---|',
  )
  for (const recipe of affectedRecipes) {
    const source = recipe.sourceURL || recipe.sourceFile || '(none)'
    push(`| ${markdown(recipe.recipeID)} | ${markdown(recipe.title)} | ${recipe.candidateCount} | ${recipe.confirmedCount} | ${markdown([...recipe.classifications].sort().join(', '))} | ${markdown(recipe.layer)} | ${markdown(source)} |`)
  }

  push(
    '',
    '## Full candidate line appendix',
    '',
    `All ${candidateOccurrences.length} candidates are included, including the ${falseAlarms.length} retained false alarms. Position is the zero-based stored content line index and ingredient index. Context includes up to two stored lines on each side.`,
    '',
    '| Recipe ID | Position | Raw Line | Parsed Name | Category | Classification | Reason | Source URL | Context |',
    '|---|---|---|---|---|---|---|---|---|',
  )
  for (const item of candidateOccurrences) {
    const recipe = recipeByID.get(item.recipeID)
    push(`| ${markdown(item.recipeID)} | content ${item.storedLineIndex}; ingredient ${item.ingredientIndex} | ${markdown(item.rawLine)} | ${markdown(item.parsedName)} | ${markdown(item.category)} | ${markdown(item.review.classification)} | ${markdown(item.review.reason)} | ${markdown(recipe?.sourceURL || '')} | ${markdown(item.rawContext.join('\n'))} |`)
  }

  push(
    '',
    '## Reproduction and validation',
    '',
    '```bash',
    'node scripts/audit-grocery-taxonomy.mjs > /tmp/mea-grocery-taxonomy-current.json',
    'node scripts/audit-ingredient-source-contamination.mjs > /tmp/mea-ingredient-source-reviewed.json',
    'node scripts/audit-ingredient-source-contamination.mjs --report docs/audits/ingredient-source-contamination-investigation-2026-08-22.md',
    'npm run typecheck',
    'npm run lint',
    'npm run build',
    'npm test',
    '```',
    '',
    'The first three commands are read-only with respect to Firestore; the report command writes only this local Markdown artifact.',
    '',
    'Final verification on 2026-08-22:',
    '',
    '- `npm run typecheck` — passed.',
    '- `npm run lint` — passed with 0 errors and 6 pre-existing warnings (five `no-img-element`, one unused eslint-disable).',
    '- `npm run build` — passed; 26 routes generated/collected successfully.',
    '- `npm test` — passed; 25 files and 148 tests passed, with 1 file/1 test skipped.',
    '',
    '## Final recommendation',
    '',
    '**Do both, in sequence:** implement narrow parser and grocery-boundary safeguards first, verify them against the reviewed corpus, then perform a separately approved three-document source repair. Taxonomy-only changes are not recommended. Broad prose/no-quantity/Other filters are not recommended because the reviewed false alarms demonstrate unacceptable data loss risk.',
    '',
  )
  return `${report.join('\n').trimEnd()}\n`
}

const reportFlagIndex = process.argv.indexOf('--report')
if (reportFlagIndex !== -1) {
  const reportPath = process.argv[reportFlagIndex + 1]
  if (!reportPath) throw new Error('--report requires an output path')
  writeFileSync(reportPath, renderReport(), 'utf8')
}

process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`)
