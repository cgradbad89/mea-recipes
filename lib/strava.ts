import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import type { StravaActivity } from '@/types/nutrition'

export function stravaActivitiesPath() {
  return collection(db, 'stravaActivities')
}

function snapToActivity(id: string, data: Record<string, unknown>): StravaActivity {
  return {
    id: id,
    name: (data.name as string) || 'Activity',
    type: (data.type as string) || 'Workout',
    start_date_local: data.start_date_local,
    calories: (data.calories as number) || 0,
    moving_time_s: (data.moving_time_s as number) || 0,
  }
}

/**
 * Fetches strava activities within the given local calendar-day range.
 * Assumes the `stravaActivities` collection is at the root and all documents
 * belong to the current user.
 */
export async function getActivitiesForRange(start: Date, end: Date): Promise<StravaActivity[]> {
  const q = query(
    stravaActivitiesPath(),
    where('start_date_local', '>=', Timestamp.fromDate(start)),
    where('start_date_local', '<=', Timestamp.fromDate(end)),
    orderBy('start_date_local', 'asc'),
  )
  const snap = await getDocs(q)
  const activities = snap.docs.map(d => snapToActivity(d.id, d.data()))
  return activities
}
