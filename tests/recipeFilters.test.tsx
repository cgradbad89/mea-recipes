// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import RecipeFilters from '@/components/RecipeFilters'
import { RECIPE_CATEGORIES, normalizeRecipeCategory } from '@/lib/recipeCategories'

afterEach(cleanup)

function renderFilters() {
  render(
    <RecipeFilters
      search=""
      cuisine={[]}
      category="All"
      minRating={0}
      source="all"
      onSearchChange={vi.fn()}
      onCuisineChange={vi.fn()}
      onCategoryChange={vi.fn()}
      onMinRatingChange={vi.fn()}
      onSourceChange={vi.fn()}
      totalCount={10}
      filteredCount={10}
      isSignedIn
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
}

describe('RecipeFilters canonical categories', () => {
  it('renders All followed by the exact 12 canonical options', () => {
    renderFilters()
    const categoryHeading = screen.getByText('Category')
    const categoryPanel = categoryHeading.parentElement!
    const labels = Array.from(categoryPanel.querySelectorAll('button')).map(button => button.textContent)

    expect(labels).toEqual(['All', ...RECIPE_CATEGORIES])
    expect(labels).not.toContain('Breakfast, Snacks & Sides')
  })

  it('routes aliases, recipe-specific values, and effective overrides to canonical filters', () => {
    expect(normalizeRecipeCategory('Chicken', 'legacy-chicken')).toBe('Chicken & Poultry')
    expect(normalizeRecipeCategory('Soup/Stew', 'legacy-soup')).toBe('Soups, Stews & Chili')
    expect(normalizeRecipeCategory('Breakfast, Snacks & Sides', 'smoothies')).toBe('Drinks')
    // The pages pass the already-loaded override as the chosen raw value.
    expect(normalizeRecipeCategory('Salads & Bowls', 'spicy-quinoa-with-sweet-potatoes'))
      .toBe('Salads & Bowls')
  })
})
