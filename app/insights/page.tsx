'use client'

import { useMemo, useState, useEffect } from 'react'
import { useAuth } from '@/lib/AuthContext'
import { useCookingHistory } from '@/hooks/useCookingHistory'
import { useRecipeMetas } from '@/hooks/useRecipeMetas'
import { getAllRecipes } from '@/lib/recipes'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts'
import { TrendingUp, Star, ChefHat, Globe, Download, Loader2 } from 'lucide-react'
import type { Recipe } from '@/types/recipe'

const CUISINE_COLORS = [
  '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6',
  '#EC4899', '#F97316', '#14B8A6', '#6366F1',
  '#84CC16', '#EF4444', '#06B6D4', '#A78BFA',
]

function exportCSV(rows: string[][], filename: string) {
  const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function InsightsPage() {
  const { user } = useAuth()
  const { weeks, loading: weeksLoading } = useCookingHistory()
  const metas = useRecipeMetas()
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [recipesLoading, setRecipesLoading] = useState(true)

  useEffect(() => {
    getAllRecipes().then(r => { setRecipes(r); setRecipesLoading(false) })
  }, [])

  const recipeMap = useMemo(() => {
    const map: Record<string, Recipe> = {}
    recipes.forEach(r => { map[r.id] = r })
    return map
  }, [recipes])

  // Cook counts per recipe
  const cookCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    weeks.forEach(w => {
      (w.cookedRecipeIDs || []).forEach(id => {
        counts[id] = (counts[id] || 0) + 1
      })
    })
    return counts
  }, [weeks])

  // Top recipes by cook count
  const topRecipes = useMemo(() => {
    return Object.entries(cookCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([id, count]) => ({ recipe: recipeMap[id], count, id }))
      .filter(r => r.recipe)
  }, [cookCounts, recipeMap])

  // Cuisine breakdown
  const cuisineData = useMemo(() => {
    const counts: Record<string, number> = {}
    Object.entries(cookCounts).forEach(([id, count]) => {
      const cuisine = recipeMap[id]?.cuisine || 'other'
      counts[cuisine] = (counts[cuisine] || 0) + count
    })
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([name, value]) => ({ name: name || 'other', value }))
  }, [cookCounts, recipeMap])

  // Rating distribution
  const ratingData = useMemo(() => {
    const dist = [1, 2, 3, 4, 5].map(r => ({ rating: `${r}★`, count: 0 }))
    Object.values(metas).forEach(m => {
      if (m.rating && m.rating >= 1 && m.rating <= 5) {
        dist[Math.round(m.rating) - 1].count++
      }
    })
    return dist
  }, [metas])

  // Discovery rate — new recipes per month
  const discoveryData = useMemo(() => {
    const monthly: Record<string, Set<string>> = {}
    weeks.forEach(w => {
      if (!w.weekStartISO) return
      const month = w.weekStartISO.slice(0, 7)
      if (!monthly[month]) monthly[month] = new Set()
      ;(w.cookedRecipeIDs || []).forEach(id => monthly[month].add(id))
    })
    return Object.entries(monthly)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, ids]) => ({
        month: new Date(month + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        recipes: ids.size,
      }))
  }, [weeks])

  // Highly rated recipes not cooked recently
  const underutilized = useMemo(() => {
    const recentIds = new Set(
      weeks.slice(0, 4).flatMap(w => w.cookedRecipeIDs || [])
    )
    return Object.entries(metas)
      .filter(([id, m]) => (m.rating || 0) >= 4 && !recentIds.has(id) && recipeMap[id])
      .sort(([, a], [, b]) => (b.rating || 0) - (a.rating || 0))
      .slice(0, 6)
      .map(([id, m]) => ({ recipe: recipeMap[id], rating: m.rating || 0 }))
  }, [metas, weeks, recipeMap])

  const totalCooked = useMemo(() =>
    weeks.reduce((sum, w) => sum + (w.cookedRecipeIDs?.length || 0), 0),
  [weeks])

  const avgRating = useMemo(() => {
    const rated = Object.values(metas).filter(m => m.rating)
    if (!rated.length) return 0
    return (rated.reduce((s, m) => s + (m.rating || 0), 0) / rated.length).toFixed(1)
  }, [metas])

  const handleExport = () => {
    const rows = [
      ['Recipe', 'Cuisine', 'Category', 'Times Cooked', 'Your Rating'],
      ...Object.entries(cookCounts).map(([id, count]) => {
        const r = recipeMap[id]
        const rating = metas[id]?.rating || ''
        return [r?.title || id, r?.cuisine || '', r?.category || '', String(count), String(rating)]
      })
    ]
    exportCSV(rows, 'mea-cooking-history.csv')
  }

  const loading = weeksLoading || recipesLoading

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-6">
        <TrendingUp size={48} className="text-faint" />
        <p className="font-display text-3xl text-faint font-light">Sign in to see your insights</p>
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
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-display text-5xl text-cream font-light tracking-tight mb-1">Insights</h1>
          <p className="text-faint text-sm font-body">What your cooking says about you</p>
        </div>
        <button
          onClick={handleExport}
          className="btn-ghost flex items-center gap-2 text-xs"
        >
          <Download size={13} />
          Export CSV
        </button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-10">
        {[
          { label: 'Total cooked', value: totalCooked, icon: ChefHat },
          { label: 'Avg rating', value: avgRating || '—', icon: Star },
          { label: 'Cuisines explored', value: cuisineData.length, icon: Globe },
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Cuisine breakdown */}
        <div className="bg-surface border border-border rounded-2xl p-5">
          <h2 className="font-display text-xl text-cream font-light mb-5">Cuisine breakdown</h2>
          {cuisineData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={cuisineData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {cuisineData.map((_, i) => (
                    <Cell key={i} fill={CUISINE_COLORS[i % CUISINE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8 }}
                  labelStyle={{ color: '#f5f0e8' }}
                  itemStyle={{ color: '#a0998f' }}
                />
                <Legend
                  formatter={(value) => <span style={{ color: '#a0998f', fontSize: 11, textTransform: 'capitalize' }}>{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-faint text-sm font-body text-center py-12">Cook some recipes to see breakdown</p>
          )}
        </div>

        {/* Rating distribution */}
        <div className="bg-surface border border-border rounded-2xl p-5">
          <h2 className="font-display text-xl text-cream font-light mb-5">Rating distribution</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={ratingData} barSize={32}>
              <XAxis dataKey="rating" tick={{ fill: '#a0998f', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#a0998f', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8 }}
                labelStyle={{ color: '#f5f0e8' }}
                itemStyle={{ color: '#a0998f' }}
                cursor={{ fill: 'rgba(245,158,11,0.05)' }}
              />
              <Bar dataKey="count" fill="#F59E0B" radius={[4, 4, 0, 0]} name="Recipes" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Discovery rate */}
      {discoveryData.length > 0 && (
        <div className="bg-surface border border-border rounded-2xl p-5 mb-8">
          <h2 className="font-display text-xl text-cream font-light mb-5">Recipes cooked per month</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={discoveryData} barSize={20}>
              <XAxis dataKey="month" tick={{ fill: '#a0998f', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#a0998f', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8 }}
                labelStyle={{ color: '#f5f0e8' }}
                cursor={{ fill: 'rgba(245,158,11,0.05)' }}
              />
              <Bar dataKey="recipes" fill="#10B981" radius={[4, 4, 0, 0]} name="Unique recipes" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Top recipes */}
      {topRecipes.length > 0 && (
        <div className="bg-surface border border-border rounded-2xl p-5 mb-8">
          <h2 className="font-display text-xl text-cream font-light mb-5">Most cooked recipes</h2>
          <div className="space-y-3">
            {topRecipes.map(({ recipe, count }, i) => (
              <div key={recipe.id} className="flex items-center gap-4">
                <span className="font-display text-2xl text-amber/40 font-light w-6 shrink-0">{i + 1}</span>
                <div className="w-10 h-10 rounded-lg overflow-hidden bg-card shrink-0">
                  {recipe.imageURL ? (
                    <img src={recipe.imageURL} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-lg">🍽️</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-cream text-sm font-body truncate">{recipe.title}</p>
                  <p className="text-faint text-xs font-body capitalize">{recipe.cuisine}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <div
                    className="h-1.5 rounded-full bg-amber/20"
                    style={{ width: `${Math.max(24, (count / topRecipes[0].count) * 80)}px` }}
                  >
                    <div className="h-full rounded-full bg-amber" style={{ width: '100%' }} />
                  </div>
                  <span className="text-amber text-xs font-body font-semibold w-8 text-right">{count}×</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Underutilized — highly rated but not cooked recently */}
      {underutilized.length > 0 && (
        <div className="bg-surface border border-border rounded-2xl p-5">
          <h2 className="font-display text-xl text-cream font-light mb-1">Haven't made in a while</h2>
          <p className="text-faint text-xs font-body mb-5">Highly rated recipes you haven't cooked recently</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {underutilized.map(({ recipe, rating }) => (
              <a key={recipe.id} href={`/recipes/${recipe.id}`} className="group flex gap-3 items-center">
                <div className="w-12 h-12 rounded-xl overflow-hidden bg-card shrink-0">
                  {recipe.imageURL ? (
                    <img src={recipe.imageURL} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xl">🍽️</div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-cream text-xs font-body truncate group-hover:text-amber transition-colors">{recipe.title}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    {Array.from({ length: rating }).map((_, i) => (
                      <span key={i} className="text-amber text-xs">★</span>
                    ))}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
