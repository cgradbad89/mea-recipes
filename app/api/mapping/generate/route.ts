import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyAdminToken } from '@/lib/firebaseAdmin'
import { ApiRequestError, readBoundedJson, safeErrorLogDetails } from '@/lib/apiRequest'
import { getRecipeById } from '@/lib/recipes'
import { parseRecipeContent } from '@/lib/recipeContent'
import { COOKING_MAPPING_PARSER_VERSION } from '@/lib/cookingStepMapping'
import { computeMappingRecipeRevision } from '@/lib/cookingModeMappingIdentity'
import { generateAndPersistCookingModeMappingProposal } from '@/lib/cookingModeMappingIngestion'

// Cooking Mode mapping — trusted ingestion trigger (Implementation 6, Phase
// 19-20). One canonical route rather than a route-specific implementation
// per caller. Reuses the same trusted-admin boundary as every other
// Cooking-Mode-mapping-writing route (`verifyAdminToken`, matching
// `app/api/mapping-review/**`) — this route performs paid AI calls and
// writes shared catalog workflow state, so it is never reachable from an
// unauthenticated or non-admin client (Phase 19).
//
// The server derives everything except which recipe to look at: reviewer
// votes, candidate lists, routing state, and proposal identity are always
// computed here, never trusted from the request body (Phase 20).
//
// Mapping generation intentionally never blocks or reverses a recipe's own
// save — by the time this route is called, `createRecipe()` has already
// succeeded client-side. A `BLOCKED`/`FAILED` outcome here means only that
// the mapping workflow needs attention; it carries no HTTP error status of
// its own, matching the existing `/api/cooking-step-map` convention of
// returning 200 with a sanitized status object rather than an HTTP failure
// for an optional, best-effort AI enrichment (see PRD.md's API Routes
// table). Genuine request-shape/authorization/not-found problems still use
// real HTTP status codes below.
//
// Reviewer execution can run substantially longer than ordinary
// persistence (up to two attempts per blind reviewer slot, each up to the
// existing `MAPPING_REVIEWER_DEFAULT_TIMEOUT_MS`). `maxDuration` is set
// generously so a legitimate generation isn't cut short by the platform
// mid-attempt; the calling client applies its own shorter, independent
// timeout to its fetch (see `lib/recipes.ts`'s
// `triggerCookingModeMappingGeneration`) so the publish flow itself is never
// held open for the platform's full ceiling — see PRD.md for the exact
// values and rationale.
export const maxDuration = 280

export const MAPPING_GENERATE_MAX_BODY_BYTES = 2_000

const REQUEST_SCHEMA = z.object({
  recipeId: z.string().min(1).max(300),
  // Optional optimistic-concurrency guard: if supplied, must match the
  // recipe's current live mapping revision or the request is rejected as a
  // conflict rather than silently generating against unexpected content.
  expectedRecipeRevision: z.string().min(1).max(400).optional(),
}).strict()

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAdminToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parsed = REQUEST_SCHEMA.safeParse(await readBoundedJson(req, MAPPING_GENERATE_MAX_BODY_BYTES))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
    const { recipeId, expectedRecipeRevision } = parsed.data

    const recipe = await getRecipeById(recipeId)
    if (!recipe) return NextResponse.json({ error: 'Recipe not found.' }, { status: 404 })

    if (expectedRecipeRevision) {
      const { ingredients, instructions } = parseRecipeContent(recipe.content)
      const liveRevision = await computeMappingRecipeRevision({
        recipeId: recipe.id, parserVersion: COOKING_MAPPING_PARSER_VERSION, ingredients, instructions,
      })
      if (liveRevision !== expectedRecipeRevision) {
        return NextResponse.json({ error: 'This recipe changed since this request was made — refresh and try again.' }, { status: 409 })
      }
    }

    const result = await generateAndPersistCookingModeMappingProposal({
      recipeId, recipe, userId: uid,
    })

    return NextResponse.json({
      recipeId: result.recipeId,
      recipeRevision: result.recipeRevision,
      proposalId: result.proposalId,
      outcome: result.outcome,
      candidateCount: result.candidateCount,
      autoAcceptCount: result.autoAcceptCount,
      reviewRequiredCount: result.reviewRequiredCount,
      approvalBlocked: result.approvalBlocked,
      blockingReasons: result.blockingReasons,
      ...(result.error ? { error: result.error } : {}),
    })
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[mapping-generate] request failed', { error: safeErrorLogDetails(error) })
    return NextResponse.json({ error: 'Couldn’t start mapping generation — try again.' }, { status: 500 })
  }
}
