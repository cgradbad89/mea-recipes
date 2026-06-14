#!/usr/bin/env node
/**
 * scripts/run-canonical-apply.js  (Batch 4-apply)
 *
 * Drives /api/nutrition-canonical-dryrun against the DEPLOYED VERCEL app (where
 * ANTHROPIC_API_KEY is present → full three-tier engine: canonical → USDA → AI).
 *
 *   node scripts/run-canonical-apply.js            # PREVIEW (dry-run on Vercel, no writes)
 *   node scripts/run-canonical-apply.js --apply    # APPLY (persists; ?apply=true)
 *
 * Small batches (Vercel function timeout) + retries. On --apply it writes the
 * revert manifest (batch4-apply-revert-manifest.json) from each written recipe's
 * captured prior nutrition, plus batch4-apply-report.md. The route ALSO writes
 * nutrition_prev on each doc (primary revert source).
 */

const fs = require('fs')
const path = require('path')
const { loadEnv, mintIdToken } = require('./_lib')

const BASE = process.env.APPLY_BASE_URL || 'https://mea-recipes.vercel.app'
const APPLY = process.argv.includes('--apply')
const LIMIT = 5
const MACROS = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g']

async function postPage(token, offset) {
  const url = `${BASE}/api/nutrition-canonical-dryrun?limit=${LIMIT}&offset=${offset}${APPLY ? '&apply=true' : ''}`
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(75000) })
      if (res.ok) return await res.json()
      const body = await res.text()
      if (res.status === 401) throw new Error('401 Unauthorized (token)')
      console.log(`   offset ${offset} attempt ${attempt + 1}: HTTP ${res.status} ${body.slice(0, 120)}`)
    } catch (e) {
      console.log(`   offset ${offset} attempt ${attempt + 1}: ${e.message}`)
    }
    await new Promise(r => setTimeout(r, 2000))
  }
  throw new Error(`page offset ${offset} failed after retries`)
}

;(async () => {
  loadEnv()
  const token = await mintIdToken()
  console.log(`${APPLY ? 'APPLY' : 'PREVIEW (dry-run)'} against ${BASE} (limit ${LIMIT})…`)

  const diffs = []
  let meta = null, offset = 0
  while (true) {
    const page = await postPage(token, offset)
    if (page.error) throw new Error(`route error: ${page.error}`)
    meta = page
    diffs.push(...page.diffs)
    const w = diffs.filter(d => d.written).length
    console.log(`  offset ${offset}: processed ${page.processed}, written so far ${w}, wouldWrite ${diffs.filter(d => d.wouldWrite).length}, remaining ${page.remainingAfterBatch}`)
    if (page.remainingAfterBatch <= 0 || page.processed === 0) break
    offset += LIMIT
  }

  const written = diffs.filter(d => d.written)
  const wouldWrite = diffs.filter(d => d.wouldWrite)
  const byReason = {}
  for (const d of diffs) if (d.skipReason) byReason[d.skipReason] = (byReason[d.skipReason] || 0) + 1
  const es = diffs.find(d => d.recipeId === 'easy-spaghetti-with-meat-sauce')

  // confidence distribution AFTER (written → proposed conf; others keep old)
  const confAfter = {}
  for (const d of diffs) {
    if (d.error) continue
    const c = d.written ? d.proposed.confidence : (d.old?.confidence ?? 'none')
    confAfter[c] = (confAfter[c] || 0) + 1
  }

  // ── Revert manifest (apply only) ──
  if (APPLY) {
    const manifest = { generatedAt: new Date().toISOString(), base: BASE, count: written.length, recipes: {} }
    for (const d of written) {
      manifest.recipes[d.recipeId] = {
        title: d.title,
        prev: d.prevCaptured,                 // restore nutrition = this
        appliedProposed: { source: d.proposed.source, confidence: d.proposed.confidence, servings: d.proposed.servings, total: d.proposed.total, perServing: d.proposed.perServing },
      }
    }
    fs.writeFileSync(path.join(__dirname, '..', 'batch4-apply-revert-manifest.json'), JSON.stringify(manifest, null, 2))
  }

  // ── Report ──
  const L = []
  L.push(`# Batch 4-apply — Canonical Staples ${APPLY ? 'APPLY' : 'PREVIEW'} Report`)
  L.push('')
  L.push(`> ${APPLY ? '**WROTE** recomputed nutrition to Firestore' : '**PREVIEW only** (dry-run on Vercel — no writes)'} via`)
  L.push(`> \`${BASE}/api/nutrition-canonical-dryrun${APPLY ? '?apply=true' : ''}\` — full three-tier engine (canonical → USDA → **AI on**, Vercel).`)
  L.push('')
  L.push('## Counts')
  L.push('')
  L.push('| metric | count |')
  L.push('|---|---|')
  L.push(`| Catalog | ${meta.catalogTotal} |`)
  L.push(`| Processed | ${diffs.length} |`)
  L.push(`| **${APPLY ? 'WRITTEN' : 'would write'}** | **${APPLY ? written.length : wouldWrite.length}** |`)
  L.push(`| skipped: no canonical hit | ${byReason['no-canonical'] || 0} |`)
  L.push(`| skipped: would downgrade confidence | ${byReason['would-downgrade'] || 0} |`)
  L.push(`| skipped: no material change | ${byReason['no-material-change'] || 0} |`)
  L.push(`| skipped: no stored total | ${byReason['no-stored-total'] || 0} |`)
  L.push(`| skipped: invalid recompute | ${byReason['invalid-recompute'] || 0} |`)
  L.push(`| skipped: parse error | ${byReason['error'] || 0} |`)
  L.push('')
  L.push('## Confidence distribution after')
  L.push('')
  for (const [c, n] of Object.entries(confAfter).sort((a, b) => b[1] - a[1])) L.push(`- ${c}: ${n}`)
  L.push('')
  L.push('## Easy Spaghetti With Meat Sauce (headline)')
  L.push('')
  if (es) {
    L.push(`- old (stored): total sugar ${es.old.total.sugar_g}, fiber ${es.old.total.fiber_g}, cal ${es.old.total.calories}, conf ${es.old.confidence}`)
    L.push(`- ${APPLY ? 'written' : 'would write'}: total sugar ${es.proposed.total.sugar_g}, fiber ${es.proposed.total.fiber_g}, cal ${es.proposed.total.calories}, conf ${es.proposed.confidence}, source ${es.proposed.source}`)
    L.push(`- decision: ${es.written ? 'WRITTEN' : es.wouldWrite ? 'would write' : 'skip (' + es.skipReason + ')'}`)
  } else L.push('- not found')
  L.push('')
  if (APPLY) {
    L.push('## Revert')
    L.push('')
    L.push(`- **Primary:** each written doc has a \`nutrition_prev\` field = its exact pre-apply nutrition. Revert = set \`nutrition = nutrition_prev\` then delete \`nutrition_prev\`.`)
    L.push(`- **Backup:** \`batch4-apply-revert-manifest.json\` (keyed by recipeId → \`prev\`) captures the same ${written.length} prior values.`)
    L.push('')
  }
  L.push('## Largest corrections written (by |sugar Δ| vs stored)')
  L.push('')
  const movers = [...(APPLY ? written : wouldWrite)].map(d => ({ ...d, sd: Math.abs((d.proposed.total.sugar_g || 0) - (d.old.total.sugar_g || 0)) })).sort((a, b) => b.sd - a.sd).slice(0, 15)
  L.push('| recipe | sugar stored→new | cal stored→new | conf old→new |')
  L.push('|---|---|---|---|')
  for (const d of movers) L.push(`| ${d.title} | ${d.old.total.sugar_g}→${d.proposed.total.sugar_g} | ${d.old.total.calories}→${d.proposed.total.calories} | ${d.old.confidence}→${d.proposed.confidence} |`)
  L.push('')
  fs.writeFileSync(path.join(__dirname, '..', 'batch4-apply-report.md'), L.join('\n') + '\n')

  console.log(`\n${APPLY ? 'WROTE' : 'would write'}: ${APPLY ? written.length : wouldWrite.length}`)
  console.log('skip reasons:', JSON.stringify(byReason))
  if (es) console.log(`Easy Spaghetti: stored sugar ${es.old.total.sugar_g} → ${APPLY ? 'WRITTEN' : 'would-be'} ${es.proposed.total.sugar_g} (conf ${es.old.confidence}→${es.proposed.confidence}, decision: ${es.written ? 'WRITTEN' : es.skipReason || 'wouldWrite'})`)
  console.log(`Wrote batch4-apply-report.md${APPLY ? ' + batch4-apply-revert-manifest.json' : ''}`)
})().catch(e => { console.error('APPLY-RUN ERROR:', e.stack || e); process.exit(1) })
