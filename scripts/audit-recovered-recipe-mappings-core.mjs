import { createHash } from 'node:crypto'

export const REPAIR_WAVES = Object.freeze({
  WAVE_1A: Object.freeze([
    'chicken-fajitas',
    'chicken-paprikash',
    'chicken-tacos-w-pineapple',
    'chimichurri-chicken',
    'chinese-chili-oil',
    'crazy-good-dal-adas-spicy-red-lentil-tamarind-soup',
    'crisp-gnocchi-with-brussels-sprouts-and-brown-butter',
    'crispy-gnocchi-with-burst-tomatoes-and-mozzarella',
    'crispy-gnocchi-with-sausage-and-broccoli',
    'crunchy-queso-wrap',
    'curried-red-bean-soup-with-kale',
    'curry-tomatoes-and-chickpeas-with-cucumber-yogurt',
    'filipino-brased-chicken-tocino',
    'huevos-rotos-broken-eggs',
    'kung-pao-tofu',
    'onepot-chicken-and-lentil',
    'onepot-chicken-and-rice-with-caramelized-lemon',
    'onepot-ratatouille-pasta',
    'peanut-butter-oat-protein-shake',
    'pearl-couscous-with-creamy-feta-and-chickpeas-meh',
    'peruvian-chicken-w-green-sauce',
    'peruvian-roasted-chicken-with-spicy-cilantro-sauce',
    'pozole-verde-wowza',
    'roasted-white-bean-and-tomato-pasta',
    'sheetpan-gochujang-chicken-and-roasted-vegetables',
    'spicy-ovenfried-rice-with-gochujang-and-fried-eggs',
    'vegetarian-skillet-chili',
    'zibdiyit-gambari-spicy-shrimp-and-tomato-stew',
  ]),
  WAVE_2: Object.freeze([
    'chicken-enchiladas',
    'chicken-stew',
    'couscous-salad-with-lime-basil-vinaigrette',
    'creamy-cauliflower-soup-with-rosemary-olive-oil',
    'pepper-steak',
    'pork-fried-rice',
  ]),
  WAVE_3: Object.freeze([
    'chana-masala',
    'dads-chili',
    'easy-chicken-ramen',
    'lemon-herb-pasta-salad-with-marinated-chickpeas',
    'lemongrass-chicken',
    'mole-poblano',
    'tuscan-bean-soup',
  ]),
})

export const UNRESOLVED_RECIPE_IDS = Object.freeze([
  'chipotle-tahini-bowls',
  'maple-roasted-candied-pecans',
  'mexican-street-corn',
  'rising-sun-mazcal',
  'smoothies',
  'spaghetti-carbonara',
  'speget-with-fake-meat-meatballs',
  'zesty-quinoa-salad',
])

export const AUTHORIZED_RECIPE_IDS = Object.freeze(Object.values(REPAIR_WAVES).flat())

export const EXPECTED_CONFIGURATION = Object.freeze({
  schemaVersion: 1,
  parserVersion: 'recipe-content-v1',
  deterministicEngineVersion: 'deterministic-v4',
  hybridEngineVersion: 'hybrid-v4',
  promptVersion: 'v2',
  model: 'openai/gpt-5.6-luna',
  temperature: 0,
})

const URL = /^https?:\/\/\S+$/i
const PAGE_CHROME = /^(?:add (?:ingredients? )?to (?:your )?grocery list|shop ingredients? on instacart|email grocery list|save recipe|cook mode prevent your screen from going dark|make the recipe with us|on off)$/i
const REVIEW = /^(?:have you cooked this\?|cooking notes$|comments?$|reviews?$|reader notes|ratings?|most helpful\d*$|\d+ this is helpful$|.{1,80}\d+\s+years? ago$)/i
const METADATA = /^(?:storage(?: suggestions?)?:|nutrition(?:al information| estimate)?:|recipe source:|yield:|prep time:|cook time:|total time:)/i

export function assertAuthorizedPopulation(ids = AUTHORIZED_RECIPE_IDS) {
  const unique = new Set(ids)
  if (REPAIR_WAVES.WAVE_1A.length !== 28 || REPAIR_WAVES.WAVE_2.length !== 6 || REPAIR_WAVES.WAVE_3.length !== 7) {
    throw new Error('Repair-wave population must remain 28 + 6 + 7.')
  }
  if (ids.length !== 41 || unique.size !== 41) throw new Error('Recovered mapping population must contain exactly 41 unique recipe IDs.')
  const admittedUnresolved = UNRESOLVED_RECIPE_IDS.filter(recipeId => unique.has(recipeId))
  if (admittedUnresolved.length) throw new Error(`Unresolved recipes admitted: ${admittedUnresolved.join(', ')}`)
  return true
}

export function repairWaveFor(recipeId) {
  for (const [wave, ids] of Object.entries(REPAIR_WAVES)) if (ids.includes(recipeId)) return wave
  return null
}

export function classifyRecoveredSource({ content, parsed, evidence }) {
  if (typeof content !== 'string' || content.trim().length === 0) return { status: 'SOURCE_UNSAFE', reason: 'Missing live content.' }
  if (!Array.isArray(parsed?.ingredients) || parsed.ingredients.length === 0) return { status: 'SOURCE_UNSAFE', reason: 'Parsed ingredient array is empty.' }
  if (!Array.isArray(parsed?.instructions) || parsed.instructions.length === 0) return { status: 'SOURCE_UNSAFE', reason: 'Parsed instruction array is empty.' }
  const contamination = [...parsed.ingredients, ...parsed.instructions]
    .map((text, index) => ({ text: String(text).trim(), index }))
    .filter(item => URL.test(item.text) || PAGE_CHROME.test(item.text) || REVIEW.test(item.text) || METADATA.test(item.text))
  if (contamination.length) return { status: 'SOURCE_UNSAFE', reason: 'Parsed Cooking Mode content contains audited contamination.', contamination }
  if (!evidence?.matches) return { status: evidence?.reviewable ? 'SOURCE_CHANGED_REVIEWABLE' : 'SOURCE_UNSAFE', reason: evidence?.reason || 'Live source does not match repair evidence.' }
  return { status: 'SOURCE_CLEAN', reason: null, contamination: [] }
}

export function deterministicReviewGate(reviews) {
  const references = reviews.flatMap(row => row.references || [])
  const omissions = reviews.flatMap(row => row.omissions || [])
  return {
    recipesReviewed: reviews.length,
    mappedReferencesReviewed: references.length,
    safeMappings: references.filter(item => item.classification === 'SAFE_MAPPING').length,
    safeOmissions: omissions.filter(item => item.classification === 'SAFE_OMISSION').length,
    falsePositiveMappings: references.filter(item => item.classification === 'FALSE_POSITIVE').length,
    falsePositiveRecipes: reviews.filter(row => (row.references || []).some(item => item.classification === 'FALSE_POSITIVE')).length,
    pending: [...references, ...omissions].filter(item => item.classification === 'PENDING').length,
  }
}

export function aiReviewGate(reviews) {
  return {
    reviewed: reviews.length,
    correct: reviews.filter(item => item.classification === 'CORRECT').length,
    ambiguous: reviews.filter(item => item.classification === 'AMBIGUOUS').length,
    incorrect: reviews.filter(item => item.classification === 'INCORRECT').length,
    pending: reviews.filter(item => item.classification === 'PENDING').length,
  }
}

export function readyRecoveredManifestInvariant(row) {
  return row.classification !== 'READY' || (
    row.precondition?.currentMapAbsent === true &&
    typeof row.sourceHash === 'string' && /^[a-f0-9]{64}$/.test(row.sourceHash) &&
    row.precondition?.contentSourceHash === row.sourceHash &&
    row.candidateMap?.sourceHash === row.sourceHash &&
    row.audit?.candidateValidation?.valid === true &&
    row.semanticReview?.deterministicSafe === true &&
    row.semanticReview?.aiAmbiguous === 0 &&
    row.semanticReview?.aiIncorrect === 0 &&
    !['UNSAFE_MATERIAL_DIFFERENCE', 'ERROR'].includes(row.stability?.classification)
  )
}

export function classifyRecoveredRecipe(evidence) {
  if (evidence.currentMapPresent) return { classification: 'EXISTING_MAP', reason: 'A persisted map already exists and must not be replaced.' }
  if (evidence.sourceStatus === 'SOURCE_UNSAFE') return { classification: 'EXCLUDED', reason: evidence.sourceReason }
  if (evidence.error) return { classification: 'ERROR', reason: evidence.error }
  if (evidence.deterministicFalsePositive) return { classification: 'EXCLUDED', reason: 'Deterministic semantic review found a false-positive mapping.' }
  if (evidence.aiAmbiguous > 0 || evidence.aiIncorrect > 0) return { classification: evidence.aiIncorrect > 0 ? 'EXCLUDED' : 'REVIEW', reason: 'Accepted AI semantics did not pass the zero-tolerance gate.' }
  if (evidence.stability === 'UNSAFE_MATERIAL_DIFFERENCE' || evidence.stability === 'ERROR') return { classification: 'REVIEW', reason: `Stability result: ${evidence.stability}.` }
  if (!evidence.candidateValid || !evidence.sourceHashMatches) return { classification: 'ERROR', reason: 'Candidate validation or source-hash precondition failed.' }
  return { classification: 'READY', reason: null }
}

export function sortRows(rows) {
  return [...rows].sort((left, right) => left.recipeId.localeCompare(right.recipeId))
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

assertAuthorizedPopulation()
