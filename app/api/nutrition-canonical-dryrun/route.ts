import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken, getAdminDb } from '@/lib/firebaseAdmin'
import { computeRecipeNutrition } from '@/lib/nutritionEngine'
import type { NutritionMacros, RecipeNutrition } from '@/types/recipe'

// ─── Canonical-staples recompute — DRY-RUN by default; ?apply=true WRITES ──────
//
// Recomputes catalog nutrition with the canonical-staples-aware engine.
//
//   POST /api/nutrition-canonical-dryrun                    → DRY RUN: diff, NO writes
//   POST /api/nutrition-canonical-dryrun?apply=true         → APPLY: persist (Batch 4-apply)
//   …&limit=25&offset=0                                     → bounded batch window
//   …&scope=low        → only confidence==='low' · …&recipeId=<id> → a single recipe
//
// DRY-RUN (default) also computes baseline (canonical-off) so canonicalΔ isolates
// the table's effect. APPLY skips baseline (not needed for the write decision).
//
// APPLY write gate (conservative — when unsure, SKIP and keep today's value):
//   WRITE a recipe ONLY when ALL hold:
//     (a) ≥1 ingredient resolved via the canonical table (canonicalHits > 0), AND
//         the recompute's TOTAL macros materially changed vs the STORED value,
//     (b) the recompute does NOT lower confidence (rank(new) ≥ rank(old)),
//     (c) the recompute is internally valid (finite, calories > 0).
//   SKIP (and log): no canonical hit · no stored total · would-downgrade ·
//     no material change · invalid recompute · parse error.
//   Before overwriting, the prior nutrition is captured into `nutrition_prev` on the
//   doc (only if not already present, so re-runs preserve the ORIGINAL) for revert,
//   and the route returns `prevCaptured` so the runner can also write a manifest.
//
// IMPORTANT: run APPLY where ANTHROPIC_API_KEY is present (Vercel) so the full
// three-tier engine (canonical → USDA → AI) produces the real final values.
//
// Auth: Bearer token via verifyAuthToken, matching ai-ingest / nutrition-revalidate.

// Recompute makes live USDA (+ AI on Vercel) calls per non-canonical ingredient, so
// extend the serverless function timeout and keep apply batches small (the runner
// pages with a low limit) to finish within it.
export const maxDuration = 60

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 50

const MACRO_KEYS: (keyof NutritionMacros)[] = [
  'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g',
]

const CONF_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 }
function rank(c: string | undefined | null): number {
  return c && c in CONF_RANK ? CONF_RANK[c] : -1
}

function pickMacros(o: Partial<NutritionMacros> | undefined): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const k of MACRO_KEYS) {
    const v = o?.[k]
    out[k] = typeof v === 'number' && Number.isFinite(v) ? v : null
  }
  return out
}

function macroDelta(a: NutritionMacros | undefined, b: NutritionMacros | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const k of MACRO_KEYS) {
    const x = a?.[k]; const y = b?.[k]
    out[k] = Math.round(((typeof x === 'number' ? x : 0) - (typeof y === 'number' ? y : 0)) * 10) / 10
  }
  return out
}

function anyMacroChanged(delta: Record<string, number>): boolean {
  return MACRO_KEYS.some(k => Math.abs(delta[k] || 0) >= (k === 'calories' ? 1 : 0.5))
}

/** Recompute TOTAL is internally valid: all 6 macros finite, calories > 0. */
function validTotal(t: NutritionMacros | undefined): boolean {
  if (!t) return false
  for (const k of MACRO_KEYS) { const v = t[k]; if (typeof v !== 'number' || !Number.isFinite(v)) return false }
  return (t.calories as number) > 0
}

/** Proposed total materially differs from the stored total (the change we'd write). */
function materialVsStored(proposed: NutritionMacros | undefined, stored: Partial<NutritionMacros> | undefined): boolean {
  if (!proposed || !stored) return false
  return MACRO_KEYS.some(k => {
    const p = proposed[k]; const s = stored[k]
    if (typeof p !== 'number' || typeof s !== 'number') return false
    return Math.abs(p - s) >= (k === 'calories' ? 1 : 0.5)
  })
}

export async function POST(req: NextRequest) {
  const uid = await verifyAuthToken(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = req.nextUrl.searchParams
  const apply = params.get('apply') === 'true'   // DEFAULT FALSE — dry-run unless explicit
  const scope = params.get('scope') === 'low' ? 'low' : 'all'
  const singleId = (params.get('recipeId') || '').trim()
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(params.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT))
  const offset = Math.max(0, parseInt(params.get('offset') || '0', 10) || 0)

  try {
    const db = getAdminDb()
    const snap = await db.collection('recipes').get()
    const all = snap.docs.map(d => ({ id: d.id, data: d.data() || {} }))

    let candidates = all
      .filter(r => (r.data as any).title)
      .sort((a, b) => a.id.localeCompare(b.id))
    if (singleId) candidates = candidates.filter(r => r.id === singleId)
    else if (scope === 'low') candidates = candidates.filter(r => ((r.data as any).nutrition as RecipeNutrition | undefined)?.confidence === 'low')

    const batch = candidates.slice(offset, offset + limit)

    const diffs: any[] = []
    let affectedCount = 0, changedCount = 0, errorCount = 0
    let wouldWriteCount = 0, writtenCount = 0
    const skipped = { noCanonical: 0, noStoredTotal: 0, invalid: 0, noCanonicalEffect: 0, noMaterialChange: 0, wouldDowngrade: 0, error: 0 }

    for (const { id, data } of batch) {
      const old = (data as any).nutrition as RecipeNutrition | undefined
      const title = (data as any).title || id
      try {
        const proposed = await computeRecipeNutrition(id, { useCanonical: true })
        const affected = proposed.canonicalHits.length > 0
        if (affected) affectedCount++

        // baseline (canonical-OFF) — computed for every affected recipe (both modes) so
        // the write gate can require the change be ATTRIBUTABLE TO THE CANONICAL TABLE
        // (proposed vs baseline = canonicalΔ), not merely different from the stale stored
        // value (which also captures unrelated engine drift / AI variance, e.g. a recipe
        // whose dried fruit re-resolves higher while canonical only touched its oats).
        let baseline = proposed
        if (affected) baseline = await computeRecipeNutrition(id, { useCanonical: false })
        const delta = macroDelta(proposed.nutrition.total, baseline.nutrition.total)
        const changedVsBaseline = affected && anyMacroChanged(delta)   // canonicalΔ material

        // ── Write decision (evaluated in BOTH modes; acted on only when apply) ──
        const valid = validTotal(proposed.nutrition.total)
        const hasStored = !!(old?.total && typeof old.total.calories === 'number')
        const storedDiffers = hasStored && materialVsStored(proposed.nutrition.total, old!.total)
        const notDowngrade = rank(proposed.nutrition.confidence) >= rank(old?.confidence)
        let skipReason: string | null = null
        if (!affected) { skipReason = 'no-canonical'; skipped.noCanonical++ }
        else if (!valid) { skipReason = 'invalid-recompute'; skipped.invalid++ }
        else if (!hasStored) { skipReason = 'no-stored-total'; skipped.noStoredTotal++ }
        else if (!changedVsBaseline) { skipReason = 'no-canonical-effect'; skipped.noCanonicalEffect++ }  // canonical didn't change macros (engine-drift only)
        else if (!storedDiffers) { skipReason = 'no-material-change'; skipped.noMaterialChange++ }          // write would be a no-op vs stored
        else if (!notDowngrade) { skipReason = 'would-downgrade'; skipped.wouldDowngrade++ }
        const wouldWrite = skipReason === null
        if (wouldWrite) { wouldWriteCount++; changedCount++ }

        // ── Persist (apply mode only) — capture prior value into nutrition_prev first ──
        let written = false
        let prevCaptured: any = null
        if (apply && wouldWrite) {
          const existingPrev = (data as any).nutrition_prev
          const prev = (existingPrev && typeof existingPrev === 'object') ? existingPrev : old   // preserve ORIGINAL across re-runs
          await db.collection('recipes').doc(id).set(
            { nutrition: proposed.nutrition, nutritionStatus: 'computed', nutrition_prev: prev },
            { merge: true },
          )
          written = true
          writtenCount++
          prevCaptured = prev
        }

        const baseByName = new Map(baseline.resolutions.map(r => [r.name, r]))
        const resolutionChanges = proposed.resolutions
          .filter(r => r.resolvedBy === 'canonical')
          .map(r => {
            const b = baseByName.get(r.name)
            const before = b ? { resolvedBy: b.resolvedBy, description: b.matchedDescription, calPer100g: b.calPer100g, sugarPer100g: b.sugarPer100g, fiberPer100g: b.fiberPer100g } : null
            return { ingredient: r.name, grams: Math.round(r.grams), before, after: { resolvedBy: r.resolvedBy, fdcId: r.fdcId, description: r.matchedDescription, calPer100g: r.calPer100g, sugarPer100g: r.sugarPer100g, fiberPer100g: r.fiberPer100g }, changed: !before || before.description !== r.matchedDescription }
          })

        diffs.push({
          recipeId: id, title, affected,
          changed: changedVsBaseline,
          canonicalHitCount: proposed.canonicalHits.length,
          wouldWrite, written, skipReason,
          old: { source: old?.source ?? null, confidence: old?.confidence ?? null, servings: old?.servings ?? null, total: pickMacros(old?.total), perServing: pickMacros(old) },
          baseline: { source: baseline.nutrition.source, confidence: baseline.nutrition.confidence, total: pickMacros(baseline.nutrition.total), unresolvedCount: baseline.unresolved.length },
          proposed: { source: proposed.nutrition.source, confidence: proposed.nutrition.confidence, servings: proposed.nutrition.servings, total: pickMacros(proposed.nutrition.total), perServing: pickMacros(proposed.nutrition), unresolvedCount: proposed.unresolved.length, unresolved: proposed.unresolved.slice(0, 8) },
          canonicalDelta: delta,
          canonicalHits: proposed.canonicalHits,
          resolutionChanges,
          // full prior nutrition (for the revert manifest) — only on actual writes
          prevCaptured: prevCaptured ? { source: prevCaptured.source ?? null, confidence: prevCaptured.confidence ?? null, servings: prevCaptured.servings ?? null, total: prevCaptured.total ?? null, calories: prevCaptured.calories ?? null, protein_g: prevCaptured.protein_g ?? null, carbs_g: prevCaptured.carbs_g ?? null, fat_g: prevCaptured.fat_g ?? null, fiber_g: prevCaptured.fiber_g ?? null, sugar_g: prevCaptured.sugar_g ?? null, serving_size: prevCaptured.serving_size ?? null } : null,
        })
      } catch (e: any) {
        errorCount++; skipped.error++
        diffs.push({ recipeId: id, title, error: e?.message || 'recompute failed', wouldWrite: false, written: false, skipReason: 'error', old: { source: old?.source ?? null, confidence: old?.confidence ?? null } })
      }
    }

    const result = {
      dryRun: !apply,
      apply,
      writesPerformed: writtenCount,
      mode: 'canonical-staples',
      scope: singleId ? 'single' : scope,
      batchSize: limit, offset,
      catalogTotal: all.length,
      scopeTotal: candidates.length,
      processed: batch.length,
      remainingAfterBatch: Math.max(0, candidates.length - (offset + batch.length)),
      affectedCount,
      changedCount,
      wouldWriteCount,      // recipes that pass the write gate (what apply WOULD/DID write)
      writtenCount,         // actually persisted (apply mode only)
      skipped,              // breakdown of skip reasons
      errorCount,
      diffs,
    }
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('nutrition-canonical-dryrun error:', err)
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 })
  }
}
