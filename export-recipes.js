#!/usr/bin/env node
/**
 * export-recipes.js
 *
 * Reads all documents from the `recipes` collection in the malignant-metro
 * Firestore project, filters to those missing prepTime / cookTime, and writes
 * ~/Desktop/recipes-missing-times.csv.
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

/** Return true if a field is absent, null, or an empty/whitespace string. */
function isEmpty(val) {
  return val === undefined || val === null || String(val).trim() === ''
}

/** Escape a value for CSV: wrap in quotes, double any internal quotes. */
function csvCell(val) {
  const s = val === undefined || val === null ? '' : String(val)
  return `"${s.replace(/"/g, '""')}"`
}

// ── Main ──────────────────────────────────────────────────────────────────────
;(async () => {
  console.log('Fetching recipes from malignant-metro…')

  const snap = await db.collection('recipes').get()
  console.log(`  Total documents: ${snap.size}`)

  const missing = []
  snap.forEach(doc => {
    const d = doc.data()
    if (isEmpty(d.prepTime) && isEmpty(d.cookTime)) {
      missing.push({
        id:        doc.id,
        title:     d.title      || '',
        cuisine:   d.cuisine    || '',
        category:  d.category   || '',
        sourceURL: d.sourceURL  || '',
        content:   (d.content   || '').slice(0, 500),
      })
    }
  })

  console.log(`  Recipes missing both prepTime and cookTime: ${missing.length}`)

  if (missing.length === 0) {
    console.log('Nothing to export.')
    process.exit(0)
  }

  // ── Build CSV ──────────────────────────────────────────────────────────────
  const header = ['id', 'title', 'cuisine', 'category', 'sourceURL', 'content']
  const rows   = missing.map(r => header.map(col => csvCell(r[col])).join(','))
  const csv    = [header.join(','), ...rows].join('\n') + '\n'

  // ── Write file ─────────────────────────────────────────────────────────────
  const outPath = path.join(os.homedir(), 'Desktop', 'recipes-missing-times.csv')
  fs.writeFileSync(outPath, csv, 'utf8')
  console.log(`\nExported → ${outPath}`)
})().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
