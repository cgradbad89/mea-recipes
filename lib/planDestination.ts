import { normalizeRememberedWeekID } from './weekDates'

export type PlanDestination = { weekID: string; day: string | null }

/** Reject non-Mondays, impossible dates and days outside the selected week. */
export function parsePlanDestination(week: string | null, day: string | null): PlanDestination | null {
  if (!week || normalizeRememberedWeekID(week) !== week || day === null) return null
  if (day === 'unscheduled') return { weekID: week, day: null }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || normalizeRememberedWeekID(day) !== week) return null
  return { weekID: week, day }
}

export function destinationLabel(destination: PlanDestination): string {
  return destination.day ? new Date(destination.day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }) : `Unscheduled · week of ${destination.weekID}`
}
