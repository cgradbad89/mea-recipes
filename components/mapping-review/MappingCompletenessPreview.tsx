'use client'

import { useMemo, useState } from 'react'
import { Grid3x3, List, X } from 'lucide-react'
import { isIngredientSubheader } from '@/lib/recipeContent'
import MappingAddRelationshipPicker from './MappingAddRelationshipPicker'
import type { PersistedMappingCandidateV1 } from '@/types/cookingModeMappingPersistence'

type ProvenanceClass = 'AUTO_ACCEPT' | 'HUMAN_REVIEW_ACCEPT' | 'HUMAN_ADDED'

function classify(candidate: PersistedMappingCandidateV1): ProvenanceClass {
  if (candidate.provenance.candidateOrigin === 'HUMAN_ADDED') return 'HUMAN_ADDED'
  return candidate.decisionSource === 'HUMAN' ? 'HUMAN_REVIEW_ACCEPT' : 'AUTO_ACCEPT'
}

const PROVENANCE_LABEL: Record<ProvenanceClass, string> = {
  AUTO_ACCEPT: 'Auto-resolved',
  HUMAN_REVIEW_ACCEPT: 'From your review',
  HUMAN_ADDED: 'Added by you',
}

export interface MappingCompletenessPreviewProps {
  ingredients: string[]
  instructions: string[]
  candidates: PersistedMappingCandidateV1[]
  busyKey: string | null
  errorByKey: Record<string, string>
  onAddRelationship: (stepIndex: number, ingredientRowIndex: number) => void | Promise<void>
  onRemoveRelationship: (candidateId: string) => void | Promise<void>
}

/**
 * The complete-map review (design §7.3, Phase 14). Every accepted
 * relationship — AUTO_ACCEPT, human-reviewed ACCEPT, and human-added — is
 * shown, organized by instruction step, matching Cooking Mode's own visual
 * language. This is the recall-safety screen: it never limits itself to
 * previously-uncertain candidates.
 */
export default function MappingCompletenessPreview({
  ingredients, instructions, candidates, busyKey, errorByKey, onAddRelationship, onRemoveRelationship,
}: MappingCompletenessPreviewProps) {
  const [showGrid, setShowGrid] = useState(false)

  const accepted = useMemo(() => candidates.filter(c => c.finalDecision === 'ACCEPT'), [candidates])

  const byStep = useMemo(() => {
    const map = new Map<number, PersistedMappingCandidateV1[]>()
    for (const candidate of accepted) {
      const list = map.get(candidate.stepIndex) ?? []
      list.push(candidate)
      map.set(candidate.stepIndex, list)
    }
    return map
  }, [accepted])

  const nonHeaderIngredients = useMemo(
    () => ingredients.map((text, index) => [index, text] as [number, string]).filter(([, text]) => !isIngredientSubheader(text)),
    [ingredients],
  )

  return (
    <div>
      <div className="hidden md:flex items-center justify-end gap-2 mb-4">
        <button
          type="button"
          onClick={() => setShowGrid(v => !v)}
          aria-pressed={showGrid}
          className="inline-flex items-center gap-1.5 text-xs font-body text-faint hover:text-cream"
        >
          {showGrid ? <List size={13} aria-hidden="true" /> : <Grid3x3 size={13} aria-hidden="true" />}
          {showGrid ? 'Show as steps' : 'Show as grid'}
        </button>
      </div>

      {showGrid ? (
        <div className="hidden md:block overflow-x-auto border border-border rounded-xl">
          <table className="text-xs font-body">
            <thead>
              <tr>
                <th className="sticky left-0 bg-surface text-left p-2 text-faint">Ingredient</th>
                {instructions.map((_, stepIndex) => (
                  <th key={stepIndex} className="p-2 text-faint text-center min-w-[2.5rem]">{stepIndex + 1}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {nonHeaderIngredients.map(([rowIndex, text]) => (
                <tr key={rowIndex} className="border-t border-border">
                  <td className="sticky left-0 bg-surface p-2 text-cream max-w-[16rem] truncate">{text}</td>
                  {instructions.map((_, stepIndex) => {
                    const match = accepted.find(c => c.ingredientRowIndex === rowIndex && c.stepIndex === stepIndex)
                    return (
                      <td key={stepIndex} className="p-2 text-center" title={match ? PROVENANCE_LABEL[classify(match)] : undefined}>
                        {match ? (
                          <span className={`inline-block w-2 h-2 rounded-full ${classify(match) === 'AUTO_ACCEPT' ? 'bg-amber/40' : 'bg-amber'}`} aria-label={match ? PROVENANCE_LABEL[classify(match)] : undefined} />
                        ) : null}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ol className="space-y-4">
          {instructions.map((instruction, stepIndex) => {
            const stepCandidates = byStep.get(stepIndex) ?? []
            const mappedIndexes = new Set(stepCandidates.map(c => c.ingredientRowIndex))
            const available = nonHeaderIngredients.filter(([index]) => !mappedIndexes.has(index))
            const addKey = `add-${stepIndex}`
            return (
              <li key={stepIndex} className="bg-card border border-border rounded-2xl p-4">
                <div className="flex gap-3">
                  <span className="font-display text-xl text-amber/70 font-light w-6 shrink-0">{stepIndex + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-body text-cream leading-relaxed mb-2">{instruction}</p>
                    {stepCandidates.length > 0 && (
                      <ul className="flex flex-wrap gap-1.5 mb-1">
                        {stepCandidates.map(candidate => {
                          const provenance = classify(candidate)
                          return (
                            <li key={candidate.candidateId}>
                              <span
                                className={`inline-flex items-center gap-1.5 text-xs font-body px-2.5 py-1 rounded-lg border ${
                                  provenance === 'AUTO_ACCEPT'
                                    ? 'bg-surface border-border text-muted'
                                    : 'bg-amber/10 border-amber/20 text-amber'
                                }`}
                                title={PROVENANCE_LABEL[provenance]}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${provenance === 'AUTO_ACCEPT' ? 'border border-faint' : 'bg-amber'}`}
                                  aria-hidden="true"
                                />
                                {candidate.ingredientText}
                                {provenance === 'HUMAN_ADDED' && (
                                  <button
                                    type="button"
                                    aria-label={`Remove ${candidate.ingredientText} from step ${stepIndex + 1}`}
                                    disabled={busyKey === candidate.candidateId}
                                    onClick={() => void onRemoveRelationship(candidate.candidateId)}
                                    className="text-amber/70 hover:text-amber"
                                  >
                                    <X size={11} aria-hidden="true" />
                                  </button>
                                )}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                    <MappingAddRelationshipPicker
                      availableIngredients={available}
                      busy={busyKey === addKey}
                      error={errorByKey[addKey] ?? null}
                      onAdd={ingredientRowIndex => onAddRelationship(stepIndex, ingredientRowIndex)}
                    />
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
