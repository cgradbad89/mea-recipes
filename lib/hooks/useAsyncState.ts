'use client'

import { useCallback, useEffect, useState } from 'react'

type AsyncLoadSource<T> = {
  load: () => Promise<T>
}

type AsyncSubscriptionSource<T> = {
  subscribe: (
    onData: (data: T) => void,
    onError: (error: unknown) => void,
  ) => void | (() => void)
}

export type AsyncStateSource<T> = AsyncLoadSource<T> | AsyncSubscriptionSource<T>

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
  retry: () => void
}

export function asyncErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return 'Something went wrong. Please try again.'
}

/**
 * Shared state handling for a one-shot promise or a realtime subscription.
 * Keep `source` referentially stable (for example with `useMemo`) so the hook
 * only reconnects when the underlying request parameters change.
 */
export function useAsyncState<T>(source: AsyncStateSource<T>, initialData: T | null = null): AsyncState<T> {
  const [data, setData] = useState<T | null>(initialData)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const retry = useCallback(() => setAttempt(value => value + 1), [])

  useEffect(() => {
    let active = true
    let unsubscribe: void | (() => void)

    setLoading(true)
    setError(null)

    const onData = (value: T) => {
      if (!active) return
      setData(value)
      setLoading(false)
      setError(null)
    }

    const onError = (reason: unknown) => {
      if (!active) return
      setError(asyncErrorMessage(reason))
      setLoading(false)
    }

    if ('load' in source) {
      Promise.resolve()
        .then(source.load)
        .then(onData, onError)
    } else {
      try {
        unsubscribe = source.subscribe(onData, onError)
      } catch (reason) {
        onError(reason)
      }
    }

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [attempt, source])

  return { data, loading, error, retry }
}
