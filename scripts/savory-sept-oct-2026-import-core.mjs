import assert from 'node:assert/strict'
import crypto from 'node:crypto'

export const PROJECT_ID = 'malignant-metro'
export const RECIPE_COLLECTION = 'recipes'
export const EXPECTED_RECIPE_COUNT = 9
export const SUPPORTED_NUTRITION_SOURCE = /^(?:source_site|manual|usda)(?:\+[a-z_]+)*$/

const BASE_FIELDS = [
  'recipeID', 'title', 'content', 'category', 'cuisine', 'imageURL', 'sourceURL',
  'sourceFile', 'labels', 'hasImage', 'created', 'modified', 'addedBy', 'prepTime',
  'cookTime', 'servings', 'nutritionStatus', 'defaultRole',
]
const MACRO_FIELDS = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g']

export function stableValue(value) {
  if (value === undefined) return { __type: 'undefined' }
  if (value === null || typeof value !== 'object') return value
  if (typeof value.toMillis === 'function') return { __type: 'timestamp', millis: value.toMillis() }
  if (value instanceof Date) return { __type: 'date', iso: value.toISOString() }
  if (Buffer.isBuffer(value)) return { __type: 'buffer', base64: value.toString('base64') }
  if (Array.isArray(value)) return value.map(stableValue)
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
}

export function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function buildRecipeContent(entry) {
  return [
    'INGREDIENTS',
    ...entry.ingredients,
    '',
    'INSTRUCTIONS',
    ...entry.instructions.flatMap((instruction, index) => [`Step ${index + 1}`, instruction]),
  ].join('\n')
}

export function normalizeSourceTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

function requireNonEmptyString(value, message) {
  assert.equal(typeof value, 'string', message)
  assert.ok(value.trim(), message)
}

function assertHttpsUrl(value, message) {
  requireNonEmptyString(value, message)
  const url = new URL(value)
  assert.equal(url.protocol, 'https:', message)
  return url
}

export function validateManifest(manifest, deps) {
  assert.equal(manifest.batchId, 'savory-september-october-2026-nine-recipes')
  assert.equal(manifest.sourceFile, 'Savory — September/October 2026 print issue')
  assert.equal(manifest.defaultRole, 'main')
  assert.ok(Array.isArray(manifest.recipes), 'manifest recipes must be an array')
  assert.equal(manifest.recipes.length, EXPECTED_RECIPE_COUNT, 'manifest must contain exactly nine recipes')

  const titles = new Set()
  const ids = new Set()
  return manifest.recipes.map((entry, index) => {
    const label = entry?.title || `manifest row ${index + 1}`
    assert.ok(entry && typeof entry === 'object', `${label}: object required`)
    for (const field of ['title', 'category', 'cuisine', 'prepTime', 'cookTime', 'sourceURL', 'imageURL']) {
      requireNonEmptyString(entry[field], `${label}: ${field} is required`)
    }
    assert.ok(deps.isRecipeCategory(entry.category), `${label}: invalid category ${entry.category}`)
    assert.equal(entry.cuisine, entry.cuisine.toLowerCase(), `${label}: cuisine must follow lowercase catalog convention`)
    assert.ok(Number.isInteger(entry.servings) && entry.servings > 0, `${label}: servings must be a positive integer`)
    assert.ok(Array.isArray(entry.labels) && entry.labels.length > 0, `${label}: labels required`)
    assert.equal(new Set(entry.labels).size, entry.labels.length, `${label}: labels must be unique`)
    assert.ok(entry.labels.every(item => typeof item === 'string' && item.trim()), `${label}: invalid label`)
    assert.ok(Array.isArray(entry.ingredients) && entry.ingredients.length > 0, `${label}: ingredients required`)
    assert.ok(Array.isArray(entry.instructions) && entry.instructions.length > 0, `${label}: instructions required`)
    assert.ok(entry.ingredients.every(item => typeof item === 'string' && item.trim()), `${label}: invalid ingredient`)
    assert.ok(entry.instructions.every(item => typeof item === 'string' && item.trim()), `${label}: invalid instruction`)
    assert.equal(entry.ingredients.length, entry.sourceMetadata.ingredientCount, `${label}: manifest ingredient count mismatch`)
    assert.equal(entry.instructions.length, entry.sourceMetadata.instructionCount, `${label}: manifest instruction count mismatch`)

    const source = assertHttpsUrl(entry.sourceURL, `${label}: invalid source URL`)
    assert.equal(source.hostname, 'www.savoryonline.com', `${label}: source must be official Savory`)
    assert.ok(source.pathname.startsWith('/recipes/'), `${label}: source must be a recipe page`)
    const image = assertHttpsUrl(entry.imageURL, `${label}: invalid image URL`)
    assert.equal(image.hostname, 'www.savoryonline.com', `${label}: image must be official Savory`)
    assert.ok(image.pathname.includes('/app/uploads/recipes/'), `${label}: image must be dish-specific recipe media`)

    const recipeID = deps.recipeIdForTitle(entry.title)
    assert.ok(!titles.has(entry.title), `${label}: duplicate title`)
    assert.ok(!ids.has(recipeID), `${label}: duplicate target ID ${recipeID}`)
    titles.add(entry.title)
    ids.add(recipeID)

    const content = buildRecipeContent(entry)
    const parsed = deps.parseRecipeContent(content)
    assert.deepEqual(parsed.ingredients, entry.ingredients, `${label}: ingredient parser round-trip mismatch`)
    assert.deepEqual(parsed.instructions, entry.instructions, `${label}: instruction parser round-trip mismatch`)

    return {
      ...entry,
      sourceFile: manifest.sourceFile,
      defaultRole: manifest.defaultRole,
      recipeID,
      content,
      parsed,
    }
  })
}

export function buildBaseRecipeDocument(entry, { addedBy, created }) {
  const document = {
    recipeID: entry.recipeID,
    title: entry.title,
    content: entry.content,
    category: entry.category,
    cuisine: entry.cuisine,
    imageURL: entry.imageURL,
    sourceURL: entry.sourceURL,
    sourceFile: entry.sourceFile,
    labels: entry.labels.join(','),
    hasImage: entry.imageURL ? 'true' : 'false',
    created,
    modified: created,
    addedBy,
    prepTime: entry.prepTime,
    cookTime: entry.cookTime,
    servings: entry.servings,
    nutritionStatus: 'needs_calc',
    defaultRole: 'main',
  }
  for (const field of BASE_FIELDS) {
    assert.ok(Object.hasOwn(document, field), `${entry.title}: missing required field ${field}`)
    assert.notEqual(document[field], undefined, `${entry.title}: undefined required field ${field}`)
  }
  return document
}

export function classifyExisting(existing, proposed) {
  if (!existing) return 'absent'
  const comparable = { ...proposed }
  delete comparable.created
  delete comparable.modified
  delete comparable.nutritionStatus
  const existingComparable = Object.fromEntries(Object.keys(comparable).map(key => [key, existing[key]]))
  if (fingerprint(existingComparable) === fingerprint(comparable)) return 'exact-equivalent'
  if (existing.recipeID === proposed.recipeID && normalizeSourceTitle(existing.title) === normalizeSourceTitle(proposed.title)) {
    return 'already-present'
  }
  return 'conflicting-existing'
}

export function validateSourceMetadata(entry, live) {
  assert.ok(live && typeof live === 'object', `${entry.title}: missing source verification`)
  assert.equal(live.canonicalURL, entry.sourceURL, `${entry.title}: canonical source URL mismatch`)
  assert.equal(normalizeSourceTitle(live.name), normalizeSourceTitle(entry.sourceMetadata.name), `${entry.title}: source title mismatch`)
  assert.equal(live.prepTime, entry.sourceMetadata.prepTime, `${entry.title}: source prep time mismatch`)
  assert.equal(live.cookTime, entry.sourceMetadata.cookTime, `${entry.title}: source cook time mismatch`)
  assert.equal(Number(live.servings), entry.sourceMetadata.servings, `${entry.title}: source servings mismatch`)
  assert.equal(live.ingredientCount, entry.sourceMetadata.ingredientCount, `${entry.title}: source ingredient count mismatch`)
  assert.equal(live.instructionCount, entry.sourceMetadata.instructionCount, `${entry.title}: source instruction count mismatch`)
  assert.equal(live.imageURL, entry.imageURL, `${entry.title}: source image mismatch`)
  return { sourceURLStatus: 'verified', imageURLStatus: entry.imageURL ? 'verified' : 'absent' }
}

export function buildDryRunRows(entries, context) {
  return entries.map(entry => {
    const proposed = buildBaseRecipeDocument(entry, { addedBy: context.adminUid, created: context.previewCreated })
    const existing = context.liveById.get(entry.recipeID) || null
    const collision = classifyExisting(existing, proposed)
    const sourceStatus = validateSourceMetadata(entry, context.sourceByUrl.get(entry.sourceURL))
    return {
      title: entry.title,
      targetRecipeID: entry.recipeID,
      targetDocExists: Boolean(existing),
      existingClassification: collision,
      category: entry.category,
      cuisine: entry.cuisine,
      ingredientCount: entry.parsed.ingredients.length,
      instructionCount: entry.parsed.instructions.length,
      prepTime: entry.prepTime,
      cookTime: entry.cookTime,
      servings: entry.servings,
      ...sourceStatus,
      addedByUidResolutionStatus: context.adminUid ? 'resolved' : 'unresolved',
      parseRecipeContent: {
        status: 'passed',
        ingredientsExact: fingerprint(entry.parsed.ingredients) === fingerprint(entry.ingredients),
        instructionsExact: fingerprint(entry.parsed.instructions) === fingerprint(entry.instructions),
      },
      auditNote: entry.auditNote || null,
      proposedWriteStatus: collision === 'absent' ? 'READY_TO_CREATE' : 'BLOCKED_COLLISION',
    }
  })
}

export function assertDryRunClean(rows) {
  assert.equal(rows.length, EXPECTED_RECIPE_COUNT, 'dry run must cover all nine recipes')
  assert.ok(rows.every(row => row.addedByUidResolutionStatus === 'resolved'), 'admin identity unresolved')
  assert.ok(rows.every(row => row.parseRecipeContent.status === 'passed'), 'content parser failed')
  assert.ok(rows.every(row => row.proposedWriteStatus === 'READY_TO_CREATE'), 'dry run blocked by title/slug collision')
}

function assertMacros(value, label) {
  assert.ok(value && typeof value === 'object', `${label}: macro object missing`)
  for (const field of MACRO_FIELDS) {
    assert.equal(typeof value[field], 'number', `${label}: ${field} must be numeric`)
    assert.ok(Number.isFinite(value[field]) && value[field] >= 0, `${label}: ${field} must be finite and nonnegative`)
  }
}

export function validateNutrition(nutrition, servings, title) {
  assertMacros(nutrition, `${title}.nutrition`)
  assertMacros(nutrition.total, `${title}.nutrition.total`)
  assert.equal(nutrition.servings, servings, `${title}: nutrition servings mismatch`)
  requireNonEmptyString(nutrition.serving_size, `${title}: nutrition serving_size missing`)
  requireNonEmptyString(nutrition.source, `${title}: nutrition source missing`)
  assert.match(nutrition.source, SUPPORTED_NUTRITION_SOURCE, `${title}: unsupported nutrition source`)
  assert.ok(['high', 'medium', 'low'].includes(nutrition.confidence), `${title}: invalid nutrition confidence`)
  assert.ok(nutrition.computed_at, `${title}: nutrition computed_at missing`)
}

export function verifyStoredRecipe(entry, stored, adminUid) {
  assert.ok(stored, `${entry.title}: stored recipe missing`)
  const expected = buildBaseRecipeDocument(entry, { addedBy: adminUid, created: stored.created })
  expected.modified = stored.modified
  expected.nutritionStatus = 'computed'
  for (const [field, value] of Object.entries(expected)) {
    assert.deepEqual(stored[field], value, `${entry.title}: stored ${field} mismatch`)
  }
  validateNutrition(stored.nutrition, entry.servings, entry.title)
  assert.deepEqual(entry.parsed.ingredients, entry.ingredients, `${entry.title}: stored ingredient parse mismatch`)
  assert.deepEqual(entry.parsed.instructions, entry.instructions, `${entry.title}: stored instruction parse mismatch`)
  assert.equal(stored.hasImage, stored.imageURL ? 'true' : 'false', `${entry.title}: hasImage mismatch`)
  return true
}

export async function applyPreparedEntries(entries, context) {
  const results = []
  for (const entry of entries) {
    const created = context.nowString()
    const baseDocument = buildBaseRecipeDocument(entry, { addedBy: context.adminUid, created })
    const createResult = await context.adapter.createIfAbsent(entry.recipeID, baseDocument)
    if (!createResult.created) {
      results.push({ title: entry.title, recipeID: entry.recipeID, written: false, status: 'COLLISION_SKIPPED', nutritionComputed: false, image: Boolean(entry.imageURL), sourceURL: true })
      continue
    }

    let finalDocument = null
    let lastError = null
    let nutritionAttempts = 0
    const rollbackCandidates = [baseDocument]
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      nutritionAttempts = attempt
      try {
        const computeResult = await context.adapter.computeNutrition(entry.recipeID, context.adminUid)
        validateNutrition(computeResult.nutrition, entry.servings, entry.title)
        await context.adapter.storeNutrition(entry.recipeID, computeResult.nutrition)
        const candidate = await context.adapter.read(entry.recipeID)
        if (candidate) rollbackCandidates.push(candidate)
        const storedParsed = context.parseRecipeContent(candidate?.content || '')
        const preparedWithStoredParse = { ...entry, parsed: storedParsed }
        verifyStoredRecipe(preparedWithStoredParse, candidate, context.adminUid)
        finalDocument = candidate
        break
      } catch (error) {
        finalDocument = null
        lastError = error
      }
    }

    if (!finalDocument) {
      const rollback = await context.adapter.deleteIfMatches(entry.recipeID, rollbackCandidates)
      results.push({
        title: entry.title,
        recipeID: entry.recipeID,
        written: false,
        status: rollback ? 'FAILED_ROLLED_BACK' : 'FAILED_ROLLBACK_BLOCKED',
        nutritionComputed: false,
        nutritionAttempts,
        image: Boolean(entry.imageURL),
        sourceURL: true,
        error: lastError instanceof Error ? lastError.message : String(lastError),
      })
      continue
    }

    results.push({
      title: entry.title,
      recipeID: entry.recipeID,
      written: true,
      status: 'WRITTEN_VERIFIED',
      nutritionComputed: true,
      nutritionAttempts,
      image: Boolean(entry.imageURL),
      sourceURL: true,
      nutritionSource: finalDocument.nutrition.source,
    })
  }
  return results
}
