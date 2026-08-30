import { createHash } from 'node:crypto'

const CALENDAR_EVENT_ID_PREFIX = 'mea'
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Application-owned Google Calendar event ID for one user's planned day.
 * SHA-256 keeps the Firebase uid opaque; lowercase hex is valid base32hex and
 * the resulting 67-character ID stays well inside Google's 5–1024 limit.
 */
export function calendarEventIdFor(uid: string, weekID: string, day: string): string {
  if (!uid || !ISO_DAY.test(weekID) || !ISO_DAY.test(day)) {
    throw new Error('A uid, week ID, and day are required for Calendar event identity.')
  }
  const digest = createHash('sha256')
    .update('mea-recipes-calendar-event-v1\0')
    .update(uid)
    .update('\0')
    .update(weekID)
    .update('\0')
    .update(day)
    .digest('hex')
  return `${CALENDAR_EVENT_ID_PREFIX}${digest}`
}
