import 'server-only'

import { getAdminDb } from '@/lib/firebaseAdmin'

// ── Physical Firestore paths ────────────────────────────────────────────────
//
// recipes/{recipeId}/mappingProposals/{proposalId}
// recipes/{recipeId}/mappingProposals/{proposalId}/candidates/{candidateId}
// recipes/{recipeId}/mappingProposals/{proposalId}/reviewEvents/{reviewEventId}
// recipes/{recipeId}/approvedMappings/{mapId}
// recipes/{recipeId}/cookingModeMappingPointer/current   (single doc)
//
// Rationale (see PRD.md "Firestore rules" and Section 3 for the full writeup):
// - These are shared-catalog artifacts scoped to one recipe, so they live
//   under the existing `recipes/{id}` root doc rather than under any
//   `users/{uid}` tree — there is exactly one recipe-admin identity in this
//   app and mapping truth follows the shared recipe, not a user.
// - Subcollections (not one embedded array) keep the recipe document itself
//   untouched and let a candidate population of dozens of rows be written
//   without a single-document size/array-growth risk.
// - Every query this module needs is either a full read of one small,
//   bounded subcollection (a proposal's candidates/reviewEvents — observed
//   union sizes are tens of relationships per recipe, never Firestore's
//   document-count-per-read danger zone) or a get-by-known-id, so no
//   composite index is required anywhere in this design (Phase 18).
export const RECIPES_COLLECTION = 'recipes'
export const MAPPING_PROPOSALS_SUBCOLLECTION = 'mappingProposals'
export const MAPPING_CANDIDATES_SUBCOLLECTION = 'candidates'
export const MAPPING_REVIEW_EVENTS_SUBCOLLECTION = 'reviewEvents'
export const APPROVED_MAPPINGS_SUBCOLLECTION = 'approvedMappings'
export const MAPPING_POINTER_SUBCOLLECTION = 'cookingModeMappingPointer'
export const MAPPING_POINTER_DOC_ID = 'current'

// ── Minimal Firestore-shaped interface (dependency-injection seam) ─────────
//
// Production code always resolves this from `getAdminDb()` (Firebase Admin
// SDK, bypasses security rules, trusted-server-only). Tests inject an
// in-memory fake that implements this same narrow surface, so persistence
// logic (identity, idempotency, atomicity, conflict handling) is exercised
// deterministically without a live Firestore emulator. The real Admin SDK
// `Firestore` type is a structural superset of this interface.
export interface MappingFirestoreDocSnapshot {
  readonly id: string
  readonly exists: boolean
  data(): Record<string, unknown> | undefined
}

export interface MappingFirestoreDocRef {
  readonly id: string
  readonly path: string
  get(): Promise<MappingFirestoreDocSnapshot>
  set(data: Record<string, unknown>): Promise<unknown>
  collection(path: string): MappingFirestoreCollectionRef
}

export interface MappingFirestoreQuerySnapshot {
  readonly docs: MappingFirestoreDocSnapshot[]
  readonly size: number
}

export interface MappingFirestoreCollectionRef {
  doc(id?: string): MappingFirestoreDocRef
  get(): Promise<MappingFirestoreQuerySnapshot>
}

export interface MappingFirestoreBatch {
  set(ref: MappingFirestoreDocRef, data: Record<string, unknown>): void
  commit(): Promise<unknown>
}

export interface MappingFirestoreTransaction {
  get(ref: MappingFirestoreDocRef): Promise<MappingFirestoreDocSnapshot>
  set(ref: MappingFirestoreDocRef, data: Record<string, unknown>): void
}

export interface MappingFirestoreLike {
  collection(path: string): MappingFirestoreCollectionRef
  batch(): MappingFirestoreBatch
  runTransaction<T>(fn: (transaction: MappingFirestoreTransaction) => Promise<T>): Promise<T>
}

/**
 * Resolve the trusted Firestore client for mapping persistence. Always the
 * Firebase Admin SDK in production — never the client SDK — because these
 * are admin-only writes to a shared-catalog path (Phase 16). The cast is a
 * deliberate, narrow DI seam: `Firestore` structurally implements every
 * method `MappingFirestoreLike` declares; only the exact return-type shapes
 * differ (e.g. `WriteBatch` vs `void`), which is why the cast goes through
 * `unknown` rather than typechecking structurally end-to-end.
 */
export function resolveMappingFirestore(db?: MappingFirestoreLike): MappingFirestoreLike {
  return db ?? (getAdminDb() as unknown as MappingFirestoreLike)
}

export function recipeDocRef(db: MappingFirestoreLike, recipeId: string): MappingFirestoreDocRef {
  return db.collection(RECIPES_COLLECTION).doc(recipeId)
}

export function mappingProposalsCollection(
  db: MappingFirestoreLike,
  recipeId: string,
): MappingFirestoreCollectionRef {
  return recipeDocRef(db, recipeId).collection(MAPPING_PROPOSALS_SUBCOLLECTION)
}

export function mappingProposalDocRef(
  db: MappingFirestoreLike,
  recipeId: string,
  proposalId: string,
): MappingFirestoreDocRef {
  return mappingProposalsCollection(db, recipeId).doc(proposalId)
}

export function mappingCandidatesCollection(
  db: MappingFirestoreLike,
  recipeId: string,
  proposalId: string,
): MappingFirestoreCollectionRef {
  return mappingProposalDocRef(db, recipeId, proposalId).collection(MAPPING_CANDIDATES_SUBCOLLECTION)
}

export function mappingCandidateDocRef(
  db: MappingFirestoreLike,
  recipeId: string,
  proposalId: string,
  candidateId: string,
): MappingFirestoreDocRef {
  return mappingCandidatesCollection(db, recipeId, proposalId).doc(candidateId)
}

export function mappingReviewEventsCollection(
  db: MappingFirestoreLike,
  recipeId: string,
  proposalId: string,
): MappingFirestoreCollectionRef {
  return mappingProposalDocRef(db, recipeId, proposalId).collection(MAPPING_REVIEW_EVENTS_SUBCOLLECTION)
}

export function mappingReviewEventDocRef(
  db: MappingFirestoreLike,
  recipeId: string,
  proposalId: string,
  reviewEventId: string,
): MappingFirestoreDocRef {
  return mappingReviewEventsCollection(db, recipeId, proposalId).doc(reviewEventId)
}

export function approvedMappingsCollection(
  db: MappingFirestoreLike,
  recipeId: string,
): MappingFirestoreCollectionRef {
  return recipeDocRef(db, recipeId).collection(APPROVED_MAPPINGS_SUBCOLLECTION)
}

export function approvedMappingDocRef(
  db: MappingFirestoreLike,
  recipeId: string,
  mapId: string,
): MappingFirestoreDocRef {
  return approvedMappingsCollection(db, recipeId).doc(mapId)
}

export function mappingPointerDocRef(db: MappingFirestoreLike, recipeId: string): MappingFirestoreDocRef {
  return recipeDocRef(db, recipeId).collection(MAPPING_POINTER_SUBCOLLECTION).doc(MAPPING_POINTER_DOC_ID)
}
