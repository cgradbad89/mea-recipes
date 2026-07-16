#!/usr/bin/env node
/**
 * update-recipe-times.js
 *
 * Reads ~/Desktop/recipes-with-times.csv (columns: id, prepTime, cookTime)
 * and bulk-updates Firestore recipe documents that currently have empty/missing
 * prepTime AND cookTime. Never overwrites existing values.
 *
 * Auth (pick one):
 *   1. gcloud auth application-default login
 *   2. export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 */

const admin = require('firebase-admin')
const fs    = require('fs')
const path  = require('path')
const os    = require('os')

// ── Init ──────────────────────────────────────────────────────────────────────
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'malignant-metro',
})

const db = admin.firestore()

// ── Helpers ───────────────────────────────────────────────────────────────────

function isEmpty(val) {
  return val === undefined || val === null || String(val).trim() === ''
}

/** Minimal CSV parser — handles quoted fields with embedded commas/newlines. */
function parseCSV(text) {
  const rows  = []
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  let i = 0

  function parseField() {
    if (lines[i] === '"') {
      i++ // opening quote
      let field = ''
      while (i < lines.length) {
        if (lines[i] === '"' && lines[i + 1] === '"') { field += '"'; i += 2 }
        else if (lines[i] === '"') { i++; break }
        else { field += lines[i++] }
      }
      return field
    }
    let field = ''
    while (i < lines.length && lines[i] !== ',' && lines[i] !== '\n') {
      field += lines[i++]
    }
    return field
  }

  while (i < lines.length) {
    const row = []
    while (true) {
      row.push(parseField())
      if (i >= lines.length || lines[i] === '\n') { i++; break }
      i++ // skip comma
    }
    if (row.some(f => f.trim() !== '')) rows.push(row)
  }
  return rows
}

// ── Main ──────────────────────────────────────────────────────────────────────
;(async () => {
  const csvPath = path.join(os.homedir(), 'Desktop', 'recipes-with-times.csv')

  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`)
    process.exit(1)
  }

  const rows = parseCSV(fs.readFileSync(csvPath, 'utf8'))
  if (rows.length < 2) {
    console.error('CSV appears empty or has no data rows.')
    process.exit(1)
  }

  // Map header names to column indices
  const header  = rows[0].map(h => h.trim().toLowerCase())
  const colID   = header.indexOf('id')
  const colPrep = header.indexOf('preptime')
  const colCook = header.indexOf('cooktime')

  if (colID === -1 || colPrep === -1 || colCook === -1) {
    console.error(`CSV must have columns: id, prepTime, cookTime (found: ${rows[0].join(', ')})`)
    process.exit(1)
  }

  const dataRows = rows.slice(1)
  console.log(`CSV rows (excluding header): ${dataRows.length}`)

  // ── Filter: skip rows with both times empty ───────────────────────────────
  const candidates = dataRows
    .map(r => ({
      id:       (r[colID]   || '').trim(),
      prepTime: (r[colPrep] || '').trim(),
      cookTime: (r[colCook] || '').trim(),
    }))
    .filter(r => r.id && !(isEmpty(r.prepTime) && isEmpty(r.cookTime)))

  console.log(`Rows with at least one time value: ${candidates.length}`)

  if (candidates.length === 0) {
    console.log('Nothing to do.')
    process.exit(0)
  }

  // ── Fetch current Firestore docs to check existing values ─────────────────
  console.log('Fetching current Firestore documents…')

  // Firestore getAll accepts DocumentReference[]
  const refs   = candidates.map(r => db.collection('recipes').doc(r.id))
  const snaps  = await db.getAll(...refs)

  const snapMap = {}
  snaps.forEach(s => { snapMap[s.id] = s })

  // ── Build update list (only where both existing fields are empty) ──────────
  const toUpdate = candidates.filter(r => {
    const snap = snapMap[r.id]
    if (!snap || !snap.exists) {
      console.warn(`  SKIP (not found): ${r.id}`)
      return false
    }
    const d = snap.data()
    return isEmpty(d.prepTime) && isEmpty(d.cookTime)
  })

  const skipped = candidates.length - toUpdate.length
  console.log(`Will update: ${toUpdate.length}  |  Skipped (already have times or not found): ${skipped}\n`)

  if (toUpdate.length === 0) {
    console.log(`Done. Updated 0 recipes, skipped ${candidates.length}.`)
    process.exit(0)
  }

  // ── Batch writes (max 500 per batch) ──────────────────────────────────────
  const BATCH_SIZE = 500
  let updated = 0

  for (let start = 0; start < toUpdate.length; start += BATCH_SIZE) {
    const chunk = toUpdate.slice(start, start + BATCH_SIZE)
    const batch = db.batch()

    for (const r of chunk) {
      const snap  = snapMap[r.id]
      const title = (snap.data().title || r.id)
      updated++
      console.log(`Updating ${updated}/${toUpdate.length}: ${title}`)

      const update = {}
      if (!isEmpty(r.prepTime)) update.prepTime = r.prepTime
      if (!isEmpty(r.cookTime)) update.cookTime  = r.cookTime
      batch.update(db.collection('recipes').doc(r.id), update)
    }

    await batch.commit()
  }

  const totalSkipped = dataRows.length - toUpdate.length
  console.log(`\nDone. Updated ${updated} recipes, skipped ${totalSkipped}.`)
})().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
