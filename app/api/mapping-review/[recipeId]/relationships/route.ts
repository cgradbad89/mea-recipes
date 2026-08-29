import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyAdminToken } from '@/lib/firebaseAdmin'
import { ApiRequestError, readBoundedJson, safeErrorLogDetails } from '@/lib/apiRequest'
import { getRecipeById } from '@/lib/recipes'
import { parseRecipeContent } from '@/lib/recipeContent'
import { COOKING_MAPPING_PARSER_VERSION } from '@/lib/cookingStepMapping'
import {
  addHumanMappingRelationship,
  removeHumanMappingRelationship,
  AddHumanMappingRelationshipRejectedError,
  RemoveHumanMappingRelationshipRejectedError,
} from '@/lib/cookingModeMappingHumanRelationship'
import { MAPPING_HUMAN_REVIEW_REASON_ORDER } from '@/types/cookingModeMappingPersistence'
import { serializeMappingTimestamps } from '@/lib/mappingReviewSerialize'
import type { MappingRevisionSource } from '@/types/cookingModeMapping'

export const MAPPING_RELATIONSHIP_MAX_BODY_BYTES = 8_000
const MAX_NOTE_LENGTH = 2_000

const ADD_SCHEMA = z.object({
  proposalId: z.string().min(1),
  recipeRevision: z.string().min(1),
  ingredientRowIndex: z.number().int().min(0),
  stepIndex: z.number().int().min(0),
  reasonCode: z.enum(MAPPING_HUMAN_REVIEW_REASON_ORDER).optional(),
  note: z.string().max(MAX_NOTE_LENGTH).nullable().optional(),
})

const REMOVE_SCHEMA = z.object({
  proposalId: z.string().min(1),
  candidateId: z.string().min(1),
  recipeRevision: z.string().min(1),
  reasonCode: z.enum(MAPPING_HUMAN_REVIEW_REASON_ORDER),
  note: z.string().max(MAX_NOTE_LENGTH).nullable().optional(),
})

function addRejectionMessage(reason: string): string {
  switch (reason) {
    case 'PROPOSAL_NOT_FOUND':
      return 'This recipe’s mapping proposal no longer exists.'
    case 'PROPOSAL_NOT_READY':
      return 'This recipe’s mapping proposal hasn’t finished generating.'
    case 'REVISION_MISMATCH':
      return 'This recipe changed since this mapping was created — refresh to continue.'
    case 'INGREDIENT_HEADER_INDEX':
      return 'That row is a section header, not an ingredient.'
    case 'INVALID_INGREDIENT_INDEX':
    case 'INVALID_STEP_INDEX':
      return 'That ingredient or step no longer exists on this recipe.'
    default:
      return 'Couldn’t add that relationship — try again.'
  }
}

async function liveSourceFor(recipeId: string): Promise<MappingRevisionSource | null> {
  const recipe = await getRecipeById(recipeId)
  if (!recipe) return null
  const { ingredients, instructions } = parseRecipeContent(recipe.content)
  return { recipeId, parserVersion: COOKING_MAPPING_PARSER_VERSION, ingredients, instructions }
}

/**
 * Human-added missing relationship (Phase 15, architecture-contract §26).
 * The recipe's current parsed source is always re-derived server-side from
 * the live recipe document — never trusted from the client — so structural
 * validation and the revision match are judged against reality.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ recipeId: string }> }) {
  try {
    const uid = await verifyAdminToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { recipeId } = await context.params
    const parsed = ADD_SCHEMA.safeParse(await readBoundedJson(req, MAPPING_RELATIONSHIP_MAX_BODY_BYTES))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

    const source = await liveSourceFor(recipeId)
    if (!source) return NextResponse.json({ error: 'Recipe not found.' }, { status: 404 })

    const result = await addHumanMappingRelationship({
      recipeId,
      proposalId: parsed.data.proposalId,
      recipeRevision: parsed.data.recipeRevision,
      source,
      ingredientRowIndex: parsed.data.ingredientRowIndex,
      stepIndex: parsed.data.stepIndex,
      reasonCode: parsed.data.reasonCode,
      note: parsed.data.note ?? null,
      addedBy: uid,
    })

    return NextResponse.json(serializeMappingTimestamps(result))
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof AddHumanMappingRelationshipRejectedError) {
      return NextResponse.json({ error: addRejectionMessage(error.reason) }, { status: 409 })
    }
    console.error('[mapping-review-relationships] add failed', { error: safeErrorLogDetails(error) })
    return NextResponse.json({ error: 'Couldn’t add that relationship — try again.' }, { status: 500 })
  }
}

/** Removal/correction of a human-added relationship (Phase 16). */
export async function DELETE(req: NextRequest, context: { params: Promise<{ recipeId: string }> }) {
  try {
    const uid = await verifyAdminToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { recipeId } = await context.params
    const parsed = REMOVE_SCHEMA.safeParse(await readBoundedJson(req, MAPPING_RELATIONSHIP_MAX_BODY_BYTES))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

    const event = await removeHumanMappingRelationship({
      recipeId,
      proposalId: parsed.data.proposalId,
      candidateId: parsed.data.candidateId,
      recipeRevision: parsed.data.recipeRevision,
      reasonCode: parsed.data.reasonCode,
      note: parsed.data.note ?? null,
      removedBy: uid,
    })

    return NextResponse.json({ decision: serializeMappingTimestamps(event) })
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof RemoveHumanMappingRelationshipRejectedError) {
      const message = error.reason === 'NOT_HUMAN_ADDED'
        ? 'Only a relationship you added can be removed this way.'
        : 'This item no longer exists in the current review.'
      return NextResponse.json({ error: message }, { status: 409 })
    }
    console.error('[mapping-review-relationships] remove failed', { error: safeErrorLogDetails(error) })
    return NextResponse.json({ error: 'Couldn’t remove that relationship — try again.' }, { status: 500 })
  }
}
