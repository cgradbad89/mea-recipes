import { writeBatch, type Firestore, type WriteBatch } from 'firebase/firestore'
import { chunkItems } from './chunkItems'

export { FIRESTORE_SAFE_BATCH_SIZE } from './chunkItems'

export type FirestoreBatchOperation = (batch: WriteBatch) => void

/** Commit write operations sequentially, staying below Firestore's 500-write cap. */
export async function commitFirestoreBatches(
  firestore: Firestore,
  operations: readonly FirestoreBatchOperation[],
): Promise<void> {
  for (const chunk of chunkItems(operations)) {
    const batch = writeBatch(firestore)
    chunk.forEach(operation => operation(batch))
    await batch.commit()
  }
}
