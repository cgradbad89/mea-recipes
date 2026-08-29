// Recursively converts Firestore Admin SDK Timestamp-like values (anything
// with a `.toDate()` method) into RFC 3339 ISO strings before a mapping-
// review API route hands persisted domain objects to the client. Keeps
// every `unknown` server-timestamp field in the persistence types
// (createdAt/updatedAt/decidedAt/attestedAt/approvedAt) from crossing the
// wire as an opaque, non-JSON-friendly object.

function isTimestampLike(value: unknown): value is { toDate: () => Date } {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  )
}

export function serializeMappingTimestamps<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => serializeMappingTimestamps(item)) as unknown as T
  }
  if (isTimestampLike(value)) {
    return value.toDate().toISOString() as unknown as T
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = serializeMappingTimestamps(entry)
    }
    return out as T
  }
  return value
}
