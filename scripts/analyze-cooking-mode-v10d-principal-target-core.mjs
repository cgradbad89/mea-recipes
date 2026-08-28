import {
  candidateMetrics,
  createRiskBatches,
  extractCandidateRiskFacts,
  ingredientIdentityTokens,
  normalizeText,
  reviewerCount,
  validateArbiterResults,
  voteClass,
} from './analyze-cooking-mode-v10b-ingredient-precision-core.mjs'
import {
  extractComponentMembership,
  extractQuantityMentions,
  extractV10CState,
  listedQuantity,
  routeV10CRisk,
  rowLocalInstructionQuantity,
  sourceMentionsRow,
  validateTruthBlind,
} from './analyze-cooking-mode-v10c-active-target-core.mjs'

export {
  candidateMetrics, createRiskBatches, extractCandidateRiskFacts, extractComponentMembership, extractQuantityMentions,
  extractV10CState, ingredientIdentityTokens, listedQuantity, normalizeText, reviewerCount, routeV10CRisk,
  rowLocalInstructionQuantity, sourceMentionsRow, validateArbiterResults, validateTruthBlind, voteClass,
}

function unique(values) { return [...new Set(values)] }

// ---------------------------------------------------------------------------
// Phase 4 — safe category aliases
// ---------------------------------------------------------------------------

// A row-specific alias is only ever derived TOWARD one of these conservative core nouns,
// and only when the token immediately following the noun in the ROW's own text is not one
// of the UNSAFE_QUALIFIERS below (which changes the identity of the thing entirely).
const CORE_ALIAS_NOUNS = [
  'chicken', 'beef', 'pork', 'steak', 'shrimp', 'salmon', 'fish', 'turkey', 'lamb', 'tofu',
  'squash', 'zucchini', 'potato', 'potatoes', 'onion', 'onions', 'pepper', 'peppers', 'tomato',
  'tomatoes', 'carrot', 'carrots', 'rice', 'pasta', 'bean', 'beans', 'chickpea', 'chickpeas',
  'chili', 'cabbage', 'broccoli', 'cauliflower', 'mushroom', 'mushrooms',
]
const UNSAFE_QUALIFIERS = [
  'broth', 'stock', 'oil', 'milk', 'sauce', 'powder', 'extract', 'juice', 'vinegar', 'paste',
  'butter', 'seasoning', 'soup', 'flour', 'cream', 'water',
]

export function resolveCategoryAliases(ingredientText) {
  const tokens = ingredientIdentityTokens(ingredientText).filter(token => token.length >= 3)
  const aliases = new Set()
  for (const noun of CORE_ALIAS_NOUNS) {
    const nounIndex = tokens.indexOf(noun)
    if (nounIndex < 0) continue
    const next = tokens[nounIndex + 1]
    if (next && UNSAFE_QUALIFIERS.includes(next)) continue
    aliases.add(noun)
  }
  // No fallback to "just pick some token": an alias is only ever returned when it resolves to
  // one of the conservative core nouns above and survives the unsafe-qualifier check, so a row
  // with no safe core-noun match (e.g. "coconut oil") gets no alias at all rather than a risky guess.
  return [...aliases]
}

// ---------------------------------------------------------------------------
// Phase 3 — principal-target extraction (audit-only, source-evidence-only)
// ---------------------------------------------------------------------------

const MANIPULATION_VERBS = [
  'add', 'cook', 'brown', 'sear', 'roast', 'bake', 'grill', 'simmer', 'stir', 'flip', 'turn',
  'toss', 'mix', 'combine', 'fry', 'boil', 'saute', 'marinate', 'season', 'coat', 'dredge',
  'shred', 'slice', 'dice', 'chop', 'whisk', 'fold', 'blend', 'puree', 'mash', 'drain', 'rinse',
  'drizzle', 'sprinkle', 'arrange', 'layer', 'spread', 'fill', 'stuff', 'wrap', 'roll', 'shape',
  'form', 'knead', 'place', 'transfer', 'return', 'remove', 'cut', 'shake', 'baste',
]

export function hasManipulationVerb(instructionText) {
  const source = normalizeText(instructionText)
  return MANIPULATION_VERBS.some(verb => new RegExp(`\\b${verb}\\w*\\b`, 'u').test(source))
}

export function extractPrincipalTargets(recipe) {
  const titleTokens = new Set(ingredientIdentityTokens(recipe.title || '').filter(token => token.length >= 3))
  const rows = recipe.ingredients.map((item, ingredientIndex) => ({ item, ingredientIndex })).filter(({ item }) => !item.header)
  const targets = []
  for (const { item, ingredientIndex } of rows) {
    const tokens = unique(ingredientIdentityTokens(item.raw).filter(token => token.length >= 3))
    if (!tokens.length) continue
    const titleMatch = tokens.some(token => titleTokens.has(token))
    const activeMentions = []
    for (let index = 0; index < recipe.steps.length; index += 1) {
      const instruction = recipe.steps[index]?.instruction || ''
      if (!sourceMentionsRow(instruction, item.raw)) continue
      if (hasManipulationVerb(instruction)) activeMentions.push(index)
    }
    if (!titleMatch && activeMentions.length < 2) continue
    const confidence = titleMatch && activeMentions.length >= 2 ? 'HIGH' : (titleMatch || activeMentions.length >= 2) ? 'MEDIUM' : 'LOW'
    targets.push({
      ingredientIndex,
      aliases: resolveCategoryAliases(item.raw),
      ...(activeMentions.length ? { introducedAtInstructionIndex: activeMentions[0] } : {}),
      confidence,
    })
  }
  return targets.sort((left, right) => left.ingredientIndex - right.ingredientIndex)
}

// ---------------------------------------------------------------------------
// Phase 8-10 — generic seasoning semantics
// ---------------------------------------------------------------------------

// "season to taste WITH salt" directly names the row already (handled by exact-token matching);
// only the bare generic form with no ingredient named counts as generic seasoning language.
const GENERIC_SEASONING_ACTION_RE = new RegExp(String.raw`\b(?:taste and adjust seasoning|season to taste(?! with)|adjust (?:the )?seasoning|adjust for seasoning|check(?:ing)? (?:the )?seasoning)\b`, 'u')
const SEASONING_ROW_RE = new RegExp(String.raw`\b(?:salt|pepper|black pepper|seasoning blend|seasoning mix|italian seasoning|taco seasoning|cajun seasoning)\b`, 'u')
const SCOPED_COMPONENT_WORDS = ['marinade', 'dressing', 'brine', 'rub']

export function detectGenericSeasoningAction(instructionText) {
  return GENERIC_SEASONING_ACTION_RE.test(normalizeText(instructionText))
}

export function isSeasoningRow(ingredientText) {
  return SEASONING_ROW_RE.test(normalizeText(ingredientText))
}

// A seasoning row already proposed at an earlier instruction for this exact recipe/row has
// already had its canonical active-use moment. Frozen evidence (ratatouille salt/pepper,
// adjudicated INCORRECT at the later "Taste and adjust seasoning" instruction despite the row
// itself reading "more to taste") shows generic seasoning language does NOT re-trigger an
// already-established row, even when the row explicitly invites more seasoning later. This is
// a structural/provenance check only (candidate existence, not truth), so it stays truth-blind.
export function rowEstablishedAtEarlierInstruction(candidate, allIngredientCandidates) {
  return allIngredientCandidates.some(item =>
    item.recipeId === candidate.recipeId && item.ingredientIndex === candidate.ingredientIndex &&
    item.instructionIndex < candidate.instructionIndex)
}

export function eligibleGenericSeasoningRow(candidate, memberships, allIngredientCandidates) {
  if (!isSeasoningRow(candidate.ingredientText)) return false
  if (!detectGenericSeasoningAction(candidate.instructionText)) return false
  if (rowEstablishedAtEarlierInstruction(candidate, allIngredientCandidates)) return false
  const scopedMemberships = memberships.filter(item => SCOPED_COMPONENT_WORDS.some(word => item.componentKey.includes(word)))
  if (!scopedMemberships.length) return true
  const current = normalizeText(candidate.instructionText)
  return scopedMemberships.some(item => current.includes(item.componentKey))
}

// ---------------------------------------------------------------------------
// Phase 5-6 — principal-target continuation
// ---------------------------------------------------------------------------

const CONTINUATION_LANGUAGE_RE = /\b(?:continue|again|more|another|further|until)\b/

export function derivePrincipalContinuation(candidate, principalTargets, componentMembership, v10cState) {
  const target = principalTargets.find(item => item.ingredientIndex === candidate.ingredientIndex)
  if (!target) return { eligible: false, reason: 'NOT_A_PRINCIPAL_TARGET' }
  if (target.introducedAtInstructionIndex === undefined || target.introducedAtInstructionIndex >= candidate.instructionIndex) {
    return { eligible: false, reason: 'NOT_YET_INTRODUCED' }
  }
  if (v10cState.currentTarget === 'DIRECT_INGREDIENT' || v10cState.currentTarget === 'BOTH') {
    return { eligible: true, reason: 'DIRECTLY_NAMED' }
  }
  // Condition 3/6: no different component/mixture may have become the target, and the row must
  // show no evidence of exhaustion/replacement. A row that was EVER folded into an established
  // component/mixture/assembly (source-construction OR "laid/added/combined into X") has had its
  // identity absorbed into that larger object; an unnamed continuation afterward (e.g. "cover and
  // cook", "toss to combine") acts on the assembled dish, not on this row specifically, even when
  // the current instruction never re-mentions the component by name. Frozen evidence: every
  // over-accepted V10D regression (pork chops laid over an established rice mixture then "cover
  // and cook"; skewers folded into an established "chicken skewer"; a tortilla folded into an
  // established wrap "assembly"; onion folded into an established dressing mixture) already has a
  // pre-existing component membership, while the genuine accepted continuation (wild rice, "cover
  // and cook" with no prior component membership at all) has none. So require zero PRIOR
  // established memberships for the unnamed-continuation path.
  const everFoldedIntoComponent = componentMembership.some(item =>
    item.establishedAtInstructionIndex >= 0 && item.establishedAtInstructionIndex < candidate.instructionIndex)
  if (everFoldedIntoComponent) return { eligible: false, reason: 'TARGET_SWITCHED_TO_COMPONENT' }
  if (v10cState.quantityState.rowAvailability === 'POSSIBLY_CONSUMED') return { eligible: false, reason: 'ROW_POSSIBLY_EXHAUSTED' }
  const source = normalizeText(candidate.instructionText)
  const genericContinuation = hasManipulationVerb(candidate.instructionText) || CONTINUATION_LANGUAGE_RE.test(source)
  if (!genericContinuation) return { eligible: false, reason: 'NO_CONTINUATION_LANGUAGE' }
  return { eligible: true, reason: 'UNNAMED_CONTINUATION_OF_INTRODUCED_PRINCIPAL', confidence: target.confidence }
}

// ---------------------------------------------------------------------------
// Phase 7 — truth-blind active-object timeline
// ---------------------------------------------------------------------------

const COMPONENT_NOUN_WORDS = [
  'sauce', 'dressing', 'mixture', 'mix', 'marinade', 'rub', 'batter', 'slaw', 'filling',
  'salsa', 'paste', 'glaze', 'broth', 'stock', 'salad', 'wrap', 'stew', 'soup', 'chili',
]

function instructionMentionsComponentWord(instructionText) {
  const source = normalizeText(instructionText)
  return COMPONENT_NOUN_WORDS.filter(word => new RegExp(`\\b${word}\\b`, 'u').test(source))
}

export function buildActiveObjectTimeline(recipe, principalTargets) {
  const timeline = []
  let previouslyActive = new Set()
  for (let index = 0; index < recipe.steps.length; index += 1) {
    const instruction = recipe.steps[index]?.instruction || ''
    const explicitIngredientTargets = recipe.ingredients
      .map((item, ingredientIndex) => ({ item, ingredientIndex }))
      .filter(({ item }) => !item.header && sourceMentionsRow(instruction, item.raw))
      .map(({ ingredientIndex }) => ingredientIndex)
    const componentTargets = instructionMentionsComponentWord(instruction)
    const principalContinuedTargets = []
    for (const target of principalTargets) {
      if (target.introducedAtInstructionIndex === undefined || target.introducedAtInstructionIndex > index) continue
      if (explicitIngredientTargets.includes(target.ingredientIndex)) { principalContinuedTargets.push(target.ingredientIndex); continue }
      if (!previouslyActive.has(target.ingredientIndex)) continue
      if (componentTargets.length && !explicitIngredientTargets.length) continue
      if (hasManipulationVerb(instruction) || CONTINUATION_LANGUAGE_RE.test(normalizeText(instruction))) principalContinuedTargets.push(target.ingredientIndex)
    }
    let targetTransition = 'UNKNOWN'
    if (componentTargets.length && !explicitIngredientTargets.length && !principalContinuedTargets.length) targetTransition = 'SWITCH_TO_COMPONENT'
    else if (explicitIngredientTargets.length > 1) targetTransition = 'MULTIPLE_TARGETS'
    else if (explicitIngredientTargets.length === 1 && !previouslyActive.has(explicitIngredientTargets[0])) targetTransition = 'SWITCH_TO_NEW_INGREDIENT'
    else if (explicitIngredientTargets.length === 1 || principalContinuedTargets.length) targetTransition = 'CONTINUE'
    const active = unique([...explicitIngredientTargets, ...principalContinuedTargets])
    timeline.push({ instructionIndex: index, explicitIngredientTargets, principalContinuedTargets, componentTargets, targetTransition })
    previouslyActive = new Set(active)
  }
  return timeline
}

// ---------------------------------------------------------------------------
// Phase 13 — truth-blind V10D risk facts
// ---------------------------------------------------------------------------

export function extractV10DState(candidate, recipe, allIngredientCandidates, componentCandidates) {
  const v10cState = extractV10CState(candidate, recipe, allIngredientCandidates, componentCandidates)
  const principalTargets = extractPrincipalTargets(recipe)
  const continuation = derivePrincipalContinuation(candidate, principalTargets, v10cState.componentMembership.memberships, v10cState)
  const genericSeasoningAction = detectGenericSeasoningAction(candidate.instructionText)
  const eligibleSeasoningRow = eligibleGenericSeasoningRow(candidate, v10cState.componentMembership.memberships, allIngredientCandidates)
  const matchedPrincipalTarget = principalTargets.find(item => item.ingredientIndex === candidate.ingredientIndex)
  const principalTarget = Boolean(matchedPrincipalTarget)
  const currentObject = genericSeasoningAction && eligibleSeasoningRow ? 'INGREDIENT'
    : v10cState.currentTarget === 'DIRECT_INGREDIENT' ? 'INGREDIENT'
      : v10cState.currentTarget === 'BOTH' ? 'MULTIPLE'
        : v10cState.currentTarget === 'COMPONENT' ? 'COMPONENT'
          : continuation.eligible ? 'INGREDIENT'
            : v10cState.currentTarget === 'AMBIGUOUS' ? 'MULTIPLE' : 'UNKNOWN'
  return validateTruthBlind({
    candidateId: candidate.candidateId,
    v10c: v10cState,
    explicitCurrentMention: v10cState.currentTarget === 'DIRECT_INGREDIENT' || v10cState.currentTarget === 'BOTH',
    principalTarget,
    principalTargetConfidence: matchedPrincipalTarget?.confidence || null,
    principalTargetIntroducedAt: Number.isInteger(matchedPrincipalTarget?.introducedAtInstructionIndex) ? matchedPrincipalTarget.introducedAtInstructionIndex : null,
    principalContinuation: continuation,
    currentObject,
    componentMembership: v10cState.componentMembership,
    genericSeasoningAction,
    eligibleGenericSeasoningRow: eligibleSeasoningRow,
    rowEstablishedAtEarlierInstruction: rowEstablishedAtEarlierInstruction(candidate, allIngredientCandidates),
    continuationBrokenByTargetSwitch: continuation.reason === 'TARGET_SWITCHED_TO_COMPONENT',
    rowAvailability: v10cState.quantityState.rowAvailability,
    quantityState: v10cState.quantityState,
    categoryAliases: resolveCategoryAliases(candidate.ingredientText),
  })
}

// Reuse V10C's exact routing so the risk-review population (and therefore AI-decision
// candidate set) stays identical between V10C and V10D — only the FACTS and ARBITER PROMPT
// change, per Phase 14 ("Only risk-routed frozen candidates need AI arbitration").
export function routeV10DRisk(v10cState) {
  return routeV10CRisk(v10cState)
}
