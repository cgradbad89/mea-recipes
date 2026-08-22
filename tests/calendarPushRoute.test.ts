import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  enforceAbuseLimit: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('@/lib/firebaseAdmin', () => ({ verifyAuthToken: mocks.verifyAuthToken }))
vi.mock('@/lib/apiAbuse', () => ({ enforceAbuseLimit: mocks.enforceAbuseLimit }))

import { POST } from '@/app/api/calendar/push/route'

const originalFetch = globalThis.fetch

function operation(index: number) {
  return { day: `2026-08-${String(index + 10).padStart(2, '0')}`, op: 'delete' as const, eventId: `event-${index}` }
}

function request(operations: unknown = [operation(0)]) {
  return new NextRequest('https://mea-recipes.vercel.app/api/calendar/push', {
    method: 'POST',
    headers: { Authorization: 'Bearer id-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: 'google-access-token', calendarId: 'primary', operations }),
  })
}

describe('POST /api/calendar/push', () => {
  beforeEach(() => {
    mocks.verifyAuthToken.mockReset()
    mocks.enforceAbuseLimit.mockReset()
    mocks.fetch.mockReset()
    mocks.verifyAuthToken.mockResolvedValue('verified-uid')
    mocks.enforceAbuseLimit.mockResolvedValue(null)
    mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }))
    globalThis.fetch = mocks.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('rejects an unauthenticated request before rate limiting or Calendar work', async () => {
    mocks.verifyAuthToken.mockResolvedValueOnce(null)

    const response = await POST(request())

    expect(response.status).toBe(401)
    expect(mocks.enforceAbuseLimit).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('rejects a rate-limited caller before Calendar work', async () => {
    mocks.enforceAbuseLimit.mockResolvedValueOnce(NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 }))

    const response = await POST(request())

    expect(response.status).toBe(429)
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
})
