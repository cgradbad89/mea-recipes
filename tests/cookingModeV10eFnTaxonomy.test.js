import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  aggregateByClass,
  aggregateSeverity,
  assertExactFnPopulation,
  assertTaxonomyCompleteness,
  buildFnPopulation,
  classifyCandidate,
  classifyFnPopulation,
  componentKeyOverlap,
  componentMembershipEvidence,
  dominantClasses,
  EXPECTED_FN_POPULATION,
  historicalFpCollisionRisks,
  HISTORICAL_FP_COLLISION_MAP,
  implementationSignalCandidates,
  reviewerVoteLabel,
  SEMANTIC_TAXONOMY,
  severityForRow,
} from '../scripts/analyze-cooking-mode-v10e-fn-taxonomy-core.mjs'

const v10dPath = path.resolve('docs/audits/cooking-mode-v10d-principal-target-analysis-2026-08-28.json')
const frozenPath = path.resolve('docs/audits/cooking-mode-arbiter-v10a-frozen-candidates-2026-08-28.json')
const v10dData = JSON.parse(fs.readFileSync(v10dPath, 'utf8'))
const frozenData = JSON.parse(fs.readFileSync(frozenPath, 'utf8'))

// --- fixtures for isolated unit tests (do not depend on the real locked artifacts) ---

function frozenRecord(overrides = {}) {
  return {
    candidateId: 'ingredient::r1::1::0',
    candidateType: 'INGREDIENT_RELATIONSHIP',
    recipeId: 'r1',
    title: 'Fixture Recipe',
    instructionIndex: 1,
    ingredientIndex: 0,
    origins: ['REVIEWER_A', 'REVIEWER_B'],
    provenanceClass: '2_OF_2_REVIEWERS',
    ingredientText: '- 1 cup rice',
    instructionText: '2. Cover and cook on low for 6 hours',
    nextInstructionText: '3. Serve hot',
    relevantSurroundingSource: { relatedIngredientRows: [{ ingredientIndex: 0, text: '- 1 cup rice', group: null, header: false }] },
    adjudicatedTruth: 'CORRECT',
    ...overrides,
  }
}

function fixtureData(basis = 'CONTEXT_ONLY', componentMemberships = []) {
  return {
    finalErrors: {
      falseRejects: [{
        candidateId: 'ingredient::r1::1::0',
        state: { v10c: { componentMembership: { memberships: componentMemberships } }, componentMembership: { memberships: componentMemberships } },
        decision: { candidateId: 'ingredient::r1::1::0', decision: 'REJECT', basis, evidenceText: 'fixture' },
      }],
    },
  }
}

function fixtureFrozen(overrides = {}) {
  return { populations: { INGREDIENT_RELATIONSHIPS: [frozenRecord(overrides)], PREPARED_COMPONENT_RELATIONSHIPS: [] } }
}

describe('buildFnPopulation', () => {
  it('joins finalErrors.falseRejects against frozen-candidate evidence and asserts the count', () => {
    const rows = buildFnPopulation(fixtureData(), fixtureFrozen())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      candidateId: 'ingredient::r1::1::0',
      recipeId: 'r1',
      title: 'Fixture Recipe',
      ingredientText: '- 1 cup rice',
      instructionText: '2. Cover and cook on low for 6 hours',
      nextInstructionText: '3. Serve hot',
      reviewerA: true,
      reviewerB: true,
      deterministicOrigin: '2_OF_2_REVIEWERS',
      benchmarkTruth: 'CORRECT',
    })
  })

  it('derives previousInstructionText from another candidate at instructionIndex - 1 in the same recipe', () => {
    const frozen = {
      populations: {
        INGREDIENT_RELATIONSHIPS: [
          frozenRecord({ candidateId: 'ingredient::r1::0::5', instructionIndex: 0, ingredientIndex: 5, instructionText: '1. Load everything into the pot' }),
          frozenRecord(),
        ],
        PREPARED_COMPONENT_RELATIONSHIPS: [],
      },
    }
    const rows = buildFnPopulation(fixtureData(), frozen)
    expect(rows[0].previousInstructionText).toBe('1. Load everything into the pot')
  })

  it('assertExactFnPopulation throws when the reconstructed population is not exactly 191', () => {
    expect(() => assertExactFnPopulation([])).toThrow(/Expected exactly 191/)
    const rows = buildFnPopulation(fixtureData(), fixtureFrozen())
    expect(() => assertExactFnPopulation(rows)).toThrow(/Expected exactly 191/) // fixture has 1 row, not 191
  })

  it('throws if a falseRejects candidateId has no matching frozen-candidate evidence', () => {
    const data = fixtureData()
    data.finalErrors.falseRejects[0].candidateId = 'ingredient::missing::9::9'
    expect(() => buildFnPopulation(data, fixtureFrozen())).toThrow(/no matching frozen-candidate evidence/)
  })
})

describe('classifyCandidate', () => {
  it('classifies reserved-language rows as DIVIDED_OR_RESERVED_USE', () => {
    const result = classifyCandidate({ ingredientText: 'The reserved broth from the cooked chicken.', instructionText: 'Add the reserved broth to the pot.' })
    expect(result.semanticClass).toBe('DIVIDED_OR_RESERVED_USE')
  })

  it('classifies bare whole-dish verbs as DISH_STATE_CONTINUATION', () => {
    const result = classifyCandidate({ ingredientText: '- 1 cup rice', instructionText: 'Cover and cook on low for 6 hours.' })
    expect(result.semanticClass).toBe('DISH_STATE_CONTINUATION')
  })

  it('classifies pronoun/deictic language as PRONOUN_OR_DEICTIC_REFERENCE', () => {
    const result = classifyCandidate({ ingredientText: '- 1 cup rice', instructionText: 'Once everything is in the pot, bring to a boil.' })
    expect(result.semanticClass).toBe('PRONOUN_OR_DEICTIC_REFERENCE')
  })

  it('classifies collective category nouns as CATEGORY_OR_COLLECTIVE_ALIAS', () => {
    const result = classifyCandidate({ ingredientText: '- 1 onion', instructionText: 'Roast until the vegetables are tender.' })
    expect(result.semanticClass).toBe('CATEGORY_OR_COLLECTIVE_ALIAS')
  })

  it('classifies serve/garnish openers as SERVING_OR_GARNISH_ACTION', () => {
    const result = classifyCandidate({ ingredientText: '- fresh basil', instructionText: 'Serve with tortillas and desired toppings.' })
    expect(result.semanticClass).toBe('SERVING_OR_GARNISH_ACTION')
  })

  it('prefers a coating/dredging signal over an unrelated tail garnish clause in a compound instruction', () => {
    const result = classifyCandidate({
      ingredientText: '- 1/2 cup cornstarch',
      instructionText: 'Coat each piece in the dry flour mix. Fry until golden and sprinkle with a little more salt.',
    })
    expect(result.semanticClass).toBe('MULTI_COMPONENT_ASSEMBLY')
    expect(result.semanticSubClass).toBe('DREDGE_OR_COAT_INTO_PREPARED_MIX')
  })

  it('falls through unmatched rows to OTHER_SPECIFIC rather than mis-forcing a class', () => {
    const result = classifyCandidate({ ingredientText: '- garnish', instructionText: 'xyz unrecognizable placeholder text 123' })
    expect(result.semanticClass).toBe('OTHER_SPECIFIC')
  })

  it('falls CONSUMED_OR_UNAVAILABLE-basis rows with no other signal to SOURCE_PARSER_ADJUDICATION_EDGE', () => {
    const result = classifyCandidate({ ingredientText: '- mystery item', instructionText: 'xyz unrecognizable placeholder text 123', v10dBasis: 'CONSUMED_OR_UNAVAILABLE' })
    expect(result.semanticClass).toBe('SOURCE_PARSER_ADJUDICATION_EDGE')
  })
})

describe('reviewerVoteLabel', () => {
  it('labels both/one/neither reviewer agreement correctly', () => {
    expect(reviewerVoteLabel({ reviewerA: true, reviewerB: true })).toBe('2_OF_2')
    expect(reviewerVoteLabel({ reviewerA: true, reviewerB: false })).toBe('1_OF_2')
    expect(reviewerVoteLabel({ reviewerA: false, reviewerB: true })).toBe('1_OF_2')
    expect(reviewerVoteLabel({ reviewerA: false, reviewerB: false })).toBe('0_OF_2')
  })
})

describe('historicalFpCollisionRisks / implementationSignalCandidates', () => {
  it('returns a named collision family for every real semantic class', () => {
    for (const cls of SEMANTIC_TAXONOMY) {
      expect(HISTORICAL_FP_COLLISION_MAP).toHaveProperty(cls)
    }
  })

  it('returns no collision risk for the fallback classes', () => {
    expect(historicalFpCollisionRisks('SOURCE_PARSER_ADJUDICATION_EDGE')).toEqual([])
    expect(historicalFpCollisionRisks('OTHER_SPECIFIC')).toEqual([])
  })

  it('returns at least one implementation-signal candidate for every real detection class', () => {
    for (const cls of SEMANTIC_TAXONOMY) {
      if (cls === 'SOURCE_PARSER_ADJUDICATION_EDGE' || cls === 'OTHER_SPECIFIC') continue
      expect(implementationSignalCandidates(cls).length).toBeGreaterThan(0)
    }
  })
})

describe('severityForRow', () => {
  it('ranks 2/2-reviewer dominant-class rows as CRITICAL and 0/2 rows as LOW', () => {
    const dominant = ['DISH_STATE_CONTINUATION']
    expect(severityForRow({ reviewerA: true, reviewerB: true }, { semanticClass: 'DISH_STATE_CONTINUATION' }, dominant)).toBe('CRITICAL')
    expect(severityForRow({ reviewerA: true, reviewerB: true }, { semanticClass: 'OTHER_SPECIFIC' }, dominant)).toBe('HIGH')
    expect(severityForRow({ reviewerA: true, reviewerB: false }, { semanticClass: 'OTHER_SPECIFIC' }, dominant)).toBe('MEDIUM')
    expect(severityForRow({ reviewerA: false, reviewerB: false }, { semanticClass: 'OTHER_SPECIFIC' }, dominant)).toBe('LOW')
  })
})

describe('this script has no production write path', () => {
  const noProductionAccessRe = /from ['"]firebase-admin|require\(['"]firebase-admin|getFirestore\(|initializeApp\(|\bfetch\(|node-fetch/i

  it('the core module imports no Firestore/admin/network module', () => {
    const source = fs.readFileSync(path.resolve('scripts/analyze-cooking-mode-v10e-fn-taxonomy-core.mjs'), 'utf8')
    expect(source).not.toMatch(noProductionAccessRe)
  })

  it('the driver script imports no Firestore/admin/network module and only writes the two new local audit outputs', () => {
    const source = fs.readFileSync(path.resolve('scripts/analyze-cooking-mode-v10e-fn-taxonomy.mjs'), 'utf8')
    expect(source).not.toMatch(noProductionAccessRe)
    const writeCalls = [...source.matchAll(/writeFileSync\((\w+)/g)].map(m => m[1])
    expect(new Set(writeCalls)).toEqual(new Set(['jsonPath', 'markdownPath']))
  })
})

// --- integration tests against the real, locked V10D + V10A artifacts ---

describe('Cooking Mode V10E false-negative reconstruction (locked artifacts)', () => {
  it('reconstructs exactly EXPECTED_FN_POPULATION rows', () => {
    expect(EXPECTED_FN_POPULATION).toBe(191)
    const rows = buildFnPopulation(v10dData, frozenData)
    expect(rows).toHaveLength(191)
  })

  it('classifies every row with no gaps and no unknown semantic class', () => {
    const rows = buildFnPopulation(v10dData, frozenData)
    const classifications = classifyFnPopulation(rows)
    expect(() => assertTaxonomyCompleteness(rows, classifications)).not.toThrow()
    for (const c of classifications) {
      expect(SEMANTIC_TAXONOMY).toContain(c.semanticClass)
    }
  })

  it('leaves zero rows in OTHER_SPECIFIC and zero in SOURCE_PARSER_ADJUDICATION_EDGE for this locked population', () => {
    const rows = buildFnPopulation(v10dData, frozenData)
    const classifications = classifyFnPopulation(rows)
    const other = classifications.filter(c => c.semanticClass === 'OTHER_SPECIFIC')
    const edge = classifications.filter(c => c.semanticClass === 'SOURCE_PARSER_ADJUDICATION_EDGE')
    expect(other).toHaveLength(0)
    expect(edge).toHaveLength(0)
  })

  it('sums per-class counts back to exactly 191', () => {
    const rows = buildFnPopulation(v10dData, frozenData)
    const classifications = classifyFnPopulation(rows)
    const byClass = aggregateByClass(rows, classifications)
    const sum = byClass.reduce((acc, g) => acc + g.fnCount, 0)
    expect(sum).toBe(191)
  })

  it('aggregates reviewer votes per class consistent with the raw reviewerA/reviewerB fields', () => {
    const rows = buildFnPopulation(v10dData, frozenData)
    const classifications = classifyFnPopulation(rows)
    const byId = new Map(classifications.map(c => [c.candidateId, c]))
    const byClass = aggregateByClass(rows, classifications)
    for (const group of byClass) {
      const classRows = rows.filter(r => byId.get(r.candidateId).semanticClass === group.semanticClass)
      const expected2of2 = classRows.filter(r => r.reviewerA && r.reviewerB).length
      const expected1of2 = classRows.filter(r => (r.reviewerA || r.reviewerB) && !(r.reviewerA && r.reviewerB)).length
      expect(group.reviewerVotes['2_OF_2']).toBe(expected2of2)
      expect(group.reviewerVotes['1_OF_2']).toBe(expected1of2)
      expect(group.fnCount).toBe(classRows.length)
    }
  })

  it('finds the dominant class is DISH_STATE_CONTINUATION and the top 3 explain most of the 191', () => {
    const rows = buildFnPopulation(v10dData, frozenData)
    const classifications = classifyFnPopulation(rows)
    const byClass = aggregateByClass(rows, classifications)
    expect(byClass[0].semanticClass).toBe('DISH_STATE_CONTINUATION')
    const top3 = byClass.slice(0, 3).reduce((acc, g) => acc + g.fnCount, 0)
    expect(top3).toBeGreaterThan(191 * 0.5)
  })

  it('finds component-membership overlap between the FN population and the locked historicalRegression FP-risk population', () => {
    const rows = buildFnPopulation(v10dData, frozenData)
    const overlap = componentKeyOverlap(rows, v10dData.historicalRegression?.outcomes || [])
    // This is the core benchmark-policy-vs-heuristic finding of the V10E pass: componentKey
    // identity alone cannot separate correct-continuation rows from FP-risk rows.
    expect(overlap.length).toBeGreaterThan(0)
  })

  it('shows the dominant class is not cleanly separable by a flat "zero prior component membership" gate', () => {
    const rows = buildFnPopulation(v10dData, frozenData)
    const classifications = classifyFnPopulation(rows)
    const evidence = componentMembershipEvidence(rows, classifications)
    const dishState = evidence.find(g => g.semanticClass === 'DISH_STATE_CONTINUATION')
    expect(dishState.withComponentMembership).toBeGreaterThan(0)
    expect(dishState.withComponentMembership).toBeLessThan(dishState.total)
  })

  it('computes severity distribution that sums to 191', () => {
    const rows = buildFnPopulation(v10dData, frozenData)
    const classifications = classifyFnPopulation(rows)
    const dominant = dominantClasses(rows, classifications, 3)
    const severity = aggregateSeverity(rows, classifications, dominant)
    const sum = Object.values(severity).reduce((a, b) => a + b, 0)
    expect(sum).toBe(191)
  })
})
