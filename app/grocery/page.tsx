'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  collection, onSnapshot, doc, updateDoc, deleteDoc, writeBatch, setDoc, serverTimestamp
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/lib/AuthContext'
import { categorizeIngredient, GROCERY_CATEGORIES, MANUAL_CATEGORIES, GroceryCategory } from '@/lib/groceryCategories'
import { ShoppingCart, Check, Trash2, Loader2, Sparkles, ChevronDown, ChevronUp, X, CheckCheck, Plus, Minus, RefreshCw, Tag, Pencil } from 'lucide-react'
import { weekIDFromDate, getWeekPlan, rebuildGroceryFromPlan, getSavedGroceryItems, upsertSavedGroceryItem, deleteSavedGroceryItem, type SavedGroceryItem } from '@/lib/userdata'
import { getRecipeById, parseRecipeContent } from '@/lib/recipes'

interface GroceryItem {
  id: string
  name: string
  quantity?: string
  unit?: string
  isChecked?: boolean
  manualSection?: GroceryCategory
  isManual?: boolean
  sourceRecipeIDs?: string[]
}

interface CleanupChange {
  originalIndex: number
  name: string
  quantity: string
  unit: string
  category: GroceryCategory
  action: 'keep' | 'merge' | 'normalize' | 'remove'
  mergedWith: number[]
}

const CATEGORY_EMOJI: Record<GroceryCategory, string> = {
  'Produce': '🥦',
  'Meat & Seafood': '🥩',
  'Dairy & Eggs': '🧀',
  'Bakery & Bread': '🍞',
  'Canned / Jarred / Sauces': '🥫',
  'Beverages': '🧃',
  'Staples': '🧂',
  'Other': '🛒',
}

function getCategory(item: GroceryItem): GroceryCategory {
  if (item.manualSection) return item.manualSection
  return categorizeIngredient(item.name)
}

const MEASUREMENT_WORDS = /^(cup|cups|tbsp|tsp|tablespoon|tablespoons|teaspoon|teaspoons|oz|ounce|ounces|lb|lbs|pound|pounds|g|gram|grams|kg|ml|liter|liters|can|cans|clove|cloves|bunch|package|packages|pkg|slice|slices|piece|pieces|head|heads|stalk|stalks)\b/i
const PREP_WORDS = /^(grated|chopped|minced|diced|sliced|crushed|peeled|halved|quartered|roughly|finely|thinly|coarsely|freshly|ground|dried|frozen|cooked|raw|whole|large|medium|small|extra)\b/i

function extractIngredientName(name: string): string {
  let s = name.trim()
  // Remove leading quantities and fractions: "1", "1/2", "1-2", unicode fractions
  s = s.replace(/^[\d\s.,/\-\u00BC-\u00BE\u2150-\u215E]+/, '')
  // Remove measurement words
  s = s.replace(MEASUREMENT_WORDS, '')
  // Remove prep words (may repeat)
  let prev = ''
  while (prev !== s) {
    prev = s
    s = s.trim().replace(PREP_WORDS, '')
  }
  return s.trim() || name.trim()
}

export default function GroceryPage() {
  const { user } = useAuth()
  const [items, setItems] = useState<GroceryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [categoryPickerFor, setCategoryPickerFor] = useState<string | null>(null)
  const [pickerFlipped, setPickerFlipped] = useState(false)
  const [cleanupLoading, setCleanupLoading] = useState(false)
  const [cleanupChanges, setCleanupChanges] = useState<CleanupChange[] | null>(null)
  const [applyingCleanup, setApplyingCleanup] = useState(false)
  const [showAddItem, setShowAddItem] = useState(false)
  const [newItemName, setNewItemName] = useState('')
  const [newItemQty, setNewItemQty] = useState('')
  const [newItemCategory, setNewItemCategory] = useState<GroceryCategory>('Other')
  const [addingItem, setAddingItem] = useState(false)
  const [showRebuildConfirm, setShowRebuildConfirm] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [rebuildDone, setRebuildDone] = useState(false)
  const [lastCleaned, setLastCleaned] = useState<Date | null>(null)
  const [savedItems, setSavedItems] = useState<SavedGroceryItem[]>([])
  const [showAutocomplete, setShowAutocomplete] = useState(false)
  const [confirmClearAll, setConfirmClearAll] = useState(false)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editingItemName, setEditingItemName] = useState('')
  const [editingItemQuantity, setEditingItemQuantity] = useState('')
  const [editingItemUnit, setEditingItemUnit] = useState('')

  const startEditItem = (item: GroceryItem) => {
    setEditingItemId(item.id)
    setEditingItemName(item.name)
    setEditingItemQuantity(item.quantity || '')
    setEditingItemUnit(item.unit || '')
  }

  const saveEditItem = async () => {
    if (!user || !editingItemId) return
    const newName = editingItemName.trim()
    if (!newName) { cancelEditItem(); return }
    try {
      const ref = doc(db, 'users', user.uid, 'pantry', 'root', 'groceryItems', editingItemId)
      await updateDoc(ref, {
        name: newName,
        quantity: editingItemQuantity.trim(),
        unit: editingItemUnit.trim(),
        updatedAt: serverTimestamp(),
      })
    } catch (e) {
      console.error('Failed to save item:', e)
    } finally {
      cancelEditItem()
    }
  }

  const cancelEditItem = () => {
    setEditingItemId(null)
    setEditingItemName('')
    setEditingItemQuantity('')
    setEditingItemUnit('')
  }

  useEffect(() => {
    if (!confirmClearAll) return
    const timer = setTimeout(() => setConfirmClearAll(false), 5000)
    return () => clearTimeout(timer)
  }, [confirmClearAll])

  useEffect(() => {
    if (!user) { setLoading(false); return }
    const ref = collection(db, 'users', user.uid, 'pantry', 'root', 'groceryItems')
    const unsub = onSnapshot(ref, snap => {
      const data = snap.docs.map(d => ({ ...d.data(), id: d.id } as GroceryItem))
      setItems(data)
      setLoading(false)
    })
    return unsub
  }, [user])

  useEffect(() => {
    const stored = localStorage.getItem('mea-grocery-last-cleaned')
    if (stored) setLastCleaned(new Date(parseInt(stored)))
  }, [])

  useEffect(() => {
    if (!user) return
    getSavedGroceryItems(user.uid).then(setSavedItems).catch(e => {
      console.error('Failed to load saved grocery items:', e)
    })
  }, [user])

  const grouped = useMemo(() => {
    const groups: Record<string, GroceryItem[]> = {}
    GROCERY_CATEGORIES.forEach(cat => { groups[cat] = [] })
    items.forEach(item => {
      const cat = getCategory(item)
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(item)
    })
    Object.keys(groups).forEach(cat => {
      groups[cat].sort((a, b) =>
        extractIngredientName(a.name).toLowerCase().localeCompare(extractIngredientName(b.name).toLowerCase())
      )
    })
    return groups
  }, [items])

  const uncheckedCount = items.filter(i => !i.isChecked).length
  const checkedCount = items.filter(i => i.isChecked).length

  const toggleItem = async (item: GroceryItem) => {
    if (!user) return
    const ref = doc(db, 'users', user.uid, 'pantry', 'root', 'groceryItems', item.id)
    await updateDoc(ref, { isChecked: !item.isChecked })
  }

  const deleteItem = async (item: GroceryItem) => {
    if (!user || item.id.includes('/')) return
    await deleteDoc(doc(db, 'users', user.uid, 'pantry', 'root', 'groceryItems', item.id))
  }

  const setManualCategory = async (itemId: string, category: GroceryCategory | null) => {
    if (!user) return
    const ref = doc(db, 'users', user.uid, 'pantry', 'root', 'groceryItems', itemId)
    await updateDoc(ref, { manualSection: category || null })
    setCategoryPickerFor(null)
  }

  const clearChecked = async () => {
    if (!user) return
    const batch = writeBatch(db)
    items.filter(i => i.isChecked).forEach(i => {
      batch.delete(doc(db, 'users', user.uid, 'pantry', 'root', 'groceryItems', i.id))
    })
    await batch.commit()
  }

  const clearAll = async () => {
    if (!user) return
    const batch = writeBatch(db)
    items.forEach(i => {
      batch.delete(doc(db, 'users', user.uid, 'pantry', 'root', 'groceryItems', i.id))
    })
    await batch.commit()
  }

  const handleAICleanup = async () => {
    if (!user || !items.length) return
    setCleanupLoading(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/grocery-cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ items: items.map((item, i) => ({ ...item, _index: i })) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCleanupChanges(Array.isArray(data) ? data : [])
    } catch (e: any) {
      console.error('Cleanup error:', e)
    } finally {
      setCleanupLoading(false)
    }
  }

  const applyCleanup = async () => {
    if (!user || !cleanupChanges) return
    setApplyingCleanup(true)
    try {
      const batch = writeBatch(db)
      const toDelete = new Set<number>()

      cleanupChanges.forEach(change => {
        if (change.action === 'remove') {
          toDelete.add(change.originalIndex)
          return
        }
        if (change.action === 'merge' && change.mergedWith?.length) {
          change.mergedWith.forEach(i => toDelete.add(i))
        }
        const item = items[change.originalIndex]
        if (!item || item.id.includes('/')) return
        const ref = doc(db, 'users', user.uid, 'pantry', 'root', 'groceryItems', item.id)
        batch.update(ref, {
          name: change.name,
          quantity: change.quantity || '',
          unit: change.unit || '',
          manualSection: change.category,
        })
      })

      // Delete removed/merged items
      toDelete.forEach(i => {
        const item = items[i]
        if (item && !item.id.includes('/')) {
          batch.delete(doc(db, 'users', user.uid, 'pantry', 'root', 'groceryItems', item.id))
        }
      })

      await batch.commit()
      localStorage.setItem('mea-grocery-last-cleaned', Date.now().toString())
      setLastCleaned(new Date())
      setCleanupChanges(null)
    } catch (e) {
      console.error('Apply cleanup error:', e)
    } finally {
      setApplyingCleanup(false)
    }
  }

  const handleAddItem = async () => {
    if (!user || !newItemName.trim()) return
    setAddingItem(true)
    const trimmedName = newItemName.trim()
    const category = newItemCategory
    try {
      const sanitizeId = (s: string) => s.replace(/[/\\]/g, '-').replace(/[^a-zA-Z0-9-_]/g, '-').substring(0, 80)
      const newId = sanitizeId(trimmedName.toLowerCase()) + '-' + Date.now()
      const ref = doc(db, 'users', user.uid, 'pantry', 'root', 'groceryItems', newId)
      await setDoc(ref, {
        id: newId,
        name: trimmedName,
        quantity: newItemQty.trim(),
        unit: '',
        isChecked: false,
        isManual: true,
        manualSection: category,
        sourceRecipeIDs: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      setNewItemName('')
      setNewItemQty('')
      setNewItemCategory('Other')
      setShowAddItem(false)
    } catch (e) {
      console.error('Add item error:', e)
    } finally {
      setAddingItem(false)
    }
    // Save to savedGroceryItems in the background — must not block form flow
    upsertSavedGroceryItem(user.uid, trimmedName, category)
      .then(() => getSavedGroceryItems(user.uid))
      .then(setSavedItems)
      .catch(e => console.error('Failed to save grocery item to saved list:', e))
  }

  const toggleCollapse = (cat: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(cat) ? next.delete(cat) : next.add(cat)
      return next
    })
  }

  const handleRebuildGrocery = async () => {
    if (!user) return
    setRebuilding(true)
    setShowRebuildConfirm(false)
    const currentWeekID = weekIDFromDate(new Date())
    const plan = await getWeekPlan(user.uid, currentWeekID)
    const recipeIDs = plan?.plannedRecipeIDs || []
    await rebuildGroceryFromPlan(user.uid, recipeIDs, getRecipeById, parseRecipeContent)
    setRebuilding(false)
    setRebuildDone(true)
    setTimeout(() => setRebuildDone(false), 2000)
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-6">
        <ShoppingCart size={48} className="text-faint" />
        <p className="font-display text-3xl text-faint font-light">Sign in to view your grocery list</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin text-amber" size={28} />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-display text-5xl text-cream font-light tracking-tight mb-1">Grocery</h1>
          <p className="text-faint text-sm font-body">
            {uncheckedCount} item{uncheckedCount !== 1 ? 's' : ''} remaining
            {checkedCount > 0 && ` · ${checkedCount} checked`}
          </p>
        </div>
        <div className="flex gap-2">
          {checkedCount > 0 && (
            <button onClick={clearChecked} className="btn-ghost flex items-center gap-1.5 text-xs">
              <CheckCheck size={13} />Clear checked
            </button>
          )}
          {items.length > 0 && !confirmClearAll && (
            <button onClick={() => setConfirmClearAll(true)} className="btn-ghost flex items-center gap-1.5 text-xs text-faint hover:text-red-400">
              <Trash2 size={13} />Clear all
            </button>
          )}
          {confirmClearAll && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
              <span className="text-red-400 text-xs font-body">Are you sure? This cannot be undone.</span>
              <button onClick={() => { clearAll(); setConfirmClearAll(false) }} className="text-red-400 text-xs font-body font-semibold hover:text-red-300">
                Yes, clear all
              </button>
              <button onClick={() => setConfirmClearAll(false)} className="text-faint text-xs font-body hover:text-cream">Cancel</button>
            </div>
          )}
        </div>
      </div>

      {/* Rebuild grocery from plan */}
      {showRebuildConfirm ? (
        <div className="bg-surface border border-amber/20 rounded-xl p-4 mb-6 animate-fade-in">
          <p className="text-cream text-sm font-body mb-3">
            This will remove recipe-sourced items and re-add fresh ingredients from this week&apos;s planned recipes. Your manually added items will be kept.
          </p>
          <div className="flex gap-2">
            <button onClick={handleRebuildGrocery} className="btn-primary text-xs px-3 py-1.5">Rebuild</button>
            <button onClick={() => setShowRebuildConfirm(false)} className="btn-ghost text-xs px-3 py-1.5">Cancel</button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => rebuildDone ? null : setShowRebuildConfirm(true)}
          disabled={rebuilding}
          className="flex items-center gap-2 text-sm font-body text-faint hover:text-amber transition-colors mb-6"
        >
          {rebuilding ? <Loader2 size={14} className="animate-spin" /> : rebuildDone ? <Check size={14} className="text-green-400" /> : <RefreshCw size={14} />}
          {rebuilding ? 'Rebuilding…' : rebuildDone ? 'Done!' : 'Rebuild grocery list'}
        </button>
      )}

      {/* AI Cleanup button */}
      {items.length > 0 && !cleanupChanges && (
        <div className="mb-6 space-y-1">
          <button
            onClick={handleAICleanup}
            disabled={cleanupLoading}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-amber/20 bg-amber/5 text-amber text-sm font-body hover:bg-amber/10 transition-colors"
          >
            {cleanupLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {cleanupLoading ? 'AI is reviewing your list...' : 'AI Clean Up List'}
          </button>
          {lastCleaned && (
            <p className="text-faint text-xs font-body">
              Last cleaned {lastCleaned.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at {lastCleaned.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>
      )}

      {/* Add Item button + form */}
      <div className="mb-4">
        {showAddItem ? (
          <div className="bg-surface border border-border rounded-2xl p-4 space-y-3">
            <p className="text-faint text-xs font-body uppercase tracking-widest">Add Item</p>
            <div className="flex gap-2">
              <input
                value={newItemQty}
                onChange={e => setNewItemQty(e.target.value)}
                placeholder="Qty"
                className="input-field w-20 shrink-0"
              />
              <div className="relative flex-1">
                <input
                  value={newItemName}
                  onChange={e => {
                    setNewItemName(e.target.value)
                    setShowAutocomplete(e.target.value.length > 0)
                  }}
                  onKeyDown={e => e.key === 'Enter' && handleAddItem()}
                  onBlur={() => setTimeout(() => setShowAutocomplete(false), 150)}
                  onFocus={() => newItemName.length > 0 && setShowAutocomplete(true)}
                  placeholder="Item name"
                  className="input-field w-full"
                  autoFocus
                />
                {showAutocomplete && newItemName.length > 0 && (() => {
                  const matches = savedItems
                    .filter(s => s.name.toLowerCase().includes(newItemName.toLowerCase()))
                    .slice(0, 5)
                  if (!matches.length) return null
                  return (
                    <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-surface border border-border rounded-xl shadow-lg overflow-hidden">
                      {matches.map(s => (
                        <button
                          key={s.id}
                          onMouseDown={e => {
                            e.preventDefault()
                            setNewItemName(s.name)
                            setNewItemCategory(s.defaultCategory)
                            setShowAutocomplete(false)
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm font-body text-cream hover:bg-card transition-colors"
                        >
                          <span>{CATEGORY_EMOJI[s.defaultCategory]}</span>
                          <span className="truncate">{s.name}</span>
                        </button>
                      ))}
                    </div>
                  )
                })()}
              </div>
            </div>
            <select
              value={newItemCategory}
              onChange={e => setNewItemCategory(e.target.value as GroceryCategory)}
              className="input-field w-full"
            >
              {MANUAL_CATEGORIES.map(c => (
                <option key={c} value={c}>{CATEGORY_EMOJI[c]} {c}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <button onClick={() => setShowAddItem(false)} className="btn-ghost flex-1 text-xs">Cancel</button>
              <button
                onClick={handleAddItem}
                disabled={addingItem || !newItemName.trim()}
                className="btn-primary flex-1 text-xs flex items-center justify-center gap-1.5"
              >
                {addingItem ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                Add to list
              </button>
            </div>

            {/* Previously added saved items */}
            {savedItems.length > 0 && (
              <div>
                <p className="text-faint text-xs font-body uppercase tracking-widest mb-2">Previously added</p>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {savedItems.map(s => (
                    <div key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-card/50 transition-colors">
                      <span className="text-cream text-sm font-body flex-1 truncate">{s.name}</span>
                      <span className="text-sm shrink-0">{CATEGORY_EMOJI[s.defaultCategory]}</span>
                      <button
                        onClick={async () => {
                          if (!user) return
                          try {
                            const sanitizeId = (str: string) => str.replace(/[/\\]/g, '-').replace(/[^a-zA-Z0-9-_]/g, '-').substring(0, 80)
                            const quickId = sanitizeId(s.name.toLowerCase()) + '-' + Date.now()
                            const ref = doc(db, 'users', user.uid, 'pantry', 'root', 'groceryItems', quickId)
                            await setDoc(ref, {
                              id: quickId,
                              name: s.name,
                              quantity: '',
                              unit: '',
                              isChecked: false,
                              isManual: true,
                              manualSection: s.defaultCategory,
                              sourceRecipeIDs: [],
                              createdAt: serverTimestamp(),
                              updatedAt: serverTimestamp(),
                            })
                          } catch (e) {
                            console.error('Quick-add error:', e)
                          }
                          upsertSavedGroceryItem(user.uid, s.name, s.defaultCategory)
                            .then(() => getSavedGroceryItems(user.uid))
                            .then(setSavedItems)
                            .catch(e => console.error('Failed to update saved item:', e))
                        }}
                        className="text-amber hover:text-amber/80 transition-colors shrink-0 p-1"
                        title="Add to list"
                      >
                        <Plus size={14} />
                      </button>
                      <button
                        onClick={async () => {
                          if (!user) return
                          try {
                            await deleteSavedGroceryItem(user.uid, s.id)
                            setSavedItems(prev => prev.filter(i => i.id !== s.id))
                          } catch (e) {
                            console.error('Failed to delete saved item:', e)
                          }
                        }}
                        className="text-faint hover:text-red-400 transition-colors shrink-0 p-1"
                        title="Remove from saved"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => setShowAddItem(true)}
            className="flex items-center gap-2 text-sm font-body text-faint hover:text-cream transition-colors"
          >
            <Plus size={15} className="text-amber" />
            Add item manually
          </button>
        )}
      </div>

      {/* Cleanup diff view */}
      {cleanupChanges && (
        <div className="mb-6 bg-surface border border-amber/20 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div>
              <p className="text-cream text-sm font-body font-medium">AI Suggestions</p>
              <p className="text-faint text-xs font-body mt-0.5">
                {cleanupChanges.filter(c => c.action === 'remove').length} to remove ·{' '}
                {cleanupChanges.filter(c => c.action === 'merge').length} to merge ·{' '}
                {cleanupChanges.filter(c => c.action === 'normalize').length} to rename
              </p>
            </div>
            <button onClick={() => setCleanupChanges(null)} className="text-faint hover:text-cream">
              <X size={16} />
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-border">
            {cleanupChanges.map((change, i) => {
              const original = items[change.originalIndex]
              const isChanged = change.action !== 'keep'
              return (
                <div key={i} className={`px-4 py-2.5 flex items-center gap-3 ${change.action === 'remove' ? 'opacity-50' : ''}`}>
                  <span className={`text-xs font-body px-1.5 py-0.5 rounded font-medium shrink-0 ${
                    change.action === 'remove' ? 'bg-red-500/10 text-red-400' :
                    change.action === 'merge' ? 'bg-violet-500/10 text-violet-400' :
                    change.action === 'normalize' ? 'bg-amber/10 text-amber' :
                    'bg-card text-faint'
                  }`}>
                    {change.action}
                  </span>
                  <div className="flex-1 min-w-0">
                    {isChanged && original && (
                      <p className="text-faint text-xs font-body line-through truncate">{original.name}</p>
                    )}
                    {change.action !== 'remove' && (
                      <p className="text-cream text-xs font-body truncate">{change.name}</p>
                    )}
                  </div>
                  {change.action !== 'remove' && (
                    <span className="text-faint text-xs font-body shrink-0">{change.category}</span>
                  )}
                </div>
              )
            })}
          </div>
          <div className="px-4 py-3 border-t border-border flex gap-2">
            <button onClick={() => setCleanupChanges(null)} className="btn-ghost text-xs flex-1">Discard</button>
            <button
              onClick={applyCleanup}
              disabled={applyingCleanup}
              className="btn-primary text-xs flex-1 flex items-center justify-center gap-1.5"
            >
              {applyingCleanup ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Apply changes
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 && (
        <div className="text-center py-20 border border-border rounded-2xl">
          <ShoppingCart size={40} className="text-faint mx-auto mb-4" />
          <p className="font-display text-2xl text-faint font-light mb-2">List is empty</p>
          <p className="text-faint text-sm font-body">Add recipes to your meal plan to populate your grocery list</p>
        </div>
      )}

      {/* Grouped items */}
      <div className="space-y-4">
        {GROCERY_CATEGORIES.map(category => {
          const catItems = grouped[category] || []
          if (!catItems.length) return null
          const isCollapsed = collapsed.has(category)
          const checkedInCat = catItems.filter(i => i.isChecked).length

          return (
            <div key={category} className="bg-surface border border-border rounded-2xl overflow-hidden">
              {/* Category header */}
              <button
                onClick={() => toggleCollapse(category)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-card/50 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-base">{CATEGORY_EMOJI[category]}</span>
                  <span className="font-body font-medium text-cream text-sm">{category}</span>
                  <span className="text-faint text-xs font-body">
                    {checkedInCat > 0 ? `${checkedInCat}/${catItems.length}` : catItems.length}
                  </span>
                </div>
                {isCollapsed ? <ChevronDown size={14} className="text-faint" /> : <ChevronUp size={14} className="text-faint" />}
              </button>

              {/* Items */}
              {!isCollapsed && (
                <div className="divide-y divide-border/50">
                  {catItems.map(item => (
                    <div
                      key={item.id}
                      className={`flex items-center gap-3 px-4 py-3 transition-colors ${item.isChecked ? 'opacity-50' : ''}`}
                    >
                      {/* Checkbox */}
                      <button
                        onClick={() => toggleItem(item)}
                        className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-all ${
                          item.isChecked
                            ? 'bg-amber border-amber'
                            : 'border-border hover:border-amber/50'
                        }`}
                      >
                        {item.isChecked && <Check size={11} className="text-ink" />}
                      </button>

                      {/* Name (edit mode or display mode) */}
                      {editingItemId === item.id ? (
                        <div className="flex-1 flex items-center gap-1.5 min-w-0">
                          <input
                            value={editingItemQuantity}
                            onChange={e => setEditingItemQuantity(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveEditItem()
                              else if (e.key === 'Escape') cancelEditItem()
                            }}
                            placeholder="qty"
                            className="w-12 shrink-0 bg-card border border-amber/30 rounded-lg px-1.5 py-1 text-sm font-body text-cream outline-none focus:border-amber/60"
                          />
                          <input
                            value={editingItemUnit}
                            onChange={e => setEditingItemUnit(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveEditItem()
                              else if (e.key === 'Escape') cancelEditItem()
                            }}
                            placeholder="unit"
                            className="w-16 shrink-0 bg-card border border-amber/30 rounded-lg px-1.5 py-1 text-sm font-body text-cream outline-none focus:border-amber/60"
                          />
                          <input
                            value={editingItemName}
                            onChange={e => setEditingItemName(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveEditItem()
                              else if (e.key === 'Escape') cancelEditItem()
                            }}
                            placeholder="name"
                            autoFocus
                            className="flex-1 min-w-0 bg-card border border-amber/30 rounded-lg px-2 py-1 text-sm font-body text-cream outline-none focus:border-amber/60"
                          />
                          <button
                            onClick={saveEditItem}
                            className="text-green-400 hover:text-green-300 transition-colors shrink-0 p-1"
                            title="Save"
                          >
                            <Check size={12} />
                          </button>
                          <button
                            onClick={cancelEditItem}
                            className="text-faint hover:text-cream transition-colors shrink-0 p-1"
                            title="Cancel"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-body ${item.isChecked ? 'line-through text-faint' : 'text-cream'}`}>
                            {item.quantity && item.unit
                              ? `${item.quantity} ${item.unit} ${item.name}`
                              : item.quantity
                              ? `${item.quantity} ${item.name}`
                              : item.name}
                          </p>
                        </div>
                      )}

                      {/* Edit button */}
                      {editingItemId !== item.id && !item.id.includes('/') && (
                        <button
                          onClick={() => startEditItem(item)}
                          className="text-faint hover:text-amber transition-colors shrink-0 p-1"
                          title="Edit name"
                        >
                          <Pencil size={12} />
                        </button>
                      )}

                      {/* Delete button */}
                      {editingItemId !== item.id && !item.id.includes('/') && (
                        <button
                          onClick={() => deleteItem(item)}
                          className="text-faint hover:text-red-400 transition-colors shrink-0 p-1"
                        >
                          <Minus size={12} />
                        </button>
                      )}

                      {/* Category picker trigger */}
                      <div className="relative shrink-0">
                        <button
                          onClick={(e) => {
                            if (categoryPickerFor === item.id) {
                              setCategoryPickerFor(null)
                            } else {
                              const rect = e.currentTarget.getBoundingClientRect()
                              setPickerFlipped(rect.top > window.innerHeight / 2)
                              setCategoryPickerFor(item.id)
                            }
                          }}
                          className="text-faint hover:text-muted transition-colors text-xs font-body flex items-center gap-1"
                          title="Change category"
                        >
                          <Tag size={11} />
                        </button>

                        {/* Category picker dropdown */}
                        {categoryPickerFor === item.id && (
                          <div className={`absolute right-0 z-20 bg-surface border border-border rounded-xl shadow-lg w-52 max-w-[calc(100vw-2rem)] overflow-hidden ${pickerFlipped ? 'bottom-6' : 'top-6'}`}>
                            <p className="text-faint text-xs font-body px-3 py-2 border-b border-border uppercase tracking-widest">Category</p>
                            {MANUAL_CATEGORIES.map(cat => (
                              <button
                                key={cat}
                                onClick={() => setManualCategory(item.id, cat)}
                                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-body hover:bg-card transition-colors ${
                                  getCategory(item) === cat ? 'text-amber' : 'text-muted'
                                }`}
                              >
                                <span>{CATEGORY_EMOJI[cat]}</span>
                                {cat}
                              </button>
                            ))}
                            {item.manualSection && (
                              <button
                                onClick={() => setManualCategory(item.id, null)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-body text-faint hover:text-red-400 hover:bg-card transition-colors border-t border-border"
                              >
                                <X size={11} /> Reset to auto
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
