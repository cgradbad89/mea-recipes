'use client'

import { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Check, X, Loader2, ShoppingCart } from 'lucide-react'
import Link from 'next/link'
import { useAuth } from '@/lib/AuthContext'
import {
  subscribeWeekPlan, weekIDFromDate, removeRecipeFromWeekPlan,
  markRecipeCooked, addRecipeIngredientsToGrocery, getAllWeekPlans,
  type WeekPlan
} from '@/lib/userdata'
import { getAllRecipes, parseRecipeContent } from '@/lib/recipes'
import type { Recipe } from '@/types/recipe'

function getWeekDates(weekID: string): string[] {
  const dates = []
  const start = new Date(weekID + 'T12:00:00')
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    dates.push(d.toISOString().split('T')[0])
  }
  return dates
}

function formatWeekLabel(weekID: string): string {
  const start = new Date(weekID + 'T12:00:00')
  const end = new Date(weekID + 'T12:00:00')
  end.setDate(end.getDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
}

function addWeeks(weekID: string, delta: number): string {
  const d = new Date(weekID + 'T12:00:00')
  d.setDate(d.getDate() + delta * 7)
  return weekIDFromDate(d)
}

export default function PlanPage() {
  const { user, signIn } = useAuth()
  const [weekID, setWeekID] = useState(() => weekIDFromDate(new Date()))
  const [plan, setPlan] = useState<WeekPlan | null>(null)
  const [recipes, setRecipes] = useState<Record<string, Recipe>>({})
  const [loadingRecipes, setLoadingRecipes] = useState(true)
  const [addingToGrocery, setAddingToGrocery] = useState<string | null>(null)

  // Load all recipes for lookup
  useEffect(() => {
    getAllRecipes().then(list => {
      const map: Record<string, Recipe> = {}
      list.forEach(r => { map[r.id] = r })
      setRecipes(map)
      setLoadingRecipes(false)
    })
  }, [])

  // Subscribe to week plan
  useEffect(() => {
    if (!user) return
    const unsub = subscribeWeekPlan(user.uid, weekID, setPlan)
    return unsub
  }, [user, weekID])

  const plannedIDs = plan?.plannedRecipeIDs || []
  const cookedIDs = new Set(plan?.cookedRecipeIDs || [])
  const uncookedPlanned = plannedIDs.filter(id => !cookedIDs.has(id))
  const cooked = plannedIDs.filter(id => cookedIDs.has(id))

  const handleMarkCooked = async (recipeID: string, isCooked: boolean) => {
    if (!user) return
    await markRecipeCooked(user.uid, weekID, recipeID, isCooked)
  }

  const handleRemove = async (recipeID: string) => {
    if (!user) return
    await removeRecipeFromWeekPlan(user.uid, weekID, recipeID)
  }

  const handleAddToGrocery = async (recipeID: string) => {
    if (!user) return
    const recipe = recipes[recipeID]
    if (!recipe) return
    setAddingToGrocery(recipeID)
    const { ingredients } = parseRecipeContent(recipe.content)
    await addRecipeIngredientsToGrocery(user.uid, recipeID, ingredients)
    setAddingToGrocery(null)
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5 p-6">
        <div className="w-16 h-16 rounded-full bg-amber/10 flex items-center justify-center">
          <span className="font-display text-3xl">📅</span>
        </div>
        <h2 className="font-display text-3xl text-cream font-light">Meal Planning</h2>
        <p className="text-muted text-sm font-body text-center max-w-xs">
          Sign in to plan your meals for the week and keep everything in sync across devices.
        </p>
        <button onClick={signIn} className="btn-primary">Sign in with Google</button>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      {/* Header + week picker */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="font-display text-4xl text-cream font-light">Meal Plan</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekID(w => addWeeks(w, -1))}
            className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-faint hover:text-cream hover:border-amber/30 transition-all"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-body text-muted w-36 text-center">
            {formatWeekLabel(weekID)}
          </span>
          <button
            onClick={() => setWeekID(w => addWeeks(w, 1))}
            className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-faint hover:text-cream hover:border-amber/30 transition-all"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {loadingRecipes ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-amber" size={24} />
        </div>
      ) : (
        <>
          {/* Planned section */}
          <section className="mb-8">
            <h2 className="font-display text-xl text-cream font-light mb-4">
              Planned
              {uncookedPlanned.length > 0 && (
                <span className="ml-2 text-faint text-sm font-body">{uncookedPlanned.length}</span>
              )}
            </h2>

            {uncookedPlanned.length === 0 ? (
              <div className="bg-surface border border-border rounded-2xl p-6 text-center">
                <p className="text-faint text-sm font-body mb-3">No recipes planned this week</p>
                <Link href="/recipes" className="btn-ghost text-xs">Browse recipes →</Link>
              </div>
            ) : (
              <div className="space-y-2">
                {uncookedPlanned.map(id => {
                  const recipe = recipes[id]
                  if (!recipe) return null
                  return (
                    <div key={id} className="bg-surface border border-border rounded-xl p-3 flex items-center gap-3">
                      {recipe.imageURL && (
                        <img src={recipe.imageURL} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                      )}
                      <div className="flex-1 min-w-0">
                        <Link href={`/recipes/${id}`}>
                          <p className="text-cream text-sm font-body font-medium truncate hover:text-amber transition-colors">
                            {recipe.title}
                          </p>
                        </Link>
                        <p className="text-faint text-xs font-body capitalize">{recipe.cuisine}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleAddToGrocery(id)}
                          className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-faint hover:text-amber hover:border-amber/30 transition-all"
                          title="Add ingredients to grocery list"
                        >
                          {addingToGrocery === id
                            ? <Loader2 size={13} className="animate-spin" />
                            : <ShoppingCart size={13} />
                          }
                        </button>
                        <button
                          onClick={() => handleMarkCooked(id, true)}
                          className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-faint hover:text-green-400 hover:border-green-400/30 transition-all"
                          title="Mark as cooked"
                        >
                          <Check size={13} />
                        </button>
                        <button
                          onClick={() => handleRemove(id)}
                          className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-faint hover:text-red-400 hover:border-red-400/30 transition-all"
                          title="Remove from plan"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Cooked section */}
          {cooked.length > 0 && (
            <section>
              <h2 className="font-display text-xl text-cream font-light mb-4">
                Cooked
                <span className="ml-2 text-faint text-sm font-body">{cooked.length}</span>
              </h2>
              <div className="space-y-2">
                {cooked.map(id => {
                  const recipe = recipes[id]
                  if (!recipe) return null
                  return (
                    <div key={id} className="bg-surface border border-border rounded-xl p-3 flex items-center gap-3 opacity-60">
                      <div className="w-12 h-12 rounded-lg bg-card flex items-center justify-center shrink-0">
                        <Check size={16} className="text-green-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <Link href={`/recipes/${id}`}>
                          <p className="text-muted text-sm font-body font-medium truncate line-through">
                            {recipe.title}
                          </p>
                        </Link>
                      </div>
                      <button
                        onClick={() => handleMarkCooked(id, false)}
                        className="text-faint text-xs font-body hover:text-muted transition-colors px-2"
                      >
                        Undo
                      </button>
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
