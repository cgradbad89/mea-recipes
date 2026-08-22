import { describe, expect, it } from 'vitest'
import { chunkItems, FIRESTORE_SAFE_BATCH_SIZE } from '@/lib/chunkItems'

describe('Firestore batch chunking', () => {
  it('keeps every chunk at or below the 450-write safety limit', () => {
    const items = Array.from({ length: 1_001 }, (_, index) => index)
    const chunks = chunkItems(items)

    expect(chunks.map(chunk => chunk.length)).toEqual([450, 450, 101])
    expect(chunks.flat()).toEqual(items)
    expect(Math.max(...chunks.map(chunk => chunk.length))).toBe(FIRESTORE_SAFE_BATCH_SIZE)
  })

  it('does not create an empty commit chunk', () => {
    expect(chunkItems([])).toEqual([])
  })
})
