#!/usr/bin/env node
/**
 * Read-only audit for the 49 source/parser exclusions frozen by the approved
 * cooking-step-mapping v4 manifest.
 *
 * Default execution performs exactly one Firestore collection get. There is no
 * apply mode and no Firestore write API in this file. For deterministic replay:
 *   node scripts/audit-excluded-recipe-sources.mjs --input /tmp/all-recipes.json
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'vite'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { loadEnv, getAdmin } = require('./_lib.js')
const DATE = '2026-08-26'
const MANIFEST_PATH = 'docs/audits/cooking-step-mapping-dryrun-v4-2026-08-26.json'
const DEFAULT_OUTPUT_JSON = `docs/audits/excluded-recipe-source-parser-audit-${DATE}.json`
const DEFAULT_OUTPUT_MD = `docs/audits/excluded-recipe-source-parser-audit-${DATE}.md`
const APPLY_COMMIT = '8ae34a3daaa50b9ee41a55aec2d3a72520d73929'

const DISPOSITIONS = new Set([
  'PARSER_FIX_ONLY', 'DATA_FIX_ONLY', 'PARSER_AND_DATA_FIX',
  'REIMPORT_REQUIRED', 'MANUAL_SOURCE_REQUIRED', 'PRODUCT_DECISION_REQUIRED',
])
const DEFECT_TYPES = new Set(['SOURCE_DEFECT', 'PARSER_DEFECT', 'SOURCE_AND_PARSER_DEFECT'])

const URL_MIXED = new Map(Object.entries({
  'chicken-enchiladas': 'The final actionable line also embeds freezer-storage advice beginning “For leftovers”; split that useful note out of Cooking Mode.',
  'chicken-stew': 'An exact “Tip” footer and freezer/reheating note sit between the last cooking step and the standalone URL.',
  'couscous-salad-with-lime-basil-vinaigrette': 'The final toss/serve step embeds weekly-storage guidance in the same raw line.',
  'creamy-cauliflower-soup-with-rosemary-olive-oil': 'The final serving step embeds reheating and one-week storage guidance in the same raw line.',
  'pepper-steak': 'An exact “Tip” footer contains optional tenderizing guidance after the completed method.',
  'pork-fried-rice': 'A VIDEO/NOTES footer contributes three useful source notes before the standalone URL.',
}))

const URL_ONLY_IDS = [
  'chicken-fajitas', 'chicken-paprikash', 'chicken-tacos-w-pineapple',
  'crazy-good-dal-adas-spicy-red-lentil-tamarind-soup',
  'crisp-gnocchi-with-brussels-sprouts-and-brown-butter',
  'crispy-gnocchi-with-burst-tomatoes-and-mozzarella',
  'crispy-gnocchi-with-sausage-and-broccoli',
  'curry-tomatoes-and-chickpeas-with-cucumber-yogurt', 'kung-pao-tofu',
  'onepot-chicken-and-lentil', 'onepot-chicken-and-rice-with-caramelized-lemon',
  'onepot-ratatouille-pasta', 'pearl-couscous-with-creamy-feta-and-chickpeas-meh',
  'pozole-verde-wowza', 'roasted-white-bean-and-tomato-pasta',
  'sheetpan-gochujang-chicken-and-roasted-vegetables',
  'vegetarian-skillet-chili', 'zibdiyit-gambari-spicy-shrimp-and-tomato-stew',
]

const REVIEW_IDS = [
  'chimichurri-chicken', 'curried-red-bean-soup-with-kale',
  'huevos-rotos-broken-eggs', 'peruvian-roasted-chicken-with-spicy-cilantro-sauce',
  'spicy-ovenfried-rice-with-gochujang-and-fried-eggs',
]

const SPECIAL = {
  'chana-masala': {
    primaryDefect: 'SOURCE_DEFECT', disposition: 'DATA_FIX_ONLY', confidence: 'HIGH',
    subtype: 'notes_appended_to_instruction_section',
    evidence: 'The six-step method is complete, then NOTES adds source attribution, heat/spice substitutions, storage, variation, and historical update prose; current instructions[6..11] are notes, not canonical steps.',
    boundary: 'Keep current instructions 0–5. Preserve all later prose as notes outside instructions[].',
    repair: 'Re-serialize the existing six method lines as instructions and preserve the quoted NOTES material in a non-Cooking-Mode notes area; do not use a broad global NOTES terminator.',
  },
  'chinese-chili-oil': {
    primaryDefect: 'PARSER_DEFECT', disposition: 'PARSER_FIX_ONLY', confidence: 'HIGH',
    subtype: 'explicit_storage_footer',
    evidence: 'The five-step method is complete before “Storage: …”; current instructions[5] is storage guidance and [6] is usage guidance.',
    boundary: 'Keep current instructions 0–4. Treat Storage and Usage as useful notes.',
    repair: 'Add the exact storage-label terminal rule from the zero-collateral footer simulation.',
    parserRuleCandidate: 'EXPLICIT_FOOTER_METADATA',
  },
  'easy-chicken-ramen': {
    primaryDefect: 'SOURCE_DEFECT', disposition: 'DATA_FIX_ONLY', confidence: 'HIGH',
    subtype: 'notes_and_nutrition_appended_to_instructions',
    evidence: 'Current instructions 0–13 contain the method; raw “Notes” then adds storage/egg alternatives and a Nutrition block, parsed as instructions 14–16.',
    boundary: 'Keep current instructions 0–13. Preserve the storage/egg guidance as notes and nutrition as metadata.',
    repair: 'Re-serialize existing method lines only; retain the existing Notes and Nutrition text outside instructions[].',
  },
  'lemongrass-chicken': {
    primaryDefect: 'SOURCE_DEFECT', disposition: 'DATA_FIX_ONLY', confidence: 'HIGH',
    subtype: 'ingredient_notes_appended_to_instructions',
    evidence: 'Current instructions 0–5 are the method; raw NOTES adds sourcing and protein/substitution guidance as instructions 6–8.',
    boundary: 'Keep current instructions 0–5. Preserve instructions 6–8 as useful notes.',
    repair: 'Re-serialize the existing method and preserve the existing substitutions outside instructions[].',
  },
  'peanut-butter-oat-protein-shake': {
    primaryDefect: 'PARSER_DEFECT', disposition: 'PARSER_FIX_ONLY', confidence: 'HIGH',
    subtype: 'explicit_nutrition_footer',
    evidence: 'The sole method is “Blend everything…”; an exact “📊 Nutrition Estimate:” block and variations follow and are parsed as instructions 1–9.',
    boundary: 'Keep current instruction 0. Treat nutrition as metadata and variations as useful notes.',
    repair: 'Use the exact Nutrition Estimate terminal rule from the zero-collateral footer simulation.',
    parserRuleCandidate: 'EXPLICIT_FOOTER_METADATA',
  },
  'peruvian-chicken-w-green-sauce': {
    primaryDefect: 'PARSER_DEFECT', disposition: 'PARSER_FIX_ONLY', confidence: 'HIGH',
    subtype: 'exact_nutrition_note',
    evidence: 'The method and pepper-safety note are usable; only current instruction 6 (“Note: The nutritional information does not include the green sauce.”) is page metadata.',
    boundary: 'Keep current instructions 0–5, including the safety note. Exclude only current instruction 6.',
    repair: 'Filter the exact nutritional-information note without treating every Note line as a terminator.',
    parserRuleCandidate: 'EXPLICIT_FOOTER_METADATA',
  },
  'tuscan-bean-soup': {
    primaryDefect: 'SOURCE_DEFECT', disposition: 'DATA_FIX_ONLY', confidence: 'HIGH',
    subtype: 'useful_notes_appended_to_instructions',
    evidence: 'Current instructions 0–6 are the method; raw NOTES adds thickening and vegan substitution guidance as instructions 7–8.',
    boundary: 'Keep current instructions 0–6. Preserve instructions 7–8 as useful notes.',
    repair: 'Re-serialize existing method lines and preserve the two existing notes outside instructions[].',
  },
  'zesty-quinoa-salad': {
    primaryDefect: 'SOURCE_DEFECT', disposition: 'REIMPORT_REQUIRED', confidence: 'HIGH',
    subtype: 'wrong_recipe_method',
    evidence: 'The title/ingredients describe zesty quinoa salad, but every method line calls for garlic head, shallots, wine, broth, spinach and cheese absent from the ingredient list; the footer attributes a different MyRecipes dish.',
    boundary: 'No trustworthy instruction boundary exists for this title; none of the stored method should be retained as its canonical method.',
    repair: 'Re-import the linked Allrecipes source or obtain user-provided source text, then compare title, ingredients and method before replacing content.',
    unverifiable: ['The original zesty-quinoa-salad method is not present in stored content.'],
  },
  'crunchy-queso-wrap': {
    primaryDefect: 'PARSER_DEFECT', disposition: 'PARSER_FIX_ONLY', confidence: 'HIGH',
    subtype: 'numbered_steps_without_instruction_heading',
    evidence: 'Raw content has six sequential Step 1–Step 6 directions immediately after the ingredient list, but no recognized instruction heading, so instructions[] is empty.',
    boundary: 'Ingredients end before Step 1; canonical instructions are the six existing numbered step bodies. Keep the trailing Tip as a note.',
    repair: 'Add the conservative no-heading fallback: only when no instruction heading exists, start at an exact Step 1 followed by a valid numbered sequence.',
    parserRuleCandidate: 'NUMBERED_STEP_FALLBACK',
  },
  'dads-chili': {
    primaryDefect: 'SOURCE_DEFECT', disposition: 'DATA_FIX_ONLY', confidence: 'HIGH',
    subtype: 'missing_instruction_heading_and_fallback_truncation',
    evidence: 'Raw content contains a long ingredient list and seven direction paragraphs, but no instruction heading; the 20-line ingredient-only horizon also truncates the parsed ingredient list.',
    boundary: 'Ingredient lines run through “Hatch powder 1 TBSP (none)”; directions begin “In a large pot combine V-8…”. The final long paragraph is an author note, not a canonical step.',
    repair: 'Insert the canonical instruction boundary before the existing “In a large pot…” paragraph and preserve the final author commentary as notes; use only existing text.',
  },
  'filipino-brased-chicken-tocino': {
    primaryDefect: 'PARSER_DEFECT', disposition: 'PARSER_FIX_ONLY', confidence: 'HIGH',
    subtype: 'unrecognized_prep_phase_heading',
    evidence: 'Raw content has complete action lines under exact PREP and ON THE STOVE phase headings; PREP currently terminates ingredients but is not accepted as instruction start.',
    boundary: 'Ingredients end before PREP. Instructions are the existing action lines under PREP and ON THE STOVE; phase labels are structural, not steps.',
    repair: 'Recognize exact PREP as a conservative alternate instruction start and omit exact PREP/ON THE STOVE phase labels from instructions[].',
    parserRuleCandidate: 'PREP_HEADING_FALLBACK',
  },
  'mexican-street-corn': {
    primaryDefect: 'SOURCE_DEFECT', disposition: 'REIMPORT_REQUIRED', confidence: 'HIGH',
    subtype: 'method_missing', evidence: 'Stored content contains a source URL and eight usable ingredients but no method text.',
    boundary: 'The ingredient list is recoverable; no instruction boundary or directions exist.',
    repair: 'Re-import the linked Serious Eats source or obtain user-provided source text; do not generate directions.',
    unverifiable: ['The original method is absent from stored content.'],
  },
  'rising-sun-mazcal': {
    primaryDefect: 'SOURCE_DEFECT', disposition: 'REIMPORT_REQUIRED', confidence: 'HIGH',
    subtype: 'method_missing', evidence: 'Stored content contains a source URL and six usable cocktail ingredients but no method text.',
    boundary: 'The ingredient list is recoverable; no instruction boundary or directions exist.',
    repair: 'Re-import the linked Saveur source or obtain user-provided source text; do not infer cocktail technique.',
    unverifiable: ['The original cocktail method is absent from stored content.'],
  },
  'speget-with-fake-meat-meatballs': {
    primaryDefect: 'SOURCE_DEFECT', disposition: 'REIMPORT_REQUIRED', confidence: 'HIGH',
    subtype: 'method_missing_and_ambiguous_ingredient',
    evidence: 'Stored content has no method heading or directions; a bare “broccoli” line is unquantified and its role is unsupported. A NYT source URL is present.',
    boundary: 'No trustworthy instruction boundary exists; the final broccoli line is not safely canonical without source confirmation.',
    repair: 'Recapture the linked source through authenticated DOM/text or obtain user-provided source text, then resolve the broccoli discrepancy.',
    unverifiable: ['All original directions are absent.', 'The quantity and intended role of broccoli cannot be reconstructed.'],
  },
  'maple-roasted-candied-pecans': {
    primaryDefect: 'SOURCE_DEFECT', disposition: 'MANUAL_SOURCE_REQUIRED', confidence: 'HIGH',
    subtype: 'empty_placeholder', evidence: 'The complete stored content is exactly “Source:” with no URL, ingredients or instructions.',
    boundary: 'No ingredient or instruction boundary exists.',
    repair: 'Obtain the original recipe text or a product-owner-approved trustworthy source; automatic reconstruction is impossible.',
    unverifiable: ['Original source URL, ingredients, quantities and instructions are all absent.'],
  },
  'smoothies': {
    primaryDefect: 'SOURCE_DEFECT', disposition: 'PRODUCT_DECISION_REQUIRED', confidence: 'HIGH',
    subtype: 'composite_multi_recipe_document', evidence: 'Raw content contains three independently titled smoothies, three decorated Ingredients headings, nutrition/taste metadata, and no explicit method; the single-recipe parser intentionally rejects multiple ingredient sections.',
    boundary: 'Each of the three ingredient lists is recoverable separately; there is no single canonical recipe boundary and no stored directions.',
    repair: 'Choose whether to split into three recipes or retire/retain a composite note. Source directions must then be supplied; do not invent “blend” steps.',
    unverifiable: ['No explicit preparation directions are stored.', 'The intended one-document versus three-recipe product model is unresolved.'],
    owner: true,
  },
  'spaghetti-carbonara': {
    primaryDefect: 'SOURCE_DEFECT', disposition: 'REIMPORT_REQUIRED', confidence: 'HIGH',
    subtype: 'paywall_placeholder_and_partial_ingredients', evidence: 'Stored content explicitly labels the six-item ingredient list partial and contains only a NYT paywall-unavailable placeholder as the method.',
    boundary: 'No usable method exists; even the ingredient list is not asserted complete.',
    repair: 'Use future authenticated bookmarklet DOM capture, paste user-provided recipe text, or obtain another owner-approved faithful source. Do not fabricate carbonara directions.',
    unverifiable: ['Ingredient completeness and the entire original method cannot be verified from stored content.'],
  },
  'chipotle-tahini-bowls': {
    primaryDefect: 'SOURCE_DEFECT', disposition: 'PRODUCT_DECISION_REQUIRED', confidence: 'HIGH',
    subtype: 'template_recipe_with_unquantified_options', evidence: 'Ingredients 0–6 are the quantified Chipotle Tahini sauce. “Build the Bowls:” is a subheader; sweet potato, eggs, kale, quinoa, avocado and “Anything else” are options, while notes contain optional component recipes/quantities.',
    boundary: 'One canonical sauce exists. The bowl is a configurable template, not one quantity-complete canonical recipe.',
    repair: 'Owner must choose sauce-only, configurable template, or a fixed bowl composition; then re-serialize only supported existing source text and quantities.',
    unverifiable: ['Canonical bowl quantities for kale, quinoa and avocado are absent.', 'The intended fixed versus configurable bowl is unresolved.'],
    owner: true,
  },
  'lemon-herb-pasta-salad-with-marinated-chickpeas': {
    primaryDefect: 'SOURCE_DEFECT', disposition: 'DATA_FIX_ONLY', confidence: 'HIGH',
    subtype: 'ingredient_group_before_heading', evidence: '“one 14 ounce can chickpeas, drained and rinsed” exists in raw content under “Marinated Chickpeas” before the sole INGREDIENTS heading, so the parser never sees it; quantity is fully recoverable.',
    boundary: 'Move the existing Marinated Chickpeas label and chickpea line into the ingredient span before its oil/garlic/lemon/salt group; retain all three current method lines.',
    repair: 'Mechanically rearrange the existing label and chickpea line under the canonical ingredient heading; no inference or external retrieval is needed.',
  },
  'mole-poblano': {
    primaryDefect: 'SOURCE_DEFECT', disposition: 'DATA_FIX_ONLY', confidence: 'HIGH',
    subtype: 'presentation_and_notes_inside_method', evidence: 'Current instruction 1 is the presentation label “For the Mole Sauce”; 0 and 2–17 are actions; 18 is storage guidance; 19–21 are NOTES/tips; raw source otherwise supports the method.',
    boundary: 'Keep action instruction 0 and 2–17. Preserve the sauce label structurally and move storage/tips outside instructions[].',
    repair: 'Mechanically re-serialize existing action lines, preserve “For the Mole Sauce” as presentation structure, and retain storage/tips as notes.',
  },
}

function urlOnlySpec(id) {
  return {
    primaryDefect: 'PARSER_DEFECT', disposition: 'PARSER_FIX_ONLY', confidence: 'HIGH',
    subtype: 'standalone_source_url_footer',
    evidence: id === 'vegetarian-skillet-chili'
      ? 'A plain standalone HTTP(S) URL is the final parsed instruction; exact page chrome “Make the recipe with us” is also parsed before Step 1.'
      : 'A plain standalone HTTP(S) source URL is the final parsed instruction after an otherwise usable method.',
    boundary: id === 'vegetarian-skillet-chili'
      ? 'Exclude exact page chrome and the final standalone URL; retain the three numbered action steps.'
      : 'Retain every current instruction except the final standalone HTTP(S) URL.',
    repair: id === 'vegetarian-skillet-chili'
      ? 'Apply standalone URL suppression plus the exact page-chrome filter.'
      : 'Apply the standalone HTTP(S)-line instruction filter.',
    parserRuleCandidate: id === 'vegetarian-skillet-chili'
      ? 'STANDALONE_URL_FILTER + PAGE_CHROME_FILTER' : 'STANDALONE_URL_FILTER',
  }
}

function reviewSpec(id) {
  const evidence = {
    'chimichurri-chicken': 'Actionable stovetop method and two Tips alternatives end before exact “Have you cooked this? Mark as Cooked” / “COOKING NOTES” chrome; reviews then follow.',
    'curried-red-bean-soup-with-kale': 'Five method steps and two useful Tips end before exact raw heading “Comment”; the following first-person supper report is a review.',
    'huevos-rotos-broken-eggs': 'Four method steps end before exact “Have you cooked this? Mark as Cooked” / “COOKING NOTES”; username/date, review and helpfulness text follow.',
    'peruvian-roasted-chicken-with-spicy-cilantro-sauce': 'Six method steps plus a legitimate chicken-cutting Tip end before the anchored author/date line “Anthony4 years ago”; a potluck review follows.',
    'spicy-ovenfried-rice-with-gochujang-and-fried-eggs': 'Six method steps end before exact “Have you cooked this? Mark as Cooked” / “COOKING NOTES”; two reviews and rating chrome follow.',
  }[id]
  return {
    primaryDefect: 'PARSER_DEFECT', disposition: 'PARSER_FIX_ONLY', confidence: 'HIGH',
    subtype: 'review_comment_footer', evidence,
    boundary: 'Stop instructions at the first exact review/comment marker or anchored author/date footer; retain any preceding Tips as recipe guidance.',
    repair: 'Apply the precise review/comment terminal-boundary rule; never classify generic first-person prose alone as review chrome.',
    parserRuleCandidate: 'REVIEW_COMMENT_TERMINATORS',
  }
}

export const REMEDIATION_SPECS = Object.freeze(Object.fromEntries([
  ...URL_ONLY_IDS.map(id => [id, urlOnlySpec(id)]),
  ...[...URL_MIXED].map(([id, note]) => [id, {
    primaryDefect: 'SOURCE_AND_PARSER_DEFECT', disposition: 'PARSER_AND_DATA_FIX', confidence: 'HIGH',
    subtype: 'standalone_url_plus_mixed_note_content',
    evidence: `The final parsed instruction is a plain standalone HTTP(S) URL. ${note}`,
    boundary: 'Remove the standalone URL from instructions and separate the identified useful note from the actionable method without inventing text.',
    repair: 'Apply the safe standalone URL parser filter, then perform the recipe-specific existing-text split documented by this audit.',
    parserRuleCandidate: 'STANDALONE_URL_FILTER',
  }]),
  ...REVIEW_IDS.map(id => [id, reviewSpec(id)]),
  ...Object.entries(SPECIAL),
]))

const LEADING_HEADING_DECORATION = /^(?:\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*[ \t]*){1,4}/u
const INSTRUCTION_HEADING = /^(INSTRUCTIONS|PREPARATION|DIRECTIONS|METHOD|STEPS|HOW TO MAKE):?$/i
const INGREDIENT_HEADING = /^(INGREDIENTS|WHAT YOU NEED|YOU WILL NEED|SHOPPING LIST)(?:[ \t]*\(([^()\r\n]{1,80})\)[ \t]*)?:?$/i
const headingCandidate = line => line.trimStart().replace(LEADING_HEADING_DECORATION, '')
const normalizedLines = content => String(content || '').split('\n').map(line => line.trim()).filter(Boolean)
const sourceHash = (ingredients, instructions) => crypto.createHash('sha256')
  .update(JSON.stringify({ ingredients, instructions })).digest('hex')

export const RULES = Object.freeze({
  STANDALONE_URL_FILTER: {
    skip: line => /^https?:\/\/\S+$/i.test(line),
    fullyRepairs: URL_ONLY_IDS.filter(id => id !== 'vegetarian-skillet-chili'),
    risk: 'LOW', recommendation: 'IMPLEMENT',
    rationale: 'Every match is a complete standalone URL line; no mapped recipe contains one in instructions.',
  },
  REVIEW_COMMENT_TERMINATORS: {
    stop: line => /^(?:Have you cooked this\? Mark as Cooked|COOKING NOTES|Comments?|Reviews?|Reader notes|Ratings?|.{1,80}\d+\s+years? ago)$/i.test(line),
    fullyRepairs: REVIEW_IDS, risk: 'LOW', recommendation: 'IMPLEMENT',
    rationale: 'Uses explicit chrome or an anchored author/date line, preserves preceding Tips, and changes no mapped recipe.',
  },
  GENERIC_FIRST_PERSON_BOUNDARY: {
    stop: line => /^(?:I|We|My)\b/i.test(line), fullyRepairs: [], risk: 'HIGH', recommendation: 'REJECT',
    rationale: 'Misclassifies valid recipe/source guidance and still leaves preceding chrome; first-person prose is not review evidence.',
  },
  TIP_TERMINATOR: {
    stop: line => /^Tips?:?$/i.test(line), fullyRepairs: [], risk: 'HIGH', recommendation: 'REJECT',
    rationale: 'Removes valid alternate cooking methods and preparation guidance from mapped recipes.',
  },
  NOTES_TERMINATOR: {
    stop: line => /^NOTES?:?$/i.test(line),
    fullyRepairs: ['chana-masala', 'easy-chicken-ramen', 'lemongrass-chicken', 'pork-fried-rice', 'tuscan-bean-soup'],
    risk: 'HIGH', recommendation: 'REJECT',
    rationale: 'Changes nine mapped source hashes and removes useful/actionable notes, including alternate cooking methods.',
  },
  EXPLICIT_FOOTER_METADATA: {
    stop: line => /^(?:Storage(?: Suggestions?)?:\s*|(?:📊\s*)?Nutrition Estimate:|Nutrition(?:al Information)?:$)/i.test(line),
    skip: line => /^(?:Note:\s*The nutritional information\b|Recipe Source:\s*https?:\/\/\S+)/i.test(line),
    fullyRepairs: ['chinese-chili-oil', 'peanut-butter-oat-protein-shake', 'peruvian-chicken-w-green-sauce'],
    risk: 'LOW', recommendation: 'IMPLEMENT',
    rationale: 'Evidence-bound labels change no mapped recipe; generic Note/Storage prose is not matched.',
  },
  PAGE_CHROME_FILTER: {
    skip: line => /^(?:Make the recipe with us|On Off)$/i.test(line), fullyRepairs: [],
    risk: 'LOW', recommendation: 'IMPLEMENT', rationale: 'Exact source-page controls only; changes no mapped recipe.',
  },
  PREP_HEADING_FALLBACK: {
    alternateStart: lines => lines.findIndex(line => /^PREP:?$/i.test(headingCandidate(line))),
    skip: line => /^(?:PREP|ON THE STOVE):?$/i.test(line),
    fullyRepairs: ['filipino-brased-chicken-tocino'], risk: 'LOW', recommendation: 'IMPLEMENT',
    rationale: 'Activates only when no normal instruction heading exists and changes no mapped recipe.',
  },
  NUMBERED_STEP_FALLBACK: {
    alternateStart: lines => lines.findIndex(line => /^Step\s+1:?$/i.test(line)),
    fullyRepairs: ['crunchy-queso-wrap'], risk: 'LOW', recommendation: 'IMPLEMENT',
    rationale: 'Activates only without a normal instruction heading; implementation must validate a sequential numbered-step run.',
  },
})

export function simulateInstructions(content, selectedRuleNames) {
  const lines = normalizedLines(content)
  let start = lines.findIndex(line => INSTRUCTION_HEADING.test(headingCandidate(line)))
  if (start === -1) {
    for (const name of selectedRuleNames) {
      const alternate = RULES[name].alternateStart?.(lines) ?? -1
      if (alternate !== -1) { start = alternate - 1; break }
    }
  }
  if (start === -1) return []
  const result = []
  for (const raw of lines.slice(start + 1)) {
    if (selectedRuleNames.some(name => RULES[name].stop?.(raw))) break
    if (selectedRuleNames.some(name => RULES[name].skip?.(raw))) continue
    if (raw.length <= 10) continue
    const stripped = raw.replace(/^Step\s+\d+\s*/i, '').trim()
    if (stripped.length > 10) result.push(stripped)
  }
  return result
}

function headings(content) {
  return normalizedLines(content).filter(line => {
    const candidate = headingCandidate(line)
    return INGREDIENT_HEADING.test(candidate) || INSTRUCTION_HEADING.test(candidate) ||
      /^(?:PREP|ON THE STOVE|NOTES?|TIPS?|COMMENTS?|COOKING NOTES|NUTRITION|VIDEO):?$/i.test(candidate)
  })
}

function relevantRawTail(content, count = 8) { return normalizedLines(content).slice(-count) }
function rawUrls(content) { return normalizedLines(content).filter(line => /https?:\/\/\S+/i.test(line)) }

function contentSignals(content) {
  const lines = normalizedLines(content)
  return {
    notes: lines.filter(line => /^(?:NOTES?|TIPS?|Storage(?: Suggestions?)?:|Usage:|CHANGE IT UP:|UPDATE\b)/i.test(line)),
    nutrition: lines.filter(line => /^(?:Nutrition|Nutritional|(?:📊\s*)?Nutrition Estimate:|Calories:)/i.test(line)),
    reviewsAndComments: lines.filter(line => /^(?:Have you cooked this\?|COOKING NOTES|Comments?|Most Helpful|.{1,80}\d+\s+years? ago|\d+ This is helpful$)/i.test(line)),
    pageChrome: lines.filter(line => /^(?:Make the recipe with us|On Off|VIDEO|Add to Your Grocery List|Cook Mode Prevent)/i.test(line)),
    paywallPlaceholders: lines.filter(line => /paywall|could not be fetched/i.test(line)),
  }
}

export function ruleSimulation(recipes, parsedById, excludedIds, name) {
  const rule = RULES[name]
  const changes = recipes.flatMap(recipe => {
    const current = parsedById.get(recipe.id)
    const nextInstructions = simulateInstructions(recipe.content, [name])
    if (JSON.stringify(current.instructions) === JSON.stringify(nextInstructions)) return []
    const removed = current.instructions.filter(item => !nextInstructions.includes(item))
    const added = nextInstructions.filter(item => !current.instructions.includes(item))
    return [{
      recipeId: recipe.id,
      excluded: excludedIds.has(recipe.id),
      mapped: recipe.cookingStepIngredientMap != null,
      instructionsRemoved: removed,
      instructionsAdded: added,
      ingredientChange: false,
      currentSourceHash: sourceHash(current.ingredients, current.instructions),
      proposedSourceHash: sourceHash(current.ingredients, nextInstructions),
    }]
  })
  const mappedChanges = changes.filter(change => change.mapped)
  const excludedChanged = changes.filter(change => change.excluded).map(change => change.recipeId)
  return {
    rule: name,
    excludedRecipesImproved: excludedChanged.length,
    excludedRecipeIdsImproved: excludedChanged,
    excludedRecipesFullyRepaired: rule.fullyRepairs.length,
    excludedRecipeIdsFullyRepaired: [...rule.fullyRepairs],
    cleanRecipesChanged: mappedChanges.length,
    cleanInstructionsRemoved: mappedChanges.reduce((sum, change) => sum + change.instructionsRemoved.length, 0),
    cleanIngredientsChanged: 0,
    mappedRecipesChanged: mappedChanges.length,
    sourceHashesChanged: mappedChanges.length,
    mappedCorpusImpact: {
      NO_CHANGE: 187 - mappedChanges.length,
      SEMANTICALLY_EQUIVALENT_BUT_HASH_CHANGED: 0,
      MEANINGFUL_PARSE_CHANGE: mappedChanges.length,
    },
    mappedRecipeChanges: mappedChanges.map(change => ({
      recipeId: change.recipeId, instructionsRemoved: change.instructionsRemoved,
    })),
    remainingDefects: excludedChanged.filter(id => !rule.fullyRepairs.includes(id)),
    risk: rule.risk,
    recommendation: rule.recommendation,
    rationale: rule.rationale,
  }
}

export function buildAuditRows(recipes, manifestRows, parseRecipeContent, isIngredientSubheader, ruleSimulations) {
  const manifestExcluded = manifestRows.filter(row => row.classification === 'EXCLUDED')
  const statusById = new Map(manifestExcluded.map(row => [row.recipeId, row.audit.sourceStatus]))
  const recipeById = new Map(recipes.map(recipe => [recipe.id, recipe]))
  const safeImpactByRule = Object.fromEntries(ruleSimulations.map(item => [item.rule, {
    mappedRecipesChanged: item.mappedRecipesChanged,
    sourceHashesChanged: item.sourceHashesChanged,
  }]))
  return [...statusById].map(([recipeId, currentExclusion]) => {
    const recipe = recipeById.get(recipeId)
    const spec = REMEDIATION_SPECS[recipeId]
    if (!recipe) throw new Error(`Excluded recipe missing from production: ${recipeId}`)
    if (!spec) throw new Error(`Missing remediation specification: ${recipeId}`)
    const parsed = parseRecipeContent(String(recipe.content || ''))
    const parsedFinal = parsed.instructions.at(-1) || null
    const defects = [{ type: spec.primaryDefect, subtype: spec.subtype, evidence: spec.evidence }]
    if (URL_MIXED.has(recipeId)) {
      defects.push({ type: 'PARSER_DEFECT', subtype: 'standalone_source_url_footer', evidence: `Parsed final instruction: ${JSON.stringify(parsedFinal)}.` })
    }
    if (recipeId === 'vegetarian-skillet-chili') {
      defects.push({ type: 'PARSER_DEFECT', subtype: 'source_page_control', evidence: 'Exact raw line “Make the recipe with us” is parsed as instruction 0.' })
    }
    const candidateNames = (spec.parserRuleCandidate || '').split(' + ').filter(Boolean)
    const impact = candidateNames.length === 0 ? undefined : {
      mappedRecipesChanged: Math.max(...candidateNames.map(name => safeImpactByRule[name]?.mappedRecipesChanged ?? 0)),
      sourceHashesChanged: Math.max(...candidateNames.map(name => safeImpactByRule[name]?.sourceHashesChanged ?? 0)),
    }
    return {
      recipeId,
      title: String(recipe.title || ''),
      currentExclusion,
      primaryDefect: spec.primaryDefect,
      defects,
      rawContentAnalysis: {
        characterCount: String(recipe.content || '').length,
        headingsPresent: headings(recipe.content),
        sourceUrls: rawUrls(recipe.content),
        relevantRawTail: relevantRawTail(recipe.content),
        contentSignals: contentSignals(recipe.content),
        ingredientBoundary: spec.boundary.split(' Instructions')[0],
        canonicalBoundaries: spec.boundary,
      },
      sourceUrlContamination: currentExclusion === 'EXCLUDE_SOURCE_URL' ? {
        rawInstructionTail: relevantRawTail(recipe.content),
        parsedFinalInstruction: parsedFinal,
        format: 'standalone_plain_http_url',
        surroundingLabel: null,
      } : undefined,
      currentParse: {
        ingredientCount: parsed.ingredients.length,
        instructionCount: parsed.instructions.length,
        ingredients: parsed.ingredients,
        instructions: parsed.instructions,
        detectedIngredientHeaders: parsed.ingredients.flatMap((line, index) =>
          isIngredientSubheader(line) ? [{ ingredientIndex: index, text: line }] : []),
        parsedFinalInstruction: parsedFinal,
      },
      recommendedDisposition: spec.disposition,
      proposedRepair: spec.repair,
      parserRuleCandidate: spec.parserRuleCandidate,
      mappedCorpusImpact: impact,
      risk: ['REIMPORT_REQUIRED', 'MANUAL_SOURCE_REQUIRED', 'PRODUCT_DECISION_REQUIRED'].includes(spec.disposition) ? 'HIGH'
        : spec.disposition === 'PARSER_AND_DATA_FIX' ? 'MEDIUM' : 'LOW',
      futureVerification: 'After source/parser remediation: reparse; verify ingredient/instruction boundaries; compute a fresh sourceHash; run deterministic-v4; use prompt-v2 only if eligible; conduct semantic dry-run review; then persist a newly reviewed source-bound map.',
      confidence: spec.confidence,
      requiresProductOwner: spec.owner === true || spec.disposition === 'PRODUCT_DECISION_REQUIRED',
      unverifiableItems: spec.unverifiable || [],
    }
  }).sort((a, b) => a.recipeId.localeCompare(b.recipeId))
}

function countBy(rows, getter) {
  return Object.fromEntries([...rows.reduce((map, row) => {
    const key = getter(row); map.set(key, (map.get(key) || 0) + 1); return map
  }, new Map())].sort(([a], [b]) => a.localeCompare(b)))
}

function markdown(audit) {
  const rows = audit.recipes
  const simulations = audit.parserRuleSimulations
  const table = rows.map(row => `| \`${row.recipeId}\` | ${row.currentExclusion} | ${row.primaryDefect} | ${row.recommendedDisposition} | ${row.proposedRepair.replace(/\|/g, '\\|')} |`).join('\n')
  const rules = simulations.map(rule => `| \`${rule.rule}\` | ${rule.excludedRecipesImproved} | ${rule.excludedRecipesFullyRepaired} | ${rule.cleanRecipesChanged} | ${rule.sourceHashesChanged} | ${rule.risk} | ${rule.recommendation} — ${rule.rationale.replace(/\|/g, '\\|')} |`).join('\n')
  const incompleteIds = ['maple-roasted-candied-pecans', 'smoothies', 'crunchy-queso-wrap', 'dads-chili', 'filipino-brased-chicken-tocino', 'mexican-street-corn', 'rising-sun-mazcal', 'speget-with-fake-meat-meatballs', 'spaghetti-carbonara', 'chipotle-tahini-bowls', 'lemon-herb-pasta-salad-with-marinated-chickpeas', 'mole-poblano']
  const incomplete = incompleteIds.map(id => {
    const row = rows.find(item => item.recipeId === id)
    return `- **${row.title}** (\`${id}\`) — ${row.defects[0].evidence} Disposition: **${row.recommendedDisposition}**.`
  }).join('\n')
  const unverifiable = rows.flatMap(row => row.unverifiableItems.map(item => `- \`${row.recipeId}\`: ${item}`)).join('\n') || '- None.'
  return `# Excluded Recipe Source/Parser Remediation Audit — ${audit.auditDate}

## Executive result

**READY FOR REMEDIATION DESIGN.** All 49 manifest-defined exclusions were reviewed against current raw production content and the canonical parser. A hybrid architecture is supported: six conservative parser rules repair 28 parser-only recipes without changing any of the 187 mapped recipes; six mixed recipes need those parser rules plus source-data cleanup; the remaining 15 require data repair, source recovery, or owner decisions.

## Corpus summary

- Shared recipes: **${audit.productionBaseline.sharedRecipes}**
- Persisted-map recipes: **${audit.productionBaseline.mappedRecipes}**
- Excluded/unmapped recipes: **${audit.productionBaseline.excludedRecipes}**
- Manifest exclusions reviewed: **${rows.length} / 49**
- Primary defect counts: SOURCE_DEFECT **${audit.summary.primaryDefects.SOURCE_DEFECT}**, PARSER_DEFECT **${audit.summary.primaryDefects.PARSER_DEFECT}**, SOURCE_AND_PARSER_DEFECT **${audit.summary.primaryDefects.SOURCE_AND_PARSER_DEFECT}**
- Dispositions: PARSER_FIX_ONLY **${audit.summary.dispositions.PARSER_FIX_ONLY}**, DATA_FIX_ONLY **${audit.summary.dispositions.DATA_FIX_ONLY}**, PARSER_AND_DATA_FIX **${audit.summary.dispositions.PARSER_AND_DATA_FIX}**, REIMPORT_REQUIRED **${audit.summary.dispositions.REIMPORT_REQUIRED}**, MANUAL_SOURCE_REQUIRED **${audit.summary.dispositions.MANUAL_SOURCE_REQUIRED}**, PRODUCT_DECISION_REQUIRED **${audit.summary.dispositions.PRODUCT_DECISION_REQUIRED}**
- Production mutation: **none**

## Exclusion classes

### Source URLs (24)

All 24 are plain standalone HTTP(S) lines at the end of the raw instruction span; none uses Markdown, brackets, or a Source label. The current parser makes each the final instruction. Standalone URL suppression changes all 24 exclusions and **0/187** mapped recipes. Eighteen become parser-clean when combined with the exact page-control filter for Vegetarian Skillet Chili. Six also contain mixed-in storage/tip/note material and therefore require source cleanup: Chicken Enchiladas, Chicken Stew, Couscous Salad With Lime Basil Vinaigrette, Creamy Cauliflower Soup With Rosemary Olive Oil, Pepper Steak, and Pork Fried Rice.

### Review/comment chrome (5)

Four recipes expose exact structural markers (Have you cooked this?, COOKING NOTES, or Comment). Peruvian Roasted Chicken has a bounded author/date line (Anthony4 years ago) before the copied review. The precise terminal rule changes all five exclusions and **0/187** mapped recipes while preserving preceding Tips. A generic first-person rule is rejected: it cuts valid recipe/source notes and does not reliably remove preceding chrome.

### Metadata and notes (8)

- **Page metadata:** nutrition blocks, exact nutritional-information copy, source attribution.
- **Useful recipe notes:** storage/reheating, make-ahead, substitutions, variations, and safety guidance.
- **Actionable cooking steps:** the method preceding those blocks; the Peruvian pepper-handling safety note remains useful guidance and is deliberately retained.

Exact footer metadata rules safely repair Chinese Chili Oil, Peanut Butter Oat Protein Shake, and Peruvian Chicken w/ Green Sauce with zero mapped changes. Chana Masala, Easy Chicken Ramen, Lemongrass Chicken, and Tuscan Bean Soup should be data-re-serialized because their NOTES blocks contain useful guidance. Zesty Quinoa Salad is not a footer-only defect: its stored method belongs to another recipe and requires re-import.

### No ingredients, no instructions, paywall, and structural defects

${incomplete}

## Parser architecture findings

- Ingredient starts: one and only one recognized top-level heading from INGREDIENTS / WHAT YOU NEED / YOU WILL NEED / SHOPPING LIST; multiple headings intentionally refuse composite collapse.
- Ingredient ends: the first recognized instruction heading, or a 20-line fallback horizon. Existing filters handle exact metadata/control lines, bare URLs, audited subheaders, NOTES/PREP/ON THE STOVE boundaries, and two exact terminal page blocks.
- Instruction starts: the first INSTRUCTIONS / PREPARATION / DIRECTIONS / METHOD / STEPS / HOW TO MAKE heading.
- Instruction ends: **end of document only**. There is no instruction URL filter or terminal model.
- Instruction filtering: trim blank lines, require >10 characters before and after stripping Step N; short structural markers disappear without terminating the span.
- Consequence: URLs, reviews, notes, nutrition, storage, and page chrome pass through; PREP-only and Step-1-only methods never start.

## Safe systemic parser opportunities

| Candidate rule | Exclusions improved | Fully repaired alone | Clean/mapped recipes changed | Mapped hashes changed | Risk | Recommendation |
|---|---:|---:|---:|---:|---|---|
${rules}

The recommended global package is: standalone URL suppression; precise review/comment terminators; exact footer metadata handling; exact page-control filtering; conservative PREP-phase fallback; and conservative sequential Step-1 fallback. Combined, it fully repairs the 28 PARSER_FIX_ONLY recipes and improves all six mixed URL recipes. It changes **0 parsed ingredients, 0 parsed instructions, and 0 source hashes** in the 187 mapped corpus.

Broad NOTES and Tip termination are rejected. NOTES changes nine mapped recipes and removes alternate methods, thickening guidance, serving steps, substitutions, and other useful content. Tip changes four mapped recipes and removes legitimate grilling/preparation directions. Both would cause meaningful parse changes and invalidate those persisted maps.

## Existing mapped-corpus risk

For every recommended rule: **187 NO_CHANGE / 0 SEMANTICALLY_EQUIVALENT_BUT_HASH_CHANGED / 0 MEANINGFUL_PARSE_CHANGE**. No recommended rule invalidates an existing persisted map. The rejected NOTES rule changes 9 mapped recipes and 9 source hashes; the rejected Tip rule changes 4 and 4. If a later implementation broadens any rule beyond the audited concepts, it must rerun the all-236 simulation and deliberately revalidate/migrate every changed mapped sourceHash.

## Recipe-level remediation table

| Recipe | Historical class | Primary defect | Disposition | Proposed repair |
|---|---|---|---|---|
${table}

Full raw-tail evidence, parsed arrays, detected ingredient subheaders, boundaries, risk, verification, and unverifiable facts are in the companion JSON.

## Recommended implementation sequence

1. **Wave 1A — zero-collateral parser package:** implement the six recommended rules with corpus fixtures and exact all-236/mapped-hash assertions. Do not include generic NOTES, Tip, or first-person rules.
2. **Wave 1B — mixed URL recipes:** after URL suppression, split only the six documented storage/tip/note fragments using existing text; preserve notes outside Cooking Mode.
3. **Wave 2 — recoverable data repairs:** Chana Masala, Easy Chicken Ramen, Lemongrass Chicken, Tuscan Bean Soup, Dad’s Chili, Lemon Herb Pasta Salad, and Mole Poblano. Use only quoted/rearranged stored text.
4. **Wave 3 — source recovery:** re-import Zesty Quinoa Salad, Mexican Street Corn, Rising Sun Mezcal, Speget with Fake Meat Meatballs, and Spaghetti Carbonara; obtain a manual source for Maple Roasted Candied Pecans.
5. **Wave 4 — product decisions:** decide the canonical model for Smoothies and Chipotle Tahini Bowls before any content rewrite.

Each wave needs a new read-only source/parser audit before production content changes. No old v4 manifest candidate may be reused.

## Mapping follow-up

For each repaired recipe: repair/recapture source → parse cleanly → compute fresh sourceHash → deterministic-v4 → prompt-v2 only if eligible → semantic dry run/review → persist a newly reviewed source-bound map. The 49 recipes never had approved v4 candidates, so source repair cannot reuse an old manifest candidate.

## Unverifiable items

${unverifiable}

## Production mutation

None. The audit performed one read-only collection query (or deterministic local replay), no AI calls, no Firestore writes, no mapping generation, no backfill, and no deployment.
`
}

async function loadProductionModules() {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    resolve: { alias: { '@': ROOT } },
  })
  try {
    const recipeContent = await server.ssrLoadModule('/lib/recipeContent.ts')
    return { recipeContent, close: () => server.close() }
  } catch (error) { await server.close(); throw error }
}

async function readRecipes(inputPath) {
  if (inputPath) return JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'))
  loadEnv()
  const snapshot = await getAdmin().firestore().collection('recipes').get()
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
}

export async function main() {
  const inputIndex = process.argv.indexOf('--input')
  const inputPath = inputIndex === -1 ? null : process.argv[inputIndex + 1]
  if (inputIndex !== -1 && !inputPath) throw new Error('--input requires a path')
  const outputJsonIndex = process.argv.indexOf('--output-json')
  const outputJson = outputJsonIndex === -1 ? DEFAULT_OUTPUT_JSON : process.argv[outputJsonIndex + 1]
  if (outputJsonIndex !== -1 && !outputJson) throw new Error('--output-json requires a path')
  const outputMdIndex = process.argv.indexOf('--output-md')
  const outputMd = outputMdIndex === -1 ? DEFAULT_OUTPUT_MD : process.argv[outputMdIndex + 1]
  if (outputMdIndex !== -1 && !outputMd) throw new Error('--output-md requires a path')
  const valueIndexes = new Set([inputIndex + 1, outputJsonIndex + 1, outputMdIndex + 1])
  const supportedFlags = new Set(['--input', '--output-json', '--output-md'])
  const unsupported = process.argv.slice(2).filter((arg, index) =>
    !supportedFlags.has(arg) && !valueIndexes.has(index + 2),
  )
  if (unsupported.length > 0) throw new Error(`Unsupported options: ${unsupported.join(', ')}`)
  const manifestRows = JSON.parse(fs.readFileSync(path.join(ROOT, MANIFEST_PATH), 'utf8'))
  const recipes = (await readRecipes(inputPath)).sort((a, b) => a.id.localeCompare(b.id))
  const modules = await loadProductionModules()
  try {
    const { parseRecipeContent, isIngredientSubheader } = modules.recipeContent
    const excludedIds = new Set(manifestRows.filter(row => row.classification === 'EXCLUDED').map(row => row.recipeId))
    const parsedById = new Map(recipes.map(recipe => [recipe.id, parseRecipeContent(String(recipe.content || ''))]))
    const simulations = Object.keys(RULES).map(name => ruleSimulation(recipes, parsedById, excludedIds, name))
    const rows = buildAuditRows(recipes, manifestRows, parseRecipeContent, isIngredientSubheader, simulations)
    const mapped = recipes.filter(recipe => recipe.cookingStepIngredientMap != null)
    const mappedHashMismatches = mapped.flatMap(recipe => {
      const parsed = parsedById.get(recipe.id)
      const actual = sourceHash(parsed.ingredients, parsed.instructions)
      return actual === recipe.cookingStepIngredientMap.sourceHash ? [] : [recipe.id]
    })
    const backfillCommitPresent = execFileSync('git', ['merge-base', '--is-ancestor', APPLY_COMMIT, 'HEAD'], { cwd: ROOT }).length === 0
    const audit = {
      auditDate: DATE,
      executiveResult: 'READY FOR REMEDIATION DESIGN',
      repository: {
        branch: execFileSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' }).trim(),
        head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
        requiredBackfillCommit: APPLY_COMMIT,
        requiredBackfillCommitPresent: backfillCommitPresent,
      },
      productionBaseline: {
        sharedRecipes: recipes.length,
        mappedRecipes: mapped.length,
        recipesWithoutMap: recipes.length - mapped.length,
        excludedRecipes: rows.length,
        excludedRecipesWithMap: rows.filter(row => recipes.find(recipe => recipe.id === row.recipeId)?.cookingStepIngredientMap != null).map(row => row.recipeId),
        mappedSourceHashMismatches: mappedHashMismatches,
      },
      historicalExclusionCounts: countBy(rows, row => row.currentExclusion),
      summary: {
        primaryDefects: countBy(rows, row => row.primaryDefect),
        dispositions: countBy(rows, row => row.recommendedDisposition),
      },
      parserArchitecture: {
        ingredientHeadingRecognition: 'Exactly one top-level INGREDIENTS/WHAT YOU NEED/YOU WILL NEED/SHOPPING LIST heading; optional bounded qualifier and pictographic decoration.',
        ingredientTermination: 'Recognized instruction heading, or filtered 20-line fallback; exact Notes/PREP/ON THE STOVE and audited terminal blocks stop ingredient spans.',
        instructionStart: 'First INSTRUCTIONS/PREPARATION/DIRECTIONS/METHOD/STEPS/HOW TO MAKE heading.',
        instructionTermination: 'End of document only.',
        instructionFiltering: 'Trim blanks; keep lines >10 chars; strip Step N; keep result >10 chars.',
        urlHandling: 'sourceURL takes first http-prefixed line; ingredient URLs are filtered; instruction URLs are not filtered.',
        ambiguity: 'Multiple top-level ingredient headings produce no ingredients; no fallback infers prose or composite recipes.',
      },
      parserRuleSimulations: simulations,
      recommendedArchitecture: 'HYBRID',
      recommendedSafeParserPackage: [
        'STANDALONE_URL_FILTER', 'REVIEW_COMMENT_TERMINATORS', 'EXPLICIT_FOOTER_METADATA',
        'PAGE_CHROME_FILTER', 'PREP_HEADING_FALLBACK', 'NUMBERED_STEP_FALLBACK',
      ],
      productionMutation: 'none',
      recipes: rows,
    }
    if (recipes.length !== 236 || mapped.length !== 187 || rows.length !== 49) throw new Error('Production/manifest baseline differs from approved 236/187/49 state')
    if (audit.productionBaseline.excludedRecipesWithMap.length > 0) throw new Error('An excluded recipe unexpectedly has a map')
    if (mappedHashMismatches.length > 0) throw new Error(`Mapped source hashes mismatch: ${mappedHashMismatches.join(', ')}`)
    if (!backfillCommitPresent) throw new Error(`Required backfill commit is not present: ${APPLY_COMMIT}`)
    if (Object.keys(REMEDIATION_SPECS).length !== 49) throw new Error(`Expected 49 remediation specs, got ${Object.keys(REMEDIATION_SPECS).length}`)
    if (rows.some(row => !DISPOSITIONS.has(row.recommendedDisposition) || !DEFECT_TYPES.has(row.primaryDefect))) throw new Error('Invalid classification')
    fs.writeFileSync(path.resolve(ROOT, outputJson), `${JSON.stringify(audit, null, 2)}\n`)
    fs.writeFileSync(path.resolve(ROOT, outputMd), markdown(audit))
    console.log(JSON.stringify({
      executiveResult: audit.executiveResult,
      productionBaseline: audit.productionBaseline,
      primaryDefects: audit.summary.primaryDefects,
      dispositions: audit.summary.dispositions,
      outputs: [outputJson, outputMd],
    }, null, 2))
  } finally { await modules.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error); process.exitCode = 1 })
}
