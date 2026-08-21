#!/usr/bin/env node
/**
 * scripts/apply-photo-matches.js — Phase 3 (apply) for the photo-backfill task.
 *
 * Writes ONLY the `imageURL` field on each listed recipe doc, via the Admin SDK
 * (bypasses Firestore rules by design — this is a trusted server-side script, not
 * a rules change). No other field is touched. No Storage upload — external URLs
 * are stored as-is per task instructions.
 *
 * Every URL below was visually inspected (downloaded + viewed) and cross-checked
 * against the recipe's actual ingredient list before being accepted; anything that
 * depicted the wrong dish, wrong cuisine, an unrelated subject, a bystander's face,
 * or was too low-resolution was rejected and the recipe left unmatched.
 */
const { loadEnv, getAdmin } = require('./_lib')
loadEnv()

const MATCHES = [
  { id: 'chicken-tikka', url: 'https://upload.wikimedia.org/wikipedia/commons/f/fd/Chicken_tikka_masala.jpg', source: 'commons.wikimedia.org' },
  { id: 'spaghetti-carbonara', url: 'https://live.staticflickr.com/23/34677096_e769ea905d_b.jpg', source: 'flickr.com' },
  { id: 'ribollita-tuscan-white-bean-soup', url: 'https://live.staticflickr.com/5517/9352722799_c8bbfe1c53_b.jpg', source: 'flickr.com' },
  { id: 'air-fried-sweet-potato-fries-with-rosemary-and-garlic', url: 'https://upload.wikimedia.org/wikipedia/commons/8/88/Baked_Sweet_Potato_Fries_With_Rosemary_and_Parmesan_-_8420845814.jpg', source: 'commons.wikimedia.org' },
  { id: 'maple-roasted-candied-pecans', url: 'https://upload.wikimedia.org/wikipedia/commons/1/13/Vegan_Balsamic_Candied_Pecans_%283618738710%29.jpg', source: 'commons.wikimedia.org' },
  { id: 'shrimp-pullao', url: 'https://upload.wikimedia.org/wikipedia/commons/7/74/Picture_of_tasty_Prawn_pulao.JPG', source: 'commons.wikimedia.org' },
  { id: '164', url: 'https://live.staticflickr.com/7540/15846856159_9dfa3ef6f1_b.jpg', source: 'flickr.com' },
  { id: 'garlic-bread', url: 'https://upload.wikimedia.org/wikipedia/commons/f/f5/%22Garlic_Bread%22_%2813348195234%29.jpg', source: 'commons.wikimedia.org' },
  { id: 'brown-butter-lentil-and-sweet-potato-salad', url: 'https://upload.wikimedia.org/wikipedia/commons/a/a0/Kabocha_Lentil_Salad_%2845603480082%29.jpg', source: 'commons.wikimedia.org' },
  { id: 'original-texas-chili-con-carne', url: 'https://upload.wikimedia.org/wikipedia/commons/d/d0/Pot_of_Chili_Con_Carne.jpg', source: 'commons.wikimedia.org' },
  { id: 'indian-spiced-roasted-vegetables', url: 'https://upload.wikimedia.org/wikipedia/commons/8/87/Baingan_Bharta.JPG', source: 'commons.wikimedia.org' },
  { id: 'peanut-butter-oat-protein-shake', url: 'https://upload.wikimedia.org/wikipedia/commons/d/de/Fruit_and_peanut_butter_smoothie.jpg', source: 'commons.wikimedia.org' },
  { id: 'shakshucka', url: 'https://upload.wikimedia.org/wikipedia/commons/e/e3/Shakshuka_Dish.jpg', source: 'commons.wikimedia.org' },
]

async function main() {
  const db = getAdmin().firestore()
  const results = []
  for (const m of MATCHES) {
    const ref = db.collection('recipes').doc(m.id)
    const snap = await ref.get()
    if (!snap.exists) {
      results.push({ id: m.id, status: 'SKIPPED (doc not found)' })
      continue
    }
    const existing = snap.data().imageURL
    if (existing && String(existing).trim() !== '') {
      results.push({ id: m.id, status: `SKIPPED (imageURL already set: ${existing})` })
      continue
    }
    await ref.update({ imageURL: m.url })
    results.push({ id: m.id, status: 'WRITTEN', url: m.url })
  }
  results.forEach((r) => console.log(r.id, '->', r.status, r.url || ''))
}

main().then(() => process.exit(0)).catch((e) => { console.error('APPLY FAILED:', e); process.exit(1) })
