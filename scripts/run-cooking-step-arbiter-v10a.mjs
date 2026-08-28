#!/usr/bin/env node
/** Executes the bounded, read-only V10A arbiter experiments against frozen candidates. */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { z } from 'zod'
import {
  ARBITER_BATCH_MAX,
  createBatches,
  sha256,
  stableJson,
  toModelCandidate,
  validateBatchResults,
} from './analyze-cooking-step-arbiter-v10a-core.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { loadEnv } = require('./_lib.js')
const date = '2026-08-28'
const frozenPath = path.join(root, `docs/audits/cooking-mode-arbiter-v10a-frozen-candidates-${date}.json`)
const statePath = `/tmp/cooking-step-arbiter-v10a-${date}-state.json`
const timeoutMs = 120_000
const retryLimit = 1
const recipe190Runs = 4

const basis = z.enum([
  'EXPLICIT_ACTIVE_USE',
  'CLEAR_ALIAS',
  'GROUP_OR_COMPONENT_USE',
  'CONTINUING_USE',
  'CONTEXT_ONLY',
  'WRONG_ROW_OR_GROUP',
  'CONSUMED_OR_UNAVAILABLE',
  'QUANTITY_CONFLICT',
  'OTHER',
])
const resultSchema = z.object({
  results: z.array(z.object({
    candidateId: z.string().min(1).max(240),
    decision: z.enum(['ACCEPT', 'REJECT']),
    basis,
    evidenceText: z.string().min(1).max(400),
  })).max(ARBITER_BATCH_MAX),
})

const systemPrompt = `You are a source-grounded binary arbiter for specific proposed Cooking Mode relationships. Discovery is frozen. You are not discovering a map and must never add, omit, combine, or replace candidates.

For every supplied candidate, return exactly one result with the exact candidateId and a binary ACCEPT or REJECT decision. There is no UNCERTAIN option.

For an INGREDIENT_RELATIONSHIP, ACCEPT when that exact listed ingredient row is actively used, manipulated, added, cooked, combined, seasoned with, topped with, garnished with, or clearly continued in the current instruction. Clear aliases, active collective/group references, correct partial/remaining use, and ongoing manipulation of an already introduced row are valid. Do not reject merely because another ingredient is also used, because the row is obvious, or because it is a seasoning, herb, garnish, or main ingredient.

REJECT when the row is only contextual, is the wrong duplicate/group/purpose, has already been consumed incompatibly, is fresh unlisted process material borrowing a listed row, conflicts with source quantity allocation, leaks a raw constituent into a later component-only action, collides with a finished-dish phrase, or otherwise is not actually active in this instruction. Generic action language is insufficient unless it proves this specific row.

For a PREPARED_COMPONENT_RELATIONSHIP, ACCEPT only when the proposed canonical component identity is source-grounded by a label/group or establishing instruction and that component is actively used in the candidate instruction. REJECT invented, wrong, constituent-leaking, already-unavailable, merely contextual, or differently identified components.

Previous/next instructions and prior candidate instructions are source context, not separate candidate claims. Provenance is supporting evidence, not ground truth. Base every decision on the supplied source. evidenceText must give a short exact source quote plus a concise candidate-specific reason.`

async function loadAi() {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { '@': root } },
    plugins: [{
      name: 'v10a-server-only-marker', enforce: 'pre',
      resolveId(id) { return id === 'server-only' ? '\0v10a-server-only' : null },
      load(id) { return id === '\0v10a-server-only' ? 'export {}' : null },
    }],
  })
  try {
    return { ai: await server.ssrLoadModule('/lib/ai.ts'), close: () => server.close() }
  } catch (error) {
    await server.close()
    throw error
  }
}

function emptyState(frozenSha) {
  return {
    schemaVersion: 1,
    frozenSha256: frozenSha,
    batchSizeMaximum: ARBITER_BATCH_MAX,
    retryLimit,
    productionWrites: 0,
    batches: [],
    ingredientResults: {},
    componentResults: {},
    recipe190Runs: [],
    requests: 0,
    retries: 0,
    parseOrSchemaFailures: 0,
    otherRequestFailures: 0,
    usage: [],
    usageSummary: { requests: 0, successfulRequests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  }
}

function readState(frozenSha) {
  if (!fs.existsSync(statePath)) return emptyState(frozenSha)
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  if (state.schemaVersion !== 1 || state.frozenSha256 !== frozenSha) throw new Error('Incompatible V10A state or frozen benchmark changed')
  return state
}

function refreshUsageSummary(state) {
  state.usageSummary = state.usage.reduce((summary, item) => ({
    requests: state.requests,
    successfulRequests: summary.successfulRequests + 1,
    inputTokens: summary.inputTokens + (item.inputTokens || 0),
    outputTokens: summary.outputTokens + (item.outputTokens || 0),
    totalTokens: summary.totalTokens + (item.totalTokens || 0),
  }), { requests: state.requests, successfulRequests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 })
}

function saveState(state) {
  refreshUsageSummary(state)
  fs.writeFileSync(statePath, stableJson(state))
}

function isStructuredFailure(error) {
  return /object|parse|schema|candidateid|result count|duplicate|structured/i.test(String(error?.message || error))
}

function buildPrompt(candidates, batchId) {
  const ingredientRows = new Map()
  const instructions = new Map()
  const ingredientGroups = new Set()
  const modelCandidates = candidates.map(candidate => {
    const safe = toModelCandidate(candidate)
    const context = safe.relevantSurroundingSource || {}
    for (const row of context.relatedIngredientRows || []) ingredientRows.set(row.ingredientIndex, row)
    for (const item of context.priorCandidateInstructions || []) instructions.set(item.instructionIndex, item.text)
    instructions.set(candidate.instructionIndex, candidate.instructionText)
    if (candidate.previousInstructionText) instructions.set(candidate.instructionIndex - 1, candidate.previousInstructionText)
    if (candidate.nextInstructionText) instructions.set(candidate.instructionIndex + 1, candidate.nextInstructionText)
    if (context.establishingInstructionText !== undefined) instructions.set(context.establishingInstructionIndex, context.establishingInstructionText)
    for (const group of context.ingredientGroups || []) ingredientGroups.add(group)
    const { relevantSurroundingSource: _context, previousInstructionText: _previous, nextInstructionText: _next, ...compact } = safe
    return candidate.candidateType === 'PREPARED_COMPONENT_RELATIONSHIP'
      ? { ...compact, componentSourceIdentity: context.sourceLabelOrGroup, establishingInstructionIndex: context.establishingInstructionIndex }
      : compact
  })
  const sourceContext = {
    ingredientRows: [...ingredientRows.values()].sort((left, right) => left.ingredientIndex - right.ingredientIndex),
    instructions: [...instructions].sort((left, right) => left[0] - right[0]).map(([instructionIndex, text]) => ({ instructionIndex, text })),
    ingredientGroups: [...ingredientGroups],
  }
  return `V10A frozen-candidate arbiter experiment. Batch ${batchId}.\n\nRELEVANT SOURCE CONTEXT\n${JSON.stringify(sourceContext, null, 2)}\n\nCANDIDATES\n${JSON.stringify(modelCandidates, null, 2)}\n\nReturn exactly ${candidates.length} results, one for each exact candidateId.`
}

async function callBatch(modules, state, batch, candidates, phase, allowRetry) {
  let firstError = null
  const attempts = allowRetry ? retryLimit + 1 : 1
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    state.requests += 1
    if (attempt > 1) state.retries += 1
    globalThis.__v10aUsageContext = { phase, batchId: batch.batchId, attempt }
    try {
      const output = await modules.ai.generateAIObject({
        feature: phase === 'recipe-190-transport' ? 'cooking-arbiter-v10a-recipe-190'
          : batch.candidateType === 'INGREDIENT_RELATIONSHIP' ? 'cooking-arbiter-v10a-ingredient' : 'cooking-arbiter-v10a-component',
        userId: 'arbiter-v10a-audit-only',
        promptVersion: 'v10a-candidate-binary-v1',
        temperature: 0,
        timeout: timeoutMs,
        system: systemPrompt,
        prompt: buildPrompt(candidates, batch.batchId),
        schema: resultSchema,
      })
      const results = validateBatchResults(batch.candidateIds, output)
      return { status: 'SUCCESS', attempts: attempt, results, error: null }
    } catch (error) {
      firstError ||= String(error?.message || error)
      if (isStructuredFailure(error)) state.parseOrSchemaFailures += 1
      else state.otherRequestFailures += 1
      saveState(state)
      if (attempt === attempts) return {
        status: 'FAILED', attempts: attempt, results: [],
        error: attempt === 1 ? firstError : `first attempt: ${firstError}; retry: ${String(error?.message || error)}`,
      }
    }
  }
  throw new Error('unreachable')
}

async function main() {
  if (!fs.existsSync(frozenPath)) throw new Error(`Frozen benchmark missing: ${frozenPath}`)
  const frozenBytes = fs.readFileSync(frozenPath)
  const frozen = JSON.parse(frozenBytes)
  const frozenSha = sha256(frozenBytes)
  const candidates = [
    ...frozen.populations.INGREDIENT_RELATIONSHIPS,
    ...frozen.populations.PREPARED_COMPONENT_RELATIONSHIPS,
  ]
  const byId = new Map(candidates.map(item => [item.candidateId, item]))
  const batches = createBatches(candidates)
  if (process.argv.includes('--measure')) {
    const sizes = batches.map(batch => Buffer.byteLength(buildPrompt(batch.candidateIds.map(id => byId.get(id)), batch.batchId)))
    process.stdout.write(stableJson({
      batchSizeMaximum: ARBITER_BATCH_MAX,
      logicalBatches: batches.length,
      promptBytes: {
        minimum: Math.min(...sizes),
        average: Math.round(sizes.reduce((sum, value) => sum + value, 0) / sizes.length),
        maximum: Math.max(...sizes),
      },
    }))
    return
  }
  loadEnv()
  const state = readState(frozenSha)
  const modules = await loadAi()
  const originalInfo = console.info
  console.info = (label, metadata, ...rest) => {
    if (label === '[ai-usage]') {
      state.usage.push({ ...globalThis.__v10aUsageContext, ...metadata, capturedAt: new Date().toISOString() })
      saveState(state)
      return
    }
    originalInfo(label, metadata, ...rest)
  }
  try {
    const limitArgument = process.argv.find(value => value.startsWith('--limit-batches='))
    const limit = limitArgument ? Number(limitArgument.split('=')[1]) : Number.POSITIVE_INFINITY
    let executed = 0
    for (const batch of batches) {
      const existing = state.batches.find(item => item.batchId === batch.batchId)
      if (existing?.status === 'SUCCESS') continue
      if (executed >= limit) break
      const batchCandidates = batch.candidateIds.map(id => byId.get(id))
      const outcome = await callBatch(modules, state, batch, batchCandidates, 'primary', true)
      const record = { ...batch, status: outcome.status, attempts: outcome.attempts, error: outcome.error }
      const priorIndex = state.batches.findIndex(item => item.batchId === batch.batchId)
      if (priorIndex >= 0) state.batches[priorIndex] = record
      else state.batches.push(record)
      const target = batch.candidateType === 'INGREDIENT_RELATIONSHIP' ? state.ingredientResults : state.componentResults
      for (const result of outcome.results) target[result.candidateId] = result
      saveState(state)
      process.stdout.write(`${batch.batchId} ${outcome.status} (${outcome.attempts} attempt${outcome.attempts === 1 ? '' : 's'})\n`)
      executed += 1
    }

    const primaryComplete = batches.every(batch => state.batches.find(item => item.batchId === batch.batchId)?.status === 'SUCCESS')
    const recipeCandidates = frozen.populations.INGREDIENT_RELATIONSHIPS.filter(item => item.recipeId === '190')
    const batch = { batchId: 'recipe-190-independent', recipeId: '190', candidateType: 'INGREDIENT_RELATIONSHIP', candidateIds: recipeCandidates.map(item => item.candidateId) }
    for (let runIndex = state.recipe190Runs.length; primaryComplete && runIndex < recipe190Runs; runIndex += 1) {
      batch.batchId = `recipe-190-independent-${runIndex + 1}`
      const outcome = await callBatch(modules, state, batch, recipeCandidates, 'recipe-190-transport', false)
      state.recipe190Runs.push({ runIndex, status: outcome.status, error: outcome.error })
      saveState(state)
      process.stdout.write(`recipe 190 independent ${runIndex + 1}/${recipe190Runs} ${outcome.status}\n`)
    }
    process.stdout.write(`${statePath}\n`)
  } finally {
    console.info = originalInfo
    delete globalThis.__v10aUsageContext
    await modules.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
