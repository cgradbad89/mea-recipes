import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('@/lib/firebaseAdmin', () => ({ verifyAuthToken: mocks.verifyAuthToken }))

import { POST } from '@/app/api/calendar/push/route'
import { calendarEventIdFor } from '@/lib/calendarEventIdentity'

const originalFetch = globalThis.fetch

function operation(index: number) {
  return { day: `2026-08-${String(index + 10).padStart(2, '0')}`, op: 'delete' as const, eventId: `event-${index}` }
}

function request(operations: unknown = [operation(0)], weekID = '2026-08-10') {
  return new NextRequest('https://mea-recipes.vercel.app/api/calendar/push', {
    method: 'POST',
    headers: { Authorization: 'Bearer id-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: 'google-access-token', calendarId: 'primary', weekID, operations }),
  })
}

describe('POST /api/calendar/push', () => {
  beforeEach(() => {
    mocks.verifyAuthToken.mockReset()
    mocks.fetch.mockReset()
    mocks.verifyAuthToken.mockResolvedValue('verified-uid')
    mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }))
    globalThis.fetch = mocks.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('rejects an unauthenticated request before Calendar work', async () => {
    mocks.verifyAuthToken.mockResolvedValueOnce(null)

    const response = await POST(request())

    expect(response.status).toBe(401)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('rejects more than one week of Calendar operations before provider calls', async () => {
    const response = await POST(request(Array.from({ length: 8 }, (_, index) => operation(index))))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid request.' })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('accepts the seven-operation weekly boundary', async () => {
    const response = await POST(request(Array.from({ length: 7 }, (_, index) => operation(index))))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.results).toHaveLength(7)
    expect(body.results.every((result: { ok: boolean }) => result.ok)).toBe(true)
    expect(mocks.fetch).toHaveBeenCalledTimes(7)
  })

  it('accepts the local wall-clock date format used by the plan UI', async () => {
    const response = await POST(request([{
      day: '2026-08-10',
      op: 'create',
      title: 'Dinner',
      description: 'Recipe links',
      startISO: '2026-08-10T18:30:00',
      endISO: '2026-08-10T19:30:00',
      timeZone: 'America/New_York',
    }]))

    expect(response.status).toBe(200)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('creates a new event with an opaque deterministic application-owned ID', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'provider-id' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const response = await POST(request([{
      day: '2026-08-10', op: 'create', title: 'Dinner', description: 'Recipe links',
      startISO: '2026-08-10T18:30:00', endISO: '2026-08-10T19:30:00', timeZone: 'America/New_York',
    }]))
    const body = await response.json()
    const expectedId = calendarEventIdFor('verified-uid', '2026-08-10', '2026-08-10')

    expect(body.results).toEqual([{ day: '2026-08-10', op: 'create', ok: true, eventId: expectedId }])
    const requestBody = JSON.parse(String(mocks.fetch.mock.calls[0][1]?.body))
    expect(requestBody.id).toBe(expectedId)
    expect(expectedId).toMatch(/^[a-v0-9]{5,1024}$/)
    expect(expectedId).not.toContain('verified-uid')
  })

  it('reconciles a deterministic create retry when Google reports the ID already exists', async () => {
    mocks.fetch
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'ignored' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
    const op = {
      day: '2026-08-10', op: 'create' as const, title: 'Dinner', description: '',
      startISO: '2026-08-10T18:30:00', endISO: '2026-08-10T19:30:00', timeZone: 'America/New_York',
    }

    const response = await POST(request([op]))
    const body = await response.json()
    const expectedId = calendarEventIdFor('verified-uid', '2026-08-10', '2026-08-10')

    expect(body.results[0]).toEqual({ day: '2026-08-10', op: 'create', ok: true, eventId: expectedId })
    expect(mocks.fetch.mock.calls[0][1]?.method).toBe('POST')
    expect(mocks.fetch.mock.calls[1][0]).toContain(`/events/${expectedId}`)
    expect(mocks.fetch.mock.calls[1][1]?.method).toBe('PATCH')
  })

  it('updates an existing legacy stored Google event ID without replacing it', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'legacyABC123' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const response = await POST(request([{
      day: '2026-08-10', op: 'update', eventId: 'legacyABC123', title: 'Dinner', description: '',
      startISO: '2026-08-10T18:30:00', endISO: '2026-08-10T19:30:00', timeZone: 'America/New_York',
    }]))

    expect(await response.json()).toEqual({ results: [{
      day: '2026-08-10', op: 'update', ok: true, eventId: 'legacyABC123',
    }] })
    expect(mocks.fetch.mock.calls[0][0]).toContain('/events/legacyABC123')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('returns independent partial results without inventing a second ID', async () => {
    mocks.fetch
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
    const create = (day: string) => ({
      day, op: 'create' as const, title: 'Dinner', description: '',
      startISO: `${day}T18:30:00`, endISO: `${day}T19:30:00`, timeZone: 'America/New_York',
    })

    const response = await POST(request([create('2026-08-10'), create('2026-08-11')]))
    const { results } = await response.json()

    expect(results[0]).toEqual(expect.objectContaining({ day: '2026-08-10', ok: false }))
    expect(results[1]).toEqual(expect.objectContaining({ day: '2026-08-11', ok: true }))
    const firstBody = JSON.parse(String(mocks.fetch.mock.calls[0][1]?.body))
    const secondBody = JSON.parse(String(mocks.fetch.mock.calls[1][1]?.body))
    expect(firstBody.id).toBe(calendarEventIdFor('verified-uid', '2026-08-10', '2026-08-10'))
    expect(secondBody.id).toBe(calendarEventIdFor('verified-uid', '2026-08-10', '2026-08-11'))
  })

  it('converges to the same event after remote create succeeds but local persistence is absent', async () => {
    const op = {
      day: '2026-08-10', op: 'create' as const, title: 'Dinner', description: '',
      startISO: '2026-08-10T18:30:00', endISO: '2026-08-10T19:30:00', timeZone: 'America/New_York',
    }
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
    const first = await POST(request([op]))
    const firstResult = (await first.json()).results[0]
    mocks.fetch
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
    const retry = await POST(request([op]))
    const retryResult = (await retry.json()).results[0]

    expect(retryResult.eventId).toBe(firstResult.eventId)
    expect(retryResult.ok).toBe(true)
  })

  it.each([404, 410])('treats delete status %s as converged success', async status => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status }))
    const response = await POST(request([operation(0)]))

    expect(await response.json()).toEqual({ results: [{ day: '2026-08-10', op: 'delete', ok: true }] })
  })

  it('keeps successful and failed deletes distinguishable for client-side map persistence', async () => {
    mocks.fetch
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
    const response = await POST(request([operation(0), operation(1)]))
    const { results } = await response.json()

    expect(results[0]).toEqual({ day: '2026-08-10', op: 'delete', ok: true })
    expect(results[1]).toEqual(expect.objectContaining({ day: '2026-08-11', ok: false }))
  })

  it('rejects malformed client event IDs before provider calls', async () => {
    const response = await POST(request([{
      day: '2026-08-10', op: 'delete', eventId: '../../other-event',
    }]))

    expect(response.status).toBe(400)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('stops provider calls after the Calendar access token is rejected', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }))
    const response = await POST(request([operation(0), operation(1)]))
    const { results } = await response.json()

    expect(results).toHaveLength(2)
    expect(results.every((result: { ok: boolean; error: string }) =>
      !result.ok && result.error === 'Calendar authorization failed.')).toBe(true)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('never uses Calendar list or search requests', async () => {
    await POST(request([operation(0), operation(1)]))

    for (const [url, init] of mocks.fetch.mock.calls) {
      expect(init?.method).not.toBe('GET')
      expect(String(url)).not.toMatch(/[?&](q|iCalUID)=/)
    }
  })
})
