// Shared fail-closed error types for Cooking Mode mapping persistence.
// Kept in their own module (rather than defined once per service file) so
// every persistence service throws/catches the *same* class identity —
// `instanceof MappingPersistenceConflictError` must hold regardless of which
// service file raised it.

export class MappingPersistenceConflictError extends Error {
  readonly code = 'MAPPING_PERSISTENCE_CONFLICT'
  readonly details: Record<string, unknown>

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'MappingPersistenceConflictError'
    this.details = details
  }
}

export class MappingPersistenceFailureError extends Error {
  readonly code = 'MAPPING_PERSISTENCE_FAILURE'
  readonly details: Record<string, unknown>

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'MappingPersistenceFailureError'
    this.details = details
  }
}
