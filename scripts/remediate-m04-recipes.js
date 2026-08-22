#!/usr/bin/env node
/**
 * Guarded one-time M-04 recipe-content remediation.
 *
 * Default mode is read-only. Pass --apply to back up and mutate only the exact
 * recipes declared below. This script never computes or writes nutrition.
 */

const fs = require('fs')
const path = require('path')
const { createHash } = require('crypto')
const { loadEnv, getAdmin } = require('./_lib')

const APPLY = process.argv.includes('--apply')
const BACKUP_PATH = path.join(__dirname, '..', 'docs', 'audits', 'm04-recipe-data-backup-2026-08-22.json')

function slugify(text) {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

const repairs = [
  {
    oldId: 'bread',
    title: 'Bread!',
    expectedContent: 'https://pinchofyum.com/no-knead-bread#tasty-recipes-42994\n \n\n 3 cups all purpose flour\n 1 1/2 teaspoons salt\n 1/2 teaspoon instant yeast\n 1 1/2 cups room temperature water',
    content: `https://pinchofyum.com/no-knead-bread#tasty-recipes-42994
INGREDIENTS
3 cups all purpose flour
1 1/2 teaspoons salt
1/2 teaspoon instant yeast
1 1/2 cups room temperature water
INSTRUCTIONS
In a large mixing bowl, whisk the flour, salt, and yeast together until mixed. Stir in the water until a chunky, thick dough forms. If it needs a little more water, add a few more tablespoons, just enough to get it barely wet throughout. It’s gonna look scrappy and weird and you’re going to question me on whether or not this will work, but it will. Cover the mixing bowl with plastic wrap and let it rest for 12-18 hours at room temperature.
When you’re ready to bake, preheat the oven to 450. Stick a 6 quart enamel coated cast iron Lodge Dutch Oven (or similar) in the oven for about 30 minutes to heat. At this point, the dough should be big and puffy and pretty loose, with little bubbles in it. Gently scrape the dough out onto a well-floured surface. (Remember: NO KNEAD.) Gently shape it into a ball with flour on the outside, set on a piece of parchment, and cover with plastic while your pan heats up.
Remove the plastic from the dough. Lift the dough and parchment together into the pan so the parchment lines the bottom of the hot pan (be careful not to touch the pan since it’s very hot). Bake, covered, for 30 minutes. Remove the cover and bake another 10-15 minutes to get the exterior nice and golden brown and crispy. Voila! Done. Miracle no-knead bread, you boss you.`,
    evidence: 'Current source URL, fetched through /api/fetch-recipe; embedded Recipe JSON-LD.',
  },
  {
    oldId: 'chicken-chickpea-salad',
    title: 'Chicken Chickpea Salad',
    expectedContentSha256: 'a4ea73a2aab569d8264ea12f7b3112b6171b5065c61508363a403b5fce0f3de3',
    content: `https://cooking.nytimes.com/recipes/1024989-chickpea-chicken-salad-with-green-harissa-dressing
INGREDIENTS
For the Green Harissa Dressing
4 to 5 green chiles, such as jalapeño or serrano
¼ cup Greek yogurt
1 ½ teaspoons ground cumin
5 tablespoons extra-virgin olive oil
2 garlic cloves, pressed or finely chopped
2 tablespoons lemon juice
½ teaspoon honey
½ teaspoon fine sea salt
¼ teaspoon black pepper
For the Chickpeas
2 tablespoons extra virgin olive oil
1(14-ounce) can chickpeas, drained
1 teaspoon ground cumin
1 teaspoon sweet paprika
½ teaspoon fine sea salt
¼ teaspoon chile powder, such as ground cayenne (optional)
For the Salad
2 cups arugula or rocket
½ cup roughly torn fresh cilantro leaves, and more for garnish
2 heaping cups boneless cooked chicken (such as rotisserie, grilled or poached), roughly chopped or torn and seasoned lightly with salt
½ cup cherry-tomato halves, seasoned lightly with salt
½ cup pitted Kalamata or Castelvetrano olives
INSTRUCTIONS
Step 1
Prepare the dressing: If you have a gas range, turn burner to medium high. Use tongs to hold a green chile carefully about 1 to 2 inches over the open flame for about 60 seconds on each side until the skin is charred. Repeat the same process for each green chile. Alternatively, you can also roast the chiles in the oven under the broiler for 3 to 5 minutes on each side until their skin is charred.
Step 2
Let the chiles rest until they’re cool enough to handle, then use your hands or a butter knife to roughly remove the skins and seeds from the chiles, discard, then chop the flesh very finely with a knife.
Step 3
In a medium mixing bowl, combine the chopped chiles, Greek yogurt, cumin, olive oil, garlic, lemon juice, honey, salt and black pepper. If the consistency of the dressing seems too thick, don’t hesitate to add in a tablespoon or two of water to loosen it. Taste and adjust the seasoning with more salt if necessary.
Step 4
Make the chickpeas: Heat the olive oil in a medium (10-inch) skillet over low. Add the chickpeas, cumin, paprika, salt and chile powder, if using. Cover with a lid and let cook until the chickpeas are warm and soft, about 5 to 7 minutes. Remove from the heat and keep on the side, covered, until ready to serve.
Step 5
Assemble the salad: In a large shallow bowl, arrange the arugula and cilantro. Scatter the chicken and the chickpeas on top of the leaves. Top with the tomatoes and olives. Garnish with more cilantro. Serve with the dressing on top or on the side.`,
    evidence: 'Existing production content only; lines reordered and headings added.',
  },
  {
    oldId: 'chicken-meatballs-with-peppers-and-orzo',
    title: 'Chicken Meatballs with Peppers and Orzo',
    expectedContent: 'https://pinchofyum.com/chicken-meatballs-with-peppers-and-orzo',
    content: `https://pinchofyum.com/chicken-meatballs-with-peppers-and-orzo
INGREDIENTS
1 pound ground turkey or chicken
1 egg
1/2 cup panko
1/2 cup grated Parmesan
1/2 teaspoon each garlic powder, onion powder, and kosher salt
2 large cloves garlic, minced
1-2 cups sliced peppers (see notes)
1/4 cup capers (optional)
one 14-ounce can plain tomato sauce
1 teaspoon kosher salt (more or less to taste)
8 ounces uncooked orzo
1/4 cup of something creamy – I used mascarpone, but you could also use cream cheese, goat cheese, cream, or butter
kosher salt, Parmesan, and parsley for finishing
INSTRUCTIONS
Mix meatball ingredients together. Roll into meatballs. Heat a skillet over medium high heat. Add a swizzle of olive oil. Add meatballs and cook until browned on all sides. Remove from pan and set aside. (Alternatively, you can bake the meatballs – fresh or frozen – at 400 degrees for 25-30 minutes.)
Add peppers and garlic to the same pan, plus a little more oil if you need it. Get all the yummy browned bits off the bottom of the pan. Sauté for 5-10 minutes.
Add meatballs into the pan. Stir in tomato sauce and capers. Bring to a low simmer and let it hang out (add a little water if it gets too dry).
Cook orzo according to package directions. Drain and toss with something creamy. Season with salt, Parmesan, and parsley.
Plate and serve! Top with more Parmesan and parsley because you are just that fancy.`,
    evidence: 'Current source URL, fetched through /api/fetch-recipe; embedded Recipe JSON-LD.',
  },
  {
    oldId: 'chinese-chili-oil',
    title: 'Chinese Chili Oil',
    expectedContent: 'https://redhousespice.com/chinese-chilli-oil/',
    content: `https://redhousespice.com/chinese-chilli-oil/
INGREDIENTS
¼ cup chili flakes
1 tablespoon ground chili (see note 1 & 2)
½ teaspoon salt
2 tablespoon sesame seeds (toasted)
1 teaspoon black rice vinegar (or soy sauce)
1 cup cooking oil
1 teaspoon whole Sichuan peppercorn (See note 3)
1 teaspoon fennel seeds
1 star anise
1 piece cassia cinnamon (aka Chinese cinnamon)
2 bay leaves
1 Tsao-ko (aka Chinese black cardamom (optional))
3 slices ginger
2 stalks scallions (aka green onion, spring onion)
INSTRUCTIONS
In a small bowl, mix chili flakes, ground chili, salt, sesame seeds and black rice vinegar (or soy sauce). Have another deep, dry, heat-proof bowl ready (see note 4). Place a fine mesh strainer over it.
Pour oil into a small pan/pot. Add all the spices and aromatics. Simmer over low heat. Watch attentively. Turn off the heat immediately when the scallions turn brown (It took me about 20 minutes). Test the temperature with a thermometer (it needs to reach 350°F/175°C). Alternatively, drop in a few chili flakes to test. The oil is hot enough if they bubble and spin immediately.
Pour the oil into the empty bowl through the strainer. Discard everything caught in the sieve.
Add half of the chili mixture to the oil. You should see it bubbling intensively. Add the remaining when the bubbling calms down. Stir well with a clean dry spoon.
Leave to cool uncovered. Then transfer to a container of your choice. Wait for at least 12 hours before using it to allow all the flavors to combine.
Storage: The lifespan of chili oil is about 2 months in the kitchen cupboard (dry, cool and away from direct sunlight) and about 6 months in the fridge.
Usage: Both the oil and the chili flakes are for consumption. Use a clean spoon to stir well before serving. If your dish requires pure chili oil, use a strainer to filter out the chili and sesame seeds.`,
    evidence: 'Current source URL, fetched through /api/fetch-recipe; embedded Recipe JSON-LD.',
  },
  {
    oldId: 'honey-sriracha-roasted-brussels-sprouts',
    title: 'HONEY SRIRACHA ROASTED BRUSSELS SPROUTS',
    expectedContent: `https://sharedappetite.com/recipes/honey-sriracha-roasted-brussels-sprouts/
 1 ½ pounds Brussels sprouts
 2 tablespoons olive oil
 Kosher salt
 1 tablespoon sriracha
 3 tablespoons honey
 1 lime, juiced
 Preheat oven to 400°F.
 Cutt off the stem end of the sprouts and pull off any yellow outer leaves. Cut large sprouts in half.
 Place sprouts in a large bowl, drizzle with olive oil and season generously with Kosher salt. Toss to coat. Place in a single layer on an aluminum-foil lined baking sheet. Roast for 35-40 minutes, shaking the pan a few times throughout the cooking process, until crisp and golden brown on the outside and tender on the inside.
 Meanwhile, combine srircha, honey, and lime in a small bowl. Season with Kosher salt.
 Remove sprouts from oven, transfer to large bowl, and drizzle with sauce. Toss lightly to coat and serve immediately`,
    content: `https://sharedappetite.com/recipes/honey-sriracha-roasted-brussels-sprouts/
INGREDIENTS
1 ½ pounds Brussels sprouts
2 tablespoons olive oil
Kosher salt
1 tablespoon sriracha
3 tablespoons honey
1 lime, juiced
INSTRUCTIONS
Preheat oven to 400°F.
Cutt off the stem end of the sprouts and pull off any yellow outer leaves. Cut large sprouts in half.
Place sprouts in a large bowl, drizzle with olive oil and season generously with Kosher salt. Toss to coat. Place in a single layer on an aluminum-foil lined baking sheet. Roast for 35-40 minutes, shaking the pan a few times throughout the cooking process, until crisp and golden brown on the outside and tender on the inside.
Meanwhile, combine srircha, honey, and lime in a small bowl. Season with Kosher salt.
Remove sprouts from oven, transfer to large bowl, and drizzle with sauce. Toss lightly to coat and serve immediately`,
    evidence: 'Existing production content only; two headings added and whitespace normalized.',
  },
  {
    oldId: 'httpspinchofyumcomchopped-thai-shrimp-salad-with-garlic-lime-dressing',
    newId: 'chopped-thai-shrimp-salad-with-garlic-lime-dressing',
    title: 'Chopped Thai Shrimp Salad with Garlic Lime Dressing',
    expectedTitle: 'https://pinchofyum.com/chopped-thai-shrimp-salad-with-garlic-lime-dressing',
    expectedContent: 'INSTRUCTIONS\n1. https://pinchofyum.com/chopped-thai-shrimp-salad-with-garlic-lime-dressing',
    content: `https://pinchofyum.com/chopped-thai-shrimp-salad-with-garlic-lime-dressing
INGREDIENTS
1/2 cup olive oil (or other oil)
1/4 cup white wine vinegar
juice of two limes (lemons also work)
2 tablespoons water
1 tablespoon honey
2 cloves garlic
1 serrano pepper, keeping the ribs and seeds if you like spicy
1 cup packed fresh herbs (mint, cilantro, green onions, parsley)
1/2 teaspoon salt
oil for the pan
3 cloves garlic, minced
1 serrano pepper, minced
1 lb. shrimp
4 cups spinach or other greens
4 large carrots, peeled
2 cups edamame, shelled and cooked
3/4 cup cashews
fresh wonton wrappers + oil for frying if you want to REALLY take it over the top
INSTRUCTIONS
Dressing: Pulse all the ingredients except the herbs together in a food processor or blender. Add the herbs and pulse until they are just green specks (not green puree) in the dressing. Add salt, taste, and adjust. Set aside.
Shrimp: Heat a little bit of oil in a large skillet over medium low heat. Toss in the garlic and the serrano pepper and stir-fry for 1 minute or until fragrant, being careful not to burn or brown the garlic. Add the shrimp, sprinkle with a little salt, and turn up the heat a little bit – enough to cook the shrimp but not so much that you burn the garlic. Saute for a few minutes – when the shrimp is no longer translucent, remove from the pan and set aside until cool enough to handle. Roughly chop the shrimp.
Veggies: Chop the veggies very finely – I do this by just running each ingredient (cashews first, then edamame, carrots last) through the food processor a bit. It gets everything to have that nice “chopped salad” texture without taking a ton of time.
Serve: Toss the chopped veggies, chopped shrimp, greens, and dressing together. Top with wonton strips if you have them (see notes).`,
    evidence: 'Current source URL, fetched through /api/fetch-recipe; embedded Recipe JSON-LD supplies canonical title/body.',
  },
  {
    oldId: 'intsa-punjabi-chole',
    title: 'Intsa Punjabi Chole',
    expectedContent: 'https://spicecravings.com/punjabi-chole-chana-masala-chickpeas-curry',
    content: `https://spicecravings.com/punjabi-chole-chana-masala-chickpeas-curry
INGREDIENTS
2 teaspoons ghee (or olive oil for vegan)
1 bay leaf
1 cup finely chopped onion (1 medium onion)
1 tablespoon minced ginger (1-inch ginger ground or grated)
2 serrano green chiles (stems removed (or 1 jalapeno))
1 roma tomato (de-seeded and finely chopped)
1 teaspoon pink salt (kala namak) adjust to taste - see notes for substitute
1 tablespoon coriander powder
2 teaspoons garam masala (add more, depending on how strong yours is)
2 teaspoons cumin powder
1 teaspoon amchur (dry mango powder) - see notes for substitute
1 teaspoon fennel powder (optional, adds flavor and for easy digestion)
1 tablespoon julienned ginger (½-inch ginger peeled and thinly sliced)
1 cup dried chickpeas (rinsed and soaked for 8-10 hours or 2 (14oz) cans chickpeas/garbanzo beans)
1½ cups water (add more or less, depending on your consistency preference)
¼ teaspoon baking soda (optional ingredient (for making chickpeas soft and creamy))
1-2 black tea bags (for color (Indian Tea) - optional)
1 teaspoon tamarind concentrate (or 1 teaspoon dry pomegranate powder (anardana))
2 tablespoons chopped cilantro
½-1 teaspoon chaat masala (optional but recommended)
INSTRUCTIONS
If using dried chickpeas/garbanzo beans, rinse and soak them in 4 cups of water, overnight, or at least 8-10 hours. Strain and rinse them once again before cooking. Skip soaking if using canned chickpeas. Rinse and drain them as well.
Heat ghee/oil for 30 seconds on Saute mode in the Instant Pot. Add bay leaf and chopped onions, and saute for 2 minutes.
Add minced ginger and serrano chiles and saute for another minute.
Add chopped tomatoes, salt, spices and saute another minute. Add a few tablespoons of water if spices start sticking to the bottom.
Add julienned ginger, rinsed chickpeas, water and baking soda, if using. Give it a stir. Add tea bags and gently push them under the liquid. Turn off saute.
Close the lid, set vent to 'sealing', and pressure cook for 45 minutes at Bean or Pressure Cook/Manual mode. Adjust time to 60 minutes if using dried 'unsoaked' beans.
Wait for the pressure to release naturally for at least 10 minutes, then follow the quick release instructions of your cooker. Open the lid after the pin drops. Remove the tea bags.
Using a potato masher or a wooden spoon, mash up a few beans. This makes the curry creamy and thick. Turn on saute and stir in tamarind concentrate and chaat masala (if using). Simmer for 2 to 3 minutes and check for seasoning. Turn off saute.
Garnish with cilantro and serve with bhatura, kulcha, puri, naan, basmati or cumin rice.
For the 30-minute canned-chickpea shortcut: rinse the canned chickpeas, follow the steps as written, then pressure cook everything for 5 minutes. Wait 10 minutes, release the remaining pressure manually, and open the lid after the pin drops.`,
    evidence: 'Current source URL, fetched through /api/fetch-recipe; embedded Recipe JSON-LD.',
  },
  {
    oldId: 'rising-sun-mazcal',
    title: 'Rising Sun - Mazcal',
    expectedContent: 'https://www.saveur.com/article/Recipes/rising-sun-mezcal-cocktail/\n \n\n 1 1⁄2 oz. mezcal\n 3⁄4 oz. fresh grapefruit juice\n 1⁄2 oz. fresh lime juice\n 1⁄2 oz. maraschino\n Pinch of salt\n Lime wheel, to garnish',
    content: `https://www.saveur.com/article/Recipes/rising-sun-mezcal-cocktail/
INGREDIENTS
1 1⁄2 oz. mezcal
3⁄4 oz. fresh grapefruit juice
1⁄2 oz. fresh lime juice
1⁄2 oz. maraschino
Pinch of salt
Lime wheel, to garnish`,
    evidence: 'Existing production content only; one heading added.',
  },
  {
    oldId: 'speget-with-fake-meat-meatballs',
    title: 'Speget with fake meat meatballs',
    expectedContent: 'Yield:4 to 6 servings\n ½ cup panko bread crumbs\n ¼ cup minced onion\n ¼ cup chopped parsley leaves and tender stems\n 3 garlic cloves, grated or minced\n 1 tablespoon tamari or soy sauce\n 1 ½ teaspoons kosher salt\n ½ teaspoon freshly ground black pepper\n ½ teaspoon dried oregano\n Pinch of red-pepper flakes (optional)\n 1 ½ pounds plant-based vegan ground beef (such as Beyond Meat)\n Extra-virgin olive oil, for drizzling\n 3 cups marinara sauce, homemade or store-bought\n Parmesan (optional, or use vegetarian Parmesan if you prefer), for garnish\n broccoli\n \n\n https://cooking.nytimes.com/recipes/1020740-meatless-meatballs-in-marinara-sauce',
    content: `Yield:4 to 6 servings
INGREDIENTS
½ cup panko bread crumbs
¼ cup minced onion
¼ cup chopped parsley leaves and tender stems
3 garlic cloves, grated or minced
1 tablespoon tamari or soy sauce
1 ½ teaspoons kosher salt
½ teaspoon freshly ground black pepper
½ teaspoon dried oregano
Pinch of red-pepper flakes (optional)
1 ½ pounds plant-based vegan ground beef (such as Beyond Meat)
Extra-virgin olive oil, for drizzling
3 cups marinara sauce, homemade or store-bought
Parmesan (optional, or use vegetarian Parmesan if you prefer), for garnish
broccoli
https://cooking.nytimes.com/recipes/1020740-meatless-meatballs-in-marinara-sauce`,
    evidence: 'Existing production content only; one heading added and whitespace normalized.',
  },
  {
    oldId: 'yogurt-dill-sauce',
    title: 'yogurt Dill sauce',
    expectedContent: 'https://minimalistbaker.com/zesty-dill-yogurt-sauce/',
    content: `https://minimalistbaker.com/zesty-dill-yogurt-sauce/
INGREDIENTS
1/2 cup plain dairy-free yogurt (we love plain Culina)
3 small cloves garlic, minced or pressed
2 Tbsp fresh dill (or sub half the amount dried dill)
1 healthy pinch sea salt
1 pinch cayenne pepper
1-2 Tbsp lemon juice
1 drizzle extra virgin olive oil
INSTRUCTIONS
To a small mixing bowl add yogurt, minced garlic, fresh dill, salt, cayenne, lemon juice, and olive oil and stir to combine.
Taste and adjust flavor as needed, adding more lemon for acidity, garlic for zing, dill for herbal flavor, salt to taste, pepper for heat, or olive oil for richness.
Serve immediately with desired dish, such as Moroccan-Roasted Carrots, Greek Goddess Bowls, or Falafel.
Store leftovers covered in the refrigerator for up to 4-5 days. Not freezer friendly.`,
    evidence: 'Current source URL, fetched through /api/fetch-recipe; embedded Recipe JSON-LD.',
  },
]

const deferred = [
  { id: 'maple-roasted-candied-pecans', reason: 'Stored content is only "Source:"; no source URL, backup, queue item, or checked-in artifact exists.' },
  { id: 'smoothies', reason: 'The composite has three ingredient lists but no instructions for any recipe; the brief forbids inventing them.' },
]

function serializeFirestore(value) {
  if (value && typeof value === 'object') {
    if (typeof value.toDate === 'function' && Number.isInteger(value.seconds) && Number.isInteger(value.nanoseconds)) {
      return { __firestoreType: 'Timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds }
    }
    if (Array.isArray(value)) return value.map(serializeFirestore)
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeFirestore(item)]))
  }
  return value
}

function withoutChangedFields(data, changedFields) {
  return Object.fromEntries(Object.entries(data).filter(([key]) => !changedFields.includes(key)))
}

async function main() {
  loadEnv()
  const { parseRecipeContent } = await import('../lib/recipeContent.ts')
  const db = getAdmin().firestore()
  const snapshots = new Map()

  for (const repair of repairs) {
    const snap = await db.collection('recipes').doc(repair.oldId).get()
    if (!snap.exists) throw new Error(`Precondition failed: recipes/${repair.oldId} does not exist`)
    const data = snap.data()
    const contentMatches = repair.expectedContent !== undefined
      ? data.content === repair.expectedContent
      : sha256(String(data.content || '')) === repair.expectedContentSha256
    if (!contentMatches) throw new Error(`Precondition failed: content drift for ${repair.oldId}`)
    if (repair.expectedTitle && data.title !== repair.expectedTitle) throw new Error(`Precondition failed: title drift for ${repair.oldId}`)
    if (repair.newId) {
      if (slugify(repair.title) !== repair.newId) throw new Error(`Slug mismatch for ${repair.oldId}`)
      const collision = await db.collection('recipes').doc(repair.newId).get()
      if (collision.exists) throw new Error(`Collision: recipes/${repair.newId} already exists`)
    }
    const parsed = parseRecipeContent(repair.content)
    if (!parsed.ingredients.length) throw new Error(`Proposed content has zero ingredients: ${repair.oldId}`)
    if (!parsed.instructions.length && !['rising-sun-mazcal', 'speget-with-fake-meat-meatballs'].includes(repair.oldId)) {
      throw new Error(`Proposed content has zero instructions: ${repair.oldId}`)
    }
    snapshots.set(repair.oldId, { data, parsed })
  }

  console.log(JSON.stringify({
    mode: APPLY ? 'APPLY' : 'CHECK_ONLY',
    checked: repairs.map(r => ({ oldId: r.oldId, newId: r.newId || r.oldId, title: r.title, contentSha256: sha256(r.content), ingredients: snapshots.get(r.oldId).parsed.ingredients.length, instructions: snapshots.get(r.oldId).parsed.instructions.length, evidence: r.evidence })),
    deferred,
  }, null, 2))

  if (!APPLY) return

  const backup = {
    generatedAt: new Date().toISOString(),
    firebaseProject: 'malignant-metro',
    collection: 'recipes',
    documentCount: repairs.length,
    restoreNote: 'Timestamp values use {__firestoreType:"Timestamp",seconds,nanoseconds}; decode before Admin-SDK restore.',
    documents: Object.fromEntries([...snapshots].map(([id, { data }]) => [id, serializeFirestore(data)])),
  }
  fs.writeFileSync(BACKUP_PATH, `${JSON.stringify(backup, null, 2)}\n`, { flag: 'wx' })
  console.log(`Backup created: ${BACKUP_PATH}`)

  const results = []
  for (const repair of repairs) {
    const oldData = snapshots.get(repair.oldId).data
    const oldNutrition = oldData.nutrition
    const oldNutritionStatus = oldData.nutritionStatus
    const targetId = repair.newId || repair.oldId
    const targetRef = db.collection('recipes').doc(targetId)

    if (repair.newId) {
      const migrated = { ...oldData, id: repair.newId, recipeID: repair.newId, title: repair.title, content: repair.content }
      await targetRef.create(migrated)
    } else {
      await targetRef.update({ content: repair.content })
    }

    const readBack = await targetRef.get()
    if (!readBack.exists) throw new Error(`Read-back missing: ${targetId}`)
    const readData = readBack.data()
    const parsed = parseRecipeContent(String(readData.content || ''))
    if (!parsed.ingredients.length) throw new Error(`Read-back parse failed: ${targetId}`)
    if (JSON.stringify(readData.nutrition) !== JSON.stringify(oldNutrition)) throw new Error(`Nutrition changed: ${targetId}`)
    if (readData.nutritionStatus !== oldNutritionStatus) throw new Error(`nutritionStatus changed: ${targetId}`)

    const changedFields = repair.newId ? ['id', 'recipeID', 'title', 'content'] : ['content']
    if (JSON.stringify(serializeFirestore(withoutChangedFields(readData, changedFields))) !== JSON.stringify(serializeFirestore(withoutChangedFields(oldData, changedFields)))) {
      throw new Error(`Untouched field mismatch: ${targetId}`)
    }

    if (repair.newId) {
      await db.collection('recipes').doc(repair.oldId).delete()
      const oldReadBack = await db.collection('recipes').doc(repair.oldId).get()
      if (oldReadBack.exists) throw new Error(`Old document still exists after migration: ${repair.oldId}`)
    }

    results.push({ oldId: repair.oldId, newId: targetId, ingredients: parsed.ingredients.length, instructions: parsed.instructions.length, nutritionUnchanged: true, untouchedFieldsUnchanged: true, oldDeleted: Boolean(repair.newId) })
    console.log(`Verified ${repair.oldId} -> ${targetId}: ${parsed.ingredients.length} ingredients, ${parsed.instructions.length} instructions`)
  }

  console.log(JSON.stringify({ applied: true, updates: repairs.filter(r => !r.newId).length, creates: repairs.filter(r => r.newId).length, deletes: repairs.filter(r => r.newId).length, nutritionWrites: 0, results }, null, 2))
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message)
    process.exit(1)
  })
}

module.exports = { repairs, deferred, serializeFirestore, slugify }
