import 'server-only'

import { z } from 'zod'
import { generateAIObject } from '@/lib/ai'
import { COOKING_STEP_MAPPING_TEMPERATURE } from '@/lib/aiConfig'
import { isIngredientSubheader } from '@/lib/recipeContent'

const COOKING_STEP_BLIND_REVIEWER_PROMPT_VERSION = 'v1'

const INGREDIENT_ASSESSMENT_SCHEMA = z.object({
  ingredientIndex: z.number(),
  level: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  kind: z.enum(['MAIN_STRUCTURAL', 'SUBSTANTIAL', 'SEASONING_HERB', 'GARNISH', 'OTHER']),
})

export const BLIND_COOKING_REVIEW_SCHEMA = z.object({
  steps: z.array(z.object({
    instructionIndex: z.number(),
    expectedIngredientIndexes: z.array(z.number()).max(200),
    preparedComponents: z.array(z.object({ label: z.string().min(1).max(100) })).max(30),
    explicitActiveUseIndexes: z.array(z.number()).max(200),
    ingredientAssessments: z.array(INGREDIENT_ASSESSMENT_SCHEMA).max(200),
    confidence: z.enum(['HIGH', 'UNCERTAIN']),
    reasoningCategory: z.enum([
      'EXPLICIT_ACTIVE_USE',
      'CLEAR_ALIAS',
      'GROUP_REFERENCE',
      'PREPARED_COMPONENT',
      'COLLECTIVE_REFERENCE',
      'OTHER',
    ]),
  })).max(150),
})

type BlindCookingReviewSchemaOutput = z.infer<typeof BLIND_COOKING_REVIEW_SCHEMA>
export interface BlindCookingReview {
  steps: Array<Omit<BlindCookingReviewSchemaOutput['steps'][number], 'confidence'> & {
    confidence: 'high' | 'uncertain'
  }>
}
export type BlindReviewerId = 'A' | 'B'

// This intentionally preserves the successful completeness-audit discovery
// contract. Reviewer safety is limited to obvious precision boundaries; final
// candidate decisions belong to the separate source-grounded arbiter.
export const BLIND_COOKING_REVIEW_SYSTEM_PROMPT = `You are an independent Cooking Mode completeness reviewer. This is a completeness audit, not the production mapper. Independently determine which listed ingredient rows a competent cook actively needs or uses at every numbered instruction step.

An ingredient belongs to a step when the cook actively introduces, uses, manipulates, seasons with, combines with, applies, adds, cooks, tosses, tops, garnishes, or otherwise needs that listed ingredient for the action described by that step. Do not omit an ingredient merely because deterministic matching might consider the relationship difficult.

Completeness must not reduce correctness. Do not map contextual mentions, consumed unrelated rows, guessed ingredients, or a prior row merely because it has not appeared yet. Do not invent ingredients, rewrite instructions, or return indexes outside the provided source. Rows explicitly marked GROUP HEADER are semantic context only and must never be returned as ingredient references. Do not infer unlisted cooking water, oil, or salt as a listed row.

Positive examples:
- "Add the potatoes" -> potatoes.
- "Cook the steak" -> steak.
- "Layer tomato and mozzarella" -> tomato and mozzarella.
- "Season zucchini with Italian herbs and pepper" -> zucchini, Italian herbs, and pepper.

Negative examples:
- "prepare sauce for the chicken" -> chicken is contextual unless chicken itself is acted upon.
- "boil eggs in water" -> do not map a previously listed soup water unless the recipe explicitly establishes reuse.

For each instruction, return all expected ingredient indexes, any prepared component label actively used at that step, and the high-confidence subset explicitly named or clearly aliased and directly acted upon. Assess every expected ingredient as CRITICAL main/structural, HIGH substantial, MEDIUM seasoning/herb/aromatic, or LOW optional garnish/low-impact; also tag its kind. Confidence HIGH means the source proves the relationship; UNCERTAIN means reasonable cooks could disagree. Use reasoningCategory to describe the strongest relationship in that step. The current Cooking Mode mapping is intentionally absent from the request.`

export function buildBlindCookingReviewPrompt(
  title: string,
  ingredients: string[],
  instructions: string[],
): string {
  const ingredientLines = ingredients.map((raw, index) =>
    `[${index}] ${isIngredientSubheader(raw) ? 'GROUP HEADER: ' : ''}${raw}`)
  const instructionLines = instructions.map((raw, index) => `[${index}] ${raw}`)
  return [
    'TITLE',
    title,
    '',
    'INGREDIENTS',
    ...ingredientLines,
    '',
    'INSTRUCTIONS',
    ...instructionLines,
  ].join('\n')
}

export function validateBlindCookingReview(
  value: unknown,
  ingredients: string[],
  instructions: string[],
): BlindCookingReview {
  const parsed = BLIND_COOKING_REVIEW_SCHEMA.parse(value)
  const inRangeSteps = parsed.steps.filter(step => Number.isInteger(step.instructionIndex) &&
    step.instructionIndex >= 0 && step.instructionIndex < instructions.length)
  const normalizedSteps = inRangeSteps.length === instructions.length &&
    new Set(inRangeSteps.map(step => step.instructionIndex)).size === instructions.length
    ? inRangeSteps : parsed.steps
  if (normalizedSteps.length !== instructions.length) {
    throw new Error(`blind review returned ${normalizedSteps.length}/${instructions.length} steps`)
  }
  const seenSteps = new Set<number>()
  const steps = normalizedSteps.map(step => {
    if (!Number.isInteger(step.instructionIndex) || step.instructionIndex < 0 || step.instructionIndex >= instructions.length) {
      throw new Error(`blind review instruction index out of range: ${step.instructionIndex}`)
    }
    if (seenSteps.has(step.instructionIndex)) throw new Error(`duplicate blind review step: ${step.instructionIndex}`)
    seenSteps.add(step.instructionIndex)

    const expected = new Set<number>()
    for (const ingredientIndex of step.expectedIngredientIndexes) {
      if (
        !Number.isInteger(ingredientIndex) ||
        ingredientIndex < 0 ||
        ingredientIndex >= ingredients.length ||
        isIngredientSubheader(ingredients[ingredientIndex])
      ) throw new Error(`blind review referenced invalid ingredient index: ${ingredientIndex}`)
      expected.add(ingredientIndex)
    }
    const explicitActiveUseIndexes = [...new Set(step.explicitActiveUseIndexes)]
    if (explicitActiveUseIndexes.some(index => !expected.has(index))) {
      throw new Error(`blind review explicit indexes are invalid at step ${step.instructionIndex}`)
    }
    const ingredientAssessments = [...new Map(step.ingredientAssessments.map(item => [item.ingredientIndex, item])).values()]
    const assessments = new Set(ingredientAssessments.map(item => item.ingredientIndex))
    if (assessments.size !== expected.size || [...assessments].some(index => !expected.has(index))) {
      throw new Error(`blind review assessments are incomplete at step ${step.instructionIndex}`)
    }
    return {
      ...step,
      expectedIngredientIndexes: [...expected],
      explicitActiveUseIndexes,
      ingredientAssessments,
      confidence: step.confidence === 'HIGH' ? 'high' as const : 'uncertain' as const,
    }
  })
  return {
    steps: steps.sort((left, right) => left.instructionIndex - right.instructionIndex),
  }
}

export async function reviewCookingStepMapBlindlyWithAi(
  reviewer: BlindReviewerId,
  title: string,
  ingredients: string[],
  instructions: string[],
  userId: string,
  timeout?: number,
): Promise<BlindCookingReview> {
  const output = await generateAIObject({
    feature: `cooking-step-blind-reviewer-${reviewer.toLowerCase()}`,
    userId,
    promptVersion: COOKING_STEP_BLIND_REVIEWER_PROMPT_VERSION,
    system: BLIND_COOKING_REVIEW_SYSTEM_PROMPT,
    prompt: buildBlindCookingReviewPrompt(title, ingredients, instructions),
    schema: BLIND_COOKING_REVIEW_SCHEMA,
    temperature: COOKING_STEP_MAPPING_TEMPERATURE,
    ...(timeout === undefined ? {} : { timeout }),
  })
  return validateBlindCookingReview(output, ingredients, instructions)
}
