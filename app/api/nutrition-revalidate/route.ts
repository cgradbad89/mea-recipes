import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken, getAdminDb } from '@/lib/firebaseAdmin'
import { computeRecipeNutrition } from '@/lib/nutritionEngine'
import { servingsAssumed } from '@/lib/nutrition'
import type { NutritionMacros, RecipeNutrition } from '@/types/recipe'

// ─── Re-validate low-confidence recipe nutrition (DRY-RUN BY DEFAULT) ─────────
//
// Re-runs the EXISTING three-tier engine (source → USDA w/ hard match validation
// → AI) on recipes whose stored estimate is low-confidence / AI-derived / had
// assumed servings, to repair bad estimates (e.g. Easy Spaghetti fiber/sugar).
//
//   POST /api/nutrition-revalidate                 → DRY RUN: compute + diff, NO writes
//   POST /api/nutrition-revalidate?apply=true      → persist improved estimates
//   …&limit=25&offset=0                            → bounded batch window
//
// Guardrails (locked):
//  • DRY-RUN is the default — writing requires the explicit `apply=true` flag.
//  • Engine reuse only — all USDA match validation / kcal-band / cascade logic
//    lives in computeRecipeNutrition; this route never re-implements estimation.
//  • A recompute that is STILL `low` confidence is NOT written, even in apply
//    mode — we leave the existing value rather than swap in another bad estimate
//    (Task B dims it instead).
//  • Bounded batches (default 25) so we never spray USDA/AI calls; recipes are
//    processed sequentially (the engine caches ingredient lookups in-process).
//
// Auth: Bearer token via verifyAuthToken, matching ai-ingest / grocery-cleanup.

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 50

const MACRO_KEYS: (keyof NutritionMacros)[] = [
  'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g',
]

/** Recipes worth re-validating: low confidence, AI-derived, or assumed servings. */
function needsRevalidation(n: RecipeNutrition | undefined): boolean {
  if (!n) return false                         // no estimate at all is a different path
  const src = (n.source || '').toLowerCase()
  return servingsAssumed(n) || src.includes('ai')   // confidence:low / +default_servings / *+ai
}

function pickMacros(o: Partial<NutritionMacros> | undefined): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const k of MACRO_KEYS) {
    const v = o?.[k]
    out[k] = typeof v === 'number' && Number.isFinite(v) ? v : null
  }
  return out
}

/** A short label for which tier produced the proposed estimate. */
function matchedTier(source: string | undefined): string {
  const s = (source || '').toLowerCase()
  if (s.includes('ai')) return 'usda+ai (AI fallback used for ≥1 ingredient)'
  if (s.startsWith('usda')) return 'usda (validated USDA match)'
  if (s.startsWith('source')) return 'source (recipe-provided)'
  return s || 'unknown'
}

export async function POST(req: NextRequest) {
  const uid = await verifyAuthToken(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = req.nextUrl.searchParams
  const apply = params.get('apply') === 'true'
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(params.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
  )
  const offset = Math.max(0, parseInt(params.get('offset') || '0', 10) || 0)

  try {
    const db = getAdminDb()
    const snap = await db.collection('recipes').get()

    // Filter to the low-confidence population (in-memory — avoids a composite
    // index; the catalog is small). Keep stable order so offset paging is sane.
    const candidates = snap.docs
      .map(d => ({ id: d.id, data: d.data() || {} }))
      .filter(r => needsRevalidation((r.data as any).nutrition as RecipeNutrition | undefined))
      .sort((a, b) => a.id.localeCompare(b.id))

    const batch = candidates.slice(offset, offset + limit)

    const diffs: any[] = []
    let wouldWriteCount = 0
    let writtenCount = 0
    let stillLowCount = 0
    let errorCount = 0

    for (const { id, data } of batch) {
      const old = (data as any).nutrition as RecipeNutrition | undefined
      const title = (data as any).title || id
      try {
        const { nutrition: proposed, unresolved, flagged } = await computeRecipeNutrition(id)
        const improved = (proposed.confidence || '').toLowerCase() !== 'low'
        if (improved) wouldWriteCount++
        else stillLowCount++

        // Persist ONLY in apply mode AND only when the new estimate is no longer
        // low-confidence (don't overwrite one rough value with another).
        let written = false
        if (apply && improved) {
          await db.collection('recipes').doc(id).set(
            { nutrition: proposed, nutritionStatus: 'computed' },
            { merge: true },
          )
          written = true
          writtenCount++
        }

        diffs.push({
          recipeId: id,
          title,
          old: {
            source: old?.source ?? null,
            confidence: old?.confidence ?? null,
            servings: old?.servings ?? null,
            perServing: pickMacros(old),
            total: pickMacros(old?.total),
          },
          proposed: {
            source: proposed.source,
            confidence: proposed.confidence,
            servings: proposed.servings,
            matchedTier: matchedTier(proposed.source),
            perServing: pickMacros(proposed),
            total: pickMacros(proposed.total),
            unresolvedCount: unresolved.length,
            flaggedCount: flagged.length,
            unresolved: unresolved.slice(0, 8),
          },
          improved,
          wouldWrite: improved,        // in dry-run, this is what apply=true WOULD do
          written,                     // true only when apply=true actually persisted
        })
      } catch (e: any) {
        errorCount++
        diffs.push({
          recipeId: id,
          title,
          error: e?.message || 'recompute failed',
          old: { source: old?.source ?? null, confidence: old?.confidence ?? null },
        })
      }
    }

    const result = {
      dryRun: !apply,
      apply,
      batchSize: limit,
      offset,
      lowConfidenceTotal: candidates.length,   // full catalog count meeting the predicate
      processed: batch.length,
      remainingAfterBatch: Math.max(0, candidates.length - (offset + batch.length)),
      wouldWriteCount,        // # whose recompute improved to ≥ medium confidence
      writtenCount,           // # actually persisted (apply mode only)
      stillLowCount,          // # left untouched (recompute still low-confidence)
      errorCount,
      diffs,
    }

    // Human-readable server-log summary (so a dry run is reviewable in dev logs).
    logSummary(result)
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('nutrition-revalidate error:', err)
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 })
  }
}

function fmtMacroLine(label: string, old: Record<string, number | null>, prop: Record<string, number | null>): string {
  const cells = MACRO_KEYS.map(k => {
    const o = old[k]; const p = prop[k]
    const changed = o !== p
    return `${k}: ${o ?? '—'}${changed ? ` → ${p ?? '—'}` : ''}`
  })
  return `    ${label}: ${cells.join('  ')}`
}

function logSummary(r: any): void {
  const lines: string[] = []
  lines.push('')
  lines.push(`# nutrition-revalidate — ${r.dryRun ? 'DRY RUN (no writes)' : 'APPLY (persisted improved estimates)'}`)
  lines.push(`batchSize=${r.batchSize} offset=${r.offset} · lowConfidenceTotal=${r.lowConfidenceTotal} · processed=${r.processed} · remaining=${r.remainingAfterBatch}`)
  lines.push(`wouldWrite=${r.wouldWriteCount} written=${r.writtenCount} stillLow=${r.stillLowCount} errors=${r.errorCount}`)
  for (const d of r.diffs) {
    lines.push('')
    if (d.error) { lines.push(`  ✗ ${d.title} (${d.recipeId}) — ${d.error}`); continue }
    const tag = d.written ? 'WROTE' : d.wouldWrite ? 'would write' : 'skip (still low)'
    lines.push(`  • ${d.title} (${d.recipeId}) — ${tag}`)
    lines.push(`    source: ${d.old.source ?? '—'} (${d.old.confidence ?? '—'}) → ${d.proposed.source} (${d.proposed.confidence}) · tier: ${d.proposed.matchedTier}`)
    lines.push(fmtMacroLine('per-serving', d.old.perServing, d.proposed.perServing))
    lines.push(fmtMacroLine('total', d.old.total, d.proposed.total))
    if (d.proposed.unresolvedCount) lines.push(`    unresolved (${d.proposed.unresolvedCount}): ${d.proposed.unresolved.join(' | ')}`)
  }
  console.log(lines.join('\n'))
}
