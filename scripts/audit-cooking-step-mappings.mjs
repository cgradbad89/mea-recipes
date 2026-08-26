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
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import {
  callWithOneTransientRetry,
  auditPrecondition,
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
} from './audit-cooking-step-mappings-core.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { loadEnv, getAdmin } = require('./_lib.js')
const LIMITS = { maxContentLength: 64_000, maxIngredients: 200, maxInstructions: 150, maxLineLength: 4_000 }
const CONCURRENCY = 3
const args = new Set(process.argv.slice(2))
const mode = args.has('--hybrid') ? 'hybrid' : args.has('--deterministic-only') ? 'deterministic-only' : null
const option = name => {
  const index = process.argv.indexOf(name)
  return index === -1 ? null : process.argv[index + 1]
}

if (!mode || (args.has('--hybrid') && args.has('--deterministic-only'))) {
  throw new Error('Choose exactly one mode: --deterministic-only or --hybrid')
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
      mappingAi: mode === 'hybrid' ? await server.ssrLoadModule('/lib/cookingStepMappingAi.ts') : null,
      route: await server.ssrLoadModule('/app/api/cooking-step-map/route.ts'),
      close: () => server.close(),
    }
  } catch (error) {
    await server.close()
    throw error
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
        finalMappedIngredientReferences: 0, finalMappedSteps: 0, remainingUnresolvedSteps: 0,
      },
      candidateMap: null,
      candidateValidation: null,
      aiAdditions: [],
      aiError: null,
      stability: null,
      currentMapPresent,
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
      finalMappedSteps: stats.mappedSteps,
      remainingUnresolvedSteps: stats.aiEligibleSteps,
    })
    rows.push(row)
  }
  return rows
}

async function executeHybrid(rows, modules, usage) {
  const targets = rows.filter(isAuditAiEligible)
  await mapConcurrent(targets, CONCURRENCY, async row => {
    const call = () => modules.mappingAi.resolveCookingStepMappingsWithAi(
      row.deterministicMap, row.parsed.ingredients, row.parsed.instructions, 'cooking-step-mapping-production-audit',
    )
    const result = await callWithOneTransientRetry(call)
    row.hybridStats.aiAttempted = true
    row.hybridStats.aiStatus = result.status
    row.hybridStats.aiAttempts = result.attempts
    usage.primaryRequests += result.attempts
    if (result.status === 'failed') { row.aiError = result.error; return }
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
      finalMappedSteps: stats.mappedSteps,
      remainingUnresolvedSteps: stats.aiEligibleSteps,
    })
  })

  const stabilityTargets = selectStabilitySubset(rows, 20)
  await mapConcurrent(stabilityTargets, CONCURRENCY, async row => {
    const result = await callWithOneTransientRetry(() => modules.mappingAi.resolveCookingStepMappingsWithAi(
      row.deterministicMap, row.parsed.ingredients, row.parsed.instructions, 'cooking-step-mapping-production-audit-stability',
    ))
    usage.stabilityRequests += result.attempts
    if (result.status === 'failed') {
      row.stability = { status: 'ERROR', attempts: result.attempts, error: result.error }
      return
    }
    const repeatMap = modules.mappingAi.mergeValidatedAiCookingMappings(
      row.deterministicMap, row.parsed.ingredients, row.parsed.instructions, result.value,
    )
    const validation = modules.mapping.validateCookingStepIngredientMap(
      repeatMap, row.parsed.ingredients, row.parsed.instructions, row.deterministicMap,
    )
    row.stability = validation.valid
      ? { status: compareStability(row.candidateMap, repeatMap), attempts: result.attempts, repeatMap }
      : { status: 'ERROR', attempts: result.attempts, error: `Repeat candidate validation failed: ${validation.reason}` }
  })
}

function reviewPaths(date) {
  return {
    manifest: path.join(ROOT, `docs/audits/cooking-step-mapping-dryrun-${date}.json`),
    report: path.join(ROOT, `docs/audits/cooking-step-mapping-dryrun-${date}.md`),
    reviews: path.join(ROOT, `docs/audits/cooking-step-mapping-semantic-review-${date}.json`),
    raw: path.join('/tmp', `cooking-step-mapping-run-${date}.json`),
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

function makeReviewTemplate(rows, date) {
  return {
    auditDate: date,
    instructions: 'Classify every AI addition CORRECT, AMBIGUOUS, or INCORRECT. Review every deterministic sample candidate for obvious false positives.',
    aiAdditions: rows.flatMap(row => row.aiAdditions.map(addition => ({
      additionId: addition.additionId, recipeId: row.recipeId, title: row.title,
      classification: 'PENDING', failureClass: null, explanation: null,
      sourceIngredients: row.parsed.ingredients,
      instructionIndex: addition.instructionIndex, instruction: addition.instruction,
      addition,
    }))),
    deterministicSample: selectDeterministicSample(rows, 40).map(row => ({
      recipeId: row.recipeId, title: row.title, classification: 'PENDING', explanation: null,
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

function finalizeRows(rows, reviews) {
  const aiReviews = new Map(reviews.aiAdditions.map(item => [item.additionId, item]))
  const deterministicReviews = new Map(reviews.deterministicSample.map(item => [item.recipeId, item]))
  return rows.map(row => {
    const semantic = { aiAdditionsCorrect: 0, aiAdditionsAmbiguous: 0, aiAdditionsIncorrect: 0 }
    const rowReviews = row.aiAdditions.map(item => aiReviews.get(item.additionId)).filter(Boolean)
    for (const review of rowReviews) {
      if (review.classification === 'CORRECT') semantic.aiAdditionsCorrect += 1
      if (review.classification === 'AMBIGUOUS') semantic.aiAdditionsAmbiguous += 1
      if (review.classification === 'INCORRECT') semantic.aiAdditionsIncorrect += 1
    }
    let classification = 'READY'
    let reason = null
    if (row.sourceStatus.startsWith('EXCLUDE_')) { classification = 'EXCLUDED'; reason = row.sourceReason }
    else if (row.sourceStatus === 'ERROR') { classification = 'ERROR'; reason = row.sourceReason }
    else if (row.currentMapPresent) { classification = 'EXCLUDED'; reason = 'A persisted map already exists; future backfill must not replace it.' }
    else if (row.hybridStats.aiStatus === 'failed') { classification = 'ERROR'; reason = `AI evaluation failed: ${row.aiError}` }
    else if (!row.candidateValidation?.valid) { classification = 'ERROR'; reason = `Candidate failed production validation: ${row.candidateValidation?.reason || 'unknown'}` }
    else if (row.aiAdditions.some(item => !aiReviews.has(item.additionId) || aiReviews.get(item.additionId).classification === 'PENDING')) {
      classification = 'REVIEW'; reason = 'AI additions await semantic review.'
    } else if (semantic.aiAdditionsIncorrect > 0) { classification = 'EXCLUDED'; reason = 'At least one AI addition is semantically incorrect.' }
    else if (semantic.aiAdditionsAmbiguous > 0) { classification = 'REVIEW'; reason = 'At least one AI addition is semantically ambiguous.' }
    else if (row.stability?.status === 'MATERIAL_DIFFERENCE' || row.stability?.status === 'ERROR') {
      classification = 'REVIEW'; reason = `Stability check result: ${row.stability.status}.`
    } else if (deterministicReviews.get(row.recipeId)?.classification === 'FALSE_POSITIVE') {
      classification = 'EXCLUDED'; reason = 'Deterministic semantic sample found an obvious false positive.'
    }
    return {
      recipeId: row.recipeId,
      title: row.title,
      classification,
      reason,
      sourceHash: row.sourceHash,
      candidateMap: ['READY', 'REVIEW'].includes(classification) ? row.candidateMap : null,
      deterministicStats: row.deterministicStats,
      hybridStats: row.hybridStats,
      semanticReview: semantic,
      precondition: auditPrecondition(row),
      audit: {
        sourceStatus: row.sourceStatus,
        parserEvidence: row.parserEvidence,
        candidateValidation: row.candidateValidation,
        currentMapValidation: row.currentMapValidation,
        stability: row.stability ? { status: row.stability.status, attempts: row.stability.attempts, error: row.stability.error || null } : null,
      },
    }
  }).sort((a, b) => a.recipeId.localeCompare(b.recipeId))
}

function renderReport(date, raw, manifest, reviews, manifestIntegrity) {
  const ready = count(manifest, row => row.classification === 'READY')
  const review = count(manifest, row => row.classification === 'REVIEW')
  const excluded = count(manifest, row => row.classification === 'EXCLUDED')
  const errors = count(manifest, row => row.classification === 'ERROR')
  const pendingReviews = reviews.aiAdditions.filter(item => item.classification === 'PENDING').length
  const verdict = reviews.executiveVerdict || (pendingReviews > 0 || errors > 0 ? 'NOT READY FOR BACKFILL'
    : review > 0 || excluded > 0 ? 'READY FOR RESTRICTED BACKFILL' : 'READY FOR BACKFILL APPLY'
  )
  const eligible = raw.rows.filter(row => row.sourceStatus === 'ELIGIBLE')
  const excludedRows = manifest.filter(row => ['EXCLUDED', 'ERROR'].includes(row.classification))
  const aiCorrect = sum(manifest, row => row.semanticReview.aiAdditionsCorrect)
  const aiAmbiguous = sum(manifest, row => row.semanticReview.aiAdditionsAmbiguous)
  const aiIncorrect = sum(manifest, row => row.semanticReview.aiAdditionsIncorrect)
  const stabilityRows = raw.rows.filter(row => row.stability)
  const det = reviews.deterministicSample
  const usageMetadata = raw.usage.metadata || []
  const usageTotals = usageMetadata.reduce((totals, item) => ({
    inputTokens: totals.inputTokens + (item.inputTokens || 0),
    outputTokens: totals.outputTokens + (item.outputTokens || 0),
    totalTokens: totals.totalTokens + (item.totalTokens || 0),
  }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 })
  const lines = [
    `# Cooking-step mapping production dry run — ${date}`, '',
    '## Executive verdict', '', verdict, '',
    `The proposed manifest is an immutable, read-only allowlist. No Firestore document was written. ${pendingReviews ? `${pendingReviews} AI additions still await semantic review.` : 'Every accepted AI addition was manually reviewed.'}`, '',
    reviews.verdictReason || '', '',
    '## Corpus summary', '',
    '| Metric | Count |', '|---|---:|',
    `| Total shared documents | ${raw.rows.length} |`,
    `| Existing persisted maps | ${count(raw.rows, row => row.currentMapPresent)} |`,
    `| Eligible | ${eligible.length} |`,
    `| Parser/content excluded | ${raw.rows.length - eligible.length} |`,
    `| Parser-defective | ${count(raw.rows, row => row.sourceStatus === 'EXCLUDE_PARSER_DEFECT')} |`,
    `| Empty parsed ingredient arrays | ${count(raw.rows, row => row.parsed.ingredients.length === 0)} |`,
    `| Empty parsed instruction arrays | ${count(raw.rows, row => row.parsed.instructions.length === 0)} |`,
    `| No-instruction exclusions after no-ingredient precedence | ${count(raw.rows, row => row.sourceStatus === 'EXCLUDE_NO_INSTRUCTIONS')} |`,
    `| Other invalid content | ${count(raw.rows, row => row.sourceStatus === 'EXCLUDE_INVALID_CONTENT')} |`,
    `| Deterministic-only | ${count(eligible, row => row.hybridStats.aiStatus === 'not_needed')} |`,
    `| AI attempted (actual primary recipes) | ${count(raw.rows, row => row.hybridStats.aiAttempted)} |`,
    `| AI-attempted rows still eligible after final source review | ${count(eligible, row => row.hybridStats.aiAttempted)} |`,
    `| AI failed | ${count(eligible, row => row.hybridStats.aiStatus === 'failed')} |`,
    `| READY | ${ready} |`, `| REVIEW | ${review} |`, `| EXCLUDED | ${excluded} |`, `| ERROR | ${errors} |`, '',
    '## Mapping improvement', '',
    '| Metric | Deterministic | Hybrid |', '|---|---:|---:|',
    `| Mapped steps | ${sum(eligible, row => row.deterministicStats?.mappedSteps || 0)} | ${sum(eligible, row => row.hybridStats.finalMappedSteps)} |`,
    `| Mapped ingredient references | ${sum(eligible, row => row.deterministicStats?.mappedIngredientReferences || 0)} | ${sum(eligible, row => row.hybridStats.finalMappedIngredientReferences)} |`,
    `| AI-eligible unresolved steps | ${sum(eligible, row => row.deterministicStats?.aiEligibleSteps || 0)} | ${sum(eligible, row => row.hybridStats.remainingUnresolvedSteps)} |`,
    `| Prepared components | 0 | ${sum(eligible, row => row.hybridStats.addedPreparedComponents)} |`, '',
    '> More mappings is not automatically better; semantic safety controls eligibility.', '',
    '## AI semantic accuracy', '',
    `Reviewed additions: **${aiCorrect + aiAmbiguous + aiIncorrect}** — correct **${aiCorrect}**, ambiguous **${aiAmbiguous}**, incorrect **${aiIncorrect}**.`, '',
    'Six recipes sent during the bounded live pass were subsequently proven source/parser-defective during semantic inspection. They remain excluded, and the finalized eligibility gate blocks them before AI; the actual 74 primary calls are still reported rather than rewritten as 68.', '',
    '## AI stability', '',
    `Subset: **${stabilityRows.length}** recipes — exact stable **${count(stabilityRows, row => row.stability.status === 'EXACT_STABLE')}**, semantically stable **${count(stabilityRows, row => row.stability.status === 'SEMANTICALLY_STABLE')}**, material differences **${count(stabilityRows, row => row.stability.status === 'MATERIAL_DIFFERENCE')}**, errors **${count(stabilityRows, row => row.stability.status === 'ERROR')}**.`, '',
    '## Deterministic semantic spot check', '',
    `Reviewed **${det.filter(item => item.classification !== 'PENDING').length}** of ${det.length} selected recipes. Confirmed obvious false positives: **${det.filter(item => item.classification === 'FALSE_POSITIVE').length}**. Conservative unresolved mappings were not counted as failures.`, '',
    '## Failure taxonomy', '',
    ...reviews.aiAdditions.filter(item => ['AMBIGUOUS', 'INCORRECT'].includes(item.classification)).map(item =>
      `- **${item.title}** — ${item.failureClass || 'other'}: ${item.explanation || 'No explanation recorded.'}`),
    ...(aiAmbiguous + aiIncorrect === 0 ? ['- No ambiguous or incorrect accepted AI additions were found.'] : []), '',
    ...det.filter(item => item.classification === 'FALSE_POSITIVE').map(item =>
      `- **${item.title}** — deterministic-engine false positive: ${item.explanation}`), '',
    '## Parser/content exclusions and errors', '',
    ...excludedRows.map(row => `- **${row.title}** (\`${row.recipeId}\`): ${row.reason}`), '',
    '## Proposed backfill scope', '',
    `READY ${ready}; REVIEW ${review}; EXCLUDED ${excluded}; ERROR ${errors}. This report does not authorize or perform mutation.`, '',
    '## Future apply preconditions', '',
    'For each READY row: the live recipe must still exist, the map field must still be absent, a fresh live source hash must equal the manifest hash, and the candidate must validate against the live shared content. Any failed precondition skips that row. A later writer must perform a `cookingStepIngredientMap`-only merge and must not rewrite recipe content or any other field.', '',
    '## Manifest integrity', '',
    `Path: \`${path.relative(ROOT, manifestIntegrity.path)}\`; SHA-256: \`${manifestIntegrity.sha256}\`; rows: **${manifest.length}**; READY rows: **${ready}**. Every READY candidate passed a fresh production-source validation.`, '',
    '## Production and AI execution', '',
    `Firestore operations: read-only shared \`recipes\` collection queries; writes: **none**. AI requests: ${raw.usage.primaryRequests} primary/retry requests plus ${raw.usage.stabilityRequests} stability/retry requests. The existing helper emitted ${usageMetadata.length} authoritative usage records totaling ${usageTotals.inputTokens} input, ${usageTotals.outputTokens} output, and ${usageTotals.totalTokens} tokens for ${usageMetadata[0]?.provider || 'the configured provider'} / ${usageMetadata[0]?.model || 'the configured model'}. No dollar estimate is inferred.`, '',
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
      const documents = await readSharedRecipes()
      const rows = await buildBaseline(documents, modules)
      if (mode === 'hybrid') await executeHybrid(rows, modules, usage)
      raw = { auditDate: date, mode, limits: LIMITS, usage, rows }
    } finally {
      console.info = originalInfo
      await modules.close()
    }
    fs.writeFileSync(mode === 'hybrid' ? paths.raw : path.join('/tmp', `cooking-step-mapping-deterministic-${date}.json`), stableJson(raw))
  }

  if (mode === 'deterministic-only') {
    if (raw.usage.primaryRequests !== 0 || raw.usage.stabilityRequests !== 0) throw new Error('Deterministic mode attempted AI')
    console.log(JSON.stringify({ mode, rows: raw.rows.length, eligible: count(raw.rows, row => row.sourceStatus === 'ELIGIBLE'), aiRequests: 0 }, null, 2))
    return
  }

  const template = makeReviewTemplate(raw.rows, date)
  const reviews = loadReviews(paths.reviews, template)
  const manifest = finalizeRows(raw.rows, reviews)
  fs.writeFileSync(paths.manifest, stableJson(manifest))
  const manifestBytes = fs.readFileSync(paths.manifest)
  const manifestSha256 = sha256(manifestBytes)
  fs.writeFileSync(paths.report, renderReport(date, raw, manifest, reviews, {
    path: paths.manifest, sha256: manifestSha256,
  }))
  console.log(JSON.stringify({
    mode, rawArtifact: paths.raw, reviewFile: paths.reviews,
    manifest: paths.manifest, report: paths.report,
    manifestSha256, rows: manifest.length,
    ready: count(manifest, row => row.classification === 'READY'),
    pendingAiReviews: count(reviews.aiAdditions, item => item.classification === 'PENDING'),
    pendingDeterministicReviews: count(reviews.deterministicSample, item => item.classification === 'PENDING'),
  }, null, 2))
}

main().catch(error => { console.error(error); process.exitCode = 1 })
