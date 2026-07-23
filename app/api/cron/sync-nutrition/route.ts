import { NextResponse } from 'next/server'
import * as cheerio from 'cheerio'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import type { ConsumptionEntry, Meal } from '@/types/nutrition'

// Helper to compute a Date anchored to America/New_York
function getEasternTime(dateString: string, timeString: string = '00:00:00'): Date {
  const [y, m, d] = dateString.split('-').map(Number)
  const noonUTC = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))

  const nyHour = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hour12: false,
    }).format(noonUTC),
    10
  )

  const offsetHours = nyHour - 12
  const sign = offsetHours >= 0 ? '+' : '-'
  const absHours = Math.abs(offsetHours).toString().padStart(2, '0')
  const offsetStr = `${sign}${absHours}:00`

  return new Date(`${dateString}T${timeString}${offsetStr}`)
}

// Map the classic-diary meal-header label ("Breakfast", "Lunch", "Dinner",
// "Snacks") onto the app's Meal enum. MFP uses plural "Snacks"; anything that
// isn't one of the three named meals falls back to 'snack'.
function mapMeal(rawMealName: string): Meal {
  const n = rawMealName.toLowerCase()
  if (n.includes('breakfast')) return 'breakfast'
  if (n.includes('lunch')) return 'lunch'
  if (n.includes('dinner')) return 'dinner'
  return 'snack'
}

// Pull a numeric macro value out of the free text of a nutrient cell, tolerating
// thousands separators and unit suffixes (e.g. "1,234", "56 g").
function parseNutrientNumber(raw: string): number {
  const cleaned = raw.replace(/,/g, '').replace(/[^0-9.]/g, '')
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : 0
}

// ── Header-name-based column resolution ──────────────────────────────────────
// MFP's diary columns are USER-CONFIGURABLE (the stock default has Sodium where
// this account shows Fiber), so macro cells are mapped by the meal_header label
// row's NAMES — never by fixed position. A layout change then yields missing
// columns (written as 0) instead of silently mis-filed nutrients.

const MACRO_FIELDS = ['calories', 'carbs_g', 'fat_g', 'protein_g', 'fiber_g', 'sugar_g'] as const
type MacroField = (typeof MACRO_FIELDS)[number]

// Case-insensitive, whitespace-normalised label → target field. Includes the
// obvious variants MFP has used; unknown labels (Sodium, Cholesterol…) simply
// don't match and their columns are ignored.
const HEADER_FIELD_ALIASES: Record<string, MacroField> = {
  calories: 'calories', cals: 'calories',
  carbs: 'carbs_g', carbohydrates: 'carbs_g',
  fat: 'fat_g',
  protein: 'protein_g',
  fiber: 'fiber_g', fibre: 'fiber_g',
  sugar: 'sugar_g', sugars: 'sugar_g',
}

// Lowercase, drop parenthesised suffixes ("Carbs (g)"), collapse whitespace.
function normalizeHeaderLabel(raw: string): string {
  return raw.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim()
}

interface ResolvedColumn { header: string; index: number }
type ColumnMapping = Record<MacroField, ResolvedColumn | null>

/**
 * Resolve the diary's column layout from the first meal_header row, whose cells
 * carry the nutrient column labels ([0] = meal name, [1..] = nutrient names).
 * Returns null when the header row is missing or no label is recognisable —
 * the caller MUST abort on null; positional fallback is deliberately absent.
 */
function resolveColumnMapping($: cheerio.CheerioAPI): ColumnMapping | null {
  const headerCells = $('tr.meal_header').first().children('td')
  if (headerCells.length < 2) return null

  const mapping = Object.fromEntries(MACRO_FIELDS.map(f => [f, null])) as ColumnMapping
  let matched = 0
  headerCells.each((i, td) => {
    if (i === 0) return   // meal-name cell, not a nutrient column
    const header = $(td).text().replace(/\s+/g, ' ').trim()
    const norm = normalizeHeaderLabel(header)
    // Exact alias first, then the first word ("Calories kcal" → "calories").
    const field = HEADER_FIELD_ALIASES[norm] ?? HEADER_FIELD_ALIASES[norm.split(' ')[0]]
    if (field && !mapping[field]) {
      mapping[field] = { header, index: i }
      matched++
    }
  })
  return matched === 0 ? null : mapping
}

// One parsed diary food row, before it is mapped into a ConsumptionEntry.
interface ParsedFoodItem {
  date: string
  foodEntryId: string
  meal: Meal
  nameServing: string
  nutrition: {
    calories: number
    protein_g: number
    fat_g: number
    carbs_g: number
    fiber_g: number
    sugar_g: number
  }
}

export async function GET(request: Request) {
  // Auth check using CRON_SECRET to prevent unauthorized public access
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Gate verbose troubleshooting logs behind an env flag so an unattended job
  // stays quiet in normal operation but can be made chatty without a redeploy.
  const DEBUG = process.env.MFP_DEBUG === 'true'

  const uid = process.env.MFP_SYNC_UID
  const sessionCookie = process.env.MFP_SESSION_COOKIE
  const userAgent = process.env.MFP_USER_AGENT
  const mfpUsername = process.env.MFP_USERNAME

  if (DEBUG) {
    console.log('DEBUG MFP ENV VARS:', {
      MFP_SYNC_UID_present: !!uid,
      MFP_SESSION_COOKIE_present: !!sessionCookie,
      MFP_USER_AGENT_present: !!userAgent,
      MFP_USERNAME_present: !!mfpUsername,
    })
  }

  if (!uid || !sessionCookie || !userAgent || !mfpUsername) {
    console.error('Missing required environment variables for MFP sync (MFP_SYNC_UID, MFP_SESSION_COOKIE, MFP_USER_AGENT, MFP_USERNAME)')
    return NextResponse.json({ error: 'Configuration Error' }, { status: 500 })
  }

  if (DEBUG) {
    console.log('DEBUG MFP ENV VAR LENGTHS:', {
      cookieLen: sessionCookie.length,
      userAgentLen: userAgent.length,
      usernameLen: mfpUsername.length,
    })
  }

  // Determine target dates: yesterday and today (Anchored to Eastern Time)
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
  const now = new Date()
  const todayStr = formatter.format(now)
  const yesterdayStr = formatter.format(new Date(now.getTime() - 86400000))
  const datesToFetch = [yesterdayStr, todayStr]

  // Fetch + parse BOTH dates (and validate each page as a real, authenticated
  // diary) before any Firestore mutation. A broken/expired-session fetch must
  // never reach the wipe-and-replace step and masquerade as an empty day.
  const allItems: ParsedFoodItem[] = []

  // Per-date resolved header→field mapping, echoed in the response so a manual
  // trigger shows exactly which diary columns were matched.
  const columnMappingByDate: Record<string, ColumnMapping> = {}

  for (const date of datesToFetch) {
    try {
      // Classic diary page — the nutrition data is present directly in the raw
      // HTML. This is a plain authenticated page load (not a state-changing API
      // call), so only Cookie + User-Agent are sent; no CSRF or client-id header.
      const url = `https://www.myfitnesspal.com/food/diary/${encodeURIComponent(mfpUsername)}?date=${encodeURIComponent(date)}`
      if (DEBUG) console.log(`DEBUG MFP FETCH URL for ${date}:`, url)

      const fetchHeaders = {
        'Cookie': sessionCookie,
        'User-Agent': userAgent,
      }
      if (DEBUG) console.log('DEBUG MFP FETCH HEADERS:', Object.keys(fetchHeaders))

      const res = await fetch(url, { headers: fetchHeaders })

      if (DEBUG) console.log(`DEBUG MFP RESPONSE for ${date}:`, { status: res.status, redirected: res.redirected, finalUrl: res.url })

      if (!res.ok) {
        const errorText = await res.text()
        console.error('MFP page error body (first 500 chars):', errorText.slice(0, 500))
        if (res.status === 401 || res.status === 403) {
          console.error(`MFP page error ${res.status}: session cookie likely expired.`)
        } else {
          console.error(`MFP page responded with ${res.status} for date ${date}`)
        }
        return NextResponse.json({ error: `MFP page error: ${res.status}` }, { status: 502 })
      }

      const html = await res.text()
      const $ = cheerio.load(html)

      // VALIDATION: a genuine authenticated diary always renders its meal
      // sections (Breakfast/Lunch/Dinner/Snacks) as `tr.meal_header` rows, even
      // when nothing is logged. Zero meal headers means the response is not a
      // real diary page (expired session → login redirect), so treat it as a
      // hard error rather than a legitimately-empty day.
      const mealHeaderCount = $('tr.meal_header').length
      if (mealHeaderCount === 0) {
        console.error(`MFP diary for ${date} has no meal_header rows — session cookie likely expired or was redirected to login. Aborting before any Firestore write.`)
        return NextResponse.json({ error: 'MFP session invalid (no diary content)' }, { status: 502 })
      }

      // Resolve the diary's nutrient columns BY HEADER NAME. Unresolvable ⇒
      // hard abort: loudly failing beats silently writing misaligned nutrients.
      const columnMapping = resolveColumnMapping($)
      if (!columnMapping) {
        console.error(`MFP diary for ${date}: could not resolve any nutrient column from the meal_header label row. Aborting — positional fallback is deliberately not attempted.`)
        return NextResponse.json({ error: 'MFP diary header row unrecognised — aborted before any write' }, { status: 502 })
      }
      columnMappingByDate[date] = columnMapping
      if (DEBUG) console.log(`DEBUG MFP COLUMN MAPPING for ${date}:`, columnMapping)

      // Walk every table row in document order, tracking the current meal by the
      // most recent meal_header seen, so each food row is attributed correctly.
      let currentMeal: Meal = 'snack'
      $('tr').each((_, tr) => {
        const $tr = $(tr)

        if ($tr.hasClass('meal_header')) {
          currentMeal = mapMeal($tr.children('td').first().text().trim())
          return
        }

        // The data-food-entry-id anchor is the reliable "this is a real food
        // row" signal — it naturally excludes meal_header, totals and subtotal
        // rows regardless of their CSS classes or position.
        const foodAnchor = $tr.find('a[data-food-entry-id]').first()
        if (!foodAnchor.length) return

        const foodEntryId = foodAnchor.attr('data-food-entry-id') || ''
        const nameServing = foodAnchor.text().replace(/\s+/g, ' ').trim()

        // Direct-child cells only, to avoid picking up any nested-table tds.
        // Cell indices come from the resolved header mapping (food-row tds align
        // 1:1 with the meal_header label cells). A field whose column is absent
        // from this diary layout writes 0 — values are never shifted sideways.
        const tds = $tr.children('td')
        const macroValue = (field: MacroField): number => {
          const col = columnMapping[field]
          if (!col) return 0
          const cell = tds.eq(col.index)
          // Some columns wrap the number in `.macro-value` alongside a
          // `.macro-percentage`; others put it as plain text in the td. Prefer
          // the macro-value span so the percentage never leaks into the number.
          const macro = cell.find('.macro-value').first()
          return parseNutrientNumber(macro.length ? macro.text() : cell.text())
        }

        allItems.push({
          date,
          foodEntryId,
          meal: currentMeal,
          nameServing,
          nutrition: {
            calories: macroValue('calories'),
            carbs_g: macroValue('carbs_g'),
            fat_g: macroValue('fat_g'),
            protein_g: macroValue('protein_g'),
            fiber_g: macroValue('fiber_g'),
            sugar_g: macroValue('sugar_g'),
          },
        })
      })
    } catch (e) {
      console.error(`Failed to fetch/parse MFP diary for ${date}:`, e)
      return NextResponse.json({ error: 'Fetch Error' }, { status: 500 })
    }
  }

  // Surface one fully parsed item so it can be eyeballed against the live MFP
  // page before trusting the rest of the pipeline. Info-level, not an error.
  if (DEBUG && allItems.length > 0) {
    const s = allItems[0]
    console.log('DEBUG MFP SAMPLE PARSED ITEM:', {
      meal: s.meal,
      nameServing: s.nameServing,
      nutrition: s.nutrition,
    })
  }

  const db = getAdminDb()
  const logRef = db.collection('users').doc(uid).collection('nutrition').doc('root').collection('log')

  // Find existing MFP docs for these dates to wipe them, anchored to Eastern Time bounds
  const startDate = getEasternTime(datesToFetch[0], '00:00:00')
  const endDate = getEasternTime(datesToFetch[1], '23:59:59')

  const existingDocs = await logRef
    .where('source', '==', 'mfp')
    .where('date', '>=', Timestamp.fromDate(startDate))
    .where('date', '<=', Timestamp.fromDate(endDate))
    .get()

  const batch = db.batch()
  let deleteCount = 0

  existingDocs.forEach(doc => {
    batch.delete(doc.ref)
    deleteCount++
  })

  // Write new items — one ConsumptionEntry per logged food row.
  let writeCount = 0
  allItems.forEach(item => {
    // Deterministic ID keyed on date + MFP's own food-entry id, so re-running
    // the sync overwrites rather than duplicates.
    const entryId = `mfp-${item.date}-${item.foodEntryId}`
    const docRef = logRef.doc(entryId)

    const entry: ConsumptionEntry = {
      id: entryId,
      date: Timestamp.fromDate(getEasternTime(item.date, '12:00:00')), // Anchored to Noon Eastern Time
      meal: item.meal,
      type: 'manual', // Stored as a manual entry in the app
      is_cook_event: false,
      recipe_id: null,
      name: item.nameServing, // combined food name + serving string from MFP
      servings_eaten: 1,
      nutrition: item.nutrition,
      source: 'mfp', // Specifically marked as MFP
      created_at: FieldValue.serverTimestamp(),
      userId: uid
    }

    batch.set(docRef, entry)
    writeCount++
  })

  await batch.commit()

  return NextResponse.json({
    success: true,
    dates: datesToFetch,
    deletedOldItems: deleteCount,
    syncedNewItems: writeCount,
    // Which diary column each macro field was read from (per fetched date);
    // a null field means that column is absent and it was written as 0.
    columnMapping: columnMappingByDate,
  })
}
