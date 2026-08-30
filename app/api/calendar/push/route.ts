import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/firebaseAdmin'
import { ApiRequestError, readBoundedJson, safeErrorLogDetails } from '@/lib/apiRequest'
import { calendarEventIdFor } from '@/lib/calendarEventIdentity'
import { z } from 'zod'

// Batch 6 — Google Calendar push executor. Auth-gated by verifyAuthToken (Firebase
// Bearer ID token), exactly like /api/ai-ingest and /api/grocery-cleanup. The Google
// OAuth access token (calendar.events scope) is obtained on the CLIENT (Option B —
// the app has no server-side Google creds) and passed in the body; this route uses it
// transiently and NEVER persists it.
//
// SAFETY (non-negotiable): this route is a dumb executor of the EXPLICIT operations the
// client built from the plan's stored calendarEventIds map. It only ever
//   • CREATEs a new event and returns its id, or
//   • UPDATEs / DELETEs the exact eventId handed to it.
// It has NO list/search capability, so it can never touch an event the app didn't
// create and record — "no calendar-wide search-and-delete" is structural here.

const CAL_BASE = 'https://www.googleapis.com/calendar/v3/calendars'
const CALENDAR_MAX_BODY_BYTES = 128_000
// A weekly plan has at most seven day events. Keeping this cap server-side
// prevents a small request from being turned into an arbitrary Calendar batch.
const MAX_CALENDAR_OPERATIONS = 7
const MAX_EVENT_TEXT_LENGTH = 8_000
const EVENT_ID = /^[A-Za-z0-9_-]{5,512}$/

interface OpIn {
  day?: string
  op?: 'create' | 'update' | 'delete'
  eventId?: string
  title?: string
  description?: string
  startISO?: string
  endISO?: string
  timeZone?: string
}

// The client intentionally sends local wall-clock values and supplies `timeZone`
// separately so Google applies the selected zone without an offset conversion.
const DATE_TIME = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/).max(32)
const ISO_DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).max(10).refine(value => {
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
})
const TIME_ZONE = z.string().min(1).max(100).refine(value => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
})
const CREATE_OR_UPDATE_FIELDS = {
  day: ISO_DAY,
  title: z.string().trim().min(1).max(500),
  description: z.string().max(MAX_EVENT_TEXT_LENGTH),
  startISO: DATE_TIME,
  endISO: DATE_TIME,
  timeZone: TIME_ZONE,
}
const OPERATION_SCHEMA = z.discriminatedUnion('op', [
  z.object({ op: z.literal('create'), ...CREATE_OR_UPDATE_FIELDS }),
  z.object({ op: z.literal('update'), eventId: z.string().regex(EVENT_ID), ...CREATE_OR_UPDATE_FIELDS }),
  z.object({ op: z.literal('delete'), day: ISO_DAY, eventId: z.string().regex(EVENT_ID) }),
])
const REQUEST_SCHEMA = z.object({
  accessToken: z.string().min(1).max(8_192),
  calendarId: z.literal('primary').optional(),
  weekID: ISO_DAY,
  operations: z.array(OPERATION_SCHEMA).min(1).max(MAX_CALENDAR_OPERATIONS),
}).superRefine((request, context) => {
  const weekStart = new Date(`${request.weekID}T00:00:00Z`)
  const weekEnd = new Date(weekStart)
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)
  const seenDays = new Set<string>()
  request.operations.forEach((operation, index) => {
    const day = new Date(`${operation.day}T00:00:00Z`)
    if (day < weekStart || day > weekEnd) {
      context.addIssue({ code: 'custom', path: ['operations', index, 'day'], message: 'Day is outside the selected week.' })
    }
    if (seenDays.has(operation.day)) {
      context.addIssue({ code: 'custom', path: ['operations', index, 'day'], message: 'Each day may appear only once.' })
    }
    seenDays.add(operation.day)
    if (operation.op !== 'delete') {
      const start = new Date(`${operation.startISO}Z`)
      const end = new Date(`${operation.endISO}Z`)
      if (operation.startISO.slice(0, 10) !== operation.day ||
          Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        context.addIssue({ code: 'custom', path: ['operations', index], message: 'Event date range is invalid.' })
      }
    }
  })
})

function eventBody(op: OpIn) {
  return {
    summary: op.title,
    description: op.description,
    // dateTime carries no offset; Google interprets it in the supplied timeZone.
    start: { dateTime: op.startISO, timeZone: op.timeZone },
    end: { dateTime: op.endISO, timeZone: op.timeZone },
  }
}

async function errText(res: Response): Promise<string> {
  // Provider diagnostics may include account or implementation details. The
  // client only needs a stable per-operation failure signal.
  await res.text().catch(() => undefined)
  return 'Calendar operation failed.'
}

class CalendarAccessTokenError extends Error {}

async function requireCalendarResponse(res: Response): Promise<Response> {
  if (res.status === 401 || res.status === 403) {
    await res.text().catch(() => undefined)
    throw new CalendarAccessTokenError('Calendar authorization failed.')
  }
  return res
}

export async function POST(req: NextRequest) {
  const verifiedUid = await verifyAuthToken(req)
  if (!verifiedUid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: z.infer<typeof REQUEST_SCHEMA>
  try {
    const requestResult = REQUEST_SCHEMA.safeParse(
      await readBoundedJson(req, CALENDAR_MAX_BODY_BYTES),
    )
    if (!requestResult.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
    body = requestResult.data
  } catch (err) {
    if (err instanceof ApiRequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[calendar-push] request parsing failed', { error: safeErrorLogDetails(err) })
    return NextResponse.json({ error: 'Unable to complete the request.' }, { status: 500 })
  }

  const { accessToken, weekID } = body
  const calendarId = body.calendarId || 'primary'
  const operations: OpIn[] = body.operations

  const cal = encodeURIComponent(calendarId)
  const jsonHeaders = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
  const results: Array<{ day: string; op: string; ok: boolean; eventId?: string; error?: string }> = []
  let providerAuthorizationFailed = false

  const updateEvent = async (op: OpIn, eventId: string): Promise<'ok' | 'missing'> => {
    const res = await requireCalendarResponse(await fetch(
      `${CAL_BASE}/${cal}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify(eventBody(op)),
      },
    ))
    if (res.status === 404 || res.status === 410) return 'missing'
    if (!res.ok) throw new Error(await errText(res))
    await res.json().catch(() => undefined)
    return 'ok'
  }

  const createEvent = async (op: OpIn): Promise<string> => {
    const deterministicId = calendarEventIdFor(verifiedUid, weekID, op.day || '')
    const res = await requireCalendarResponse(await fetch(`${CAL_BASE}/${cal}/events`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ id: deterministicId, ...eventBody(op) }),
    }))
    if (res.status === 409) {
      const reconciled = await updateEvent(op, deterministicId)
      if (reconciled !== 'ok') throw new Error('Calendar operation failed.')
      return deterministicId
    }
    if (!res.ok) throw new Error(await errText(res))
    await res.json().catch(() => undefined)
    return deterministicId
  }

  for (const op of operations) {
    const day = op.day || ''
    if (providerAuthorizationFailed) {
      results.push({ day, op: op.op || 'unknown', ok: false, error: 'Calendar authorization failed.' })
      continue
    }
    try {
      if (op.op === 'create') {
        const id = await createEvent(op)
        results.push({ day, op: 'create', ok: true, eventId: id })
      } else if (op.op === 'update') {
        if (!op.eventId) throw new Error('Missing eventId for update')
        const updateResult = await updateEvent(op, op.eventId)
        if (updateResult === 'missing') {
          // A missing legacy/stored event heals into the deterministic identity.
          const id = await createEvent(op)
          results.push({ day, op: 'create', ok: true, eventId: id })
        } else {
          results.push({ day, op: 'update', ok: true, eventId: op.eventId })
        }
      } else if (op.op === 'delete') {
        if (!op.eventId) throw new Error('Missing eventId for delete')
        const res = await requireCalendarResponse(await fetch(`${CAL_BASE}/${cal}/events/${encodeURIComponent(op.eventId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        }))
        // 200/204 = deleted; 404/410 = already gone — both are success for idempotent removal.
        if (res.ok || res.status === 404 || res.status === 410) {
          results.push({ day, op: 'delete', ok: true })
        } else {
          throw new Error(await errText(res))
        }
      } else {
        throw new Error(`Unknown op: ${op.op}`)
      }
    } catch (error) {
      if (error instanceof CalendarAccessTokenError) providerAuthorizationFailed = true
      results.push({
        day,
        op: op.op || 'unknown',
        ok: false,
        error: error instanceof CalendarAccessTokenError
          ? 'Calendar authorization failed.'
          : 'Calendar operation failed.',
      })
    }
  }

  return NextResponse.json({ results })
}
