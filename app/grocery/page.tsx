'use client'

import { useState, useEffect } from 'react'
import { Trash2, Plus, Check, ShoppingCart, Loader2, X } from 'lucide-react'
import { useAuth } from '@/lib/AuthContext'
import {
  subscribeGroceryItems, toggleGroceryItem, deleteGroceryItem,
  clearCheckedGroceryItems, clearAllGroceryItems, addGroceryItem,
  type GroceryItem
} from '@/lib/userdata'

export default function GroceryPage() {
  const { user, signIn } = useAuth()
  const [items, setItems] = useState<GroceryItem[]>([])
  const [newItem, setNewItem] = useState('')
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (!user) { setLoading(false); return }
    const unsub = subscribeGroceryItems(user.uid, list => {
      setItems(list)
      setLoading(false)
    })
    return unsub
  }, [user])

  const handleAdd = async () => {
    if (!user || !newItem.trim()) return
    setAdding(true)
    await addGroceryItem(user.uid, {
      name: newItem.trim(),
      quantity: '',
      unit: '',
      isChecked: false,
      isManual: true,
      sourceRecipeIDs: [],
    })
    setNewItem('')
    setAdding(false)
  }

  const handleToggle = async (item: GroceryItem) => {
    if (!user) return
    await toggleGroceryItem(user.uid, item.id, !item.isChecked)
  }

  const handleDelete = async (id: string) => {
    if (!user) return
    await deleteGroceryItem(user.uid, id)
  }

  const unchecked = items.filter(i => !i.isChecked)
  const checked = items.filter(i => i.isChecked)

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5 p-6">
        <div className="w-16 h-16 rounded-full bg-amber/10 flex items-center justify-center">
          <ShoppingCart size={28} className="text-amber" />
        </div>
        <h2 className="font-display text-3xl text-cream font-light">Grocery List</h2>
        <p className="text-muted text-sm font-body text-center max-w-xs">
          Sign in to manage your grocery list and sync it across all your devices.
        </p>
        <button onClick={signIn} className="btn-primary">Sign in with Google</button>
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto p-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-4xl text-cream font-light">Grocery</h1>
          <p className="text-faint text-xs font-body mt-0.5">
            {unchecked.length} item{unchecked.length !== 1 ? 's' : ''} remaining
          </p>
        </div>
        {items.length > 0 && (
          <div className="flex gap-2">
            {checked.length > 0 && (
              <button
                onClick={() => clearCheckedGroceryItems(user.uid)}
                className="btn-ghost text-xs"
              >
                Clear checked
              </button>
            )}
            <button
              onClick={() => clearAllGroceryItems(user.uid)}
              className="btn-ghost text-xs text-faint"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Add item */}
      <div className="flex gap-2 mb-8">
        <input
          type="text"
          value={newItem}
          onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder="Add an item..."
          className="input-field flex-1"
        />
        <button
          onClick={handleAdd}
          disabled={!newItem.trim() || adding}
          className="btn-primary px-4 flex items-center gap-1"
        >
          {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={16} />}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="animate-spin text-amber" size={24} />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16">
          <p className="font-display text-2xl text-faint font-light mb-2">List is empty</p>
          <p className="text-faint text-sm font-body">Add items manually or from your meal plan</p>
        </div>
      ) : (
        <div className="space-y-1">
          {/* Unchecked items */}
          {unchecked.map(item => (
            <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface group transition-colors">
              <button
                onClick={() => handleToggle(item)}
                className="w-5 h-5 rounded border-2 border-border hover:border-amber/50 flex items-center justify-center transition-all shrink-0"
              >
              </button>
              <div className="flex-1 min-w-0">
                <span className="text-cream text-sm font-body">{item.name}</span>
                {item.sourceRecipeIDs?.length > 0 && (
                  <span className="text-faint text-xs font-body ml-2">
                    from {item.sourceRecipeIDs.length} recipe{item.sourceRecipeIDs.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <button
                onClick={() => handleDelete(item.id)}
                className="opacity-0 group-hover:opacity-100 text-faint hover:text-red-400 transition-all"
              >
                <X size={14} />
              </button>
            </div>
          ))}

          {/* Divider */}
          {checked.length > 0 && unchecked.length > 0 && (
            <div className="border-t border-border my-3" />
          )}

          {/* Checked items */}
          {checked.map(item => (
            <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface group transition-colors opacity-50">
              <button
                onClick={() => handleToggle(item)}
                className="w-5 h-5 rounded border-2 border-amber/40 bg-amber/10 flex items-center justify-center shrink-0"
              >
                <Check size={11} className="text-amber" />
              </button>
              <span className="flex-1 text-muted text-sm font-body line-through">{item.name}</span>
              <button
                onClick={() => handleDelete(item.id)}
                className="opacity-0 group-hover:opacity-100 text-faint hover:text-red-400 transition-all"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
