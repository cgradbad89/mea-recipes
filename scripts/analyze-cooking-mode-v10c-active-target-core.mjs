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

export { candidateMetrics, createRiskBatches, normalizeText, reviewerCount, validateArbiterResults, voteClass }

const COMPONENT_WORDS = [
  'sauce', 'dressing', 'mixture', 'mix', 'marinade', 'rub', 'batter', 'slaw', 'filling',
  'salsa', 'paste', 'glaze', 'broth', 'stock', 'salad', 'wrap', 'stew', 'soup', 'chili',
]
const NUMBER = String.raw`(?:\d+\s+\d+\s*[\/\u2044]\s*\d+|\d+\s*[\/\u2044]\s*\d+|\d+\s*[\u00bc-\u00be\u2150-\u215e]|\d+(?:\.\d+)?|[\u00bc-\u00be\u2150-\u215e])`
const RANGE = String.raw`${NUMBER}(?:\s*(?:-|\u2013|to)\s*${NUMBER})?`
const UNITS = String.raw`(?:cups?|tablespoons?|tbsp|teaspoons?|tsp|pounds?|lbs?|ounces?|oz|grams?|g|cloves?|cans?|bunch(?:es)?|packages?|pinches?)`
const QUANTITY_RE = new RegExp(String.raw`(${RANGE}\s+${UNITS})\b`, 'giu')

function unique(values) { return [...new Set(values)] }

export function extractQuantityMentions(value) {
  const source = String(value || '')
  const results = []
  for (const match of source.matchAll(QUANTITY_RE)) {
    results.push({ text: match[1].replace(/\s+/g, ' ').trim(), index: match.index, end: match.index + match[0].length })
  }
  return results
}

export function listedQuantity(value) {
  return extractQuantityMentions(value)[0]?.text
}

function identityTokenMatches(value, ingredientText) {
  const source = normalizeText(value)
  const tokens = unique(ingredientIdentityTokens(ingredientText).filter(token => token.length >= 3))
  return tokens.filter(token => new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'u').test(source))
}

export function sourceMentionsRow(value, ingredientText) {
  const tokens = unique(ingredientIdentityTokens(ingredientText).filter(token => token.length >= 3))
  const matches = identityTokenMatches(value, ingredientText)
  if (!tokens.length) return false
  const distinctive = tokens.filter(token => token.length >= 4 && !COMPONENT_WORDS.includes(token) && token !== 'oil')
  if (distinctive.length) return matches.some(token => distinctive.includes(token))
  return matches.length > 0
}

function clauses(value) {
  const source = String(value || '')
  const parts = []
  let offset = 0
  for (const part of source.split(/(?<=[.;:!?])|,(?=\s+(?:then|and then|while|but)\b)/u)) {
    parts.push({ text: part, offset })
    offset += part.length
  }
  return parts
}

export function rowLocalInstructionQuantity(value, ingredientText) {
  for (const clause of clauses(value)) {
    if (!sourceMentionsRow(clause.text, ingredientText)) continue
    const normalizedClause = normalizeText(clause.text)
    const tokens = ingredientIdentityTokens(ingredientText).filter(token => token.length >= 3)
    const tokenPositions = tokens.map(token => normalizedClause.indexOf(token)).filter(index => index >= 0)
    const rowPosition = tokenPositions.length ? Math.min(...tokenPositions) : Number.POSITIVE_INFINITY
    const quantities = extractQuantityMentions(clause.text)
    const preceding = quantities.filter(item => normalizeText(clause.text.slice(0, item.end)).length <= rowPosition + item.text.length + 3)
    return preceding.at(-1)?.text
  }
  return undefined
}

function usageKind(instruction, quantity, listed) {
  const source = normalizeText(instruction)
  if (/\b(?:remaining|remainder|rest|reserved)\b/.test(source)) return 'REMAINING'
  if (/\b(?:half|third|quarter|portion|some|divided)\b/.test(source)) return 'PARTIAL'
  if (quantity && listed) return normalizeText(quantity) === normalizeText(listed) ? 'ALL' : 'PARTIAL'
  if (/\b(?:all|entire|whole)\b/.test(source)) return 'ALL'
  return 'UNKNOWN'
}

function normalizedComponentLabel(value) {
  return normalizeText(value).replace(/^(?:for|the|a|an)\s+/, '').replace(/\s+ingredients?$/, '').trim()
}

function instructionComponentLabels(value) {
  const source = normalizeText(value)
  const labels = []
  const nounPattern = COMPONENT_WORDS.join('|')
  const named = source.matchAll(new RegExp(`\\b(?:make|prepare|form|create)\\s+(?:the\\s+|a\\s+|an\\s+)?((?:[a-z0-9-]+\\s+){0,3}(?:${nounPattern}))\\b`, 'gu'))
  for (const match of named) labels.push(normalizedComponentLabel(match[1]))
  const ingredientGroup = source.matchAll(new RegExp(`\\b((?:[a-z0-9-]+\\s+){0,2}(?:${nounPattern}))\\s+ingredients?\\b`, 'gu'))
  for (const match of ingredientGroup) labels.push(normalizedComponentLabel(match[1]))
  return unique(labels.filter(Boolean))
}

function labelMentioned(value, label) {
  const source = ` ${normalizeText(value)} `
  const cleaned = normalizedComponentLabel(label)
  if (!cleaned) return false
  if (source.includes(` ${cleaned} `)) return true
  const tail = cleaned.split(' ').at(-1)
  return COMPONENT_WORDS.includes(tail) && source.includes(` ${tail} `)
}

export function extractComponentMembership(candidate, recipe, allIngredientCandidates, componentCandidates) {
  const memberships = []
  const add = membership => {
    if (!membership.componentKey || memberships.some(item => item.componentKey === membership.componentKey && item.establishedAtInstructionIndex === membership.establishedAtInstructionIndex)) return
    memberships.push(membership)
  }
  if (candidate.ingredientGroup) {
    const key = normalizedComponentLabel(candidate.ingredientGroup)
    add({ componentKey: key, establishedAtInstructionIndex: -1, sourceIngredientIndexes: recipe.ingredients.filter(item => !item.header && normalizedComponentLabel(item.group) === key).map(item => item.index), sourceLabel: candidate.ingredientGroup })
  }
  for (let index = 0; index <= candidate.instructionIndex; index += 1) {
    const instruction = recipe.steps[index]?.instruction || ''
    const rowNamed = sourceMentionsRow(instruction, candidate.ingredientText)
    const labels = instructionComponentLabels(instruction)
    for (const label of labels) if (rowNamed || /\b(?:ingredients?|everything)\b/.test(normalizeText(instruction))) {
      const sourceIngredientIndexes = recipe.ingredients.filter(item => !item.header && sourceMentionsRow(instruction, item.raw)).map(item => item.index)
      add({ componentKey: label, establishedAtInstructionIndex: index, sourceIngredientIndexes: unique([...sourceIngredientIndexes, candidate.ingredientIndex]), sourceLabel: label })
    }
  }
  for (const component of componentCandidates.filter(item => item.recipeId === candidate.recipeId)) {
    const established = component.relevantSurroundingSource?.establishingInstructionIndex
    if (!Number.isInteger(established) || established > candidate.instructionIndex) continue
    const establishingText = recipe.steps[established]?.instruction || component.relevantSurroundingSource?.establishingInstructionText || ''
    if (!sourceMentionsRow(establishingText, candidate.ingredientText) && normalizedComponentLabel(candidate.ingredientGroup) !== normalizedComponentLabel(component.relevantSurroundingSource?.sourceLabelOrGroup)) continue
    const label = normalizedComponentLabel(component.proposedCanonicalLabel || component.relevantSurroundingSource?.sourceLabelOrGroup)
    add({ componentKey: label, establishedAtInstructionIndex: established, sourceIngredientIndexes: [candidate.ingredientIndex], sourceLabel: component.relevantSurroundingSource?.sourceLabelOrGroup || component.proposedCanonicalLabel })
  }
  const priorCandidates = allIngredientCandidates.filter(item => item.recipeId === candidate.recipeId && item.ingredientIndex === candidate.ingredientIndex && item.instructionIndex < candidate.instructionIndex)
  if (!memberships.length && priorCandidates.length) {
    const last = Math.max(...priorCandidates.map(item => item.instructionIndex))
    const instruction = recipe.steps[last]?.instruction || ''
    if (sourceMentionsRow(instruction, candidate.ingredientText) && /\b(?:mix|combine|toss|whisk|blend|stir|add)\b/.test(normalizeText(instruction))) {
      add({ componentKey: `instruction-${last}-mixture`, establishedAtInstructionIndex: last, sourceIngredientIndexes: [candidate.ingredientIndex], sourceLabel: 'source mixture' })
    }
  }
  return memberships.sort((left, right) => left.establishedAtInstructionIndex - right.establishedAtInstructionIndex || left.componentKey.localeCompare(right.componentKey))
}

function deriveCurrentTarget(candidate, memberships) {
  const direct = sourceMentionsRow(candidate.instructionText, candidate.ingredientText)
  const component = memberships.some(item => item.establishedAtInstructionIndex < candidate.instructionIndex && labelMentioned(candidate.instructionText, item.componentKey))
  const establishingComponent = memberships.some(item => item.establishedAtInstructionIndex === candidate.instructionIndex)
  const source = normalizeText(candidate.instructionText)
  const identityTokens = ingredientIdentityTokens(candidate.ingredientText).filter(token => token.length >= 3)
  const constituentAliasOnly = component && memberships.some(item => {
    const label = normalizedComponentLabel(item.componentKey)
    return labelMentioned(candidate.instructionText, label) && identityTokens.some(token => label.includes(token)) &&
      !new RegExp(`\\b(?:remaining|reserved|rest)\\b[^.;]{0,30}\\b(?:${identityTokens.join('|')})\\b`, 'u').test(source)
  })
  if (constituentAliasOnly) return 'COMPONENT'
  if (establishingComponent) return 'BOTH'
  if (direct && component) return 'BOTH'
  if (direct) return 'DIRECT_INGREDIENT'
  if (component || establishingComponent) return 'COMPONENT'
  if (/\b(?:everything|mixture|ingredients|seasoning|dish|sandwich|wrap|salad|sauce|dressing|marinade|rub|cover|refrigerate|roast|simmer|serve)\b/.test(source)) return 'AMBIGUOUS'
  return 'NEITHER'
}

function derivePriorUses(candidate, recipe) {
  const priorUses = []
  for (let index = 0; index < candidate.instructionIndex; index += 1) {
    const instruction = recipe.steps[index]?.instruction || ''
    if (!sourceMentionsRow(instruction, candidate.ingredientText)) continue
    const quantityText = rowLocalInstructionQuantity(instruction, candidate.ingredientText)
    priorUses.push({ instructionIndex: index, ...(quantityText ? { quantityText } : {}), usageKind: usageKind(instruction, quantityText, listedQuantity(candidate.ingredientText)) })
  }
  return priorUses
}

export function extractV10CState(candidate, recipe, allIngredientCandidates, componentCandidates) {
  const legacy = extractCandidateRiskFacts(candidate, recipe, allIngredientCandidates, componentCandidates)
  const memberships = extractComponentMembership(candidate, recipe, allIngredientCandidates, componentCandidates)
  const priorUses = derivePriorUses(candidate, recipe)
  const currentUseQuantity = rowLocalInstructionQuantity(candidate.instructionText, candidate.ingredientText)
  const currentKind = usageKind(candidate.instructionText, currentUseQuantity, listedQuantity(candidate.ingredientText))
  const rowAvailability = currentKind === 'REMAINING' ? 'EXPLICITLY_REMAINING'
    : priorUses.some(item => item.usageKind === 'PARTIAL') ? 'PARTIALLY_USED'
      : priorUses.some(item => item.usageKind === 'ALL') ? 'POSSIBLY_CONSUMED'
        : priorUses.length ? 'UNKNOWN' : 'AVAILABLE'
  const currentTarget = deriveCurrentTarget(candidate, memberships)
  const continuingUse = currentKind === 'REMAINING' ? (priorUses.some(item => item.usageKind === 'PARTIAL') ? 'DIVIDED_USE' : 'RESERVED_REMAINDER')
    : currentTarget === 'COMPONENT' && memberships.length ? 'PASSIVE_COMPONENT_CARRY'
      : (currentTarget === 'DIRECT_INGREDIENT' || currentTarget === 'BOTH') && priorUses.length ? 'CONTINUING_MANIPULATION'
        : rowAvailability === 'POSSIBLY_CONSUMED' ? 'FULLY_CONSUMED' : 'UNKNOWN'
  const quantityState = {
    ...(listedQuantity(candidate.ingredientText) ? { listedQuantity: listedQuantity(candidate.ingredientText) } : {}),
    priorUses,
    ...(currentUseQuantity ? { currentUseQuantity } : {}),
    rowAvailability,
  }
  return {
    candidateId: candidate.candidateId,
    quantityState,
    componentMembership: { memberships },
    currentTarget,
    continuingUse,
    directIdentityTokens: identityTokenMatches(candidate.instructionText, candidate.ingredientText),
    legacyRisks: {
      processMaterialRisk: legacy.processMaterialRisk,
      contextualMentionRisk: legacy.contextualMentionRisk,
      duplicateRowRisk: legacy.duplicateRowRisk,
      groupConflictRisk: legacy.groupConflictRisk,
      collectiveReferenceRisk: legacy.collectiveReferenceRisk,
      partialIdentityMatchRisk: legacy.partialIdentityMatchRisk,
      duplicateSiblingIndexes: legacy.duplicateSiblingIndexes,
    },
  }
}

export function routeV10CRisk(state) {
  const reasons = []
  if (state.currentTarget === 'COMPONENT') reasons.push('COMPONENT_TARGET')
  if (state.currentTarget === 'NEITHER') reasons.push('NO_DIRECT_TARGET')
  if (state.currentTarget === 'AMBIGUOUS') reasons.push('AMBIGUOUS_TARGET')
  if (state.continuingUse === 'PASSIVE_COMPONENT_CARRY') reasons.push('PASSIVE_COMPONENT_CARRY')
  if (state.continuingUse === 'FULLY_CONSUMED') reasons.push('POSSIBLY_CONSUMED')
  if (state.legacyRisks.processMaterialRisk) reasons.push('PROCESS_MATERIAL')
  if (state.legacyRisks.contextualMentionRisk) reasons.push('CONTEXT_ONLY')
  if (state.legacyRisks.duplicateRowRisk) reasons.push('DUPLICATE_ROW')
  if (state.legacyRisks.groupConflictRisk) reasons.push('GROUP_CONFLICT')
  if (state.legacyRisks.collectiveReferenceRisk) reasons.push('COLLECTIVE_REFERENCE')
  if (state.legacyRisks.partialIdentityMatchRisk) reasons.push('PARTIAL_IDENTITY_MATCH')
  return { route: reasons.length ? 'RISK_REVIEW_REQUIRED' : 'LOW_RISK', reasons: unique(reasons) }
}

export function validateTruthBlind(value) {
  const serialized = JSON.stringify(value)
  for (const field of ['adjudicatedTruth', 'isCorrect', 'shouldReject', 'expectedIngredientIndexes', 'adjudicatedExpectedIndexes']) {
    if (serialized.includes(`\"${field}\"`)) throw new Error(`V10C state leaked forbidden field: ${field}`)
  }
  return value
}
