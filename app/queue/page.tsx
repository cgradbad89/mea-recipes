'use client'

import Link from 'next/link'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/lib/AuthContext'
import { getQueue, deleteFromQueue, addToQueue, QueuedRecipe } from '@/lib/queue'
import { Loader2, ChefHat, Plus } from 'lucide-react'
import { QueueCard } from '@/components/QueueCard'
import LoadingErrorRetry from '@/components/LoadingErrorRetry'
import { createBookmarklet, receiveBookmarkletCapture, bookmarkletIngestRequest, type BookmarkletCaptureV1 } from '@/lib/bookmarklet'

function BookmarkletCopy() {
  const [copied, setCopied] = useState(false)
  const code = createBookmarklet()
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div className="space-y-2">
      <div className="bg-ink/60 rounded-xl p-3 overflow-x-auto">
        <code className="text-amber/80 text-xs font-mono whitespace-nowrap">
          {code.substring(0, 80)}...
        </code>
      </div>
      <button
        onClick={copy}
        className="btn-primary flex items-center gap-2 text-xs w-full sm:w-auto justify-center"
      >
        {copied ? '✓ Copied!' : 'Copy bookmarklet code'}
      </button>
    </div>
  )
}

export default function QueuePage() {
  const { user } = useAuth()
  const [items, setItems] = useState<QueuedRecipe[]>([])
  const [loading, setLoading] = useState(true)
  const [queueError, setQueueError] = useState('')
  const [bmIngesting, setBmIngesting] = useState(false)
  const [bmError, setBmError] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [capture, setCapture] = useState<BookmarkletCaptureV1 | null>(null)
  const launch = useRef<{ nonce: string; error: string } | null>(null)
  const ingestedNonce = useRef('')

  const loadQueue = useCallback(async () => {
    if (!user) { setLoading(false); return }
    setLoading(true)
    setQueueError('')
    try {
      const q = await getQueue(user.uid)
      setItems(q)
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : 'Failed to load your queue')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { loadQueue() }, [loadQueue])

  // Capture reception must mount even while Firebase auth is still loading.
  useEffect(() => {
    if (!launch.current) {
      const params = new URLSearchParams(window.location.search)
      if (!params.has('capture') && !params.has('ingest')) return
      launch.current = {
        nonce: params.get('nonce') || '',
        error: params.has('ingest')
          ? 'This bookmarklet is outdated. Copy the current code below and launch it again.'
          : params.get('capture') !== '1' || !/^[a-f0-9]{32}$/.test(params.get('nonce') || '')
            ? 'Invalid bookmarklet capture session.'
            : params.has('captureError') ? 'Bookmarklet capture timed out. Launch it again from the recipe page.' : '',
      }
      window.history.replaceState({}, '', '/queue')
    }
    const session = launch.current
    if (session.error) { setBmError(session.error); return }
    setBmIngesting(true)
    setBmError('')
    let active = true
    const receiver = receiveBookmarkletCapture(window, session.nonce)
    void receiver.promise.then(value => { if (active) setCapture(value) }).catch(error => {
      if (active) { setBmError(error.message); setBmIngesting(false) }
    })
    return () => { active = false; receiver.cancel() }
  }, [])

  useEffect(() => {
    if (!user || !capture || ingestedNonce.current === capture.nonce) return
    ingestedNonce.current = capture.nonce
    let active = true
    const controller = new AbortController()
    const ingest = async () => {
      try {
        const token = await user.getIdToken()
        if (!active) return
        const response = await fetch('/api/ai-ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify(bookmarkletIngestRequest(capture)),
          signal: controller.signal,
        })
        const data = await response.json()
        if (!active) return
        if (!response.ok || data.error) throw new Error(data.error || 'Recipe parsing failed')
        await addToQueue(user.uid, {
          title: data.title || 'Untitled Recipe',
          cuisine: data.cuisine || '',
          category: data.category || '',
          imageURL: data.imageURL || '',
          description: data.description || '',
          servings: data.servings || '',
          prepTime: data.prepTime || '',
          cookTime: data.cookTime || '',
          ...(data.sourceNutrition ? { sourceNutrition: data.sourceNutrition } : {}),
          ingredients: data.ingredients || [],
          instructions: data.instructions || [],
          sourceURL: capture.sourceURL,
        })
        if (active) await loadQueue()
      } catch (error) {
        if (active) setBmError(error instanceof Error ? error.message : 'Couldn’t import this recipe')
      } finally {
        if (active) setBmIngesting(false)
      }
    }
    void ingest()
    return () => { active = false; controller.abort() }
  }, [user, capture, loadQueue])

  const handleDiscard = async (id: string) => {
    if (!user) return
    setActionError('')
    try {
      await deleteFromQueue(user.uid, id)
      setItems(prev => prev.filter(i => i.id !== id))
      setToast('Removed from queue')
      setTimeout(() => setToast(null), 2000)
    } catch {
      setActionError('Couldn’t remove that recipe from the queue — try again.')
    }
  }

  const handlePublish = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id))
    setToast('Published to your recipes!')
    setTimeout(() => setToast(null), 2000)
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-6">
        <ChefHat size={48} className="text-faint" />
        <p className="font-display text-3xl text-faint font-light">Sign in to view your queue</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-surface border border-amber/30 text-amber text-sm font-body px-4 py-2 rounded-xl shadow-lg animate-fade-in">
          {toast}
        </div>
      )}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-display text-5xl text-cream font-light tracking-tight mb-1">Recipe Queue</h1>
          <p className="text-faint text-sm font-body">Review AI-parsed recipes before adding to your collection</p>
        </div>
      </div>

      {actionError && (
        <p role="alert" className="mb-6 rounded-xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-red-400 text-sm font-body">
          {actionError}
        </p>
      )}

      {bmIngesting && (
        <div className="flex items-center gap-3 mb-6 p-4 bg-amber/5 border border-amber/20 rounded-2xl">
          <Loader2 size={16} className="animate-spin text-amber" />
          <p className="text-amber text-sm font-body">Parsing recipe from bookmarklet...</p>
        </div>
      )}
      {bmError && (
        <p role="alert" className="mb-6 rounded-xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-red-400 text-sm font-body">
          Couldn’t import the bookmarklet recipe. {bmError}
        </p>
      )}

      {/* Bookmarklet setup */}
      <div id="bookmarklet" className="mb-8 bg-surface border border-border rounded-2xl p-5">
        <h2 className="font-display text-xl text-cream font-light mb-1">Browser Bookmarklet</h2>
        <p className="text-faint text-xs font-body mb-4">
          Save recipes from any site — including NYT Cooking and other paywalled sites you&apos;re already logged into.
        </p>
        <div className="bg-card rounded-xl p-4 mb-4">
          <p className="text-cream text-sm font-body font-medium mb-2">Setup instructions:</p>
          <ol className="space-y-1.5 text-faint text-xs font-body">
            <li>1. Show your browser bookmarks bar (⌘+Shift+B on Mac)</li>
            <li>2. Right-click the bookmarks bar → &quot;Add page&quot; or &quot;Add bookmark&quot;</li>
            <li>3. Set the name to &quot;🍽️ Save to MEA&quot;</li>
            <li>4. Paste the code below as the URL/address</li>
            <li>5. On any recipe page, click it — recipe goes to your queue!</li>
          </ol>
        </div>
        <BookmarkletCopy />
      </div>

      <LoadingErrorRetry
        loading={loading}
        error={queueError}
        retry={() => { void loadQueue() }}
        errorPrefix="Couldn’t load your recipe queue."
      >
        {items.length === 0 ? (
          <div className="text-center py-24 border border-border rounded-2xl">
            <ChefHat size={40} className="text-faint mx-auto mb-4" />
            <p className="font-display text-2xl text-faint font-light mb-2">Queue is empty</p>
            <p className="text-faint text-sm font-body">Add a recipe from the URL bar or paste text using the + button</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            {items.map(item => (
              <QueueCard
                key={item.id}
                item={item}
                uid={user.uid}
                onPublish={handlePublish}
                onDiscard={handleDiscard}
              />
            ))}
          </div>
        )}
      </LoadingErrorRetry>
    </div>
  )
}
