'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Search, X, SlidersHorizontal, Heart } from 'lucide-react'
import { RECIPE_CATEGORIES } from '@/lib/recipeCategories'
import type { SourceFilter } from './RecipeFilters'

const CUISINES = ['mexican', 'asian', 'american', 'mediterranean', 'italian', 'indian', 'middle eastern', 'greek', 'bbq', 'ethiopian', 'filipino', 'vietnamese', 'moroccan', 'french', 'japanese', 'korean', 'thai', 'spanish', 'turkish', 'lebanese', 'brazilian', 'taiwanese', 'west african']
type Sort = 'default' | 'rating' | 'mine' | 'az' | 'recent'
type Time = 0 | 30 | 45 | 60
type Personal = 'none' | 'cookedRecently' | 'wantToTry'
interface Props {
  search: string; setSearch: (value: string) => void
  cuisine: string[]; setCuisine: (value: string[]) => void
  category: string; setCategory: (value: string) => void
  minRating: number; setMinRating: (value: number) => void
  source: SourceFilter; setSource: (value: SourceFilter) => void
  sort: Sort; setSort: (value: Sort) => void
  timeFilter: Time; setTimeFilter: (value: Time) => void
  filter: Personal; setFilter: (value: Personal) => void
  signedIn: boolean; count: number; total: number; loading: boolean
}

export default function RecipeListingControls(p: Props) {
  const [open, setOpen] = useState(false)
  const activeCount = Number(p.cuisine.length > 0) + Number(p.category !== 'All') + Number(p.minRating > 0) + Number(p.source !== 'all') + Number(p.timeFilter > 0) + Number(p.filter === 'cookedRecently')
  const reset = () => {
    p.setCuisine([]); p.setCategory('All'); p.setMinRating(0); p.setSource('all'); p.setTimeFilter(0)
    if (p.filter === 'cookedRecently') p.setFilter('none')
  }
  return <div className="listing-controls">
    <div className="listing-search">
      <Search size={21} aria-hidden="true" />
      <input aria-label="Search recipes and ingredients" placeholder="Search recipes, ingredients, or cuisine" value={p.search} onChange={e => p.setSearch(e.target.value)} />
      {p.search && <button type="button" aria-label="Clear search" onClick={() => p.setSearch('')}><X size={18} /></button>}
    </div>
    <div className="listing-collections" aria-label="Recipe collections">
      <button type="button" aria-pressed={p.filter !== 'wantToTry'} onClick={() => p.setFilter('none')}>All</button>
      <button type="button" aria-pressed={p.filter === 'wantToTry'} onClick={() => p.setFilter('wantToTry')}>Want to Try</button>
      <Link href="/favorites"><Heart size={18} aria-hidden="true" /> Favorites</Link>
    </div>
    <div className="listing-toolbar">
      <p aria-live="polite">{p.loading ? 'Loading recipes…' : p.count === p.total ? `${p.total} recipes` : `${p.count} of ${p.total} recipes`}</p>
      <div className="listing-toolbar-actions">
        <button type="button" className="listing-filter-toggle" aria-expanded={open} aria-controls="recipe-filter-panel" onClick={() => setOpen(!open)}><SlidersHorizontal size={17} aria-hidden="true" /> Filters{activeCount > 0 ? ` (${activeCount})` : ''}</button>
        <label className="listing-sort">Sort <select aria-label="Sort recipes" value={p.sort} onChange={e => p.setSort(e.target.value as Sort)}>
          <option value="default">Default</option><option value="rating">Top rated</option><option value="mine">Mine first</option><option value="az">A → Z</option><option value="recent">Added recently</option>
        </select></label>
      </div>
    </div>
    {open && <div id="recipe-filter-panel" className="listing-filter-panel">
      <div className="listing-filter-head"><h2>Filters</h2><button type="button" onClick={reset} disabled={!activeCount}>Reset filters</button></div>
      <div className="listing-filter-selects">
        <label>Category<select value={p.category} onChange={e => p.setCategory(e.target.value)}>{['All', ...RECIPE_CATEGORIES].map(c => <option key={c}>{c}</option>)}</select></label>
        <label>Total time<select value={p.timeFilter} onChange={e => p.setTimeFilter(Number(e.target.value) as Time)}><option value={0}>Any total time</option><option value={30}>Under 30 min</option><option value={45}>Under 45 min</option><option value={60}>Under 1 hour</option></select></label>
        {p.signedIn && <><label>Source<select value={p.source} onChange={e => p.setSource(e.target.value as SourceFilter)}><option value="all">All recipes</option><option value="mine">Added by me</option><option value="others">Others</option></select></label>
        <label>Minimum rating<select value={p.minRating} onChange={e => p.setMinRating(Number(e.target.value))}><option value={0}>Any rating</option>{[1, 2, 3, 4, 5].map(n => <option value={n} key={n}>{n}+ stars</option>)}</select></label>
        <label>Cooking history<select value={p.filter === 'cookedRecently' ? 'cookedRecently' : 'none'} onChange={e => p.setFilter(e.target.value as Personal)}><option value="none">Any time</option><option value="cookedRecently">Cooked recently</option></select></label></>}
      </div>
      <fieldset><legend>Cuisine</legend><div className="listing-cuisines"><button type="button" aria-pressed={p.cuisine.length === 0} onClick={() => p.setCuisine([])}>All</button>{CUISINES.map(c => <button key={c} type="button" aria-pressed={p.cuisine.includes(c)} onClick={() => p.setCuisine(p.cuisine.includes(c) ? p.cuisine.filter(x => x !== c) : [...p.cuisine, c])}>{c}</button>)}</div></fieldset>
    </div>}
    {activeCount > 0 && !open && <button type="button" className="listing-reset" onClick={reset}>Reset filters</button>}
  </div>
}
