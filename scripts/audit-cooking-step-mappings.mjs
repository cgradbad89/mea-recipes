#!/usr/bin/env node
/**
 * Read-only production corpus audit for Cooking Mode step mappings.
 *
 * This execution path performs one Firestore collection get and contains no
 * Firestore write/apply mode. It loads the production parser/mapper/AI merger
 * through Vite so the audit cannot drift into a second mapping implementation.
 *
 * Usage:
 *   npm run audit:cooking-step-mappings -- --deterministic-only
 *   npm run audit:cooking-step-mappings -- --hybrid
 *   npm run audit:cooking-step-mappings -- --hybrid --resume /tmp/cooking-step-mapping-run-YYYY-MM-DD.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import {
  callWithOneTransientRetry,
  auditPrecondition,
  classifyAuditRecipe,
  classifyRecipeSource,
  compareStability,
  extractAiAdditions,
  isAuditAiEligible,
  mapConcurrent,
  mapStats,
  parserDefectEvidence,
  selectDeterministicSample,
  selectStabilitySubset,
  sha256,
  sortManifestRows,
} from './audit-cooking-step-mappings-core.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { loadEnv, getAdmin } = require('./_lib.js')
const LIMITS = { maxContentLength: 64_000, maxIngredients: 200, maxInstructions: 150, maxLineLength: 4_000 }
const CONCURRENCY = 3
const BOUNDED_AI_TIMEOUT_MS = 90_000
const args = new Set(process.argv.slice(2))
const selectedModes = ['--hybrid', '--bounded-hybrid', '--deterministic-only'].filter(flag => args.has(flag))
const mode = args.has('--hybrid') ? 'hybrid'
  : args.has('--bounded-hybrid') ? 'bounded-hybrid'
    : args.has('--deterministic-only') ? 'deterministic-only' : null
const option = name => {
  const index = process.argv.indexOf(name)
  return index === -1 ? null : process.argv[index + 1]
}

if (!mode || selectedModes.length !== 1) {
  throw new Error('Choose exactly one mode: --deterministic-only, --bounded-hybrid, or --hybrid')
}

function auditDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function stableJson(value) { return `${JSON.stringify(value, null, 2)}\n` }
function count(rows, predicate) { return rows.filter(predicate).length }
function sum(rows, getter) { return rows.reduce((total, row) => total + getter(row), 0) }

async function loadProductionModules() {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { '@': ROOT } },
    plugins: [{
      name: 'audit-server-only-marker', enforce: 'pre',
      resolveId(id) { return id === 'server-only' ? '\0audit-server-only' : null },
      load(id) { return id === '\0audit-server-only' ? 'export {}' : null },
    }],
  })
  try {
    return {
      recipeContent: await server.ssrLoadModule('/lib/recipeContent.ts'),
      mapping: await server.ssrLoadModule('/lib/cookingStepMapping.ts'),
      mappingAi: mode !== 'deterministic-only' ? await server.ssrLoadModule('/lib/cookingStepMappingAi.ts') : null,
      aiConfig: await server.ssrLoadModule('/lib/aiConfig.ts'),
      route: await server.ssrLoadModule('/app/api/cooking-step-map/route.ts'),
      close: () => server.close(),
    }
  } catch (error) {
    await server.close()
    throw error
  }
}

function auditedConfiguration(modules) {
  const emptyMap = modules.mapping.buildDeterministicCookingStepMap([], [])
  return {
    gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    schemaVersion: emptyMap.schemaVersion,
    parserVersion: modules.mapping.COOKING_MAPPING_PARSER_VERSION,
    deterministicEngineVersion: modules.mapping.COOKING_MAPPING_ENGINE_VERSION,
    hybridEngineVersion: modules.mapping.COOKING_MAPPING_HYBRID_ENGINE_VERSION,
    promptVersion: modules.aiConfig.COOKING_STEP_MAPPING_PROMPT_VERSION,
    model: modules.aiConfig.AI_MODEL,
    temperature: modules.aiConfig.COOKING_STEP_MAPPING_TEMPERATURE,
  }
}

async function readSharedRecipes() {
  loadEnv()
  const snapshot = await getAdmin().firestore().collection('recipes').get()
  return snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

async function buildBaseline(documents, modules) {
  const limits = {
    maxContentLength: modules.route.COOKING_STEP_MAP_MAX_CONTENT_LENGTH,
    maxIngredients: modules.route.COOKING_STEP_MAP_MAX_INGREDIENTS,
    maxInstructions: modules.route.COOKING_STEP_MAP_MAX_INSTRUCTIONS,
    maxLineLength: modules.route.COOKING_STEP_MAP_MAX_LINE_LENGTH,
  }
  if (JSON.stringify(limits) !== JSON.stringify(LIMITS)) throw new Error('Audit/API parse limits unexpectedly diverged')
  const rows = []
  for (const document of documents) {
    const { data } = document
    const content = typeof data.content === 'string' ? data.content : ''
    const parsed = modules.recipeContent.parseRecipeContent(content)
    const source = classifyRecipeSource({ ...data, recipeId: document.id }, parsed, limits)
    const currentMapPresent = data.cookingStepIngredientMap !== undefined && data.cookingStepIngredientMap !== null
    const row = {
      recipeId: document.id,
      title: typeof data.title === 'string' ? data.title : '',
      contentNonempty: content.trim().length > 0,
      sourceStatus: source.status,
      sourceReason: source.reason,
      parserEvidence: source.evidence,
      parsed,
      sourceHash: null,
      deterministicMap: null,
      deterministicStats: null,
      hybridStats: {
        aiAttempted: false, aiStatus: 'not_needed', aiAttempts: 0,
        addedIngredientReferences: 0, addedPreparedComponents: 0,
        finalMappedIngredientReferences: 0, finalIngredientReferences: 0,
        finalMappedSteps: 0, remainingUnresolvedSteps: 0, remainingAiEligibleSteps: 0,
      },
      candidateMap: null,
      candidateValidation: null,
      aiAdditions: [],
      validatorRejections: [],
      aiModelOutput: null,
      aiError: null,
      stability: null,
      currentMapPresent,
      currentMapEngineVersion: currentMapPresent && typeof data.cookingStepIngredientMap?.engineVersion === 'string'
        ? data.cookingStepIngredientMap.engineVersion : null,
      currentMapValidation: null,
    }
    if (source.status !== 'ELIGIBLE') { rows.push(row); continue }
    const deterministicMap = await modules.mapping.buildHashedDeterministicCookingStepMap(parsed.ingredients, parsed.instructions)
    const validation = modules.mapping.validateCookingStepIngredientMap(deterministicMap, parsed.ingredients, parsed.instructions, deterministicMap)
    if (!validation.valid) {
      row.sourceStatus = 'ERROR'; row.sourceReason = `Deterministic map failed production validation: ${validation.reason}`
      rows.push(row); continue
    }
    row.sourceHash = deterministicMap.sourceHash
    row.deterministicMap = deterministicMap
    row.deterministicStats = mapStats(deterministicMap)
    if (currentMapPresent) {
      row.currentMapValidation = modules.mapping.validateCookingStepIngredientMap(data.cookingStepIngredientMap, parsed.ingredients, parsed.instructions, deterministicMap)
      rows.push(row); continue
    }
    row.candidateMap = deterministicMap
    row.candidateValidation = validation
    const stats = mapStats(deterministicMap)
    Object.assign(row.hybridStats, {
      finalMappedIngredientReferences: stats.mappedIngredientReferences,
      finalIngredientReferences: stats.mappedIngredientReferences,
      finalMappedSteps: stats.mappedSteps,
      remainingUnresolvedSteps: stats.aiEligibleSteps,
      remainingAiEligibleSteps: stats.aiEligibleSteps,
    })
    rows.push(row)
  }
  return rows
}

function oneProposalOutput(instructionIndex, ingredient, preparedComponent) {
  return {
    steps: [{
      instructionIndex,
      ingredients: ingredient ? [ingredient] : [],
      preparedComponents: preparedComponent ? [preparedComponent] : [],
    }],
  }
}

function normalizedLabel(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function rejectionEvidence(row, modelOutput, modules, run) {
  if (!modelOutput || !Array.isArray(modelOutput.steps)) {
    return [{ run, reason: 'invalid_or_out_of_range_indexes', detail: 'Model output did not contain a steps array.' }]
  }
  const evidence = []
  for (const proposedStep of modelOutput.steps) {
    const instructionIndex = proposedStep?.instructionIndex
    const deterministicStep = Number.isInteger(instructionIndex)
      ? row.deterministicMap.steps[instructionIndex] : null
    const instruction = deterministicStep ? row.parsed.instructions[instructionIndex] || '' : ''
    const eligible = deterministicStep && modules.mapping.isAiEligibleCookingMappingReason(deterministicStep.unresolvedReason)
    const proposedIngredients = Array.isArray(proposedStep?.ingredients) ? proposedStep.ingredients : []
    const duplicateIndexes = new Set(proposedIngredients
      .map(item => item?.ingredientIndex)
      .filter((index, position, all) => Number.isInteger(index) && all.indexOf(index) !== position))

    for (const proposal of proposedIngredients) {
      const index = proposal?.ingredientIndex
      let reason = null
      if (proposal?.confidence !== 'high') reason = 'uncertain_confidence'
      else if (!Number.isInteger(instructionIndex) || !Number.isInteger(index) || index < 0 || index >= row.parsed.ingredients.length) {
        reason = 'invalid_or_out_of_range_indexes'
      } else if (!eligible || deterministicStep.ingredients.some(reference => reference.ingredientIndex === index)) {
        reason = 'deterministic_lock_violations'
      } else if (duplicateIndexes.has(index)) reason = 'duplicate_conflicts'
      else if (modules.mapping.isNonActionableCookingInstruction(instruction)) reason = 'non_actionable_steps'

      const baseOutput = Number.isInteger(instructionIndex) && Number.isInteger(index)
        ? oneProposalOutput(instructionIndex, { ingredientIndex: index, confidence: proposal.confidence }, null)
        : null
      const baseMap = baseOutput ? modules.mappingAi.mergeValidatedAiCookingMappings(
        row.deterministicMap, row.parsed.ingredients, row.parsed.instructions, baseOutput,
      ) : row.deterministicMap
      const baseAccepted = Number.isInteger(instructionIndex) && baseMap.steps[instructionIndex]?.ingredients
        .some(reference => reference.provenance === 'ai' && reference.ingredientIndex === index)
      const fullMap = Number.isInteger(instructionIndex)
        ? modules.mappingAi.mergeValidatedAiCookingMappings(
          row.deterministicMap, row.parsed.ingredients, row.parsed.instructions,
          oneProposalOutput(instructionIndex, proposal, null),
        ) : row.deterministicMap
      const acceptedReference = Number.isInteger(instructionIndex) ? fullMap.steps[instructionIndex]?.ingredients
        .find(reference => reference.provenance === 'ai' && reference.ingredientIndex === index) : null

      if (!reason && !baseAccepted) {
        if (/\b(?:do not|don't|dont|never|without|remove|discard|reserve|save|hold|set aside|except)\b/i.test(instruction)) {
          reason = 'negative_or_deferred_contexts'
        } else if (/\bremaining ingredients?\b/i.test(instruction)) {
          reason = 'unsupported_remaining_semantics'
        } else if (/\b(?:all (?:of )?(?:the )?(?:\w+ )?ingredients?|everything(?: else)?)\b/i.test(instruction)) {
          reason = 'unbounded_collective_references'
        } else reason = 'group_conflicts'
      }
      if (reason) {
        evidence.push({ run, reason, instructionIndex, ingredientIndex: index })
      } else if (proposal?.usage && JSON.stringify(acceptedReference?.usage) !== JSON.stringify(proposal.usage)) {
        evidence.push({
          run,
          reason: proposal.usage.kind === 'partial' && proposal.usage.quantityText
            ? 'ungrounded_quantity_metadata' : 'unsupported_usage_metadata',
          instructionIndex,
          ingredientIndex: index,
        })
      }
    }

    const proposedComponents = Array.isArray(proposedStep?.preparedComponents) ? proposedStep.preparedComponents : []
    const duplicateLabels = new Set(proposedComponents.map(item => normalizedLabel(item?.label))
      .filter((label, position, all) => label && all.indexOf(label) !== position))
    for (const proposal of proposedComponents) {
      let reason = null
      if (proposal?.confidence !== 'high') reason = 'uncertain_confidence'
      else if (!Number.isInteger(instructionIndex) || !eligible) reason = 'deterministic_lock_violations'
      else if (duplicateLabels.has(normalizedLabel(proposal.label))) reason = 'duplicate_conflicts'
      else if (modules.mapping.isNonActionableCookingInstruction(instruction)) reason = 'non_actionable_steps'
      else {
        const grounded = modules.mapping.groundCookingPreparedComponent(
          proposal.label, instructionIndex, row.parsed.ingredients, row.parsed.instructions,
        )
        if (!grounded) {
          reason = /\b(?:add|serve|desired|optional|raw|ingredient|with|over)\b/i.test(String(proposal.label)) ||
            normalizedLabel(proposal.label).split(' ').length > 3
            ? 'noncanonical_prepared_component_labels'
            : 'ungrounded_prepared_components'
        }
      }
      if (reason) evidence.push({ run, reason, instructionIndex, label: proposal?.label ?? null })
    }
  }
  return evidence
}

async function executeHybrid(rows, modules, usage, selectedTargets = null, stabilityTarget = 30) {
  const targets = selectedTargets || rows.filter(isAuditAiEligible)
  await mapConcurrent(targets, CONCURRENCY, async row => {
    const call = () => modules.mappingAi.resolveCookingStepMappingsWithAi(
      row.deterministicMap, row.parsed.ingredients, row.parsed.instructions, 'cooking-step-mapping-production-audit',
      mode === 'bounded-hybrid' ? BOUNDED_AI_TIMEOUT_MS : undefined,
    )
    const result = await callWithOneTransientRetry(call)
    row.hybridStats.aiAttempted = true
    row.hybridStats.aiStatus = result.status
    row.hybridStats.aiAttempts = result.attempts
    usage.primaryRequests += result.attempts
    if (result.status === 'failed') { row.aiError = result.error; return }
    row.aiModelOutput = result.value
    row.validatorRejections.push(...rejectionEvidence(row, result.value, modules, 'primary'))
    const candidate = modules.mappingAi.mergeValidatedAiCookingMappings(
      row.deterministicMap, row.parsed.ingredients, row.parsed.instructions, result.value,
    )
    row.candidateMap = candidate
    row.candidateValidation = modules.mapping.validateCookingStepIngredientMap(
      candidate, row.parsed.ingredients, row.parsed.instructions, row.deterministicMap,
    )
    const additions = extractAiAdditions(row.recipeId, candidate, row.parsed.ingredients, row.parsed.instructions)
    row.aiAdditions = additions
    const stats = mapStats(candidate)
    Object.assign(row.hybridStats, {
      addedIngredientReferences: additions.filter(item => item.kind === 'ingredient').length,
      addedPreparedComponents: additions.filter(item => item.kind === 'prepared-component').length,
      finalMappedIngredientReferences: stats.mappedIngredientReferences,
      finalIngredientReferences: stats.mappedIngredientReferences,
      finalMappedSteps: stats.mappedSteps,
      remainingUnresolvedSteps: stats.aiEligibleSteps,
      remainingAiEligibleSteps: stats.aiEligibleSteps,
    })
  })

  const stabilityTargets = selectStabilitySubset(rows, stabilityTarget)
  await mapConcurrent(stabilityTargets, CONCURRENCY, async row => {
    const result = await callWithOneTransientRetry(() => modules.mappingAi.resolveCookingStepMappingsWithAi(
      row.deterministicMap, row.parsed.ingredients, row.parsed.instructions, 'cooking-step-mapping-production-audit-stability',
      mode === 'bounded-hybrid' ? BOUNDED_AI_TIMEOUT_MS : undefined,
    ))
    usage.stabilityRequests += result.attempts
    if (result.status === 'failed') {
      row.stability = { status: 'ERROR', attempts: result.attempts, error: result.error }
      return
    }
    row.validatorRejections.push(...rejectionEvidence(row, result.value, modules, 'stability'))
    const repeatMap = modules.mappingAi.mergeValidatedAiCookingMappings(
      row.deterministicMap, row.parsed.ingredients, row.parsed.instructions, result.value,
    )
    const repeatAdditions = extractAiAdditions(
      row.recipeId, repeatMap, row.parsed.ingredients, row.parsed.instructions,
    )
    const validation = modules.mapping.validateCookingStepIngredientMap(
      repeatMap, row.parsed.ingredients, row.parsed.instructions, row.deterministicMap,
    )
    row.stability = validation.valid
      ? {
        status: compareStability(row.candidateMap, repeatMap), attempts: result.attempts,
        repeatMap, repeatAdditions,
      }
      : { status: 'ERROR', attempts: result.attempts, error: `Repeat candidate validation failed: ${validation.reason}` }
  })
}

function selectBoundedHybridTargets(rows, target = 25) {
  const priorityIds = [
    'buttersoy-chicken-and-asparagus-stirfry', 'chicken-chow-mein', 'chicken-wild-rice',
    'tacos-al-pastor', 'sheet-pan-chicken-tinga-bowls',
    'chopped-thai-shrimp-salad-with-garlic-lime-dressing', 'singapore-mei-fun',
    'sesame-apricot-tofu', 'chickpea-curry',
    'blue-corn-green-chili-chicken-enchiladas', 'creamy-chickpea-spinach-masala-with-tadka',
    'fried-chicken-sandwich', 'moqueca-brazilian-fish-stew',
    'queso-chicken-chili-with-roasted-corn-and-jalape-o', 'dan-dan-noodles',
    'korean-bulgogi-beef-bowls', 'chicken-gyro-chopped-salad', 'pad-thai',
    'japanese-cold-soba-noodle-salad', 'pearl-couscous-skillet-with-tomatoes-chickpeas-and-feta',
    'mexican-oaxacan-bowl', 'creamy-kale-pasta', 'mediterranean-grilled-salmon',
    'brown-butter-lentil-and-sweet-potato-salad', 'shrimp-pullao',
  ]
  const eligible = rows.filter(isAuditAiEligible)
  const selected = priorityIds
    .map(recipeId => eligible.find(row => row.recipeId === recipeId))
    .filter(Boolean)
  if (selected.length < target) {
    const selectedIds = new Set(selected.map(row => row.recipeId))
    selected.push(...selectDeterministicSample(rows, 80)
      .filter(row => isAuditAiEligible(row) && !selectedIds.has(row.recipeId))
      .slice(0, target - selected.length))
  }
  return selected.slice(0, target)
}

function reviewPaths(date) {
  return {
    manifest: path.join(ROOT, `docs/audits/cooking-step-mapping-dryrun-v3-${date}.json`),
    report: path.join(ROOT, `docs/audits/cooking-step-mapping-dryrun-v3-${date}.md`),
    reviews: path.join(ROOT, `docs/audits/cooking-step-mapping-semantic-review-v3-${date}.json`),
    raw: path.join('/tmp', `cooking-step-mapping-run-v3-${date}.json`),
  }
}

function refreshCachedParserExclusions(rows) {
  for (const row of rows) {
    if (row.sourceStatus !== 'ELIGIBLE') continue
    const known = classifyRecipeSource(
      { content: 'cached-source', recipeId: row.recipeId },
      row.parsed,
      { ...LIMITS, maxContentLength: Number.MAX_SAFE_INTEGER },
    )
    const evidence = parserDefectEvidence(row.parsed.instructions)
    const source = known.status !== 'ELIGIBLE' ? known
      : evidence.length > 0 ? {
        status: 'EXCLUDE_PARSER_DEFECT',
        reason: evidence.map(item => `Step ${item.instructionIndex}: ${item.defect}.`).join(' '),
        evidence,
      } : null
    if (!source) continue
    row.sourceStatus = source.status
    row.sourceReason = source.reason
    row.parserEvidence = source.evidence
  }
}

async function revalidateCachedRun(cachedRaw) {
  const modules = await loadProductionModules()
  try {
    const liveConfiguration = auditedConfiguration(modules)
    if (JSON.stringify(liveConfiguration) !== JSON.stringify(cachedRaw.auditVersion)) {
      throw new Error('Audited software/configuration changed after the live run; discard cached output and restart from scratch.')
    }
    const documents = await readSharedRecipes()
    const liveRows = await buildBaseline(documents, modules)
    const cachedById = new Map(cachedRaw.rows.map(row => [row.recipeId, row]))
    for (const live of liveRows) {
      const cached = cachedById.get(live.recipeId)
      if (!cached) continue
      // Preserve executed-AI audit evidence even when a newly recognized source
      // defect now excludes the row before candidate generation.
      live.hybridStats = cached.hybridStats
      live.aiAdditions = cached.aiAdditions
      live.validatorRejections = cached.validatorRejections || []
      live.aiModelOutput = cached.aiModelOutput || null
      live.aiError = cached.aiError
      live.stability = cached.stability
      if (live.stability?.repeatMap && cached.candidateMap) {
        live.stability.status = compareStability(cached.candidateMap, live.stability.repeatMap)
      }
      if (live.sourceStatus !== 'ELIGIBLE' || live.currentMapPresent) continue
      if (live.sourceHash !== cached.sourceHash) {
        live.sourceStatus = 'ERROR'
        live.sourceReason = 'Live shared source hash changed after the AI audit; cached candidate was not reused.'
        live.candidateMap = null
        live.candidateValidation = null
        continue
      }
      live.candidateMap = cached.candidateMap
      live.candidateValidation = modules.mapping.validateCookingStepIngredientMap(
        cached.candidateMap, live.parsed.ingredients, live.parsed.instructions, live.deterministicMap,
      )
    }
    return { ...cachedRaw, rows: liveRows, finalProductionReadAt: new Date().toISOString() }
  } finally {
    await modules.close()
  }
}

function makeReviewTemplate(rows, date, auditVersion) {
  const aiAdditions = rows.flatMap(row => [
    ...row.aiAdditions.map(addition => ({ addition, run: 'primary' })),
    ...(row.stability?.repeatAdditions || []).map(addition => ({ addition, run: 'stability' })),
  ].map(({ addition, run }) => ({
    reviewId: `${run}|${addition.additionId}`,
    additionId: addition.additionId, run, recipeId: row.recipeId, title: row.title,
    classification: 'PENDING', failureClass: null, explanation: null,
    sourceIngredients: row.parsed.ingredients,
    instructionIndex: addition.instructionIndex, instruction: addition.instruction,
    precedingActionableContext: row.parsed.instructions.slice(Math.max(0, addition.instructionIndex - 2), addition.instructionIndex),
    deterministicStep: row.deterministicMap.steps[addition.instructionIndex],
    addition,
  })))
  return {
    auditDate: date,
    auditVersion,
    instructions: 'Classify every AI addition CORRECT, AMBIGUOUS, or INCORRECT. Review every deterministic sample candidate for obvious false positives.',
    executiveVerdict: null,
    verdictReason: null,
    remainingRisks: null,
    aiAdditions,
    stability: rows.filter(row => row.stability).map(row => ({
      recipeId: row.recipeId,
      title: row.title,
      classification: row.stability.status,
      details: row.stability.status === 'EXACT_STABLE'
        ? 'Validated semantic outputs and full candidate maps are byte-identical.' : 'PENDING',
    })),
    deterministicSample: selectDeterministicSample(rows, 80).map(row => ({
      recipeId: row.recipeId, title: row.title, classification: 'PENDING', explanation: null,
      safeCorrectMappings: 0, safeOmissions: 0,
      ingredients: row.parsed.ingredients, instructions: row.parsed.instructions,
      deterministicMap: row.deterministicMap,
    })),
  }
}

function loadReviews(reviewFile, template) {
  if (!fs.existsSync(reviewFile)) {
    fs.mkdirSync(path.dirname(reviewFile), { recursive: true })
    fs.writeFileSync(reviewFile, stableJson(template))
    return template
  }
  return JSON.parse(fs.readFileSync(reviewFile, 'utf8'))
}

function finalizeRows(rows, reviews, auditVersion) {
  const aiReviews = new Map(reviews.aiAdditions.map(item => [item.reviewId || `primary|${item.additionId}`, item]))
  const deterministicReviews = new Map(reviews.deterministicSample.map(item => [item.recipeId, item]))
  const finalized = rows.map(row => {
    const semantic = { aiAdditionsCorrect: 0, aiAdditionsAmbiguous: 0, aiAdditionsIncorrect: 0 }
    const stabilitySemantic = { aiAdditionsCorrect: 0, aiAdditionsAmbiguous: 0, aiAdditionsIncorrect: 0 }
    const rowReviews = row.aiAdditions.map(item => aiReviews.get(`primary|${item.additionId}`)).filter(Boolean)
    for (const review of rowReviews) {
      if (review.classification === 'CORRECT') semantic.aiAdditionsCorrect += 1
      if (review.classification === 'AMBIGUOUS') semantic.aiAdditionsAmbiguous += 1
      if (review.classification === 'INCORRECT') semantic.aiAdditionsIncorrect += 1
    }
    const repeatReviews = (row.stability?.repeatAdditions || [])
      .map(item => aiReviews.get(`stability|${item.additionId}`)).filter(Boolean)
    for (const review of repeatReviews) {
      if (review.classification === 'CORRECT') stabilitySemantic.aiAdditionsCorrect += 1
      if (review.classification === 'AMBIGUOUS') stabilitySemantic.aiAdditionsAmbiguous += 1
      if (review.classification === 'INCORRECT') stabilitySemantic.aiAdditionsIncorrect += 1
    }
    const missingReview = [...row.aiAdditions.map(item => `primary|${item.additionId}`),
      ...(row.stability?.repeatAdditions || []).map(item => `stability|${item.additionId}`)]
      .some(reviewId => !aiReviews.has(reviewId) || aiReviews.get(reviewId).classification === 'PENDING')
    const { classification, reason } = classifyAuditRecipe({
      sourceStatus: row.sourceStatus,
      sourceReason: row.sourceReason,
      currentMapPresent: row.currentMapPresent,
      currentMapEngineVersion: row.currentMapEngineVersion,
      aiStatus: row.hybridStats.aiStatus,
      aiError: row.aiError,
      candidateValid: row.candidateValidation?.valid === true,
      candidateValidationReason: row.candidateValidation?.reason,
      missingReview,
      aiIncorrect: semantic.aiAdditionsIncorrect,
      aiAmbiguous: semantic.aiAdditionsAmbiguous,
      stabilityAiIncorrect: stabilitySemantic.aiAdditionsIncorrect,
      stabilityAiAmbiguous: stabilitySemantic.aiAdditionsAmbiguous,
      stabilityStatus: row.stability?.status,
      deterministicFalsePositive: deterministicReviews.get(row.recipeId)?.classification === 'FALSE_POSITIVE',
    })
    return {
      recipeId: row.recipeId,
      title: row.title,
      classification,
      reason,
      auditVersion,
      sourceHash: row.sourceHash,
      candidateMap: ['READY', 'REVIEW'].includes(classification) ? row.candidateMap : null,
      deterministicStats: row.deterministicStats,
      hybridStats: row.hybridStats,
      semanticReview: semantic,
      ...(row.stability ? {
        stability: {
          classification: row.stability.status,
          ...(row.stability.details ? { details: row.stability.details } : {}),
          semanticReview: stabilitySemantic,
        },
      } : {}),
      precondition: auditPrecondition(row),
      audit: {
        sourceStatus: row.sourceStatus,
        parserEvidence: row.parserEvidence,
        candidateValidation: row.candidateValidation,
        currentMapValidation: row.currentMapValidation,
        currentMapEngineVersion: row.currentMapEngineVersion,
        stability: row.stability ? { status: row.stability.status, attempts: row.stability.attempts, error: row.stability.error || null } : null,
      },
    }
  })
  return sortManifestRows(finalized)
}

function renderReport(date, raw, manifest, reviews, manifestIntegrity) {
  const ready = count(manifest, row => row.classification === 'READY')
  const review = count(manifest, row => row.classification === 'REVIEW')
  const excluded = count(manifest, row => row.classification === 'EXCLUDED')
  const errors = count(manifest, row => row.classification === 'ERROR')
  const existingMaps = count(manifest, row => row.classification === 'EXISTING_MAP')
  const verdict = reviews.executiveVerdict
  const eligible = raw.rows.filter(row => row.sourceStatus === 'ELIGIBLE')
  const sourceExcludedRows = raw.rows.filter(row => row.sourceStatus.startsWith('EXCLUDE_'))
  const reviewedAdditions = reviews.aiAdditions.filter(item => item.classification !== 'PENDING')
  const aiCorrect = count(reviewedAdditions, item => item.classification === 'CORRECT')
  const aiAmbiguous = count(reviewedAdditions, item => item.classification === 'AMBIGUOUS')
  const aiIncorrect = count(reviewedAdditions, item => item.classification === 'INCORRECT')
  const stabilityRows = raw.rows.filter(row => row.stability)
  const det = reviews.deterministicSample
  const rejectionEvidence = raw.rows.flatMap(row => row.validatorRejections || [])
  const rejectionReasons = [
    'uncertain_confidence', 'invalid_or_out_of_range_indexes', 'duplicate_conflicts',
    'group_conflicts', 'negative_or_deferred_contexts', 'unbounded_collective_references',
    'unsupported_remaining_semantics', 'unsupported_usage_metadata', 'ungrounded_quantity_metadata',
    'non_actionable_steps', 'ungrounded_prepared_components',
    'noncanonical_prepared_component_labels', 'deterministic_lock_violations',
  ]
  const usageMetadata = raw.usage.metadata || []
  const usageTotals = usageMetadata.reduce((totals, item) => ({
    inputTokens: totals.inputTokens + (item.inputTokens || 0),
    outputTokens: totals.outputTokens + (item.outputTokens || 0),
    totalTokens: totals.totalTokens + (item.totalTokens || 0),
  }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 })
  const config = raw.auditVersion
  const existingByVersion = [...new Set(raw.rows.filter(row => row.currentMapPresent)
    .map(row => row.currentMapEngineVersion || 'unknown'))].sort()
  const lines = [
    `# Cooking-step mapping v3 production dry run — ${date}`, '',
    '## Executive verdict', '', verdict, '',
    'This is a fresh full-corpus read-only validation. No historical v1 candidate map was used, and no Firestore document was written.', '',
    reviews.verdictReason || '', '',
    '## Configuration audited', '',
    '| Setting | Value |', '|---|---|',
    `| Git SHA | \`${config.gitSha}\` |`,
    `| Schema | \`${config.schemaVersion}\` |`,
    `| Parser | \`${config.parserVersion}\` |`,
    `| Deterministic engine | \`${config.deterministicEngineVersion}\` |`,
    `| Hybrid engine | \`${config.hybridEngineVersion}\` |`,
    `| Prompt | \`${config.promptVersion}\` |`,
    `| Model | \`${config.model}\` |`,
    `| Temperature | \`${config.temperature}\` |`, '',
    '## Production baseline', '',
    '| Metric | Count |', '|---|---:|',
    `| Total shared documents | ${raw.rows.length} |`,
    `| Nonempty shared content | ${count(raw.rows, row => row.contentNonempty)} |`,
    `| Existing persisted maps | ${existingMaps} |`,
    `| Existing v1 maps | ${count(raw.rows, row => ['deterministic-v1', 'hybrid-v1'].includes(row.currentMapEngineVersion))} |`,
    `| Current v3 maps | ${count(raw.rows, row => [config.deterministicEngineVersion, config.hybridEngineVersion].includes(row.currentMapEngineVersion))} |`,
    ...existingByVersion.map(version => `| Existing \`${version}\` maps | ${count(raw.rows, row => row.currentMapEngineVersion === version)} |`),
    `| Source eligible | ${eligible.length} |`,
    `| Source/parser excluded | ${sourceExcludedRows.length} |`,
    `| Parser-defective | ${count(raw.rows, row => row.sourceStatus === 'EXCLUDE_PARSER_DEFECT')} |`,
    `| Empty parsed ingredient arrays | ${count(raw.rows, row => row.parsed.ingredients.length === 0)} |`,
    `| Empty parsed instruction arrays | ${count(raw.rows, row => row.parsed.instructions.length === 0)} |`,
    '', '## Source/content eligibility', '',
    '| Status | Count |', '|---|---:|',
    ...[...new Set(raw.rows.map(row => row.sourceStatus))].sort()
      .map(status => `| \`${status}\` | ${count(raw.rows, row => row.sourceStatus === status)} |`), '',
    ...sourceExcludedRows.map(row => `- **${row.title}** (\`${row.recipeId}\`) — \`${row.sourceStatus}\`: ${row.sourceReason}`), '',
    'These exclusions are source/parser defects, not mapper abstentions. No legacy content was repaired in this audit.', '',
    '## Deterministic-v3 results', '',
    '| Metric | Count |', '|---|---:|',
    `| Instructions | ${sum(eligible, row => row.deterministicStats?.instructionCount || 0)} |`,
    `| Mapped steps | ${sum(eligible, row => row.deterministicStats?.mappedSteps || 0)} |`,
    `| Unmapped steps | ${sum(eligible, row => row.deterministicStats?.unmappedSteps || 0)} |`,
    `| Ingredient references | ${sum(eligible, row => row.deterministicStats?.ingredientReferences || 0)} |`,
    `| Ambiguous steps | ${sum(eligible, row => row.deterministicStats?.ambiguousSteps || 0)} |`,
    `| Implicit-reference steps | ${sum(eligible, row => row.deterministicStats?.implicitReferenceSteps || 0)} |`,
    `| Prepared-component steps | ${sum(eligible, row => row.deterministicStats?.preparedComponentSteps || 0)} |`,
    `| No-ingredient-use steps | ${sum(eligible, row => row.deterministicStats?.noIngredientUseSteps || 0)} |`,
    `| Non-actionable steps | ${sum(eligible, row => row.deterministicStats?.nonActionableSteps || 0)} |`,
    `| AI-eligible steps | ${sum(eligible, row => row.deterministicStats?.aiEligibleSteps || 0)} |`,
    `| Deterministic validation failures | ${count(raw.rows, row => row.sourceStatus === 'ERROR')} |`, '',
    `The new deterministic semantic review covered **${det.length}** eligible recipes: confirmed false-positive recipes **${count(det, item => item.classification === 'FALSE_POSITIVE')}**, safe correct mappings recorded **${sum(det, item => item.safeCorrectMappings || 0)}**, safe omissions recorded **${sum(det, item => item.safeOmissions || 0)}**.`, '',
    ...det.filter(item => item.classification === 'FALSE_POSITIVE')
      .map(item => `- **${item.title}** (\`${item.recipeId}\`) — ${item.explanation}`), '',
    'Status of the nine historical v1 false-positive recipes: Blue Corn, Moqueca, Fried Chicken Sandwich, Creamy Chickpea Masala, and Queso no longer reproduce their prior defect; Butter-Soy fixes the egg-white defect but has a new wrong-group salt false positive; Chicken Wild Rice fixes the broth-index defect but has a new contextual-use false positive; Chicken Chow Mein still maps supplemental note prose; Tacos Al Pastor still maps a heading and wrong-group garlic.', '',
    '## Hybrid-v2 results', '',
    '| Metric | Deterministic | Hybrid |', '|---|---:|---:|',
    `| Mapped steps | ${sum(eligible, row => row.deterministicStats?.mappedSteps || 0)} | ${sum(eligible, row => row.hybridStats.finalMappedSteps)} |`,
    `| Mapped ingredient references | ${sum(eligible, row => row.deterministicStats?.mappedIngredientReferences || 0)} | ${sum(eligible, row => row.hybridStats.finalMappedIngredientReferences)} |`,
    `| AI-eligible unresolved steps | ${sum(eligible, row => row.deterministicStats?.aiEligibleSteps || 0)} | ${sum(eligible, row => row.hybridStats.remainingUnresolvedSteps)} |`,
    `| Prepared components | 0 | ${sum(eligible, row => row.hybridStats.addedPreparedComponents)} |`, '',
    `AI-eligible recipes: **${count(eligible, row => (row.deterministicStats?.aiEligibleSteps || 0) > 0)}**; actual primary recipes called: **${count(eligible, row => row.hybridStats.aiAttempted)}**; primary requests: **${raw.usage.primaryRequests}**; retries: **${raw.usage.primaryRequests - count(eligible, row => row.hybridStats.aiAttempted)}**; failures: **${count(eligible, row => row.hybridStats.aiStatus === 'failed')}**; accepted ingredient additions: **${sum(eligible, row => row.hybridStats.addedIngredientReferences)}**; accepted prepared components: **${sum(eligible, row => row.hybridStats.addedPreparedComponents)}**.`, '',
    'Coverage is descriptive only. Conservative omission is preferred to an incorrect confident association.', '',
    '## AI semantic accuracy', '',
    `Accepted additions reviewed across primary and stability runs: **${reviewedAdditions.length}** — correct **${aiCorrect}**, ambiguous **${aiAmbiguous}**, incorrect **${aiIncorrect}**. Accepted usage qualifiers reviewed: **${count(reviewedAdditions, item => Boolean(item.addition.reference?.usage))}**. Every accepted addition in both executed runs was reviewed.`, '',
    ...reviewedAdditions.filter(item => item.classification !== 'CORRECT')
      .map(item => `- **${item.title}** (${item.run}, \`${item.additionId}\`) — ${item.classification}: ${item.explanation || 'No explanation recorded.'}`),
    ...(aiAmbiguous + aiIncorrect === 0 ? ['- No ambiguous or incorrect accepted AI additions were found.'] : []), '',
    '## Validator rejection evidence', '',
    `Observed rejected or stripped suggestions/metadata: **${rejectionEvidence.length}**.`, '',
    '| Reason | Count |', '|---|---:|',
    ...rejectionReasons.map(reason => `| \`${reason}\` | ${count(rejectionEvidence, item => item.reason === reason)} |`),
    ...(rejectionReasons.length === 0 ? ['| none observed | 0 |'] : []), '',
    'These counts are audit observations produced by replaying each model proposal through the unchanged production merger. They distinguish accepted additions from rejected suggestions and stripped metadata.', '',
    '## Stability', '',
    `Subset: **${stabilityRows.length}** recipes — exact stable **${count(stabilityRows, row => row.stability.status === 'EXACT_STABLE')}**, semantically stable **${count(stabilityRows, row => row.stability.status === 'SEMANTICALLY_STABLE')}**, material differences **${count(stabilityRows, row => row.stability.status === 'MATERIAL_DIFFERENCE')}**, errors **${count(stabilityRows, row => row.stability.status === 'ERROR')}**.`, '',
    ...stabilityRows.filter(row => row.stability.status !== 'EXACT_STABLE').map(row =>
      `- **${row.title}** (\`${row.recipeId}\`) — ${row.stability.status}: ${row.stability.details || 'validated semantic outputs differ; see review evidence.'}`), '',
    'Comparison: historical v1 was 9/20 exact, 1/20 semantically stable, and 10/20 materially different after semantic normalization; bounded v2 was 19/20 exact and 1/20 materially different. Denominators differ from this full-corpus v2 subset.', '',
    '## Before/after comparison', '',
    '| Measure | Historical v1 | Fresh v2 |', '|---|---:|---:|',
    `| Deterministic false-positive recipes in review | 9 / 40 | ${count(det, item => item.classification === 'FALSE_POSITIVE')} / ${det.length} |`,
    `| Incorrect accepted AI additions | 8 / 214 | ${aiIncorrect} / ${reviewedAdditions.length} |`,
    `| Material stability differences | 10 / 20 | ${count(stabilityRows, row => row.stability.status === 'MATERIAL_DIFFERENCE')} / ${stabilityRows.length} |`,
    `| Source/parser exclusions | 49 / 236 | ${sourceExcludedRows.length} / ${raw.rows.length} |`,
    `| Accepted prepared components (primary) | 42 / 187 eligible recipes | ${sum(eligible, row => row.hybridStats.addedPreparedComponents)} / ${eligible.length} eligible recipes |`,
    `| Deterministic mapped steps | 609 / 187 eligible recipes | ${sum(eligible, row => row.deterministicStats?.mappedSteps || 0)} / ${eligible.length} eligible recipes |`,
    `| Hybrid mapped steps | 660 / 187 eligible recipes | ${sum(eligible, row => row.hybridStats.finalMappedSteps)} / ${eligible.length} eligible recipes |`, '',
    'The runs use different engine/prompt/validator versions and, for stability and semantic review, different denominators; the comparison is directional evidence rather than a like-for-like coverage score.', '',
    '## Recipe classification', '',
    '| Classification | Count |', '|---|---:|',
    `| READY | ${ready} |`, `| REVIEW | ${review} |`, `| EXCLUDED | ${excluded} |`,
    `| ERROR | ${errors} |`, `| EXISTING_MAP | ${existingMaps} |`, '',
    '## Remaining risks', '',
    reviews.remainingRisks || '- Parser/content exclusions remain outside mapping correctness. Personal override-specific maps remain unimplemented. AI stability is evidenced only by the recorded rerun subset.', '',
    '## Future apply preconditions', '',
    'For every READY row, a future apply must require: live recipe exists AND live `cookingStepIngredientMap` is absent AND fresh live `sourceHash === manifest.sourceHash` AND the manifest candidate validates under this exact audited v2 contract AND the manifest SHA-256 equals the approved hash. Any failed precondition means SKIP.', '',
    'A future writer may merge only `cookingStepIngredientMap`. It must not modify content, title, category, cuisine, nutrition, servings, times, image, source, metadata, or any user-owned data. No writer exists in this audit.', '',
    '## Manifest integrity', '',
    `Path: \`${path.relative(ROOT, manifestIntegrity.path)}\`; SHA-256: \`${manifestIntegrity.sha256}\`; rows: **${manifest.length}**; READY **${ready}**; REVIEW **${review}**; EXCLUDED **${excluded}**; ERROR **${errors}**; EXISTING_MAP **${existingMaps}**. Every READY candidate passed current production validation against the freshly read shared content.`, '',
    '## Historical v1 manifest status', '',
    '`docs/audits/cooking-step-mapping-dryrun-2026-08-25.json` remains immutable historical evidence only and is **NOT authorized for apply**. No v1 candidate map or classification was loaded by this run.', '',
    '## Production and AI execution', '',
    `Firestore operations: read-only shared \`recipes\` collection queries; writes: **none**. Real Gateway requests: ${raw.usage.primaryRequests + raw.usage.stabilityRequests} (${raw.usage.primaryRequests} primary/retry + ${raw.usage.stabilityRequests} stability/retry). The centralized helper emitted ${usageMetadata.length} usage records totaling ${usageTotals.inputTokens} input, ${usageTotals.outputTokens} output, and ${usageTotals.totalTokens} tokens for ${usageMetadata[0]?.provider || config.model} / ${usageMetadata[0]?.model || config.model}. No dollar cost is inferred.`, '',
  ]
  return `${lines.join('\n').trimEnd()}\n`
}

async function main() {
  const date = auditDate()
  const paths = reviewPaths(date)
  const resume = option('--resume')
  let raw
  if (resume) {
    const cachedRaw = JSON.parse(fs.readFileSync(path.resolve(resume), 'utf8'))
    refreshCachedParserExclusions(cachedRaw.rows)
    raw = await revalidateCachedRun(cachedRaw)
  } else {
    const modules = await loadProductionModules()
    const usage = { primaryRequests: 0, stabilityRequests: 0, metadata: [] }
    const originalInfo = console.info
    console.info = (...values) => {
      if (values[0] === '[ai-usage]' && values[1]) usage.metadata.push(values[1])
      originalInfo(...values)
    }
    try {
      const auditVersion = auditedConfiguration(modules)
      const documents = await readSharedRecipes()
      const rows = await buildBaseline(documents, modules)
      let boundedSelection = null
      if (mode === 'hybrid') await executeHybrid(rows, modules, usage)
      if (mode === 'bounded-hybrid') {
        const targets = selectBoundedHybridTargets(rows, 25)
        boundedSelection = targets.map(row => row.recipeId)
        await executeHybrid(rows, modules, usage, targets, 20)
      }
      raw = {
        auditDate: date,
        executionTimestamp: new Date().toISOString(),
        mode,
        productionWrites: 0,
        limits: LIMITS,
        auditVersion,
        usage,
        ...(boundedSelection ? { boundedSelection } : {}),
        rows,
      }
    } finally {
      console.info = originalInfo
      await modules.close()
    }
    const rawPath = mode === 'hybrid' ? paths.raw
      : mode === 'bounded-hybrid' ? path.join('/tmp', `cooking-step-mapping-bounded-hybrid-v3-${date}.json`)
        : path.join('/tmp', `cooking-step-mapping-deterministic-v3-${date}.json`)
    fs.writeFileSync(rawPath, stableJson(raw))
  }

  if (mode === 'deterministic-only') {
    if (raw.usage.primaryRequests !== 0 || raw.usage.stabilityRequests !== 0) throw new Error('Deterministic mode attempted AI')
    console.log(JSON.stringify({ mode, rows: raw.rows.length, eligible: count(raw.rows, row => row.sourceStatus === 'ELIGIBLE'), aiRequests: 0 }, null, 2))
    return
  }


  if (mode === 'bounded-hybrid') {
    const targets = raw.rows.filter(row => raw.boundedSelection.includes(row.recipeId))
    console.log(JSON.stringify({
      mode,
      rawArtifact: path.join('/tmp', `cooking-step-mapping-bounded-hybrid-v3-${date}.json`),
      uniqueRecipes: targets.length,
      primaryRecipesCalled: count(targets, row => row.hybridStats.aiAttempted),
      primaryRequests: raw.usage.primaryRequests,
      stabilityRecipes: count(targets, row => Boolean(row.stability)),
      stabilityRequests: raw.usage.stabilityRequests,
      acceptedAdditions: sum(targets, row => row.aiAdditions.length),
      productionWrites: raw.productionWrites,
    }, null, 2))
    return
  }

  const template = makeReviewTemplate(raw.rows, date, raw.auditVersion)
  const reviews = loadReviews(paths.reviews, template)
  if (JSON.stringify(reviews.auditVersion) !== JSON.stringify(raw.auditVersion)) {
    throw new Error('Semantic-review configuration does not match the live run; restart from scratch.')
  }
  const stabilityReviews = new Map((reviews.stability || []).map(item => [item.recipeId, item]))
  for (const row of raw.rows) {
    if (!row.stability) continue
    const item = stabilityReviews.get(row.recipeId)
    if (item?.classification !== row.stability.status) {
      throw new Error(`Stability review classification drift for ${row.recipeId}`)
    }
    row.stability.details = item?.details || null
  }
  const pendingAiReviews = count(reviews.aiAdditions, item => item.classification === 'PENDING')
  const pendingDeterministicReviews = count(reviews.deterministicSample, item => item.classification === 'PENDING')
  const pendingStabilityReviews = count(reviews.stability || [], item => item.details === 'PENDING')
  const validVerdicts = new Set(['READY FOR BACKFILL APPLY', 'READY FOR RESTRICTED BACKFILL', 'NOT READY FOR BACKFILL'])
  if (pendingAiReviews || pendingDeterministicReviews || pendingStabilityReviews || !validVerdicts.has(reviews.executiveVerdict)) {
    console.log(JSON.stringify({
      mode, rawArtifact: paths.raw, reviewFile: paths.reviews,
      manifest: null, report: null,
      pendingAiReviews, pendingDeterministicReviews, pendingStabilityReviews,
      verdictRecorded: validVerdicts.has(reviews.executiveVerdict),
    }, null, 2))
    return
  }
  const manifest = finalizeRows(raw.rows, reviews, raw.auditVersion)
  if (fs.existsSync(paths.manifest)) {
    throw new Error(`Refusing to overwrite immutable manifest: ${paths.manifest}`)
  }
  fs.writeFileSync(paths.manifest, stableJson(manifest))
  const manifestBytes = fs.readFileSync(paths.manifest)
  const manifestSha256 = sha256(manifestBytes)
  fs.writeFileSync(paths.report, renderReport(date, raw, manifest, reviews, {
    path: paths.manifest, sha256: manifestSha256,
  }))
  if (sha256(fs.readFileSync(paths.manifest)) !== manifestSha256) {
    throw new Error('Immutable manifest changed after final write')
  }
  console.log(JSON.stringify({
    mode, rawArtifact: paths.raw, reviewFile: paths.reviews,
    manifest: paths.manifest, report: paths.report,
    manifestSha256, rows: manifest.length,
    ready: count(manifest, row => row.classification === 'READY'),
    pendingAiReviews: 0,
    pendingDeterministicReviews: 0,
    pendingStabilityReviews: 0,
  }, null, 2))
}

main().catch(error => { console.error(error); process.exitCode = 1 })
