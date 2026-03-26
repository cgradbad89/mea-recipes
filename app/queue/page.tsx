'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/AuthContext'
import { getQueue, deleteFromQueue, updateQueueItem, buildRecipeContent, QueuedRecipe } from '@/lib/queue'
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

export default function QueuePage() {
  const { user } = useAuth()
  const [items, setItems] = useState<QueuedRecipe[]>([])
  const [loading, setLoading] = useState(true)

  const loadQueue = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const q = await getQueue(user.uid)
    setItems(q)
    setLoading(false)
  }, [user])

  useEffect(() => { loadQueue() }, [loadQueue])

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
