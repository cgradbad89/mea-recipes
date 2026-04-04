'use client'

import Link from 'next/link'
import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/AuthContext'
import { getQueue, deleteFromQueue, updateQueueItem, buildRecipeContent, addToQueue, QueuedRecipe } from '@/lib/queue'
import { saveRecipe } from '@/lib/recipes'
import { slugify } from '@/lib/utils'
import {
  Loader2, Trash2, Check, ChefHat, ExternalLink,
  Edit3, X, Save, Plus
} from 'lucide-react'

const CATEGORIES = [
  'Chicken & Poultry', 'Vegetarian Mains', 'Salads & Bowls',
  'Pasta, Noodles & Rice', 'Soups, Stews & Chili',
  'Seafood', 'Beef & Pork', 'Breakfast, Snacks & Sides',
]

function QueueCard({
  item, uid, onPublish, onDiscard
}: {
  item: QueuedRecipe
  uid: string
  onPublish: (id: string) => void
  onDiscard: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(item.title)
  const [cuisine, setCuisine] = useState(item.cuisine)
  const [category, setCategory] = useState(item.category)
  const [ingredients, setIngredients] = useState((item.ingredients || []).join('\n'))
  const [instructions, setInstructions] = useState((item.instructions || []).join('\n\n'))
  const [imageURL, setImageURL] = useState(item.imageURL || '')
  const [publishing, setPublishing] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleSaveEdit = async () => {
    setSaving(true)
    await updateQueueItem(uid, item.id!, {
      title,
      cuisine,
      category,
      imageURL,
      ingredients: ingredients.split('\n').map(l => l.trim()).filter(Boolean),
      instructions: instructions.split('\n\n').map(l => l.trim()).filter(Boolean),
    })
    setSaving(false)
    setEditing(false)
  }

  const handlePublish = async () => {
    setPublishing(true)
    try {
      const updatedItem: QueuedRecipe = {
        ...item,
        title, cuisine, category, imageURL,
        ingredients: ingredients.split('\n').map(l => l.trim()).filter(Boolean),
        instructions: instructions.split('\n\n').map(l => l.trim()).filter(Boolean),
      }
      const content = buildRecipeContent(updatedItem)
      await saveRecipe({
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
      }, uid)
      await deleteFromQueue(uid, item.id!)
      onPublish(item.id!)
    } catch (err) {
      console.error('Publish error:', err)
      setPublishing(false)
    }
  }

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      {/* Image */}
      {imageURL && !editing && (
        <div className="aspect-video overflow-hidden bg-card">
          <img
            src={imageURL}
            alt={title}
            className="w-full h-full object-cover"
            onError={e => { (e.target as HTMLImageElement).parentElement!.style.display = 'none' }}
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
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
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
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="font-display text-2xl text-cream font-light leading-tight">{title}</h3>
              <button onClick={() => setEditing(true)} className="text-faint hover:text-cream transition-colors shrink-0">
                <Edit3 size={14} />
              </button>
            </div>
            <div className="flex gap-2 mb-3 flex-wrap">
              {cuisine && <span className="tag-amber capitalize">{cuisine}</span>}
              {category && <span className="tag">{category}</span>}
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
          <div className="flex gap-2 pt-2 border-t border-border">
            <button
              onClick={() => onDiscard(item.id!)}
              className="btn-ghost flex items-center gap-1.5 text-xs text-faint hover:text-red-400"
            >
              <Trash2 size={12} />Discard
            </button>
            <div className="flex-1" />
            <button
              onClick={handlePublish}
              disabled={publishing}
              className="btn-primary flex items-center gap-1.5 text-xs"
            >
              {publishing ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Publish to collection
            </button>
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
  const [bmIngesting, setBmIngesting] = useState(false)

  const loadQueue = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const q = await getQueue(user.uid)
    setItems(q)
    setLoading(false)
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
    const bmImage = params.get('img') || ''
    const bmPrep = params.get('prep') || ''
    const bmCook = params.get('cook') || ''
    user.getIdToken().then(token => {
      fetch('/api/ai-ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ url: ingestUrl, imageURL: bmImage, prepTime: bmPrep, cookTime: bmCook }),
      }).then(r => r.json()).then(async data => {
      if (data.error) { console.error('Ingest error:', data.error); return }
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
      loadQueue()
    }).catch(console.error).finally(() => setBmIngesting(false))
    })
  }, [user, loadQueue])

  const handleDiscard = async (id: string) => {
    if (!user) return
    await deleteFromQueue(user.uid, id)
    setItems(prev => prev.filter(i => i.id !== id))
  }

  const handlePublish = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id))
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
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-display text-5xl text-cream font-light tracking-tight mb-1">Recipe Queue</h1>
          <p className="text-faint text-sm font-body">Review AI-parsed recipes before adding to your collection</p>
        </div>
      </div>

      {bmIngesting && (
        <div className="flex items-center gap-3 mb-6 p-4 bg-amber/5 border border-amber/20 rounded-2xl">
          <Loader2 size={16} className="animate-spin text-amber" />
          <p className="text-amber text-sm font-body">Parsing recipe from bookmarklet...</p>
        </div>
      )}

      {/* Bookmarklet setup */}
      <div id="bookmarklet" className="mb-8 bg-surface border border-border rounded-2xl p-5">
        <h2 className="font-display text-xl text-cream font-light mb-1">Browser Bookmarklet</h2>
        <p className="text-faint text-xs font-body mb-4">
          Save recipes from any site — including NYT Cooking and other paywalled sites you're already logged into.
        </p>
        <div className="bg-card rounded-xl p-4 mb-4">
          <p className="text-cream text-sm font-body font-medium mb-2">Setup instructions:</p>
          <ol className="space-y-1.5 text-faint text-xs font-body">
            <li>1. Show your browser bookmarks bar (⌘+Shift+B on Mac)</li>
            <li>2. Right-click the bookmarks bar → "Add page" or "Add bookmark"</li>
            <li>3. Set the name to "🍽️ Save to MEA"</li>
            <li>4. Paste the code below as the URL/address</li>
            <li>5. On any recipe page, click it — recipe goes to your queue!</li>
          </ol>
        </div>
        <BookmarkletCopy />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="animate-spin text-amber" size={28} />
        </div>
      ) : items.length === 0 ? (
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
    </div>
  )
}
