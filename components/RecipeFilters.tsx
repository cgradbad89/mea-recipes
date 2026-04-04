'use client'

import { Search, X, SlidersHorizontal, Star } from 'lucide-react'
import { useState } from 'react'

const CUISINES = [
  'All', 'mexican', 'asian', 'american', 'mediterranean',
  'italian', 'indian', 'middle eastern', 'greek', 'bbq',
  'ethiopian', 'filipino', 'vietnamese', 'moroccan', 'french',
  'japanese', 'korean', 'thai', 'spanish', 'turkish', 'lebanese',
  'brazilian', 'taiwanese', 'west african',
]

const CATEGORIES = [
  'All',
  'Chicken & Poultry',
  'Vegetarian Mains',
  'Salads & Bowls',
  'Pasta, Noodles & Rice',
  'Soups, Stews & Chili',
  'Seafood',
  'Beef & Pork',
  'Breakfast, Snacks & Sides',
]

export type SourceFilter = 'all' | 'mine' | 'others'

interface FiltersProps {
  search: string
  cuisine: string
  category: string
  minRating: number
  source: SourceFilter
  onSearchChange: (v: string) => void
  onCuisineChange: (v: string) => void
  onCategoryChange: (v: string) => void
  onMinRatingChange: (v: number) => void
  onSourceChange: (v: SourceFilter) => void
  totalCount: number
  filteredCount: number
  isSignedIn: boolean
}

export default function RecipeFilters({
  search, cuisine, category, minRating, source,
  onSearchChange, onCuisineChange, onCategoryChange,
  onMinRatingChange, onSourceChange,
  totalCount, filteredCount, isSignedIn,
}: FiltersProps) {
  const [showFilters, setShowFilters] = useState(false)
  const hasFilters = cuisine !== 'All' || category !== 'All' || minRating > 0 || source !== 'all'

  const clearAll = () => {
    onCuisineChange('All')
    onCategoryChange('All')
    onMinRatingChange(0)
    onSourceChange('all')
    onSearchChange('')
  }

  return (
    <div className="space-y-4">
      {/* Search + filter toggle */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            type="text"
            placeholder="Search recipes, ingredients..."
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            className="input-field pl-10"
          />
          {search && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-faint hover:text-muted"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowFilters(f => !f)}
          className={`btn-ghost flex items-center gap-2 ${hasFilters ? 'border-amber/40 text-amber' : ''}`}
        >
          <SlidersHorizontal size={14} />
          <span className="hidden sm:inline">Filters</span>
          {hasFilters && <span className="w-1.5 h-1.5 rounded-full bg-amber" />}
        </button>
        {(hasFilters || search) && (
          <button onClick={clearAll} className="btn-ghost text-faint text-xs px-3">
            Clear
          </button>
        )}
      </div>

      {/* Filter panels */}
      {showFilters && (
        <div className="space-y-5 bg-surface border border-border rounded-2xl p-4 animate-fade-in">

          {/* Source filter — only when signed in */}
          {isSignedIn && (
            <div>
              <p className="text-faint text-xs font-body uppercase tracking-widest mb-2.5">Source</p>
              <div className="flex gap-2">
                {(['all', 'mine', 'others'] as SourceFilter[]).map(s => (
                  <button
                    key={s}
                    onClick={() => onSourceChange(s)}
                    className={`text-xs px-3 py-1.5 rounded-lg font-body font-medium capitalize transition-all duration-150 border ${
                      source === s
                        ? 'bg-amber/10 text-amber border-amber/30'
                        : 'bg-card text-faint border-border hover:border-amber/20 hover:text-muted'
                    }`}
                  >
                    {s === 'all' ? 'All recipes' : s === 'mine' ? 'Added by me' : 'Others'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Rating filter */}
          {isSignedIn && (
            <div>
              <p className="text-faint text-xs font-body uppercase tracking-widest mb-2.5">Minimum rating</p>
              <div className="flex items-center gap-3">
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map(star => (
                    <button
                      key={star}
                      onClick={() => onMinRatingChange(minRating === star ? 0 : star)}
                      className="transition-colors"
                    >
                      <Star
                        size={20}
                        className={star <= minRating ? 'text-amber fill-amber' : 'text-faint hover:text-muted'}
                      />
                    </button>
                  ))}
                </div>
                {minRating > 0 && (
                  <span className="text-faint text-xs font-body">{minRating}+ stars</span>
                )}
              </div>
            </div>
          )}

          {/* Cuisine filter */}
          <div>
            <p className="text-faint text-xs font-body uppercase tracking-widest mb-2.5">Cuisine</p>
            <div className="flex flex-wrap gap-2">
              {CUISINES.map(c => (
                <button
                  key={c}
                  onClick={() => onCuisineChange(c)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-body font-medium capitalize transition-all duration-150 border ${
                    cuisine === c
                      ? 'bg-amber/10 text-amber border-amber/30'
                      : 'bg-card text-faint border-border hover:border-amber/20 hover:text-muted'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Category filter */}
          <div>
            <p className="text-faint text-xs font-body uppercase tracking-widest mb-2.5">Category</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map(c => (
                <button
                  key={c}
                  onClick={() => onCategoryChange(c)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-body font-medium transition-all duration-150 border ${
                    category === c
                      ? 'bg-amber/10 text-amber border-amber/30'
                      : 'bg-card text-faint border-border hover:border-amber/20 hover:text-muted'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Result count */}
      <p className="text-faint text-xs font-body">
        {filteredCount === totalCount
          ? `${totalCount} recipes`
          : `${filteredCount} of ${totalCount} recipes`}
      </p>
    </div>
  )
}
