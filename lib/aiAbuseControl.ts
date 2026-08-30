import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getAdminDb } from './firebaseAdmin'

export type AIUsageClass = 'interactive' | 'assistant' | 'generation' | 'nutrition' | 'admin-batch'

export interface AIUsageProfile {
  windowMs: number
  windowLimit: number
  dailyLimit: number
  concurrencyLimit: number
  deadlineMs: number
  maxOutputTokens: number
}

export const AI_GLOBAL_DAILY_LIMIT = 500

export const AI_USAGE_PROFILES: Record<AIUsageClass, AIUsageProfile> = {
  interactive: { windowMs: 10 * 60_000, windowLimit: 60, dailyLimit: 180, concurrencyLimit: 3, deadlineMs: 45_000, maxOutputTokens: 2_500 },
  assistant: { windowMs: 10 * 60_000, windowLimit: 80, dailyLimit: 240, concurrencyLimit: 3, deadlineMs: 45_000, maxOutputTokens: 2_500 },
  generation: { windowMs: 10 * 60_000, windowLimit: 20, dailyLimit: 60, concurrencyLimit: 2, deadlineMs: 90_000, maxOutputTokens: 5_000 },
  nutrition: { windowMs: 10 * 60_000, windowLimit: 100, dailyLimit: 300, concurrencyLimit: 4, deadlineMs: 75_000, maxOutputTokens: 1_500 },
  'admin-batch': { windowMs: 10 * 60_000, windowLimit: 80, dailyLimit: 240, concurrencyLimit: 2, deadlineMs: 240_000, maxOutputTokens: 6_000 },
}

const AI_USAGE_COLLECTION = '_internalAiUsage'
const AI_USAGE_STATE_VERSION = 1
const LEASE_GRACE_MS = 30_000
const AI_LIMIT_MESSAGE = 'AI request limit reached. Try again later.'
const USAGE_CLASSES = Object.keys(AI_USAGE_PROFILES) as AIUsageClass[]

interface ClassUsageState {
  windowStartMs: number
  windowCount: number
  dailyCount: number
}

interface LeaseState {
  usageClass: AIUsageClass
  expiresAtMs: number
}

interface AIUsageState {
  version: 1
  dayKey: string
  totalDailyCount: number
  classes: Partial<Record<AIUsageClass, ClassUsageState>>
  leases: Record<string, LeaseState>
  updatedAtMs: number
}

export type AIAbuseDenialReason = 'short_window' | 'daily' | 'global_daily' | 'concurrency' | 'invalid_state'

export class AIAbuseControlError extends Error {
  readonly status = 429
  readonly code = 'ai-request-limited'

  constructor(
    readonly reason: AIAbuseDenialReason,
    readonly retryAfterSeconds: number,
  ) {
    super(AI_LIMIT_MESSAGE)
    this.name = 'AIAbuseControlError'
  }
}

export function isAIAbuseControlError(error: unknown): error is AIAbuseControlError {
  return error instanceof AIAbuseControlError
}

export function aiAbuseControlResponse(error: unknown): NextResponse | null {
  if (!isAIAbuseControlError(error)) return null
  return NextResponse.json(
    { error: AI_LIMIT_MESSAGE, code: error.code },
    {
      status: 429,
      headers: { 'Retry-After': String(Math.max(1, error.retryAfterSeconds)) },
    },
  )
}

export function aiUsageClassForFeature(feature: string): AIUsageClass {
  if (feature === 'recipe-assistant') return 'assistant'
  if (feature.startsWith('nutrition-')) return 'nutrition'
  if (feature.startsWith('cooking-mode-mapping-reviewer-') ||
      feature.startsWith('cooking-step-blind-reviewer-') ||
      feature === 'cooking-step-map-arbiter') return 'admin-batch'
  if (feature === 'recipe-generation' || feature === 'recipe-ingest' ||
      feature === 'new-recipe-suggestions' || feature === 'plan-suggestions' ||
      feature === 'recommendations' || feature === 'grocery-cleanup') return 'generation'
  return 'interactive'
}

function utcDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10)
}

function stateDocumentId(uid: string): string {
  return createHash('sha256').update('mea-ai-usage-v1\0').update(uid).digest('hex')
}

function isFiniteNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function parseUsageState(value: unknown): AIUsageState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const state = value as Partial<AIUsageState>
  if (state.version !== AI_USAGE_STATE_VERSION || typeof state.dayKey !== 'string' ||
      !isFiniteNonnegativeInteger(state.totalDailyCount) ||
      !isFiniteNonnegativeInteger(state.updatedAtMs) ||
      !state.classes || typeof state.classes !== 'object' || Array.isArray(state.classes) ||
      !state.leases || typeof state.leases !== 'object' || Array.isArray(state.leases)) return null

  for (const usageClass of USAGE_CLASSES) {
    const classState = state.classes[usageClass]
    if (classState === undefined) continue
    if (!classState || !isFiniteNonnegativeInteger(classState.windowStartMs) ||
        !isFiniteNonnegativeInteger(classState.windowCount) ||
        !isFiniteNonnegativeInteger(classState.dailyCount)) return null
  }
  for (const lease of Object.values(state.leases)) {
    if (!lease || !USAGE_CLASSES.includes(lease.usageClass) ||
        !isFiniteNonnegativeInteger(lease.expiresAtMs)) return null
  }
  return state as AIUsageState
}

function freshState(nowMs: number): AIUsageState {
  return {
    version: AI_USAGE_STATE_VERSION,
    dayKey: utcDayKey(nowMs),
    totalDailyCount: 0,
    classes: {},
    leases: {},
    updatedAtMs: nowMs,
  }
}

function normalizedState(state: AIUsageState, nowMs: number): AIUsageState {
  const next: AIUsageState = {
    ...state,
    classes: { ...state.classes },
    leases: Object.fromEntries(
      Object.entries(state.leases).filter(([, lease]) => lease.expiresAtMs > nowMs),
    ),
    updatedAtMs: nowMs,
  }
  const dayKey = utcDayKey(nowMs)
  if (next.dayKey !== dayKey) {
    next.dayKey = dayKey
    next.totalDailyCount = 0
    next.classes = Object.fromEntries(Object.entries(next.classes).map(([key, value]) => [
      key,
      { ...(value as ClassUsageState), dailyCount: 0 },
    ]))
  }
  return next
}

interface AIAbuseControlDependencies {
  db?: ReturnType<typeof getAdminDb>
  nowMs?: number
  leaseId?: string
  usageClass?: AIUsageClass
}

export interface AIUsageLease {
  uid: string
  leaseId: string
  usageClass: AIUsageClass
  profile: AIUsageProfile
}

export async function acquireAIUsageLease(
  uid: string,
  feature: string,
  dependencies: AIAbuseControlDependencies = {},
): Promise<AIUsageLease> {
  if (!uid) throw new AIAbuseControlError('invalid_state', 60)
  const db = dependencies.db || getAdminDb()
  const nowMs = dependencies.nowMs ?? Date.now()
  const usageClass = dependencies.usageClass ?? aiUsageClassForFeature(feature)
  const profile = AI_USAGE_PROFILES[usageClass]
  const leaseId = dependencies.leaseId || randomBytes(16).toString('hex')
  const ref = db.collection(AI_USAGE_COLLECTION).doc(stateDocumentId(uid))

  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref)
    const parsed = snapshot.exists ? parseUsageState(snapshot.data()) : freshState(nowMs)
    if (!parsed) throw new AIAbuseControlError('invalid_state', 60)
    const state = normalizedState(parsed, nowMs)
    const previous = state.classes[usageClass]
    const windowExpired = !previous || nowMs - previous.windowStartMs >= profile.windowMs
    const classState: ClassUsageState = windowExpired
      ? { windowStartMs: nowMs, windowCount: 0, dailyCount: previous?.dailyCount || 0 }
      : { ...previous }
    const activeClassLeases = Object.values(state.leases)
      .filter(lease => lease.usageClass === usageClass).length

    if (state.totalDailyCount >= AI_GLOBAL_DAILY_LIMIT) {
      throw new AIAbuseControlError('global_daily', 60 * 60)
    }
    if (classState.dailyCount >= profile.dailyLimit) {
      throw new AIAbuseControlError('daily', 60 * 60)
    }
    if (classState.windowCount >= profile.windowLimit) {
      const retryMs = Math.max(1_000, profile.windowMs - (nowMs - classState.windowStartMs))
      throw new AIAbuseControlError('short_window', Math.ceil(retryMs / 1_000))
    }
    if (activeClassLeases >= profile.concurrencyLimit) {
      const nearestExpiry = Math.min(...Object.values(state.leases)
        .filter(lease => lease.usageClass === usageClass)
        .map(lease => lease.expiresAtMs))
      throw new AIAbuseControlError('concurrency', Math.max(1, Math.ceil((nearestExpiry - nowMs) / 1_000)))
    }

    state.totalDailyCount++
    state.classes[usageClass] = {
      ...classState,
      windowCount: classState.windowCount + 1,
      dailyCount: classState.dailyCount + 1,
    }
    state.leases[leaseId] = {
      usageClass,
      expiresAtMs: nowMs + profile.deadlineMs + LEASE_GRACE_MS,
    }
    transaction.set(ref, state)
  })

  return { uid, leaseId, usageClass, profile }
}

export async function releaseAIUsageLease(
  lease: AIUsageLease,
  dependencies: Pick<AIAbuseControlDependencies, 'db' | 'nowMs'> = {},
): Promise<void> {
  const db = dependencies.db || getAdminDb()
  const nowMs = dependencies.nowMs ?? Date.now()
  const ref = db.collection(AI_USAGE_COLLECTION).doc(stateDocumentId(lease.uid))
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) return
    const parsed = parseUsageState(snapshot.data())
    if (!parsed) return
    const state = normalizedState(parsed, nowMs)
    delete state.leases[lease.leaseId]
    transaction.set(ref, state)
  })
}

export async function withAIAbuseControl<T>(
  feature: string,
  uid: string | undefined,
  operation: (profile: AIUsageProfile) => Promise<T>,
  requestedUsageClass?: AIUsageClass,
): Promise<T> {
  const usageClass = requestedUsageClass ?? aiUsageClassForFeature(feature)
  const profile = AI_USAGE_PROFILES[usageClass]
  // Trusted offline maintenance/test callers can omit uid, but every active API
  // route must pass its server-verified uid. They still receive finite defaults.
  if (!uid) return operation(profile)

  const lease = await acquireAIUsageLease(uid, feature, { usageClass: requestedUsageClass })
  try {
    return await operation(lease.profile)
  } finally {
    await releaseAIUsageLease(lease).catch(error => {
      console.error('[ai-abuse-control] lease release failed', {
        type: error instanceof Error ? error.name : 'NonError',
      })
    })
  }
}
