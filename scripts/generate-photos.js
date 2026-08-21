#!/usr/bin/env node
/**
 * scripts/generate-photos.js — Feature Set 1 (AI-generated fallback photos).
 *
 * NOT YET RUN — blocked. As of 2026-08-21, Firebase Storage is not provisioned
 * for the `malignant-metro` project: neither `malignant-metro.firebasestorage.app`
 * nor the legacy `malignant-metro.appspot.com` bucket exists (`bucket.exists()`
 * returns false for both), even though `lib/firebase.ts` declares a storageBucket.
 * Enabling Storage is a project-level/console step (and may be billing-relevant)
 * on a project shared across multiple apps — not something this script should do
 * itself. See PRD.md Known Sharp Edges. Once Storage is enabled, this script
 * should run as-is against the 18 unmatched recipe ids below.
 *
 * For each of the 18 recipes that had no acceptable real-photo match in the
 * earlier Wikimedia/Openverse backfill, generates one realistic food-photography
 * image via the Vercel AI Gateway (openai/gpt-image-2, the same gateway/auth
 * lib/ai.ts already uses for text), uploads it to Firebase Storage at
 * `recipe-images/{docId}.png`, and writes the resulting permanent download URL
 * into `recipes/{docId}.imageURL` via the Admin SDK. No other field is touched.
 *
 * Prompts are hand-written per recipe from that recipe's actual ingredient list
 * (pulled straight from each recipe doc's `content` field) so the image matches
 * the dish, rather than relying on the title alone.
 *
 * One retry on a failed generation; a recipe that fails both attempts is left
 * untouched and reported in the "failed" list — the run continues regardless.
 */
const path = require('path')
const { loadEnv, getAdmin } = require('./_lib')
loadEnv()

const STYLE_SUFFIX =
  ', realistic professional food photography, natural light, appetizing, shallow depth of field, no text, no watermark, no illustration or cartoon style'

const RECIPES = [
  {
    id: '163',
    prompt: 'A bowl of hearty American chili con carne with ground beef, red kidney beans and cannellini beans in a thick tomato sauce, topped with shredded cheddar cheese and sliced scallions, rustic ceramic bowl, top-down view' + STYLE_SUFFIX,
  },
  {
    id: 'dads-chili',
    prompt: 'A rustic bowl of dark reddish-brown beef chili con carne with tender chunks of beef (no beans) in a thick glossy chili sauce, steam rising, garnished with a few cilantro leaves' + STYLE_SUFFIX,
  },
  {
    id: 'easy-spaghetti-with-meat-sauce',
    prompt: 'A plate of spaghetti twirled and tossed with a rich ground beef and tomato meat sauce, topped with grated Parmesan cheese and a small basil leaf, white plate' + STYLE_SUFFIX,
  },
  {
    id: 'garlic-herb-shrimp-with-white-beans-and-spinach',
    prompt: 'A skillet of garlic butter shrimp with white cannellini beans and wilted spinach, lemon wedges and fresh chopped parsley on top, rustic cast iron skillet' + STYLE_SUFFIX,
  },
  {
    id: 'hearthealthy-peanut-butter-protein-bars',
    prompt: 'Stacked homemade peanut butter oat protein bars cut into rectangles, visible rolled oats and chopped walnuts in the bars, sitting on parchment paper' + STYLE_SUFFIX,
  },
  {
    id: 'italian-sausage-and-white-bean-salad',
    prompt: 'A hearty salad in a wide bowl with sliced grilled Italian sausage, white cannellini beans, arugula, halved cherry tomatoes, Kalamata olives and cubes of fresh mozzarella' + STYLE_SUFFIX,
  },
  {
    id: 'japanese-cold-soba-noodle-salad',
    prompt: 'A cold Japanese soba noodle salad in a bowl with edamame, shredded red cabbage, julienned carrots and cucumber, scallions and a sprinkle of sesame seeds, chopsticks resting beside the bowl' + STYLE_SUFFIX,
  },
  {
    id: 'korean-bulgogi-beef-bowls',
    prompt: 'A Korean bulgogi beef rice bowl: thinly sliced caramelized marinated beef over white rice, with julienned cucumber, carrots and bean sprouts, sesame seeds and sliced scallions on top' + STYLE_SUFFIX,
  },
  {
    id: 'lebanese-lemon-garlic-chicken-thighs',
    prompt: 'Seared boneless chicken thighs with a golden turmeric-and-cumin spiced crust, garnished with lemon wedges and chopped parsley, small side of yogurt sauce, on a plate' + STYLE_SUFFIX,
  },
  {
    id: 'mole-poblano',
    prompt: 'Chicken pieces smothered in rich dark brown mole poblano sauce, a light sprinkle of sesame seeds on top, served on a plate with a small side of white rice' + STYLE_SUFFIX,
  },
  {
    id: 'moroccan-spiced-carrot-and-chickpea-soup',
    prompt: 'A bowl of Moroccan spiced carrot and chickpea soup with a deep orange-red color from cumin, cinnamon and turmeric, garnished with a swirl of plain yogurt and fresh cilantro leaves' + STYLE_SUFFIX,
  },
  {
    id: 'onepot-beans-greens-and-grains',
    prompt: 'A bowl of glossy garlicky beans, wilted dark leafy greens and fluffy grains (rice and quinoa) mixed together, garnished with a lemon wedge' + STYLE_SUFFIX,
  },
  {
    id: 'pulled-pork',
    prompt: 'A pile of glossy shredded pulled pork tossed in barbecue sauce, served on a wooden cutting board' + STYLE_SUFFIX,
  },
  {
    id: 'sheet-pan-kielbasa-with-cabbage-and-beans',
    prompt: 'A sheet pan with sliced roasted smoked kielbasa, caramelized Savoy cabbage wedges and white beans tossed in a dill vinaigrette' + STYLE_SUFFIX,
  },
  {
    id: 'smashed-cucumber-edamame-rice-bowl',
    prompt: 'A rice bowl with smashed cucumber pieces, edamame, sliced avocado, scallions and sesame seeds over warm rice with a glossy sesame-soy dressing' + STYLE_SUFFIX,
  },
  {
    id: 'suadero-tacos',
    prompt: 'Mexican suadero beef street tacos on small corn tortillas, topped with diced white onion and chopped cilantro, a small dish of red salsa on the side' + STYLE_SUFFIX,
  },
  {
    id: 'tamales-chicken',
    prompt: 'Chicken tamales wrapped in corn husks, one tamale partially unwrapped showing the masa and shredded chicken filling with red salsa, arranged on a plate' + STYLE_SUFFIX,
  },
  {
    id: 'traditional-southern-butter-butter-beans-recipe',
    prompt: 'A rustic bowl of Southern-style butter beans (large lima beans) simmered with bacon, onion and diced tomatoes in a savory broth' + STYLE_SUFFIX,
  },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function generateOnce(prompt) {
  const { generateImage } = require('ai')
  const { gateway } = require('@ai-sdk/gateway')
  const result = await generateImage({
    model: gateway.imageModel('openai/gpt-image-2'),
    prompt,
    size: '1024x1024',
  })
  return result.images[0]
}

async function generateWithRetry(prompt) {
  try {
    return { image: await generateOnce(prompt), attempts: 1 }
  } catch (e1) {
    console.warn('  attempt 1 failed:', e1.message || e1)
    await sleep(2000)
    try {
      return { image: await generateOnce(prompt), attempts: 2 }
    } catch (e2) {
      console.warn('  attempt 2 failed:', e2.message || e2)
      return { image: null, attempts: 2, error: e2.message || String(e2) }
    }
  }
}

async function main() {
  const db = getAdmin().firestore()
  const bucket = getAdmin().storage()
  const { getDownloadURL } = require('firebase-admin/storage')

  const results = []
  for (const recipe of RECIPES) {
    process.stderr.write(`Generating: ${recipe.id} ...\n`)
    const { image, attempts, error } = await generateWithRetry(recipe.prompt)

    if (!image) {
      results.push({ id: recipe.id, status: 'FAILED', attempts, error })
      continue
    }

    const storagePath = `recipe-images/${recipe.id}.png`
    const file = bucket.file(storagePath)
    const buffer = Buffer.from(image.base64, 'base64')
    const downloadToken = require('crypto').randomUUID()
    await file.save(buffer, {
      metadata: {
        contentType: image.mediaType || 'image/png',
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
    })
    const url = await getDownloadURL(file)

    await db.collection('recipes').doc(recipe.id).update({ imageURL: url })

    results.push({ id: recipe.id, status: 'WRITTEN', attempts, url, storagePath })
    await sleep(500)
  }

  console.log('\n=== RESULTS ===')
  results.forEach((r) => {
    console.log(r.id, '->', r.status, `(attempts: ${r.attempts})`, r.url || r.error || '')
  })

  const failed = results.filter((r) => r.status === 'FAILED')
  console.log(`\nWritten: ${results.length - failed.length} / ${results.length}`)
  console.log(`Failed: ${failed.length}`)
  if (failed.length) console.log('Failed IDs:', failed.map((f) => f.id).join(', '))

  require('fs').writeFileSync(
    path.join(__dirname, 'generate-photos-results.json'),
    JSON.stringify(results, null, 2),
  )
}

main().then(() => process.exit(0)).catch((e) => { console.error('RUN FAILED:', e); process.exit(1) })
