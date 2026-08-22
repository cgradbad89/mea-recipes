import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseRecipeContent } from '@/lib/recipeContent'

// The remediation module is CommonJS so it remains directly runnable by Node.
const { repairs, deferred, serializeFirestore, slugify } = require('../scripts/remediate-m04-recipes.js') as {
  repairs: Array<{ oldId: string; newId?: string; title: string; content: string }>
  deferred: Array<{ id: string; reason: string }>
  serializeFirestore: (value: unknown) => unknown
  slugify: (value: string) => string
}

describe('M-04 remediation plan', () => {
  it('covers ten repairs and the two evidence-blocked records exactly once', () => {
    const ids = [...repairs.map(repair => repair.oldId), ...deferred.map(item => item.id)]
    expect(repairs).toHaveLength(10)
    expect(deferred.map(item => item.id).sort()).toEqual(['maple-roasted-candied-pecans', 'smoothies'])
    expect(new Set(ids).size).toBe(12)
  })

  it('parses every proposal and permits missing instructions only for the two source-faithful cases', () => {
    for (const repair of repairs) {
      const parsed = parseRecipeContent(repair.content)
      expect(parsed.ingredients.length, repair.oldId).toBeGreaterThan(0)
      if (!['rising-sun-mazcal', 'speget-with-fake-meat-meatballs'].includes(repair.oldId)) {
        expect(parsed.instructions.length, repair.oldId).toBeGreaterThan(0)
      }
    }
  })

  it('uses the canonical title slug for the only document migration', () => {
    const migrations = repairs.filter(repair => repair.newId)
    expect(migrations).toHaveLength(1)
    expect(migrations[0].newId).toBe(slugify(migrations[0].title))
    expect(migrations[0].newId).toBe('chopped-thai-shrimp-salad-with-garlic-lime-dressing')
  })

  it('serializes Firestore timestamps losslessly for the rollback backup', () => {
    const timestamp = { seconds: 123, nanoseconds: 456, toDate: () => new Date(0) }
    expect(serializeFirestore({ timestamp })).toEqual({
      timestamp: { __firestoreType: 'Timestamp', seconds: 123, nanoseconds: 456 },
    })
    expect(createHash('sha256').update(repairs[0].content).digest('hex')).toBe(
      '3729c2e55bc5c6eb9deb51898c3ce2b53800f97312b5e9f771d2dcb32b55fad2',
    )
  })
})
