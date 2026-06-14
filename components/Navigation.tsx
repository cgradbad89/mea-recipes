'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UtensilsCrossed, Calendar, ShoppingCart, Heart, Plus, Clock, BarChart2, Inbox, Sparkles, Apple, MoreHorizontal, X } from 'lucide-react'
import { useState } from 'react'
import AddRecipeModal from './AddRecipeModal'
import AuthButton from './AuthButton'

const NAV_ITEMS = [
  { href: '/recipes', label: 'Recipes', icon: UtensilsCrossed },
  { href: '/plan', label: 'Plan', icon: Calendar },
  { href: '/grocery', label: 'Grocery', icon: ShoppingCart },
  { href: '/nutrition', label: 'Nutrition', icon: Apple },
  { href: '/favorites', label: 'Favorites', icon: Heart },
  { href: '/history', label: 'History', icon: Clock },
  { href: '/insights', label: 'Insights', icon: BarChart2 },
  { href: '/queue', label: 'Queue', icon: Inbox },
  { href: '/discover', label: 'Discover', icon: Sparkles },
]

// Mobile bottom bar shows the first four as primary tabs; the rest live behind
// the "More" slide-up sheet. The desktop sidebar still renders all of NAV_ITEMS.
const PRIMARY_ITEMS = NAV_ITEMS.slice(0, 4)   // Recipes, Plan, Grocery, Nutrition
const MORE_ITEMS = NAV_ITEMS.slice(4)         // Favorites, History, Insights, Queue, Discover

export default function Navigation() {
  const pathname = usePathname()
  const [showAdd, setShowAdd] = useState(false)
  const [showMore, setShowMore] = useState(false)

  // When the active route lives inside the More sheet, light up the More cell so
  // the user still has an indication of where they are.
  const moreActive = MORE_ITEMS.some(({ href }) => pathname.startsWith(href))

  return (
    <>
      {/* Desktop sidebar */}
      <nav className="hidden md:flex flex-col fixed left-0 top-0 h-full w-56 bg-surface border-r border-border z-40 py-8 px-5">
        {/* Logo */}
        <div className="mb-10">
          <h1 className="font-display text-2xl text-cream font-light tracking-wide">MEA</h1>
          <p className="text-faint text-xs font-body mt-0.5 tracking-widest uppercase">Recipes</p>
        </div>

        {/* Nav links */}
        <div className="flex flex-col gap-1 flex-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group ${
                  active
                    ? 'bg-amber/10 text-amber border border-amber/20'
                    : 'text-muted hover:text-cream hover:bg-card'
                }`}
              >
                <Icon size={16} className={active ? 'text-amber' : 'text-faint group-hover:text-muted'} />
                <span className="text-sm font-body font-medium">{label}</span>
              </Link>
            )
          })}
        </div>

        {/* Add recipe button */}
        <button
          onClick={() => setShowAdd(true)}
          className="btn-primary flex items-center justify-center gap-2 w-full mb-4"
        >
          <Plus size={16} />
          Add Recipe
        </button>

        {/* Auth */}
        <div className="border-t border-border pt-4">
          <AuthButton />
        </div>
      </nav>

      {/* Mobile bottom nav — five cells: four primary tabs + a "More" cell that
          opens the slide-up sheet. The rest of NAV_ITEMS (and Add) live there. */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-surface border-t border-border z-40 flex items-center px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
        {PRIMARY_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex-1 flex flex-col items-center justify-center gap-1 min-h-[52px] rounded-xl transition-all ${
                active ? 'text-amber' : 'text-faint'
              }`}
            >
              <Icon size={22} />
              <span className="text-[10px] font-body leading-none">{label}</span>
            </Link>
          )
        })}
        <button
          onClick={() => setShowMore(true)}
          aria-label="More"
          aria-haspopup="dialog"
          aria-expanded={showMore}
          className={`flex-1 flex flex-col items-center justify-center gap-1 min-h-[52px] rounded-xl transition-all ${
            moreActive || showMore ? 'text-amber' : 'text-faint'
          }`}
        >
          <MoreHorizontal size={22} />
          <span className="text-[10px] font-body leading-none">More</span>
        </button>
      </nav>

      {/* "More" slide-up sheet (mobile-only) — remaining destinations + the Add
          action. Mirrors the LogFoodSheet / plan action-sheet shell. */}
      {showMore && (
        <div className="md:hidden fixed inset-0 z-[95] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="More navigation">
          <div className="absolute inset-0 bg-ink/80 backdrop-blur-sm animate-fade-in" onClick={() => setShowMore(false)} />
          <div className="relative w-full bg-surface border-t border-border rounded-t-3xl max-h-[85vh] flex flex-col overflow-hidden animate-slide-up">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
              <h2 className="font-display text-xl text-cream font-light">More</h2>
              <button
                onClick={() => setShowMore(false)}
                aria-label="Close"
                className="w-9 h-9 rounded-full flex items-center justify-center bg-card border border-border text-faint hover:text-cream transition-all"
              >
                <X size={16} />
              </button>
            </div>

            <div className="overflow-y-auto p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-1.5">
              {MORE_ITEMS.map(({ href, label, icon: Icon }) => {
                const active = pathname.startsWith(href)
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setShowMore(false)}
                    className={`flex items-center gap-3 px-3 min-h-[48px] rounded-xl transition-all ${
                      active
                        ? 'bg-amber/10 text-amber border border-amber/20'
                        : 'text-muted hover:text-cream hover:bg-card border border-transparent'
                    }`}
                  >
                    <Icon size={18} className={active ? 'text-amber' : 'text-faint'} />
                    <span className="text-sm font-body font-medium">{label}</span>
                  </Link>
                )
              })}

              {/* Add recipe — same trigger as the desktop sidebar; closes the sheet
                  then opens AddRecipeModal. Set apart as the create action. */}
              <div className="pt-1.5 mt-1.5 border-t border-border/50">
                <button
                  onClick={() => { setShowMore(false); setShowAdd(true) }}
                  className="flex items-center gap-3 w-full px-3 min-h-[48px] rounded-xl bg-card border border-border text-cream hover:border-amber/30 transition-all"
                >
                  <Plus size={18} className="text-amber shrink-0" />
                  <span className="text-sm font-body font-medium">Add recipe</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAdd && <AddRecipeModal onClose={() => setShowAdd(false)} />}
    </>
  )
}
