'use client'

import { useEffect } from 'react'
import { track } from '@vercel/analytics'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('MEA Recipes global error', error)
    track('error_boundary', { boundary: 'global', hasDigest: Boolean(error.digest) })
  }, [error])

  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#0F0D0A', color: '#F5F0E8', fontFamily: 'system-ui, sans-serif' }}>
        <main style={{ minHeight: '100vh', padding: '48px 24px', display: 'grid', placeItems: 'center' }}>
          <section style={{ width: '100%', maxWidth: 520, padding: 32, textAlign: 'center', background: '#1A1612', border: '1px solid #2E2820', borderRadius: 20 }}>
            <p style={{ margin: '0 0 12px', color: '#E8A838', fontSize: 12, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
              MEA Recipes
            </p>
            <h1 style={{ margin: '0 0 12px', fontFamily: 'Georgia, serif', fontSize: 40, fontWeight: 400 }}>
              The kitchen needs a reset
            </h1>
            <p style={{ margin: '0 0 24px', color: '#A89880', fontSize: 14, lineHeight: 1.6 }}>
              The app hit an unexpected error. Your saved data is unchanged, and you can safely try again.
            </p>
            <button
              type="button"
              onClick={reset}
              style={{ border: 0, borderRadius: 12, padding: '11px 20px', background: '#E8A838', color: '#0F0D0A', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
            >
              Reload MEA Recipes
            </button>
          </section>
        </main>
      </body>
    </html>
  )
}
