import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken, getAdminDb } from '@/lib/firebaseAdmin'
import { computeRecipeNutrition } from '@/lib/nutritionEngine'
import { servingsAssumed } from '@/lib/nutrition'
import type { NutritionMacros, RecipeNutrition } from '@/types/recipe'

// ─── Canonical-staples recompute — DRY RUN ONLY (Batch 4) ─────────────────────
//
// Recomputes catalog nutrition with the new canonical-staples-aware engine and
// emits a DIFF. It does NOT — and CANNOT, in this batch — write anything: there
// is intentionally no apply path here. Stored nutrition/servings/confidence are
// untouched. A separate, later step applies after the diff is reviewed.
//
//   POST /api/nutrition-canonical-dryrun                    → whole catalog, batched
//   POST /api/nutrition-canonical-dryrun?limit=25&offset=0  → bounded window
//   POST /api/nutrition-canonical-dryrun?scope=low          → only confidence==='low' (Task-C projection)
//   POST /api/nutrition-canonical-dryrun?recipeId=<id>      → a single recipe (e.g. Easy Spaghetti)
//
// Method (isolates the canonical effect from everything else):
//   • proposed = computeRecipeNutrition(id, { useCanonical: true })  — new engine
//   • baseline = computeRecipeNutrition(id, { useCanonical: false }) — existing engine, recomputed now
//   • canonicalDelta = proposed.total − baseline.total  → attributable PURELY to the table
//   • old = the value stored in Firestore today (shown for reference)
// Baseline is computed in the SAME runtime as proposed, so the delta is exact even
// when the AI tier is unavailable (it just leaves the same ingredients unresolved
// in BOTH passes). Baseline is only computed for recipes with ≥1 canonical hit
// (others are unaffected by definition → baseline == proposed).
//
// Auth: Bearer token via verifyAuthToken, matching ai-ingest / grocery-cleanup /
// nutrition-revalidate.

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 50

const MACRO_KEYS: (keyof NutritionMacros)[] = [
  'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g',
]

function pickMacros(o: Partial<NutritionMacros> | undefined): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const k of MACRO_KEYS) {
    const v = o?.[k]
    out[k] = typeof v === 'number' && Number.isFinite(v) ? v : null
  }
  return out
}

/** proposed.total − baseline.total per macro (the isolated canonical effect). */
function macroDelta(proposed: NutritionMacros | undefined, baseline: NutritionMacros | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const k of MACRO_KEYS) {
    const p = proposed?.[k]; const b = baseline?.[k]
    out[k] = Math.round(((typeof p === 'number' ? p : 0) - (typeof b === 'number' ? b : 0)) * 10) / 10
  }
  return out
}

function anyMacroChanged(delta: Record<string, number>): boolean {
  // material change = any macro moved ≥0.5 (calories ≥1)
  return MACRO_KEYS.some(k => Math.abs(delta[k] || 0) >= (k === 'calories' ? 1 : 0.5))
}

export async function POST(req: NextRequest) {
  const uid = await verifyAuthToken(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = req.nextUrl.searchParams
  const scope = params.get('scope') === 'low' ? 'low' : 'all'
  const singleId = (params.get('recipeId') || '').trim()
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(params.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT))
  const offset = Math.max(0, parseInt(params.get('offset') || '0', 10) || 0)

  try {
    const db = getAdminDb()
    const snap = await db.collection('recipes').get()
    const all = snap.docs.map(d => ({ id: d.id, data: d.data() || {} }))

    // Candidate set (stable order so offset paging is deterministic).
    let candidates = all
      .filter(r => (r.data as any).title)
      .sort((a, b) => a.id.localeCompare(b.id))
    if (singleId) {
      candidates = candidates.filter(r => r.id === singleId)
    } else if (scope === 'low') {
      candidates = candidates.filter(r => ((r.data as any).nutrition as RecipeNutrition | undefined)?.confidence === 'low')
    }

    const batch = candidates.slice(offset, offset + limit)

    const diffs: any[] = []
    let affectedCount = 0    // ≥1 canonical hit
    let changedCount = 0     // canonical materially moved a macro
    let errorCount = 0

    for (const { id, data } of batch) {
      const old = (data as any).nutrition as RecipeNutrition | undefined
      const title = (data as any).title || id
      try {
        const proposed = await computeRecipeNutrition(id, { useCanonical: true })
        const affected = proposed.canonicalHits.length > 0
        // baseline only needed when there's a canonical hit (else identical).
        const baseline = affected
          ? await computeRecipeNutrition(id, { useCanonical: false })
          : proposed

        const delta = macroDelta(proposed.nutrition.total, baseline.nutrition.total)
        const changed = affected && anyMacroChanged(delta)
        if (affected) affectedCount++
        if (changed) changedCount++

        // Which ingredients resolved differently between baseline and proposed.
        const baseByName = new Map(baseline.resolutions.map(r => [r.name, r]))
        const resolutionChanges = proposed.resolutions
          .filter(r => r.resolvedBy === 'canonical')
          .map(r => {
            const b = baseByName.get(r.name)
            const before = b
              ? { resolvedBy: b.resolvedBy, description: b.matchedDescription, calPer100g: b.calPer100g, sugarPer100g: b.sugarPer100g, fiberPer100g: b.fiberPer100g }
              : null
            return {
              ingredient: r.name,
              grams: Math.round(r.grams),
              before,
              after: { resolvedBy: r.resolvedBy, fdcId: r.fdcId, description: r.matchedDescription, calPer100g: r.calPer100g, sugarPer100g: r.sugarPer100g, fiberPer100g: r.fiberPer100g },
              changed: !before || before.description !== r.matchedDescription,
            }
          })

        diffs.push({
          recipeId: id,
          title,
          affected,
          changed,
          canonicalHitCount: proposed.canonicalHits.length,
          old: {
            source: old?.source ?? null,
            confidence: old?.confidence ?? null,
            servings: old?.servings ?? null,
            total: pickMacros(old?.total),
            perServing: pickMacros(old),
          },
          baseline: {
            source: baseline.nutrition.source,
            confidence: baseline.nutrition.confidence,
            total: pickMacros(baseline.nutrition.total),
            unresolvedCount: baseline.unresolved.length,
          },
          proposed: {
            source: proposed.nutrition.source,
            confidence: proposed.nutrition.confidence,
            servings: proposed.nutrition.servings,
            total: pickMacros(proposed.nutrition.total),
            perServing: pickMacros(proposed.nutrition),
            unresolvedCount: proposed.unresolved.length,
            unresolved: proposed.unresolved.slice(0, 8),
          },
          canonicalDelta: delta,                 // proposed.total − baseline.total
          canonicalHits: proposed.canonicalHits, // {name, fdcId, description}
          resolutionChanges,
        })
      } catch (e: any) {
        errorCount++
        diffs.push({ recipeId: id, title, error: e?.message || 'recompute failed', old: { source: old?.source ?? null, confidence: old?.confidence ?? null } })
      }
    }

    const result = {
      dryRun: true,                  // ALWAYS — there is no apply path in this route
      writesPerformed: 0,            // explicit: this batch never writes
      mode: 'canonical-staples',
      scope: singleId ? 'single' : scope,
      batchSize: limit,
      offset,
      catalogTotal: all.length,
      scopeTotal: candidates.length,
      processed: batch.length,
      remainingAfterBatch: Math.max(0, candidates.length - (offset + batch.length)),
      affectedCount,
      changedCount,
      errorCount,
      diffs,
    }
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('nutrition-canonical-dryrun error:', err)
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 })
  }
}
