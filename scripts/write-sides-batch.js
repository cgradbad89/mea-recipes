#!/usr/bin/env node
/**
 * scripts/write-sides-batch.js
 *
 * Writes the pre-written side-dish recipes in scripts/sides-batch-data.json into
 * one user's review queue at users/{uid}/recipeQueue.
 *
 * PURE DATA WRITE: no AI Gateway calls, no generateAIObject, no HTTP requests to
 * the deployed app. The recipe content is authored in the JSON file; this script
 * only maps it onto the QueuedRecipe shape (lib/queue.ts) and writes it.
 *
 *   node scripts/write-sides-batch.js --dry-run   # validate + preview, no writes
 *   node scripts/write-sides-batch.js             # write to Firestore
 *   node scripts/write-sides-batch.js --force     # write even if the batch already exists
 *
 * Re-running without --force is refused when documents carrying this batch tag are
 * already present, so an accidental second run cannot silently double the queue.
 *
 * Field mapping — from the JSON file: title, description, cuisine, category,
 * servings, prepTime, cookTime, ingredients, instructions. Added here: imageURL
 * (always blank — no image sourcing), sourceURL, status, createdAt, generatedBatch.
 *
 * NOTE: `createdAt` must be a real Firestore Timestamp. The queue UI reads with
 * orderBy('createdAt', 'desc'), so a doc with a string — or with the field missing —
 * sorts wrong or does not appear in the queue at all.
 */

const fs = require('fs')
const path = require('path')
// NOTE: only `loadEnv` is reused from ./_lib. Its `getAdmin()` calls the legacy
// namespaced API (admin.apps / admin.credential), which firebase-admin v14 no
// longer exports from the CJS root — so this script initialises via the modular
// subpath entry points instead. See the report/PRD note about _lib.js.
const { loadEnv } = require('./_lib')
const { initializeApp, cert, getApps } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { getAuth } = require('firebase-admin/auth')

const DATA_FILE = path.join(__dirname, 'sides-batch-data.json')
const TARGET_UID = 'eR9gJQK1eBflP9syhPRtPbiF6Kh2'
const BATCH_TAG = 'sides-american-veg-2026-08'
const SOURCE_URL = 'AI-generated — gap fill batch'

const DRY_RUN = process.argv.includes('--dry-run')
const FORCE = process.argv.includes('--force')

/** Fields the JSON file must supply, with their expected types. */
const STRING_FIELDS = ['title', 'description', 'cuisine', 'category', 'servings', 'prepTime', 'cookTime']
const ARRAY_FIELDS = ['ingredients', 'instructions']

/** Validate the whole file up front — a malformed entry aborts before any write. */
function loadAndValidate() {
  if (!fs.existsSync(DATA_FILE)) {
    throw new Error(`Data file not found: ${DATA_FILE}`)
  }
  let entries
  try {
    entries = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
  } catch (err) {
    throw new Error(`Data file is not valid JSON: ${err.message}`)
  }
  if (!Array.isArray(entries)) throw new Error('Data file must contain a JSON array')
  if (entries.length === 0) throw new Error('Data file array is empty')

  const problems = []
  entries.forEach((entry, i) => {
    const label = entry && entry.title ? `"${entry.title}"` : `index ${i}`
    if (!entry || typeof entry !== 'object') {
      problems.push(`${label}: not an object`)
      return
    }
    for (const field of STRING_FIELDS) {
      const value = entry[field]
      if (typeof value !== 'string') problems.push(`${label}: ${field} is ${typeof value}, expected string`)
      else if (!value.trim()) problems.push(`${label}: ${field} is empty`)
    }
    for (const field of ARRAY_FIELDS) {
      const value = entry[field]
      if (!Array.isArray(value)) problems.push(`${label}: ${field} is ${typeof value}, expected array`)
      else if (value.length === 0) problems.push(`${label}: ${field} is empty`)
      else if (!value.every((s) => typeof s === 'string' && s.trim())) {
        problems.push(`${label}: ${field} contains non-string or blank members`)
      }
    }
  })
  if (problems.length) {
    throw new Error(`Data file failed validation (${problems.length} problem(s)):\n  - ${problems.join('\n  - ')}`)
  }
  return entries
}

/** Map one JSON entry onto the QueuedRecipe shape from lib/queue.ts. */
function toQueueDoc(entry) {
  return {
    title: entry.title,
    description: entry.description,
    cuisine: entry.cuisine,
    category: entry.category,
    servings: entry.servings,
    prepTime: entry.prepTime,
    cookTime: entry.cookTime,
    ingredients: entry.ingredients,
    instructions: entry.instructions,
    imageURL: '',
    sourceURL: SOURCE_URL,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    generatedBatch: BATCH_TAG,
  }
}

async function main() {
  loadEnv()
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY,
      }),
    })
  }
  const db = getFirestore()

  const entries = loadAndValidate()
  console.log(`Data file:  ${DATA_FILE}`)
  console.log(`Entries:    ${entries.length} (validated)`)
  console.log(`Batch tag:  ${BATCH_TAG}`)
  console.log(`Mode:       ${DRY_RUN ? 'DRY RUN (no writes)' : 'WRITE'}\n`)

  // Confirm the target account before touching anything.
  let user
  try {
    user = await getAuth().getUser(TARGET_UID)
  } catch (err) {
    throw new Error(`Target UID ${TARGET_UID} does not resolve to a Firebase Auth user: ${err.message}`)
  }
  console.log(`Target user: ${TARGET_UID}`)
  console.log(`             ${user.email} (${user.displayName || 'no display name'})`)
  if (user.disabled) throw new Error('Target account is disabled — aborting.')

  const queueRef = db.collection('users').doc(TARGET_UID).collection('recipeQueue')

  // Idempotency guard: refuse a second run that would duplicate the batch.
  const existing = await queueRef.where('generatedBatch', '==', BATCH_TAG).get()
  console.log(`Queue:       ${(await queueRef.get()).size} doc(s) total, ${existing.size} already tagged ${BATCH_TAG}\n`)
  if (existing.size > 0 && !FORCE && !DRY_RUN) {
    throw new Error(
      `${existing.size} document(s) with generatedBatch="${BATCH_TAG}" already exist. ` +
        `Re-running would duplicate them. Delete them first, or pass --force if duplicates are intended.`
    )
  }

  let written = 0
  const failures = []
  const results = []

  for (const [i, entry] of entries.entries()) {
    const n = `${String(i + 1).padStart(2)}/${entries.length}`
    if (DRY_RUN) {
      console.log(`${n}  [dry-run] ${entry.title}`)
      results.push({ title: entry.title, id: '(dry-run)' })
      continue
    }
    try {
      const ref = await queueRef.add(toQueueDoc(entry))
      written++
      console.log(`${n}  ${entry.title} -> ${ref.id}`)
      results.push({ title: entry.title, id: ref.id })
    } catch (err) {
      // One bad write must not halt the batch.
      failures.push({ title: entry.title, error: err.message })
      console.error(`${n}  ${entry.title} -> FAILED: ${err.message}`)
      results.push({ title: entry.title, error: err.message })
    }
  }

  console.log(`\n${DRY_RUN ? 'Would write' : 'Written'}: ${DRY_RUN ? entries.length : written} / ${entries.length}`)
  if (failures.length) {
    console.log(`Failed: ${failures.length}`)
    failures.forEach((f) => console.log(`  - ${f.title}: ${f.error}`))
  }
  return results
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message}`)
  process.exit(1)
})
