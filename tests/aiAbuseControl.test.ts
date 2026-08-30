import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

type Stored = Record<string, unknown>

class MemoryDb {
  readonly documents = new Map<string, Stored>()

  collection(name: string) {
    return {
      doc: (id: string) => ({ path: `${name}/${id}` }),
    }
  }

  async runTransaction<T>(callback: (transaction: {
    get: (ref: { path: string }) => Promise<{ exists: boolean; data: () => Stored | undefined }>
    set: (ref: { path: string }, value: Stored) => void
  }) => Promise<T>): Promise<T> {
    return callback({
      get: async ref => ({
        exists: this.documents.has(ref.path),
        data: () => this.documents.get(ref.path),
      }),
      set: (ref, value) => this.documents.set(ref.path, structuredClone(value)),
    })
  }
}

const memoryDb = new MemoryDb()

vi.mock('@/lib/firebaseAdmin', () => ({ getAdminDb: () => memoryDb }))

import {
  AI_GLOBAL_DAILY_LIMIT,
  AI_USAGE_PROFILES,
  AIAbuseControlError,
  acquireAIUsageLease,
  aiAbuseControlResponse,
  aiUsageClassForFeature,
  releaseAIUsageLease,
  withAIAbuseControl,
} from '@/lib/aiAbuseControl'

const baseNow = Date.parse('2026-08-29T12:00:00Z')

beforeEach(() => {
  memoryDb.documents.clear()
})

describe('distributed AI usage control', () => {
  it('allows normal use and isolates independent users', async () => {
    const first = await acquireAIUsageLease('user-a', 'grocery-parse-line', {
      db: memoryDb as never, nowMs: baseNow, leaseId: 'lease-a',
    })
    const second = await acquireAIUsageLease('user-b', 'grocery-parse-line', {
      db: memoryDb as never, nowMs: baseNow, leaseId: 'lease-b',
    })

    expect(first.usageClass).toBe('interactive')
    expect(second.usageClass).toBe('interactive')
    expect(memoryDb.documents.size).toBe(2)
  })

  it('enforces and then resets the short window threshold', async () => {
    const profile = AI_USAGE_PROFILES.interactive
    for (let index = 0; index < profile.windowLimit; index++) {
      const lease = await acquireAIUsageLease('user-a', 'grocery-parse-line', {
        db: memoryDb as never, nowMs: baseNow, leaseId: `lease-${index}`,
      })
      await releaseAIUsageLease(lease, { db: memoryDb as never, nowMs: baseNow })
    }

    await expect(acquireAIUsageLease('user-a', 'grocery-parse-line', {
      db: memoryDb as never, nowMs: baseNow, leaseId: 'denied',
    })).rejects.toEqual(expect.objectContaining({ reason: 'short_window', status: 429 }))

    await expect(acquireAIUsageLease('user-a', 'grocery-parse-line', {
      db: memoryDb as never, nowMs: baseNow + profile.windowMs, leaseId: 'reset',
    })).resolves.toEqual(expect.objectContaining({ leaseId: 'reset' }))
  })

  it('enforces the finite per-class daily ceiling across successive windows', async () => {
    const profile = AI_USAGE_PROFILES.generation
    let nowMs = baseNow
    for (let index = 0; index < profile.dailyLimit; index++) {
      if (index > 0 && index % profile.windowLimit === 0) nowMs += profile.windowMs
      const lease = await acquireAIUsageLease('user-a', 'recipe-generation', {
        db: memoryDb as never, nowMs, leaseId: `lease-${index}`,
      })
      await releaseAIUsageLease(lease, { db: memoryDb as never, nowMs })
    }

    await expect(acquireAIUsageLease('user-a', 'recipe-generation', {
      db: memoryDb as never, nowMs, leaseId: 'daily-denied',
    })).rejects.toEqual(expect.objectContaining({ reason: 'daily' }))
    expect(profile.dailyLimit).toBeLessThan(AI_GLOBAL_DAILY_LIMIT)

    await expect(acquireAIUsageLease('user-a', 'recipe-generation', {
      db: memoryDb as never,
      nowMs: Date.parse('2026-08-30T00:00:01Z'),
      leaseId: 'next-day',
    })).resolves.toEqual(expect.objectContaining({ leaseId: 'next-day' }))
  })

  it('keeps route classes independent while applying explicit admin-batch limits', async () => {
    const generation = await acquireAIUsageLease('user-a', 'recipe-generation', {
      db: memoryDb as never, nowMs: baseNow, leaseId: 'generation',
    })
    const assistant = await acquireAIUsageLease('user-a', 'recipe-assistant', {
      db: memoryDb as never, nowMs: baseNow, leaseId: 'assistant',
    })

    expect(generation.usageClass).toBe('generation')
    expect(assistant.usageClass).toBe('assistant')
    expect(aiUsageClassForFeature('cooking-mode-mapping-reviewer-a')).toBe('admin-batch')
    expect(AI_USAGE_PROFILES['admin-batch'].deadlineMs).toBe(240_000)

    const explicitlyBatched = await acquireAIUsageLease('user-b', 'nutrition-food-estimate', {
      db: memoryDb as never,
      nowMs: baseNow,
      leaseId: 'explicit-admin-batch',
      usageClass: 'admin-batch',
    })
    expect(explicitlyBatched.usageClass).toBe('admin-batch')
  })

  it('enforces the global daily ceiling across usage classes', async () => {
    await acquireAIUsageLease('user-a', 'recipe-generation', {
      db: memoryDb as never, nowMs: baseNow, leaseId: 'seed',
    })
    const key = [...memoryDb.documents.keys()][0]
    const state = structuredClone(memoryDb.documents.get(key)!) as Record<string, unknown>
    state.totalDailyCount = AI_GLOBAL_DAILY_LIMIT
    state.leases = {}
    memoryDb.documents.set(key, state)

    await expect(acquireAIUsageLease('user-a', 'recipe-assistant', {
      db: memoryDb as never, nowMs: baseNow, leaseId: 'global-denied',
    })).rejects.toEqual(expect.objectContaining({ reason: 'global_daily' }))
  })

  it('denies excess concurrency and recovers after release or lease expiry', async () => {
    const profile = AI_USAGE_PROFILES.generation
    const leases = []
    for (let index = 0; index < profile.concurrencyLimit; index++) {
      leases.push(await acquireAIUsageLease('user-a', 'recipe-generation', {
        db: memoryDb as never, nowMs: baseNow, leaseId: `lease-${index}`,
      }))
    }
    await expect(acquireAIUsageLease('user-a', 'recipe-generation', {
      db: memoryDb as never, nowMs: baseNow, leaseId: 'blocked',
    })).rejects.toEqual(expect.objectContaining({ reason: 'concurrency' }))

    await releaseAIUsageLease(leases[0], { db: memoryDb as never, nowMs: baseNow })
    await expect(acquireAIUsageLease('user-a', 'recipe-generation', {
      db: memoryDb as never, nowMs: baseNow, leaseId: 'after-release',
    })).resolves.toEqual(expect.objectContaining({ leaseId: 'after-release' }))

    await expect(acquireAIUsageLease('user-a', 'recipe-generation', {
      db: memoryDb as never,
      nowMs: baseNow + profile.deadlineMs + 30_001,
      leaseId: 'after-expiry',
    })).resolves.toEqual(expect.objectContaining({ leaseId: 'after-expiry' }))
  })

  it('releases concurrency after both success and exception', async () => {
    await expect(withAIAbuseControl('recipe-generation', 'user-a', async () => 'ok')).resolves.toBe('ok')
    let state = [...memoryDb.documents.values()][0] as { leases: Record<string, unknown> }
    expect(Object.keys(state.leases)).toHaveLength(0)

    await expect(withAIAbuseControl('recipe-generation', 'user-a', async () => {
      throw new Error('provider failed')
    })).rejects.toThrow('provider failed')
    state = [...memoryDb.documents.values()][0] as { leases: Record<string, unknown> }
    expect(Object.keys(state.leases)).toHaveLength(0)
  })

  it('fails closed on malformed persisted limiter state', async () => {
    const lease = await acquireAIUsageLease('user-a', 'recipe-generation', {
      db: memoryDb as never, nowMs: baseNow, leaseId: 'seed',
    })
    const key = [...memoryDb.documents.keys()][0]
    memoryDb.documents.set(key, { version: 1, dayKey: 'bad', totalDailyCount: 'unbounded' })

    await expect(acquireAIUsageLease('user-a', 'recipe-generation', {
      db: memoryDb as never, nowMs: baseNow, leaseId: 'denied',
    })).rejects.toEqual(expect.objectContaining({ reason: 'invalid_state', status: 429 }))
    expect(lease.uid).toBe('user-a')
  })

  it('returns a sanitized 429 and never runs the operation after denial', async () => {
    for (let index = 0; index < AI_USAGE_PROFILES.generation.concurrencyLimit; index++) {
      await acquireAIUsageLease('user-a', 'recipe-generation', {
        db: memoryDb as never, leaseId: `active-${index}`,
      })
    }
    const operation = vi.fn()
    let denial: unknown
    try {
      await withAIAbuseControl('recipe-generation', 'user-a', operation)
    } catch (error) {
      denial = error
    }

    expect(operation).not.toHaveBeenCalled()
    expect(denial).toBeInstanceOf(AIAbuseControlError)
    const response = aiAbuseControlResponse(denial)!
    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({
      error: 'AI request limit reached. Try again later.',
      code: 'ai-request-limited',
    })
  })
})
