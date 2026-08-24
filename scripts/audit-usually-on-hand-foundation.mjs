#!/usr/bin/env node
/**
 * Read-only frequency audit for Usually On Hand candidate discovery.
 *
 * Reads only the shared recipes collection, applies the recipe-side grocery
 * eligibility and exact normalizeNoun identity rules, and prints JSON. It does
 * not read or write user grocery/saved-item data and has no mutation calls.
 */

import { createRequire } from 'node:module'

import { categorizeIngredient } from '../lib/groceryCategories.ts'
import { normalizeNoun, parseIngredient } from '../lib/ingredientParser.ts'
import { isExplicitUrl, isIngredientSubheader, parseRecipeContent } from '../lib/recipeContent.ts'

const require = createRequire(import.meta.url)
const { loadEnv, getAdmin } = require('./_lib.js')

loadEnv()
const snapshot = await getAdmin().firestore().collection('recipes').get()

const identities = new Map()
let groceryEligibleOccurrences = 0

for (const recipeDocument of snapshot.docs) {
  const content = recipeDocument.data().content
  if (typeof content !== 'string' || !content) continue

  const { ingredients } = parseRecipeContent(content)
  for (const raw of ingredients) {
    const trimmed = raw.trim()
    if (!trimmed || isIngredientSubheader(trimmed) || isExplicitUrl(trimmed)) continue

    const parsed = parseIngredient(raw)
    const parsedName = parsed.name.trim()
    if (!parsedName || isExplicitUrl(parsedName)) continue

    const name = parsed.confidence === 'high' ? parsedName : trimmed
    const identity = normalizeNoun(name)
    if (!identity) continue

    groceryEligibleOccurrences += 1
    const current = identities.get(identity) || {
      identity,
      category: categorizeIngredient(name),
      occurrences: 0,
      recipeIds: new Set(),
    }
    current.occurrences += 1
    current.recipeIds.add(recipeDocument.id)
    identities.set(identity, current)
  }
}

const rankedIdentities = [...identities.values()]
  .map(item => ({
    identity: item.identity,
    category: item.category,
    recipes: item.recipeIds.size,
    occurrences: item.occurrences,
  }))
  .sort((left, right) =>
    right.recipes - left.recipes ||
    right.occurrences - left.occurrences ||
    left.identity.localeCompare(right.identity),
  )

process.stdout.write(`${JSON.stringify({
  source: 'Firestore recipes collection; one read-only collection query',
  generatedAt: new Date().toISOString(),
  corpus: {
    recipesAnalyzed: snapshot.size,
    groceryEligibleOccurrences,
    uniqueNormalizedIdentities: identities.size,
  },
  top30ByRecipeFrequency: rankedIdentities.slice(0, 30),
}, null, 2)}\n`)
