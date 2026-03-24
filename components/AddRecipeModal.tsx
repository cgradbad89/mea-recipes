'use client'

import { useState } from 'react'
import { X, Link2, FileText, Loader2, Check } from 'lucide-react'
import { saveRecipe } from '@/lib/recipes'

type Tab = 'url' | 'paste'

interface AddRecipeModalProps {
  onClose: () => void
}

function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function extractFromStructuredData(html: string): Partial<{
  title: string; ingredients: string[]; instructions: string[]; imageURL: string; cuisine: string; category: string
}> {
  try {
    const jsonLdMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i)
    if (!jsonLdMatch) return {}
    let data = JSON.parse(jsonLdMatch[1])
    if (Array.isArray(data)) data = data.find(d => d['@type'] === 'Recipe') || data[0]
    if (data['@graph']) data = data['@graph'].find((d: any) => d['@type'] === 'Recipe') || data['@graph'][0]
    if (data['@type'] !== 'Recipe') return {}

    const ingredients = (data.recipeIngredient || []) as string[]
    const instructions = (data.recipeInstructions || []).map((s: any) =>
      typeof s === 'string' ? s : s.text || ''
    ).filter(Boolean) as string[]

    return {
      title: data.name || '',
      ingredients,
      instructions,
      imageURL: typeof data.image === 'string' ? data.image : data.image?.url || data.image?.[0] || '',
      cuisine: (data.recipeCuisine || '').toLowerCase(),
      category: data.recipeCategory || '',
    }
  } catch {
    return {}
  }
}

export default function AddRecipeModal({ onClose }: AddRecipeModalProps) {
  const [tab, setTab] = useState<Tab>('url')
  const [url, setUrl] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [status, setStatus] = useState<'idle' | 'fetching' | 'preview' | 'saving' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')

  // Parsed preview fields
  const [title, setTitle] = useState('')
  const [cuisine, setCuisine] = useState('')
  const [category, setCategory] = useState('')
  const [content, setContent] = useState('')
  const [imageURL, setImageURL] = useState('')
  const [sourceURL, setSourceURL] = useState('')

  const handleFetchURL = async () => {
    if (!url.trim()) return
    setStatus('fetching')
    setError('')
    try {
      const res = await fetch(`/api/fetch-recipe?url=${encodeURIComponent(url)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to fetch')

      const parsed = extractFromStructuredData(data.html || '')
      setTitle(parsed.title || data.title || '')
      setCuisine(parsed.cuisine || '')
      setCategory(parsed.category || '')
      setImageURL(parsed.imageURL || '')
      setSourceURL(url)

      const ingText = parsed.ingredients?.length
        ? `INGREDIENTS\n${parsed.ingredients.join('\n')}`
        : ''
      const instText = parsed.instructions?.length
        ? `\n\nINSTRUCTIONS\n${parsed.instructions.map((s, i) => `Step ${i + 1}\n${s}`).join('\n\n')}`
        : ''
      setContent(url + '\n\n' + ingText + instText || data.text || '')
      setStatus('preview')
    } catch (e: any) {
      setError(e.message || 'Could not fetch recipe')
      setStatus('error')
    }
  }

  const handlePastePreview = () => {
    if (!pasteText.trim()) return
    const lines = pasteText.split('\n').map(l => l.trim()).filter(Boolean)
    const urlLine = lines.find(l => l.startsWith('http'))
    setTitle(lines.find(l => l.length > 3 && !l.startsWith('http') && !l.match(/^(ingredient|instruction|step)/i)) || '')
    setSourceURL(urlLine || '')
    setContent(pasteText)
    setStatus('preview')
  }

  const handleSave = async () => {
    if (!title.trim()) { setError('Title is required'); return }
    setStatus('saving')
    try {
      await saveRecipe({
        recipeID: slugify(title),
        title: title.trim(),
        content,
        category,
        cuisine: cuisine.toLowerCase(),
        imageURL,
        sourceURL,
        sourceFile: slugify(title) + '.json',
        labels: 'Recipes',
        hasImage: imageURL ? 'true' : 'false',
        created: new Date().toString(),
        modified: new Date().toString(),
      })
      setStatus('done')
      setTimeout(onClose, 1500)
    } catch (e: any) {
      setError(e.message || 'Failed to save')
      setStatus('error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4 bg-ink/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-display text-2xl text-cream font-light">Add Recipe</h2>
          <button onClick={onClose} className="text-faint hover:text-cream transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-5">
          {status === 'done' ? (
            <div className="flex flex-col items-center py-8 gap-3">
              <div className="w-12 h-12 rounded-full bg-amber/10 flex items-center justify-center">
                <Check size={24} className="text-amber" />
              </div>
              <p className="font-display text-xl text-cream">Recipe saved!</p>
            </div>
          ) : status === 'preview' ? (
            <div className="space-y-4">
              <p className="text-faint text-xs font-body uppercase tracking-widest mb-4">Preview & Edit</p>

              <div>
                <label className="text-faint text-xs font-body mb-1.5 block">Title *</label>
                <input value={title} onChange={e => setTitle(e.target.value)} className="input-field" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-faint text-xs font-body mb-1.5 block">Cuisine</label>
                  <input value={cuisine} onChange={e => setCuisine(e.target.value)} className="input-field" placeholder="e.g. italian" />
                </div>
                <div>
                  <label className="text-faint text-xs font-body mb-1.5 block">Category</label>
                  <input value={category} onChange={e => setCategory(e.target.value)} className="input-field" placeholder="e.g. Pasta..." />
                </div>
              </div>
              <div>
                <label className="text-faint text-xs font-body mb-1.5 block">Image URL</label>
                <input value={imageURL} onChange={e => setImageURL(e.target.value)} className="input-field" />
              </div>
              {imageURL && (
                <img src={imageURL} alt="preview" className="w-full aspect-video object-cover rounded-xl"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
              )}

              {error && <p className="text-red-400 text-sm font-body">{error}</p>}

              <div className="flex gap-3 pt-2">
                <button onClick={() => setStatus('idle')} className="btn-ghost flex-1">Back</button>
                <button
                  onClick={handleSave}
                  disabled={status === 'saving'}
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                >
                  {status === 'saving' ? <Loader2 size={14} className="animate-spin" /> : null}
                  Save Recipe
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Tab toggle */}
              <div className="flex gap-1 p-1 bg-card rounded-xl mb-5">
                <button
                  onClick={() => setTab('url')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-body font-medium transition-all ${
                    tab === 'url' ? 'bg-surface text-cream border border-border' : 'text-faint hover:text-muted'
                  }`}
                >
                  <Link2 size={14} /> URL
                </button>
                <button
                  onClick={() => setTab('paste')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-body font-medium transition-all ${
                    tab === 'paste' ? 'bg-surface text-cream border border-border' : 'text-faint hover:text-muted'
                  }`}
                >
                  <FileText size={14} /> Paste Text
                </button>
              </div>

              {tab === 'url' ? (
                <div className="space-y-4">
                  <input
                    type="url"
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleFetchURL()}
                    placeholder="https://cooking.nytimes.com/recipes/..."
                    className="input-field"
                  />
                  <p className="text-faint text-xs font-body">
                    Works best with Serious Eats, Pinch of Yum, RecipeTin Eats, Feasting at Home, AllRecipes.
                    NYT Cooking requires a subscription and may not parse.
                  </p>
                  {error && <p className="text-red-400 text-sm font-body">{error}</p>}
                  <button
                    onClick={handleFetchURL}
                    disabled={status === 'fetching' || !url.trim()}
                    className="btn-primary w-full flex items-center justify-center gap-2"
                  >
                    {status === 'fetching' ? <Loader2 size={14} className="animate-spin" /> : null}
                    {status === 'fetching' ? 'Fetching...' : 'Fetch Recipe'}
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <textarea
                    value={pasteText}
                    onChange={e => setPasteText(e.target.value)}
                    placeholder="Paste recipe text here — include title, ingredients and instructions..."
                    rows={8}
                    className="input-field resize-none"
                  />
                  <button
                    onClick={handlePastePreview}
                    disabled={!pasteText.trim()}
                    className="btn-primary w-full"
                  >
                    Preview Recipe
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
