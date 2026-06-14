#!/usr/bin/env node
/**
 * scripts/reaudit-homographs.js — adversarial matcher sweep (READ-ONLY).
 *
 * Replicates the engine's keyTokens + matchCanonicalStaple VERBATIM and loads the
 * REAL committed table (incl. guards). Runs adversarial ingredient phrasings to
 * find ones that WRONGLY match a staple (the "sugar snap peas" class).
 *
 * Faithfulness note: in production matchCanonicalStaple receives the POST-PARSE
 * name (parseIngredientLine strips DESCRIPTOR_WORDS first), and the guard tests
 * THAT string. So a guard term that is itself a DESCRIPTOR_WORD ('fresh','whole',
 * 'low', …) is stripped before the guard runs → ineffective. This harness mimics
 * that by stripping DESCRIPTOR_WORDS from the candidate before matching.
 */

const fs = require('fs')
const path = require('path')

// ── verbatim from lib/nutritionEngine.ts ──
const DESCRIPTOR_WORDS = new Set([
  'fresh','freshly','finely','coarsely','roughly','thinly','chopped','diced','sliced',
  'minced','grated','shredded','peeled','seeded','trimmed','halved','quartered','cut',
  'into','pieces','piece','inch','large','medium','small','extra','jumbo','ripe',
  'boneless','skinless','skin-on','bone-in','lean','reduced','sodium','low','unsalted',
  'salted','softened','melted','divided','plus','more','about','such','as','like',
  'preferably','optional','taste','needed','serving','serve','garnish','whole','a','an',
  'the','of','or','and','with','without','your','favorite','good','quality','store-bought',
  'homemade','packed','loosely','loose','heaping','level','roomtemperature','room','temperature',
])
function stem(t){ if(t.length<=3)return t; if(t.endsWith('ies'))return t.slice(0,-3)+'y'; if(t.endsWith('es')&&!t.endsWith('ses'))return t.slice(0,-2); if(t.endsWith('s'))return t.slice(0,-1); return t }
function keyTokens(name){ return name.toLowerCase().replace(/[^a-z\s-]/g,' ').split(/[\s-]+/).filter(t=>t.length>1&&!DESCRIPTOR_WORDS.has(t)).map(stem) }

// ── load real table ──
const src = fs.readFileSync(path.join(__dirname,'..','lib','canonicalStaples.ts'),'utf8')
const start = src.indexOf('= [', src.indexOf('export const CANONICAL_STAPLES'))+2
const TABLE = eval('('+src.slice(start, src.lastIndexOf(']')+1)+')')
const FDC_ALIAS_TOKENS = TABLE.map(entry=>({entry, aliasTokens: entry.aliases.map(a=>keyTokens(a)).filter(t=>t.length>0)}))

function matchCanonicalStaple(name){
  const toks = new Set(keyTokens(name)); if(toks.size===0) return null
  const lower = name.toLowerCase()
  let best=null,bestScore=0,tied=false
  for(const {entry,aliasTokens} of FDC_ALIAS_TOKENS){
    if(entry.guard && entry.guard.test(lower)) continue
    let s=0; for(const at of aliasTokens){ if(at.length>s && at.every(t=>toks.has(t))) s=at.length }
    if(s===0) continue
    if(s>bestScore){best=entry;bestScore=s;tied=false} else if(s===bestScore&&best&&entry!==best){tied=true}
  }
  return tied?null:best
}

// mimic parseIngredientLine's descriptor strip on the name passed to the matcher
function postParse(s){ return s.toLowerCase().split(/[\s-]+/).filter(w=>!DESCRIPTOR_WORDS.has(w)).join(' ') }

// candidate → what we EXPECT (correct | none/fallthrough). Flag deviations.
const CANDIDATES = [
  // sugar / butter / nut homographs
  ['sugar snap peas','none'],['snow peas','none'],['almond butter','none'],['cashew butter','none'],
  ['cocoa butter','none'],['apple butter','none'],['butter lettuce','none'],['peanut butter','peanut butter'],
  ['butter beans','butter beans'],['butternut squash','none'],
  // corn
  ['corn tortillas','none'],['corn chips','none'],['cornbread','none'],['popcorn','none'],
  ['sweet corn','corn'],['baby corn','corn?'],['creamed corn','corn?'],['corn syrup','none'],
  // rice
  ['rice noodles','egg noodles?'],['rice vinegar','none'],['fried rice','none'],['rice flour','none'],
  ['wild rice','none'],['brown rice','brown rice'],['rice paper','none'],['cauliflower rice','none'],['cauliflower','cauliflower'],
  // milk / cream
  ['chocolate milk','none'],['almond milk','none'],['oat milk','none'],['condensed milk','none'],
  ['evaporated milk','none'],['soy milk','none'],['buttermilk','buttermilk'],['coconut milk','coconut milk'],
  ['cream of mushroom soup','none?'],['ice cream','none'],['whipped cream','none?'],['sour cream','sour cream'],['heavy cream','heavy cream'],
  // egg / garlic
  ['egg whites','none'],['egg yolk','none'],['egg noodles','egg noodles'],['garlic bread','none'],['garlic powder','garlic powder'],['garlic salt','none'],
  // tomato
  ['sun-dried tomatoes','none'],['cherry tomatoes','tomato'],['tomato paste','tomato paste'],['tomato soup','none'],
  // potato
  ['sweet potato','sweet potato'],['potato chips','none'],['mashed potatoes','none'],['potato salad','none'],
  // banana / orange / fruit homographs
  ['banana pepper','none?'],['banana bread','none?'],['plantain','none'],['orange bell pepper','bell pepper'],['blood orange','orange'],
  ['orange juice','none'],['pineapple','none'],
  // lemon / lime / ginger / honey
  ['lemongrass','none'],['lemon pepper','none'],['kaffir lime leaves','none'],['ginger ale','none'],['ground ginger','ground ginger'],
  ['honey mustard','none?'],['honey garlic','none'],['honeydew','none'],
  // pasta / flour
  ['fresh pasta','none?'],['whole wheat pasta','none'],['chickpea pasta','none'],['almond flour','none'],['coconut flour','none'],
  ['whole wheat flour','whole wheat flour'],['cake flour','none'],['bread flour','bread flour'],
  // sauces / onions / broth
  ['pasta sauce','none'],['marinara sauce','none'],['fish sauce','none'],['hot sauce','none'],
  ['sweet onion','none?'],['pearl onions','none'],['green onions','green onion'],['bone broth','none?'],
]

console.log('TASK 3 — adversarial homograph sweep (post-parse name → matched staple)\n')
const surprises = []
for (const [cand, expect] of CANDIDATES) {
  const pp = postParse(cand)
  const hit = matchCanonicalStaple(pp)
  const got = hit ? hit.key : 'none'
  const exp = expect.replace('?','')
  const flexible = expect.endsWith('?')
  const ok = got === exp || (flexible)
  const mark = (got === exp) ? '   ' : (flexible ? ' ~ ' : ' ✗ ')
  if (got !== exp && !flexible) surprises.push(`${cand}  → matched "${got}"  (expected ${exp})`)
  console.log(`${mark} "${cand}"  (parse→"${pp}")  → ${got}${expect!==got&&!flexible?`   [EXPECTED ${exp}]`:''}`)
}
console.log('\n— Hard mismatches (got ≠ expected, not flagged flexible):')
if (!surprises.length) console.log('  none')
else surprises.forEach(s=>console.log('  ✗ '+s))
console.log('\nREAD-ONLY: matcher replicated verbatim; no writes, no code changes.')
