import { NextRequest, NextResponse } from 'next/server'
import { getAdminDb, verifyAuthToken } from '@/lib/firebaseAdmin'
import { newYorkWeek } from '@/lib/hubDates'
import { buildRecipesSummary, type HubRecipe, type HubWeekPlan } from '@/lib/hubSummary'
import { normalizePlanned } from '@/lib/weekPlanNormalize'

export const runtime = 'nodejs'

const headers = { 'Cache-Control': 'no-store' }

export async function GET(req: NextRequest) {
  try {
    if (!/^Bearer\s+\S+\s*$/i.test(req.headers.get('Authorization') || '')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
    }
    const uid = await verifyAuthToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })

    const now = new Date()
    const { monday } = newYorkWeek(now)
    const db = getAdminDb()
    const snapshot = await db.collection('users').doc(uid)
      .collection('pantry').doc('root').collection('weekPlans').doc(monday).get()
    const weekPlan = snapshot.exists ? snapshot.data() as HubWeekPlan : null
    const ids = [...new Set(normalizePlanned(weekPlan?.plannedRecipeIDs).map(entry => entry.recipeID))]
    const recipesById = new Map<string, HubRecipe>()
    if (ids.length > 0) {
      const recipes = await db.getAll(...ids.map(id => db.collection('recipes').doc(id)))
      for (const recipe of recipes) {
        if (recipe.exists) recipesById.set(recipe.id, recipe.data() as HubRecipe)
      }
    }
    const [summary, counts] = buildRecipesSummary({ weekPlan, recipesById, now })
    if (Object.values(counts).some(count => count > 0)) {
      console.warn('Hub summary omitted entries', counts)
    }
    return NextResponse.json(summary, { headers })
  } catch {
    return NextResponse.json({ error: 'Unable to load summary' }, { status: 500, headers })
  }
}
