import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/firebaseAdmin'
import { ApiRequestError, readBoundedJson, safeErrorLogDetails } from '@/lib/apiRequest'
import { enforceAbuseLimit } from '@/lib/apiAbuse'
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
const CREATE_OR_UPDATE_FIELDS = {
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).max(10),
  title: z.string().max(500),
  description: z.string().max(MAX_EVENT_TEXT_LENGTH),
  startISO: DATE_TIME,
  endISO: DATE_TIME,
  timeZone: z.string().max(100),
}
const OPERATION_SCHEMA = z.discriminatedUnion('op', [
  z.object({ op: z.literal('create'), ...CREATE_OR_UPDATE_FIELDS }),
  z.object({ op: z.literal('update'), eventId: z.string().min(1).max(512), ...CREATE_OR_UPDATE_FIELDS }),
  z.object({ op: z.literal('delete'), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).max(10), eventId: z.string().min(1).max(512) }),
])
const REQUEST_SCHEMA = z.object({
  accessToken: z.string().min(1).max(8_192),
  calendarId: z.literal('primary').optional(),
  operations: z.array(OPERATION_SCHEMA).max(MAX_CALENDAR_OPERATIONS),
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

export async function POST(req: NextRequest) {
  const uid = await verifyAuthToken(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const abuseResponse = await enforceAbuseLimit(req, 'writeHeavy', uid)
  if (abuseResponse) return abuseResponse

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

  const { accessToken } = body
  const calendarId = body.calendarId || 'primary'
  const operations: OpIn[] = body.operations

  const cal = encodeURIComponent(calendarId)
  const jsonHeaders = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
  const results: Array<{ day: string; op: string; ok: boolean; eventId?: string; error?: string }> = []

  const createEvent = async (op: OpIn): Promise<string> => {
    const res = await fetch(`${CAL_BASE}/${cal}/events`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(eventBody(op)),
    })
    if (!res.ok) throw new Error(await errText(res))
    const data = await res.json()
    return data.id as string
  }

  for (const op of operations) {
    const day = op.day || ''
    try {
      if (op.op === 'create') {
        const id = await createEvent(op)
        results.push({ day, op: 'create', ok: true, eventId: id })
      } else if (op.op === 'update') {
        if (!op.eventId) throw new Error('Missing eventId for update')
        const res = await fetch(`${CAL_BASE}/${cal}/events/${encodeURIComponent(op.eventId)}`, {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify(eventBody(op)),
        })
        if (res.status === 404 || res.status === 410) {
          // Stored event was deleted on Google's side → recreate so re-push self-heals.
          const id = await createEvent(op)
          results.push({ day, op: 'create', ok: true, eventId: id })
        } else if (!res.ok) {
          throw new Error(await errText(res))
        } else {
          const data = await res.json()
          results.push({ day, op: 'update', ok: true, eventId: data.id })
        }
      } else if (op.op === 'delete') {
        if (!op.eventId) throw new Error('Missing eventId for delete')
        const res = await fetch(`${CAL_BASE}/${cal}/events/${encodeURIComponent(op.eventId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        // 200/204 = deleted; 404/410 = already gone — both are success for idempotent removal.
        if (res.ok || res.status === 404 || res.status === 410) {
          results.push({ day, op: 'delete', ok: true })
        } else {
          throw new Error(await errText(res))
        }
      } else {
        throw new Error(`Unknown op: ${op.op}`)
      }
    } catch (e: any) {
      results.push({ day, op: op.op || 'unknown', ok: false, error: 'Calendar operation failed.' })
    }
  }

  return NextResponse.json({ results })
}
