import { canonicalizeCookingMappingSource, computeCookingMappingSourceHash } from '@/lib/cookingStepMapping'
import { isIngredientSubheader } from '@/lib/recipeContent'
import type {
  MappingCandidateIdentityInput,
  MappingCandidateStructuralInput,
  MappingRevisionSource,
  MappingStructuralReason,
  MappingStructuralValidation,
} from '@/types/cookingModeMapping'
import { MAPPING_STRUCTURAL_REASON_ORDER } from '@/types/cookingModeMapping'

export function canonicalizeMappingRecipeRevisionSource(input: MappingRevisionSource): string {
  return canonicalizeCookingMappingSource(input.ingredients, input.instructions)
}

export async function computeMappingRecipeRevision(input: MappingRevisionSource): Promise<string> {
  const mappingSourceHash = await computeCookingMappingSourceHash(input.ingredients, input.instructions)
  return `${input.parserVersion}:sha256:${mappingSourceHash}`
}

export function canonicalizeMappingCandidateIdentity(input: MappingCandidateIdentityInput): string {
  return JSON.stringify([
    'mapping-candidate',
    1,
    input.recipeId,
    input.recipeRevision,
    input.ingredientRowIndex,
    input.stepIndex,
  ])
}

async function sha256(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto API is required to hash cooking mapping identities')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function computeMappingCandidateId(input: MappingCandidateIdentityInput): Promise<string> {
  return `mc1:${await sha256(canonicalizeMappingCandidateIdentity(input))}`
}

function candidateIdentityTuple(candidate: MappingCandidateStructuralInput): string {
  return canonicalizeMappingCandidateIdentity(candidate)
}

function canonicalStructuralReasons(reasons: Iterable<MappingStructuralReason>): MappingStructuralReason[] {
  const values = new Set(reasons)
  return MAPPING_STRUCTURAL_REASON_ORDER.filter(reason => values.has(reason))
}

export async function validateMappingCandidateStructure(
  candidate: MappingCandidateStructuralInput,
  source: MappingRevisionSource,
  existingCandidates: readonly MappingCandidateStructuralInput[] = [],
): Promise<MappingStructuralValidation> {
  const reasons = new Set<MappingStructuralReason>()
  const mappingSourceHash = await computeCookingMappingSourceHash(source.ingredients, source.instructions)
  const recipeRevision = `${source.parserVersion}:sha256:${mappingSourceHash}`

  if (
    candidate.recipeId !== source.recipeId ||
    candidate.parserVersion !== source.parserVersion ||
    candidate.mappingSourceHash !== mappingSourceHash ||
    candidate.recipeRevision !== recipeRevision
  ) {
    reasons.add('INVALID_RECIPE_REVISION')
  }

  const ingredientIndexValid = Number.isInteger(candidate.ingredientRowIndex) &&
    candidate.ingredientRowIndex >= 0 && candidate.ingredientRowIndex < source.ingredients.length
  if (!ingredientIndexValid) {
    reasons.add('INVALID_INGREDIENT_INDEX')
  } else {
    if (isIngredientSubheader(source.ingredients[candidate.ingredientRowIndex])) {
      reasons.add('INGREDIENT_HEADER_INDEX')
    }
    if (candidate.ingredientText !== source.ingredients[candidate.ingredientRowIndex]) {
      reasons.add('SOURCE_SNAPSHOT_MISMATCH')
    }
  }

  const stepIndexValid = Number.isInteger(candidate.stepIndex) &&
    candidate.stepIndex >= 0 && candidate.stepIndex < source.instructions.length
  if (!stepIndexValid) {
    reasons.add('INVALID_STEP_INDEX')
  } else if (candidate.stepText !== source.instructions[candidate.stepIndex]) {
    reasons.add('SOURCE_SNAPSHOT_MISMATCH')
  }

  const expectedCandidateId = await computeMappingCandidateId(candidate)
  if (candidate.candidateId !== expectedCandidateId) reasons.add('CANDIDATE_ID_COLLISION')

  const tuple = candidateIdentityTuple(candidate)
  for (const existing of existingCandidates) {
    const existingTuple = candidateIdentityTuple(existing)
    if (existingTuple === tuple) reasons.add('DUPLICATE_CANDIDATE_IDENTITY')
    if (existing.candidateId === candidate.candidateId && existingTuple !== tuple) {
      reasons.add('CANDIDATE_ID_COLLISION')
    }
  }

  const orderedReasons = canonicalStructuralReasons(reasons)
  return { valid: orderedReasons.length === 0, reasons: orderedReasons }
}
