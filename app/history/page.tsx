'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/AuthContext'
import { useCookingHistory } from '@/hooks/useCookingHistory'
import { getAllRecipes } from '@/lib/recipes'
import { useState, useEffect } from 'react'
import { Flame, ChefHat, TrendingUp, Calendar, Loader2 } from 'lucide-react'
import type { Recipe } from '@/types/recipe'

function parseWeekStart(iso: string): Date {
  return new Date(iso + 'T00:00:00')
}

function formatWeekLabel(iso: string): string {
  const d = parseWeekStart(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getMonday(d: Date): string {
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(d.setDate(diff))
  return monday.toISOString().slice(0, 10)
}

// Generate last 52 weeks for heatmap
function generateHeatmapWeeks(): string[] {
  const weeks: string[] = []
  const today = new Date()
  for (let i = 51; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i * 7)
    weeks.push(getMonday(d))
  }
  return weeks
}

export default function HistoryPage() {
  const { user } = useAuth()
  const { weeks, loading } = useCookingHistory()
  const [recipes, setRecipes] = useState<Record<string, Recipe>>({})

  useEffect(() => {
    getAllRecipes().then(all => {
      const map: Record<string, Recipe> = {}
      all.forEach(r => { map[r.id] = r })
      setRecipes(map)
    })
  }, [])

  const stats = useMemo(() => {
    if (!weeks.length) return { totalCooked: 0, totalWeeks: 0, streak: 0, longestStreak: 0 }
    const totalCooked = weeks.reduce((sum, w) => sum + (w.cookedRecipeIDs?.length || 0), 0)
    const activeWeeks = weeks.filter(w => w.cookedRecipeIDs?.length > 0)
    const totalWeeks = activeWeeks.length

    // Calculate streak (consecutive weeks with at least 1 cooked recipe)
    const sortedWeeks = [...weeks].sort((a, b) => b.weekStartISO.localeCompare(a.weekStartISO))
    let streak = 0
    let longestStreak = 0
    let currentStreak = 0
    let prevWeekISO = getMonday(new Date())

    for (const w of sortedWeeks) {
      const expectedPrev = new Date(prevWeekISO)
      expectedPrev.setDate(expectedPrev.getDate() - 7)
      const expected = expectedPrev.toISOString().slice(0, 10)
      const hasCooked = w.cookedRecipeIDs?.length > 0
      if (hasCooked && (w.weekStartISO === prevWeekISO || w.weekStartISO === expected)) {
        currentStreak++
        longestStreak = Math.max(longestStreak, currentStreak)
        if (streak === 0 || w.weekStartISO === prevWeekISO) streak = currentStreak
      } else {
        currentStreak = 0
      }
      prevWeekISO = w.weekStartISO
    }

    return { totalCooked, totalWeeks, streak, longestStreak }
  }, [weeks])

  const heatmapData = useMemo(() => {
    const weekMap: Record<string, number> = {}
    weeks.forEach(w => { weekMap[w.weekStartISO] = w.cookedRecipeIDs?.length || 0 })
    return weekMap
  }, [weeks])

  const heatmapWeeks = useMemo(() => generateHeatmapWeeks(), [])

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-6">
        <ChefHat size={48} className="text-faint" />
        <p className="font-display text-3xl text-faint font-light">Sign in to see your cooking history</p>
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

  const recentWeeks = [...weeks]
    .filter(w => w.cookedRecipeIDs?.length > 0)
    .slice(0, 12)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-display text-5xl text-cream font-light tracking-tight mb-1">History</h1>
        <p className="text-faint text-sm font-body">Your cooking journey</p>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        {[
          { label: 'Recipes cooked', value: stats.totalCooked, icon: ChefHat },
          { label: 'Active weeks', value: stats.totalWeeks, icon: Calendar },
          { label: 'Current streak', value: `${stats.streak}w`, icon: Flame },
          { label: 'Longest streak', value: `${stats.longestStreak}w`, icon: TrendingUp },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="bg-surface border border-border rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon size={14} className="text-amber" />
              <p className="text-faint text-xs font-body uppercase tracking-widest">{label}</p>
            </div>
            <p className="font-display text-4xl text-cream font-light">{value}</p>
          </div>
        ))}
      </div>

      {/* Heatmap */}
      <div className="bg-surface border border-border rounded-2xl p-5 mb-10">
        <h2 className="font-display text-xl text-cream font-light mb-4">Cooking activity</h2>
        <div className="overflow-x-auto">
          <div className="flex gap-1 min-w-max">
            {heatmapWeeks.map(week => {
              const count = heatmapData[week] || 0
              const opacity = count === 0 ? 'bg-card' :
                count === 1 ? 'bg-amber/20' :
                count === 2 ? 'bg-amber/40' :
                count === 3 ? 'bg-amber/60' : 'bg-amber/80'
              return (
                <div
                  key={week}
                  className={`w-3.5 h-3.5 rounded-sm ${opacity} border border-border/30 shrink-0`}
                  title={`${week}: ${count} recipe${count !== 1 ? 's' : ''} cooked`}
                />
              )
            })}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <span className="text-faint text-xs font-body">Less</span>
            {['bg-card', 'bg-amber/20', 'bg-amber/40', 'bg-amber/60', 'bg-amber/80'].map(c => (
              <div key={c} className={`w-3.5 h-3.5 rounded-sm ${c} border border-border/30`} />
            ))}
            <span className="text-faint text-xs font-body">More</span>
          </div>
        </div>
      </div>

      {/* Weekly timeline */}
      {recentWeeks.length === 0 ? (
        <div className="text-center py-16">
          <p className="font-display text-2xl text-faint font-light mb-2">No cooking history yet</p>
          <p className="text-faint text-sm font-body">Mark recipes as cooked in the Meal Plan to start tracking</p>
        </div>
      ) : (
        <div className="space-y-6">
          <h2 className="font-display text-2xl text-cream font-light">Recent weeks</h2>
          {recentWeeks.map(week => {
            const cookedRecipes = (week.cookedRecipeIDs || [])
              .map(id => recipes[id])
              .filter(Boolean)
            return (
              <div key={week.weekID} className="bg-surface border border-border rounded-2xl overflow-hidden">
                {/* Week header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                  <div className="flex items-center gap-3">
                    <Calendar size={14} className="text-amber" />
                    <span className="font-body text-sm text-cream font-medium">
                      Week of {formatWeekLabel(week.weekStartISO)}
                    </span>
                  </div>
                  <span className="text-faint text-xs font-body">
                    {week.cookedRecipeIDs.length} cooked
                  </span>
                </div>
                {/* Recipe grid */}
                <div className="p-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                  {cookedRecipes.map(recipe => (
                    <Link
                      key={recipe.id}
                      href={`/recipes/${recipe.id}`}
                      className="group flex flex-col gap-1.5"
                    >
                      <div className="aspect-square rounded-xl overflow-hidden bg-card">
                        {recipe.imageURL ? (
                          <img
                            src={recipe.imageURL}
                            alt={recipe.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            onError={e => { (e.target as HTMLImageElement).parentElement!.className = 'aspect-square rounded-xl bg-card flex items-center justify-center' }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <span className="text-2xl opacity-30">🍽️</span>
                          </div>
                        )}
                      </div>
                      <p className="text-faint text-xs font-body line-clamp-2 group-hover:text-cream transition-colors">
                        {recipe.title}
                      </p>
                    </Link>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
