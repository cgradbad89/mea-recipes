'use client'

import { useCallback, useEffect, useState } from 'react'
import { ClipboardCheck } from 'lucide-react'
import { useAuth } from '@/lib/AuthContext'
import { useAdminAccess } from '@/hooks/useAdminAccess'
import { fetchMappingReviewQueue } from '@/lib/mappingReviewClient'
import LoadingErrorRetry from '@/components/LoadingErrorRetry'
import MappingReviewQueueCard from '@/components/mapping-review/MappingReviewQueueCard'
import type { MappingReviewQueueEntry } from '@/lib/cookingModeMappingReviewQueue'

export default function MappingReviewQueuePage() {
  const { user, loading: authLoading } = useAuth()
  const { isAdmin, checked } = useAdminAccess()
  const [entries, setEntries] = useState<MappingReviewQueueEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const token = await user.getIdToken()
      setEntries(await fetchMappingReviewQueue(token))
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (checked && isAdmin) void load()
  }, [checked, isAdmin, load])

  if (authLoading || !checked) {
    return (
      <div role="status" className="flex items-center justify-center min-h-[60vh] text-faint font-body text-sm">
        Loading…
      </div>
    )
  }

  if (!user || !isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-6 text-center">
        <ClipboardCheck size={48} className="text-faint" />
        <p className="font-display text-3xl text-faint font-light">Mapping review isn’t available</p>
        <p className="text-faint text-sm font-body max-w-sm">This admin-only workflow isn’t available for your account.</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="font-display text-5xl text-cream font-light tracking-tight mb-1">Mapping Review</h1>
        <p className="text-faint text-sm font-body">
          Review which ingredients appear on which steps in Cooking Mode before a recipe’s map is approved.
        </p>
      </div>

      <LoadingErrorRetry
        loading={loading}
        error={error}
        retry={() => { void load() }}
        errorPrefix="Couldn’t load the mapping review queue."
      >
        {entries.length === 0 ? (
          <div className="text-center py-24 border border-border rounded-2xl">
            <ClipboardCheck size={40} className="text-faint mx-auto mb-4" />
            <p className="font-display text-2xl text-faint font-light mb-2">Nothing to review</p>
            <p className="text-faint text-sm font-body">No recipes have a mapping proposal waiting for review right now.</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {entries.map(entry => (
              <MappingReviewQueueCard key={entry.recipeId} entry={entry} />
            ))}
          </div>
        )}
      </LoadingErrorRetry>
    </div>
  )
}
