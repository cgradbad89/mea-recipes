'use client'

import Link from 'next/link'
import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/AuthContext'
import { getQueue, deleteFromQueue, updateQueueItem, buildRecipeContent, addToQueue, QueuedRecipe } from '@/lib/queue'
import { saveRecipe, computeAndStoreNutrition, prepareCookingStepIngredientMap, triggerCookingModeMappingGeneration } from '@/lib/recipes'
import { slugify } from '@/lib/utils'
import {
  Loader2, Trash2, Check, ChefHat, ExternalLink,
  Edit3, X, Save, Plus
} from 'lucide-react'
import RecipeImage from '@/components/RecipeImage'
import LoadingErrorRetry from '@/components/LoadingErrorRetry'
import { RECIPE_CATEGORIES, isRecipeCategory } from '@/lib/recipeCategories'

export function QueueCard({
  item, uid, onPublish, onDiscard
}: {
  item: QueuedRecipe
  uid: string
  onPublish: (id: string) => void
  onDiscard: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [title, setTitle] = useState(item.title)
  const [cuisine, setCuisine] = useState(item.cuisine)
  const [category, setCategory] = useState(item.category)
  const [ingredients, setIngredients] = useState((item.ingredients || []).join('\n'))
  const [instructions, setInstructions] = useState((item.instructions || []).join('\n\n'))
  const [imageURL, setImageURL] = useState(item.imageURL || '')
  // null = idle, 'saving' = writing recipe doc, 'nutrition' = computing nutrition
  const [publishStage, setPublishStage] = useState<null | 'saving' | 'nutrition'>(null)
  const publishing = publishStage !== null
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [publishError, setPublishError] = useState('')
  const { user } = useAuth()

  const handleSaveEdit = async () => {
    setSaving(true)
    setEditError('')
    try {
      await updateQueueItem(uid, item.id!, {
        title,
        cuisine,
        category,
        imageURL,
        ingredients: ingredients.split('\n').map(l => l.trim()).filter(Boolean),
        instructions: instructions.split('\n\n').map(l => l.trim()).filter(Boolean),
      })
      setEditing(false)
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Couldn’t save your changes. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handlePublish = async () => {
    setPublishError('')
    if (!isRecipeCategory(category)) {
      setPublishError('Choose a canonical category before publishing this recipe.')
      return
    }
    if (!user) {
      setPublishError('Sign in again before publishing this recipe.')
      return
    }
    setPublishStage('saving')
    try {
      const updatedItem: QueuedRecipe = {
        ...item,
        title, cuisine, category, imageURL,
        ingredients: ingredients.split('\n').map(l => l.trim()).filter(Boolean),
        instructions: instructions.split('\n\n').map(l => l.trim()).filter(Boolean),
      }
      const content = buildRecipeContent(updatedItem)
      const token = await user.getIdToken()
      const cookingStepIngredientMap = await prepareCookingStepIngredientMap(content, token)
      const recipeId = await saveRecipe({
        recipeID: slugify(title),
        title: title.trim(),
        content,
        category,
        cuisine: cuisine.toLowerCase(),
        imageURL,
        sourceURL: item.sourceURL || '',
        sourceFile: slugify(title) + '.json',
        labels: 'Recipes',
        hasImage: imageURL ? 'true' : 'false',
        created: new Date().toString(),
        modified: new Date().toString(),
        cookingStepIngredientMap,
      }, uid)
      // Auto-nutrition + Cooking Mode mapping generation: both run concurrently
      // as independent, timeout-guarded, never-throwing post-save enrichments —
      // neither blocks publishing, and neither's failure affects the other
      // (Implementation 6, Phase 6/7). computeAndStoreNutrition and
      // triggerCookingModeMappingGeneration each flag/log their own failure
      // instead of throwing, so this Promise.allSettled never rejects.
      setPublishStage('nutrition')
      await Promise.allSettled([
        computeAndStoreNutrition(recipeId, token),
        triggerCookingModeMappingGeneration(recipeId, token),
      ])
      await deleteFromQueue(uid, item.id!)
      onPublish(item.id!)
    } catch (err) {
      console.error('Publish error:', err)
      setPublishError(err instanceof Error ? `Couldn’t publish this recipe: ${err.message}` : 'Couldn’t publish this recipe — try again.')
      setPublishStage(null)
    }
  }

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      {/* Image */}
      {imageURL && !editing && (
        <div className="aspect-video overflow-hidden bg-card">
          <RecipeImage
            src={imageURL}
            alt={title}
            category={category}
            className="w-full h-full"
            emojiClassName="text-5xl"
          />
        </div>
      )}

      <div className="p-5">
        {editing ? (
          <div className="space-y-3">
            <div>
              <label className="text-faint text-xs font-body uppercase tracking-widest mb-1 block">Title</label>
              <input value={title} onChange={e => setTitle(e.target.value)} className="input-field" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-faint text-xs font-body uppercase tracking-widest mb-1 block">Cuisine</label>
                <input value={cuisine} onChange={e => setCuisine(e.target.value)} className="input-field" />
              </div>
              <div>
                <label className="text-faint text-xs font-body uppercase tracking-widest mb-1 block">Category</label>
                <select value={category} onChange={e => setCategory(e.target.value)} className="input-field">
                  <option value="" disabled>Select category</option>
                  {category && !isRecipeCategory(category) && (
                    <option value={category}>Legacy / unresolved: {category}</option>
                  )}
                  {RECIPE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                {!isRecipeCategory(category) && (
                  <p className="text-amber/80 text-[11px] font-body mt-1">
                    Select a canonical category before publishing.
                  </p>
                )}
              </div>
            </div>
            <div>
              <label className="text-faint text-xs font-body uppercase tracking-widest mb-1 block">Image URL</label>
              <input value={imageURL} onChange={e => setImageURL(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="text-faint text-xs font-body uppercase tracking-widest mb-1 block">Ingredients (one per line)</label>
              <textarea value={ingredients} onChange={e => setIngredients(e.target.value)} rows={6} className="input-field resize-none text-xs" />
            </div>
            <div>
              <label className="text-faint text-xs font-body uppercase tracking-widest mb-1 block">Instructions (one step per paragraph)</label>
              <textarea value={instructions} onChange={e => setInstructions(e.target.value)} rows={6} className="input-field resize-none text-xs" />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setEditing(false)} className="btn-ghost flex items-center gap-1.5 text-xs"><X size={12} />Cancel</button>
              <button onClick={handleSaveEdit} disabled={saving} className="btn-primary flex items-center gap-1.5 text-xs">
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}Save
              </button>
            </div>
            {editError && <p role="alert" className="text-red-400 text-xs font-body">{editError}</p>}
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="font-display text-2xl text-cream font-light leading-tight">{title}</h3>
              <button aria-label="Edit queued recipe" onClick={() => { setEditError(''); setEditing(true) }} className="text-faint hover:text-cream transition-colors shrink-0">
                <Edit3 size={14} />
              </button>
            </div>
            <div className="flex gap-2 mb-3 flex-wrap">
              {cuisine && <span className="tag-amber capitalize">{cuisine}</span>}
              {category && (
                <span className="tag">
                  {isRecipeCategory(category) ? category : `Unresolved: ${category}`}
                </span>
              )}
              {item.prepTime && <span className="tag">Prep {item.prepTime}</span>}
              {item.cookTime && <span className="tag">Cook {item.cookTime}</span>}
            </div>
            {item.description && (
              <p className="text-muted text-sm font-body leading-relaxed mb-3 italic">{item.description}</p>
            )}
            {/* Ingredient preview */}
            {item.ingredients?.length > 0 && (
              <div className="mb-3">
                <p className="text-faint text-xs font-body uppercase tracking-widest mb-1.5">Ingredients ({item.ingredients.length})</p>
                <ul className="space-y-1">
                  {item.ingredients.slice(0, 5).map((ing, i) => (
                    <li key={i} className="text-muted text-xs font-body flex items-start gap-2">
                      <span className="w-1 h-1 rounded-full bg-amber mt-1.5 shrink-0" />
                      {ing}
                    </li>
                  ))}
                  {item.ingredients.length > 5 && (
                    <li className="text-faint text-xs font-body">+{item.ingredients.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}
            {item.sourceURL && (
              <a href={item.sourceURL} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-faint text-xs font-body hover:text-amber transition-colors mb-4">
                <ExternalLink size={11} />
                <span className="truncate">{item.sourceURL}</span>
              </a>
            )}
          </>
        )}

        {/* Actions */}
        {!editing && (
          <div className="pt-2 border-t border-border space-y-2">
            {confirmDiscard && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 animate-fade-in">
                <span className="text-red-400 text-xs font-body">Discard this recipe?</span>
                <button onClick={() => onDiscard(item.id!)} className="text-red-400 text-xs font-body font-semibold hover:text-red-300">Yes</button>
                <button onClick={() => setConfirmDiscard(false)} className="text-faint text-xs font-body hover:text-cream">Cancel</button>
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDiscard(true)}
                className="btn-ghost flex items-center gap-1.5 text-xs text-faint hover:text-red-400"
              >
                <Trash2 size={12} />Discard
              </button>
              <div className="flex-1" />
              <button
                onClick={handlePublish}
                disabled={publishing}
                className={`flex items-center gap-1.5 text-xs font-body font-semibold px-5 py-2.5 rounded-xl transition-all duration-200 ${
                  publishing
                    ? 'bg-green-600 text-white'
                    : 'bg-amber text-ink hover:bg-amber-glow active:scale-95'
                }`}
              >
                {publishing ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                {publishStage === 'nutrition' ? 'Calculating nutrition…'
                  : publishStage === 'saving' ? 'Adding…'
                  : 'Publish to collection'}
              </button>
            </div>
            {publishError && <p role="alert" className="text-red-400 text-xs font-body">{publishError}</p>}
          </div>
        )}
      </div>
    </div>
  )
}


function BookmarkletCopy() {
  const [copied, setCopied] = useState(false)
  const code = 'javascript:(function(){var u=window.location.href,img=\'\',prep=\'\',cook=\'\';var sc=document.querySelectorAll(\'script[type="application/ld+json"]\');for(var i=0;i<sc.length;i++){try{var d=JSON.parse(sc[i].textContent);if(d[\'@graph\'])d=d[\'@graph\'].find(function(x){return x[\'@type\']===\'Recipe\'})||d[\'@graph\'][0];if(d[\'@type\']===\'Recipe\'){img=typeof d.image===\'string\'?d.image:d.image&&d.image.url||\'\';prep=d.prepTime||\'\';cook=d.cookTime||\'\';break;}}catch(e){}}if(!img){var imgs=Array.from(document.images).filter(function(el){return el.naturalWidth>400&&el.naturalHeight>300});if(imgs.length)img=imgs[0].src;}function dur(s){if(!s)return\'\';var m=s.match(/PT(?:(\\d+)H)?(?:(\\d+)M)?/);if(!m)return s;return((m[1]?m[1]+\'h \':\'\')+( m[2]?m[2]+\' min\':\'\')).trim();}var p=new URLSearchParams({ingest:u,img:img,prep:dur(prep),cook:dur(cook)});window.open(\'https://mea-recipes.vercel.app/queue?\'+p.toString(),\'_blank\',\'width=520,height=750\');})();'
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

  // Auto-ingest from bookmarklet — reads ?ingest=URL param
  useEffect(() => {
    if (!user || typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const ingestUrl = params.get('ingest')
    if (!ingestUrl) return
    // Clear the param from URL without reload
    window.history.replaceState({}, '', '/queue')
    setBmIngesting(true)
    setBmError('')
    const bmImage = params.get('img') || ''
    const bmPrep = params.get('prep') || ''
    const bmCook = params.get('cook') || ''
    let active = true
    const ingest = async () => {
      try {
        const token = await user.getIdToken()
        const response = await fetch('/api/ai-ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ url: ingestUrl, imageURL: bmImage, prepTime: bmPrep, cookTime: bmCook }),
        })
        const data = await response.json()
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
          ingredients: data.ingredients || [],
          instructions: data.instructions || [],
          sourceURL: ingestUrl,
        })
        await loadQueue()
      } catch (error) {
        if (active) setBmError(error instanceof Error ? error.message : 'Couldn’t import this recipe')
      } finally {
        if (active) setBmIngesting(false)
      }
    }
    void ingest()
    return () => { active = false }
  }, [user, loadQueue])

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
