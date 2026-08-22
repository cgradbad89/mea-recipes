'use client'

import type { ReactNode } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { asyncErrorMessage } from '@/lib/hooks/useAsyncState'

interface LoadingErrorRetryProps {
  loading: boolean
  error: unknown
  retry: () => void
  children: ReactNode
  loadingLabel?: string
  errorPrefix?: string
  loadingFallback?: ReactNode
  className?: string
}

export default function LoadingErrorRetry({
  loading,
  error,
  retry,
  children,
  loadingLabel = 'Loading…',
  errorPrefix = 'Couldn’t load this content.',
  loadingFallback,
  className = '',
}: LoadingErrorRetryProps) {
  if (loading) {
    if (loadingFallback !== undefined) return <>{loadingFallback}</>
    return (
      <div role="status" className={`flex items-center justify-center gap-2 py-16 text-faint font-body text-sm ${className}`}>
        <Loader2 className="animate-spin text-amber" size={22} aria-hidden="true" />
        <span>{loadingLabel}</span>
      </div>
    )
  }

  if (error) {
    return (
      <div role="alert" className={`rounded-xl border border-red-400/20 bg-red-400/5 px-4 py-3 ${className}`}>
        <p className="text-red-400 text-sm font-body">
          {errorPrefix} <span className="text-red-300/80">{asyncErrorMessage(error)}</span>
        </p>
        <button
          type="button"
          onClick={retry}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-red-400/30 px-3 py-1.5 text-xs font-body font-medium text-red-300 transition-colors hover:bg-red-400/10"
        >
          <RefreshCw size={13} aria-hidden="true" />
          Retry
        </button>
      </div>
    )
  }

  return <>{children}</>
}
