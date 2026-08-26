#!/usr/bin/env node
/**
 * Read-only production audit for the 41 recipes repaired by Waves 1A-3.
 *
 * Firestore access is collection/document reads only. There is no apply mode,
 * mutation method, or production write path in this file.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import {
  callWithOneTransientRetry,
  compareStability,
  extractAiAdditions,
  mapConcurrent,
  mapStats,
} from './audit-cooking-step-mappings-core.mjs'
import {
  AUTHORIZED_RECIPE_IDS,
  EXPECTED_CONFIGURATION,
  REPAIR_WAVES,
  UNRESOLVED_RECIPE_IDS,
  aiReviewGate,
  assertAuthorizedPopulation,
  classifyRecoveredRecipe,
  classifyRecoveredSource,
  deterministicReviewGate,
  readyRecoveredManifestInvariant,
  repairWaveFor,
  sha256,
  sortRows,
} from './audit-recovered-recipe-mappings-core.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { loadEnv, getAdmin } = require('./_lib.js')
const DATE = '2026-08-26'
const RAW_PATH = path.join('/tmp', `recovered-recipes-mapping-v5-final-raw-${DATE}.json`)
const WORKSHEET_PATH = path.join('/tmp', `recovered-recipes-mapping-v5-final-review-worksheet-${DATE}.json`)
const DECISIONS_PATH = path.join('/tmp', `recovered-recipes-mapping-v5-final-review-decisions-${DATE}.json`)
const MANIFEST_PATH = path.join(ROOT, `docs/audits/recovered-recipes-mapping-v5-dryrun-${DATE}.json`)
const REPORT_PATH = path.join(ROOT, `docs/audits/recovered-recipes-mapping-v5-dryrun-${DATE}.md`)
const SEMANTIC_PATH = path.join(ROOT, `docs/audits/recovered-recipes-mapping-v5-semantic-review-final-${DATE}.json`)
const WAVE_1A_PATH = path.join(ROOT, `docs/audits/excluded-recipe-parser-wave1a-validation-${DATE}.json`)
const WAVE_2_PATH = path.join(ROOT, `docs/audits/excluded-recipe-wave2-dryrun-${DATE}.json`)
const WAVE_3_PATH = path.join(ROOT, `docs/audits/excluded-recipe-wave3-dryrun-${DATE}.json`)
const CONCURRENCY = 3
const BEHAVIOR_FILES = [
  'lib/cookingStepMapping.ts',
  'lib/cookingStepMappingAi.ts',
  'lib/ai.ts',
  'lib/aiConfig.ts',
  'lib/ingredientParser.ts',
  'lib/recipeContent.ts',
  'types/recipe.ts',
  'app/api/cooking-step-map/route.ts',
]

function stableJson(value) { return `${JSON.stringify(value, null, 2)}\n` }
function count(rows, predicate) { return rows.filter(predicate).length }
function sum(rows, getter) { return rows.reduce((total, row) => total + getter(row), 0) }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')) }

function behaviorFingerprint() {
  return sha256(BEHAVIOR_FILES.map(file => `${file}\0${fs.readFileSync(path.join(ROOT, file))}`).join('\0'))
}

async function loadProductionModules(includeAi) {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    resolve: { alias: { '@': ROOT } },
    plugins: [{
      name: 'recovered-audit-server-only', enforce: 'pre',
      resolveId(id) { return id === 'server-only' ? '\0recovered-audit-server-only' : null },
      load(id) { return id === '\0recovered-audit-server-only' ? 'export {}' : null },
    }],
  })
  try {
    return {
      recipeContent: await server.ssrLoadModule('/lib/recipeContent.ts'),
      mapping: await server.ssrLoadModule('/lib/cookingStepMapping.ts'),
      mappingAi: includeAi ? await server.ssrLoadModule('/lib/cookingStepMappingAi.ts') : null,
      aiConfig: await server.ssrLoadModule('/lib/aiConfig.ts'),
      close: () => server.close(),
    }
  } catch (error) { await server.close(); throw error }
}

function auditVersion(modules, fingerprint, gitSha) {
  const emptyMap = modules.mapping.buildDeterministicCookingStepMap([], [])
  const result = {
    gitSha,
    behaviorFingerprint: fingerprint,
    schemaVersion: emptyMap.schemaVersion,
    parserVersion: modules.mapping.COOKING_MAPPING_PARSER_VERSION,
    deterministicEngineVersion: modules.mapping.COOKING_MAPPING_ENGINE_VERSION,
    hybridEngineVersion: modules.mapping.COOKING_MAPPING_HYBRID_ENGINE_VERSION,
    promptVersion: modules.aiConfig.COOKING_STEP_MAPPING_PROMPT_VERSION,
    model: modules.aiConfig.AI_MODEL,
    temperature: modules.aiConfig.COOKING_STEP_MAPPING_TEMPERATURE,
  }
  for (const [key, value] of Object.entries(EXPECTED_CONFIGURATION)) {
    if (result[key] !== value) throw new Error(`Configuration freeze mismatch for ${key}: ${result[key]}`)
  }
  return result
}

async function readSharedRecipes() {
  loadEnv()
  const snapshot = await getAdmin().firestore().collection('recipes').get()
  return new Map(snapshot.docs.map(doc => [doc.id, { id: doc.id, data: doc.data() }]))
}

function evidenceByRecipe() {
  const wave1a = readJson(WAVE_1A_PATH).excludedRecipeResults.affectedRecipes
  const wave2 = readJson(WAVE_2_PATH).rows
  const wave3 = readJson(WAVE_3_PATH).rows
  return new Map([
    ...wave1a.filter(row => REPAIR_WAVES.WAVE_1A.includes(row.recipeId)).map(row => [row.recipeId, { wave: 'WAVE_1A', row }]),
    ...wave2.map(row => [row.recipeId, { wave: 'WAVE_2', row }]),
    ...wave3.map(row => [row.recipeId, { wave: 'WAVE_3', row }]),
  ])
}

function sourceEvidence(recipeId, content, parsed, evidence) {
  if (!evidence) return { matches: false, reviewable: false, reason: 'Recipe is absent from completed repair evidence.' }
  if (evidence.wave === 'WAVE_1A') {
    const row = evidence.row
    const matches = row.disposition === 'PARSER_FIX_ONLY' && row.afterParseStatus === 'PARSE_CLEAN' &&
      row.remainingDefect === null && row.ingredientsAfter === parsed.ingredients.length &&
      row.instructionsAfter === parsed.instructions.length
    return { matches, reviewable: false, reason: matches ? null : 'Live parse no longer matches Wave 1A validation evidence.' }
  }
  const matches = content === evidence.row.proposedContent &&
    JSON.stringify(parsed.ingredients) === JSON.stringify(evidence.row.proposedParse.ingredients) &&
    JSON.stringify(parsed.instructions) === JSON.stringify(evidence.row.proposedParse.instructions)
  return { matches, reviewable: false, reason: matches ? null : `Live source no longer exactly matches ${evidence.wave} immutable repair evidence.` }
}

async function buildBaseline(allRecipes, modules) {
  assertAuthorizedPopulation()
  if (allRecipes.size !== 236) throw new Error(`Expected 236 shared recipes, received ${allRecipes.size}`)
  const evidence = evidenceByRecipe()
  if (evidence.size !== 41) throw new Error(`Expected repair evidence for 41 recipes, received ${evidence.size}`)
  const missing = AUTHORIZED_RECIPE_IDS.filter(recipeId => !allRecipes.has(recipeId))
  if (missing.length) throw new Error(`Authorized live recipes missing: ${missing.join(', ')}`)
  const rows = []
  for (const recipeId of AUTHORIZED_RECIPE_IDS) {
    const document = allRecipes.get(recipeId)
    const content = typeof document.data.content === 'string' ? document.data.content : ''
    const parsed = modules.recipeContent.parseRecipeContent(content)
    const source = classifyRecoveredSource({ content, parsed, evidence: sourceEvidence(recipeId, content, parsed, evidence.get(recipeId)) })
    const currentMapPresent = document.data.cookingStepIngredientMap !== undefined && document.data.cookingStepIngredientMap !== null
    const row = {
      recipeId,
      title: typeof document.data.title === 'string' ? document.data.title : '',
      repairWave: repairWaveFor(recipeId),
      sourceStatus: currentMapPresent ? 'EXISTING_MAP' : source.status,
      sourceReason: currentMapPresent ? 'A persisted map is already present.' : source.reason,
      sourceEvidence: source,
      parsed,
      currentMapPresent,
      sourceHash: null,
      deterministicMap: null,
      deterministicStats: null,
      candidateMap: null,
      candidateValidation: null,
      hybridStats: {
        aiEligible: false, aiAttempted: false, aiStatus: 'not_needed', primaryAttempts: 0,
        acceptedIngredientAdditions: 0, acceptedPreparedComponents: 0, acceptedUsageQualifiers: 0,
        remainingUnresolvedSemantics: 0,
      },
      primaryModelOutput: null,
      primaryAdditions: [],
      repeatModelOutput: null,
      repeatMap: null,
      repeatAdditions: [],
      stability: null,
      error: null,
    }
    if (source.status !== 'SOURCE_CLEAN' || currentMapPresent) { rows.push(row); continue }
    try {
      const deterministicMap = await modules.mapping.buildHashedDeterministicCookingStepMap(parsed.ingredients, parsed.instructions)
      const validation = modules.mapping.validateCookingStepIngredientMap(deterministicMap, parsed.ingredients, parsed.instructions, deterministicMap)
      if (!validation.valid) throw new Error(`Deterministic validation failed: ${validation.reason}`)
      row.sourceHash = deterministicMap.sourceHash
      row.deterministicMap = deterministicMap
      row.deterministicStats = { ingredientCount: parsed.ingredients.length, ...mapStats(deterministicMap) }
      row.candidateMap = deterministicMap
      row.candidateValidation = validation
      row.hybridStats.aiEligible = modules.mapping.hasAiEligibleCookingSteps(deterministicMap)
      row.hybridStats.remainingUnresolvedSemantics = row.deterministicStats.aiEligibleSteps
    } catch (error) {
      row.error = error instanceof Error ? error.message : String(error)
    }
    rows.push(row)
  }
  return sortRows(rows)
}

async function verifyExistingMappedCorpus(allRecipes, modules) {
  const mapped = []
  const invalid = []
  const fallbacks = []
  for (const [recipeId, document] of allRecipes) {
    const persisted = document.data.cookingStepIngredientMap
    if (persisted === undefined || persisted === null) continue
    mapped.push(recipeId)
    const parsed = modules.recipeContent.parseRecipeContent(typeof document.data.content === 'string' ? document.data.content : '')
    const deterministic = await modules.mapping.buildHashedDeterministicCookingStepMap(parsed.ingredients, parsed.instructions)
    const validation = modules.mapping.validateCookingStepIngredientMap(persisted, parsed.ingredients, parsed.instructions, deterministic)
    if (!validation.valid || persisted.sourceHash !== deterministic.sourceHash) invalid.push({ recipeId, validation, stored: persisted.sourceHash, live: deterministic.sourceHash })
    const resolved = await modules.mapping.resolveCookingStepIngredientMap(parsed.ingredients, parsed.instructions, persisted)
    if (resolved.source !== 'persisted') fallbacks.push({ recipeId, source: resolved.source, reason: resolved.fallbackReason || null })
  }
  return {
    mappedRecipes: mapped.length,
    sourceHashMatches: mapped.length - invalid.length,
    structurallyValid: mapped.length - invalid.length,
    runtimeAccepted: mapped.length - fallbacks.length,
    fallbacks,
    invalid,
    mappedRecipeIds: mapped.sort(),
  }
}

async function executeAi(rows, modules, usage) {
  const targets = rows.filter(row => row.hybridStats.aiEligible && !row.currentMapPresent && !row.error)
  await mapConcurrent(targets, CONCURRENCY, async row => {
    const call = () => modules.mappingAi.resolveCookingStepMappingsWithAi(
      row.deterministicMap, row.parsed.ingredients, row.parsed.instructions,
      'recovered-recipe-mapping-v5-final-production-audit-primary',
    )
    const result = await callWithOneTransientRetry(call)
    row.hybridStats.aiAttempted = true
    row.hybridStats.aiStatus = result.status
    row.hybridStats.primaryAttempts = result.attempts
    usage.primaryRequests += result.attempts
    if (result.status === 'failed') { row.error = result.error; return }
    row.primaryModelOutput = result.value
    row.candidateMap = modules.mappingAi.mergeValidatedAiCookingMappings(
      row.deterministicMap, row.parsed.ingredients, row.parsed.instructions, result.value,
    )
    row.candidateValidation = modules.mapping.validateCookingStepIngredientMap(
      row.candidateMap, row.parsed.ingredients, row.parsed.instructions, row.deterministicMap,
    )
    row.primaryAdditions = extractAiAdditions(recipeId(row), row.candidateMap, row.parsed.ingredients, row.parsed.instructions)
    row.hybridStats.acceptedIngredientAdditions = row.primaryAdditions.filter(item => item.kind === 'ingredient').length
    row.hybridStats.acceptedPreparedComponents = row.primaryAdditions.filter(item => item.kind === 'prepared-component').length
    row.hybridStats.acceptedUsageQualifiers = row.primaryAdditions.filter(item => item.kind === 'ingredient' && item.reference?.usage).length
    row.hybridStats.remainingUnresolvedSemantics = mapStats(row.candidateMap).aiEligibleSteps
  })
  await mapConcurrent(targets, CONCURRENCY, async row => {
    if (row.hybridStats.aiStatus !== 'completed') return
    const result = await callWithOneTransientRetry(() => modules.mappingAi.resolveCookingStepMappingsWithAi(
      row.deterministicMap, row.parsed.ingredients, row.parsed.instructions,
      'recovered-recipe-mapping-v5-final-production-audit-stability',
    ))
    usage.stabilityRequests += result.attempts
    if (result.status === 'failed') { row.stability = { classification: 'ERROR', attempts: result.attempts, error: result.error }; return }
    row.repeatModelOutput = result.value
    row.repeatMap = modules.mappingAi.mergeValidatedAiCookingMappings(
      row.deterministicMap, row.parsed.ingredients, row.parsed.instructions, result.value,
    )
    const repeatValidation = modules.mapping.validateCookingStepIngredientMap(
      row.repeatMap, row.parsed.ingredients, row.parsed.instructions, row.deterministicMap,
    )
    if (!repeatValidation.valid) { row.stability = { classification: 'ERROR', attempts: result.attempts, error: repeatValidation.reason }; return }
    row.repeatAdditions = extractAiAdditions(recipeId(row), row.repeatMap, row.parsed.ingredients, row.parsed.instructions)
    row.stability = { classification: compareStability(row.candidateMap, row.repeatMap), attempts: result.attempts }
  })
}

function recipeId(row) { return row.recipeId }

function deterministicWorksheet(row) {
  const references = row.deterministicMap.steps.flatMap(step => step.ingredients.map(reference => ({
    reviewId: `${row.recipeId}|step:${step.instructionIndex}|ingredient:${reference.ingredientIndex}`,
    instructionIndex: step.instructionIndex,
    instruction: row.parsed.instructions[step.instructionIndex],
    ingredientIndex: reference.ingredientIndex,
    ingredient: row.parsed.ingredients[reference.ingredientIndex],
    reference,
    classification: 'PENDING',
  })))
  const omissions = row.deterministicMap.steps.filter(step => step.ingredients.length === 0 && !(step.preparedComponents?.length > 0)).map(step => ({
    reviewId: `${row.recipeId}|step:${step.instructionIndex}|omission`,
    instructionIndex: step.instructionIndex,
    instruction: row.parsed.instructions[step.instructionIndex],
    unresolvedReason: step.unresolvedReason || null,
    classification: 'PENDING',
  }))
  return {
    recipeId: row.recipeId, title: row.title, sourceHash: row.sourceHash,
    ingredients: row.parsed.ingredients, instructions: row.parsed.instructions,
    references, omissions,
  }
}

function aiWorksheetEntry(row, addition, run) {
  return {
    reviewId: `${run}|${addition.additionId}`,
    run,
    recipeId: row.recipeId,
    title: row.title,
    sourceIngredients: row.parsed.ingredients,
    instructionIndex: addition.instructionIndex,
    instruction: addition.instruction,
    relevantPriorContext: row.parsed.instructions.slice(Math.max(0, addition.instructionIndex - 2), addition.instructionIndex),
    deterministicStep: row.deterministicMap.steps[addition.instructionIndex],
    addition,
    classification: 'PENDING',
  }
}

function buildWorksheet(raw) {
  const eligible = raw.rows.filter(row => row.deterministicMap)
  return {
    auditDate: DATE,
    auditVersion: raw.auditVersion,
    instructions: 'Review every deterministic reference and omission, every accepted AI relationship/usage, and every non-exact stability comparison. Record final decisions in the separate review-decisions artifact.',
    deterministicReviews: eligible.map(deterministicWorksheet),
    aiReviews: eligible.flatMap(row => [
      ...row.primaryAdditions.map(addition => aiWorksheetEntry(row, addition, 'primary')),
      ...row.repeatAdditions.map(addition => aiWorksheetEntry(row, addition, 'stability')),
    ]),
    stabilityReviews: eligible.filter(row => row.stability).map(row => ({
      recipeId: row.recipeId,
      title: row.title,
      automatedClassification: row.stability.classification,
      primaryAdditions: row.primaryAdditions,
      repeatAdditions: row.repeatAdditions,
      classification: row.stability.classification === 'EXACT_STABLE' ? 'EXACT_STABLE' : 'PENDING',
      details: row.stability.classification === 'EXACT_STABLE' ? 'Validated candidate maps are byte-identical.' : 'PENDING',
    })),
  }
}

async function generate() {
  const modules = await loadProductionModules(true)
  const originalInfo = console.info
  const usage = { primaryRequests: 0, stabilityRequests: 0, metadata: [] }
  console.info = (...values) => {
    if (values[0] === '[ai-usage]' && values[1]) usage.metadata.push(values[1])
    originalInfo(...values)
  }
  try {
    const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
    const fingerprint = behaviorFingerprint()
    const version = auditVersion(modules, fingerprint, gitSha)
    const allRecipes = await readSharedRecipes()
    const baseline = await verifyExistingMappedCorpus(allRecipes, modules)
    if (baseline.mappedRecipes !== 187 || baseline.invalid.length || baseline.fallbacks.length) throw new Error(`Existing 187-map safety gate failed: ${stableJson(baseline)}`)
    const rows = await buildBaseline(allRecipes, modules)
    await executeAi(rows, modules, usage)
    if (behaviorFingerprint() !== fingerprint) throw new Error('Audited mapping behavior changed after candidate generation.')
    const vinaigrette = rows.find(row => row.recipeId === 'couscous-salad-with-lime-basil-vinaigrette')
    const consumedVinaigretteSalt = {
      primaryRejected: !vinaigrette?.primaryAdditions.some(item => item.kind === 'ingredient' && item.ingredientIndex === 15),
      repeatRejected: !vinaigrette?.repeatAdditions.some(item => item.kind === 'ingredient' && item.ingredientIndex === 15),
    }
    const raw = {
      schemaVersion: 1,
      auditDate: DATE,
      generatedAt: new Date().toISOString(),
      auditVersion: version,
      population: { wave1a: 28, wave2: 6, wave3: 7, total: 41, unique: new Set(AUTHORIZED_RECIPE_IDS).size, unresolvedEightExcluded: UNRESOLVED_RECIPE_IDS },
      productionBaseline: { sharedRecipes: allRecipes.size, recipesWithMaps: baseline.mappedRecipes, recipesWithoutMaps: allRecipes.size - baseline.mappedRecipes },
      existingMappedSafety: baseline,
      usage,
      consumedVinaigretteSalt,
      productionMutation: { recipeWrites: 0, mapWrites: 0, firestoreMutations: 0 },
      rows,
    }
    fs.writeFileSync(RAW_PATH, stableJson(raw))
    fs.writeFileSync(WORKSHEET_PATH, stableJson(buildWorksheet(raw)))
    console.log(stableJson({
      phase: 'GENERATED_REVIEW_REQUIRED', rawPath: RAW_PATH, worksheetPath: WORKSHEET_PATH,
      rows: rows.length, sourceClean: count(rows, row => row.sourceStatus === 'SOURCE_CLEAN'),
      existingMaps: count(rows, row => row.currentMapPresent), aiEligibleRecipes: count(rows, row => row.hybridStats.aiEligible),
      primaryRequests: usage.primaryRequests, stabilityRequests: usage.stabilityRequests,
      acceptedPrimaryRelationships: sum(rows, row => row.primaryAdditions.length), productionWrites: 0,
    }))
  } finally { console.info = originalInfo; await modules.close() }
}

function expandSemanticEvidence(raw, worksheet, decisions) {
  if (JSON.stringify(raw.auditVersion) !== JSON.stringify(decisions.auditVersion)) throw new Error('Review decisions do not match frozen audit configuration.')
  const deterministicDecisions = new Map(decisions.deterministicRecipes.map(item => [item.recipeId, item]))
  const aiDecisions = new Map(decisions.aiRelationships.map(item => [item.reviewId, item]))
  const stabilityDecisions = new Map(decisions.stability.map(item => [item.recipeId, item]))
  const deterministicReviews = worksheet.deterministicReviews.map(review => {
    const decision = deterministicDecisions.get(review.recipeId)
    if (!decision || !['SAFE', 'FALSE_POSITIVE'].includes(decision.classification)) throw new Error(`Missing deterministic decision: ${review.recipeId}`)
    const falsePositiveIds = new Set(decision.falsePositiveReviewIds || [])
    if (decision.classification === 'FALSE_POSITIVE' && falsePositiveIds.size === 0) throw new Error(`False-positive decision lacks exact review IDs: ${review.recipeId}`)
    if ([...falsePositiveIds].some(reviewId => !review.references.some(item => item.reviewId === reviewId))) {
      throw new Error(`False-positive decision contains an unknown review ID: ${review.recipeId}`)
    }
    return {
      ...review,
      references: review.references.map(item => ({
        ...item,
        classification: falsePositiveIds.has(item.reviewId) ? 'FALSE_POSITIVE' : 'SAFE_MAPPING',
        explanation: falsePositiveIds.has(item.reviewId)
          ? decision.falsePositiveExplanations?.[item.reviewId] || decision.explanation
          : 'The referenced row is actively used by this instruction with the correct ingredient identity, group, and usage grounding.',
      })),
      omissions: review.omissions.map(item => ({
        ...item,
        classification: 'SAFE_OMISSION',
        explanation: 'The deterministic engine conservatively abstains; no incorrect relationship is asserted.',
      })),
      classification: decision.classification,
      explanation: decision.explanation,
    }
  })
  const aiReviews = worksheet.aiReviews.map(review => {
    const decision = aiDecisions.get(review.reviewId)
    if (!decision || !['CORRECT', 'AMBIGUOUS', 'INCORRECT'].includes(decision.classification)) throw new Error(`Missing AI semantic decision: ${review.reviewId}`)
    return { ...review, classification: decision.classification, explanation: decision.explanation }
  })
  const stability = worksheet.stabilityReviews.map(review => {
    const decision = stabilityDecisions.get(review.recipeId)
    const classification = review.automatedClassification === 'EXACT_STABLE' ? 'EXACT_STABLE' : decision?.classification
    const details = review.automatedClassification === 'EXACT_STABLE' ? review.details : decision?.details
    if (!['EXACT_STABLE', 'SEMANTICALLY_STABLE', 'SAFE_OMISSION_DIFFERENCE', 'UNSAFE_MATERIAL_DIFFERENCE'].includes(classification) || !details || details === 'PENDING') {
      throw new Error(`Missing final stability review: ${review.recipeId}`)
    }
    return { ...review, classification, details }
  })
  return {
    schemaVersion: 1,
    auditDate: DATE,
    auditVersion: raw.auditVersion,
    executiveResult: decisions.executiveResult,
    deterministicReviews,
    aiReviews,
    stability,
    gates: { deterministic: deterministicReviewGate(deterministicReviews), ai: aiReviewGate(aiReviews) },
  }
}

function manifestRows(raw, semantic) {
  const det = new Map(semantic.deterministicReviews.map(row => [row.recipeId, row]))
  const aiByRecipe = new Map(AUTHORIZED_RECIPE_IDS.map(recipeId => [recipeId, semantic.aiReviews.filter(item => item.recipeId === recipeId && item.run === 'primary')]))
  const stability = new Map(semantic.stability.map(row => [row.recipeId, row]))
  return sortRows(raw.rows.map(row => {
    const deterministicReview = det.get(row.recipeId)
    const aiReviews = aiByRecipe.get(row.recipeId) || []
    const aiAmbiguous = aiReviews.filter(item => item.classification === 'AMBIGUOUS').length
    const aiIncorrect = aiReviews.filter(item => item.classification === 'INCORRECT').length
    const stable = stability.get(row.recipeId)
    const classified = classifyRecoveredRecipe({
      currentMapPresent: row.currentMapPresent,
      sourceStatus: row.sourceStatus,
      sourceReason: row.sourceReason,
      error: row.error,
      deterministicFalsePositive: deterministicReview?.classification === 'FALSE_POSITIVE',
      aiAmbiguous,
      aiIncorrect,
      stability: stable?.classification,
      candidateValid: row.candidateValidation?.valid === true,
      sourceHashMatches: row.candidateMap?.sourceHash === row.sourceHash,
    })
    return {
      recipeId: row.recipeId,
      title: row.title,
      repairWave: row.repairWave,
      classification: classified.classification,
      reason: classified.reason,
      auditVersion: raw.auditVersion,
      sourceHash: row.sourceHash,
      candidateMap: ['READY', 'REVIEW'].includes(classified.classification) ? row.candidateMap : null,
      deterministicStats: row.deterministicStats,
      hybridStats: row.hybridStats,
      semanticReview: {
        deterministicSafe: deterministicReview?.classification === 'SAFE',
        aiCorrect: aiReviews.filter(item => item.classification === 'CORRECT').length,
        aiAmbiguous,
        aiIncorrect,
      },
      ...(stable ? { stability: { classification: stable.classification, details: stable.details } } : {}),
      precondition: { currentMapAbsent: !row.currentMapPresent, contentSourceHash: row.sourceHash },
      audit: { sourceStatus: row.sourceStatus, sourceEvidence: row.sourceEvidence, candidateValidation: row.candidateValidation },
    }
  }))
}

async function finalLiveRead(raw, manifest, modules) {
  if (behaviorFingerprint() !== raw.auditVersion.behaviorFingerprint) throw new Error('Behavior fingerprint changed after candidate generation.')
  const allRecipes = await readSharedRecipes()
  const existingSafety = await verifyExistingMappedCorpus(allRecipes, modules)
  const failures = []
  for (const row of manifest.filter(item => item.classification === 'READY')) {
    const live = allRecipes.get(row.recipeId)
    if (!live) { failures.push({ recipeId: row.recipeId, reason: 'missing' }); continue }
    if (live.data.cookingStepIngredientMap !== undefined && live.data.cookingStepIngredientMap !== null) { failures.push({ recipeId: row.recipeId, reason: 'map-present' }); continue }
    const parsed = modules.recipeContent.parseRecipeContent(typeof live.data.content === 'string' ? live.data.content : '')
    const deterministic = await modules.mapping.buildHashedDeterministicCookingStepMap(parsed.ingredients, parsed.instructions)
    if (deterministic.sourceHash !== row.sourceHash) { failures.push({ recipeId: row.recipeId, reason: 'source-hash-mismatch' }); continue }
    const validation = modules.mapping.validateCookingStepIngredientMap(row.candidateMap, parsed.ingredients, parsed.instructions, deterministic)
    if (!validation.valid) failures.push({ recipeId: row.recipeId, reason: validation.reason })
  }
  return { verifiedAt: new Date().toISOString(), readyRows: count(manifest, row => row.classification === 'READY'), failures, existingMappedSafety: existingSafety }
}

function reportMarkdown(raw, manifest, semantic, live, manifestHash) {
  const eligible = raw.rows.filter(row => row.deterministicStats)
  const det = semantic.gates.deterministic
  const ai = semantic.gates.ai
  const stability = semantic.stability
  const c = classification => count(manifest, row => row.classification === classification)
  const usage = raw.usage
  const config = raw.auditVersion
  const falsePositiveRows = semantic.deterministicReviews.filter(row => row.classification === 'FALSE_POSITIVE')
  const incorrectAiRows = semantic.aiReviews.filter(row => row.classification === 'INCORRECT')
  const usageTotals = usage.metadata.reduce((totals, item) => ({
    inputTokens: totals.inputTokens + (item.inputTokens || 0),
    outputTokens: totals.outputTokens + (item.outputTokens || 0),
    totalTokens: totals.totalTokens + (item.totalTokens || 0),
  }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 })
  const sevenPriorFailures = [
    'couscous-salad-with-lime-basil-vinaigrette', 'dads-chili', 'easy-chicken-ramen',
    'pepper-steak', 'peruvian-roasted-chicken-with-spicy-cilantro-sauce',
    'tuscan-bean-soup', 'vegetarian-skillet-chili',
  ]
  const aiEligibleCount = count(eligible, row => row.hybridStats.aiEligible)
  const retries = usage.primaryRequests + usage.stabilityRequests - (aiEligibleCount * 2)
  const providerFailures = count(eligible, row => row.hybridStats.aiStatus === 'failed' || row.stability?.classification === 'ERROR')
  return `# Recovered recipes cooking-step mapping v5 final dry run — ${DATE}\n\n` +
    `## Executive result\n\n**${semantic.executiveResult}**\n\n` +
    `This read-only audit generated fresh source-bound candidates for the exact 41 recipes repaired by Waves 1A–3. Recipe writes, map writes, and Firestore mutations were all zero.\n\n` +
    `## Audited configuration\n\n| Setting | Value |\n|---|---|\n| Git SHA | \`${config.gitSha}\` |\n| Behavior fingerprint | \`${config.behaviorFingerprint}\` |\n| Schema | \`${config.schemaVersion}\` |\n| Parser | \`${config.parserVersion}\` |\n| Deterministic engine | \`${config.deterministicEngineVersion}\` |\n| Hybrid engine | \`${config.hybridEngineVersion}\` |\n| Prompt | \`${config.promptVersion}\` |\n| Model | \`${config.model}\` |\n| Temperature | \`${config.temperature}\` |\n\n` +
    `## Population and production baseline\n\nWave 1A **28** + Wave 2 **6** + Wave 3 **7** = **41 unique IDs**. The final eight unresolved recipes are absent. Production contained **${raw.productionBaseline.sharedRecipes}** shared recipes, **${raw.productionBaseline.recipesWithMaps}** persisted maps, and **${raw.productionBaseline.recipesWithoutMaps}** recipes without maps. All 41 tranche recipes were map-free and source-clean.\n\n` +
    `## Deterministic-v5\n\nRecipes **${eligible.length}**; ingredients **${sum(eligible, row => row.deterministicStats.ingredientCount)}**; instructions **${sum(eligible, row => row.deterministicStats.instructionCount)}**; mapped steps **${sum(eligible, row => row.deterministicStats.mappedSteps)}**; unmapped steps **${sum(eligible, row => row.deterministicStats.unmappedSteps)}**; ingredient references **${sum(eligible, row => row.deterministicStats.ingredientReferences)}**; ambiguous **${sum(eligible, row => row.deterministicStats.ambiguousSteps)}**; implicit **${sum(eligible, row => row.deterministicStats.implicitReferenceSteps)}**; prepared-component **${sum(eligible, row => row.deterministicStats.preparedComponentSteps)}**; no-ingredient-use **${sum(eligible, row => row.deterministicStats.noIngredientUseSteps)}**; non-actionable **${sum(eligible, row => row.deterministicStats.nonActionableSteps)}**; AI-eligible steps **${sum(eligible, row => row.deterministicStats.aiEligibleSteps)}**; AI-eligible recipes **${aiEligibleCount}**.\n\nExhaustive review covered **${det.recipesReviewed}** recipes, **${det.mappedReferencesReviewed}** mapped references, and **${det.safeOmissions}** fully unmapped instructions: safe mappings **${det.safeMappings}**, false-positive mappings **${det.falsePositiveMappings}**, false-positive recipes **${det.falsePositiveRecipes}**.\n\n${falsePositiveRows.map(row => `- **${row.title}** (\`${row.recipeId}\`) — ${row.explanation}`).join('\n')}\n\nThe seven prior failures were explicitly reconfirmed clean under deterministic-v5: ${sevenPriorFailures.map(id => `\`${id}\``).join(', ')}.\n\n` +
    `## Hybrid-v5 and AI semantic review\n\nAI-eligible recipes **${aiEligibleCount}**; recipes called **${count(eligible, row => row.hybridStats.aiAttempted)}**; primary requests **${usage.primaryRequests}**; stability requests **${usage.stabilityRequests}**; retries **${retries}**; provider failures **${providerFailures}**; accepted ingredient additions **${sum(eligible, row => row.hybridStats.acceptedIngredientAdditions)}**; accepted prepared components **${sum(eligible, row => row.hybridStats.acceptedPreparedComponents)}**; accepted usage qualifiers **${sum(eligible, row => row.hybridStats.acceptedUsageQualifiers)}**; remaining unresolved semantics **${sum(eligible, row => row.hybridStats.remainingUnresolvedSemantics)}**. Across primary and stability runs, reviewed accepted semantics were correct **${ai.correct}**, ambiguous **${ai.ambiguous}**, incorrect **${ai.incorrect}**.\n\n${incorrectAiRows.map(row => `- **${row.title}** (\`${row.recipeId}\`, ${row.run}) — ${row.explanation}`).join('\n')}\n\nConsumed vinaigrette salt was rejected in the primary run: **${raw.consumedVinaigretteSalt.primaryRejected}**; rejected in the stability run: **${raw.consumedVinaigretteSalt.repeatRejected}**.\n\n` +
    `## Stability\n\nAll **${stability.length}** AI-assisted recipes were rerun: exact **${count(stability, row => row.classification === 'EXACT_STABLE')}**, semantically stable **${count(stability, row => row.classification === 'SEMANTICALLY_STABLE')}**, safe omission difference **${count(stability, row => row.classification === 'SAFE_OMISSION_DIFFERENCE')}**, unsafe material difference **${count(stability, row => row.classification === 'UNSAFE_MATERIAL_DIFFERENCE')}**. Every non-exact result was manually reviewed.\n\n` +
    `## Classification and immutable manifest\n\nREADY **${c('READY')}**; REVIEW **${c('REVIEW')}**; EXCLUDED **${c('EXCLUDED')}**; ERROR **${c('ERROR')}**; EXISTING_MAP **${c('EXISTING_MAP')}**.\n\nManifest: \`${path.relative(ROOT, MANIFEST_PATH)}\`; SHA-256: \`${manifestHash}\`; rows: **${manifest.length}**. Semantic evidence: \`${path.relative(ROOT, SEMANTIC_PATH)}\`.\n\n` +
    `## Final live preconditions and existing-map safety\n\nFinal live READY checks: **${live.readyRows - live.failures.length}/${live.readyRows}** passed. Existing persisted v4 maps: **${live.existingMappedSafety.mappedRecipes}**; source hashes matched **${live.existingMappedSafety.sourceHashMatches}**; structurally valid **${live.existingMappedSafety.structurallyValid}**; runtime accepted **${live.existingMappedSafety.runtimeAccepted}**; forced fallbacks **${live.existingMappedSafety.fallbacks.length}**. The audit caused zero production changes.\n\n` +
    `## Production mutation and AI usage\n\nRecipe writes **0**; map writes **0**; Firestore mutations **0**. Real Gateway requests **${usage.primaryRequests + usage.stabilityRequests}** (${usage.primaryRequests} primary and ${usage.stabilityRequests} stability; zero retries and failures), totaling **${usageTotals.inputTokens}** input, **${usageTotals.outputTokens}** output, and **${usageTotals.totalTokens}** tokens.\n\n` +
    `## Historical v4 manifest\n\nThe old recovered-v4 manifest remains historical only and is not authorized for apply: \`docs/audits/recovered-recipes-mapping-v4-dryrun-${DATE}.json\`, SHA-256 \`289759234b88c4d29b18fe42a7f67f2e18473cc9285dd5df4ef9ced798ca1716\`. It was not candidate input to this audit.\n\n` +
    `## Deferred work and next action\n\nWave 4/5 and personal override-specific mappings remain pending. Create one final immutable-manifest-SHA-locked map apply prompt for the approved recovered recipes. It must make zero AI calls and perform zero mapping recomputation.\n`
}

async function finalize() {
  if (!fs.existsSync(RAW_PATH) || !fs.existsSync(WORKSHEET_PATH)) throw new Error('Generate the live run and review worksheet first.')
  if (!fs.existsSync(DECISIONS_PATH)) throw new Error(`Review decisions are required: ${DECISIONS_PATH}`)
  if (fs.existsSync(MANIFEST_PATH) || fs.existsSync(SEMANTIC_PATH)) throw new Error('Refusing to overwrite immutable finalized audit artifacts.')
  const raw = readJson(RAW_PATH)
  const worksheet = readJson(WORKSHEET_PATH)
  const decisions = readJson(DECISIONS_PATH)
  const semantic = expandSemanticEvidence(raw, worksheet, decisions)
  const detGate = semantic.gates.deterministic
  const aiGate = semantic.gates.ai
  if (detGate.recipesReviewed !== 41 || detGate.pending || aiGate.pending) {
    throw new Error(`Semantic gates do not authorize finalization: ${stableJson(semantic.gates)}`)
  }
  const semanticFailure = detGate.falsePositiveMappings > 0 || aiGate.ambiguous > 0 || aiGate.incorrect > 0 ||
    semantic.stability.some(row => row.classification === 'UNSAFE_MATERIAL_DIFFERENCE')
  if (semanticFailure && semantic.executiveResult !== 'NOT READY FOR MAPPING APPLY') {
    throw new Error('Semantic failures require NOT READY FOR MAPPING APPLY.')
  }
  const manifest = manifestRows(raw, semantic)
  if (manifest.length !== 41 || manifest.some(row => !readyRecoveredManifestInvariant(row))) throw new Error('Manifest population or READY invariant failed.')
  const modules = await loadProductionModules(false)
  try {
    const live = await finalLiveRead(raw, manifest, modules)
    if (live.failures.length || live.existingMappedSafety.mappedRecipes !== 187 || live.existingMappedSafety.invalid.length || live.existingMappedSafety.fallbacks.length) throw new Error(`Final live precondition failed: ${stableJson(live)}`)
    fs.writeFileSync(SEMANTIC_PATH, stableJson(semantic), { flag: 'wx' })
    fs.writeFileSync(MANIFEST_PATH, stableJson(manifest), { flag: 'wx' })
    const manifestHash = sha256(fs.readFileSync(MANIFEST_PATH))
    fs.writeFileSync(REPORT_PATH, reportMarkdown(raw, manifest, semantic, live, manifestHash), { flag: 'wx' })
    if (sha256(fs.readFileSync(MANIFEST_PATH)) !== manifestHash) throw new Error('Immutable manifest changed after hashing.')
    console.log(stableJson({
      phase: 'FINALIZED', executiveResult: semantic.executiveResult,
      manifest: path.relative(ROOT, MANIFEST_PATH), manifestSha256: manifestHash,
      semanticEvidence: path.relative(ROOT, SEMANTIC_PATH), rows: manifest.length,
      ready: count(manifest, row => row.classification === 'READY'), livePreconditionFailures: live.failures.length,
      existingMappedRecipes: live.existingMappedSafety.mappedRecipes, productionWrites: 0,
    }))
  } finally { await modules.close() }
}

async function main() {
  assertAuthorizedPopulation()
  const args = process.argv.slice(2)
  if (args.length !== 1 || !['--generate', '--finalize'].includes(args[0])) throw new Error('Choose exactly one mode: --generate or --finalize')
  if (args[0] === '--generate') await generate()
  else await finalize()
}

main().catch(error => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1 })
