#!/usr/bin/env node
/** Executes bounded V10C active-target arbitration against truth-free frozen input. */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { z } from 'zod'
import { sha256, stableJson } from './analyze-cooking-step-arbiter-v10a-core.mjs'
import { createRiskBatches, validateArbiterResults } from './analyze-cooking-mode-v10c-active-target-core.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { loadEnv } = require('./_lib.js')
const date = '2026-08-28'
const inputPath = `/tmp/cooking-mode-v10c-risk-input-${date}.json`
const statePath = `/tmp/cooking-mode-v10c-state-${date}.json`
const maxBatch = 15
const timeoutMs = 120_000
const recipe190Runs = 4

const schema = z.object({
  results: z.array(z.object({
    candidateId: z.string().min(1).max(240),
    decision: z.enum(['ACCEPT', 'REJECT']),
    basis: z.enum([
      'DIRECT_ACTIVE_TARGET', 'VALID_CONTINUING_USE', 'VALID_RESERVED_OR_DIVIDED_USE',
      'PASSIVE_COMPONENT_CONSTITUENT', 'FULLY_CONSUMED', 'CONTEXT_ONLY',
      'FRESH_PROCESS_MATERIAL', 'WRONG_DUPLICATE_OR_GROUP', 'QUANTITY_CONFLICT', 'OTHER',
    ]),
    evidenceText: z.string().min(1).max(600),
  })).max(maxBatch),
})

const systemPrompt = `You are the V10C precision arbiter for frozen ingredient-row candidates. Return exactly one binary decision for every supplied candidate ID. Never discover or add candidates.

Question: Is THIS exact listed ingredient row actively used in THIS current instruction?

ACTIVE_TARGET means the current instruction directly acts on this listed row, explicitly names a clear exact alias/category for it, constructs a named group/component from it in this instruction, continues manipulation while directly targeting it, or explicitly uses a reserved/divided remainder. ACCEPT those cases.

PASSIVE_CONSTITUENT means the row merely remains inside a component, mixture, assembled food, pot, finished dish, or transformed component while the current instruction acts on that containing thing. REJECT it unless the current instruction separately names or acts on the row. A component label that contains the constituent's words (for example "spicy sour cream") still targets the component, not the original sour-cream row, unless the source separately targets the row.

An unnamed continuation such as cover, refrigerate, roast, simmer, serve, add the dressing, add the wrap, or act on "everything" does not automatically reactivate every constituent. But a named principal/category target such as "cook the chicken," "roast the vegetables," "add herbs," or "season with pepper" directly targets matching rows. Prior use alone never proves consumption.

Use the supplied source-derived states as evidence, not adjudicated truth. COMPONENT plus PASSIVE_COMPONENT_CARRY is strong rejection evidence. DIRECT_INGREDIENT or BOTH is strong acceptance evidence unless exact duplicate/group/process-material evidence contradicts it. At a component-establishing instruction, BOTH means the row is actively used to construct the component and should normally be accepted.

Quantity facts are row-local. A current partial quantity can validly differ from the listed total. Missing current quantity is not a conflict. Use QUANTITY_CONFLICT only when the supplied row-local facts themselves prove an impossible exact-row conflict; never borrow another row's quantity.

Reviewer provenance never determines the answer. evidenceText must cite decisive source language and explain the exact row-specific active-target or passive-carry decision. There is no UNCERTAIN option.`

async function loadAi() {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { '@': root } },
    plugins: [{
      name: 'v10c-server-only-marker', enforce: 'pre',
      resolveId(id) { return id === 'server-only' ? '\0v10c-server-only' : null },
      load(id) { return id === '\0v10c-server-only' ? 'export {}' : null },
    }],
  })
  try { return { ai: await server.ssrLoadModule('/lib/ai.ts'), close: () => server.close() } }
  catch (error) { await server.close(); throw error }
}

function buildPrompt(candidates, batchId) {
  return `V10C active-target ingredient arbiter. Batch ${batchId}.\n\nCANDIDATES\n${JSON.stringify(candidates.map(candidate => {
    const { routing: _routing, ...safe } = candidate
    return safe
  }), null, 2)}\n\nReturn exactly ${candidates.length} results using the supplied candidateIds.`
}

function emptyState(inputSha) {
  return {
    schemaVersion: 1, inputSha256: inputSha, results: {}, historicalResults: {}, batches: [], historicalBatches: [], recipe190Runs: [],
    transport: { logicalBatches: 0, gatewayCalls: 0, retries: 0, schemaFailures: 0, parseFailures: 0, localRequestRejections: 0, otherFailures: 0 },
    usage: [], usageSummary: { requests: 0, successfulRequests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 }, productionWrites: 0,
  }
}

function readState(inputSha) {
  if (!fs.existsSync(statePath)) return emptyState(inputSha)
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  if (state.schemaVersion !== 1 || state.inputSha256 !== inputSha) throw new Error('V10C input changed; refusing incompatible resume')
  return state
}

function saveState(state) {
  state.usageSummary = state.usage.reduce((summary, item) => ({
    requests: state.transport.gatewayCalls + state.transport.localRequestRejections,
    successfulRequests: summary.successfulRequests + 1,
    inputTokens: summary.inputTokens + (item.inputTokens || 0), outputTokens: summary.outputTokens + (item.outputTokens || 0), totalTokens: summary.totalTokens + (item.totalTokens || 0),
  }), { requests: state.transport.gatewayCalls + state.transport.localRequestRejections, successfulRequests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 })
  fs.writeFileSync(statePath, stableJson(state))
}

function classifyFailure(error) {
  const message = String(error?.message || error)
  if (/could not parse|parse the response|no object generated/i.test(message)) return 'parseFailures'
  if (/schema|candidateid|result count|duplicate|validation/i.test(message)) return 'schemaFailures'
  if (/invalid gateway provider options/i.test(message)) return 'localRequestRejections'
  return 'otherFailures'
}

async function callBatch(modules, state, batch, candidates, phase, retry = true) {
  let firstError = null
  for (let attempt = 1; attempt <= (retry ? 2 : 1); attempt += 1) {
    if (attempt > 1) state.transport.retries += 1
    globalThis.__v10cUsageContext = { phase, batchId: batch.batchId, attempt }
    try {
      const output = await modules.ai.generateAIObject({
        feature: phase === 'recipe-190' ? 'cooking-v10c-recipe-190' : phase === 'historical' ? 'cooking-v10c-historical' : 'cooking-v10c-active-target-arbiter',
        userId: 'cooking-v10c-audit-only', promptVersion: 'v10c-active-target-v1', temperature: 0, timeout: timeoutMs,
        system: systemPrompt, prompt: buildPrompt(candidates, batch.batchId), schema,
      })
      state.transport.gatewayCalls += 1
      return { status: 'SUCCESS', attempts: attempt, results: validateArbiterResults(batch.candidateIds, output), error: null }
    } catch (error) {
      const classification = classifyFailure(error)
      state.transport[classification] += 1
      if (classification !== 'localRequestRejections') state.transport.gatewayCalls += 1
      firstError ||= String(error?.message || error)
      saveState(state)
      if (attempt === (retry ? 2 : 1)) return { status: 'FAILED', attempts: attempt, results: [], error: attempt === 1 ? firstError : `first: ${firstError}; retry: ${String(error?.message || error)}` }
    }
  }
}

async function runBatches(modules, state, batches, byId, recordsKey, resultsKey, phase, limit) {
  let executed = 0
  for (const batch of batches) {
    const existing = state[recordsKey].find(item => item.batchId === batch.batchId)
    if (existing?.status === 'SUCCESS') continue
    if (executed >= limit) break
    const candidates = batch.candidateIds.map(id => byId.get(id))
    const outcome = await callBatch(modules, state, batch, candidates, phase, true)
    const record = { ...batch, status: outcome.status, attempts: outcome.attempts, error: outcome.error }
    const index = state[recordsKey].findIndex(item => item.batchId === batch.batchId)
    if (index >= 0) state[recordsKey][index] = record
    else state[recordsKey].push(record)
    for (const result of outcome.results) state[resultsKey][result.candidateId] = result
    saveState(state)
    executed += 1
    process.stdout.write(`${phase} ${batch.batchId} ${outcome.status} (${outcome.attempts})\n`)
  }
}

async function main() {
  if (!fs.existsSync(inputPath)) throw new Error(`V10C input missing: ${inputPath}`)
  const inputBytes = fs.readFileSync(inputPath)
  const input = JSON.parse(inputBytes)
  if (input.truthLabelsIncluded !== false || JSON.stringify(input).includes('adjudicatedTruth')) throw new Error('Truth leaked into V10C model input')
  const riskBatches = createRiskBatches(input.candidates, maxBatch)
  const historicalBatches = createRiskBatches(input.historicalCandidates, maxBatch).map(batch => ({ ...batch, batchId: `historical::${batch.batchId}` }))
  const allById = new Map(input.candidates.map(item => [item.candidateId, item]))
  const historicalById = new Map(input.historicalCandidates.map(item => [item.candidateId, item]))
  if (process.argv.includes('--measure')) {
    const prompts = [...riskBatches.map(batch => buildPrompt(batch.candidateIds.map(id => allById.get(id)), batch.batchId)), ...historicalBatches.map(batch => buildPrompt(batch.candidateIds.map(id => historicalById.get(id)), batch.batchId))]
    const sizes = prompts.map(value => Buffer.byteLength(value))
    process.stdout.write(stableJson({ riskCandidates: input.candidates.length, historicalCandidates: input.historicalCandidates.length, logicalBatches: sizes.length, promptBytes: { minimum: Math.min(...sizes), average: Math.round(sizes.reduce((sum, value) => sum + value, 0) / sizes.length), maximum: Math.max(...sizes) } }))
    return
  }
  loadEnv()
  const state = readState(sha256(inputBytes))
  const modules = await loadAi()
  const originalInfo = console.info
  console.info = (label, metadata, ...rest) => {
    if (label === '[ai-usage]') { state.usage.push({ ...globalThis.__v10cUsageContext, ...metadata, capturedAt: new Date().toISOString() }); saveState(state); return }
    originalInfo(label, metadata, ...rest)
  }
  try {
    const limitArgument = process.argv.find(value => value.startsWith('--limit-batches='))
    const limit = limitArgument ? Number(limitArgument.split('=')[1]) : Number.POSITIVE_INFINITY
    await runBatches(modules, state, riskBatches, allById, 'batches', 'results', 'primary', limit)
    const primaryComplete = riskBatches.every(batch => state.batches.find(item => item.batchId === batch.batchId)?.status === 'SUCCESS')
    if (primaryComplete) await runBatches(modules, state, historicalBatches, historicalById, 'historicalBatches', 'historicalResults', 'historical', limit)
    const historicalComplete = historicalBatches.every(batch => state.historicalBatches.find(item => item.batchId === batch.batchId)?.status === 'SUCCESS')
    const recipe190Candidates = input.candidates.filter(item => item.recipeId === '190')
    for (let runIndex = state.recipe190Runs.length; primaryComplete && historicalComplete && runIndex < recipe190Runs; runIndex += 1) {
      const batch = { batchId: `recipe-190-${runIndex + 1}`, candidateIds: recipe190Candidates.map(item => item.candidateId) }
      const outcome = await callBatch(modules, state, batch, recipe190Candidates, 'recipe-190', false)
      state.recipe190Runs.push({ runIndex, status: outcome.status, error: outcome.error })
      saveState(state)
      process.stdout.write(`recipe-190 ${runIndex + 1}/${recipe190Runs} ${outcome.status}\n`)
    }
    state.transport.logicalBatches = riskBatches.length + historicalBatches.length
    state.recipe190 = { requests: state.recipe190Runs.length, successes: state.recipe190Runs.filter(item => item.status === 'SUCCESS').length, failures: state.recipe190Runs.filter(item => item.status !== 'SUCCESS').length }
    saveState(state)
    process.stdout.write(`${statePath}\n`)
  } finally {
    console.info = originalInfo
    delete globalThis.__v10cUsageContext
    await modules.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
