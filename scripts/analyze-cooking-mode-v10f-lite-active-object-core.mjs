/**
 * V10F-Lite — smallest-possible active-object rescue rule (diagnostic only).
 *
 * Tests one narrow concept: when a set of ingredients has already been explicitly combined
 * into one active cooking object in an EARLIER instruction of the same recipe, and a LATER
 * instruction clearly continues manipulating that same object (a bare whole-dish verb, a
 * collective/category noun, or an unambiguous pronoun), the combined ingredients may inherit
 * relevance to that later step.
 *
 * This module is read-only, deterministic, AI-free, and Firestore-free. It is NOT imported by
 * any production path (`app/**`, `lib/**` outside this diagnostic file) and does not export a
 * runtime integration point. See docs/audits/cooking-mode-v10f-lite-active-object-go-no-go-2026-08-28.md.
 */

// ---- evidence signal words (source-observable, from the V10E taxonomy) -------------------

/** Bare whole-dish/vessel continuation verbs — "acts on whatever is currently in the pot/pan/oven". */
const DISH_STATE_VERB_RE =
  /\b(cover(ed)?\s+and\s+cook|cook(ing)?\s+on\s+(low|high)|simmer(ing)?|continue\s+cooking|bak(e|ing)|roast(ing)?|grill(ing)?\s+for|boil(ing)?|reduce\s+heat|rest(ing)?|chill(ing)?|refrigerat(e|ing)|place\s+in\s+the\s+oven|return\s+to\s+(the\s+)?oven|cook(ing)?\s+for)\b/i

/** Explicit active-manipulation verbs applied to the assembled set as a collection. */
const COLLECTION_ACTIVE_VERB_RE =
  /\bstir(red|ring)?\b|\btoss(ed|ing)?\b|\bmix(ed)?\s+well\b|\bmix(ed)?\s+together\b|\bcombine(d)?\s+well\b|\btransfer(red)?\s+to\b|\bplate(d)?\b/i

/** Collective/deictic nouns whose antecedent is "the set of rows assembled by prior instructions". */
const COLLECTIVE_WORD_RE =
  /\beverything\b|\bmixture\b|\bboth\b|\ball\b|\bcontents\b|\bvegetables\b|\bveggies\b/i

/** Unambiguous pronoun reference to a previously assembled object. */
const PRONOUN_WORD_RE = /\bit\b|\bthem\b|\bthis\b|\bthese\b/i

/** A definite reference to a separately NAMED prepared sub-component — the object of the
 *  current instruction is the finished sub-preparation, not the open main-dish vessel, so
 *  the raw constituent rows must NOT be re-activated even if a continuation verb is present. */
const NAMED_SUBCOMPONENT_RE =
  /\bthe\s+(dressing|vinaigrette|sauce|marinade|glaze|rub|paste|slaw|salsa|batter|dough|brine|filling|wrap|roll|patty|burger|skewer|casserole|packet|bundle|loaf)\b/i

/** Bare generic seasoning/finishing language with no named subset — benchmark-consistent
 *  out-of-scope per the V10D ratatouille salt/pepper finding. */
const GENERIC_SEASONING_RE = /\b(to\s+taste|adjust(ing)?\s+(the\s+)?season(ing)?|season(ing)?\s+to\s+taste)\b/i

/** Verbs that can plausibly ESTABLISH an ingredient's membership in a shared active object.
 *  Deliberately excludes solo single-item prep verbs (brown/sear/cook a protein alone, which
 *  match incidental words like "cooking oil" without any real combination) and layer/transfer
 *  verbs (lay/layer X over Y creates a distinct assembled target, not a merge — see
 *  TRANSFER_OR_ASSEMBLY_TARGET in the V10E taxonomy) so neither counts as a merge event. */
const ESTABLISHING_VERB_RE =
  /\b(add(ed|ing)?|combin(e|ed|ing)|load(ed|ing)?|toss(ed|ing)?|mix(ed|ing)?|whisk(ed|ing)?|stir(red|ring)?|dic(e|ed|ing)|saut[ée](ed|ing)?|blend(ed|ing)?|simmer(ed|ing)?|plac(e|ed|ing)|arrang(e|ed|ing))\b/i

/** An establishing candidate phrased "in a small/separate/another bowl" (etc.) is a distinct
 *  sub-preparation vessel, not the shared main-dish vessel — same-vessel continuity (an allowed
 *  evidence signal per Phase 3) fails when the vessel is explicitly a different one. */
const SEPARATE_VESSEL_RE = /\bin\s+(a|another)\s+(small|separate|medium)?\s*(bowl|dish|container|bag)\b/i

/** Generic culinary category words, plus common dish-type nouns, are excluded from key-token
 *  identity matching: they are too common to safely anchor which specific row an earlier
 *  instruction is establishing. Many different named sauces all contain the word "sauce", and
 *  recipes routinely narrate using their own dish-type name (a chili recipe saying "a smoother
 *  chili", a soup recipe saying "the soup") in prose unrelated to any specific ingredient row. */
const GENERIC_FOOD_WORDS = new Set([
  'sauce', 'sauces', 'mix', 'mixture', 'spice', 'spices', 'seasoning', 'seasonings',
  'broth', 'stock', 'cream', 'cheese', 'powder', 'sugar',
  'chili', 'soup', 'stew', 'curry', 'salad', 'casserole', 'bowl',
])

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'with', 'for', 'into',
  'cup', 'cups', 'tbsp', 'tablespoon', 'tablespoons', 'tsp', 'teaspoon', 'teaspoons',
  'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds', 'can', 'cans', 'clove', 'cloves',
  'medium', 'large', 'small', 'about', 'chopped', 'diced', 'sliced', 'minced', 'cut', 'peeled',
  'fresh', 'dried', 'ground', 'to', 'taste', 'more', 'if', 'desired', 'optional', 'pinch',
])

/** Extracts significant lowercase word tokens (4+ letters, non-stopword) from an ingredient row. */
export function ingredientKeyTokens(ingredientText) {
  const words = (ingredientText || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !GENERIC_FOOD_WORDS.has(w))
  return Array.from(new Set(words))
}

/**
 * Scans earlier instructions (strictly before `beforeIndex`, this recipe's own chronology
 * only — never global) for an establishing combination event that names at least one of the
 * ingredient's own key tokens. Returns the matching instruction, or null if none exists.
 */
function findEstablishingInstruction(ingredientText, instructions, beforeIndex) {
  const keyTokens = ingredientKeyTokens(ingredientText)
  if (keyTokens.length === 0) return null
  const earlier = instructions
    .filter((i) => i.index < beforeIndex)
    .sort((a, b) => b.index - a.index) // nearest-first
  for (const instr of earlier) {
    const text = (instr.text || '').toLowerCase()
    if (!ESTABLISHING_VERB_RE.test(text)) continue
    if (SEPARATE_VESSEL_RE.test(text)) continue
    // Plural-tolerant: an ingredient token ("onion") must also match its plain plural in prose
    // ("onions"), so strip a trailing "s" from the token and allow an optional "(e)s" back on.
    if (keyTokens.some((tok) => new RegExp(`\\b${tok.replace(/s$/, '')}(e?s)?\\b`).test(text))) {
      return instr
    }
  }
  return null
}

/**
 * evaluateActiveObjectRescue(candidate, recipeContext)
 *
 * candidate: { candidateId, ingredientText, instructionText, instructionIndex }
 * recipeContext: { instructions: [{ index, text }, ...] } — this recipe's own instructions only.
 *
 * Returns { rescue: boolean, evidence: 'EXPLICIT_OBJECT'|'COLLECTIVE_REFERENCE'|'PRONOUN_REFERENCE'|'NONE', reason: string }
 */
export function evaluateActiveObjectRescue(candidate, recipeContext) {
  const currentText = candidate.instructionText || ''
  const instructions = recipeContext?.instructions || []

  // --- fail-closed checks, evaluated first, on the current instruction only ---
  if (NAMED_SUBCOMPONENT_RE.test(currentText)) {
    return {
      rescue: false,
      evidence: 'NONE',
      reason:
        'Current instruction references a separately named prepared sub-component (e.g. "the dressing"/"the sauce"); the object of this instruction is the finished sub-preparation, not the open main-dish vessel.',
    }
  }
  if (GENERIC_SEASONING_RE.test(currentText)) {
    return {
      rescue: false,
      evidence: 'NONE',
      reason:
        'Current instruction is bare generic seasoning/finishing language ("to taste"/"adjust seasoning") with no named subset — benchmark-consistent out-of-scope per the V10D ratatouille finding.',
    }
  }

  // --- evidence detection on the current instruction (priority: pronoun > collective > explicit verb) ---
  let evidence = 'NONE'
  if (PRONOUN_WORD_RE.test(currentText)) {
    evidence = 'PRONOUN_REFERENCE'
  } else if (COLLECTIVE_WORD_RE.test(currentText)) {
    evidence = 'COLLECTIVE_REFERENCE'
  } else if (DISH_STATE_VERB_RE.test(currentText) || COLLECTION_ACTIVE_VERB_RE.test(currentText)) {
    evidence = 'EXPLICIT_OBJECT'
  }

  if (evidence === 'NONE') {
    return {
      rescue: false,
      evidence: 'NONE',
      reason: 'No pronoun, collective/category noun, or whole-dish continuation verb found in the current instruction.',
    }
  }

  // --- antecedent validation: the evidence above only counts if this specific ingredient was
  // already combined into a shared active object by an earlier instruction (strictly before
  // the current one). A bare section header or a first-appearance-in-this-instruction row is
  // not a valid antecedent, and multiple/no candidate antecedents fail closed. ---
  const establishing = findEstablishingInstruction(candidate.ingredientText, instructions, candidate.instructionIndex)

  if (!establishing) {
    return {
      rescue: false,
      evidence: 'NONE',
      reason:
        'No earlier instruction in this recipe explicitly establishes this ingredient as part of a combined active object (object identity unclear / no established antecedent).',
    }
  }

  return {
    rescue: true,
    evidence,
    reason: `Ingredient was explicitly combined at instruction ${establishing.index} ("${establishing.text.slice(0, 80)}${establishing.text.length > 80 ? '…' : ''}"), and the current instruction (${evidence}) continues manipulating that same active object without isolating this row into a separately named sub-component.`,
  }
}
