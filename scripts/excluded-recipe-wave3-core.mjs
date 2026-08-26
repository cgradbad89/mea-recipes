import { createHash } from 'node:crypto'
import {
  canonicalSerialize,
  compareMappedCorpus,
  documentHash,
  mappedCorpusSafety,
  sha256,
  sourceHash,
  stableJson,
  verifyCorpusChanges,
} from './excluded-recipe-wave2-core.mjs'

export { compareMappedCorpus, mappedCorpusSafety, sha256, sourceHash, stableJson, verifyCorpusChanges }

export const AUTHORIZED_RECIPE_IDS = Object.freeze([
  'chana-masala',
  'dads-chili',
  'easy-chicken-ramen',
  'lemon-herb-pasta-salad-with-marinated-chickpeas',
  'lemongrass-chicken',
  'mole-poblano',
  'tuscan-bean-soup',
])

export const MANIFEST_PATH = 'docs/audits/excluded-recipe-wave3-dryrun-2026-08-26.json'
export const MANIFEST_MD_PATH = 'docs/audits/excluded-recipe-wave3-dryrun-2026-08-26.md'
export const APPLY_PATH = 'docs/audits/excluded-recipe-wave3-apply-2026-08-26.json'
export const APPLY_MD_PATH = 'docs/audits/excluded-recipe-wave3-apply-2026-08-26.md'
export const AUTHORIZED_MANIFEST_SHA256 = '7e3cfeef142e9d42d4e751b5f3c7051ec920e28d44ba61b6665fa57ecce61c0b'

const FORMAT_LINE = /^(?:NOTES|INGREDIENTS|INSTRUCTIONS|Step \d+)$/
const URL_LINE = /^https?:\/\/\S+$/i
const CONTAMINATION_LINE = /^(?:Cook Mode Prevent your screen from going dark|NGREDIENTS|[123] x|NUTRITION)$/i
const INSTRUCTION_CONTAMINATION = /^(?:Recipe adapted with permission|TAME THE HEAT:|SPICE BLEND NOTE:|STORAGE SUGGESTIONS:|CHANGE IT UP:|UPDATE \d|Calories:|Nutritional information|Keep the noodles seperate|I love purchasing frozen chopped lemongrass|If making this with beef or lamb|If making with plant-based meat|This mole can be made well ahead|This Mole Sauce is not spicy|If you want it a little sweeter|some recipes suggest frying|NOTE: If you like a thicker soup|Keep this vegan|This takes a while and actually)/i

const ALLOWED_OPERATIONS = new Set([
  'REMOVE_CONTAMINATION',
  'MOVE_EXISTING_TEXT',
  'NORMALIZE_SECTION_STRUCTURE',
  'RESTORE_EXISTING_TEXT_TO_CORRECT_SECTION',
])

const OPERATIONS = Object.freeze({
  'chana-masala': ['REMOVE_CONTAMINATION', 'MOVE_EXISTING_TEXT', 'NORMALIZE_SECTION_STRUCTURE'],
  'dads-chili': ['MOVE_EXISTING_TEXT', 'NORMALIZE_SECTION_STRUCTURE', 'RESTORE_EXISTING_TEXT_TO_CORRECT_SECTION'],
  'easy-chicken-ramen': ['MOVE_EXISTING_TEXT', 'NORMALIZE_SECTION_STRUCTURE'],
  'lemon-herb-pasta-salad-with-marinated-chickpeas': ['MOVE_EXISTING_TEXT', 'NORMALIZE_SECTION_STRUCTURE', 'RESTORE_EXISTING_TEXT_TO_CORRECT_SECTION'],
  'lemongrass-chicken': ['MOVE_EXISTING_TEXT', 'NORMALIZE_SECTION_STRUCTURE'],
  'mole-poblano': ['REMOVE_CONTAMINATION', 'MOVE_EXISTING_TEXT', 'NORMALIZE_SECTION_STRUCTURE'],
  'tuscan-bean-soup': ['MOVE_EXISTING_TEXT', 'NORMALIZE_SECTION_STRUCTURE'],
})

const REMAINING_WAVE_4_5 = Object.freeze([
  { recipeId: 'chipotle-tahini-bowls', disposition: 'PRODUCT_DECISION_REQUIRED' },
  { recipeId: 'maple-roasted-candied-pecans', disposition: 'MANUAL_SOURCE_REQUIRED' },
  { recipeId: 'mexican-street-corn', disposition: 'REIMPORT_REQUIRED' },
  { recipeId: 'rising-sun-mazcal', disposition: 'REIMPORT_REQUIRED' },
  { recipeId: 'smoothies', disposition: 'PRODUCT_DECISION_REQUIRED' },
  { recipeId: 'spaghetti-carbonara', disposition: 'REIMPORT_REQUIRED' },
  { recipeId: 'speget-with-fake-meat-meatballs', disposition: 'REIMPORT_REQUIRED' },
  { recipeId: 'zesty-quinoa-salad', disposition: 'REIMPORT_REQUIRED' },
])

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function arraysEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function trimmedLines(content) {
  return String(content).split('\n').map(line => line.trim()).filter(Boolean)
}

function exactEntry(originalContent, text, category) {
  assert(originalContent.includes(text), `Original content does not contain exact ${category} fragment: ${text}`)
  return {
    text,
    provenance: { proposedLine: text, originalFragments: [text], transform: 'EXACT', category },
  }
}

function joinedEntry(originalContent, fragments, separator, transform, category) {
  for (const fragment of fragments) {
    assert(originalContent.includes(fragment), `Original content does not contain joined ${category} fragment: ${fragment}`)
  }
  const text = fragments.join(separator)
  return { text, provenance: { proposedLine: text, originalFragments: fragments, transform, category } }
}

function structuralLabelEntry(originalContent, text, category = 'PRESENTATION') {
  assert(originalContent.includes(text), `Original content does not contain structural label: ${text}`)
  const proposedLine = text.endsWith(':') ? text : `${text}:`
  return {
    text: proposedLine,
    provenance: { proposedLine, originalFragments: [text], transform: 'APPEND_STRUCTURAL_COLON', category },
  }
}

function removeStepNumberEntry(originalContent, text, category = 'ACTIONABLE_METHOD') {
  const proposedLine = text.replace(/^\d+\.\s+/, '')
  assert(proposedLine !== text && originalContent.includes(text), `Expected existing numbered step: ${text}`)
  return {
    text: proposedLine,
    provenance: { proposedLine, originalFragments: [text], transform: 'REMOVE_EXISTING_STEP_NUMBER', category },
  }
}

function serializeRepair(parts) {
  const lines = []
  if (parts.lead.length) lines.push(...parts.lead.map(entry => entry.text), '')
  if (parts.notes.length) lines.push('NOTES', ...parts.notes.map(entry => entry.text), '')
  lines.push('INGREDIENTS', ...parts.ingredients.map(entry => entry.text), '', 'INSTRUCTIONS')
  parts.instructions.forEach((entry, index) => lines.push(`Step ${index + 1}`, entry.text))
  return lines.join('\n')
}

function collectMappings(parts) {
  return [...parts.lead, ...parts.notes, ...parts.ingredients, ...parts.instructions].map(entry => entry.provenance)
}

export function validateLineProvenance(originalContent, proposedContent, lineMappings) {
  const substantiveLines = trimmedLines(proposedContent).filter(line => !FORMAT_LINE.test(line))
  const mappedLines = lineMappings.map(mapping => mapping.proposedLine)
  if (!arraysEqual(substantiveLines, mappedLines)) return false

  return lineMappings.every(mapping => {
    if (!Array.isArray(mapping.originalFragments) || mapping.originalFragments.length === 0) return false
    if (!mapping.originalFragments.every(fragment => originalContent.includes(fragment))) return false
    switch (mapping.transform) {
      case 'EXACT':
        return mapping.originalFragments.length === 1 && mapping.proposedLine === mapping.originalFragments[0]
      case 'JOIN_WITH_SPACE':
        return mapping.proposedLine === mapping.originalFragments.join(' ')
      case 'JOIN_WITH_COLON_SPACE':
        return mapping.proposedLine === mapping.originalFragments.join(': ')
      case 'APPEND_STRUCTURAL_COLON':
        return mapping.originalFragments.length === 1 && mapping.proposedLine === `${mapping.originalFragments[0]}:`
      case 'REMOVE_EXISTING_STEP_NUMBER':
        return mapping.originalFragments.length === 1 &&
          /^\d+\.\s+/.test(mapping.originalFragments[0]) &&
          mapping.originalFragments[0].endsWith(mapping.proposedLine)
      default:
        return false
    }
  })
}

function sourceStateFor(live, audit, parseRecipeContent) {
  if (!live?.exists || !isRecord(live.data) || typeof live.data.content !== 'string') return 'SOURCE_CHANGED_UNSAFE'
  const content = live.data.content
  const parsed = parseRecipeContent(content)
  const auditParse = audit?.currentParse
  const exactAuditShape = audit?.recommendedDisposition === 'DATA_FIX_ONLY' &&
    content.length === audit.rawContentAnalysis?.characterCount &&
    arraysEqual(parsed.ingredients, auditParse?.ingredients) &&
    arraysEqual(parsed.instructions, (auditParse?.instructions || []).slice(0, parsed.instructions.length)) &&
    (audit.rawContentAnalysis?.relevantRawTail || []).every(fragment => content.includes(fragment))
  if (exactAuditShape) return 'SOURCE_UNCHANGED'

  const reviewable = audit?.recommendedDisposition === 'DATA_FIX_ONLY' &&
    (audit.rawContentAnalysis?.relevantRawTail || []).every(fragment => content.includes(fragment)) &&
    (auditParse?.ingredients || []).every(fragment => content.includes(fragment))
  return reviewable ? 'SOURCE_CHANGED_REVIEWABLE' : 'SOURCE_CHANGED_UNSAFE'
}

function repairParts(recipeId, originalContent, audit) {
  const raw = trimmedLines(originalContent)
  const auditIngredients = audit.currentParse.ingredients
  const auditInstructions = audit.currentParse.instructions
  const url = raw.find(URL_LINE.test.bind(URL_LINE))
  const lead = url ? [exactEntry(originalContent, url, 'SOURCE')] : []
  let notes = []
  let ingredients = []
  let instructions = []
  let removedContamination = []

  switch (recipeId) {
    case 'chana-masala':
      assert(auditInstructions.length === 12, `${recipeId}: expected twelve audited instruction-span rows`)
      ingredients = auditIngredients.map(line => exactEntry(originalContent, line, 'INGREDIENT'))
      instructions = auditInstructions.slice(0, 6).map(line => exactEntry(originalContent, line, 'ACTIONABLE_METHOD'))
      notes = auditInstructions.slice(6).map(line => exactEntry(originalContent, line, line.startsWith('STORAGE') ? 'STORAGE' : 'TIPS'))
      removedContamination = ['Cook Mode Prevent your screen from going dark']
      break

    case 'dads-chili': { // The audit establishes these exact raw boundaries.
      const ingStart = raw.indexOf('INGREDIENTS')
      const methodStart = raw.indexOf('In a large pot combine V-8, Worchestershire, Chicken stock, tomato paste,')
      const noteStart = raw.findIndex(line => line.startsWith('This takes a while and actually the meat'))
      assert(ingStart !== -1 && methodStart > ingStart && noteStart > methodStart, `${recipeId}: audited boundaries absent`)
      lead.push(exactEntry(originalContent, 'Here is the recipe:', 'DESCRIPTION'))
      ingredients = raw.slice(ingStart + 1, methodStart).map(line => exactEntry(originalContent, line, 'INGREDIENT'))
      const method = raw.slice(methodStart, noteStart)
      assert(method.length === 8, `${recipeId}: expected eight raw method fragments forming seven directions`)
      instructions = [
        joinedEntry(originalContent, method.slice(0, 2), ' ', 'JOIN_WITH_SPACE', 'ACTIONABLE_METHOD'),
        ...method.slice(2).map(line => exactEntry(originalContent, line, 'ACTIONABLE_METHOD')),
      ]
      notes = [exactEntry(originalContent, raw[noteStart], 'TIPS')]
      break
    }

    case 'easy-chicken-ramen':
      assert(auditInstructions.length === 17, `${recipeId}: expected seventeen audited instruction-span rows`)
      ingredients = auditIngredients.map(line => exactEntry(originalContent, line, 'INGREDIENT'))
      instructions = [
        joinedEntry(originalContent, auditInstructions.slice(0, 2), ' ', 'JOIN_WITH_SPACE', 'ACTIONABLE_METHOD'),
        exactEntry(originalContent, auditInstructions[2], 'ACTIONABLE_METHOD'),
        exactEntry(originalContent, auditInstructions[3], 'ACTIONABLE_METHOD'),
        joinedEntry(originalContent, auditInstructions.slice(4, 7), ' ', 'JOIN_WITH_SPACE', 'ACTIONABLE_METHOD'),
        exactEntry(originalContent, auditInstructions[7], 'ACTIONABLE_METHOD'),
        joinedEntry(originalContent, auditInstructions.slice(8, 10), ' ', 'JOIN_WITH_SPACE', 'ACTIONABLE_METHOD'),
        exactEntry(originalContent, auditInstructions[10], 'ACTIONABLE_METHOD'),
        exactEntry(originalContent, auditInstructions[11], 'ACTIONABLE_METHOD'),
        joinedEntry(originalContent, auditInstructions.slice(12, 14), ' ', 'JOIN_WITH_SPACE', 'ACTIONABLE_METHOD'),
      ]
      notes = [
        exactEntry(originalContent, auditInstructions[14], 'STORAGE'),
        exactEntry(originalContent, 'Nutrition', 'METADATA'),
        exactEntry(originalContent, auditInstructions[15], 'METADATA'),
        exactEntry(originalContent, auditInstructions[16], 'METADATA'),
      ]
      break

    case 'lemon-herb-pasta-salad-with-marinated-chickpeas': {
      const chickpea = 'one 14 ounce can chickpeas, drained and rinsed (DeLallo)'
      const firstGroup = auditIngredients.slice(0, 4)
      const pastaGroup = auditIngredients.slice(5)
      assert(auditIngredients[4] === 'Pasta' && originalContent.includes(chickpea), `${recipeId}: audited chickpea group absent`)
      ingredients = [
        structuralLabelEntry(originalContent, 'Marinated Chickpeas'),
        exactEntry(originalContent, chickpea, 'INGREDIENT'),
        ...firstGroup.map(line => exactEntry(originalContent, line, 'INGREDIENT')),
        structuralLabelEntry(originalContent, 'Pasta'),
        ...pastaGroup.map(line => exactEntry(originalContent, line, 'INGREDIENT')),
      ]
      instructions = auditInstructions.map(line => exactEntry(originalContent, line, 'ACTIONABLE_METHOD'))
      break
    }

    case 'lemongrass-chicken':
      assert(auditInstructions.length === 9, `${recipeId}: expected nine audited instruction-span rows`)
      ingredients = auditIngredients.map(line => exactEntry(originalContent, line, 'INGREDIENT'))
      instructions = auditInstructions.slice(0, 6).map(line => exactEntry(originalContent, line, 'ACTIONABLE_METHOD'))
      notes = auditInstructions.slice(6).map(line => exactEntry(originalContent, line, 'TIPS'))
      break

    case 'mole-poblano':
      assert(auditInstructions.length === 22, `${recipeId}: expected twenty-two audited instruction-span rows`)
      ingredients = auditIngredients.map(line => exactEntry(originalContent, line, 'INGREDIENT'))
      instructions = [
        exactEntry(originalContent, auditInstructions[0], 'ACTIONABLE_METHOD'),
        joinedEntry(originalContent, auditInstructions.slice(1, 3), ': ', 'JOIN_WITH_COLON_SPACE', 'ACTIONABLE_METHOD'),
        ...auditInstructions.slice(3, 13).map(line => exactEntry(originalContent, line, 'ACTIONABLE_METHOD')),
        ...auditInstructions.slice(13, 18).map(line => removeStepNumberEntry(originalContent, line)),
      ]
      notes = [
        exactEntry(originalContent, auditInstructions[18], 'STORAGE'),
        ...auditInstructions.slice(19).map(line => exactEntry(originalContent, line, 'TIPS')),
      ]
      removedContamination = ['NGREDIENTS', '1 x', '2 x', '3 x', 'NUTRITION']
      break

    case 'tuscan-bean-soup':
      assert(auditInstructions.length === 9, `${recipeId}: expected nine audited instruction-span rows`)
      ingredients = auditIngredients.map(line => exactEntry(originalContent, line, 'INGREDIENT'))
      instructions = auditInstructions.slice(0, 7).map(line => exactEntry(originalContent, line, 'ACTIONABLE_METHOD'))
      notes = auditInstructions.slice(7).map(line => exactEntry(originalContent, line, 'TIPS'))
      break

    default:
      throw new Error(`Unauthorized recipe ID: ${recipeId}`)
  }

  for (const line of removedContamination) {
    assert(originalContent.includes(line) && (CONTAMINATION_LINE.test(line) || recipeId === 'chana-masala'), `${recipeId}: unapproved contamination removal: ${line}`)
  }
  return { lead, notes, ingredients, instructions, removedContamination }
}

export function isParserClean(parsed) {
  return parsed.ingredients.length > 0 &&
    parsed.instructions.length > 0 &&
    parsed.instructions.every(line =>
      line.length > 10 &&
      !URL_LINE.test(line) &&
      !INSTRUCTION_CONTAMINATION.test(line) &&
      !/^(?:NOTES?|Nutrition|For the Mole Sauce)$/i.test(line),
    )
}

function quantityEvidenceUnchanged(parts) {
  return parts.ingredients.every(entry =>
    entry.provenance.transform === 'EXACT' || entry.provenance.transform === 'APPEND_STRUCTURAL_COLON',
  )
}

function manualInspection(parts, proposedParse, provenancePass) {
  const ingredientLines = new Set(parts.ingredients.map(entry => entry.text))
  const instructionLines = new Set(parts.instructions.map(entry => entry.text))
  const noteLines = new Set(parts.notes.map(entry => entry.text))
  const results = {
    allProposedIngredientsSupportedByExistingContent: provenancePass && proposedParse.ingredients.every(line => ingredientLines.has(line)),
    allQuantitiesIdenticalToExistingEvidence: quantityEvidenceUnchanged(parts),
    allActionableInstructionsSupportedByExistingContent: provenancePass && proposedParse.instructions.every(line => instructionLines.has(line)),
    noSourceNoteBecameInventedCookingStep: proposedParse.instructions.every(line => !noteLines.has(line)),
    noUsefulActionableContentAccidentallyRemoved: parts.instructions.length === proposedParse.instructions.length,
    contaminationAndFooterLinesGoneFromParsedInstructions: proposedParse.instructions.every(line => !INSTRUCTION_CONTAMINATION.test(line)),
    proposedParseIsCoherentRecipe: isParserClean(proposedParse),
  }
  return { ...results, passed: Object.values(results).every(Boolean) }
}

function rowForUnsafeSource(recipeId, live, audit, parseRecipeContent, sourceState, error) {
  const content = typeof live?.data?.content === 'string' ? live.data.content : ''
  const parsed = parseRecipeContent(content)
  return {
    recipeId,
    title: String(live?.data?.title || audit?.title || ''),
    sourceState,
    beforeContentSha256: sha256(content),
    beforeSourceHash: sourceHash(parsed.ingredients, parsed.instructions),
    beforeParse: { ingredients: parsed.ingredients, instructions: parsed.instructions },
    beforeCookingStepIngredientMapExists: live?.data?.cookingStepIngredientMap != null,
    beforeDocumentSnapshot: live?.data ? JSON.parse(canonicalSerialize(live.data)) : null,
    operations: [...OPERATIONS[recipeId]],
    proposedContent: content,
    proposedContentSha256: sha256(content),
    proposedParse: { ingredients: parsed.ingredients, instructions: parsed.instructions },
    provenance: { substantiveTextDerivedFromOriginal: false, inventedRecipeFacts: false, lineMappings: [] },
    safety: { parserClean: false, existingMapAbsent: live?.data?.cookingStepIngredientMap == null, unresolvedSourceGap: true },
    manualInspection: { passed: false },
    classification: 'SKIP',
    skipReason: sourceState === 'SOURCE_CHANGED_UNSAFE' ? 'SOURCE_CHANGED_UNSAFE' : 'SKIP_REQUIRES_SOURCE',
    error,
  }
}

export function buildCorpusBaseline(allRecipes, parseRecipeContent) {
  return [...allRecipes].map(([recipeId, live]) => {
    const parsed = parseRecipeContent(String(live?.data?.content || ''))
    return {
      recipeId,
      contentSha256: sha256(String(live?.data?.content || '')),
      ingredientArraySha256: sha256(JSON.stringify(parsed.ingredients)),
      instructionArraySha256: sha256(JSON.stringify(parsed.instructions)),
      sourceHash: sourceHash(parsed.ingredients, parsed.instructions),
      persistedMapSha256: sha256(canonicalSerialize(live?.data?.cookingStepIngredientMap ?? null)),
      mapPresent: live?.data?.cookingStepIngredientMap != null,
    }
  }).sort((a, b) => a.recipeId.localeCompare(b.recipeId))
}

export function compareCorpusBaseline(baseline, allRecipes, parseRecipeContent, { mappedOnly = false } = {}) {
  const current = new Map(buildCorpusBaseline(allRecipes, parseRecipeContent).map(row => [row.recipeId, row]))
  const rows = mappedOnly ? baseline.filter(row => row.mapPresent) : baseline
  const result = {
    ingredientArrayChanges: [], instructionArrayChanges: [], sourceHashChanges: [],
    persistedMapChanges: [], contentChanges: [], missingRecipes: [], unexpectedRecipes: [],
  }
  for (const row of rows) {
    const live = current.get(row.recipeId)
    if (!live) { result.missingRecipes.push(row.recipeId); continue }
    if (live.ingredientArraySha256 !== row.ingredientArraySha256) result.ingredientArrayChanges.push(row.recipeId)
    if (live.instructionArraySha256 !== row.instructionArraySha256) result.instructionArrayChanges.push(row.recipeId)
    if (live.sourceHash !== row.sourceHash) result.sourceHashChanges.push(row.recipeId)
    if (live.persistedMapSha256 !== row.persistedMapSha256) result.persistedMapChanges.push(row.recipeId)
    if (live.contentSha256 !== row.contentSha256) result.contentChanges.push(row.recipeId)
  }
  if (!mappedOnly) {
    const baselineIds = new Set(baseline.map(row => row.recipeId))
    result.unexpectedRecipes = [...current.keys()].filter(recipeId => !baselineIds.has(recipeId)).sort()
  }
  return result
}

export function buildManifest({ allRecipes, auditRows, parseRecipeContent, createdAt }) {
  const selected = new Map(AUTHORIZED_RECIPE_IDS.map(recipeId => [recipeId, allRecipes.get(recipeId)]))
  assert(arraysEqual([...selected.keys()], [...AUTHORIZED_RECIPE_IDS]), 'Dry-run population must be the exact seven authorized recipe IDs')
  const auditById = new Map(auditRows.map(row => [row.recipeId, row]))
  const rows = AUTHORIZED_RECIPE_IDS.map(recipeId => {
    const live = selected.get(recipeId)
    const audit = auditById.get(recipeId)
    const sourceState = sourceStateFor(live, audit, parseRecipeContent)
    if (sourceState === 'SOURCE_CHANGED_UNSAFE') {
      return rowForUnsafeSource(recipeId, live, audit, parseRecipeContent, sourceState, 'Live source no longer matches the audited repair evidence')
    }
    try {
      assert(live?.exists && isRecord(live.data), `${recipeId}: live recipe is missing`)
      assert(audit?.recommendedDisposition === 'DATA_FIX_ONLY', `${recipeId}: audit disposition mismatch`)
      const beforeContent = String(live.data.content || '')
      const beforeParse = parseRecipeContent(beforeContent)
      const parts = repairParts(recipeId, beforeContent, audit)
      const proposedContent = serializeRepair(parts)
      const proposedParse = parseRecipeContent(proposedContent)
      const lineMappings = collectMappings(parts)
      const provenancePass = validateLineProvenance(beforeContent, proposedContent, lineMappings)
      const parserClean = isParserClean(proposedParse) &&
        arraysEqual(proposedParse.ingredients, parts.ingredients.map(entry => entry.text)) &&
        arraysEqual(proposedParse.instructions, parts.instructions.map(entry => entry.text))
      const inspection = manualInspection(parts, proposedParse, provenancePass)
      const safety = {
        parserClean,
        existingMapAbsent: live.data.cookingStepIngredientMap == null,
        unresolvedSourceGap: false,
      }
      const provenance = {
        substantiveTextDerivedFromOriginal: provenancePass,
        inventedRecipeFacts: false,
        lineMappings,
      }
      const classification = sourceState !== 'SOURCE_CHANGED_UNSAFE' &&
        provenance.substantiveTextDerivedFromOriginal &&
        !provenance.inventedRecipeFacts &&
        Object.values(safety).every((value, index) => index === 2 ? value === false : value === true) &&
        inspection.passed
        ? 'READY'
        : 'SKIP'
      return {
        recipeId,
        title: String(live.data.title || audit.title || ''),
        sourceState,
        beforeContentSha256: sha256(beforeContent),
        beforeSourceHash: sourceHash(beforeParse.ingredients, beforeParse.instructions),
        beforeParse: { ingredients: beforeParse.ingredients, instructions: beforeParse.instructions },
        beforeCookingStepIngredientMapExists: live.data.cookingStepIngredientMap != null,
        beforeDocumentSnapshot: JSON.parse(canonicalSerialize(live.data)),
        operations: [...OPERATIONS[recipeId]],
        exactRemovedContamination: parts.removedContamination,
        proposedContent,
        proposedContentSha256: sha256(proposedContent),
        proposedSourceHash: sourceHash(proposedParse.ingredients, proposedParse.instructions),
        proposedParse: { ingredients: proposedParse.ingredients, instructions: proposedParse.instructions },
        provenance,
        safety,
        manualInspection: inspection,
        classification,
        skipReason: classification === 'SKIP' ? 'SAFETY_GATE_FAILED' : null,
      }
    } catch (error) {
      return rowForUnsafeSource(recipeId, live, audit, parseRecipeContent, sourceState, error instanceof Error ? error.message : String(error))
    }
  }).sort((a, b) => a.recipeId.localeCompare(b.recipeId))

  return {
    schemaVersion: 1,
    wave: 'Wave 3 exact source-evidence-only data repair',
    executionDate: '2026-08-26',
    createdAt,
    authorizedRecipeIds: [...AUTHORIZED_RECIPE_IDS],
    counts: {
      rows: rows.length,
      READY: rows.filter(row => row.classification === 'READY').length,
      SKIP: rows.filter(row => row.classification === 'SKIP').length,
    },
    invariants: {
      parserChanges: 0,
      mappingGeneration: 0,
      mappingWrites: 0,
      aiCalls: 0,
      permittedWriteField: 'content',
      substantiveTextSource: 'exact live stored content and completed audit evidence only',
    },
    corpusBaseline: buildCorpusBaseline(allRecipes, parseRecipeContent),
    rows,
  }
}

export function validateManifest(manifest, expectedSha = null, bytes = null) {
  assert(isRecord(manifest) && manifest.schemaVersion === 1, 'Manifest schema mismatch')
  assert(Array.isArray(manifest.rows) && manifest.rows.length === 7, 'Manifest must contain exactly seven rows')
  assert(arraysEqual(manifest.rows.map(row => row.recipeId), [...AUTHORIZED_RECIPE_IDS]), 'Manifest recipe IDs are not the exact authorized population')
  assert(manifest.rows.every(row => row.operations.every(operation => ALLOWED_OPERATIONS.has(operation))), 'Manifest contains an unauthorized operation')
  assert(manifest.rows.every(row => row.classification === 'READY' || row.classification === 'SKIP'), 'Manifest classification is invalid')
  assert(manifest.rows.every(row => sha256(row.proposedContent) === row.proposedContentSha256), 'Manifest proposed-content hash mismatch')
  assert(manifest.rows.every(row => row.provenance?.inventedRecipeFacts === false), 'Manifest contains an invented-recipe-facts row')
  assert(manifest.rows.filter(row => row.classification === 'READY').every(row =>
    row.provenance.substantiveTextDerivedFromOriginal === true &&
    row.safety.parserClean === true &&
    row.safety.existingMapAbsent === true &&
    row.safety.unresolvedSourceGap === false &&
    row.manualInspection?.passed === true,
  ), 'Manifest READY row failed a safety/review invariant')
  if (expectedSha !== null) {
    assert(bytes !== null, 'Manifest bytes are required for the immutable SHA gate')
    assert(expectedSha !== 'PENDING_DRY_RUN_HASH', 'Apply is disabled until the reviewed manifest SHA is pinned')
    assert(sha256(bytes) === expectedSha, `MANIFEST HASH MISMATCH: expected ${expectedSha}, received ${sha256(bytes)}`)
  }
  return manifest
}

export function writePayload(proposedContent) {
  return { content: proposedContent }
}

export function evaluateManifestRow({ row, live, parseRecipeContent }) {
  if (!AUTHORIZED_RECIPE_IDS.includes(row.recipeId)) return { status: 'ERROR', reason: 'UNAUTHORIZED_RECIPE_ID' }
  if (!live?.exists || !isRecord(live.data)) return { status: 'SKIP', reason: 'RECIPE_MISSING' }
  if (live.data.cookingStepIngredientMap != null) return { status: 'SKIP', reason: 'MAP_ALREADY_PRESENT' }
  const liveContent = typeof live.data.content === 'string' ? live.data.content : ''
  const liveContentSha = sha256(liveContent)
  if (sha256(row.proposedContent) !== row.proposedContentSha256) return { status: 'ERROR', reason: 'PROPOSED_CONTENT_SHA_MISMATCH' }
  const parsed = parseRecipeContent(liveContent)
  if (liveContentSha === row.proposedContentSha256) {
    const exactParse = arraysEqual(parsed.ingredients, row.proposedParse.ingredients) && arraysEqual(parsed.instructions, row.proposedParse.instructions)
    return exactParse && isParserClean(parsed)
      ? { status: 'SKIP', reason: 'ALREADY_APPLIED' }
      : { status: 'ERROR', reason: 'ALREADY_APPLIED_PARSE_MISMATCH' }
  }
  if (liveContentSha !== row.beforeContentSha256) return { status: 'SKIP', reason: 'LIVE_CONTENT_SHA_MISMATCH', liveContentSha }
  const liveSourceHash = sourceHash(parsed.ingredients, parsed.instructions)
  if (liveSourceHash !== row.beforeSourceHash) return { status: 'SKIP', reason: 'LIVE_SOURCE_HASH_MISMATCH', liveSourceHash }
  const proposedParse = parseRecipeContent(row.proposedContent)
  const exactParse = arraysEqual(proposedParse.ingredients, row.proposedParse.ingredients) && arraysEqual(proposedParse.instructions, row.proposedParse.instructions)
  if (!exactParse || !isParserClean(proposedParse)) return { status: 'SKIP', reason: 'PROPOSED_PARSE_NOT_CLEAN' }
  if (!validateLineProvenance(liveContent, row.proposedContent, row.provenance.lineMappings)) return { status: 'ERROR', reason: 'INVENTED_TEXT_DETECTED' }
  if (row.provenance.inventedRecipeFacts !== false) return { status: 'ERROR', reason: 'INVENTED_RECIPE_FACTS_FLAG' }
  return {
    status: 'READY_TO_WRITE',
    updateTime: live.updateTime,
    beforeDocumentHash: documentHash(live.data),
    beforeNonContentHash: documentHash(live.data, { excludeContent: true }),
  }
}

export function buildApplyPlan({ manifest, liveById, parseRecipeContent }) {
  const readyToWrite = []
  const skipped = manifest.rows.filter(row => row.classification === 'SKIP').map(row => ({
    recipeId: row.recipeId, title: row.title, status: 'SKIP', reason: row.skipReason || 'MANIFEST_SKIP',
  }))
  const errors = []
  for (const row of manifest.rows.filter(item => item.classification === 'READY')) {
    try {
      const result = evaluateManifestRow({ row, live: liveById.get(row.recipeId), parseRecipeContent })
      if (result.status === 'READY_TO_WRITE') readyToWrite.push({ row, ...result })
      else if (result.status === 'SKIP') skipped.push({ recipeId: row.recipeId, title: row.title, ...result })
      else errors.push({ recipeId: row.recipeId, ...result })
    } catch (error) {
      errors.push({ recipeId: row.recipeId, status: 'ERROR', reason: error instanceof Error ? error.message : String(error) })
    }
  }
  return { readyToWrite, skipped, errors }
}

export async function commitContentPlan(db, plan) {
  assert(plan.errors.length === 0, 'Unexpected pre-apply errors abort all writes')
  assert(plan.readyToWrite.length <= 7, 'Write plan exceeds the exact seven-recipe authorization')
  if (plan.readyToWrite.length === 0) return { batchCount: 0, attemptedWrites: 0, committedWrites: 0, writtenRecipeIds: [] }
  const batch = db.batch()
  for (const item of plan.readyToWrite) {
    assert(AUTHORIZED_RECIPE_IDS.includes(item.row.recipeId), `Unauthorized write ID: ${item.row.recipeId}`)
    const payload = writePayload(item.row.proposedContent)
    assert(Object.keys(payload).length === 1 && Object.hasOwn(payload, 'content'), 'Write payload must contain only content')
    assert(item.updateTime, `${item.row.recipeId}: missing update-time precondition`)
    batch.update(db.collection('recipes').doc(item.row.recipeId), payload, { lastUpdateTime: item.updateTime })
  }
  await batch.commit()
  return {
    batchCount: 1,
    attemptedWrites: plan.readyToWrite.length,
    committedWrites: plan.readyToWrite.length,
    writtenRecipeIds: plan.readyToWrite.map(item => item.row.recipeId),
  }
}

export function verifyReadback({ manifest, plan, liveById, parseRecipeContent }) {
  const intended = new Map(plan.readyToWrite.map(item => [item.row.recipeId, item]))
  const rows = manifest.rows.map(row => {
    const item = intended.get(row.recipeId)
    if (!item) return { recipeId: row.recipeId, status: 'NOT_WRITTEN' }
    const live = liveById.get(row.recipeId)
    const parsed = live?.exists ? parseRecipeContent(String(live.data.content || '')) : { ingredients: [], instructions: [] }
    const checks = {
      exists: Boolean(live?.exists),
      exactContent: live?.data?.content === row.proposedContent,
      exactParse: arraysEqual(parsed.ingredients, row.proposedParse.ingredients) && arraysEqual(parsed.instructions, row.proposedParse.instructions),
      nonContentFields: Boolean(live?.exists && documentHash(live.data, { excludeContent: true }) === item.beforeNonContentHash),
      mapAbsent: Boolean(live?.exists && live.data.cookingStepIngredientMap == null),
      parserClean: isParserClean(parsed),
    }
    return { recipeId: row.recipeId, status: Object.values(checks).every(Boolean) ? 'WRITTEN_AND_VERIFIED' : 'UNEXPECTED_STATE', checks, exactContentReadback: live?.data?.content || null }
  })
  const written = rows.filter(row => row.status !== 'NOT_WRITTEN')
  return {
    rows,
    writtenRowsReread: written.length,
    exactContentMatches: written.filter(row => row.checks.exactContent).length,
    exactParseMatches: written.filter(row => row.checks.exactParse).length,
    nonContentMismatches: written.filter(row => !row.checks.nonContentFields).length,
    mapFieldsPresent: written.filter(row => !row.checks.mapAbsent).length,
    unexpectedStates: written.filter(row => row.status === 'UNEXPECTED_STATE').length,
  }
}

export function auditRemainingExcluded({ manifest, liveById, parseRecipeContent }) {
  const remaining = [...REMAINING_WAVE_4_5]
  for (const row of manifest.rows) {
    const live = liveById.get(row.recipeId)
    const parsed = live?.exists ? parseRecipeContent(String(live.data.content || '')) : { ingredients: [], instructions: [] }
    const repaired = live?.exists && live.data.content === row.proposedContent && isParserClean(parsed) && live.data.cookingStepIngredientMap == null
    if (!repaired) remaining.push({ recipeId: row.recipeId, disposition: 'DATA_FIX_ONLY' })
  }
  remaining.sort((a, b) => a.recipeId.localeCompare(b.recipeId))
  return { count: remaining.length, recipes: remaining }
}

export function manifestMarkdown(manifest, manifestSha, corpusSafety) {
  const rows = manifest.rows.map(row => `| \`${row.recipeId}\` | ${row.sourceState} | ${row.operations.join(', ')} | ${row.classification} | ${row.proposedParse.ingredients.length} | ${row.proposedParse.instructions.length} | ${row.manualInspection?.passed ?? false} |`).join('\n')
  return `# Excluded Recipe Wave 3 Dry Run — 2026-08-26\n\n## Executive result\n\n**${manifest.counts.SKIP === 0 ? 'PASS' : 'PASS WITH SKIPS'}** — immutable seven-recipe source-evidence-only content repair manifest. Production was read-only.\n\n- Manifest SHA-256: \`${manifestSha}\`\n- READY / SKIP: **${manifest.counts.READY} / ${manifest.counts.SKIP}**\n- Mapped corpus: **${corpusSafety.mappedRecipes}**\n- Mapped stored sourceHash mismatches: **${corpusSafety.storedHashMismatches.length}**\n- Parser changes: **0**\n- Mapping generation/writes: **0 / 0**\n- AI calls: **0**\n\n## Rows\n\n| Recipe | Source state | Operations | Classification | Ingredients | Instructions | 7-question review |\n|---|---|---|---:|---:|---:|---:|\n${rows}\n\nEvery substantive proposed line has an explicit mapping to one or more exact fragments in the corresponding raw live document. Added text is limited to section/step labels and structural punctuation.\n`
}

export function applyMarkdown(report) {
  const rows = report.readback.rows.map(row => `| \`${row.recipeId}\` | ${row.status} | ${row.checks?.exactContent ?? 'n/a'} | ${row.checks?.exactParse ?? 'n/a'} | ${row.checks?.nonContentFields ?? 'n/a'} | ${row.checks?.mapAbsent ?? 'n/a'} |`).join('\n')
  const remaining = report.remainingExcludedPopulation.recipes.map(row => `- \`${row.recipeId}\` — ${row.disposition}`).join('\n')
  return `# Excluded Recipe Wave 3 Apply — 2026-08-26\n\n## Executive result\n\n**${report.executiveResult}**\n\n- Manifest: \`${report.manifest.path}\`\n- Manifest SHA-256: \`${report.manifest.sha256}\`\n- Pre-apply READY / SKIP: **${report.preApply.readyToWrite} / ${report.preApply.skipped}**\n- Writes attempted / committed: **${report.apply.attemptedWrites} / ${report.apply.committedWrites}**\n- Exact content readbacks: **${report.readback.exactContentMatches}/${report.readback.writtenRowsReread}**\n- Exact parse readbacks: **${report.readback.exactParseMatches}/${report.readback.writtenRowsReread}**\n- Non-content mismatches: **${report.readback.nonContentMismatches}**\n- Unexpected maps: **${report.readback.mapFieldsPresent}**\n- Map writes: **0**\n- AI calls: **0**\n- Post-apply READY_TO_WRITE: **${report.postApply.readyToWrite}**\n- Remaining excluded recipes: **${report.remainingExcludedPopulation.count}**\n\n## Readback\n\n| Recipe | Status | Exact content | Exact parse | Non-content unchanged | Map absent |\n|---|---|---:|---:|---:|---:|\n${rows}\n\n## Remaining Wave 4/5 population\n\n${remaining}\n`
}

export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
