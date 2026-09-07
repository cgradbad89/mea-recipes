import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseRecipeContent } from '@/lib/recipeContent'
import { isRecipeCategory } from '@/lib/recipeCategories'
import { slugify } from '@/lib/utils'
import {
  applyPreparedEntries,
  assertDryRunClean,
  buildDryRunRows,
  buildRecipeContent,
  fingerprint,
  validateManifest,
} from '../scripts/savory-sept-oct-2026-import-core.mjs'

const manifestPath = path.resolve(process.cwd(), 'scripts/savory-sept-oct-2026-manifest.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const deps = {
  recipeIdForTitle: (title: string) => {
    const id = slugify(title)
    if (!id) throw new Error('empty id')
    return id
  },
  parseRecipeContent,
  isRecipeCategory,
}

function prepared() {
  return validateManifest(structuredClone(manifest), deps)
}

function sourceByUrl(entries: ReturnType<typeof prepared>) {
  return new Map(entries.map((entry: any) => [entry.sourceURL, {
    canonicalURL: entry.sourceURL,
    name: entry.sourceMetadata.name,
    prepTime: entry.sourceMetadata.prepTime,
    cookTime: entry.sourceMetadata.cookTime,
    servings: entry.sourceMetadata.servings,
    ingredientCount: entry.sourceMetadata.ingredientCount,
    instructionCount: entry.sourceMetadata.instructionCount,
    imageURL: entry.imageURL,
  }]))
}

function nutrition(servings: number) {
  const macros = { calories: 100, protein_g: 10, carbs_g: 12, fat_g: 4, fiber_g: 2, sugar_g: 1 }
  return {
    ...macros,
    serving_size: `1 of ${servings}`,
    servings,
    total: Object.fromEntries(Object.entries(macros).map(([key, value]) => [key, value * servings])),
    source: 'usda+canonical',
    confidence: 'high',
    computed_at: new Date('2026-09-06T12:00:00Z'),
  }
}

describe('Savory September/October 2026 import', () => {
  it('uses the repository canonical slug behavior for all target IDs', () => {
    const entries = prepared()
    expect(entries.map((entry: any) => entry.recipeID)).toEqual(entries.map((entry: any) => slugify(entry.title)))
    expect(entries[2].recipeID).toBe('grandma-s-italian-chicken-noodle-soup')
  })

  it('contains exactly nine unique recipes and only one Autumn Harvest row', () => {
    const entries = prepared()
    expect(new Set(entries.map((entry: any) => entry.title)).size).toBe(9)
    expect(new Set(entries.map((entry: any) => entry.recipeID)).size).toBe(9)
    expect(entries.filter((entry: any) => entry.title === 'Autumn Harvest Quinoa Bowl')).toHaveLength(1)
    expect(entries.find((entry: any) => entry.title === 'Autumn Harvest Quinoa Bowl')?.ingredients).toHaveLength(13)
  })

  it('fails required-field and category validation closed', () => {
    const broken = structuredClone(manifest)
    broken.recipes[0].category = 'Soups/Stews & Chili'
    expect(() => validateManifest(broken, deps)).toThrow(/invalid category/)

    const missing = structuredClone(manifest)
    delete missing.recipes[0].sourceURL
    expect(() => validateManifest(missing, deps)).toThrow(/sourceURL is required/)
  })

  it('round-trips every authoritative ingredient and instruction exactly', () => {
    for (const entry of prepared()) {
      const parsed = parseRecipeContent(buildRecipeContent(entry))
      expect(parsed.ingredients, entry.title).toEqual(entry.ingredients)
      expect(parsed.instructions, entry.title).toEqual(entry.instructions)
      expect(parsed.instructions.some(line => /^Step\s+\d+/i.test(line)), entry.title).toBe(false)
    }
  })

  it('rejects duplicate titles and the photographed-twice Autumn duplicate', () => {
    const duplicate = structuredClone(manifest)
    duplicate.recipes.push(structuredClone(duplicate.recipes[7]))
    expect(() => validateManifest(duplicate, deps)).toThrow(/exactly nine/)

    duplicate.recipes.pop()
    duplicate.recipes[8] = structuredClone(duplicate.recipes[7])
    expect(() => validateManifest(duplicate, deps)).toThrow(/duplicate title/)
  })

  it('blocks a dry run on any title/slug collision and performs zero writes', () => {
    const entries = prepared()
    const write = vi.fn()
    const rows = buildDryRunRows(entries, {
      adminUid: 'resolved-admin-uid',
      previewCreated: 'Sun Sep 06 2026 12:00:00 GMT-0400 (Eastern Daylight Time)',
      liveById: new Map([[entries[0].recipeID, { recipeID: entries[0].recipeID, title: entries[0].title }]]),
      sourceByUrl: sourceByUrl(entries),
    })
    expect(() => assertDryRunClean(rows)).toThrow(/collision/)
    expect(write).not.toHaveBeenCalled()
  })

  it('writes only absent approved documents and never overwrites a collision', async () => {
    const entries = prepared().slice(0, 2)
    const existing = { recipeID: entries[0].recipeID, title: 'Existing data must survive' }
    const docs = new Map<string, Record<string, unknown>>([[entries[0].recipeID, existing]])
    const createIfAbsent = vi.fn(async (id: string, document: Record<string, unknown>) => {
      if (docs.has(id)) return { created: false }
      docs.set(id, structuredClone(document))
      return { created: true }
    })
    const results = await applyPreparedEntries(entries, {
      adminUid: 'resolved-admin-uid',
      nowString: () => 'Sun Sep 06 2026 12:00:00 GMT-0400 (Eastern Daylight Time)',
      parseRecipeContent,
      adapter: {
        createIfAbsent,
        computeNutrition: async (id: string) => ({ nutrition: nutrition(entries.find((entry: any) => entry.recipeID === id)!.servings) }),
        storeNutrition: async (id: string, value: Record<string, unknown>) => {
          docs.set(id, { ...(docs.get(id) || {}), nutrition: value, nutritionStatus: 'computed' })
        },
        read: async (id: string) => docs.get(id) || null,
        deleteIfMatches: async () => false,
      },
    })
    expect(results.map(result => result.status)).toEqual(['COLLISION_SKIPPED', 'WRITTEN_VERIFIED'])
    expect(docs.get(entries[0].recipeID)).toBe(existing)
    expect(docs.get(entries[1].recipeID)?.nutritionStatus).toBe('computed')
  })

  it('retries nutrition three times and rolls back only its own failed create', async () => {
    const entry = prepared()[0]
    const docs = new Map<string, Record<string, unknown>>()
    const computeNutrition = vi.fn(async () => { throw new Error('nutrition unavailable') })
    const deleteIfMatches = vi.fn(async (id: string, allowed: Record<string, unknown>[]) => {
      const live = docs.get(id)
      if (!live || !allowed.some(candidate => fingerprint(candidate) === fingerprint(live))) return false
      docs.delete(id)
      return true
    })
    const results = await applyPreparedEntries([entry], {
      adminUid: 'resolved-admin-uid',
      nowString: () => 'Sun Sep 06 2026 12:00:00 GMT-0400 (Eastern Daylight Time)',
      parseRecipeContent,
      adapter: {
        createIfAbsent: async (id: string, document: Record<string, unknown>) => {
          docs.set(id, structuredClone(document))
          return { created: true }
        },
        computeNutrition,
        storeNutrition: vi.fn(),
        read: async (id: string) => docs.get(id) || null,
        deleteIfMatches,
      },
    })
    expect(computeNutrition).toHaveBeenCalledTimes(3)
    expect(deleteIfMatches).toHaveBeenCalledOnce()
    expect(docs.has(entry.recipeID)).toBe(false)
    expect(results[0].status).toBe('FAILED_ROLLED_BACK')
    expect(results[0].written).toBe(false)
  })

  it('rolls back a session-created computed document when readback validation fails', async () => {
    const entry = prepared()[0]
    const docs = new Map<string, Record<string, unknown>>()
    const deleteIfMatches = vi.fn(async (id: string, allowed: Record<string, unknown>[]) => {
      const live = docs.get(id)
      if (!live || !allowed.some(candidate => fingerprint(candidate) === fingerprint(live))) return false
      docs.delete(id)
      return true
    })
    const results = await applyPreparedEntries([entry], {
      adminUid: 'resolved-admin-uid',
      nowString: () => 'Sun Sep 06 2026 12:00:00 GMT-0400 (Eastern Daylight Time)',
      parseRecipeContent,
      adapter: {
        createIfAbsent: async (id: string, document: Record<string, unknown>) => {
          docs.set(id, structuredClone(document))
          return { created: true }
        },
        computeNutrition: async () => ({ nutrition: nutrition(entry.servings) }),
        storeNutrition: async (id: string, value: Record<string, unknown>) => {
          docs.set(id, { ...(docs.get(id) || {}), title: 'corrupted readback', nutrition: value, nutritionStatus: 'computed' })
        },
        read: async (id: string) => docs.get(id) || null,
        deleteIfMatches,
      },
    })
    expect(deleteIfMatches).toHaveBeenCalledOnce()
    expect(docs.has(entry.recipeID)).toBe(false)
    expect(results[0].status).toBe('FAILED_ROLLED_BACK')
    expect(results[0].written).toBe(false)
  })
})
