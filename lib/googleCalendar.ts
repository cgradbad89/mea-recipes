'use client'

import { GoogleAuthProvider, reauthenticateWithPopup, signInWithPopup } from 'firebase/auth'
import { auth } from './firebase'

// Batch 6 (Option B) — the app has NO server-side Google credentials. We obtain a
// short-lived Google OAuth access token on the CLIENT via Firebase's Google provider
// with the calendar.events scope, then hand it to the auth-gated /api/calendar/push
// route, which performs the actual Calendar REST writes. The token is never stored;
// Firebase keeps no Google refresh token client-side, so we re-auth each push (the
// accepted Option-B tradeoff). The scope is requested ONLY here (on the explicit push),
// never on the app's normal sign-in (lib/firebase.ts googleProvider stays scope-free),
// so users who only browse recipes are never asked for calendar access.
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events'

// One push operation, computed by the client from the plan's stored event-id map.
// The server route is a dumb executor of these — it never lists/searches the calendar.
export type CalendarOp =
  | { day: string; op: 'create'; title: string; description: string; startISO: string; endISO: string; timeZone: string }
  | { day: string; op: 'update'; eventId: string; title: string; description: string; startISO: string; endISO: string; timeZone: string }
  | { day: string; op: 'delete'; eventId: string }

export interface CalendarOpResult {
  day: string
  op: 'create' | 'update' | 'delete'
  ok: boolean
  eventId?: string
  error?: string
}

/**
 * Obtain a fresh Google OAuth access token carrying the calendar.events scope. Uses
 * reauthenticateWithPopup for the already-signed-in user (no account-switch risk),
 * falling back to signInWithPopup if somehow signed out. Throws if the user cancels
 * the popup or the grant fails / returns no token.
 */
export async function getCalendarAccessToken(): Promise<string> {
  const provider = new GoogleAuthProvider()
  provider.addScope(CALENDAR_SCOPE)
  const current = auth.currentUser
  const result = current
    ? await reauthenticateWithPopup(current, provider)
    : await signInWithPopup(auth, provider)
  const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken
  if (!token) throw new Error('Google did not return a calendar access token.')
  return token
}

/**
 * Run a calendar push: get a calendar-scoped Google token (popup), then POST the
 * operations to the auth-gated server route (Firebase Bearer ID token), which executes
 * them against the user's PRIMARY calendar and returns one result per operation. All
 * calendar writes happen ONLY inside that route, ONLY for the operations passed here.
 */
export async function runCalendarPush(operations: CalendarOp[]): Promise<CalendarOpResult[]> {
  const user = auth.currentUser
  if (!user) throw new Error('Not signed in.')
  const accessToken = await getCalendarAccessToken()
  const idToken = await user.getIdToken()
  const res = await fetch('/api/calendar/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ accessToken, calendarId: 'primary', operations }),
  })
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(`Calendar push failed (${res.status}). ${msg}`.trim())
  }
  const data = await res.json()
  return Array.isArray(data?.results) ? data.results : []
}
