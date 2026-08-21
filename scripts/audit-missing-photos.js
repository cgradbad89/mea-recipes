#!/usr/bin/env node
/**
 * scripts/audit-missing-photos.js — READ-ONLY audit for the photo-backfill task.
 *
 * Confirms the recipe photo field (types/recipe.ts: `imageURL`) and title field
 * (`title`), queries all recipes/{id} docs, and reports which are missing a photo
 * (imageURL undefined, null, or empty string). Writes nothing.
 */
const { loadEnv, getAdmin } = require('./_lib')
loadEnv()

async function main() {
  const db = getAdmin().firestore()
  const snap = await db.collection('recipes').get()

  const total = snap.size
  const missing = []
  const present = []
  const fieldsSeen = new Set()

  snap.forEach((doc) => {
    const d = doc.data()
    Object.keys(d).forEach((k) => fieldsSeen.add(k))
    const url = d.imageURL
    const isMissing = url === undefined || url === null || String(url).trim() === ''
    if (isMissing) {
      missing.push({ id: doc.id, title: d.title || '(no title)', hasImage: d.hasImage })
    } else {
      present.push(doc.id)
    }
  })

  console.log(`Total recipes: ${total}`)
  console.log(`Missing imageURL: ${missing.length}`)
  console.log(`Present imageURL: ${present.length}`)
  console.log('')
  console.log('Sample of field names seen across docs (first 30):', [...fieldsSeen].slice(0, 30))
  console.log('')
  console.log('--- MISSING LIST (id | title | hasImage field) ---')
  missing.forEach((m) => console.log(`${m.id}\t${m.title}\t${m.hasImage}`))
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('AUDIT FAILED:', e)
  process.exit(1)
})
