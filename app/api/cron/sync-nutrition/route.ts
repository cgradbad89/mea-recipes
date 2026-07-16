import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import type { ConsumptionEntry, Meal } from '@/types/nutrition'

export async function GET(request: Request) {
  // Auth check using CRON_SECRET to prevent unauthorized public access
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const uid = process.env.MFP_SYNC_UID
  const accessToken = process.env.MFP_ACCESS_TOKEN
  const mfpUserId = process.env.MFP_USER_ID
  const sessionCookie = process.env.MFP_SESSION_COOKIE

  if (!uid || !accessToken || !mfpUserId || !sessionCookie) {
    console.error('Missing required environment variables for MFP sync (MFP_SYNC_UID, MFP_ACCESS_TOKEN, MFP_USER_ID, MFP_SESSION_COOKIE)')
    return NextResponse.json({ error: 'Configuration Error' }, { status: 500 })
  }

  // Determine target dates: yesterday and today
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const datesToFetch = [
    yesterday.toISOString().split('T')[0],
    today.toISOString().split('T')[0]
  ]

  const allItems: any[] = []

  for (const date of datesToFetch) {
    try {
      const url = `https://api.myfitnesspal.com/v2/diary?entry_date=${date}&types=diary_meal,water,exercise&fields[]=nutritional_contents`
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'mfp-client-id': 'mfp-web',
          'mfp-user-id': mfpUserId,
          'Accept': 'application/json',
          'Cookie': sessionCookie
        }
      })

      if (!res.ok) {
        const errorText = await res.text()
        console.error(`MFP API responded with ${res.status} for date ${date}:`, errorText)
        return NextResponse.json({ error: `MFP API Error: ${res.status}` }, { status: 502 })
      }

      const data = await res.json()
      if (data.items && Array.isArray(data.items)) {
        // Only keep diary_meal items, ignore water/exercise etc.
        allItems.push(...data.items.filter((item: any) => item.type === 'diary_meal'))
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

  // Find existing MFP docs for these dates to wipe them
  const startDate = new Date(`${datesToFetch[0]}T00:00:00Z`)
  const endDate = new Date(`${datesToFetch[1]}T23:59:59Z`)
  
  const existingDocs = await logRef
    .where('date', '>=', Timestamp.fromDate(startDate))
    .where('date', '<=', Timestamp.fromDate(endDate))
    .get()

  const batch = db.batch()
  let deleteCount = 0

  existingDocs.forEach(doc => {
    // Only delete items that were explicitly created by this MFP sync
    if (doc.id.startsWith('mfp-')) {
      batch.delete(doc.ref)
      deleteCount++
    }
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
      date: Timestamp.fromDate(new Date(`${item.date}T12:00:00Z`)), // Noon UTC avoids timezone edge cases jumping to previous day
      meal: mappedMeal,
      type: 'manual', // Stored as a manual entry in the app
      is_cook_event: false,
      recipe_id: null,
      name: `MyFitnessPal ${item.diary_meal || 'Entry'}`,
      servings_eaten: 1,
      nutrition: {
        calories: item.nutritional_contents?.energy?.value || 0,
        protein: item.nutritional_contents?.protein || 0,
        fat: item.nutritional_contents?.fat || 0,
        carbs: item.nutritional_contents?.carbohydrates || 0,
        fiber: item.nutritional_contents?.fiber || 0,
        sugar: item.nutritional_contents?.sugar || 0,
      },
      source: 'manual', // Standard log source
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
    syncedNewItems: writeCount
  })
}
