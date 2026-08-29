// In-memory Firestore test double for Cooking Mode mapping persistence.
//
// Implements exactly `MappingFirestoreLike` (lib/cookingModeMappingFirestore.ts)
// so persistence services can be exercised deterministically without a live
// Firestore emulator. This is intentionally NOT a security-rules test double —
// it has no concept of auth or rules — see the "Firestore rules" testing
// note in the persistence test files for why rules coverage is a documented
// manual-verification gap instead.
import type {
  MappingFirestoreBatch,
  MappingFirestoreCollectionRef,
  MappingFirestoreDocRef,
  MappingFirestoreDocSnapshot,
  MappingFirestoreLike,
  MappingFirestoreTransaction,
} from '@/lib/cookingModeMappingFirestore'

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value)
}

export interface FakeMappingFirestoreOptions {
  /**
   * Doc ids whose `.set()` silently no-ops, simulating a partial/dropped
   * write for atomicity tests (Implementation-3 Phase 9) without needing a
   * real Firestore emulator to reproduce mid-batch failure.
   */
  poisonedDocIds?: Set<string>
}

export function createFakeMappingFirestore(options: FakeMappingFirestoreOptions = {}): MappingFirestoreLike {
  const store = new Map<string, Record<string, unknown>>()
  const poisonedDocIds = options.poisonedDocIds ?? new Set<string>()
  let autoId = 0

  function docRef(path: string): MappingFirestoreDocRef {
    const id = path.slice(path.lastIndexOf('/') + 1)
    return {
      id,
      path,
      async get(): Promise<MappingFirestoreDocSnapshot> {
        const data = store.get(path)
        return {
          id,
          exists: data !== undefined,
          data: () => clone(data),
        }
      },
      async set(data: Record<string, unknown>, setOptions?: { merge?: boolean }) {
        if (poisonedDocIds.has(id)) return undefined
        store.set(path, setOptions?.merge ? { ...clone(store.get(path) ?? {}), ...clone(data) } : clone(data))
        return undefined
      },
      collection(sub: string): MappingFirestoreCollectionRef {
        return collectionRef(`${path}/${sub}`)
      },
    }
  }

  function collectionRef(path: string): MappingFirestoreCollectionRef {
    return {
      doc(id?: string): MappingFirestoreDocRef {
        return docRef(`${path}/${id ?? `auto${autoId++}`}`)
      },
      async get() {
        const prefix = `${path}/`
        const docs: MappingFirestoreDocSnapshot[] = []
        for (const [key, value] of store.entries()) {
          if (!key.startsWith(prefix)) continue
          const rest = key.slice(prefix.length)
          if (rest.includes('/')) continue
          docs.push({ id: rest, exists: true, data: () => clone(value) })
        }
        return { docs, size: docs.length }
      },
    }
  }

  return {
    collection(path: string) {
      return collectionRef(path)
    },
    batch(): MappingFirestoreBatch {
      const ops: Array<{ ref: MappingFirestoreDocRef; data: Record<string, unknown> }> = []
      return {
        set(ref, data) {
          ops.push({ ref, data })
        },
        async commit() {
          for (const op of ops) await op.ref.set(op.data)
          return undefined
        },
      }
    },
    async runTransaction<T>(fn: (transaction: MappingFirestoreTransaction) => Promise<T>): Promise<T> {
      const transaction: MappingFirestoreTransaction = {
        get: ref => ref.get(),
        set: (ref, data, setOptions) => {
          const writable = ref as MappingFirestoreDocRef & {
            set(data: Record<string, unknown>, options?: { merge?: boolean }): Promise<unknown>
          }
          void writable.set(data, setOptions)
        },
      }
      return fn(transaction)
    },
  }
}
