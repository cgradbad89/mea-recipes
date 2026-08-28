import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluateActiveObjectRescue, ingredientKeyTokens } from '../scripts/analyze-cooking-mode-v10f-lite-active-object-core.mjs'
import { DSC_IDS, PRONOUN_IDS, NEGATIVE_LEAKAGE_IDS } from '../scripts/analyze-cooking-mode-v10f-lite-active-object.mjs'

const root = path.resolve(process.cwd())
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
const date = '2026-08-28'

const v10a = readJson(`docs/audits/cooking-mode-arbiter-v10a-frozen-candidates-${date}.json`)
const v10d = readJson(`docs/audits/cooking-mode-v10d-principal-target-analysis-${date}.json`)
const v10e = readJson(`docs/audits/cooking-mode-v10e-remaining-fn-taxonomy-${date}.json`)

const v10aCandidates = [...v10a.populations.INGREDIENT_RELATIONSHIPS, ...v10a.populations.PREPARED_COMPONENT_RELATIONSHIPS]
const v10aById = new Map(v10aCandidates.map((c) => [c.candidateId, c]))
const v10eById = new Map(v10e.candidates.map((c) => [c.candidateId, c]))

/** Reconstructs one recipe's own instruction chronology from the locked artifacts, matching the
 *  driver's buildInstructionMap exactly (this recipe's own text only, never global). */
function contextFor(recipeId) {
  const m = new Map()
  const put = (index, text) => {
    if (text == null || m.has(index)) return
    m.set(index, text)
  }
  for (const c of v10aCandidates) {
    if (c.recipeId !== recipeId) continue
    put(c.instructionIndex, c.instructionText)
    if (c.previousInstructionText) put(c.instructionIndex - 1, c.previousInstructionText)
    if (c.nextInstructionText) put(c.instructionIndex + 1, c.nextInstructionText)
  }
  for (const c of v10e.candidates) {
    if (c.recipeId !== recipeId) continue
    put(c.instructionIndex, c.instructionText)
  }
  return { instructions: Array.from(m.entries()).map(([index, text]) => ({ index, text })) }
}

describe('evaluateActiveObjectRescue — synthetic fixtures (one per TEST REQUIREMENTS row)', () => {
  const recipeContext = {
    instructions: [
      { index: 0, text: 'Load wild rice, raw chicken, mirepoix, garlic, and chicken broth into slow cooker.' },
      { index: 1, text: 'Whisk together olive oil, red wine vinegar, oregano, salt, and pepper.' },
    ],
  }

  it('accepts a whole-dish continuation verb (bare "cover and cook")', () => {
    const candidate = {
      candidateId: 'test::whole-dish',
      ingredientText: '2 cups mirepoix, chopped',
      instructionText: 'Cover and cook on low for 6 hours.',
      instructionIndex: 2,
    }
    const result = evaluateActiveObjectRescue(candidate, recipeContext)
    expect(result.rescue).toBe(true)
    expect(result.evidence).toBe('EXPLICIT_OBJECT')
  })

  it('accepts a collective/category reference ("the vegetables")', () => {
    const candidate = {
      candidateId: 'test::collective',
      ingredientText: '2 cups mirepoix, chopped',
      instructionText: 'Roast until the vegetables are tender and lightly browned.',
      instructionIndex: 2,
    }
    const result = evaluateActiveObjectRescue(candidate, recipeContext)
    expect(result.rescue).toBe(true)
    expect(result.evidence).toBe('COLLECTIVE_REFERENCE')
  })

  it('accepts a clear singular pronoun ("it") referring to the assembled object', () => {
    const candidate = {
      candidateId: 'test::pronoun-singular',
      ingredientText: 'chicken broth',
      instructionText: 'Bring it to a boil, then reduce heat and simmer.',
      instructionIndex: 2,
    }
    const result = evaluateActiveObjectRescue(candidate, recipeContext)
    expect(result.rescue).toBe(true)
    expect(result.evidence).toBe('PRONOUN_REFERENCE')
  })

  it('accepts a clear plural pronoun ("them") referring to the assembled object', () => {
    const candidate = {
      candidateId: 'test::pronoun-plural',
      ingredientText: 'mirepoix, chopped',
      instructionText: 'Stir them well before covering the pot.',
      instructionIndex: 2,
    }
    const result = evaluateActiveObjectRescue(candidate, recipeContext)
    expect(result.rescue).toBe(true)
    expect(result.evidence).toBe('PRONOUN_REFERENCE')
  })

  it('rejects an isolated subcomponent referenced by its own established name ("the dressing")', () => {
    const candidate = {
      candidateId: 'test::isolated-subcomponent',
      ingredientText: '3 tbsp olive oil',
      instructionText: 'Pour the dressing over the salad and toss to combine.',
      instructionIndex: 2,
    }
    const result = evaluateActiveObjectRescue(candidate, recipeContext)
    expect(result.rescue).toBe(false)
    expect(result.evidence).toBe('NONE')
  })

  it('rejects an unmerged sauce/dressing constituent even when it was combined earlier', () => {
    const candidate = {
      candidateId: 'test::unmerged-sauce',
      ingredientText: 'red wine vinegar',
      instructionText: 'Whisk the marinade until smooth, then set aside.',
      instructionIndex: 2,
    }
    const result = evaluateActiveObjectRescue(candidate, recipeContext)
    expect(result.rescue).toBe(false)
  })

  it('rejects an ambiguous pronoun with no established antecedent in this recipe', () => {
    const candidate = {
      candidateId: 'test::ambiguous-pronoun',
      ingredientText: 'sesame oil',
      instructionText: 'Drizzle it over the finished dish before serving.',
      instructionIndex: 0, // no earlier instruction can exist at index 0
    }
    const result = evaluateActiveObjectRescue(candidate, { instructions: [] })
    expect(result.rescue).toBe(false)
    expect(result.evidence).toBe('NONE')
  })

  it('rejects bare generic seasoning language with no named subset', () => {
    const candidate = {
      candidateId: 'test::generic-seasoning',
      ingredientText: 'Black pepper to taste',
      instructionText: 'Taste and adjust seasoning as needed.',
      instructionIndex: 2,
    }
    const result = evaluateActiveObjectRescue(candidate, recipeContext)
    expect(result.rescue).toBe(false)
  })

  it('does not export or touch any Firestore/production write path', () => {
    const modulePath = path.join(root, 'scripts/analyze-cooking-mode-v10f-lite-active-object-core.mjs')
    const source = fs.readFileSync(modulePath, 'utf8')
    expect(source).not.toMatch(/firebase-admin|getFirestore|\.doc\(|\.collection\(|updateDoc|setDoc/)
  })
})

describe('evaluateActiveObjectRescue — locked challenge-set evidence (Phase 5 gate)', () => {
  it('recovers at least 85% of the selected DISH_STATE_CONTINUATION positives', () => {
    const rows = DSC_IDS.map((id) => v10eById.get(id))
    expect(rows.every(Boolean)).toBe(true)
    const recovered = rows.filter((c) => evaluateActiveObjectRescue(c, contextFor(c.recipeId)).rescue === true).length
    expect(recovered / rows.length).toBeGreaterThanOrEqual(0.85)
  })

  it('recovers at least 85% of the selected PRONOUN_OR_DEICTIC_REFERENCE positives', () => {
    const rows = PRONOUN_IDS.map((id) => v10eById.get(id))
    expect(rows.every(Boolean)).toBe(true)
    const recovered = rows.filter((c) => evaluateActiveObjectRescue(c, contextFor(c.recipeId)).rescue === true).length
    expect(recovered / rows.length).toBeGreaterThanOrEqual(0.85)
  })

  it('rejects every selected negative leakage case (0 new false positives)', () => {
    const rows = NEGATIVE_LEAKAGE_IDS.map((id) => v10aById.get(id))
    expect(rows.every(Boolean)).toBe(true)
    for (const c of rows) {
      const result = evaluateActiveObjectRescue(c, contextFor(c.recipeId))
      expect(result.rescue).toBe(false)
    }
  })

  it('protects all 20 locked V10A target false positives (target-FP protection)', () => {
    const rows = v10d.targetFalsePositiveOutcomes
    expect(rows).toHaveLength(20)
    for (const c of rows) {
      const candidate = {
        candidateId: c.candidateId,
        recipeId: c.recipeId,
        ingredientText: c.ingredientRow,
        instructionText: c.currentInstruction,
        instructionIndex: c.instructionIndex,
      }
      const result = evaluateActiveObjectRescue(candidate, contextFor(c.recipeId))
      expect(result.rescue, `${c.candidateId} (${c.rootCause}) must stay rejected`).toBe(false)
    }
  })
})

describe('ingredientKeyTokens', () => {
  it('strips quantities/units and drops generic culinary/dish-type words', () => {
    expect(ingredientKeyTokens('2 cups mirepoix (chopped celery, carrots, and onions)')).toEqual(
      expect.arrayContaining(['mirepoix', 'celery', 'carrots', 'onions']),
    )
    expect(ingredientKeyTokens('Chili Sauce 1 TBSP')).not.toContain('sauce')
    expect(ingredientKeyTokens('Chili Sauce 1 TBSP')).not.toContain('chili')
  })
})
