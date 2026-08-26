import { createHash } from 'node:crypto'

export const AUTHORIZED_MANIFEST_PATH = 'docs/audits/cooking-step-mapping-dryrun-v4-2026-08-26.json'
export const AUTHORIZED_MANIFEST_SHA256 = 'b07208384369183e70782f2e017fcea141d9436d43d7ea523133c72cd6435a88'
export const VALIDATION_EVIDENCE_PATH = 'docs/audits/cooking-step-mapping-semantic-review-v4-2026-08-26.json'
export const VALIDATION_EVIDENCE_SHA256 = '2ccd255d9606960e9ac32fcc4ffa49937bbd3e2ffaf3ea2a95bbb620b31f60ae'
export const MAX_BATCH_WRITES = 450

export const EXPECTED_COUNTS = Object.freeze({
  rows: 236,
  READY: 187,
  REVIEW: 0,
  EXCLUDED: 49,
  ERROR: 0,
  EXISTING_MAP: 0,
})

export const EXPECTED_AUDIT_VERSION = Object.freeze({
  gitSha: 'abd3e82e8d64ca4dd5dde6ca754f5d4260411525',
  schemaVersion: 1,
  parserVersion: 'recipe-content-v1',
  deterministicEngineVersion: 'deterministic-v4',
  hybridEngineVersion: 'hybrid-v4',
  promptVersion: 'v2',
  model: 'openai/gpt-5.6-luna',
  temperature: 0,
  behaviorFingerprint: 'd0580cf952d58595b4eb8dc0c81212900357e928817f07a18fddff72d4d02ced',
})

export const CLASSIFICATIONS = Object.freeze(['READY', 'REVIEW', 'EXCLUDED', 'ERROR', 'EXISTING_MAP'])
export const APPROVED_ENGINES = Object.freeze(['deterministic-v4', 'hybrid-v4'])
const UNRESOLVED_REASONS = new Set([
  'ambiguous', 'implicit-reference', 'prepared-component', 'no-ingredient-use', 'non-actionable',
])
const SHA256_PATTERN = /^[0-9a-f]{64}$/

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

export function parseMode(args) {
  assert(args.length === 1 && (args[0] === '--dry-run' || args[0] === '--apply'),
    'Choose exactly one mode: --dry-run or --apply')
  return args[0].slice(2)
}

export function verifyAuthorizedManifestBytes(bytes, relativePath = AUTHORIZED_MANIFEST_PATH) {
  assert(relativePath === AUTHORIZED_MANIFEST_PATH,
    `Unauthorized manifest path: ${relativePath}`)
  const actual = sha256(bytes)
  assert(actual === AUTHORIZED_MANIFEST_SHA256,
    `MANIFEST HASH MISMATCH: expected ${AUTHORIZED_MANIFEST_SHA256}, received ${actual}`)
  return actual
}

export function verifyValidationEvidenceBytes(bytes, relativePath = VALIDATION_EVIDENCE_PATH) {
  assert(relativePath === VALIDATION_EVIDENCE_PATH,
    `Unauthorized validation evidence path: ${relativePath}`)
  const actual = sha256(bytes)
  assert(actual === VALIDATION_EVIDENCE_SHA256,
    `VALIDATION EVIDENCE HASH MISMATCH: expected ${VALIDATION_EVIDENCE_SHA256}, received ${actual}`)
  return actual
}

export function parseJson(bytes, label) {
  try {
    return JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes))
  } catch (error) {
    throw new Error(`${label} cannot parse: ${error instanceof Error ? error.message : String(error)}`)
  }
}
function assertAuditVersion(value, recipeId) {
  assert(isRecord(value), `${recipeId}: auditVersion is missing`)
  for (const [key, expected] of Object.entries(EXPECTED_AUDIT_VERSION)) {
    assert(value[key] === expected,
      `${recipeId}: audited configuration ${key} mismatch`)
  }
}

function assertCandidateShape(candidate, row) {
  const prefix = `${row.recipeId}: candidateMap`
  assert(isRecord(candidate), `${prefix} is missing or structurally corrupted`)
  assert(candidate.schemaVersion === 1, `${prefix} schemaVersion is not 1`)
  assert(candidate.parserVersion === 'recipe-content-v1', `${prefix} parserVersion is not recipe-content-v1`)
  assert(APPROVED_ENGINES.includes(candidate.engineVersion), `${prefix} engineVersion is not approved v4`)
  assert(candidate.sourceHash === row.sourceHash, `${prefix} sourceHash differs from the row`)
  assert(Array.isArray(candidate.steps), `${prefix}.steps is not an array`)

  candidate.steps.forEach((step, instructionIndex) => {
    assert(isRecord(step), `${prefix}.steps[${instructionIndex}] is not an object`)
    assert(step.instructionIndex === instructionIndex,
      `${prefix}.steps[${instructionIndex}] has a noncanonical instructionIndex`)
    assert(Array.isArray(step.ingredients), `${prefix}.steps[${instructionIndex}].ingredients is not an array`)
    const indexes = new Set()
    for (const reference of step.ingredients) {
      assert(isRecord(reference), `${prefix} has a malformed ingredient reference`)
      assert(Number.isInteger(reference.ingredientIndex) && reference.ingredientIndex >= 0,
        `${prefix} has an invalid ingredientIndex`)
      assert(!indexes.has(reference.ingredientIndex), `${prefix} has a duplicate ingredientIndex in one step`)
      indexes.add(reference.ingredientIndex)
      assert(reference.confidence === 'high', `${prefix} has non-high confidence`)
      assert(reference.provenance === 'deterministic' || reference.provenance === 'ai',
        `${prefix} has unsupported provenance`)
      if (reference.usage !== undefined) {
        assert(isRecord(reference.usage), `${prefix} has malformed usage`)
        assert(['all', 'partial', 'remaining'].includes(reference.usage.kind), `${prefix} has unsupported usage kind`)
        if (reference.usage.quantityText !== undefined) {
          assert(typeof reference.usage.quantityText === 'string' && reference.usage.quantityText.trim().length > 0,
            `${prefix} has malformed usage quantityText`)
        }
      }
    }
    if (step.preparedComponents !== undefined) {
      assert(Array.isArray(step.preparedComponents), `${prefix} has malformed preparedComponents`)
      for (const component of step.preparedComponents) {
        assert(isRecord(component) && typeof component.label === 'string' && component.label.trim().length > 0,
          `${prefix} has a malformed prepared component`)
        assert(component.confidence === 'high' && component.provenance === 'ai',
          `${prefix} has an unsupported prepared component`)
      }
    }
    if (step.unresolvedReason !== undefined) {
      assert(UNRESOLVED_REASONS.has(step.unresolvedReason), `${prefix} has an unsupported unresolvedReason`)
    }
  })
}

export function validateManifestStructure(rows) {
  assert(Array.isArray(rows), 'Authorized manifest root must be an array')
  assert(rows.length === EXPECTED_COUNTS.rows,
    `Manifest row count mismatch: expected ${EXPECTED_COUNTS.rows}, received ${rows.length}`)

  const counts = Object.fromEntries(CLASSIFICATIONS.map(classification => [classification, 0]))
  const ids = new Set()
  for (const row of rows) {
    assert(isRecord(row), 'Manifest contains a non-object row')
    assert(typeof row.recipeId === 'string' && row.recipeId.length > 0, 'Manifest row lacks recipeId')
    assert(!ids.has(row.recipeId), `Duplicate recipeId in manifest: ${row.recipeId}`)
    ids.add(row.recipeId)
    assert(CLASSIFICATIONS.includes(row.classification),
      `${row.recipeId}: unexpected classification ${String(row.classification)}`)
    counts[row.classification] += 1
    assertAuditVersion(row.auditVersion, row.recipeId)

    if (row.classification === 'READY') {
      assert(typeof row.sourceHash === 'string' && SHA256_PATTERN.test(row.sourceHash),
        `${row.recipeId}: READY row lacks a valid sourceHash`)
      assert(row.precondition?.currentMapAbsent === true,
        `${row.recipeId}: READY row precondition.currentMapAbsent is not true`)
      assert(row.precondition?.contentSourceHash === row.sourceHash,
        `${row.recipeId}: READY row content precondition differs from sourceHash`)
      assertCandidateShape(row.candidateMap, row)
      assert(row.audit?.candidateValidation?.valid === true,
        `${row.recipeId}: READY row lacks approved candidate validation`)
      assert(row.audit?.deterministicReview?.classification === 'SAFE',
        `${row.recipeId}: READY row lacks safe deterministic review`)
      assert(row.semanticReview?.aiAdditionsAmbiguous === 0 && row.semanticReview?.aiAdditionsIncorrect === 0,
        `${row.recipeId}: READY row contains unapproved semantic evidence`)
      assert(!['UNSAFE_MATERIAL_DIFFERENCE', 'ERROR'].includes(row.stability?.classification),
        `${row.recipeId}: READY row contains unsafe stability evidence`)
    } else {
      assert(row.candidateMap === null || row.candidateMap === undefined,
        `${row.recipeId}: non-READY row contains a write-eligible candidate`)
    }
  }

  for (const [classification, expected] of Object.entries(EXPECTED_COUNTS)) {
    if (classification === 'rows') continue
    assert(counts[classification] === expected,
      `Manifest ${classification} count mismatch: expected ${expected}, received ${counts[classification]}`)
  }
  return { rows: rows.length, ...counts }
}

export function loadAuthorizedManifest(bytes, relativePath = AUTHORIZED_MANIFEST_PATH) {
  const actualSha256 = verifyAuthorizedManifestBytes(bytes, relativePath)
  const rows = parseJson(bytes, 'Authorized manifest')
  const counts = validateManifestStructure(rows)
  return { rows, counts, actualSha256 }
}

export function loadValidationBaselines(bytes, readyRows, relativePath = VALIDATION_EVIDENCE_PATH) {
  verifyValidationEvidenceBytes(bytes, relativePath)
  const evidence = parseJson(bytes, 'Validation evidence')
  assert(isRecord(evidence) && Array.isArray(evidence.deterministicReview),
    'Validation evidence lacks deterministicReview')
  assert(evidence.deterministicReview.length === EXPECTED_COUNTS.READY,
    'Validation evidence does not contain 187 deterministic baselines')
  assertAuditVersion(evidence.auditVersion, 'validation evidence')

  const readyById = new Map(readyRows.map(row => [row.recipeId, row]))
  const baselines = new Map()
  for (const review of evidence.deterministicReview) {
    assert(isRecord(review) && typeof review.recipeId === 'string',
      'Validation evidence contains a malformed deterministic review')
    assert(!baselines.has(review.recipeId), `Duplicate validation baseline: ${review.recipeId}`)
    const row = readyById.get(review.recipeId)
    assert(row, `${review.recipeId}: validation baseline is outside the READY manifest population`)
    assert(review.classification === 'SAFE' && review.falsePositiveMappings === 0,
      `${review.recipeId}: validation baseline is not approved SAFE evidence`)
    assert(review.sourceHash === row.sourceHash,
      `${review.recipeId}: validation baseline sourceHash differs from manifest`)
    const baselineRow = { recipeId: review.recipeId, sourceHash: row.sourceHash }
    assertCandidateShape(review.deterministicMap, baselineRow)
    assert(review.deterministicMap.engineVersion === 'deterministic-v4',
      `${review.recipeId}: validation baseline is not deterministic-v4`)
    assert(review.deterministicMap.steps.every(step =>
      step.ingredients.every(reference => reference.provenance === 'deterministic') &&
      !step.preparedComponents?.length),
    `${review.recipeId}: validation baseline contains generated additions`)
    baselines.set(review.recipeId, review.deterministicMap)
  }
  assert(baselines.size === readyById.size, 'Validation evidence does not cover every READY row')
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
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { $bytes: Buffer.from(value).toString('base64') }
  }
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
  throw new Error(`Unsupported Firestore value in raw snapshot: ${Object.prototype.toString.call(value)}`)
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
  if (!APPROVED_ENGINES.includes(row.candidateMap?.engineVersion) ||
      row.candidateMap?.schemaVersion !== 1 || row.candidateMap?.parserVersion !== 'recipe-content-v1') {
    return { status: 'SKIP', reason: 'CONFIG_VERSION_MISMATCH' }
  }
  assert(baseline, `${row.recipeId}: validation baseline is unavailable`)
  const parsed = parseRecipeContent(typeof live.data?.content === 'string' ? live.data.content : '')
  const liveSourceHash = await computeSourceHash(parsed.ingredients, parsed.instructions)
  if (liveSourceHash !== row.sourceHash) {
    return { status: 'SKIP', reason: 'SOURCE_HASH_MISMATCH', liveSourceHash }
  }
  const validation = validateCandidate(row.candidateMap, parsed.ingredients, parsed.instructions, baseline)
  if (!validation?.valid) {
    return { status: 'SKIP', reason: 'CANDIDATE_INVALID', validationReason: validation?.reason || 'unknown' }
  }
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
        row,
        live: liveById.get(row.recipeId),
        baseline: baselines.get(row.recipeId),
        ...operations,
      })
      if (result.status === 'READY_TO_WRITE') readyToWrite.push({ row, ...result })
      else skipped.push({ recipeId: row.recipeId, title: row.title, ...result })
    } catch (error) {
      unexpectedErrors.push({
        recipeId: row.recipeId,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { readyToWrite, skipped, unexpectedErrors }
}

export function writePayload(candidateMap) {
  return { cookingStepIngredientMap: candidateMap }
}

export async function commitApplyPlan(db, plan) {
  assert(plan.unexpectedErrors.length === 0, 'Unexpected preflight errors prevent batch commit')
  assert(plan.readyToWrite.length <= MAX_BATCH_WRITES,
    `Planned writes exceed conservative ${MAX_BATCH_WRITES}-write limit`)
  if (plan.readyToWrite.length === 0) return { batchCount: 0, attemptedWrites: 0, committedWrites: 0 }
  const batch = db.batch()
  for (const item of plan.readyToWrite) {
    const ref = db.collection('recipes').doc(item.row.recipeId)
    const payload = writePayload(item.row.candidateMap)
    assert(Object.keys(payload).length === 1 && Object.hasOwn(payload, 'cookingStepIngredientMap'),
      'Write payload contains a field other than cookingStepIngredientMap')
    assert(item.updateTime, `${item.row.recipeId}: missing Firestore update-time precondition`)
    batch.update(ref, payload, { lastUpdateTime: item.updateTime })
  }
  await batch.commit()
  return {
    batchCount: 1,
    attemptedWrites: plan.readyToWrite.length,
    committedWrites: plan.readyToWrite.length,
  }
}

export async function verifyReadback({ readyRows, plan, liveById, baselines, parseRecipeContent, computeSourceHash, validateCandidate }) {
  const intendedById = new Map(plan.readyToWrite.map(item => [item.row.recipeId, item]))
  const skipById = new Map(plan.skipped.map(item => [item.recipeId, item]))
  const rows = []
  let exactCandidateMatches = 0
  let sourceHashMatches = 0
  let candidateValidationPasses = 0
  let nonMapFieldMismatches = 0
  let unexpectedStates = 0

  for (const row of readyRows) {
    const live = liveById.get(row.recipeId)
    const intended = intendedById.get(row.recipeId)
    if (intended) {
      const checks = {
        exists: Boolean(live?.exists),
        exactCandidate: Boolean(live?.exists && deepCanonicalEqual(live.data?.cookingStepIngredientMap, row.candidateMap)),
        sourceHash: false,
        candidateValid: false,
        nonMapFields: Boolean(live?.exists && documentHash(live.data, { excludeMap: true }) === intended.nonMapHash),
      }
      if (checks.exists) {
        try {
          const parsed = parseRecipeContent(typeof live.data?.content === 'string' ? live.data.content : '')
          const hash = await computeSourceHash(parsed.ingredients, parsed.instructions)
          checks.sourceHash = hash === row.sourceHash
          checks.candidateValid = Boolean(validateCandidate(
            live.data?.cookingStepIngredientMap, parsed.ingredients, parsed.instructions, baselines.get(row.recipeId),
          )?.valid)
        } catch {
          // The failed check is reported as UNEXPECTED_STATE below.
        }
      }
      if (checks.exactCandidate) exactCandidateMatches += 1
      if (checks.sourceHash) sourceHashMatches += 1
      if (checks.candidateValid) candidateValidationPasses += 1
      if (!checks.nonMapFields) nonMapFieldMismatches += 1
      const verified = Object.values(checks).every(Boolean)
      if (!verified) unexpectedStates += 1
      rows.push({ recipeId: row.recipeId, status: verified ? 'WRITTEN_AND_VERIFIED' : 'UNEXPECTED_STATE', checks })
      continue
    }

    const plannedSkip = skipById.get(row.recipeId)
    let observed
    try {
      observed = await evaluateReadyRow({
        row, live, baseline: baselines.get(row.recipeId), parseRecipeContent, computeSourceHash, validateCandidate,
      })
    } catch (error) {
      observed = { status: 'ERROR', reason: error instanceof Error ? error.message : String(error) }
    }
    const asPlanned = observed.status === 'SKIP' && observed.reason === plannedSkip?.reason
    if (!asPlanned) unexpectedStates += 1
    rows.push({
      recipeId: row.recipeId,
      status: asPlanned ? 'SKIPPED_AS_PLANNED' : 'UNEXPECTED_STATE',
      plannedReason: plannedSkip?.reason,
      observedReason: observed.reason,
    })
  }

  return {
    rows,
    writtenRowsReread: plan.readyToWrite.length,
    exactCandidateMatches,
    sourceHashMatches,
    candidateValidationPasses,
    nonMapFieldMismatches,
    unexpectedStates,
  }
}

export function verifyExcludedUnchanged(excludedRows, beforeById, afterById) {
  const mutations = []
  let preexistingMaps = 0
  for (const row of excludedRows) {
    const before = beforeById.get(row.recipeId)
    const after = afterById.get(row.recipeId)
    if (before?.exists && hasMap(before.data)) preexistingMaps += 1
    const beforeHash = before?.exists ? documentHash(before.data) : null
    const afterHash = after?.exists ? documentHash(after.data) : null
    if (Boolean(before?.exists) !== Boolean(after?.exists) || beforeHash !== afterHash) {
      mutations.push({ recipeId: row.recipeId, beforeHash, afterHash })
    }
  }
  return {
    rows: excludedRows.length,
    preexistingMaps,
    writesByThisApply: 0,
    mutations,
  }
}
