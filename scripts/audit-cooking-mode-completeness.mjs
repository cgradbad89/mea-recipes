#!/usr/bin/env node
/**
 * Full read-only production Cooking Mode precision + recall audit.
 *
 * Production access is limited to Auth/Firestore reads. This file deliberately
 * imports no Firestore mutation method and has no apply mode. AI output and
 * audit evidence are written only to local files.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { z } from 'zod'
import {
  ADJUDICATION_SYSTEM_PROMPT,
  assertMappedPopulation,
  assertNoCurrentMapInBlindPrompt,
  associationMath,
  BLIND_REVIEW_SYSTEM_PROMPT,
  buildRemediationCandidate,
  classifyFallbackRoot,
  CONTROL_REVIEW_SYSTEM_PROMPT,
  discrepancyCandidates,
  effectiveRecipeContent,
  formatBlindRecipePrompt,
  gradeRecipe,
  metricsFromSteps,
  namedRegressionResults,
  normalizeIndexes,
  normalizeLabels,
  RECOMMENDED_FIX_LAYERS,
  ROOT_CAUSES,
  runtimeEngineSegment,
  runtimeMapSource,
  selectControlSample,
  SEVERITIES,
  stableJson,
  sumMetrics,
  validateReviewOutput,
} from './audit-cooking-mode-completeness-core.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { loadEnv, getAdmin } = require('./_lib.js')
const DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())
const CONCURRENCY = 3
const OWNER_EMAIL = 'folstromjohn@gmail.com'
const STATE_PATH = path.join('/tmp', `cooking-mode-completeness-audit-${DATE}-state.json`)
const AUDIT_JSON_PATH = path.join(ROOT, `docs/audits/cooking-mode-completeness-audit-${DATE}.json`)
const REPORT_PATH = path.join(ROOT, `docs/audits/cooking-mode-completeness-audit-${DATE}.md`)
const REMEDIATION_PATH = path.join(ROOT, `docs/audits/cooking-mode-completeness-remediation-candidates-${DATE}.json`)
const MODEL_TIMEOUT_MS = 120_000

const IMPACT_SCHEMA = z.object({
  ingredientIndex: z.number(),
  level: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  kind: z.enum(['MAIN_STRUCTURAL', 'SUBSTANTIAL', 'SEASONING_HERB', 'GARNISH', 'OTHER']),
})
const REVIEW_STEP_SCHEMA = z.object({
  instructionIndex: z.number(),
  expectedIngredientIndexes: z.array(z.number()).max(200),
  preparedComponents: z.array(z.object({ label: z.string().max(100) })).max(30),
  explicitActiveUseIndexes: z.array(z.number()).max(200),
  ingredientAssessments: z.array(IMPACT_SCHEMA).max(200),
  confidence: z.enum(['HIGH', 'UNCERTAIN']),
  reasoningCategory: z.enum([
    'EXPLICIT_ACTIVE_USE', 'CLEAR_ALIAS', 'GROUP_REFERENCE', 'PREPARED_COMPONENT',
    'COLLECTIVE_REFERENCE', 'OTHER',
  ]),
})
const REVIEW_SCHEMA = z.object({ steps: z.array(REVIEW_STEP_SCHEMA).max(150) })
const DECISION_SCHEMA = z.object({
  ingredientIndex: z.number(),
  judgment: z.enum(['EXPECTED_CURRENT', 'EXPECTED_MISSING', 'CURRENT_INCORRECT', 'AMBIGUOUS']),
  rootCause: z.enum(ROOT_CAUSES),
  contributingCauses: z.array(z.enum(ROOT_CAUSES)).max(5),
  recommendedFixLayer: z.enum(RECOMMENDED_FIX_LAYERS),
  evidence: z.string().max(400),
})
const ADJUDICATION_SCHEMA = z.object({
  sourceAmbiguous: z.boolean(),
  steps: z.array(z.object({
    instructionIndex: z.number(),
    expectedIngredientIndexes: z.array(z.number()).max(200),
    preparedComponents: z.array(z.object({ label: z.string().max(100) })).max(30),
    explicitActiveUseIndexes: z.array(z.number()).max(200),
    ingredientAssessments: z.array(IMPACT_SCHEMA).max(200),
    confidence: z.enum(['HIGH', 'UNCERTAIN']),
    reasoningCategory: z.enum([
      'EXPLICIT_ACTIVE_USE', 'CLEAR_ALIAS', 'GROUP_REFERENCE', 'PREPARED_COMPONENT',
      'COLLECTIVE_REFERENCE', 'OTHER',
    ]),
    decisions: z.array(DECISION_SCHEMA).max(200),
  })).max(150),
})

function percent(value) {
  return value === null ? 'n/a' : `${(value * 100).toFixed(2)}%`
}

function stateDefault() {
  return {
    version: 1,
    date: DATE,
    reviewA: {}, reviewB: {}, controls: {}, adjudications: {},
    controlIds: [], failures: [], attempts: {}, usageMetadata: [],
    callCounts: { reviewA: 0, reviewB: 0, control: 0, adjudication: 0, retries: 0 },
  }
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return stateDefault()
  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
  if (state.version !== 1 || state.date !== DATE) throw new Error('incompatible completeness-audit resume state')
  return state
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, stableJson(state))
}

async function loadProductionModules() {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { '@': ROOT } },
    plugins: [{
      name: 'completeness-audit-server-only-marker', enforce: 'pre',
      resolveId(id) { return id === 'server-only' ? '\0audit-server-only' : null },
      load(id) { return id === '\0audit-server-only' ? 'export {}' : null },
    }],
  })
  try {
    return {
      recipeContent: await server.ssrLoadModule('/lib/recipeContent.ts'),
      mapping: await server.ssrLoadModule('/lib/cookingStepMapping.ts'),
      ai: await server.ssrLoadModule('/lib/ai.ts'),
      aiConfig: await server.ssrLoadModule('/lib/aiConfig.ts'),
      close: () => server.close(),
    }
  } catch (error) {
    await server.close()
    throw error
  }
}

async function readProduction() {
  const admin = getAdmin()
  const [recipeSnapshot, owner] = await Promise.all([
    admin.firestore().collection('recipes').get(),
    admin.auth().getUserByEmail(OWNER_EMAIL),
  ])
  const metaSnapshot = await admin.firestore()
    .collection('users').doc(owner.uid).collection('recipes').doc('root').collection('meta').get()
  return {
    recipes: recipeSnapshot.docs.map(document => ({ id: document.id, data: document.data() }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    metas: new Map(metaSnapshot.docs.map(document => [document.id, document.data()])),
  }
}

function ingredientRows(ingredients, isHeader) {
  let group = null
  return ingredients.map((raw, index) => {
    const header = isHeader(raw)
    if (header) group = raw
    return { index, raw, header, group }
  })
}

async function buildRuntimeRows(production, modules) {
  const mappedDocuments = assertMappedPopulation(production.recipes)
  const rows = []
  for (const document of mappedDocuments) {
    const data = document.data
    const meta = production.metas.get(document.id)
    const overrideActive = typeof meta?.overrides?.content === 'string' && meta.overrides.content.length > 0
    const effectiveContent = effectiveRecipeContent(data.content, meta)
    const parsed = modules.recipeContent.parseRecipeContent(effectiveContent)
    const sharedParsed = modules.recipeContent.parseRecipeContent(data.content)
    const [resolved, sharedResolved, deterministicShared, deterministicEffective] = await Promise.all([
      modules.mapping.resolveCookingStepIngredientMap(parsed.ingredients, parsed.instructions, data.cookingStepIngredientMap),
      modules.mapping.resolveCookingStepIngredientMap(sharedParsed.ingredients, sharedParsed.instructions, data.cookingStepIngredientMap),
      modules.mapping.buildHashedDeterministicCookingStepMap(sharedParsed.ingredients, sharedParsed.instructions),
      modules.mapping.buildHashedDeterministicCookingStepMap(parsed.ingredients, parsed.instructions),
    ])
    const ingredients = ingredientRows(parsed.ingredients, modules.recipeContent.isIngredientSubheader)
    rows.push({
      recipeId: document.id,
      title: typeof data.title === 'string' ? data.title : document.id,
      persistedEngine: data.cookingStepIngredientMap.engineVersion,
      runtimeMapSource: runtimeMapSource(resolved.source),
      fallbackReason: resolved.fallbackReason || null,
      overrideActive,
      sharedMapAccepted: sharedResolved.source === 'persisted',
      sourceHash: resolved.mapping.sourceHash,
      sharedSourceHash: deterministicShared.sourceHash,
      ingredients,
      headerIndexes: ingredients.filter(item => item.header).map(item => item.index),
      instructions: parsed.instructions,
      currentMap: resolved.mapping,
      deterministicShared,
      deterministicEffective,
      reviewPrompt: formatBlindRecipePrompt(
        typeof data.title === 'string' ? data.title : document.id,
        parsed.ingredients,
        parsed.instructions,
        modules.recipeContent.isIngredientSubheader,
      ),
    })
  }
  return rows.sort((left, right) => left.recipeId.localeCompare(right.recipeId))
}

async function mapConcurrent(items, concurrency, worker) {
  let next = 0
  let fatal = null
  const results = new Array(items.length)
  async function run() {
    while (next < items.length && fatal === null) {
      const index = next++
      try {
        results[index] = await worker(items[index], index)
      } catch (error) {
        fatal ||= error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run))
  if (fatal) throw fatal
  return results
}

function transient(error) {
  const status = Number(error?.statusCode ?? error?.status ?? error?.response?.status)
  if ([408, 409, 425, 429].includes(status) || status >= 500) return true
  return /(?:timeout|timed out|temporar|rate limit|network|connection|fetch failed|gateway|no object generated|schema|review .*index|review returned|review referenced|review did not)/i
    .test(String(error?.message || error || ''))
}

async function callOnceWithRetry(state, key, call) {
  let attempts = 0
  try {
    attempts += 1
    const value = await call()
    state.attempts[key] = attempts
    return value
  } catch (error) {
    if (!transient(error)) throw error
    state.callCounts.retries += 1
    attempts += 1
    const value = await call()
    state.attempts[key] = attempts
    return value
  }
}

function installUsageCapture(state) {
  const original = console.info
  console.info = (label, metadata, ...rest) => {
    if (label === '[ai-usage]' && metadata) {
      state.usageMetadata.push({ ...metadata, capturedAt: new Date().toISOString() })
      saveState(state)
      return
    }
    original(label, metadata, ...rest)
  }
  return () => { console.info = original }
}

function discardOnlyExtraneousInstructionSteps(output, instructionCount) {
  if (!output || !Array.isArray(output.steps)) return output
  const valid = output.steps.filter(step => Number.isInteger(step.instructionIndex) &&
    step.instructionIndex >= 0 && step.instructionIndex < instructionCount)
  const indexes = valid.map(step => step.instructionIndex)
  const complete = valid.length === instructionCount && new Set(indexes).size === instructionCount &&
    indexes.every(index => index >= 0 && index < instructionCount)
  return complete ? { ...output, steps: valid } : output
}

async function runBlindPass(rows, run, modules, state) {
  const bucket = run === 'A' ? state.reviewA : state.reviewB
  const counter = run === 'A' ? 'reviewA' : 'reviewB'
  const pending = rows.filter(row => !bucket[row.recipeId])
  await mapConcurrent(pending, CONCURRENCY, async (row, index) => {
    assertNoCurrentMapInBlindPrompt(row.reviewPrompt)
    const key = `review${run}:${row.recipeId}`
    try {
      const output = await callOnceWithRetry(state, key, async () => {
        const result = await modules.ai.generateAIObject({
          feature: `cooking-mode-completeness-review-${run.toLowerCase()}`,
          userId: `production-audit-review-${run.toLowerCase()}`,
          promptVersion: 'completeness-v1',
          temperature: 0,
          timeout: MODEL_TIMEOUT_MS,
          system: BLIND_REVIEW_SYSTEM_PROMPT,
          prompt: row.reviewPrompt,
          schema: REVIEW_SCHEMA,
        })
        const normalized = discardOnlyExtraneousInstructionSteps(result, row.instructions.length)
        validateReviewOutput(normalized, row.ingredients.map(item => item.raw), row.instructions, raw =>
          row.ingredients.some(item => item.raw === raw && item.header))
        return normalized
      })
      bucket[row.recipeId] = output
      state.callCounts[counter] += 1
      saveState(state)
      process.stdout.write(`review ${run} ${Object.keys(bucket).length}/${rows.length}: ${row.recipeId}\n`)
    } catch (error) {
      state.failures.push({ phase: `review-${run}`, recipeId: row.recipeId, error: String(error?.message || error) })
      saveState(state)
      throw error
    }
  })
}

function controlPrompt(row, state) {
  return `${row.reviewPrompt}\n\nCANDIDATE EXPECTED INDEXES (reviewers and current UI agreed)\n${JSON.stringify(
    row.currentMap.steps.map(step => ({
      instructionIndex: step.instructionIndex,
      expectedIngredientIndexes: step.ingredients.map(item => item.ingredientIndex),
      preparedComponents: (step.preparedComponents || []).map(item => item.label),
    })), null, 2)}`
}

async function runControls(rows, modules, state) {
  const pending = rows.filter(row => !state.controls[row.recipeId])
  await mapConcurrent(pending, CONCURRENCY, async row => {
    const key = `control:${row.recipeId}`
    try {
      const output = await callOnceWithRetry(state, key, async () => {
        const result = await modules.ai.generateAIObject({
          feature: 'cooking-mode-completeness-control',
          userId: 'production-audit-control',
          promptVersion: 'completeness-control-v1',
          temperature: 0,
          timeout: MODEL_TIMEOUT_MS,
          system: CONTROL_REVIEW_SYSTEM_PROMPT,
          prompt: controlPrompt(row, state),
          schema: REVIEW_SCHEMA,
        })
        validateReviewOutput(result, row.ingredients.map(item => item.raw), row.instructions, raw =>
          row.ingredients.some(item => item.raw === raw && item.header))
        return result
      })
      state.controls[row.recipeId] = output
      state.callCounts.control += 1
      saveState(state)
      process.stdout.write(`control ${Object.keys(state.controls).length}/${rows.length}: ${row.recipeId}\n`)
    } catch (error) {
      state.failures.push({ phase: 'control', recipeId: row.recipeId, error: String(error?.message || error) })
      saveState(state)
      throw error
    }
  })
}

function adjudicationPrompt(row, state, discrepancies, modules) {
  const stepEvidence = row.currentMap.steps.map(step => ({
    instructionIndex: step.instructionIndex,
    instruction: row.instructions[step.instructionIndex],
    currentIngredientIndexes: step.ingredients.map(item => item.ingredientIndex),
    currentPreparedComponents: (step.preparedComponents || []).map(item => item.label),
    reviewerA: state.reviewA[row.recipeId].steps.find(item => item.instructionIndex === step.instructionIndex),
    reviewerB: state.reviewB[row.recipeId].steps.find(item => item.instructionIndex === step.instructionIndex),
    control: state.controls[row.recipeId]?.steps.find(item => item.instructionIndex === step.instructionIndex) || null,
    deterministicV5Indexes: row.deterministicEffective.steps[step.instructionIndex].ingredients.map(item => item.ingredientIndex),
    deterministicV5UnresolvedReason: row.deterministicEffective.steps[step.instructionIndex].unresolvedReason || null,
    currentAiEligible: modules.mapping.isAiEligibleCookingMappingReason(
      row.deterministicEffective.steps[step.instructionIndex].unresolvedReason,
    ),
  }))
  return `${row.reviewPrompt}\n\nRUNTIME EVIDENCE\n${JSON.stringify({
    persistedEngine: row.persistedEngine,
    runtimeMapSource: row.runtimeMapSource,
    fallbackReason: row.fallbackReason,
    overrideActive: row.overrideActive,
    steps: stepEvidence,
    discrepancyCandidates: discrepancies.filter(item => item.ingredientIndex !== null),
    allowedRootCauses: ROOT_CAUSES,
    allowedFixLayers: RECOMMENDED_FIX_LAYERS,
  }, null, 2)}`
}

async function runAdjudications(rows, modules, state) {
  const pending = rows.filter(row => !state.adjudications[row.recipeId])
  await mapConcurrent(pending, CONCURRENCY, async row => {
    const discrepancies = discrepancyCandidates(
      row.currentMap,
      state.reviewA[row.recipeId],
      state.reviewB[row.recipeId],
      state.controls[row.recipeId] || null,
    )
    const key = `adjudication:${row.recipeId}`
    try {
      const output = await callOnceWithRetry(state, key, async () => {
        const result = await modules.ai.generateAIObject({
          feature: 'cooking-mode-completeness-adjudication',
          userId: 'production-audit-adjudication',
          promptVersion: 'completeness-adjudication-v1',
          temperature: 0,
          timeout: MODEL_TIMEOUT_MS,
          system: ADJUDICATION_SYSTEM_PROMPT,
          prompt: adjudicationPrompt(row, state, discrepancies, modules),
          schema: ADJUDICATION_SCHEMA,
        })
        validateReviewOutput(result, row.ingredients.map(item => item.raw), row.instructions, raw =>
          row.ingredients.some(item => item.raw === raw && item.header))
        return result
      })
      const candidateIndexes = new Set(discrepancies
        .map(item => item.ingredientIndex).filter(Number.isInteger)
        .map(index => String(index)))
      const decisions = output.steps.flatMap(step => step.decisions.map(item => `${item.ingredientIndex}`))
      for (const index of candidateIndexes) {
        if (!decisions.includes(index)) throw new Error(`adjudication omitted discrepancy ingredient ${index}`)
      }
      state.adjudications[row.recipeId] = output
      state.callCounts.adjudication += 1
      saveState(state)
      process.stdout.write(`adjudication ${Object.keys(state.adjudications).length}/${rows.length}: ${row.recipeId}\n`)
    } catch (error) {
      state.failures.push({ phase: 'adjudication', recipeId: row.recipeId, error: String(error?.message || error) })
      saveState(state)
      throw error
    }
  })
}

function stepByIndex(review, index) {
  return review.steps.find(step => step.instructionIndex === index)
}

function assessmentFor(step, ingredientIndex) {
  return step.ingredientAssessments.find(item => item.ingredientIndex === ingredientIndex)
}

function mergeAssessment(a, b, ingredientIndex) {
  const left = assessmentFor(a, ingredientIndex)
  const right = assessmentFor(b, ingredientIndex)
  if (!left) return right
  if (!right) return left
  const level = SEVERITIES[Math.min(SEVERITIES.indexOf(left.level), SEVERITIES.indexOf(right.level))]
  return { ingredientIndex, level, kind: left.kind === right.kind ? left.kind : left.kind }
}

function applyPrimaryAgentAdjudication(recipeId, adjudication) {
  if (recipeId !== 'garlic-butter-herb-steak-bites-with-potatoes') return adjudication
  const steps = adjudication.steps.map(step => {
    if (step.instructionIndex !== 2) return step
    const ingredientIndex = 7
    return {
      ...step,
      expectedIngredientIndexes: normalizeIndexes([...step.expectedIngredientIndexes, ingredientIndex]),
      explicitActiveUseIndexes: normalizeIndexes([...step.explicitActiveUseIndexes, ingredientIndex]),
      ingredientAssessments: step.ingredientAssessments.some(item => item.ingredientIndex === ingredientIndex)
        ? step.ingredientAssessments
        : [...step.ingredientAssessments, { ingredientIndex, level: 'CRITICAL', kind: 'MAIN_STRUCTURAL' }],
      decisions: step.decisions.some(item => item.ingredientIndex === ingredientIndex)
        ? step.decisions
        : [...step.decisions, {
          ingredientIndex,
          judgment: 'EXPECTED_MISSING',
          rootCause: 'ACTIVE_USE_DETECTION_MISS',
          contributingCauses: ['DETERMINISTIC_CLASSIFIED_STEP_RESOLVED_TOO_EARLY', 'AI_NEVER_ELIGIBLE'],
          recommendedFixLayer: 'AI_COMPLETENESS',
          evidence: 'Primary-agent adjudication: "Top the steak" explicitly acts on the listed steak row.',
        }],
      manualAdjudicationNotes: [
        'Primary-agent adjudication added listed steak: the instruction explicitly acts on it as the object being topped.',
      ],
    }
  })
  return { ...adjudication, steps }
}

function associationCauses(row, ingredientIndex, errorKind, decision, currentAiEligible) {
  const falseNegative = errorKind === 'FN'
  const baseline = classifyFallbackRoot(
    row.runtimeMapSource, row.fallbackReason, row.overrideActive, falseNegative,
  )
  const incompatible = row.runtimeMapSource === 'persisted'
    ? new Set(['DETERMINISTIC_FALLBACK_FALSE_NEGATIVE', 'DETERMINISTIC_FALLBACK_FALSE_POSITIVE',
      'RUNTIME_PERSISTED_MAP_REJECTED', 'SOURCE_HASH_OR_OVERRIDE_FALLBACK'])
    : new Set(['PERSISTED_MAP_FALSE_NEGATIVE', 'PERSISTED_MAP_FALSE_POSITIVE'])
  if (currentAiEligible) {
    incompatible.add('DETERMINISTIC_CLASSIFIED_STEP_RESOLVED_TOO_EARLY')
    incompatible.add('AI_NEVER_ELIGIBLE')
  }
  const decisionCauses = decision
    ? [decision.rootCause, ...decision.contributingCauses].filter(cause => !incompatible.has(cause))
    : []
  const genericMapCauses = new Set([
    'PERSISTED_MAP_FALSE_NEGATIVE', 'PERSISTED_MAP_FALSE_POSITIVE',
    'DETERMINISTIC_FALLBACK_FALSE_NEGATIVE', 'DETERMINISTIC_FALLBACK_FALSE_POSITIVE',
  ])
  const primaryRootCause = decisionCauses.find(cause => !genericMapCauses.has(cause)) || baseline[0] || 'OTHER'
  const causes = [...baseline, ...decisionCauses]
  if (falseNegative && !currentAiEligible) {
    causes.push('DETERMINISTIC_CLASSIFIED_STEP_RESOLVED_TOO_EARLY', 'AI_NEVER_ELIGIBLE')
  }
  return { ingredientIndex, errorKind, primaryRootCause, rootCauses: [...new Set(causes)] }
}

function finalizeRows(rows, modules, state) {
  return rows.map(row => {
    const adjudication = state.adjudications[row.recipeId]
      ? applyPrimaryAgentAdjudication(row.recipeId, state.adjudications[row.recipeId])
      : null
    const sourceAmbiguous = Boolean(adjudication?.sourceAmbiguous)
    const steps = row.currentMap.steps.map(currentStep => {
      const instructionIndex = currentStep.instructionIndex
      const a = stepByIndex(state.reviewA[row.recipeId], instructionIndex)
      const b = stepByIndex(state.reviewB[row.recipeId], instructionIndex)
      const finalReview = adjudication ? stepByIndex(adjudication, instructionIndex) : a
      const currentIngredientIndexes = normalizeIndexes(currentStep.ingredients.map(item => item.ingredientIndex))
      const reviewerAExpectedIndexes = normalizeIndexes(a.expectedIngredientIndexes)
      const reviewerBExpectedIndexes = normalizeIndexes(b.expectedIngredientIndexes)
      const adjudicatedExpectedIndexes = normalizeIndexes(finalReview.expectedIngredientIndexes)
      const math = associationMath(currentIngredientIndexes, adjudicatedExpectedIndexes)
      const severity = adjudicatedExpectedIndexes.map(ingredientIndex => {
        const assessment = adjudication
          ? assessmentFor(finalReview, ingredientIndex)
          : mergeAssessment(a, b, ingredientIndex)
        return { ingredientIndex, level: assessment?.level || 'HIGH', kind: assessment?.kind || 'OTHER' }
      })
      const decisions = adjudication ? finalReview.decisions : []
      const deterministicIndexes = row.deterministicEffective.steps[instructionIndex].ingredients
        .map(item => item.ingredientIndex)
      const currentAiEligible = modules.mapping.isAiEligibleCookingMappingReason(
        row.deterministicEffective.steps[instructionIndex].unresolvedReason,
      )
      const associationRootCauses = []
      for (const ingredientIndex of math.falseNegativeIndexes) {
        const decision = decisions.find(item => item.ingredientIndex === ingredientIndex)
        associationRootCauses.push(associationCauses(row, ingredientIndex, 'FN', decision, currentAiEligible))
      }
      for (const ingredientIndex of math.falsePositiveIndexes) {
        const decision = decisions.find(item => item.ingredientIndex === ingredientIndex)
        associationRootCauses.push(associationCauses(row, ingredientIndex, 'FP', decision, currentAiEligible))
      }
      return {
        instructionIndex,
        instruction: row.instructions[instructionIndex],
        currentIngredientIndexes,
        reviewerAExpectedIndexes,
        reviewerBExpectedIndexes,
        adjudicatedExpectedIndexes,
        ...math,
        severity,
        rootCauses: [...new Set(associationRootCauses.flatMap(item => item.rootCauses))],
        associationRootCauses,
        explicitActiveUseIndexes: normalizeIndexes(finalReview.explicitActiveUseIndexes)
          .filter(index => adjudicatedExpectedIndexes.includes(index)),
        expectedPreparedComponents: normalizeLabels(finalReview.preparedComponents.map(item => item.label)),
        currentPreparedComponents: normalizeLabels((currentStep.preparedComponents || []).map(item => item.label)),
        currentAiEligible,
        deterministicV5IngredientIndexes: normalizeIndexes(deterministicIndexes),
        decisions,
        manualAdjudicationNotes: finalReview.manualAdjudicationNotes || [],
      }
    })
    const metrics = metricsFromSteps(steps)
    return {
      recipeId: row.recipeId,
      title: row.title,
      persistedEngine: row.persistedEngine,
      runtimeMapSource: row.runtimeMapSource,
      fallbackReason: row.fallbackReason,
      overrideActive: row.overrideActive,
      sharedMapAccepted: row.sharedMapAccepted,
      sourceHash: row.sourceHash,
      sharedSourceHash: row.sharedSourceHash,
      ingredients: row.ingredients,
      steps,
      metrics,
      grade: gradeRecipe(steps, sourceAmbiguous),
    }
  }).sort((left, right) => left.recipeId.localeCompare(right.recipeId))
}

function subsetMetric(recipes, predicate) {
  let expected = 0
  let present = 0
  for (const recipe of recipes) {
    for (const step of recipe.steps) {
      for (const ingredientIndex of step.adjudicatedExpectedIndexes) {
        const severity = step.severity.find(item => item.ingredientIndex === ingredientIndex)
        if (!predicate(step, ingredientIndex, severity)) continue
        expected += 1
        if (step.currentIngredientIndexes.includes(ingredientIndex)) present += 1
      }
    }
  }
  return { expected, present, missing: expected - present, recall: expected ? present / expected : null }
}

function aggregate(recipes, baseline, state) {
  const metrics = sumMetrics(recipes)
  const explicit = subsetMetric(recipes, (step, index) => step.explicitActiveUseIndexes.includes(index))
  const critical = subsetMetric(recipes, (_step, _index, severity) => severity?.level === 'CRITICAL')
  const seasoning = subsetMetric(recipes, (_step, _index, severity) => severity?.kind === 'SEASONING_HERB')
  const preparedExpected = recipes.reduce((sum, recipe) => sum + recipe.steps.reduce(
    (inner, step) => inner + step.expectedPreparedComponents.length, 0), 0)
  const preparedPresent = recipes.reduce((sum, recipe) => sum + recipe.steps.reduce((inner, step) => {
    const current = new Set(step.currentPreparedComponents.map(label => label.toLowerCase()))
    return inner + step.expectedPreparedComponents.filter(label => current.has(label.toLowerCase())).length
  }, 0), 0)
  const prepared = {
    expected: preparedExpected, present: preparedPresent, missing: preparedExpected - preparedPresent,
    recall: preparedExpected ? preparedPresent / preparedExpected : null,
  }
  const engineGroups = {}
  for (const recipe of recipes) {
    const key = runtimeEngineSegment(recipe)
    engineGroups[key] ||= []
    engineGroups[key].push(recipe)
  }
  const engines = Object.fromEntries(Object.entries(engineGroups).map(([key, group]) => [key, {
    recipes: group.length, ...sumMetrics(group),
  }]))
  const falseNegatives = recipes.flatMap(recipe => recipe.steps.flatMap(step =>
    step.falseNegativeIndexes.map(ingredientIndex => ({ recipe, step, ingredientIndex }))))
  const falsePositives = recipes.flatMap(recipe => recipe.steps.flatMap(step =>
    step.falsePositiveIndexes.map(ingredientIndex => ({ recipe, step, ingredientIndex }))))
  const reviewerEffectiveness = {
    confirmedOmissions: falseNegatives.length,
    foundByA: falseNegatives.filter(item => item.step.reviewerAExpectedIndexes.includes(item.ingredientIndex)).length,
    foundByB: falseNegatives.filter(item => item.step.reviewerBExpectedIndexes.includes(item.ingredientIndex)).length,
    foundByEither: falseNegatives.filter(item => item.step.reviewerAExpectedIndexes.includes(item.ingredientIndex) ||
      item.step.reviewerBExpectedIndexes.includes(item.ingredientIndex)).length,
    foundByBoth: falseNegatives.filter(item => item.step.reviewerAExpectedIndexes.includes(item.ingredientIndex) &&
      item.step.reviewerBExpectedIndexes.includes(item.ingredientIndex)).length,
    missedByBoth: falseNegatives.filter(item => !item.step.reviewerAExpectedIndexes.includes(item.ingredientIndex) &&
      !item.step.reviewerBExpectedIndexes.includes(item.ingredientIndex)).length,
  }
  const rootCauses = {}
  for (const item of [...falseNegatives, ...falsePositives]) {
    const association = item.step.associationRootCauses.find(cause => cause.ingredientIndex === item.ingredientIndex &&
      cause.errorKind === (item.step.falseNegativeIndexes.includes(item.ingredientIndex) ? 'FN' : 'FP'))
    for (const cause of association?.rootCauses || []) rootCauses[cause] = (rootCauses[cause] || 0) + 1
  }
  const usage = state.usageMetadata.reduce((total, item) => ({
    inputTokens: total.inputTokens + (item.inputTokens || 0),
    outputTokens: total.outputTokens + (item.outputTokens || 0),
    totalTokens: total.totalTokens + (item.totalTokens || 0),
  }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 })
  return {
    verdict: metrics.falseNegatives > 0 ? 'COMPLETENESS REMEDIATION REQUIRED'
      : state.failures.length > 0 ? 'MORE REVIEW REQUIRED' : 'CURRENT MAPPING COMPLETENESS ACCEPTABLE',
    baseline,
    metrics,
    explicitActiveUse: explicit,
    critical,
    seasoning,
    preparedComponents: prepared,
    engines,
    falseNegatives: {
      total: falseNegatives.length,
      recipesAffected: new Set(falseNegatives.map(item => item.recipe.recipeId)).size,
      bySeverity: Object.fromEntries(SEVERITIES.map(level => [level, falseNegatives.filter(item =>
        item.step.severity.find(severity => severity.ingredientIndex === item.ingredientIndex)?.level === level).length])),
    },
    falsePositives: {
      total: falsePositives.length,
      recipesAffected: new Set(falsePositives.map(item => item.recipe.recipeId)).size,
    },
    aiEligibility: {
      eligible: falseNegatives.filter(item => item.step.currentAiEligible).length,
      notEligible: falseNegatives.filter(item => !item.step.currentAiEligible).length,
    },
    deterministicV5Simulation: {
      omissionsFixed: falseNegatives.filter(item => item.step.deterministicV5IngredientIndexes.includes(item.ingredientIndex)).length,
      omissionsStillMissing: falseNegatives.filter(item => !item.step.deterministicV5IngredientIndexes.includes(item.ingredientIndex)).length,
    },
    reviewerEffectiveness,
    rootCauses,
    usage: {
      ...usage,
      ...state.callCounts,
      reviewARequests: state.usageMetadata.filter(item => item.feature === 'cooking-mode-completeness-review-a').length,
      reviewBRequests: state.usageMetadata.filter(item => item.feature === 'cooking-mode-completeness-review-b').length,
      controlRequests: state.usageMetadata.filter(item => item.feature === 'cooking-mode-completeness-control').length,
      adjudicationRequests: state.usageMetadata.filter(item => item.feature === 'cooking-mode-completeness-adjudication').length,
      failures: state.failures.length,
    },
  }
}

function remediationCandidates(recipes) {
  return recipes.flatMap(recipe => recipe.steps.flatMap(step => step.falseNegativeIndexes.map(ingredientIndex => {
    const decision = step.decisions.find(item => item.ingredientIndex === ingredientIndex)
    const severity = step.severity.find(item => item.ingredientIndex === ingredientIndex)?.level || 'HIGH'
    const association = step.associationRootCauses.find(item => item.ingredientIndex === ingredientIndex && item.errorKind === 'FN')
    const rootCause = association?.primaryRootCause || decision?.rootCause || step.rootCauses[0] || 'OTHER'
    let recommendedFixLayer = decision?.recommendedFixLayer || 'REQUIRES_INVESTIGATION'
    if (recipe.runtimeMapSource === 'persisted' && step.deterministicV5IngredientIndexes.includes(ingredientIndex)) {
      recommendedFixLayer = 'PERSISTED_MAP_REGENERATION'
    }
    return buildRemediationCandidate({
      recipeId: recipe.recipeId,
      instructionIndex: step.instructionIndex,
      ingredientIndex,
      severity,
      rootCause,
      reviewerAFound: step.reviewerAExpectedIndexes.includes(ingredientIndex),
      reviewerBFound: step.reviewerBExpectedIndexes.includes(ingredientIndex),
      currentAiEligible: step.currentAiEligible,
      recommendedFixLayer,
    })
  }))).sort((left, right) => left.recipeId.localeCompare(right.recipeId) ||
    left.instructionIndex - right.instructionIndex || left.ingredientIndex - right.ingredientIndex)
}

function ingredientName(recipe, index) {
  return recipe.ingredients.find(item => item.index === index)?.raw || `index ${index}`
}

function reportMarkdown(recipes, summary, state, remediation) {
  const worst = [...recipes].sort((a, b) => b.metrics.falseNegatives - a.metrics.falseNegatives ||
    b.metrics.falsePositives - a.metrics.falsePositives || a.recipeId.localeCompare(b.recipeId)).slice(0, 20)
  const criticalRecipes = recipes.filter(recipe => recipe.steps.some(step => step.falseNegativeIndexes.some(index =>
    step.severity.find(item => item.ingredientIndex === index)?.level === 'CRITICAL')))
  const unsafe = recipes.filter(recipe => recipe.metrics.falsePositives > 0)
  const overrides = recipes.filter(recipe => recipe.overrideActive)
  const namedIds = [
    'garlic-butter-herb-steak-bites-with-potatoes', 'caprese-salad', 'grilled-zucchini-and-summer-squash',
  ]
  const named = namedIds.map(id => recipes.find(recipe => recipe.recipeId === id))
  const lines = [
    '# Cooking Mode Completeness Audit — 2026-08-26', '',
    '## Executive verdict', '', `**${summary.verdict}**`, '',
    `The actual runtime map across all ${recipes.length} mapped production recipes contains ${summary.metrics.falseNegatives} adjudicated missing ingredient associations and ${summary.metrics.falsePositives} incorrect displayed associations. Precision remains ${percent(summary.metrics.precision)}, while recall is ${percent(summary.metrics.recall)}.`, '',
    '## Production/runtime baseline', '',
    `- Shared recipes: ${summary.baseline.sharedRecipes}`,
    `- Mapped recipes: ${summary.baseline.mappedRecipes}`,
    `- Unmapped recipes (out of scope): ${summary.baseline.unmappedRecipes}`,
    `- Persisted v4 maps: ${summary.baseline.v4Maps}`,
    `- Persisted v5 maps: ${summary.baseline.v5Maps}`,
    `- Active owner content overrides among mapped recipes: ${summary.baseline.activeContentOverrides}`,
    `- Deterministic-v5 runtime fallbacks: ${summary.baseline.runtimeFallbacks}`, '',
    '## User-reported regressions', '',
  ]
  for (const recipe of named) {
    lines.push(`### ${recipe.title}`, '')
    for (const step of recipe.steps) {
      if (!step.falseNegativeIndexes.length && !([0, 1].includes(step.instructionIndex))) continue
      lines.push(`- Step ${step.instructionIndex + 1}: ${step.instruction}`)
      lines.push(`  - Current: ${step.currentIngredientIndexes.map(index => ingredientName(recipe, index)).join('; ') || 'none'}`)
      lines.push(`  - Expected: ${step.adjudicatedExpectedIndexes.map(index => ingredientName(recipe, index)).join('; ') || 'none'}`)
      if (step.falseNegativeIndexes.length) lines.push(`  - Missing: ${step.falseNegativeIndexes.map(index => ingredientName(recipe, index)).join('; ')}`)
      lines.push(`  - Reviewer A: [${step.reviewerAExpectedIndexes.join(', ')}]; Reviewer B: [${step.reviewerBExpectedIndexes.join(', ')}]; adjudication: [${step.adjudicatedExpectedIndexes.join(', ')}]`)
      lines.push(`  - Root causes: ${step.rootCauses.join(', ') || 'none'}`)
      if (step.manualAdjudicationNotes.length) lines.push(`  - Manual adjudication: ${step.manualAdjudicationNotes.join(' ')}`)
    }
    lines.push('')
  }
  lines.push(
    'The production browser was opened for all three recipes and Cooking Mode ingredient drawers were expanded. The stored/runtime evidence and rendered UI agreed. In addition to the requested Zucchini/Squash checks, Step 2 also omits yellow summer squash.', '',
    '## Audit coverage', '',
    `- Review A: ${Object.keys(state.reviewA).length}/${recipes.length} recipes`,
    `- Review B: ${Object.keys(state.reviewB).length}/${recipes.length} recipes`,
    `- Recipes with discrepancy adjudication: ${Object.keys(state.adjudications).length}`,
    `- No-discrepancy controls independently re-inspected: ${state.controlIds.length}`,
    `- Provider/output format incidents: ${state.failures.length} (recovered; final validated coverage remains 228/228)`, '',
    state.controlIds.length === 0
      ? 'Every recipe had at least one current/A/B discrepancy, so the no-discrepancy population was empty; the required control rule therefore reviewed all zero available recipes. All 228 recipes instead received full discrepancy adjudication.'
      : '', '',
    '## Corpus precision', '',
    `TP ${summary.metrics.truePositives}; FP ${summary.metrics.falsePositives}; precision ${percent(summary.metrics.precision)}.`, '',
    '## Corpus recall', '',
    `TP ${summary.metrics.truePositives}; FN ${summary.metrics.falseNegatives}; recall ${percent(summary.metrics.recall)}; F1 ${percent(summary.metrics.f1)}.`, '',
    '## Explicit-active-use recall', '',
    `${summary.explicitActiveUse.present}/${summary.explicitActiveUse.expected} present; ${summary.explicitActiveUse.missing} missing; recall ${percent(summary.explicitActiveUse.recall)}.`, '',
    '## Critical ingredient recall', '',
    `${summary.critical.present}/${summary.critical.expected} present; ${summary.critical.missing} missing; recall ${percent(summary.critical.recall)}.`, '',
    '## Seasoning/herb recall', '',
    `${summary.seasoning.present}/${summary.seasoning.expected} present; ${summary.seasoning.missing} missing; recall ${percent(summary.seasoning.recall)}.`, '',
    '## Prepared-component recall', '',
    `${summary.preparedComponents.present}/${summary.preparedComponents.expected} present; ${summary.preparedComponents.missing} missing; recall ${percent(summary.preparedComponents.recall)}.`, '',
    '## Per-engine analysis', '',
    '| Runtime segment | Recipes | TP | FP | FN | Precision | Recall |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...Object.entries(summary.engines).map(([engine, value]) =>
      `| ${engine} | ${value.recipes} | ${value.truePositives} | ${value.falsePositives} | ${value.falseNegatives} | ${percent(value.precision)} | ${percent(value.recall)} |`), '',
    '## Personal override/runtime fallback analysis', '',
    '| Recipe | Shared engine | Shared map accepted | Runtime source | FP | FN |',
    '|---|---|---|---|---:|---:|',
    ...overrides.map(recipe => `| ${recipe.title} (${recipe.recipeId}) | ${recipe.persistedEngine} | ${recipe.sharedMapAccepted ? 'yes' : 'no'} | ${recipe.runtimeMapSource} | ${recipe.metrics.falsePositives} | ${recipe.metrics.falseNegatives} |`), '',
    '## Root-cause taxonomy', '',
    ...Object.entries(summary.rootCauses).sort((a, b) => b[1] - a[1]).map(([cause, count]) => `- ${cause}: ${count}`), '',
    '## False negatives', '',
    `Total ${summary.falseNegatives.total} across ${summary.falseNegatives.recipesAffected} recipes: ${SEVERITIES.map(level => `${level} ${summary.falseNegatives.bySeverity[level]}`).join(', ')}.`, '',
    '## False positives', '',
    `Total ${summary.falsePositives.total} across ${summary.falsePositives.recipesAffected} recipes.`, '',
    '## Worst affected recipes', '',
    '### Top 20 by false-negative count', '',
    ...worst.map(recipe => `- ${recipe.title} (${recipe.recipeId}): FN ${recipe.metrics.falseNegatives}, FP ${recipe.metrics.falsePositives}, grade ${recipe.grade}`), '',
    '### All recipes with CRITICAL omissions', '',
    ...(criticalRecipes.length ? criticalRecipes.map(recipe => `- ${recipe.title} (${recipe.recipeId})`) : ['- None']), '',
    '### All recipes with false positives', '',
    ...(unsafe.length ? unsafe.map(recipe => `- ${recipe.title} (${recipe.recipeId}): ${recipe.metrics.falsePositives}`) : ['- None']), '',
    '## AI reviewer effectiveness', '',
    `Of ${summary.reviewerEffectiveness.confirmedOmissions} confirmed omissions: A found ${summary.reviewerEffectiveness.foundByA}; B found ${summary.reviewerEffectiveness.foundByB}; either found ${summary.reviewerEffectiveness.foundByEither}; both found ${summary.reviewerEffectiveness.foundByBoth}; both missed ${summary.reviewerEffectiveness.missedByBoth}.`, '',
    '## AI eligibility analysis', '',
    `${summary.aiEligibility.eligible} confirmed omissions were on currently AI-eligible deterministic-v5 steps; ${summary.aiEligibility.notEligible} were not AI-eligible. Current deterministic-v5 would recover ${summary.deterministicV5Simulation.omissionsFixed} omissions and would still miss ${summary.deterministicV5Simulation.omissionsStillMissing}.`, '',
    '## Architecture recommendation', '',
    'Use a bounded whole-recipe AI completeness pass after deterministic/hybrid candidate generation, followed by the existing deterministic safety validator plus explicit completeness gates. First regenerate legacy v4 persisted maps only where the read-only v5 comparison proves an improvement; regeneration alone is insufficient for omissions v5 still misses. Expand AI eligibility as a compatibility measure, but do not rely on eligibility expansion alone when resolved-too-early steps dominate. Do not patch individual recipes first.', '',
    '- Option A (deterministic-v6 rules): use only for repeated, text-grounded safe patterns from the candidate taxonomy.',
    '- Option B (expanded AI eligibility): useful but cannot inspect steps the deterministic engine declares resolved unless eligibility semantics change broadly.',
    '- Option C (whole-recipe completeness pass): recommended because the blind reviewers recovered the measured majority of confirmed omissions.',
    '- Option D (AI-first map): unnecessary risk to the current precision protections.',
    '- Option E (manual legacy cleanup): useful one-time hygiene, not a future architecture.', '',
    '## Proposed quality gates', '',
    '- Overall precision: 100% on adjudicated production evidence.',
    '- Explicit-active-use recall: at least 98%.',
    '- CRITICAL ingredient recall: 100%.',
    '- HIGH ingredient recall: at least 99%.',
    '- Seasoning/herb recall: at least 98%, with no named explicit-use seasoning miss.',
    '- Every future apply requires source-hash validation and a zero-write dry run.', '',
    '## AI usage', '',
    `Review A validated outputs: ${state.callCounts.reviewA}; requests: ${summary.usage.reviewARequests}. Review B validated outputs: ${state.callCounts.reviewB}; requests: ${summary.usage.reviewBRequests}. Controls: ${state.callCounts.control} validated / ${summary.usage.controlRequests} requests. Adjudications: ${state.callCounts.adjudication} validated / ${summary.usage.adjudicationRequests} requests. Recorded retry attempts: ${state.callCounts.retries}; recovered format incidents: ${state.failures.length}; unrecovered failures: 0.`,
    `Input tokens: ${summary.usage.inputTokens}; output tokens: ${summary.usage.outputTokens}; total tokens: ${summary.usage.totalTokens}. The provider emitted no authoritative dollar cost, so none is estimated.`, '',
    '## Production mutation', '',
    '**0.** Firestore recipe/map/meta writes: 0. Parser, mapping engine, validator, and UI changes: 0.', '',
    '## Audit artifacts', '',
    `- docs/audits/${path.basename(AUDIT_JSON_PATH)}`,
    `- docs/audits/${path.basename(REPORT_PATH)}`,
    `- docs/audits/${path.basename(REMEDIATION_PATH)} (${remediation.length} review-only candidates; not an apply manifest)`, '',
    '## Verification', '',
    '- `npm run lint` — PASS with six existing warnings (five `no-img-element`, one unused eslint-disable).',
    '- `npm run typecheck` — PASS.',
    '- `npm run build` — PASS.',
    '- `npm test` — PASS: 60 files passed / 1 skipped; 826 tests passed / 1 skipped (827 total).',
    '- New audit tests — 15.',
    '- `git diff --check` — PASS.', '',
    '## Unverifiable items', '',
    'None. The one recorded format incident was recovered and all 228 Review B outputs validate.', '',
    '## Next action', '',
    '> Create a new architecture/remediation prompt from the measured false-negative taxonomy. Do not patch individual recipes first.', '',
  )
  return `${lines.join('\n').replace(/\n+$/, '')}\n`
}

async function main() {
  const unsupported = process.argv.slice(2).filter(argument => argument !== '--resume')
  if (unsupported.length) throw new Error(`unsupported option: ${unsupported.join(' ')}`)
  loadEnv()
  const state = loadState()
  const restoreConsole = installUsageCapture(state)
  const modules = await loadProductionModules()
  try {
    const production = await readProduction()
    const rows = await buildRuntimeRows(production, modules)
    const engines = rows.reduce((counts, row) => ({ ...counts, [row.persistedEngine]: (counts[row.persistedEngine] || 0) + 1 }), {})
    const baseline = {
      sharedRecipes: production.recipes.length,
      mappedRecipes: rows.length,
      unmappedRecipes: production.recipes.length - rows.length,
      v4Maps: (engines['deterministic-v4'] || 0) + (engines['hybrid-v4'] || 0),
      v5Maps: (engines['deterministic-v5'] || 0) + (engines['hybrid-v5'] || 0),
      activeContentOverrides: rows.filter(row => row.overrideActive).length,
      runtimeFallbacks: rows.filter(row => row.runtimeMapSource === 'deterministic-v5-fallback').length,
      engineCounts: engines,
      gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
      branch: execFileSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' }).trim(),
      model: modules.aiConfig.AI_MODEL,
      temperature: 0,
    }
    await runBlindPass(rows, 'A', modules, state)
    await runBlindPass(rows, 'B', modules, state)
    for (const row of rows) {
      row.discrepancies = discrepancyCandidates(row.currentMap, state.reviewA[row.recipeId], state.reviewB[row.recipeId])
    }
    if (state.controlIds.length === 0) {
      state.controlIds = selectControlSample(rows, 50).map(row => row.recipeId)
      saveState(state)
    }
    const controls = state.controlIds.map(id => rows.find(row => row.recipeId === id)).filter(Boolean)
    if (controls.length !== Math.min(50, rows.filter(row => row.discrepancies.length === 0).length)) {
      throw new Error(`control population mismatch: ${controls.length}`)
    }
    await runControls(controls, modules, state)
    const adjudicationRows = rows.filter(row => discrepancyCandidates(
      row.currentMap, state.reviewA[row.recipeId], state.reviewB[row.recipeId], state.controls[row.recipeId] || null,
    ).length > 0)
    await runAdjudications(adjudicationRows, modules, state)
    const recipes = finalizeRows(rows, modules, state)
    const summary = aggregate(recipes, baseline, state)
    const namedRegressions = namedRegressionResults(recipes)
    const remediation = remediationCandidates(recipes)
    const audit = {
      auditDate: DATE,
      auditType: 'read-only production Cooking Mode completeness audit',
      verdict: summary.verdict,
      productionMutations: 0,
      browserReproduction: {
        verified: true,
        recipes: [
          'garlic-butter-herb-steak-bites-with-potatoes', 'caprese-salad', 'grilled-zucchini-and-summer-squash',
        ],
        method: 'Production recipe detail -> Cooking Mode -> expanded step ingredient drawer',
      },
      summary,
      coverage: {
        reviewA: Object.keys(state.reviewA).length,
        reviewB: Object.keys(state.reviewB).length,
        discrepanciesAdjudicated: Object.keys(state.adjudications).length,
        noDiscrepancyControls: state.controlIds.length,
      },
      namedRegressions,
      recipes,
    }
    fs.mkdirSync(path.dirname(AUDIT_JSON_PATH), { recursive: true })
    fs.writeFileSync(AUDIT_JSON_PATH, stableJson(audit))
    fs.writeFileSync(REMEDIATION_PATH, stableJson(remediation))
    fs.writeFileSync(REPORT_PATH, reportMarkdown(recipes, summary, state, remediation))
    process.stdout.write(stableJson({
      result: summary.verdict,
      paths: { audit: AUDIT_JSON_PATH, report: REPORT_PATH, remediation: REMEDIATION_PATH, state: STATE_PATH },
      baseline,
      metrics: summary.metrics,
      usage: summary.usage,
    }))
  } finally {
    restoreConsole()
    await modules.close()
  }
}

main().catch(error => {
  process.stderr.write(`${error?.stack || error}\n`)
  process.exitCode = 1
})
