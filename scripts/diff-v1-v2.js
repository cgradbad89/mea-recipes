#!/usr/bin/env node
/**
 * scripts/diff-v1-v2.js — compare v1 vs v2 canonical resolutions (READ-ONLY).
 * Confirms the 16 flagged regressions are gone and surfaces any NEW canonical
 * match in v2 (gained/changed) for new-regression review. No writes.
 */
const fs = require('fs'), path = require('path')
const v1 = require('./canonical-dryrun-v1-raw.json')
const v2 = require('./canonical-dryrun-v2-raw.json')

// per recipe → Map(ingredient → matched staple description) for canonical hits
function hitMap(raw) {
  const m = {}
  for (const d of raw.diffs) {
    const mm = new Map()
    for (const rc of (d.resolutionChanges || [])) mm.set(rc.ingredient, rc.after.description)
    m[d.title] = mm
  }
  return m
}
const H1 = hitMap(v1), H2 = hitMap(v2)
const titles = [...new Set([...Object.keys(H1), ...Object.keys(H2)])]

// GAINED / CHANGED canonical hits in v2 (risk of new regression), and LOST (the fixes)
const gained = [], changed = [], lost = []
for (const t of titles) {
  const a = H1[t] || new Map(), b = H2[t] || new Map()
  for (const [ing, staple] of b) {
    if (!a.has(ing)) gained.push({ t, ing, v2: staple })
    else if (a.get(ing) !== staple) changed.push({ t, ing, v1: a.get(ing), v2: staple })
  }
  for (const [ing, staple] of a) if (!b.has(ing)) lost.push({ t, ing, v1: staple })
}

// The specific offending (recipe substring, ingredient substring) pairs from the re-audit
const REGRESSIONS = [
  ['Beef Brisket', 'brisket'], ['Texas-Style Chili', 'beef chuck'], ['Bulgogi', 'ribeye'],
  ['Pepper Steak', 'flank'], ['Pot Roast', 'gravy mix'], ['BBQ Pulled Pork', 'pork shoulder'],
  ['Carnitas', 'pork butt'], ['Pulled pork', 'pork shoulder'], ['Posole', 'pork shoulder'],
  ['Paprikash', 'pork lard'], ['Pork Fried Rice', 'pork'],
  ['Mediterranean Grilled Salmon', 'tomato in half'], ['Mediterranean Grilled Salmon', 'lemon- in half'],
  ['Chicken Gyro', 'horizontally in half'], ['Smashed Zucchini', 'half-moons'],
  ['Minnesota Pork Chop', 'cream mushroom soup'],
]
console.log('=== Confirm the 16 flagged regressions are gone in v2 ===\n')
let stillBad = 0
for (const [rt, it] of REGRESSIONS) {
  const t = titles.find(x => x.includes(rt))
  if (!t) { console.log(`  ? ${rt} :: ${it} — recipe not found`); continue }
  const v2hit = [...(H2[t] || new Map())].find(([ing]) => ing.toLowerCase().includes(it.toLowerCase()))
  const v1hit = [...(H1[t] || new Map())].find(([ing]) => ing.toLowerCase().includes(it.toLowerCase()))
  if (v2hit) { stillBad++; console.log(`  ✗ ${rt} :: "${it}" STILL canonical-hits → ${v2hit[1]}`) }
  else console.log(`  ✓ ${rt} :: "${it}" — no longer a canonical hit (v1 was → ${v1hit ? v1hit[1] : '?'}); falls through to fuzzy`)
}
console.log(`\n  ${stillBad === 0 ? 'ALL 16 regressions resolved.' : stillBad + ' STILL BAD'}`)

console.log('\n=== NEW or CHANGED canonical hits in v2 (review for new regressions) ===\n')
console.log(`gained (ingredient newly canonical in v2): ${gained.length}`)
// summarize gained by (ingredient → staple) unique pairs
const gp = {}
for (const g of gained) { const k = g.ing.toLowerCase() + ' => ' + g.v2; gp[k] = (gp[k] || 0) + 1 }
Object.entries(gp).sort().forEach(([k, n]) => console.log(`   (${n}x) ${k}`))
console.log(`\nchanged (canonical target changed v1→v2): ${changed.length}`)
changed.slice(0, 40).forEach(c => console.log(`   [${c.t}] "${c.ing}"  ${c.v1}  →  ${c.v2}`))

console.log(`\nlost (canonical hit in v1, gone in v2 — the fixes): ${lost.length}`)

// Easy Spaghetti preserved?
const es = v2.diffs.find(d => d.recipeId === 'easy-spaghetti-with-meat-sauce')
if (es) console.log(`\nEasy Spaghetti v2: total sugar ${es.proposed.total.sugar_g} (v1 was 14.8), fiber ${es.proposed.total.fiber_g}, source ${es.proposed.source}`)

// population
console.log(`\nv2 population: catalog ${v2.meta?.catalogTotal} · affected ${v2.diffs.filter(d=>d.affected).length} · changed ${v2.diffs.filter(d=>d.changed).length} · errors ${v2.diffs.filter(d=>d.error).length}`)
