import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  buildCookingMapArbiterPrompt,
  validateCookingMapArbitration,
} from '@/lib/cookingStepMapArbiterAi'
import type { CookingMapCandidatePool } from '@/lib/cookingStepMapConsensus'

const ingredients = ['For the dressing:', '1 tbsp olive oil', '2 potatoes', '1 tsp pepper']
const instructions = ['Whisk the olive oil into the dressing.', 'Cook the potatoes and season with pepper.']
const pool: CookingMapCandidatePool = {
  ingredientRelations: [
    {
      instructionIndex: 1,
      ingredientIndex: 2,
      origins: ['BOTH_REVIEWERS'],
      rawIngredient: ingredients[2],
      rawInstruction: instructions[1],
      ingredientGroup: 'dressing',
    },
    {
      instructionIndex: 1,
      ingredientIndex: 3,
      origins: ['DETERMINISTIC', 'A_ONLY'],
      rawIngredient: ingredients[3],
      rawInstruction: instructions[1],
      ingredientGroup: 'dressing',
    },
  ],
  components: [{ instructionIndex: 0, proposedLabel: 'dressing', origins: ['BOTH_REVIEWERS'] }],
}

function arbitration() {
  return {
    ingredientRelations: [
      { instructionIndex: 1, ingredientIndex: 2, decision: 'ACCEPT', evidenceText: 'Cook the potatoes' },
      { instructionIndex: 1, ingredientIndex: 3, decision: 'ACCEPT', evidenceText: 'season with pepper' },
    ],
    components: [{
      instructionIndex: 0,
      proposedLabel: 'dressing',
      decision: 'ACCEPT',
      canonicalLabel: 'dressing',
      evidenceText: 'the dressing',
    }],
  }
}

describe('source-grounded cooking-map arbiter', () => {
  it('receives source and collapsed agreement metadata without reviewer reasoning', () => {
    const prompt = buildCookingMapArbiterPrompt('Potatoes', ingredients, instructions, pool)
    expect(prompt).toContain('"reviewerAgreement": "both"')
    expect(prompt).toContain('"reviewerAgreement": "single"')
    expect(prompt).toContain('"deterministic": true')
    expect(prompt).toContain('Cook the potatoes and season with pepper.')
    expect(prompt).not.toMatch(/ingredientAssessments|reasoningCategory|"reviewerA"|"reviewerB"/)
  })

  it('requires every candidate exactly once', () => {
    const incomplete = arbitration()
    incomplete.ingredientRelations.pop()
    expect(() => validateCookingMapArbitration(incomplete, ingredients, instructions, pool)).toThrow(/exactly once/)

    const duplicate = arbitration()
    duplicate.ingredientRelations[1] = { ...duplicate.ingredientRelations[0] }
    expect(() => validateCookingMapArbitration(duplicate, ingredients, instructions, pool)).toThrow()
  })

  it('accepts grounded potatoes and seasoning evidence', () => {
    const result = validateCookingMapArbitration(arbitration(), ingredients, instructions, pool)
    expect(result.ingredientRelations.map(item => item.decision)).toEqual(['ACCEPT', 'ACCEPT'])
  })

  it('rejects an ACCEPT with invented evidence', () => {
    const invalid = arbitration()
    invalid.ingredientRelations[0].evidenceText = 'Bake the invented carrots'
    expect(validateCookingMapArbitration(invalid, ingredients, instructions, pool).ingredientRelations[0])
      .toMatchObject({ decision: 'REJECT' })
  })
})
