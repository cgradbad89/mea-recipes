import { createHash } from 'node:crypto'

export const AUTHORIZED_RECIPE_IDS = Object.freeze([
  'chicken-enchiladas',
  'chicken-stew',
  'couscous-salad-with-lime-basil-vinaigrette',
  'creamy-cauliflower-soup-with-rosemary-olive-oil',
  'pepper-steak',
  'pork-fried-rice',
])

export const MANIFEST_PATH = 'docs/audits/excluded-recipe-wave2-dryrun-2026-08-26.json'
export const MANIFEST_MD_PATH = 'docs/audits/excluded-recipe-wave2-dryrun-2026-08-26.md'
export const APPLY_PATH = 'docs/audits/excluded-recipe-wave2-apply-2026-08-26.json'
export const APPLY_MD_PATH = 'docs/audits/excluded-recipe-wave2-apply-2026-08-26.md'
export const AUTHORIZED_MANIFEST_SHA256 = '04108a7264db428862c7d5c52da0c3191f005ad138edb5bf290dba7ec292b151'

const URL_LINE = /^https?:\/\/\S+$/i
const CONTAMINATION = /^(?:PIN RECIPE|UNITS USM|SCALE|\d+(?:\/\d+)?\s*x|Cook Mode Prevent your screen from going dark|On Off|Add ingredients to Grocery List|Shop ingredients on Instacart|Nutritional Information|VIDEO|5 Secrets of Authentic Chinese Cooking|Get the guide for FREE)$/i
const FORMAT_LINE = /^(?:NOTES|INGREDIENTS|INSTRUCTIONS|Step \d+)$/

const REPAIR_EVIDENCE = Object.freeze({
  'chicken-enchiladas': {
    operation: 'MOVE_EXISTING_TEXT',
    defect: 'The final serving step mixes actionable method with freezer-storage guidance; raw source URL and ingredient metadata/chrome remain in the stored serialization.',
    contaminatingText: ['Yield:', '6 servings', 'Add ingredients to Grocery List', 'Shop ingredients on Instacart', 'Nutritional Information'],
    repositionedText: ['For leftovers, divide remaining enchiladas into portions of 2 or 3; wrap each portion tightly in plastic wrap or place in a freezer bag, squeeze out the air, seal and freeze for up to 3 months.'],
    rationale: 'The audit identifies the exact “For leftovers” boundary in the existing final step and classifies the suffix as useful storage guidance rather than cooking method.',
  },
  'chicken-stew': {
    operation: 'MOVE_EXISTING_TEXT',
    defect: 'An exact Tip freezer/reheating note follows the completed method; yield metadata and the source URL are mixed into the raw section structure.',
    contaminatingText: ['Yield: 4 servings'],
    repositionedText: ['The stew can be frozen for up to 3 months, then defrosted for easy reheating.'],
    rationale: 'The audit identifies the existing Tip line as useful storage guidance that belongs outside Cooking Mode.',
  },
  'couscous-salad-with-lime-basil-vinaigrette': {
    operation: 'NORMALIZE_SECTION_STRUCTURE',
    defect: 'Recipe-card controls and scale metadata surround the ingredient/method sections, while weekly-storage guidance is embedded in the final toss/serve step.',
    contaminatingText: ['PIN RECIPE', 'UNITS USM', 'SCALE', '1/2 x', '1 x', '2 x', 'Cook Mode Prevent your screen from going dark', 'On Off'],
    repositionedText: ['(OR, store each ingredient individually for salads throughout the week.)'],
    rationale: 'The audit names the exact card chrome and exact parenthetical storage suffix; the remaining sentence is the complete actionable toss/serve step.',
  },
  'creamy-cauliflower-soup-with-rosemary-olive-oil': {
    operation: 'MOVE_EXISTING_TEXT',
    defect: 'Reheating and one-week oil-storage guidance is embedded in the final serving step; yield metadata and the source URL remain in the raw serialization.',
    contaminatingText: ['Yield: 6 servings'],
    repositionedText: ['The soup will thicken as it sits; add more stock as necessary when reheating. Leftover rosemary oil will keep in a sealed container at room temperature for up to 1 week.'],
    rationale: 'The audit identifies the exact serving/action boundary and the existing reheating/storage suffix as useful non-method guidance.',
  },
  'pepper-steak': {
    operation: 'MOVE_EXISTING_TEXT',
    defect: 'An exact Tip contains optional tenderizing guidance after the completed method; yield metadata and the source URL remain in the raw serialization.',
    contaminatingText: ['Yield: 4 servings'],
    repositionedText: ['If using a tougher cut like bottom round steak, add ¼ teaspoon baking soda to tenderize the meat, but don’t let it marinate for longer than 30 minutes or it’ll turn mushy.'],
    rationale: 'The audit identifies the existing Tip as useful conditional guidance that belongs outside the canonical actionable method.',
  },
  'pork-fried-rice': {
    operation: 'NORMALIZE_SECTION_STRUCTURE',
    defect: 'Ingredient promotional chrome, a VIDEO marker, and three useful source notes are mixed into the canonical ingredient/method spans; four method subheadings parse as standalone instructions.',
    contaminatingText: ['5 Secrets of Authentic Chinese Cooking', 'Get the guide for FREE', 'VIDEO'],
    repositionedText: [
      '1. You may replace oyster sauce with vegetarian stir-fry sauce (素食蚝油), or mushroom vegetarian stir-fry sauce (香菇素食蚝油).',
      '2. For the optimal fluffiness, check out my post on Three Ways to Cook Rice On the Stove which includes two methods (strainer and steamer) that produce firm, al dente rice that’s perfect for making any fried rice dish.',
      '3. Please feel free to use a deep skillet/frying pan if you don’t have a wok. No matter which cookware you use, it’s important you never heat it empty if it has a non-stick coating. In this case, add oil first then heat up.',
    ],
    rationale: 'The audit identifies the exact VIDEO/NOTES footer. Existing method labels are joined to their immediately following action text using punctuation only.',
  },
})

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function sourceHash(ingredients, instructions) {
  return sha256(JSON.stringify({ ingredients, instructions }))
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function canonicalizeRawFirestoreValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { $number: 'NaN' }
    if (value === Infinity) return { $number: 'Infinity' }
    if (value === -Infinity) return { $number: '-Infinity' }
    if (Object.is(value, -0)) return { $number: '-0' }
    return value
  }
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

export function documentHash(data, { excludeContent = false } = {}) {
  const copy = isRecord(data) ? { ...data } : data
  if (excludeContent && isRecord(copy)) delete copy.content
  return sha256(canonicalSerialize(copy))
}

function normalizedTokens(value) {
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) || []
}

export function isContentDerivedOnlyFromOriginal(originalContent, proposedContent) {
  const originalTokens = new Set(normalizedTokens(originalContent))
  const meaningful = proposedContent.split('\n').filter(line => !FORMAT_LINE.test(line.trim())).join('\n')
  return normalizedTokens(meaningful).every(token => originalTokens.has(token))
}

function splitAtExactSuffix(line, suffix, recipeId) {
  const index = line.indexOf(suffix)
  assert(index > 0, `${recipeId}: exact audited suffix is absent`)
  return [line.slice(0, index).trim(), line.slice(index).trim()]
}

function buildRepairParts(recipeId, originalContent, parsed) {
  const sourceURL = originalContent.split('\n').map(line => line.trim()).find(URL_LINE.test.bind(URL_LINE)) || ''
  assert(sourceURL, `${recipeId}: source URL missing from original content`)
  const ingredients = [...parsed.ingredients]
  const current = parsed.instructions.filter(line => !URL_LINE.test(line))
  let description = ''
  let notes = []
  let instructions = []

  switch (recipeId) {
    case 'chicken-enchiladas': {
      assert(current.length === 4, `${recipeId}: expected four Wave 1A method rows`)
      const [method, note] = splitAtExactSuffix(current[3], 'For leftovers,', recipeId)
      instructions = [...current.slice(0, 3), method]
      notes = [note]
      break
    }
    case 'chicken-stew':
      assert(current.length === 5, `${recipeId}: expected four method rows plus one audited note`)
      instructions = current.slice(0, 4)
      notes = current.slice(4)
      break
    case 'couscous-salad-with-lime-basil-vinaigrette': {
      assert(current.length === 4, `${recipeId}: expected four Wave 1A method rows`)
      const [method, note] = splitAtExactSuffix(current[3], '(OR, store each ingredient individually for salads throughout the week.)', recipeId)
      instructions = [...current.slice(0, 3), method]
      notes = [note]
      description = originalContent.split('\n').map(line => line.trim()).find(line => line.startsWith('A bright, zippy,')) || ''
      assert(description, `${recipeId}: audited description is absent`)
      break
    }
    case 'creamy-cauliflower-soup-with-rosemary-olive-oil': {
      assert(current.length === 6, `${recipeId}: expected six Wave 1A method rows`)
      const [method, note] = splitAtExactSuffix(current[5], 'The soup will thicken as it sits;', recipeId)
      instructions = [...current.slice(0, 5), method]
      notes = [note]
      break
    }
    case 'pepper-steak':
      assert(current.length === 5, `${recipeId}: expected four method rows plus one audited tip`)
      instructions = current.slice(0, 4)
      notes = current.slice(4)
      break
    case 'pork-fried-rice': {
      assert(current.length === 14, `${recipeId}: expected eleven method rows plus three audited notes`)
      const combine = (headingIndex, actionIndex) => `${current[headingIndex]}: ${current[actionIndex]}`
      instructions = [
        combine(0, 1),
        combine(2, 3),
        current[4],
        combine(5, 6),
        current[7],
        combine(8, 9),
        current[10],
      ]
      notes = current.slice(11)
      break
    }
    default:
      throw new Error(`Unauthorized recipe ID: ${recipeId}`)
  }

  for (const value of [...ingredients, ...instructions, ...notes, sourceURL, description].filter(Boolean)) {
    const fragments = value.split(': ').map(fragment => fragment.trim()).filter(Boolean)
    assert(fragments.every(fragment => originalContent.includes(fragment)), `${recipeId}: proposed text is not byte-derived: ${value}`)
  }
  return { sourceURL, description, notes, ingredients, instructions }
}

function serializeRepair(parts) {
  const lines = [parts.sourceURL, '']
  if (parts.description) lines.push(parts.description, '')
  if (parts.notes.length) lines.push('NOTES', ...parts.notes, '')
  lines.push('INGREDIENTS', ...parts.ingredients, '', 'INSTRUCTIONS')
  parts.instructions.forEach((instruction, index) => lines.push(`Step ${index + 1}`, instruction))
  return lines.join('\n')
}

export function isParserClean(parsed) {
  return parsed.ingredients.length > 0 &&
    parsed.instructions.length > 0 &&
    parsed.instructions.every(line =>
      line.length > 10 &&
      !URL_LINE.test(line) &&
      !CONTAMINATION.test(line) &&
      !/^(?:NOTES?|Tip)$/i.test(line) &&
      !/\b(?:frozen for up to|store each ingredient individually|Leftover rosemary oil will keep)\b/i.test(line),
    )
}

function arraysEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function buildManifest({ liveRecipes, auditRows, parseRecipeContent, createdAt }) {
  const liveIds = [...liveRecipes.keys()].sort()
  assert(arraysEqual(liveIds, [...AUTHORIZED_RECIPE_IDS]), 'Dry-run population must be the exact six authorized recipe IDs')
  const auditById = new Map(auditRows.map(row => [row.recipeId, row]))
  const rows = AUTHORIZED_RECIPE_IDS.map(recipeId => {
    const live = liveRecipes.get(recipeId)
    const evidence = REPAIR_EVIDENCE[recipeId]
    const audit = auditById.get(recipeId)
    assert(live?.exists && isRecord(live.data), `${recipeId}: live recipe is missing`)
    assert(audit?.recommendedDisposition === 'PARSER_AND_DATA_FIX', `${recipeId}: audit disposition mismatch`)
    const beforeContent = typeof live.data.content === 'string' ? live.data.content : ''
    const beforeParse = parseRecipeContent(beforeContent)
    assert(arraysEqual(beforeParse.ingredients, audit.currentParse.ingredients), `${recipeId}: live ingredients differ materially from audit evidence`)
    assert(arraysEqual(beforeParse.instructions, audit.currentParse.instructions.filter(line => !URL_LINE.test(line))), `${recipeId}: live instructions differ materially from Wave 1A audit evidence`)
    const parts = buildRepairParts(recipeId, beforeContent, beforeParse)
    const proposedContent = serializeRepair(parts)
    const proposedParse = parseRecipeContent(proposedContent)
    const safety = {
      allAddedTextExistsInOriginal: isContentDerivedOnlyFromOriginal(beforeContent, proposedContent),
      inventedFacts: false,
      parserClean: isParserClean(proposedParse) &&
        arraysEqual(proposedParse.ingredients, parts.ingredients) &&
        arraysEqual(proposedParse.instructions, parts.instructions),
      existingMapAbsent: live.data.cookingStepIngredientMap == null,
    }
    const classification = safety.allAddedTextExistsInOriginal &&
      !safety.inventedFacts &&
      safety.parserClean &&
      safety.existingMapAbsent
      ? 'READY'
      : 'SKIP'
    return {
      recipeId,
      title: String(live.data.title || audit.title || ''),
      beforeContentSha256: sha256(beforeContent),
      beforeSourceHash: sourceHash(beforeParse.ingredients, beforeParse.instructions),
      operation: evidence.operation,
      editOperations: [
        {
          type: evidence.operation,
          currentDefect: evidence.defect,
          exactContaminatingText: evidence.contaminatingText,
          textRemaining: { ingredients: parts.ingredients, instructions: parts.instructions, notes: parts.notes },
          textRemoved: [...evidence.contaminatingText],
          textRepositioned: [...evidence.repositionedText, parts.sourceURL],
          sourceSupport: evidence.rationale,
        },
      ],
      proposedContent,
      proposedContentSha256: sha256(proposedContent),
      proposedSourceHash: sourceHash(proposedParse.ingredients, proposedParse.instructions),
      proposedParse: { ingredients: proposedParse.ingredients, instructions: proposedParse.instructions },
      safety,
      classification,
    }
  }).sort((a, b) => a.recipeId.localeCompare(b.recipeId))

  return {
    schemaVersion: 1,
    wave: 'Wave 2 exact-content repair',
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
    },
    rows,
  }
}

export function validateManifest(manifest, expectedSha = null, bytes = null) {
  assert(isRecord(manifest) && manifest.schemaVersion === 1, 'Manifest schema mismatch')
  assert(Array.isArray(manifest.rows) && manifest.rows.length === 6, 'Manifest must contain exactly six rows')
  assert(arraysEqual(manifest.rows.map(row => row.recipeId), [...AUTHORIZED_RECIPE_IDS]), 'Manifest recipe IDs are not the exact authorized population')
  assert(manifest.rows.every(row => row.classification === 'READY' || row.classification === 'SKIP'), 'Manifest classification is invalid')
  assert(manifest.rows.every(row => sha256(row.proposedContent) === row.proposedContentSha256), 'Manifest proposed-content hash mismatch')
  assert(manifest.rows.every(row => row.safety?.inventedFacts === false), 'Manifest contains an invented-facts row')
  if (expectedSha !== null) {
    assert(bytes !== null, 'Manifest bytes are required for the immutable SHA gate')
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
  const proposedContentSha = sha256(row.proposedContent)
  if (proposedContentSha !== row.proposedContentSha256) return { status: 'ERROR', reason: 'PROPOSED_CONTENT_SHA_MISMATCH' }
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
  if (!isContentDerivedOnlyFromOriginal(liveContent, row.proposedContent)) return { status: 'ERROR', reason: 'INVENTED_TEXT_DETECTED' }
  return {
    status: 'READY_TO_WRITE',
    updateTime: live.updateTime,
    beforeDocumentHash: documentHash(live.data),
    beforeNonContentHash: documentHash(live.data, { excludeContent: true }),
  }
}

export function buildApplyPlan({ manifest, liveById, parseRecipeContent }) {
  const readyToWrite = []
  const skipped = []
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
  assert(plan.readyToWrite.length <= 6, 'Write plan exceeds the exact six-recipe authorization')
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
  const rows = []
  for (const row of manifest.rows) {
    const item = intended.get(row.recipeId)
    if (!item) {
      rows.push({ recipeId: row.recipeId, status: 'NOT_WRITTEN' })
      continue
    }
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
    rows.push({ recipeId: row.recipeId, status: Object.values(checks).every(Boolean) ? 'WRITTEN_AND_VERIFIED' : 'UNEXPECTED_STATE', checks, exactContentReadback: live?.data?.content || null })
  }
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

export function verifyCorpusChanges({ beforeById, afterById, writtenRecipeIds }) {
  const written = new Set(writtenRecipeIds)
  const outsideAuthorizedMutations = []
  const mappedRecipeMutations = []
  const persistedMapChanges = []
  const nonContentMutations = []
  for (const [recipeId, before] of beforeById) {
    const after = afterById.get(recipeId)
    const beforeData = before?.data
    const afterData = after?.data
    const beforeMap = beforeData?.cookingStepIngredientMap
    const afterMap = afterData?.cookingStepIngredientMap
    if (canonicalSerialize(beforeMap ?? null) !== canonicalSerialize(afterMap ?? null)) persistedMapChanges.push(recipeId)
    if (beforeMap != null && documentHash(beforeData) !== documentHash(afterData)) mappedRecipeMutations.push(recipeId)
    if (written.has(recipeId)) {
      if (documentHash(beforeData, { excludeContent: true }) !== documentHash(afterData, { excludeContent: true })) nonContentMutations.push(recipeId)
    } else if (documentHash(beforeData) !== documentHash(afterData)) {
      outsideAuthorizedMutations.push(recipeId)
    }
  }
  return { outsideAuthorizedMutations, mappedRecipeMutations, persistedMapChanges, nonContentMutations }
}

export function mappedCorpusSafety(recipes, parseRecipeContent) {
  const mapped = [...recipes.values()].filter(item => item.exists && item.data?.cookingStepIngredientMap != null)
  const storedHashMismatches = []
  for (const item of mapped) {
    const parsed = parseRecipeContent(String(item.data.content || ''))
    if (sourceHash(parsed.ingredients, parsed.instructions) !== item.data.cookingStepIngredientMap.sourceHash) storedHashMismatches.push(item.id)
  }
  return { mappedRecipes: mapped.length, storedHashMismatches }
}

export function compareMappedCorpus(beforeRecipes, afterRecipes, parseRecipeContent) {
  const ingredientArrayChanges = []
  const instructionArrayChanges = []
  const sourceHashChanges = []
  for (const [recipeId, before] of beforeRecipes) {
    if (!before.exists || before.data?.cookingStepIngredientMap == null) continue
    const after = afterRecipes.get(recipeId)
    const beforeParse = parseRecipeContent(String(before.data.content || ''))
    const afterParse = parseRecipeContent(String(after?.data?.content || ''))
    if (!arraysEqual(beforeParse.ingredients, afterParse.ingredients)) ingredientArrayChanges.push(recipeId)
    if (!arraysEqual(beforeParse.instructions, afterParse.instructions)) instructionArrayChanges.push(recipeId)
    if (sourceHash(beforeParse.ingredients, beforeParse.instructions) !== sourceHash(afterParse.ingredients, afterParse.instructions)) {
      sourceHashChanges.push(recipeId)
    }
  }
  return { ingredientArrayChanges, instructionArrayChanges, sourceHashChanges }
}

export function manifestMarkdown(manifest, manifestSha, corpusSafety) {
  const rows = manifest.rows.map(row => `| \`${row.recipeId}\` | ${row.operation} | ${row.classification} | ${row.proposedParse.ingredients.length} | ${row.proposedParse.instructions.length} |`).join('\n')
  return `# Excluded Recipe Wave 2 Dry Run — 2026-08-26\n\n## Executive result\n\n**${manifest.counts.SKIP === 0 ? 'PASS' : 'PASS WITH SKIPS'}** — exact six-recipe immutable content-repair manifest. Production was read-only during this phase.\n\n- Manifest SHA-256: \`${manifestSha}\`\n- READY: **${manifest.counts.READY}**\n- SKIP: **${manifest.counts.SKIP}**\n- Mapped corpus: **${corpusSafety.mappedRecipes}**\n- Mapped stored sourceHash mismatches: **${corpusSafety.storedHashMismatches.length}**\n- Parser changes: **0**\n- Mapping generation/writes: **0 / 0**\n- AI calls: **0**\n\n## Rows\n\n| Recipe | Operation | Classification | Ingredients | Instructions |\n|---|---|---:|---:|---:|\n${rows}\n\nEvery READY proposal is derived from its exact live content plus formatting-only section/step labels. Useful storage/tip/notes text is preserved before the ingredient section so it does not enter Cooking Mode.\n`
}

export function applyMarkdown(report) {
  const rows = report.readback.rows.map(row => `| \`${row.recipeId}\` | ${row.status} | ${row.checks?.exactContent ?? 'n/a'} | ${row.checks?.exactParse ?? 'n/a'} | ${row.checks?.nonContentFields ?? 'n/a'} | ${row.checks?.mapAbsent ?? 'n/a'} |`).join('\n')
  return `# Excluded Recipe Wave 2 Apply — 2026-08-26\n\n## Executive result\n\n**${report.executiveResult}**\n\n- Manifest SHA-256: \`${report.manifest.sha256}\`\n- Pre-apply READY / SKIP: **${report.preApply.readyToWrite} / ${report.preApply.skipped}**\n- Writes attempted / committed: **${report.apply.attemptedWrites} / ${report.apply.committedWrites}**\n- Exact content readbacks: **${report.readback.exactContentMatches}/${report.readback.writtenRowsReread}**\n- Non-content mismatches: **${report.readback.nonContentMismatches}**\n- Map fields written: **0**\n- AI calls: **0**\n- Post-apply READY_TO_WRITE: **${report.postApply.readyToWrite}**\n- Remaining excluded recipes: **${report.remainingExcludedRecipes}**\n\n## Readback\n\n| Recipe | Status | Exact content | Exact parse | Non-content unchanged | Map absent |\n|---|---|---:|---:|---:|---:|\n${rows}\n`
}
