export const FIRESTORE_SAFE_BATCH_SIZE = 450

export function chunkItems<T>(items: readonly T[], size = FIRESTORE_SAFE_BATCH_SIZE): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error('Batch chunk size must be a positive integer')
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}
