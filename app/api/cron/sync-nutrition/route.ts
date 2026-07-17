import { NextResponse } from 'next/server'
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

export async function GET(request: Request) {
  // Auth check using CRON_SECRET to prevent unauthorized public access
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const uid = process.env.MFP_SYNC_UID
  const sessionCookie = process.env.MFP_SESSION_COOKIE
  const csrfToken = process.env.MFP_CSRF_TOKEN

  console.log('DEBUG MFP ENV VARS:', {
    MFP_SYNC_UID_present: !!uid,
    MFP_SESSION_COOKIE_present: !!sessionCookie,
    MFP_CSRF_TOKEN_present: !!csrfToken,
  })

  if (!uid || !sessionCookie || !csrfToken) {
    console.error('Missing required environment variables for MFP sync (MFP_SYNC_UID, MFP_SESSION_COOKIE, MFP_CSRF_TOKEN)')
    return NextResponse.json({ error: 'Configuration Error' }, { status: 500 })
  }

  console.log('DEBUG MFP ENV VAR LENGTHS:', {
    cookieLen: sessionCookie.length,
    csrfTokenLen: csrfToken.length
  })

  // Determine target dates: yesterday and today (Anchored to Eastern Time)
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
  const now = new Date()
  const todayStr = formatter.format(now)
  const yesterdayStr = formatter.format(new Date(now.getTime() - 86400000))
  const datesToFetch = [yesterdayStr, todayStr]

  const allItems: any[] = []
  let skippedWaterOrExercise = 0

  for (const date of datesToFetch) {
    try {
      const url = `https://api.myfitnesspal.com/v2/diary?entry_date=${date}&types=diary_meal,water,exercise&fields[]=nutritional_contents`
      console.log(`DEBUG MFP FETCH URL for ${date}:`, url)
      
      const fetchHeaders = {
        'Cookie': sessionCookie,
        'x-csrf-token': csrfToken,
        'mfp-client-id': 'mfp-web',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
      console.log('DEBUG MFP FETCH HEADERS:', Object.keys(fetchHeaders))

      const res = await fetch(url, { headers: fetchHeaders })

      if (!res.ok) {
        const errorText = await res.text()
        console.error('MFP API Error Body:', errorText)
        if (res.status === 401 || res.status === 403) {
          console.error(`MFP API Error ${res.status}: session cookie or CSRF token likely expired.`)
        } else {
          console.error(`MFP API responded with ${res.status} for date ${date}`)
        }
        return NextResponse.json({ error: `MFP API Error: ${res.status}` }, { status: 502 })
      }

      const data = await res.json()
      if (data.items && Array.isArray(data.items)) {
        // Filter and categorize items
        data.items.forEach((item: any) => {
          if (item.type === 'diary_meal') {
            allItems.push(item)
          } else if (item.type === 'water' || item.type === 'exercise') {
            skippedWaterOrExercise++
          }
        })
      }
    } catch (e) {
      console.error(`Failed to fetch MFP data for ${date}:`, e)
      return NextResponse.json({ error: 'Fetch Error' }, { status: 500 })
    }
  }

  // If the payload is entirely empty, treat it as an error to prevent accidental wipe of valid entries
  if (allItems.length === 0) {
    console.warn('No items fetched from MFP. Aborting wipe-and-replace to prevent accidental data loss.')
    return NextResponse.json({ message: 'No items to sync', count: 0 }, { status: 200 })
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

  // Write new items
  let writeCount = 0
  allItems.forEach(item => {
    const mealName = (item.diary_meal || 'Snack').toLowerCase()
    let mappedMeal: Meal = 'snack'
    if (['breakfast', 'lunch', 'dinner', 'snack'].includes(mealName)) {
      mappedMeal = mealName as Meal
    }

    // Ensure deterministic ID for the day and meal
    const entryId = `mfp-${item.date}-${mappedMeal}`
    const docRef = logRef.doc(entryId)
    
    const entry: ConsumptionEntry = {
      id: entryId,
      date: Timestamp.fromDate(getEasternTime(item.date, '12:00:00')), // Anchored to Noon Eastern Time
      meal: mappedMeal,
      type: 'manual', // Stored as a manual entry in the app
      is_cook_event: false,
      recipe_id: null,
      name: `MyFitnessPal ${item.diary_meal || 'Entry'}`,
      servings_eaten: 1,
      nutrition: {
        calories: item.nutritional_contents?.energy?.value || 0,
        protein_g: item.nutritional_contents?.protein || 0,
        fat_g: item.nutritional_contents?.fat || 0,
        carbs_g: item.nutritional_contents?.carbohydrates || 0,
        fiber_g: item.nutritional_contents?.fiber || 0,
        sugar_g: item.nutritional_contents?.sugar || 0,
      },
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
    skippedWaterOrExerciseCount: skippedWaterOrExercise,
    message: skippedWaterOrExercise > 0 ? `Skipped ${skippedWaterOrExercise} water/exercise items.` : undefined
  })
}
