import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/firebaseAdmin'
import { lookupFoodByBarcode } from '@/lib/nutritionEngine'
import { ApiRequestError, readBoundedJson, safeErrorLogDetails } from '@/lib/apiRequest'
import { enforceAbuseLimit } from '@/lib/apiAbuse'
import { z } from 'zod'

const REQUEST_SCHEMA = z.object({ barcode: z.string() })

// Barcode → packaged-product nutrition (see nutrition-tracker-spec / barcode session).
//   POST { barcode: "<UPC/EAN>" }
// Cascade (server-side, in lib/nutritionEngine.lookupFoodByBarcode):
//   1. Open Food Facts  → source "openfoodfacts", confidence medium|low (crowdsourced)
//   2. USDA branded GTIN → source "usda_branded",  confidence medium
//   3. miss              → { found: false }
// On a hit the response carries `basis` ("per_serving" | "per_100g") so the
// caller can do serving math correctly and never treat per-100g as a serving.
// No camera yet — this accepts a typed barcode so the lookup is testable now.

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuthToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const abuseResponse = await enforceAbuseLimit(req, 'externalLookup', uid)
    if (abuseResponse) return abuseResponse

    const requestResult = REQUEST_SCHEMA.safeParse(await readBoundedJson(req, 8_000))
    if (!requestResult.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
    const barcode = requestResult.data.barcode.replace(/\s+/g, '').trim()
    if (!/^\d{6,14}$/.test(barcode)) {
      return NextResponse.json(
        { error: 'Body must be { barcode } — a 6–14 digit UPC/EAN number' },
        { status: 400 },
      )
    }

    const product = await lookupFoodByBarcode(barcode)
    if (!product) {
      // Clear miss so the UI can show "Product not found — try search."
      return NextResponse.json({ found: false })
    }
    return NextResponse.json({ found: true, ...product })
  } catch (err) {
    if (err instanceof ApiRequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[barcode-lookup] request failed', { error: safeErrorLogDetails(err) })
    return NextResponse.json({ error: 'Unable to complete the request.' }, { status: 500 })
  }
}
