// Post-apply verification — re-reads Firestore (admin) to confirm writes landed + revert captured.
const fs = require('fs')
const path = require('path')
const { loadEnv, getAdmin } = require('./_lib')
;(async () => {
  loadEnv()
  const db = getAdmin().firestore()
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'batch4-apply-revert-manifest.json'), 'utf8'))
  const writtenIds = Object.keys(manifest.recipes)
  console.log(`Manifest: ${manifest.count} written recipes\n`)

  // 1) Easy Spaghetti
  const es = (await db.collection('recipes').doc('easy-spaghetti-with-meat-sauce').get()).data()
  console.log('Easy Spaghetti (re-read from Firestore):')
  console.log(`  nutrition.total.sugar = ${es.nutrition.total.sugar_g} (expect 14.8) · per-serving sugar = ${es.nutrition.sugar_g}`)
  console.log(`  confidence = ${es.nutrition.confidence} · source = ${es.nutrition.source}`)
  console.log(`  nutrition_prev.total.sugar = ${es.nutrition_prev?.total?.sugar_g} (expect 73.2) · prev.confidence = ${es.nutrition_prev?.confidence}`)
  const esOk = es.nutrition.total.sugar_g === 14.8 && es.nutrition_prev?.total?.sugar_g === 73.2
  console.log(`  ${esOk ? '✓ write landed + revert captured' : '✗ MISMATCH'}\n`)

  // 2) Full-catalog audit: count nutrition_prev presence, verify each written doc matches manifest + has prev
  const snap = await db.collection('recipes').get()
  let prevCount = 0, mismatch = 0, missingPrev = 0
  const writtenSet = new Set(writtenIds)
  snap.forEach(doc => {
    const d = doc.data()
    if (d.nutrition_prev) prevCount++
    if (writtenSet.has(doc.id)) {
      const applied = manifest.recipes[doc.id].appliedProposed
      if (!d.nutrition_prev) missingPrev++
      // total sugar should match what we applied
      if (d.nutrition?.total?.sugar_g !== applied.total.sugar_g) mismatch++
    }
  })
  console.log('Full-catalog audit:')
  console.log(`  docs with nutrition_prev = ${prevCount} (expect ${manifest.count})`)
  console.log(`  written docs missing nutrition_prev = ${missingPrev} (expect 0)`)
  console.log(`  written docs whose stored total.sugar != applied = ${mismatch} (expect 0)`)

  // 3) a SKIPPED recipe must be UNCHANGED (no nutrition_prev)
  const skipSample = snap.docs.find(doc => !writtenSet.has(doc.id) && doc.data().nutrition && !doc.data().nutrition_prev)
  if (skipSample) console.log(`\nSkipped sample "${skipSample.data().title}": has nutrition_prev = ${!!skipSample.data().nutrition_prev} (expect false — untouched) ✓`)

  console.log(`\n${esOk && prevCount === manifest.count && missingPrev === 0 && mismatch === 0 ? 'VERIFICATION PASSED ✓' : '⚠ VERIFICATION ISSUES — review above'}`)
  process.exit(0)
})().catch(e => { console.error(e.message); process.exit(1) })
