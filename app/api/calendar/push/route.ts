import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/firebaseAdmin'

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
  try {
    const j = await res.json()
    return j?.error?.message || JSON.stringify(j)
  } catch {
    return `HTTP ${res.status}`
  }
}

export async function POST(req: NextRequest) {
  const uid = await verifyAuthToken(req)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const accessToken: string | undefined = body?.accessToken
  const calendarId: string = body?.calendarId || 'primary'
  const operations: OpIn[] = Array.isArray(body?.operations) ? body.operations : []
  if (!accessToken) return NextResponse.json({ error: 'Missing accessToken' }, { status: 400 })

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
      results.push({ day, op: op.op || 'unknown', ok: false, error: e?.message || 'failed' })
    }
  }

  return NextResponse.json({ results })
}
