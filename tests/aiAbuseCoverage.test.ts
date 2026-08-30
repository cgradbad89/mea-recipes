import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

const AI_ROUTE_BOUNDARIES = [
  'app/api/ai-ingest/route.ts',
  'app/api/grocery-cleanup/route.ts',
  'app/api/new-recipe-suggestions/route.ts',
  'app/api/plan-suggestions/route.ts',
  'app/api/recommendations/route.ts',
  'app/api/recipe-assistant/route.ts',
  'app/api/nutrition-lookup/route.ts',
  'app/api/nutrition-revalidate/route.ts',
  'app/api/nutrition-canonical-dryrun/route.ts',
  'app/api/cooking-step-map/route.ts',
  'app/api/mapping/generate/route.ts',
] as const

function source(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

describe('AI abuse-control coverage inventory', () => {
  it.each(AI_ROUTE_BOUNDARIES)('%s authenticates and preserves limiter denials', path => {
    const contents = source(path)
    expect(contents).toMatch(/verify(?:Admin|Auth)Token\(req\)/)
    expect(contents).toContain('aiAbuseControlResponse')
  })

  it('threads the verified user through every nutrition fallback entry point', () => {
    const lookup = source('app/api/nutrition-lookup/route.ts')
    const revalidate = source('app/api/nutrition-revalidate/route.ts')
    const canonical = source('app/api/nutrition-canonical-dryrun/route.ts')
    const engine = source('lib/nutritionEngine.ts')

    expect(lookup).toContain('lookupFoodByName(body.name, uid)')
    expect(lookup).toMatch(/computeRecipeNutrition\(body\.recipeId,\s*\{\s*userId: uid,/)
    expect(revalidate).toContain("aiUsageClass: 'admin-batch'")
    expect(canonical).toContain("aiUsageClass: 'admin-batch'")
    expect(engine).toMatch(/generateAIObject\(\{[\s\S]*?userId,[\s\S]*?usageClass,/)
    expect(engine).toContain('if (isAIAbuseControlError(error)) throw error')
  })

  it('keeps the paid Gateway import behind the centralized helper', () => {
    expect(source('lib/ai.ts')).toContain("from '@ai-sdk/gateway'")
    for (const path of AI_ROUTE_BOUNDARIES) {
      expect(source(path)).not.toContain("from '@ai-sdk/gateway'")
    }
  })

  it('does not let optional mapping layers swallow limiter denial', () => {
    expect(source('lib/cookingModeMappingReviewer.ts')).toContain(
      'if (isAIAbuseControlError(error)) throw error',
    )
    expect(source('lib/cookingModeMappingIngestion.ts')).toContain(
      'if (isAIAbuseControlError(error)) throw error',
    )
  })
})
