'use client'

import { useState } from 'react'
import { X, Link2, FileText, Loader2, Check, Plus, Minus } from 'lucide-react'
import { addToQueue } from '@/lib/queue'
import { useAuth } from '@/lib/AuthContext'
import { useRouter } from 'next/navigation'

type Tab = 'url' | 'paste'
type Status = 'idle' | 'fetching' | 'preview' | 'done' | 'error'

interface AddRecipeModalProps {
  onClose: () => void
}

const CATEGORIES = [
  'Chicken & Poultry', 'Vegetarian Mains', 'Salads & Bowls',
  'Pasta, Noodles & Rice', 'Soups, Stews & Chili',
  'Seafood', 'Beef & Pork', 'Breakfast, Snacks & Sides',
]

export default function AddRecipeModal({ onClose }: AddRecipeModalProps) {
  const { user } = useAuth()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('url')
  const [url, setUrl] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Parsed fields
  const [title, setTitle] = useState('')
  const [cuisine, setCuisine] = useState('')
  const [category, setCategory] = useState('')
  const [imageURL, setImageURL] = useState('')
  const [description, setDescription] = useState('')
  const [servings, setServings] = useState('')
  const [prepTime, setPrepTime] = useState('')
  const [cookTime, setCookTime] = useState('')
  const [ingredients, setIngredients] = useState<string[]>([])
  const [instructions, setInstructions] = useState<string[]>([])

  const callAI = async (body: object) => {
    setStatus('fetching')
    setError('')
    try {
      const res = await fetch('/api/ai-ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to parse recipe')
      setTitle(data.title || '')
      setCuisine(data.cuisine || '')
      setCategory(data.category || CATEGORIES[0])
      setImageURL(data.imageURL || '')
      setDescription(data.description || '')
      setServings(data.servings || '')
      setPrepTime(data.prepTime || '')
      setCookTime(data.cookTime || '')
      setIngredients(data.ingredients || [])
      setInstructions(data.instructions || [])
      setStatus('preview')
    } catch (e: any) {
      setError(e.message || 'Could not parse recipe')
      setStatus('error')
    }
  }

  const handleFetchURL = () => {
    if (!url.trim()) return
    callAI({ url: url.trim() })
  }

  const handlePasteSubmit = () => {
    if (!pasteText.trim()) return
    callAI({ text: pasteText.trim() })
  }

  const handleSaveToQueue = async () => {
    if (!user) { setError('Sign in to save recipes'); return }
    if (!title.trim()) { setError('Title is required'); return }
    setSaving(true)
    try {
      await addToQueue(user.uid, {
        title: title.trim(),
        cuisine: cuisine.toLowerCase(),
        category,
        imageURL,
        description,
        servings,
        prepTime,
        cookTime,
        ingredients,
        instructions,
        sourceURL: url || '',
      })
      setStatus('done')
      setTimeout(() => {
        onClose()
        router.push('/queue')
      }, 1200)
    } catch (e: any) {
      setError(e.message || 'Failed to save')
      setStatus('error')
    } finally {
      setSaving(false)
    }
  }

  const updateIngredient = (i: number, val: string) => {
    setIngredients(prev => prev.map((ing, idx) => idx === i ? val : ing))
  }

  const updateInstruction = (i: number, val: string) => {
    setInstructions(prev => prev.map((ins, idx) => idx === i ? val : ins))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4 bg-ink/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-surface z-10">
          <h2 className="font-display text-2xl text-cream font-light">Add Recipe</h2>
          <button onClick={onClose} className="text-faint hover:text-cream transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-5">
          {status === 'done' ? (
            <div className="flex flex-col items-center py-10 gap-3">
              <div className="w-14 h-14 rounded-full bg-amber/10 flex items-center justify-center">
                <Check size={28} className="text-amber" />
              </div>
              <p className="font-display text-2xl text-cream">Added to queue!</p>
              <p className="text-faint text-sm font-body">Redirecting to review...</p>
            </div>

          ) : status === 'preview' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-faint text-xs font-body uppercase tracking-widest">Review & Edit</p>
                <button onClick={() => setStatus('idle')} className="text-faint text-xs font-body hover:text-cream flex items-center gap-1">
                  <X size={11} /> Start over
                </button>
              </div>

              {/* Title */}
              <div>
                <label className="text-faint text-xs font-body uppercase tracking-widest mb-1.5 block">Title *</label>
                <input value={title} onChange={e => setTitle(e.target.value)} className="input-field" />
              </div>

              {/* Cuisine + Category */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-faint text-xs font-body uppercase tracking-widest mb-1.5 block">Cuisine</label>
                  <input value={cuisine} onChange={e => setCuisine(e.target.value)} className="input-field" placeholder="e.g. italian" />
                </div>
                <div>
                  <label className="text-faint text-xs font-body uppercase tracking-widest mb-1.5 block">Category</label>
                  <select value={category} onChange={e => setCategory(e.target.value)} className="input-field">
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              {/* Meta */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-faint text-xs font-body uppercase tracking-widest mb-1.5 block">Prep time</label>
                  <input value={prepTime} onChange={e => setPrepTime(e.target.value)} className="input-field" placeholder="15 min" />
                </div>
                <div>
                  <label className="text-faint text-xs font-body uppercase tracking-widest mb-1.5 block">Cook time</label>
                  <input value={cookTime} onChange={e => setCookTime(e.target.value)} className="input-field" placeholder="30 min" />
                </div>
                <div>
                  <label className="text-faint text-xs font-body uppercase tracking-widest mb-1.5 block">Servings</label>
                  <input value={servings} onChange={e => setServings(e.target.value)} className="input-field" placeholder="4" />
                </div>
              </div>

              {/* Image URL */}
              <div>
                <label className="text-faint text-xs font-body uppercase tracking-widest mb-1.5 block">Image URL</label>
                <input value={imageURL} onChange={e => setImageURL(e.target.value)} className="input-field" />
              </div>
              {imageURL && (
                <img src={imageURL} alt="" className="w-full aspect-video object-cover rounded-xl"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
              )}

              {/* Ingredients */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-faint text-xs font-body uppercase tracking-widest">Ingredients ({ingredients.length})</label>
                  <button onClick={() => setIngredients(prev => [...prev, ''])} className="text-faint hover:text-amber text-xs flex items-center gap-1">
                    <Plus size={11} /> Add
                  </button>
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {ingredients.map((ing, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        value={ing}
                        onChange={e => updateIngredient(i, e.target.value)}
                        className="input-field text-xs flex-1"
                        placeholder={`Ingredient ${i + 1}`}
                      />
                      <button onClick={() => setIngredients(prev => prev.filter((_, idx) => idx !== i))}
                        className="text-faint hover:text-red-400 transition-colors">
                        <Minus size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Instructions */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-faint text-xs font-body uppercase tracking-widest">Instructions ({instructions.length} steps)</label>
                  <button onClick={() => setInstructions(prev => [...prev, ''])} className="text-faint hover:text-amber text-xs flex items-center gap-1">
                    <Plus size={11} /> Add
                  </button>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {instructions.map((step, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="text-amber/40 font-display text-sm w-5 shrink-0 mt-2">{i + 1}</span>
                      <textarea
                        value={step}
                        onChange={e => updateInstruction(i, e.target.value)}
                        className="input-field text-xs flex-1 resize-none"
                        rows={2}
                        placeholder={`Step ${i + 1}`}
                      />
                      <button onClick={() => setInstructions(prev => prev.filter((_, idx) => idx !== i))}
                        className="text-faint hover:text-red-400 transition-colors mt-2">
                        <Minus size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {error && <p className="text-red-400 text-sm font-body">{error}</p>}

              <div className="flex gap-3 pt-2">
                <button onClick={onClose} className="btn-ghost">Cancel</button>
                <button
                  onClick={handleSaveToQueue}
                  disabled={saving}
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Add to review queue
                </button>
              </div>
            </div>

          ) : (
            <>
              {/* Tab toggle */}
              <div className="flex gap-1 p-1 bg-card rounded-xl mb-5">
                {(['url', 'paste'] as Tab[]).map(t => (
                  <button
                    key={t}
                    onClick={() => { setTab(t); setStatus('idle'); setError('') }}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-body font-medium transition-all ${
                      tab === t ? 'bg-surface text-cream border border-border' : 'text-faint hover:text-muted'
                    }`}
                  >
                    {t === 'url' ? <><Link2 size={14} /> URL</> : <><FileText size={14} /> Paste Text</>}
                  </button>
                ))}
              </div>

              {tab === 'url' ? (
                <div className="space-y-4">
                  <input
                    type="url"
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleFetchURL()}
                    placeholder="https://www.seriouseats.com/recipes/..."
                    className="input-field"
                    autoFocus
                  />
                  <p className="text-faint text-xs font-body leading-relaxed">
                    Works with most recipe sites. For NYT Cooking and other paywalled sites, use the{' '}
                    <a href="/queue#bookmarklet" className="text-amber hover:underline">bookmarklet</a>.
                  </p>
                  {error && <p className="text-red-400 text-sm font-body">{error}</p>}
                  <button
                    onClick={handleFetchURL}
                    disabled={status === 'fetching' || !url.trim()}
                    className="btn-primary w-full flex items-center justify-center gap-2"
                  >
                    {status === 'fetching' ? <Loader2 size={14} className="animate-spin" /> : null}
                    {status === 'fetching' ? 'Parsing with AI...' : 'Fetch & Parse Recipe'}
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <textarea
                    value={pasteText}
                    onChange={e => setPasteText(e.target.value)}
                    placeholder="Paste recipe text here — ingredients, instructions, anything. AI will structure it."
                    rows={9}
                    className="input-field resize-none"
                    autoFocus
                  />
                  {error && <p className="text-red-400 text-sm font-body">{error}</p>}
                  <button
                    onClick={handlePasteSubmit}
                    disabled={status === 'fetching' || !pasteText.trim()}
                    className="btn-primary w-full flex items-center justify-center gap-2"
                  >
                    {status === 'fetching' ? <Loader2 size={14} className="animate-spin" /> : null}
                    {status === 'fetching' ? 'Parsing with AI...' : 'Parse with AI'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
