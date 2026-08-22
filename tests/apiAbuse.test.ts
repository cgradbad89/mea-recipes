import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ checkRateLimit: vi.fn() }))
vi.mock('@vercel/firewall', () => ({ checkRateLimit: mocks.checkRateLimit }))

import { enforceAbuseLimit } from '@/lib/apiAbuse'

const previousVercel = process.env.VERCEL
const previousVercelEnv = process.env.VERCEL_ENV

function request(headers: HeadersInit = {}) {
  return new Request('https://mea-recipes.vercel.app/api/test', { headers })
}

describe('distributed API abuse controls', () => {
  beforeEach(() => {
    process.env.VERCEL = '1'
    process.env.VERCEL_ENV = 'production'
    mocks.checkRateLimit.mockReset()
    mocks.checkRateLimit.mockResolvedValue({ rateLimited: false })
  })

  afterEach(() => {
    if (previousVercel === undefined) delete process.env.VERCEL
    else process.env.VERCEL = previousVercel
    if (previousVercelEnv === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = previousVercelEnv
  })

  it('keys authenticated limits by the server-verified uid, not a request header', async () => {
    const result = await enforceAbuseLimit(request({ 'x-user-id': 'attacker-choice' }), 'aiExpensive', 'verified-uid')

    expect(result).toBeNull()
    expect(mocks.checkRateLimit).toHaveBeenCalledWith('mea-ai-expensive-v1', expect.objectContaining({
      rateLimitKey: 'verified-uid',
    }))
  })

  it('leaves public limits keyed by the Firewall request identity', async () => {
    const result = await enforceAbuseLimit(request({ 'x-forwarded-for': '198.51.100.2' }), 'publicFetch')

    expect(result).toBeNull()
    expect(mocks.checkRateLimit).toHaveBeenCalledWith('mea-public-fetch-v1', {
      request: expect.any(Request),
    })
  })

  it('returns the stable 429 response without forwarding limiter details', async () => {
    mocks.checkRateLimit.mockResolvedValueOnce({ rateLimited: true })

    const response = await enforceAbuseLimit(request(), 'externalLookup', 'verified-uid')

    expect(response?.status).toBe(429)
    await expect(response?.json()).resolves.toEqual({ error: 'Too many requests. Please try again later.' })
  })

  it('fails closed in Vercel production when the required Firewall rule is absent', async () => {
    mocks.checkRateLimit.mockResolvedValueOnce({ rateLimited: false, error: 'not-found' })

    const response = await enforceAbuseLimit(request(), 'writeHeavy', 'verified-uid')

    expect(response?.status).toBe(503)
    await expect(response?.json()).resolves.toEqual({ error: 'Service temporarily unavailable.' })
  })

  it('fails closed in Vercel production when Firewall cannot be reached', async () => {
    mocks.checkRateLimit.mockRejectedValueOnce(new Error('rate-limit provider failure'))

    const response = await enforceAbuseLimit(request(), 'aiStandard', 'verified-uid')

    expect(response?.status).toBe(503)
    await expect(response?.json()).resolves.toEqual({ error: 'Service temporarily unavailable.' })
  })

  it('does not require Firewall configuration outside Vercel', async () => {
    delete process.env.VERCEL

    const response = await enforceAbuseLimit(request(), 'publicFetch')

    expect(response).toBeNull()
    expect(mocks.checkRateLimit).not.toHaveBeenCalled()
  })
})
