import { createHash } from 'node:crypto'

export const AUTHORIZED_MANIFEST_PATH = 'docs/audits/recovered-recipes-mapping-v5-dryrun-2026-08-26.json'
export const AUTHORIZED_MANIFEST_SHA256 = '5d4ddaa10c788f9192ae74a5887859bc2847496706461b655752d86e62741170'
export const SEMANTIC_EVIDENCE_PATH = 'docs/audits/recovered-recipes-mapping-v5-semantic-review-final-2026-08-26.json'
export const SEMANTIC_EVIDENCE_SHA256 = 'd42dffce95bf6195c31d61af8c59347b128f14684c76544b8a547ec551cfb0a6'
export const FORBIDDEN_RECOVERED_V4_MANIFEST = 'docs/audits/recovered-recipes-mapping-v4-dryrun-2026-08-26.json'
export const MAX_WRITES = 41

export const UNRESOLVED_RECIPE_IDS = Object.freeze([
  'chipotle-tahini-bowls',
  'maple-roasted-candied-pecans',
  'mexican-street-corn',
  'rising-sun-mazcal',
  'smoothies',
  'spaghetti-carbonara',
  'speget-with-fake-meat-meatballs',
  'zesty-quinoa-salad',
])

export const EXPECTED_COUNTS = Object.freeze({
  rows: 41,
  READY: 41,
  REVIEW: 0,
  EXCLUDED: 0,
  ERROR: 0,
  EXISTING_MAP: 0,
  WAVE_1A: 28,
  WAVE_2: 6,
  WAVE_3: 7,
})

export const EXPECTED_AUDIT_VERSION = Object.freeze({
  gitSha: '52157d937b78a1cef41e95c0882285c1234150cd',
  behaviorFingerprint: '33b4cf11faa559c8c5f7e291d152f6675031984ff8897da92c5cab30f5a7374b',
  schemaVersion: 1,
  parserVersion: 'recipe-content-v1',
  deterministicEngineVersion: 'deterministic-v5',
  hybridEngineVersion: 'hybrid-v5',
  promptVersion: 'v2',
  model: 'openai/gpt-5.6-luna',
  temperature: 0,
})

export const APPROVED_ENGINES = Object.freeze(['deterministic-v5', 'hybrid-v5'])
const CLASSIFICATIONS = Object.freeze(['READY', 'REVIEW', 'EXCLUDED', 'ERROR', 'EXISTING_MAP'])
const WAVES = Object.freeze(['WAVE_1A', 'WAVE_2', 'WAVE_3'])
const SHA256_PATTERN = /^[0-9a-f]{64}$/

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function parseMode(args) {
  assert(args.length === 1 && (args[0] === '--dry-run' || args[0] === '--apply'),
    'Choose exactly one mode: --dry-run or --apply')
  return args[0].slice(2)
}

export function verifyAuthorizedManifestBytes(bytes, relativePath = AUTHORIZED_MANIFEST_PATH) {
  assert(relativePath === AUTHORIZED_MANIFEST_PATH, `Unauthorized manifest path: ${relativePath}`)
  const actual = sha256(bytes)
  assert(actual === AUTHORIZED_MANIFEST_SHA256,
    `MANIFEST HASH MISMATCH: expected ${AUTHORIZED_MANIFEST_SHA256}, received ${actual}`)
  return actual
}

export function verifySemanticEvidenceBytes(bytes, relativePath = SEMANTIC_EVIDENCE_PATH) {
  assert(relativePath === SEMANTIC_EVIDENCE_PATH, `Unauthorized semantic evidence path: ${relativePath}`)
  const actual = sha256(bytes)
  assert(actual === SEMANTIC_EVIDENCE_SHA256,
    `SEMANTIC EVIDENCE HASH MISMATCH: expected ${SEMANTIC_EVIDENCE_SHA256}, received ${actual}`)
  return actual
}

export function parseJson(bytes, label) {
  try {
    return JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes))
  } catch (error) {
    throw new Error(`${label} cannot parse: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function assertAuditVersion(value, label) {
  assert(isRecord(value), `${label}: auditVersion is missing`)
  for (const [key, expected] of Object.entries(EXPECTED_AUDIT_VERSION)) {
    assert(value[key] === expected, `${label}: audited configuration ${key} mismatch`)
  }
}

function assertCandidateShape(candidate, row) {
  assert(isRecord(candidate), `${row.recipeId}: candidateMap is missing`)
  assert(candidate.schemaVersion === 1, `${row.recipeId}: unsupported candidate schema`)
  assert(candidate.parserVersion === 'recipe-content-v1', `${row.recipeId}: unsupported candidate parser`)
  assert(APPROVED_ENGINES.includes(candidate.engineVersion), `${row.recipeId}: unsupported candidate engine`)
  assert(candidate.sourceHash === row.sourceHash, `${row.recipeId}: candidate sourceHash differs from row`)
  assert(Array.isArray(candidate.steps), `${row.recipeId}: candidate steps are missing`)
}

export function validateManifestStructure(rows) {
  assert(Array.isArray(rows), 'Authorized manifest root must be an array')
  assert(rows.length === EXPECTED_COUNTS.rows,
    `Manifest row count mismatch: expected ${EXPECTED_COUNTS.rows}, received ${rows.length}`)
  const counts = Object.fromEntries(CLASSIFICATIONS.map(value => [value, 0]))
  const waves = Object.fromEntries(WAVES.map(value => [value, 0]))
  const ids = new Set()
  let previousId = null
  for (const row of rows) {
    assert(isRecord(row) && typeof row.recipeId === 'string' && row.recipeId.length > 0,
      'Manifest contains a row without recipeId')
    assert(!ids.has(row.recipeId), `Duplicate recipeId in manifest: ${row.recipeId}`)
    if (previousId !== null) assert(previousId.localeCompare(row.recipeId) < 0, 'Manifest rows are not sorted by recipeId')
    previousId = row.recipeId
    ids.add(row.recipeId)
    assert(CLASSIFICATIONS.includes(row.classification), `${row.recipeId}: invalid classification`)
    assert(WAVES.includes(row.repairWave), `${row.recipeId}: invalid repairWave`)
    counts[row.classification] += 1
    waves[row.repairWave] += 1
    assertAuditVersion(row.auditVersion, row.recipeId)
    if (row.classification === 'READY') {
      assert(typeof row.sourceHash === 'string' && SHA256_PATTERN.test(row.sourceHash),
        `${row.recipeId}: READY sourceHash is invalid`)
      assert(row.precondition?.currentMapAbsent === true, `${row.recipeId}: map-absence precondition is not true`)
      assert(row.precondition?.contentSourceHash === row.sourceHash, `${row.recipeId}: content sourceHash differs`)
      assertCandidateShape(row.candidateMap, row)
      assert(row.semanticReview?.deterministicSafe === true, `${row.recipeId}: deterministic semantic gate is not safe`)
      assert(row.semanticReview?.aiAmbiguous === 0 && row.semanticReview?.aiIncorrect === 0,
        `${row.recipeId}: AI semantic gate failed`)
      assert(row.audit?.candidateValidation?.valid === true, `${row.recipeId}: candidate validation evidence failed`)
      assert(!['UNSAFE_MATERIAL_DIFFERENCE', 'ERROR'].includes(row.stability?.classification),
        `${row.recipeId}: unsafe stability evidence`)
    }
  }
  for (const classification of CLASSIFICATIONS) {
    assert(counts[classification] === EXPECTED_COUNTS[classification],
      `Manifest ${classification} count mismatch`)
  }
  for (const wave of WAVES) assert(waves[wave] === EXPECTED_COUNTS[wave], `Manifest ${wave} count mismatch`)
  assert(UNRESOLVED_RECIPE_IDS.every(id => !ids.has(id)), 'Unresolved Wave 4/5 recipe entered apply manifest')
  return { rows: rows.length, uniqueRecipeIds: ids.size, ...counts, repairWaves: waves }
}

export function loadAuthorizedManifest(bytes, relativePath = AUTHORIZED_MANIFEST_PATH) {
  const actualSha256 = verifyAuthorizedManifestBytes(bytes, relativePath)
  const rows = parseJson(bytes, 'Authorized manifest')
  const counts = validateManifestStructure(rows)
  return { rows, counts, actualSha256 }
}

function relationId(recipeId, step, relation) {
  if (relation.kind === 'ingredient') return `${recipeId}|step:${step.instructionIndex}|ingredient:${relation.ingredientIndex}`
  return `${recipeId}|step:${step.instructionIndex}|component:${relation.label}`
}

function candidateAiRelations(row) {
  return row.candidateMap.steps.flatMap(step => [
    ...step.ingredients.filter(reference => reference.provenance === 'ai')
      .map(reference => ({ kind: 'ingredient', instructionIndex: step.instructionIndex, ingredientIndex: reference.ingredientIndex })),
    ...(step.preparedComponents || []).map(component => ({
      kind: 'prepared-component', instructionIndex: step.instructionIndex, label: component.label,
    })),
  ])
}

export function loadValidationBaselines(bytes, readyRows, relativePath = SEMANTIC_EVIDENCE_PATH) {
  verifySemanticEvidenceBytes(bytes, relativePath)
  const evidence = parseJson(bytes, 'Semantic evidence')
  assertAuditVersion(evidence.auditVersion, 'semantic evidence')
  assert(evidence.executiveResult === 'READY FOR MAPPING APPLY', 'Semantic evidence does not authorize apply')
  assert(evidence.gates?.deterministic?.recipesReviewed === 41 &&
    evidence.gates.deterministic.falsePositiveMappings === 0 &&
    evidence.gates.deterministic.falsePositiveRecipes === 0,
  'Deterministic semantic evidence gate failed')
  assert(evidence.gates?.ai?.ambiguous === 0 && evidence.gates?.ai?.incorrect === 0,
    'AI semantic evidence gate failed')
  assert(Array.isArray(evidence.deterministicReviews) && evidence.deterministicReviews.length === 41,
    'Semantic evidence does not cover 41 deterministic recipes')

  const deterministicById = new Map(evidence.deterministicReviews.map(review => [review.recipeId, review]))
  const primaryAiById = new Map(readyRows.map(row => [row.recipeId, []]))
  for (const review of evidence.aiReviews || []) {
    if (review.run === 'primary') primaryAiById.get(review.recipeId)?.push(review)
  }
  const baselines = new Map()
  for (const row of readyRows) {
    const review = deterministicById.get(row.recipeId)
    assert(review?.classification === 'SAFE' && review.sourceHash === row.sourceHash,
      `${row.recipeId}: deterministic semantic evidence missing or unsafe`)
    assert(review.references.every(reference => reference.classification === 'SAFE_MAPPING') &&
      review.omissions.every(omission => omission.classification === 'SAFE_OMISSION'),
    `${row.recipeId}: deterministic relationship evidence is not fully safe`)

    const reviewedReferences = new Map(review.references.map(reference => [
      `${reference.instructionIndex}:${reference.ingredientIndex}`, reference.reference,
    ]))
    const candidateDeterministic = row.candidateMap.steps.flatMap(step => step.ingredients
      .filter(reference => reference.provenance === 'deterministic')
      .map(reference => [`${step.instructionIndex}:${reference.ingredientIndex}`, reference]))
    assert(candidateDeterministic.length === reviewedReferences.size,
      `${row.recipeId}: candidate deterministic reference count differs from semantic evidence`)
    for (const [key, reference] of candidateDeterministic) {
      assert(JSON.stringify(reference) === JSON.stringify(reviewedReferences.get(key)),
        `${row.recipeId}: deterministic lock differs from semantic evidence at ${key}`)
    }

    const primaryReviews = primaryAiById.get(row.recipeId) || []
    const approvedAiIds = new Set(primaryReviews.map(item => {
      assert(item.classification === 'CORRECT', `${row.recipeId}: primary AI relationship is not CORRECT`)
      return item.addition.additionId
    }))
    const candidateAiIds = new Set(candidateAiRelations(row).map(relation => relationId(row.recipeId, relation, relation)))
    assert(candidateAiIds.size === approvedAiIds.size && [...candidateAiIds].every(id => approvedAiIds.has(id)),
      `${row.recipeId}: candidate AI relationships differ from reviewed primary output`)

    const omissions = new Map(review.omissions.map(item => [item.instructionIndex, item.unresolvedReason || undefined]))
    const deterministicStepsFromAi = new Map(primaryReviews.map(item => [item.instructionIndex, item.deterministicStep]))
    const steps = row.candidateMap.steps.map(step => {
      const reviewedStep = deterministicStepsFromAi.get(step.instructionIndex)
      const ingredients = step.ingredients.filter(reference => reference.provenance === 'deterministic')
      const unresolvedReason = reviewedStep?.unresolvedReason ?? omissions.get(step.instructionIndex) ?? step.unresolvedReason
      return {
        instructionIndex: step.instructionIndex,
        ingredients,
        ...(unresolvedReason ? { unresolvedReason } : {}),
      }
    })
    baselines.set(row.recipeId, {
      schemaVersion: 1,
      parserVersion: 'recipe-content-v1',
      engineVersion: 'deterministic-v5',
      steps,
      sourceHash: row.sourceHash,
    })
  }
  assert(baselines.size === 41, 'Validation baselines do not cover all READY rows')
  return baselines
}

export function hasMap(data) {
  return data?.cookingStepIngredientMap !== undefined && data?.cookingStepIngredientMap !== null
}

export function canonicalizeRawFirestoreValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { $number: 'NaN' }
    if (value === Infinity) return { $number: 'Infinity' }
    if (value === -Infinity) return { $number: '-Infinity' }
    if (Object.is(value, -0)) return { $number: '-0' }
    return value
  }
  if (typeof value === 'bigint') return { $bigint: value.toString() }
  if (value instanceof Date) return { $date: value.toISOString() }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { $bytes: Buffer.from(value).toString('base64') }
  if (Array.isArray(value)) return value.map(canonicalizeRawFirestoreValue)
  if (isRecord(value)) {
    if (typeof value.toDate === 'function' && Number.isInteger(value.seconds) && Number.isInteger(value.nanoseconds)) {
      return { $timestamp: [value.seconds, value.nanoseconds] }
    }
    if (typeof value.latitude === 'number' && typeof value.longitude === 'number') {
      return { $geopoint: [value.latitude, value.longitude] }
    }
    if (typeof value.path === 'string' && value.firestore) return { $reference: value.path }
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalizeRawFirestoreValue(value[key])]))
  }
  throw new Error(`Unsupported Firestore value: ${Object.prototype.toString.call(value)}`)
}

export function canonicalSerialize(value) {
  return JSON.stringify(canonicalizeRawFirestoreValue(value))
}

export function deepCanonicalEqual(left, right) {
  return canonicalSerialize(left) === canonicalSerialize(right)
}

export function documentHash(data, { excludeMap = false } = {}) {
  const source = isRecord(data) ? { ...data } : data
  if (excludeMap && isRecord(source)) delete source.cookingStepIngredientMap
  return sha256(canonicalSerialize(source))
}

export async function evaluateReadyRow({ row, live, baseline, parseRecipeContent, computeSourceHash, validateCandidate }) {
  if (!live?.exists) return { status: 'SKIP', reason: 'RECIPE_MISSING' }
  if (hasMap(live.data)) return { status: 'SKIP', reason: 'MAP_ALREADY_PRESENT' }
  if (!APPROVED_ENGINES.includes(row.candidateMap?.engineVersion) || row.candidateMap?.schemaVersion !== 1 ||
      row.candidateMap?.parserVersion !== 'recipe-content-v1') return { status: 'SKIP', reason: 'VERSION_MISMATCH' }
  assert(baseline, `${row.recipeId}: validation baseline unavailable`)
  const parsed = parseRecipeContent(typeof live.data?.content === 'string' ? live.data.content : '')
  const liveSourceHash = await computeSourceHash(parsed.ingredients, parsed.instructions)
  if (liveSourceHash !== row.sourceHash) return { status: 'SKIP', reason: 'SOURCE_HASH_MISMATCH', liveSourceHash }
  const validation = validateCandidate(row.candidateMap, parsed.ingredients, parsed.instructions, baseline)
  if (!validation?.valid) return { status: 'SKIP', reason: 'CANDIDATE_INVALID', validationReason: validation?.reason || 'unknown' }
  return {
    status: 'READY_TO_WRITE',
    liveSourceHash,
    nonMapHash: documentHash(live.data, { excludeMap: true }),
    updateTime: live.updateTime,
  }
}

export async function buildApplyPlan({ readyRows, liveById, baselines, ...operations }) {
  const readyToWrite = []
  const skipped = []
  const unexpectedErrors = []
  for (const row of readyRows) {
    try {
      const result = await evaluateReadyRow({
        row, live: liveById.get(row.recipeId), baseline: baselines.get(row.recipeId), ...operations,
      })
      if (result.status === 'READY_TO_WRITE') readyToWrite.push({ row, ...result })
      else skipped.push({ recipeId: row.recipeId, title: row.title, ...result })
    } catch (error) {
      unexpectedErrors.push({ recipeId: row.recipeId, message: error instanceof Error ? error.message : String(error) })
    }
  }
  return { readyToWrite, skipped, unexpectedErrors }
}

export function writePayload(candidateMap) {
  return { cookingStepIngredientMap: candidateMap }
}

export async function commitApplyPlan(db, plan) {
  assert(plan.unexpectedErrors.length === 0, 'Unexpected preflight errors prevent batch commit')
  assert(plan.readyToWrite.length <= MAX_WRITES, `Planned writes exceed ${MAX_WRITES}`)
  if (plan.readyToWrite.length === 0) return { batchCount: 0, attemptedWrites: 0, committedWrites: 0 }
  const batch = db.batch()
  for (const item of plan.readyToWrite) {
    const payload = writePayload(item.row.candidateMap)
    assert(Object.keys(payload).length === 1 && Object.hasOwn(payload, 'cookingStepIngredientMap'),
      'Write payload contains an unauthorized field')
    assert(item.updateTime, `${item.row.recipeId}: missing update-time precondition`)
    batch.update(db.collection('recipes').doc(item.row.recipeId), payload, { lastUpdateTime: item.updateTime })
  }
  await batch.commit()
  return { batchCount: 1, attemptedWrites: plan.readyToWrite.length, committedWrites: plan.readyToWrite.length }
}

export async function verifyReadback({ readyRows, plan, liveById, baselines, parseRecipeContent, computeSourceHash, validateCandidate }) {
  const intended = new Map(plan.readyToWrite.map(item => [item.row.recipeId, item]))
  const rows = []
  let exactCandidateMatches = 0
  let sourceHashMatches = 0
  let candidateValidationPasses = 0
  let rawNonMapMismatches = 0
  let unexpectedStates = 0
  for (const row of readyRows) {
    const item = intended.get(row.recipeId)
    if (!item) continue
    const live = liveById.get(row.recipeId)
    const checks = {
      exists: Boolean(live?.exists),
      exactCandidate: Boolean(live?.exists && deepCanonicalEqual(live.data?.cookingStepIngredientMap, row.candidateMap)),
      sourceHash: false,
      candidateValid: false,
      rawNonMapUnchanged: Boolean(live?.exists && documentHash(live.data, { excludeMap: true }) === item.nonMapHash),
    }
    if (checks.exists) {
      const parsed = parseRecipeContent(typeof live.data?.content === 'string' ? live.data.content : '')
      checks.sourceHash = await computeSourceHash(parsed.ingredients, parsed.instructions) === row.sourceHash
      checks.candidateValid = Boolean(validateCandidate(
        live.data.cookingStepIngredientMap, parsed.ingredients, parsed.instructions, baselines.get(row.recipeId),
      )?.valid)
    }
    if (checks.exactCandidate) exactCandidateMatches += 1
    if (checks.sourceHash) sourceHashMatches += 1
    if (checks.candidateValid) candidateValidationPasses += 1
    if (!checks.rawNonMapUnchanged) rawNonMapMismatches += 1
    if (!Object.values(checks).every(Boolean)) unexpectedStates += 1
    rows.push({ recipeId: row.recipeId, checks })
  }
  return {
    rows,
    writtenRowsReread: plan.readyToWrite.length,
    exactCandidateMatches,
    sourceHashMatches,
    candidateValidationPasses,
    rawNonMapMismatches,
    unexpectedStates,
  }
}

export function snapshotProtectedDocuments(liveById, recipeIds) {
  return new Map(recipeIds.map(recipeId => {
    const live = liveById.get(recipeId)
    assert(live?.exists, `${recipeId}: protected recipe missing`)
    return [recipeId, {
      documentHash: documentHash(live.data),
      mapHash: hasMap(live.data) ? sha256(canonicalSerialize(live.data.cookingStepIngredientMap)) : null,
    }]
  }))
}

export function verifyProtectedDocumentsUnchanged(before, afterById) {
  const mutations = []
  for (const [recipeId, snapshot] of before) {
    const live = afterById.get(recipeId)
    const afterDocumentHash = live?.exists ? documentHash(live.data) : null
    const afterMapHash = live?.exists && hasMap(live.data)
      ? sha256(canonicalSerialize(live.data.cookingStepIngredientMap)) : null
    if (afterDocumentHash !== snapshot.documentHash || afterMapHash !== snapshot.mapHash) {
      mutations.push({ recipeId, before: snapshot, after: { documentHash: afterDocumentHash, mapHash: afterMapHash } })
    }
  }
  return { rows: before.size, changed: mutations.length, mutations }
}
