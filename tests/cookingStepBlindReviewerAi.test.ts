import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ generateAIObject: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/ai', () => ({ generateAIObject: mocks.generateAIObject }))

import {
  buildBlindCookingReviewPrompt,
  reviewCookingStepMapBlindlyWithAi,
  validateBlindCookingReview,
} from '@/lib/cookingStepBlindReviewerAi'

const ingredients = ['For the vegetables:', '2 potatoes', '1 tsp Italian herbs']
const instructions = ['Season the potatoes with Italian herbs.']

function output() {
  return {
    steps: [{
      instructionIndex: 0,
      expectedIngredientIndexes: [1, 2],
      preparedComponents: [{ label: 'seasoned potatoes' }],
      explicitActiveUseIndexes: [1, 2],
      ingredientAssessments: [
        { ingredientIndex: 1, level: 'CRITICAL', kind: 'MAIN_STRUCTURAL' },
        { ingredientIndex: 2, level: 'MEDIUM', kind: 'SEASONING_HERB' },
      ],
      confidence: 'HIGH',
      reasoningCategory: 'EXPLICIT_ACTIVE_USE',
    }],
  }
}

describe('blind cooking reviewers', () => {
  beforeEach(() => mocks.generateAIObject.mockReset())

  it('supplies the complete title/source with header identification and no candidate map', () => {
    const prompt = buildBlindCookingReviewPrompt('Herbed Potatoes', ingredients, instructions)
    expect(prompt).toContain('TITLE\nHerbed Potatoes')
    expect(prompt).toContain('[0] GROUP HEADER: For the vegetables:')
    expect(prompt).toContain('[1] 2 potatoes')
    expect(prompt).toContain('[0] Season the potatoes with Italian herbs.')
    expect(prompt).not.toMatch(/candidate|persisted map|deterministic map|currentIngredientIndexes/i)
  })

  it('runs A and B independently with identical source prompts', async () => {
    mocks.generateAIObject.mockResolvedValue(output())
    await Promise.all([
      reviewCookingStepMapBlindlyWithAi('A', 'Herbed Potatoes', ingredients, instructions, 'user'),
      reviewCookingStepMapBlindlyWithAi('B', 'Herbed Potatoes', ingredients, instructions, 'user'),
    ])
    expect(mocks.generateAIObject).toHaveBeenCalledTimes(2)
    expect(mocks.generateAIObject.mock.calls[0][0].feature).toBe('cooking-step-blind-reviewer-a')
    expect(mocks.generateAIObject.mock.calls[1][0].feature).toBe('cooking-step-blind-reviewer-b')
    expect(mocks.generateAIObject.mock.calls[0][0].prompt).toBe(mocks.generateAIObject.mock.calls[1][0].prompt)
    expect(mocks.generateAIObject.mock.calls[0][0].system).toBe(mocks.generateAIObject.mock.calls[1][0].system)
  })

  it('retains source-grounded component proposals', () => {
    expect(validateBlindCookingReview(output(), ingredients, instructions).steps[0].preparedComponents)
      .toEqual([{ label: 'seasoned potatoes' }])
  })

  it('rejects header and out-of-range ingredient indexes while normalizing duplicates', () => {
    for (const indexes of [[0], [3]]) {
      const invalid = output()
      invalid.steps[0].expectedIngredientIndexes = indexes
      invalid.steps[0].explicitActiveUseIndexes = indexes
      invalid.steps[0].ingredientAssessments = indexes.map(ingredientIndex => ({
        ingredientIndex,
        level: 'HIGH',
        kind: 'SUBSTANTIAL',
      }))
      expect(() => validateBlindCookingReview(invalid, ingredients, instructions)).toThrow()
    }
    const duplicate = output()
    duplicate.steps[0].expectedIngredientIndexes = [1, 1, 2]
    duplicate.steps[0].explicitActiveUseIndexes = [1, 1, 2]
    expect(validateBlindCookingReview(duplicate, ingredients, instructions).steps[0].expectedIngredientIndexes)
      .toEqual([1, 2])
  })
})
