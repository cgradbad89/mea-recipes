'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UtensilsCrossed, Calendar, ShoppingCart, Heart, Plus, Clock, BarChart2, Inbox, Sparkles } from 'lucide-react'
import { useState } from 'react'
import AddRecipeModal from './AddRecipeModal'
import AuthButton from './AuthButton'
import HubBanner from './HubBanner'

const NAV_ITEMS = [
  { href: '/recipes', label: 'Recipes', icon: UtensilsCrossed },
  { href: '/plan', label: 'Plan', icon: Calendar },
  { href: '/grocery', label: 'Grocery', icon: ShoppingCart },
  { href: '/favorites', label: 'Favorites', icon: Heart },
  { href: '/history', label: 'History', icon: Clock },
  { href: '/insights', label: 'Insights', icon: BarChart2 },
  { href: '/queue', label: 'Queue', icon: Inbox },
  { href: '/discover', label: 'Discover', icon: Sparkles },
]

export default function Navigation() {
  const pathname = usePathname()
  const [showAdd, setShowAdd] = useState(false)

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

        {/* Hub link */}
        <a
          href="https://my-hub-drab.vercel.app"
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-muted hover:text-cream hover:bg-card transition-all duration-200 group mt-2"
        >
          <span className="text-faint group-hover:text-muted text-sm leading-none">←</span>
          <span className="text-sm font-body font-medium">My Apps</span>
        </a>
      </nav>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-surface border-t border-border z-40 flex items-center px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[44px] rounded-xl transition-all ${
                active ? 'text-amber' : 'text-faint'
              }`}
            >
              <Icon size={20} />
              <span className="text-[9px] font-body leading-none">{label}</span>
            </Link>
          )
        })}
        <button
          onClick={() => setShowAdd(true)}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-faint hover:text-cream transition-colors"
        >
          <Plus size={20} />
          <span className="text-[9px] font-body leading-none">Add</span>
        </button>
      </nav>

      {showAdd && <AddRecipeModal onClose={() => setShowAdd(false)} />}
    </>
  )
}
