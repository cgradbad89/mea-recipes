const UNIT_WORDS = new Set([
  'cup', 'cups', 'tablespoon', 'tablespoons', 'tbsp', 'teaspoon', 'teaspoons', 'tsp',
  'pound', 'pounds', 'lb', 'lbs', 'ounce', 'ounces', 'oz', 'gram', 'grams', 'g',
  'clove', 'cloves', 'can', 'cans', 'bunch', 'bunches', 'package', 'packages', 'pinch',
])
const STOP_WORDS = new Set([
  'the', 'and', 'or', 'with', 'for', 'from', 'into', 'of', 'to', 'a', 'an', 'about',
  'more', 'taste', 'optional', 'divided', 'fresh', 'large', 'medium', 'small', 'thinly',
  'finely', 'roughly', 'chopped', 'sliced', 'diced', 'minced', 'trimmed', 'peeled',
  'cut', 'see', 'notes', 'note', 'use', 'using', 'plus', 'extra', 'as', 'needed',
  'wooden', 'soaked', 'minutes', 'minute', 'hours', 'hour',
])
const COMPONENT_NOUNS = [
  'sauce', 'dressing', 'mixture', 'mix', 'broth', 'salad', 'wrap', 'marinade', 'batter',
  'slaw', 'filling', 'paste', 'glaze', 'soup', 'stock', 'salsa', 'cream', 'rub', 'mole',
]

export function normalizeText(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')
}

export function ingredientIdentityTokens(value) {
  return normalizeText(value).split(' ').filter(token => token.length > 1 &&
    !/^\d+$/.test(token) && !UNIT_WORDS.has(token) && !STOP_WORDS.has(token))
}

export function reviewerCount(origins = []) {
  return Number(origins.includes('REVIEWER_A')) + Number(origins.includes('REVIEWER_B'))
}

export function voteClass(origins = []) {
  const count = reviewerCount(origins)
  if (count === 2) return '2_OF_2'
  if (count === 1) return '1_OF_2'
  if (origins.includes('DETERMINISTIC')) return 'DETERMINISTIC_ONLY'
  return 'OTHER'
}

export function quantityText(value) {
  const normalized = normalizeText(value)
  const match = normalized.match(/(?:^|\b)(\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:\.\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])(?:\s+(?:to|-|–)\s*(?:\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:\.\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞]))?\s+(cups?|tablespoons?|tbsp|teaspoons?|tsp|pounds?|lbs?|ounces?|oz|grams?|g|cloves?|cans?|bunch(?:es)?|packages?)\b/)
  return match ? match[0] : undefined
}

function sourceMentionsIngredient(instruction, ingredientText) {
  const source = ` ${normalizeText(instruction)} `
  const tokens = [...new Set(ingredientIdentityTokens(ingredientText))]
  if (!tokens.length) return false
  const distinctive = tokens.filter(token => token.length >= 4)
  const required = distinctive.length > 1 ? Math.min(2, distinctive.length) : 1
  return distinctive.filter(token => source.includes(` ${token} `)).length >= required ||
    tokens.some(token => token.length >= 3 && source.includes(` ${token} `))
}

function duplicateSiblings(candidate, recipe) {
  const tokens = new Set(ingredientIdentityTokens(candidate.ingredientText))
  return recipe.ingredients.map((item, ingredientIndex) => ({ item, ingredientIndex }))
    .filter(({ item, ingredientIndex }) => {
      if (ingredientIndex === candidate.ingredientIndex || item.header) return false
      const sibling = new Set(ingredientIdentityTokens(item.raw))
      if (!tokens.size || !sibling.size) return false
      const intersection = [...tokens].filter(token => sibling.has(token)).length
      return intersection / Math.min(tokens.size, sibling.size) >= 0.8
    })
    .map(({ ingredientIndex }) => ingredientIndex)
}

function matchingComponentLabels(instruction, labels) {
  const source = ` ${normalizeText(instruction)} `
  return [...new Set(labels.map(normalizeText).filter(Boolean))].filter(label => {
    const cleaned = label.replace(/^(?:the|a|an) /, '')
    if (source.includes(` ${cleaned} `)) return true
    const tail = cleaned.split(' ').at(-1)
    return tail && COMPONENT_NOUNS.includes(tail) && source.includes(` ${tail} `)
  })
}

export function extractCandidateRiskFacts(candidate, recipe, allIngredientCandidates, componentCandidates) {
  const instructions = recipe.steps.map(step => step.instruction)
  const explicitlyNamed = sourceMentionsIngredient(candidate.instructionText, candidate.ingredientText)
  const identityTokens = [...new Set(ingredientIdentityTokens(candidate.ingredientText).filter(token => token.length >= 3))]
  const currentSource = ` ${normalizeText(candidate.instructionText)} `
  const matchedIdentityTokens = identityTokens.filter(token => currentSource.includes(` ${token} `))
  const partialIdentityMatchRisk = identityTokens.length > 1 && matchedIdentityTokens.length > 0 &&
    matchedIdentityTokens.length < identityTokens.length && matchedIdentityTokens.every(token => COMPONENT_NOUNS.includes(token) || token === 'oil')
  const siblings = duplicateSiblings(candidate, recipe)
  const priorInstructionMentions = []
  const laterInstructionMentions = []
  for (let index = 0; index < instructions.length; index += 1) {
    if (!sourceMentionsIngredient(instructions[index], candidate.ingredientText)) continue
    if (index < candidate.instructionIndex) priorInstructionMentions.push(index)
    if (index > candidate.instructionIndex) laterInstructionMentions.push(index)
  }
  const priorUses = allIngredientCandidates
    .filter(item => item.recipeId === candidate.recipeId && item.ingredientIndex === candidate.ingredientIndex &&
      item.instructionIndex < candidate.instructionIndex && reviewerCount(item.origins) > 0)
    .map(item => ({ instructionIndex: item.instructionIndex, reviewerCount: reviewerCount(item.origins) }))
    .sort((left, right) => left.instructionIndex - right.instructionIndex)
  const currentComponents = componentCandidates.filter(item => item.recipeId === candidate.recipeId && item.instructionIndex === candidate.instructionIndex)
  const currentComponentLabels = matchingComponentLabels(candidate.instructionText, currentComponents.map(item => item.proposedCanonicalLabel))
  const genericComponentLabels = COMPONENT_NOUNS.filter(noun => new RegExp(`\\b${noun}\\b`, 'i').test(candidate.instructionText))
  const componentLabels = [...new Set([...currentComponentLabels, ...genericComponentLabels])]
  const currentInstructionRefersToComponent = componentLabels.length > 0
  const priorUseIndexes = [...new Set(priorUses.map(item => item.instructionIndex))]
  const establishedInstructionIndex = priorUseIndexes.length ? Math.max(...priorUseIndexes) : undefined
  const currentQuantity = quantityText(candidate.instructionText)
  const listedQuantity = quantityText(candidate.ingredientText)
  const priorUseQuantity = priorUseIndexes.map(index => quantityText(instructions[index])).find(Boolean)
  const current = normalizeText(candidate.instructionText)
  const remainingLanguage = /\b(?:remaining|remainder|rest|reserved|another portion|divided)\b/.test(current)
  const processMaterialRisk = /\b(?:skewers?|ice|water|foil|parchment|oil for (?:frying|greasing))\b/.test(normalizeText(candidate.ingredientText)) && !explicitlyNamed
  const contextualMentionRisk = /\b(?:taste and adjust|adjust seasoning|serve with|for serving|set aside|keep warm|cover and refrigerate|once everything|finished|assemble|build your)\b/.test(current) &&
    (!explicitlyNamed || /\b(?:assemble|build your|taste and adjust|once everything)\b/.test(current))
  const duplicateRowRisk = siblings.length > 0
  const collectiveReferenceRisk = /\b(?:all (?:of )?the ingredients|rest of (?:the )?ingredients|everything|fried ingredients|prepared ingredients)\b/.test(current) && !explicitlyNamed
  const groupNamedByCurrent = ingredientIdentityTokens(candidate.ingredientGroup || '').some(token => current.includes(token))
  const possibleConstituent = currentInstructionRefersToComponent && !explicitlyNamed &&
    (priorUses.length > 0 || groupNamedByCurrent || collectiveReferenceRisk)
  const lifecycleRisk = priorUses.length > 0 && !remainingLanguage &&
    (!explicitlyNamed || currentInstructionRefersToComponent || contextualMentionRisk)
  const groupTokens = ingredientIdentityTokens(candidate.ingredientGroup || '')
  const groupConflictRisk = Boolean(candidate.ingredientGroup) && groupTokens.length > 0 &&
    !groupTokens.some(token => current.includes(token)) && recipe.ingredients.some(item => item.group && item.group !== candidate.ingredientGroup &&
      ingredientIdentityTokens(item.group).some(token => current.includes(token)))
  const quantityConflictRisk = Boolean(listedQuantity && currentQuantity && normalizeText(listedQuantity) !== normalizeText(currentQuantity) && explicitlyNamed)
  return {
    candidateId: candidate.candidateId,
    isExplicitlyNamedInInstruction: explicitlyNamed,
    ingredientGroup: candidate.ingredientGroup,
    duplicateSiblingIndexes: siblings,
    priorInstructionMentions,
    laterInstructionMentions,
    priorReviewerUses: priorUses,
    quantityEvidence: { listedQuantity, currentInstructionQuantity: currentQuantity, priorUseQuantity },
    componentContext: {
      possibleConstituent,
      componentLabels,
      establishedInstructionIndex,
      currentInstructionRefersToComponent,
    },
    remainingLanguage,
    processMaterialRisk,
    contextualMentionRisk,
    duplicateRowRisk,
    groupConflictRisk,
    quantityConflictRisk,
    lifecycleRisk,
    collectiveReferenceRisk,
    partialIdentityMatchRisk,
  }
}

export function routeRisk(facts) {
  const reasons = []
  if (facts.componentContext.possibleConstituent) reasons.push('COMPONENT_CONTAINMENT')
  if (facts.lifecycleRisk) reasons.push('LIFECYCLE')
  if (facts.contextualMentionRisk) reasons.push('CONTEXT_ONLY')
  if (facts.processMaterialRisk) reasons.push('PROCESS_MATERIAL')
  if (facts.duplicateRowRisk) reasons.push('DUPLICATE_ROW')
  if (facts.groupConflictRisk) reasons.push('GROUP_CONFLICT')
  if (facts.quantityConflictRisk) reasons.push('QUANTITY_CONFLICT')
  if (facts.collectiveReferenceRisk) reasons.push('COLLECTIVE_REFERENCE')
  if (facts.partialIdentityMatchRisk) reasons.push('PARTIAL_IDENTITY_MATCH')
  return { route: reasons.length ? 'RISK_REVIEW_REQUIRED' : 'LOW_RISK', reasons }
}

export function classifyRiskFamily(candidate, facts) {
  const instruction = normalizeText(candidate.instructionText)
  if (facts.processMaterialRisk) return 'FRESH_PROCESS_MATERIAL'
  if (facts.quantityConflictRisk) return 'QUANTITY_CONFLICT'
  if (facts.groupConflictRisk) return 'WRONG_GROUP'
  if (facts.duplicateRowRisk) return 'WRONG_DUPLICATE'
  if (facts.componentContext.possibleConstituent) return 'COMPONENT_LEAKAGE'
  if (/\b(?:sandwich|dish|wrap|salad)\b/.test(instruction) && facts.contextualMentionRisk) return 'FINISHED_DISH_COLLISION'
  if (facts.contextualMentionRisk) return 'CONTEXTUAL_MENTION'
  if (facts.lifecycleRisk) return 'CONSUMED_ROW'
  return 'OTHER'
}

export function deterministicContradiction(facts) {
  if (facts.processMaterialRisk && !facts.isExplicitlyNamedInInstruction) return 'FRESH_PROCESS_MATERIAL'
  return null
}

export function validateRiskFacts(value) {
  const forbidden = ['adjudicatedTruth', 'isCorrect', 'shouldReject', 'decision']
  const serialized = JSON.stringify(value)
  for (const field of forbidden) if (serialized.includes(`"${field}"`)) throw new Error(`risk facts leaked forbidden field: ${field}`)
  return value
}

export function candidateMetrics(candidates, acceptedIds) {
  const correct = candidates.filter(item => item.adjudicatedTruth === 'CORRECT').length
  const truePositives = candidates.filter(item => item.adjudicatedTruth === 'CORRECT' && acceptedIds.has(item.candidateId)).length
  const falsePositives = candidates.filter(item => item.adjudicatedTruth === 'INCORRECT' && acceptedIds.has(item.candidateId)).length
  const falseNegatives = correct - truePositives
  const precision = truePositives + falsePositives ? truePositives / (truePositives + falsePositives) : null
  const recall = correct ? truePositives / correct : null
  return {
    truePositives,
    falsePositives,
    falseNegatives,
    precision,
    recall,
    f1: precision === null || recall === null || precision + recall === 0 ? null : 2 * precision * recall / (precision + recall),
  }
}

export function createRiskBatches(candidates, maxSize = 15) {
  if (!Number.isInteger(maxSize) || maxSize < 1 || maxSize > 20) throw new Error('batch size must be 1..20')
  const grouped = new Map()
  for (const candidate of candidates) {
    const values = grouped.get(candidate.recipeId) || []
    values.push(candidate)
    grouped.set(candidate.recipeId, values)
  }
  const batches = []
  for (const [recipeId, values] of grouped) for (let offset = 0; offset < values.length; offset += maxSize) {
    const slice = values.slice(offset, offset + maxSize)
    batches.push({
      batchId: `${recipeId}::${String(offset / maxSize).padStart(3, '0')}`,
      recipeId,
      candidateIds: slice.map(item => item.candidateId),
    })
  }
  return batches
}

export function validateArbiterResults(candidateIds, value) {
  if (!value || !Array.isArray(value.results) || value.results.length !== candidateIds.length) throw new Error('arbiter result count mismatch')
  const expected = new Set(candidateIds)
  const seen = new Set()
  for (const result of value.results) {
    if (!expected.has(result.candidateId)) throw new Error(`unexpected candidateId: ${result.candidateId}`)
    if (seen.has(result.candidateId)) throw new Error(`duplicate candidateId: ${result.candidateId}`)
    seen.add(result.candidateId)
  }
  return value.results
}
