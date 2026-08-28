/**
 * Pure, read-only functions for the V10E false-negative semantic taxonomy discovery pass.
 *
 * Reconstructs the exact 191-candidate V10D false-negative population from the locked
 * V10D analysis artifact + the locked V10A frozen-candidate evidence artifact, then applies
 * a deterministic, source-grounded semantic classifier (NOT the old broad V10C taxonomy).
 *
 * No network calls, no Firestore, no writes to production paths. Every export here is a
 * pure function of its inputs so it can be unit tested without touching the filesystem.
 */

export const EXPECTED_FN_POPULATION = 191

/** The 11 new semantic classes (taxonomy classes A-K from the discovery prompt, renamed to
 *  stable machine-readable identifiers). Order here is priority order used by classifyCandidate:
 *  earlier entries are checked first, so a row that matches more than one signal is bucketed
 *  under the most specific applicable class rather than the most generic one. */
export const SEMANTIC_TAXONOMY = [
  'DIVIDED_OR_RESERVED_USE',
  'SERVING_OR_GARNISH_ACTION',
  'TRANSFER_OR_ASSEMBLY_TARGET',
  'MULTI_COMPONENT_ASSEMBLY',
  'PRONOUN_OR_DEICTIC_REFERENCE',
  'CATEGORY_OR_COLLECTIVE_ALIAS',
  'CONTINUING_COOKING_OBJECT',
  'COLLECTION_ACTIVE_CONTINUATION',
  'DISH_STATE_CONTINUATION',
  'IMPLIED_SEASONING_OR_FINISHING',
  'SOURCE_PARSER_ADJUDICATION_EDGE',
  'OTHER_SPECIFIC',
]

// ---- signal word lists (documented, source-observable) ---------------------------------

const RESERVED_RE = /\breserved\b/i
const SET_ASIDE_FOR_RE = /\bset\s+aside\b.{0,25}\bfor\b/i

const SERVE_GARNISH_RE = /\b(serve|serving)\b.{0,20}\bwith\b|\bgarnish(ed)?\s+with\b|\btop(ped)?\s+with\b|\bsprinkle(d)?\s+(over|on top|with)\b|\bdrizzle(d)?\s+(over|with)\b|\bput\s+out\b.{0,20}\btoppings?\b|\bset\s+the\s+table\b/i
const SERVE_START_RE = /^(serve|garnish|sprinkle|drizzle)\b/i

const TRANSFER_RE = /\btransfer(red)?\s+to\b|\blayer(ed)?\s+in\b|\bfill(ed)?\s+the\b|\broll(ed)?\s+up\b|\bfold(ed)?\s+in(to)?\b|\bplate(d)?\b|\bassemble\b|\bstuff(ed)?\b|\bdivide(d)?\s+(among|between)\b/i

const MULTI_COMPONENT_RE = /\bcombine\b|\breturn\s+(it\s+|them\s+)?to\s+(the\s+)?(soup|sauce|pot|pan|bowl|dish)\b|\badd\s+.{0,25}\bto\s+the\s+(soup|sauce|pot|pan|pasta|bowl|dish)\b|\btoss\s+.{0,15}\bwith\b/i

const PRONOUN_RE = /\beverything\b|\bmixture\b|\bboth\b|\ball\s+of\s+(it|them)\b|\ball\s+the\s+ingredients\b|\bit\b|\bthem\b|\bthese\b|\bthis\b/i

const CATEGORY_ALIAS_WORDS = ['vegetables', 'veggies', 'aromatics', 'spices', 'herbs', 'greens', 'meat', 'seafood', 'cheese']
const CATEGORY_ALIAS_RE = new RegExp(`\\b(${CATEGORY_ALIAS_WORDS.join('|')})\\b`, 'i')

const CONTINUING_OBJECT_RE = /\bflip\b|\bturn(ed)?\b|\buncover\b|\bshake\b|\brotate\b|\bbaste(d)?\b|\brepeat\b|\bbrown(ed)?\s+(on\s+)?(all|both)\s+sides\b|\binternal\s+temperature\b|\breaches?\s+\d+.{0,5}(°|degrees)\b|\bcooked\s+through\b|\bno\s+longer\s+pink\b/i

const COLLECTION_ACTIVE_RE = /\bstir\b|\btoss\b|\bmix\s+well\b|\bmix\s+(it\s+)?together\b|\bcombine\s+well\b|\ball\s+your\s+ingredients\b/i

const DISH_STATE_RE = /\bsimmer\b|\bcover\s+and\s+cook\b|\bcook\s+on\s+(low|high)\b|\bcontinue\s+cooking\b|\bbake\b|\broast\b|\bboil\b|\breduce\s+heat\b|\brest\b|\bchill\b|\brefrigerate\b|\bcook\s+for\b|\bplace\s+in\s+the\s+oven\b|\bgrill\s+for\b/i

const FINISHING_RE = /\bseason\s+the\b|\badjust\s+(as\s+needed|seasoning)\b|\bfinish\s+with\b|\bmore\s+if\s+desired\b|\bto\s+taste\b/i

// Checked ahead of SERVING_OR_GARNISH_ACTION so a compound frying/breading instruction whose
// *tail* clause happens to mention an unrelated "sprinkle with salt" garnish doesn't steal a
// dredge-component row (e.g. cornstarch, baking powder, seasoning mix "coated" onto chicken).
const COATING_RE = /\bcoat(ed)?\s+(each|the)?\s*(piece|pieces)?\s*in\b|\bdredge\b|\bbreading\b|\bdry\s+(flour\s+)?mix\b/i

/** Returns { semanticClass, semanticSubClass, signal, antecedentType, activeObjectType } */
export function classifyCandidate(row) {
  const cur = row.instructionText || ''
  const ing = row.ingredientText || ''

  if (RESERVED_RE.test(ing) || RESERVED_RE.test(cur) || SET_ASIDE_FOR_RE.test(cur)) {
    return {
      semanticClass: 'DIVIDED_OR_RESERVED_USE',
      semanticSubClass: RESERVED_RE.test(ing) ? 'ROW_EXPLICITLY_LABELED_RESERVED' : 'SET_ASIDE_LANGUAGE_IN_INSTRUCTION',
      signal: 'reserved/set-aside wording',
      antecedentType: 'NAMED_LIST',
      activeObjectType: 'RAW_INGREDIENT',
    }
  }

  if (COATING_RE.test(cur)) {
    return {
      semanticClass: 'MULTI_COMPONENT_ASSEMBLY',
      semanticSubClass: 'DREDGE_OR_COAT_INTO_PREPARED_MIX',
      signal: 'coat/dredge-into-mix phrasing combining a prepared dry-mix component with another named piece',
      antecedentType: 'SPECIFIC_OBJECT',
      activeObjectType: 'PREPARED_COMPONENT',
    }
  }

  if (SERVE_START_RE.test(cur.trim()) || SERVE_GARNISH_RE.test(cur)) {
    return {
      semanticClass: 'SERVING_OR_GARNISH_ACTION',
      semanticSubClass: SERVE_START_RE.test(cur.trim()) ? 'IMPERATIVE_SERVE_OPENER' : 'SERVE_OR_GARNISH_WITH_CLAUSE',
      signal: 'serve/garnish/top/sprinkle/drizzle phrasing',
      antecedentType: 'NAMED_LIST',
      activeObjectType: 'FINAL_DISH',
    }
  }

  if (TRANSFER_RE.test(cur)) {
    return {
      semanticClass: 'TRANSFER_OR_ASSEMBLY_TARGET',
      semanticSubClass: 'TRANSFER_LAYER_FILL_ROLL_FOLD_PLATE_ASSEMBLE',
      signal: 'transfer/layer/fill/roll/fold/plate/assemble/stuff/divide-among phrasing',
      antecedentType: 'NAMED_LIST',
      activeObjectType: 'PREPARED_COMPONENT',
    }
  }

  if (MULTI_COMPONENT_RE.test(cur)) {
    return {
      semanticClass: 'MULTI_COMPONENT_ASSEMBLY',
      semanticSubClass: 'COMBINE_OR_RETURN_TO_NAMED_COMPONENT',
      signal: 'combine/return-to/add-to-named-component phrasing',
      antecedentType: 'SPECIFIC_OBJECT',
      activeObjectType: 'PREPARED_COMPONENT',
    }
  }

  if (PRONOUN_RE.test(cur)) {
    return {
      semanticClass: 'PRONOUN_OR_DEICTIC_REFERENCE',
      semanticSubClass: /\beverything\b|\ball\s+of\s+(it|them)\b|\ball\s+the\s+ingredients\b/i.test(cur) ? 'EVERYTHING_OR_ALL' : 'MIXTURE_IT_THEM_THIS_THESE',
      signal: 'pronoun/deictic word (everything/mixture/both/it/them/this/these) resolvable from chronology',
      antecedentType: 'PRONOUN',
      activeObjectType: 'ASSEMBLED_MIXTURE',
    }
  }

  if (CATEGORY_ALIAS_RE.test(cur)) {
    return {
      semanticClass: 'CATEGORY_OR_COLLECTIVE_ALIAS',
      semanticSubClass: `COLLECTIVE_NOUN:${(cur.match(CATEGORY_ALIAS_RE) || [''])[0].toLowerCase()}`,
      signal: 'collective category noun (vegetables/aromatics/spices/herbs/greens/meat/seafood/cheese)',
      antecedentType: 'COLLECTIVE_NOUN',
      activeObjectType: 'RAW_INGREDIENT',
    }
  }

  if (CONTINUING_OBJECT_RE.test(cur)) {
    const isDonenessCheck = /\binternal\s+temperature\b|\breaches?\s+\d+.{0,5}(°|degrees)\b|\bcooked\s+through\b|\bno\s+longer\s+pink\b/i.test(cur)
    return {
      semanticClass: 'CONTINUING_COOKING_OBJECT',
      semanticSubClass: isDonenessCheck ? 'DONENESS_CHECK_ON_NAMED_OBJECT' : 'FLIP_TURN_UNCOVER_SHAKE_ROTATE_BASTE_REPEAT',
      signal: isDonenessCheck
        ? 'doneness/temperature check on a specific previously-introduced object without renaming it'
        : 'manipulation verb continuing a specific previously-introduced object without renaming it',
      antecedentType: 'SPECIFIC_OBJECT',
      activeObjectType: 'ACTIVE_COOKING_OBJECT',
    }
  }

  if (COLLECTION_ACTIVE_RE.test(cur)) {
    return {
      semanticClass: 'COLLECTION_ACTIVE_CONTINUATION',
      semanticSubClass: 'STIR_TOSS_MIX_TOGETHER',
      signal: 'explicit active-manipulation verb on the assembled set (stir/toss/mix well/mix together/combine well)',
      antecedentType: 'IMPLICIT_WHOLE_DISH',
      activeObjectType: 'ASSEMBLED_MIXTURE',
    }
  }

  if (DISH_STATE_RE.test(cur)) {
    return {
      semanticClass: 'DISH_STATE_CONTINUATION',
      semanticSubClass: 'BARE_WHOLE_DISH_CONTINUATION_VERB',
      signal: 'bare passive whole-dish verb (simmer/cover and cook/bake/roast/boil/rest/chill/refrigerate) with no named collection or single object',
      antecedentType: 'IMPLICIT_WHOLE_DISH',
      activeObjectType: 'ASSEMBLED_MIXTURE',
    }
  }

  if (FINISHING_RE.test(cur)) {
    return {
      semanticClass: 'IMPLIED_SEASONING_OR_FINISHING',
      semanticSubClass: 'SCOPED_FINISH_OR_ADJUST',
      signal: 'finishing/adjusting phrase with a scoping cue distinct from bare "season to taste"',
      antecedentType: 'IMPLICIT_WHOLE_DISH',
      activeObjectType: 'ASSEMBLED_MIXTURE',
    }
  }

  if (row.v10dBasis === 'CONSUMED_OR_UNAVAILABLE') {
    return {
      semanticClass: 'SOURCE_PARSER_ADJUDICATION_EDGE',
      semanticSubClass: 'CONSUMED_OR_UNAVAILABLE_UNRESOLVED',
      signal: 'V10D marked the row consumed/unavailable but no other source signal explains the benchmark-correct label',
      antecedentType: 'NONE',
      activeObjectType: null,
    }
  }

  return {
    semanticClass: 'OTHER_SPECIFIC',
    semanticSubClass: 'UNMATCHED_BY_DOCUMENTED_SIGNALS',
    signal: 'no documented regex signal matched; requires individual review',
    antecedentType: 'NONE',
    activeObjectType: null,
  }
}

/** Historical false-positive collision families, keyed by rootCause values observed in the
 *  locked V10D historicalRegression/targetFalsePositiveOutcomes evidence. */
const FP_ROOT_CAUSES = {
  COMPONENT_LEAKAGE: 'COMPONENT_LEAKAGE (11/20 locked target-FP protections): a row already folded into an assembled component (e.g. "assembled pork chop casserole") gets re-activated by a later whole-dish or collection verb.',
  CONTEXTUAL_MENTION: 'CONTEXTUAL_MENTION (4/20 locked target-FP protections): a row is named in passing (e.g. inside a serving suggestion) without being the actual manipulation target.',
  CONSUMED_ROW: 'CONSUMED_ROW (4/20 locked target-FP protections): a row already fully incorporated/transformed by an earlier instruction gets treated as still separately actionable.',
  PROCESS_MATERIAL: 'PROCESS_MATERIAL (1/20 locked target-FP protections): a non-eaten process material (e.g. soaked skewers) gets carried forward as if it were an active ingredient.',
}

/** Maps each semantic class to the historical FP root-cause families it would put at risk if
 *  turned into a detection rule, per Phase 7 of the discovery prompt. */
export const HISTORICAL_FP_COLLISION_MAP = {
  DIVIDED_OR_RESERVED_USE: ['CONSUMED_ROW'],
  SERVING_OR_GARNISH_ACTION: ['CONTEXTUAL_MENTION', 'CONSUMED_ROW'],
  TRANSFER_OR_ASSEMBLY_TARGET: ['COMPONENT_LEAKAGE', 'CONTEXTUAL_MENTION'],
  MULTI_COMPONENT_ASSEMBLY: ['COMPONENT_LEAKAGE'],
  PRONOUN_OR_DEICTIC_REFERENCE: ['COMPONENT_LEAKAGE', 'CONTEXTUAL_MENTION'],
  CATEGORY_OR_COLLECTIVE_ALIAS: ['COMPONENT_LEAKAGE', 'CONTEXTUAL_MENTION'],
  CONTINUING_COOKING_OBJECT: ['COMPONENT_LEAKAGE', 'PROCESS_MATERIAL'],
  COLLECTION_ACTIVE_CONTINUATION: ['COMPONENT_LEAKAGE'],
  DISH_STATE_CONTINUATION: ['COMPONENT_LEAKAGE', 'CONSUMED_ROW'],
  IMPLIED_SEASONING_OR_FINISHING: ['CONTEXTUAL_MENTION'],
  SOURCE_PARSER_ADJUDICATION_EDGE: [],
  OTHER_SPECIFIC: [],
}

export function historicalFpCollisionRisks(semanticClass) {
  const causes = HISTORICAL_FP_COLLISION_MAP[semanticClass] || []
  return causes.map(cause => FP_ROOT_CAUSES[cause])
}

/** Suggested truth-blind implementation signals per class (Phase 4 requirement #5), kept
 *  separate from the regex used for taxonomy discovery itself -- these describe production
 *  signal sources, not benchmark-truth lookups. */
const IMPLEMENTATION_SIGNALS = {
  DIVIDED_OR_RESERVED_USE: ['ingredient-row "reserved"/"set aside for" lexical flag', 'quantity-split detection (row quantity partially consumed earlier)'],
  SERVING_OR_GARNISH_ACTION: ['instruction-opening verb classifier (serve/garnish/top/sprinkle/drizzle)', 'position-in-recipe heuristic (final 1-2 instructions)'],
  TRANSFER_OR_ASSEMBLY_TARGET: ['transfer/assembly verb classifier', 'component-membership carry-through to the destination vessel'],
  MULTI_COMPONENT_ASSEMBLY: ['named-component antecedent resolver ("the sauce", "the pasta")', 'combine/return-to verb classifier'],
  PRONOUN_OR_DEICTIC_REFERENCE: ['pronoun/deictic detector + nearest-antecedent-set resolver bounded to the active object graph'],
  CATEGORY_OR_COLLECTIVE_ALIAS: ['curated collective-noun-to-row-set alias table, scoped per recipe'],
  CONTINUING_COOKING_OBJECT: ['single-named-object continuity tracker (last principal target) + manipulation-verb classifier'],
  COLLECTION_ACTIVE_CONTINUATION: ['assembled-set active-object state + collection-manipulation verb classifier'],
  DISH_STATE_CONTINUATION: ['whole-dish/vessel state node + passive-continuation verb classifier'],
  IMPLIED_SEASONING_OR_FINISHING: ['scoped-finishing-phrase detector requiring an explicit subset noun'],
  SOURCE_PARSER_ADJUDICATION_EDGE: ['none (benchmark/source review, not a detection signal)'],
  OTHER_SPECIFIC: ['none until re-reviewed and split into a named class'],
}

export function implementationSignalCandidates(semanticClass) {
  return IMPLEMENTATION_SIGNALS[semanticClass] || []
}

/** Builds a lookup of instructionText by (recipeId, instructionIndex) from every candidate in
 *  the frozen-candidate populations, so previousInstructionText can be derived even for a
 *  recipe/instruction pair that has no FN candidate of its own at index-1. */
function buildInstructionIndex(frozenData) {
  const byRecipe = new Map()
  const allPopulations = [
    ...(frozenData.populations?.INGREDIENT_RELATIONSHIPS || []),
    ...(frozenData.populations?.PREPARED_COMPONENT_RELATIONSHIPS || []),
  ]
  for (const record of allPopulations) {
    if (!byRecipe.has(record.recipeId)) byRecipe.set(record.recipeId, new Map())
    const perRecipe = byRecipe.get(record.recipeId)
    perRecipe.set(record.instructionIndex, record.instructionText)
    if (record.nextInstructionText) perRecipe.set(record.instructionIndex + 1, record.nextInstructionText)
  }
  return byRecipe
}

function frozenCandidateMap(frozenData) {
  const map = new Map()
  for (const record of frozenData.populations?.INGREDIENT_RELATIONSHIPS || []) map.set(record.candidateId, record)
  for (const record of frozenData.populations?.PREPARED_COMPONENT_RELATIONSHIPS || []) map.set(record.candidateId, record)
  return map
}

/**
 * Reconstructs the exact 191-row V10D false-negative population with full source context,
 * by joining the locked V10D analysis artifact's finalErrors.falseRejects against the locked
 * V10A frozen-candidate evidence artifact.
 *
 * Throws if the reconstructed count is not exactly EXPECTED_FN_POPULATION, or if any
 * falseRejects candidateId cannot be resolved against the frozen-candidate evidence.
 */
export function buildFnPopulation(v10dData, frozenData) {
  const falseRejects = v10dData.finalErrors?.falseRejects || []
  const frozenMap = frozenCandidateMap(frozenData)
  const instructionIndex = buildInstructionIndex(frozenData)

  const rows = falseRejects.map(fr => {
    const frozen = frozenMap.get(fr.candidateId)
    if (!frozen) {
      throw new Error(`V10D false-reject candidate ${fr.candidateId} has no matching frozen-candidate evidence row`)
    }
    const perRecipe = instructionIndex.get(frozen.recipeId)
    const previousInstructionText = perRecipe?.get(frozen.instructionIndex - 1) ?? null
    const selfRow = (frozen.relevantSurroundingSource?.relatedIngredientRows || [])
      .find(entry => entry.ingredientIndex === frozen.ingredientIndex)

    return {
      candidateId: fr.candidateId,
      recipeId: frozen.recipeId,
      title: frozen.title,
      instructionIndex: frozen.instructionIndex,
      ingredientIndex: frozen.ingredientIndex,
      ingredientText: frozen.ingredientText,
      ingredientGroup: selfRow ? selfRow.group : null,
      previousInstructionText,
      instructionText: frozen.instructionText,
      nextInstructionText: frozen.nextInstructionText ?? null,
      reviewerA: frozen.origins.includes('REVIEWER_A'),
      reviewerB: frozen.origins.includes('REVIEWER_B'),
      deterministicOrigin: frozen.provenanceClass,
      v10cState: fr.state?.v10c ?? null,
      v10dState: fr.state ?? null,
      v10dDecision: fr.decision ?? null,
      v10dBasis: fr.decision?.basis ?? null,
      benchmarkTruth: frozen.adjudicatedTruth,
    }
  })

  return rows
}

/** Asserts the reconstructed population is exactly EXPECTED_FN_POPULATION (191). Kept separate
 *  from buildFnPopulation so the join logic itself stays unit-testable against small fixtures;
 *  callers reconstructing the real locked V10D population must call this before proceeding
 *  (Phase 2 of the discovery task: "Assert: FN count = 191 before proceeding"). */
export function assertExactFnPopulation(rows) {
  if (rows.length !== EXPECTED_FN_POPULATION) {
    throw new Error(`Expected exactly ${EXPECTED_FN_POPULATION} V10D false negatives, reconstructed ${rows.length}`)
  }
  return true
}

/** Attaches classification + collision-risk + implementation-signal fields to each row. */
export function classifyFnPopulation(rows) {
  return rows.map(row => {
    const classification = classifyCandidate(row)
    return {
      candidateId: row.candidateId,
      recipeId: row.recipeId,
      instructionIndex: row.instructionIndex,
      ingredientIndex: row.ingredientIndex,
      semanticClass: classification.semanticClass,
      semanticSubClass: classification.semanticSubClass,
      antecedentType: classification.antecedentType,
      activeObjectType: classification.activeObjectType,
      reviewerVotes: reviewerVoteLabel(row),
      historicalFpCollisionRisks: historicalFpCollisionRisks(classification.semanticClass),
      implementationSignalCandidates: implementationSignalCandidates(classification.semanticClass),
      benchmarkPolicyConcern: classification.semanticClass === 'SOURCE_PARSER_ADJUDICATION_EDGE',
    }
  })
}

export function reviewerVoteLabel(row) {
  if (row.reviewerA && row.reviewerB) return '2_OF_2'
  if (row.reviewerA || row.reviewerB) return '1_OF_2'
  return '0_OF_2'
}

/** Per-class quantification: count, % of total, recipes affected, reviewer-vote distribution. */
export function aggregateByClass(rows, classifications) {
  const byId = new Map(classifications.map(c => [c.candidateId, c]))
  const groups = new Map()
  for (const row of rows) {
    const c = byId.get(row.candidateId)
    if (!groups.has(c.semanticClass)) {
      groups.set(c.semanticClass, {
        semanticClass: c.semanticClass,
        fnCount: 0,
        recipes: new Set(),
        reviewerVotes: { '2_OF_2': 0, '1_OF_2': 0, '0_OF_2': 0 },
      })
    }
    const group = groups.get(c.semanticClass)
    group.fnCount += 1
    group.recipes.add(row.recipeId)
    group.reviewerVotes[c.reviewerVotes] += 1
  }
  const total = rows.length
  return Array.from(groups.values())
    .map(group => ({
      semanticClass: group.semanticClass,
      fnCount: group.fnCount,
      percentOfTotal: total === 0 ? 0 : Math.round((group.fnCount / total) * 10000) / 100,
      recipesAffected: group.recipes.size,
      reviewerVotes: group.reviewerVotes,
    }))
    .sort((a, b) => b.fnCount - a.fnCount)
}

/** Verifies every row in the reconstructed population received a classification and that the
 *  per-class counts sum back to EXPECTED_FN_POPULATION. Throws on any gap. */
export function assertTaxonomyCompleteness(rows, classifications) {
  if (classifications.length !== rows.length) {
    throw new Error(`Classified ${classifications.length} rows but population has ${rows.length}`)
  }
  const classifiedIds = new Set(classifications.map(c => c.candidateId))
  for (const row of rows) {
    if (!classifiedIds.has(row.candidateId)) {
      throw new Error(`Candidate ${row.candidateId} was not classified`)
    }
  }
  for (const c of classifications) {
    if (!SEMANTIC_TAXONOMY.includes(c.semanticClass)) {
      throw new Error(`Candidate ${c.candidateId} has unknown semanticClass ${c.semanticClass}`)
    }
  }
  const sum = aggregateByClass(rows, classifications).reduce((acc, g) => acc + g.fnCount, 0)
  if (sum !== rows.length) {
    throw new Error(`Per-class counts sum to ${sum}, expected ${rows.length}`)
  }
  return true
}

/** The top-N classes by fnCount, used to weight severity toward the classes that actually
 *  drive recall loss (Phase 5/8 of the discovery prompt). */
export function dominantClasses(rows, classifications, topN = 3) {
  return aggregateByClass(rows, classifications).slice(0, topN).map(g => g.semanticClass)
}

/** Severity is a function of reviewer-consensus strength (how unambiguous the benchmark-correct
 *  label is) and whether the class is a dominant recall-loss driver (how much fixing it would
 *  recover). It intentionally does NOT factor in historical-FP collision risk -- that is a
 *  separate, fix-risk axis reported alongside it, not conflated into it. */
export function severityForRow(row, classification, dominantClassNames) {
  const votes = reviewerVoteLabel(row)
  const isDominant = dominantClassNames.includes(classification.semanticClass)
  if (votes === '2_OF_2' && isDominant) return 'CRITICAL'
  if (votes === '2_OF_2') return 'HIGH'
  if (votes === '1_OF_2') return 'MEDIUM'
  return 'LOW'
}

export function aggregateSeverity(rows, classifications, dominantClassNames) {
  const byId = new Map(classifications.map(c => [c.candidateId, c]))
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }
  for (const row of rows) {
    counts[severityForRow(row, byId.get(row.candidateId), dominantClassNames)] += 1
  }
  return counts
}

/** Evidence for the Phase 8 active-object-graph question: how many false-negative rows already
 *  carried a non-empty V10C componentMembership at the moment V10D rejected them, broken out
 *  by semantic class. A high proportion means a flat "any prior component membership disqualifies
 *  continuation" gate (V10D's actual rule) cannot discriminate benchmark-correct continuations
 *  from the historical component-leakage false positives it was built to stop -- both populations
 *  carry component membership, so the signal needed is which component/transition, not membership
 *  as a boolean. */
export function componentMembershipEvidence(rows, classifications) {
  const byId = new Map(classifications.map(c => [c.candidateId, c]))
  const byClass = new Map()
  for (const row of rows) {
    const semanticClass = byId.get(row.candidateId).semanticClass
    if (!byClass.has(semanticClass)) byClass.set(semanticClass, { semanticClass, total: 0, withComponentMembership: 0, componentKeys: new Set() })
    const group = byClass.get(semanticClass)
    group.total += 1
    const memberships = row.v10cState?.componentMembership?.memberships || []
    if (memberships.length > 0) {
      group.withComponentMembership += 1
      for (const m of memberships) group.componentKeys.add(m.componentKey)
    }
  }
  return Array.from(byClass.values())
    .map(group => ({
      semanticClass: group.semanticClass,
      total: group.total,
      withComponentMembership: group.withComponentMembership,
      componentKeys: Array.from(group.componentKeys),
    }))
    .sort((a, b) => b.withComponentMembership - a.withComponentMembership)
}

/** Cross-references componentKey labels that appear on both the FN population (rows the
 *  benchmark says should stay active) and the locked historicalRegression population (rows
 *  where accepting continuation was -- or would have been -- a false positive), per Phase 7/12.
 *  A non-empty result means componentKey identity alone cannot separate the two populations;
 *  the same named component recurs on both sides across different recipes. */
export function componentKeyOverlap(rows, historicalRegressionOutcomes) {
  const fnKeys = new Set()
  for (const row of rows) {
    for (const m of row.v10cState?.componentMembership?.memberships || []) fnKeys.add(m.componentKey)
  }
  const historicalKeys = new Set()
  for (const outcome of historicalRegressionOutcomes || []) {
    for (const m of outcome.state?.componentMembership?.memberships || []) historicalKeys.add(m.componentKey)
  }
  return Array.from(fnKeys).filter(key => historicalKeys.has(key)).sort()
}
