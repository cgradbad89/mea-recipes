'use client'

import { memo, useId, useState } from 'react'

type GroceryRecipeReference = Readonly<{
  recipeID: string
  title: string
  href: string
}>

type GroceryRecipeSourcesProps = Readonly<{
  ingredientName: string
  isManual: boolean
  sourceCount: number
  display: Readonly<{
    references: readonly GroceryRecipeReference[]
    unresolvedCount: number
  }>
  catalogState: 'loading' | 'ready' | 'error'
}>

function RecipeSourceLink({ reference, ingredientName, className = '' }: {
  reference: GroceryRecipeReference
  ingredientName: string
  className?: string
}) {
  return (
    <a
      href={reference.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${reference.title} — recipe for ${ingredientName} (opens in a new tab)`}
      title={reference.title}
      className={`block min-w-0 truncate rounded-sm text-amber underline decoration-amber/60 hover:text-amber-glow hover:whitespace-normal hover:break-words focus:whitespace-normal focus:break-words focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber ${className}`}
    >
      {reference.title}
    </a>
  )
}

function GroceryRecipeSources({ ingredientName, isManual, sourceCount, display, catalogState }: GroceryRecipeSourcesProps) {
  const [expanded, setExpanded] = useState(false)
  const disclosureId = useId()
  const { references, unresolvedCount } = display
  const extraCount = Math.max(0, references.length - 2)
  const unavailable = unresolvedCount === 1 ? 'Recipe unavailable' : `${unresolvedCount} recipes unavailable`
  const sourceStatus = catalogState === 'loading'
    ? 'Loading recipes…'
    : catalogState === 'error'
      ? 'Recipe links unavailable'
      : references.length > 0
        ? `+${unresolvedCount} recipe${unresolvedCount === 1 ? '' : 's'} unavailable`
        : unavailable

  return (
    <div
      data-recipe-sources
      role="group"
      aria-label={`Used in recipes for ${ingredientName}`}
      className="hidden lg:flex lg:w-56 xl:w-72 shrink-0 min-w-0 flex-col gap-0.5 font-body text-xs leading-[18px] text-muted"
      onClick={event => event.stopPropagation()}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
      }}
    >
      {sourceCount === 0 ? (
        <span>{isManual ? 'Added manually' : 'No recipe linked'}</span>
      ) : (
        <>
          {isManual && <span>Added manually · linked to</span>}
          {references.length > 0 && (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5">
              <RecipeSourceLink key={references[0].recipeID} reference={references[0]} ingredientName={ingredientName} className="col-span-2" />
              {references[1] && (
                <RecipeSourceLink
                  key={references[1].recipeID}
                  reference={references[1]}
                  ingredientName={ingredientName}
                  className={extraCount === 0 ? 'col-span-2' : ''}
                />
              )}
              {extraCount > 0 && (
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={disclosureId}
                  aria-label={expanded ? `Show fewer recipes for ${ingredientName}` : `Show ${extraCount} more recipe${extraCount === 1 ? '' : 's'} for ${ingredientName}`}
                  onClick={() => setExpanded(value => !value)}
                  className="self-start justify-self-start whitespace-nowrap rounded-sm text-amber hover:text-amber-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
                >
                  {expanded ? 'Show less' : `+${extraCount} more`}
                </button>
              )}
              {extraCount > 0 && (
                <div id={disclosureId} hidden={!expanded} className={`col-span-2 flex-col gap-0.5 ${expanded ? 'flex' : 'hidden'}`}>
                  {expanded && references.slice(2).map(reference => (
                    <RecipeSourceLink key={reference.recipeID} reference={reference} ingredientName={ingredientName} />
                  ))}
                </div>
              )}
            </div>
          )}
          {unresolvedCount > 0 && <span>{sourceStatus}</span>}
        </>
      )}
    </div>
  )
}

// Stable derived display props let unrelated input edits skip hundreds of cells.
export default memo(GroceryRecipeSources)
