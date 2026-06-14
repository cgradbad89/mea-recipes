#!/usr/bin/env node
/**
 * scripts/reaudit-canonical.js — INDEPENDENT adversarial re-audit (READ-ONLY).
 *
 * Loads the ACTUAL committed table from lib/canonicalStaples.ts (eval of the array
 * literal — exact data, incl. guards) and, for every entry, fetches the live USDA
 * detail by the stored fdcId and checks:
 *   (a) description drift  — does fdcId still resolve to the stored description?
 *   (b) dataType           — SR Legacy / Foundation? (flag Branded/Survey)
 *   (c) macro match        — do the stored per-100g macros equal the live values NOW?
 *   (d) plain-form         — heuristic flag for sweetened/seasoned/prepared variants
 *
 * Does NOT read the committed verify-log. Re-derives from the live API.
 * No Firestore. No writes. No code changes.
 */

const fs = require('fs')
const path = require('path')
const { loadEnv } = require('./_lib')
loadEnv()
const KEY = process.env.USDA_API_KEY
if (!KEY) { console.error('USDA_API_KEY missing'); process.exit(1) }

// ── Load the real committed table ──
const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'canonicalStaples.ts'), 'utf8')
const start = src.indexOf('= [', src.indexOf('export const CANONICAL_STAPLES')) + 2
const end = src.lastIndexOf(']') + 1
// eslint-disable-next-line no-eval
const TABLE = eval('(' + src.slice(start, end) + ')')

const USDA_DETAIL = 'https://api.nal.usda.gov/fdc/v1/food'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const r1 = n => Math.round(n * 10) / 10

async function detail(fdcId) {
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(`${USDA_DETAIL}/${fdcId}?api_key=${KEY}`, { signal: AbortSignal.timeout(15000) })
      if (res.ok) return await res.json()
      if (res.status === 404) return { __notfound: true }
    } catch {}
    await sleep(400)
  }
  return null
}

// macro extraction — identical to the generator (verify-canonical-staples.js)
function macros(food) {
  const byNum = {}
  for (const n of food.foodNutrients || []) {
    const num = String(n.nutrient?.number ?? n.nutrientNumber ?? '')
    const amt = typeof n.amount === 'number' ? n.amount : (typeof n.value === 'number' ? n.value : null)
    if (num && amt != null && byNum[num] === undefined) byNum[num] = amt
  }
  const pick = (...ns) => { for (const x of ns) if (byNum[x] != null) return byNum[x]; return 0 }
  return {
    calories: Math.round(pick('208', '957', '958')),
    protein_g: r1(pick('203')), carbs_g: r1(pick('205')), fat_g: r1(pick('204')),
    fiber_g: r1(pick('291')), sugar_g: r1(pick('269', '2000')),
  }
}

// plain-form heuristic: words that suggest a non-base variant. Allowed when the
// entry legitimately is that thing (e.g. a 'sauce' key may contain "sauce").
const SUSPECT = ['sweetened','low fat','nonfat','fat free','reduced','light','imitation','substitute',
  'baby food','infant','candied','fried','breaded','seasoned','flavored','dry mix','prepared','with salt added']

const MK = ['calories','protein_g','carbs_g','fat_g','fiber_g','sugar_g']
const tol = k => (k === 'calories' ? 2 : 0.3)

;(async () => {
  const rows = []
  let flags = 0
  for (const e of TABLE) {
    const d = await detail(e.fdcId)
    await sleep(90)
    const row = { key: e.key, fdcId: e.fdcId, stored: e.description, storedType: e.dataType }
    if (!d || d.__notfound) { row.status = 'FLAG'; row.reason = d && d.__notfound ? 'fdcId 404 — NOT FOUND live' : 'detail fetch failed'; rows.push(row); flags++; continue }
    const liveDesc = d.description || ''
    const liveType = d.dataType || ''
    const live = macros(d)
    // (a) description drift
    const descMatch = liveDesc.trim().toLowerCase() === String(e.description).trim().toLowerCase()
    // (b) dataType
    const typeOK = liveType === 'SR Legacy' || liveType === 'Foundation'
    const typeMatch = liveType === e.dataType
    // (c) macro match
    const macroDiffs = MK.filter(k => Math.abs((live[k] ?? 0) - (e.per100g[k] ?? 0)) > tol(k))
    // (d) plain-form
    const dl = liveDesc.toLowerCase()
    const suspectHits = SUSPECT.filter(w => dl.includes(w))

    const problems = []
    if (!descMatch) problems.push(`DESC DRIFT: live="${liveDesc}"`)
    if (!typeOK) problems.push(`dataType=${liveType} (not SR Legacy/Foundation)`)
    else if (!typeMatch) problems.push(`dataType live=${liveType} stored=${e.dataType}`)
    if (macroDiffs.length) problems.push('MACRO MISMATCH ' + macroDiffs.map(k => `${k}: stored ${e.per100g[k]} vs live ${live[k]}`).join('; '))
    if (suspectHits.length) problems.push(`plain-form? desc has [${suspectHits.join(', ')}]`)

    row.liveDesc = liveDesc; row.liveType = liveType; row.live = live
    row.status = problems.length ? 'FLAG' : 'PASS'
    row.reason = problems.join(' | ')
    if (problems.length) flags++
    rows.push(row)
    process.stdout.write(row.status === 'PASS' ? '.' : 'x')
  }
  process.stdout.write('\n\n')

  // Output
  console.log('TASK 1 — live re-verification of all ' + TABLE.length + ' entries\n')
  console.log('entry | fdcId | live dataType | macros-match | desc-match | plain | PASS/FLAG')
  console.log('---')
  for (const r of rows) {
    if (r.status === 'PASS') continue
  }
  // print FLAGS in detail, then a compact PASS list
  const flagged = rows.filter(r => r.status === 'FLAG')
  const passed = rows.filter(r => r.status === 'PASS')
  console.log(`PASS: ${passed.length}/${rows.length}    FLAG: ${flagged.length}/${rows.length}\n`)
  if (flagged.length) {
    console.log('FLAGGED ENTRIES:')
    for (const r of flagged) console.log(`  ✗ ${r.key} (fdc ${r.fdcId}) — ${r.reason}`)
    console.log('')
  }
  // dump full machine-readable for cross-checking
  fs.writeFileSync(path.join(__dirname, 'reaudit-task1.json'), JSON.stringify(rows, null, 2))
  console.log('Full per-entry results → scripts/reaudit-task1.json')
  console.log('READ-ONLY: no writes, no code changes, USDA API reads only.')
})().catch(e => { console.error('REAUDIT ERROR:', e.stack || e); process.exit(1) })
