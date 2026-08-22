'use client'

import { useEffect } from 'react'
import { track } from '@vercel/analytics'

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('MEA Recipes route error', error)
    track('error_boundary', { boundary: 'route', hasDigest: Boolean(error.digest) })
  }, [error])

  return (
    <main className="min-h-[70vh] px-6 py-16 flex items-center justify-center">
      <section className="max-w-lg w-full bg-card border border-border rounded-2xl p-8 text-center animate-fade-in">
        <p className="text-amber text-xs font-body font-semibold uppercase tracking-[0.2em] mb-3">
          Kitchen hiccup
        </p>
        <h1 className="font-display text-4xl text-cream font-light mb-3">
          Something went wrong
        </h1>
        <p className="font-body text-sm text-muted leading-6 mb-6">
          We couldn&apos;t finish loading this part of MEA Recipes. Your saved recipes and plans are unchanged.
        </p>
        <button type="button" onClick={reset} className="btn-primary">
          Try again
        </button>
      </section>
    </main>
  )
}
