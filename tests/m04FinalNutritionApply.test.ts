import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { loadEnv } from '../scripts/_lib.js'

vi.mock('server-only', () => ({}))

const ROOT = process.cwd()
const READINESS_PATH = path.join(ROOT, 'docs/audits/m04-nutrition-final-readiness-2026-08-22.md')
const RAW_PATH = path.join(ROOT, 'docs/audits/m04-nutrition-final-raw-2026-08-22.json')
const BACKUP_PATH = path.join(ROOT, 'docs/audits/m04-final-nutrition-apply-backup-2026-08-22.json')
const RESULT_PATH = path.join(ROOT, 'docs/audits/m04-final-nutrition-apply-results-2026-08-22.json')
const MACROS = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g'] as const
const APPLY_CONFIRM = process.env.M04_APPLY_CONFIRM === 'YES'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

function serialize(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return { __type: 'Date', value: value.toISOString() }
  if (value && typeof value === 'object' && 'seconds' in value && 'nanoseconds' in value) {
    const timestamp = value as { seconds: unknown; nanoseconds: unknown }
    return { __type: 'Timestamp', seconds: String(timestamp.seconds), nanoseconds: Number(timestamp.nanoseconds) }
  }
  if (Array.isArray(value)) return value.map(serialize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, serialize(v)]))
  }
  return String(value)
}

function stable(value: unknown): string {
  return JSON.stringify(serialize(value))
}

function extractAllowlist(): string[] {
  const report = fs.readFileSync(READINESS_PATH, 'utf8')
  const section = report.match(/## Exact apply allowlist[\s\S]*?```text\nREADY_FOR_APPLY:\n([\s\S]*?)\n```/)?.[1] || ''
  return section.split('\n').map(line => line.match(/^-\s+([a-z0-9-]+)$/)?.[1]).filter((id): id is string => Boolean(id))
}

function materialMacroDifference(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return MACROS.some(key => {
    const av = typeof a[key] === 'number' ? a[key] as number : 0
    const bv = typeof b[key] === 'number' ? b[key] as number : 0
    return Math.abs(av - bv) > (key === 'calories' ? Math.max(25, Math.abs(bv) * 0.2) : Math.max(2, Math.abs(bv) * 0.25))
  })
}

function rank(confidence: unknown): number {
  return confidence === 'high' ? 2 : confidence === 'medium' ? 1 : confidence === 'low' ? 0 : -1
}

function nutritionSummary(nutrition: Record<string, any> | undefined) {
  return {
    servings: nutrition?.servings ?? null,
    confidence: nutrition?.confidence ?? null,
    source: nutrition?.source ?? null,
    perServing: Object.fromEntries(MACROS.map(key => [key, nutrition?.[key] ?? null])),
    total: Object.fromEntries(MACROS.map(key => [key, nutrition?.total?.[key] ?? null])),
  }
}

describe.skipIf(process.env.M04_RUN_CONTROLLED_APPLY !== 'YES')('M-04 final controlled nutrition apply', () => {
  it('applies only the authoritative five-ID allowlist with backup, gates, and read-back verification', async () => {
    const allowlist = extractAllowlist()
    expect(allowlist).toHaveLength(5)
    expect(new Set(allowlist).size).toBe(5)

    const raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8')) as { rows: any[] }
    const reviewed = new Map(raw.rows.map(row => [row.recipeId, row]))
    expect(allowlist.every(id => reviewed.has(id))).toBe(true)

    loadEnv()
    const { getAdminDb } = await import('@/lib/firebaseAdmin')
    const { computeRecipeNutrition } = await import('@/lib/nutritionEngine')
    const db = getAdminDb()
    const collection = db.collection('recipes')
    const beforeSnap = await collection.get()
    const before = new Map(beforeSnap.docs.map(doc => [doc.id, doc.data()]))
    expect(allowlist.every(id => before.has(id))).toBe(true)

    if (!fs.existsSync(BACKUP_PATH)) {
      const documents = allowlist.map(recipeId => {
        const data = before.get(recipeId) || {}
        return {
          recipeID: recipeId,
          title: data.title || recipeId,
          nutrition: serialize(data.nutrition),
          nutritionStatus: data.nutritionStatus ?? null,
          servings: data.servings ?? null,
          modified: serialize(data.modified),
          nutrition_prev: serialize(data.nutrition_prev),
          document: serialize(data),
        }
      })
      fs.writeFileSync(BACKUP_PATH, `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        collection: 'recipes',
        allowlist,
        documents,
        credentialScan: 'No credentials or environment values included; recipe data only.',
      }, null, 2)}\n`)
    }

    const results: any[] = []
    for (const recipeId of allowlist) {
      const old = before.get(recipeId) || {}
      const reviewedRow = reviewed.get(recipeId)
      const fresh = await computeRecipeNutrition(recipeId)
      const reviewedNutrition = reviewedRow.proposedNutrition || {}
      const currentSummary = nutritionSummary(fresh.nutrition)
      const reviewedSummary = nutritionSummary(reviewedNutrition)
      const freshUnresolved = fresh.unresolved as string[]
      const reviewedUnresolved = new Set<string>(reviewedRow.unresolved || [])
      const newUnresolved = freshUnresolved.filter(item => !reviewedUnresolved.has(item))
      const valid = MACROS.every(key => typeof fresh.nutrition.total?.[key] === 'number' && Number.isFinite(fresh.nutrition.total[key]))
      const gateReasons: string[] = []
      if (!valid || (fresh.nutrition.total?.calories ?? 0) <= 0) gateReasons.push('invalid nutrition total')
      if (newUnresolved.length) gateReasons.push(`new unresolved ingredients: ${newUnresolved.join('; ')}`)
      if (rank(fresh.nutrition.confidence) < rank(reviewedNutrition.confidence)) gateReasons.push('confidence degraded')
      if (fresh.nutrition.servings !== reviewedNutrition.servings) gateReasons.push('serving basis changed')
      if (materialMacroDifference(currentSummary.perServing, reviewedSummary.perServing)) gateReasons.push('material macro change versus reviewed final evidence')
      const gate = gateReasons.length === 0
      let write = 'NOT_AUTHORIZED'
      let readBack: any = null
      let finalStatus = gate ? 'PENDING_APPLY' : 'SKIPPED_CHANGED_RESULT'

      if (APPLY_CONFIRM && gate) {
        const existingPrev = old.nutrition_prev
        const previousNutrition = existingPrev && typeof existingPrev === 'object' ? existingPrev : old.nutrition
        await collection.doc(recipeId).set({
          nutrition: fresh.nutrition,
          nutritionStatus: 'computed',
          nutrition_prev: previousNutrition,
        }, { merge: true })
        write = 'APPLIED'
        const afterDoc = await collection.doc(recipeId).get()
        readBack = afterDoc.data() || {}
        const expectedUnrelated = { ...old }
        delete expectedUnrelated.nutrition
        delete expectedUnrelated.nutritionStatus
        delete expectedUnrelated.nutrition_prev
        const actualUnrelated = { ...readBack }
        delete actualUnrelated.nutrition
        delete actualUnrelated.nutritionStatus
        delete actualUnrelated.nutrition_prev
        const readBackOk = afterDoc.exists
          && readBack.nutritionStatus === 'computed'
          && stable(nutritionSummary(readBack.nutrition)) === stable(nutritionSummary(fresh.nutrition))
          && stable(expectedUnrelated) === stable(actualUnrelated)
        if (!readBackOk) {
          await collection.doc(recipeId).set(old, { merge: false })
          const restored = await collection.doc(recipeId).get()
          if (stable(restored.data() || {}) !== stable(old)) throw new Error(`Could not restore ${recipeId} after read-back failure`)
          finalStatus = 'APPLY_FAILED_RESTORED'
          throw new Error(`Read-back verification failed for ${recipeId}; document restored`)
        }
        finalStatus = 'APPLIED_VERIFIED'
      } else if (!APPLY_CONFIRM && gate) {
        finalStatus = 'DRY_RUN_ONLY'
      }

      results.push({
        recipeId,
        title: old.title || recipeId,
        reviewed: reviewedSummary,
        fresh: currentSummary,
        freshUnresolved,
        newUnresolved,
        gate,
        gateReasons,
        write,
        readBack: readBack ? nutritionSummary(readBack.nutrition) : null,
        finalStatus,
      })
    }

    const afterSnap = await collection.get()
    const after = new Map(afterSnap.docs.map(doc => [doc.id, doc.data()]))
    const denylistChanged = [...after.keys()]
      .filter(id => !allowlist.includes(id))
      .filter(id => stable(before.get(id) || {}) !== stable(after.get(id) || {}))
    expect(denylistChanged).toEqual([])

    if (APPLY_CONFIRM) {
      expect(results.filter(result => result.write === 'APPLIED')).toHaveLength(results.filter(result => result.gate).length)
      expect(results.every(result => ['APPLIED_VERIFIED', 'SKIPPED_CHANGED_RESULT'].includes(result.finalStatus))).toBe(true)
    }
    fs.writeFileSync(RESULT_PATH, `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      mode: APPLY_CONFIRM ? 'controlled apply' : 'pre-write dry-run only',
      allowlist,
      writes: results.filter(result => result.write === 'APPLIED').length,
      recipeCreates: 0,
      recipeDeletes: 0,
      nutritionWrites: results.filter(result => result.write === 'APPLIED').length,
      canonicalWrites: 0,
      nutritionLogWrites: 0,
      denylistChanged,
      results,
    }, null, 2)}\n`)
  }, 180000)
})
