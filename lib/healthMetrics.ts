import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { db } from './firebase'

/** Daily Apple Health summary written by the Training app. */
export interface HealthMetric {
  date: string // YYYY-MM-DD, the user's local calendar date
  move_calories?: number
}

function isoDate(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Fetches user-owned health metrics for an inclusive local-calendar range.
 * The date field is the same YYYY-MM-DD string used by Training Web, so this
 * deliberately avoids converting the records to Firestore timestamps.
 */
export async function getHealthMetricsForRange(
  userId: string,
  start: Date,
  end: Date,
): Promise<HealthMetric[]> {
  try {
    const snap = await getDocs(query(
      collection(db, 'users', userId, 'healthMetrics'),
      where('date', '>=', isoDate(start)),
      where('date', '<=', isoDate(end)),
      orderBy('date', 'asc'),
    ))
    return snap.docs.map(d => d.data() as HealthMetric)
  } catch (err) {
    // Health data is supplemental. A permissions/index problem must not make
    // the nutrition log itself unusable.
    console.error('Failed to fetch health metrics:', err)
    return []
  }
}
