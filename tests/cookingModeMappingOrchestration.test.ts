import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ai', () => ({ generateAIObject: vi.fn() }))

import { COOKING_MODE_MAPPING_REVIEWER_PROMPT_VERSION } from '@/lib/aiConfig'
import {
  buildMappingReviewerPrompt,
  executeBlindMappingReviewers,
  executeMappingReviewer,
  MAPPING_REVIEWER_MAX_ATTEMPTS,
  MAPPING_REVIEWER_RESPONSE_SCHEMA,
  MAPPING_REVIEWER_SYSTEM_PROMPT,
  normalizeMappingReviewerRelationships,
  parseMappingReviewerOutput,
} from '@/lib/cookingModeMappingReviewer'
import {
  buildMappingProposal,
} from '@/lib/cookingModeMappingProposal'
import { generateMappingProposal } from '@/lib/cookingModeMappingOrchestrator'
import {
  computeMappingProposalId,
  computeMappingRecipeRevision,
} from '@/lib/cookingModeMappingIdentity'
import { FROZEN_V10B_SOURCE_EXTRACTOR_SHA256 } from '@/lib/cookingModeMappingEvidence'
import {
  MAPPING_REVIEWER_CONTRACT_VERSION,
} from '@/types/cookingModeMapping'
import type {
  MappingFrozenV10BRiskFacts,
  MappingReviewerExecutionResultV1,
  MappingReviewerRelationshipV1,
  MappingReviewerResponseV1,
  MappingRevisionSource,
} from '@/types/cookingModeMapping'

const source: MappingRevisionSource = {
  recipeId: 'recipe-1',
  parserVersion: 'recipe-content-v1',
  ingredients: ['For the sauce:', '1 cup tomatoes', '1 tsp basil'],
  instructions: ['Add the tomatoes.', 'Stir in basil.'],
}

let recipeRevision = ''

beforeEach(async () => {
  recipeRevision = await computeMappingRecipeRevision(source)
})

function relationship(ingredientRowIndex: number, stepIndex: number): MappingReviewerRelationshipV1 {
  return { ingredientRowIndex, stepIndex }
}

function coverage() {
  return { ingredientRowCount: 3, nonHeaderIngredientRowCount: 2, stepCount: 2, reviewedCellCount: 4 }
}

function response(acceptedRelationships: MappingReviewerRelationshipV1[] = []): MappingReviewerResponseV1 {
  return {
    reviewerContractVersion: MAPPING_REVIEWER_CONTRACT_VERSION,
    promptVersion: COOKING_MODE_MAPPING_REVIEWER_PROMPT_VERSION,
    recipeRevision,
    coverage: coverage(),
    acceptedRelationships,
  }
}

function execution(
  reviewerSlot: 'A' | 'B',
  acceptedRelationships: MappingReviewerRelationshipV1[] = [],
  change: Partial<MappingReviewerExecutionResultV1> = {},
): MappingReviewerExecutionResultV1 {
  return {
    reviewerSlot,
    reviewerContractVersion: MAPPING_REVIEWER_CONTRACT_VERSION,
    promptVersion: COOKING_MODE_MAPPING_REVIEWER_PROMPT_VERSION,
    modelId: 'openai/gpt-5.6-luna',
    recipeRevision,
    parseStatus: 'VALID',
    acceptedRelationships,
    coverage: coverage(),
    normalizedOutputHash: `hash-${reviewerSlot}`,
    completedAt: '2026-08-28T12:00:01.000Z',
    runId: `run-${reviewerSlot}`,
    attemptId: `attempt-${reviewerSlot}`,
    attempt: 1,
    attempts: [],
    ...change,
  }
}

function safeFacts(change: Partial<MappingFrozenV10BRiskFacts> = {}): MappingFrozenV10BRiskFacts {
  return {
    isExplicitlyNamedInInstruction: true,
    ingredientGroup: 'For the sauce:',
    duplicateSiblingIndexes: [],
    priorInstructionMentions: [],
    laterInstructionMentions: [],
    priorReviewerUses: [],
    quantityEvidence: {},
    componentContext: {
      possibleConstituent: false,
      componentLabels: [],
      currentInstructionRefersToComponent: false,
    },
    remainingLanguage: false,
    processMaterialRisk: false,
    contextualMentionRisk: false,
    duplicateRowRisk: false,
    groupConflictRisk: false,
    quantityConflictRisk: false,
    lifecycleRisk: false,
    collectiveReferenceRisk: false,
    partialIdentityMatchRisk: false,
    ...change,
  }
}

const deterministicIds = (kind: 'run' | 'attempt', slot: 'A' | 'B', attempt: number) =>
  `${kind}-${slot}-${attempt}`
const deterministicNow = () => '2026-08-28T12:00:00.000Z'

describe('versioned blind reviewer request', () => {
  it('preserves zero-based ingredient and step indexes plus group/header structure', () => {
    const prompt = buildMappingReviewerPrompt(source, 'revision-1')
    expect(prompt).toContain('[0] GROUP HEADER: For the sauce:')
    expect(prompt).toContain('[1] INGREDIENT (group: For the sauce:): 1 cup tomatoes')
    expect(prompt).toContain('[0] Add the tomatoes.')
    expect(prompt).toContain('[1] Stir in basil.')
  })

  it('attaches the exact reviewer contract and prompt versions', () => {
    const prompt = buildMappingReviewerPrompt(source, recipeRevision)
    expect(prompt).toContain(`Reviewer contract version: ${MAPPING_REVIEWER_CONTRACT_VERSION}`)
    expect(prompt).toContain(`Prompt version: ${COOKING_MODE_MAPPING_REVIEWER_PROMPT_VERSION}`)
  })

  it('uses a flat, strict, bounded accepted-relationship schema', () => {
    expect(MAPPING_REVIEWER_RESPONSE_SCHEMA.safeParse(response([relationship(1, 0)])).success).toBe(true)
    expect(MAPPING_REVIEWER_RESPONSE_SCHEMA.safeParse({ ...response(), extra: true }).success).toBe(false)
    expect(MAPPING_REVIEWER_RESPONSE_SCHEMA.safeParse({ ...response(), acceptedRelationships: new Array(30_001).fill(relationship(1, 0)) }).success).toBe(false)
  })

  it('prompts for exhaustive discovery without chain-of-thought', () => {
    expect(MAPPING_REVIEWER_SYSTEM_PROMPT).toMatch(/direct use[\s\S]*continued manipulation[\s\S]*pronoun[\s\S]*collective[\s\S]*transfer and assembly[\s\S]*serving or garnish[\s\S]*divided or reserved[\s\S]*seasoning or herb/i)
    expect(MAPPING_REVIEWER_SYSTEM_PROMPT).toMatch(/Do not provide chain-of-thought/i)
  })

  it('sends A and B source-identical semantic requests without cross-fed outputs', async () => {
    const requests: Array<Record<string, unknown>> = []
    const generate = vi.fn(async request => {
      requests.push(request as Record<string, unknown>)
      return response([relationship(1, 0)])
    })
    await executeBlindMappingReviewers({
      recipeId: source.recipeId, source, generate: generate as never,
      now: deterministicNow, idFactory: deterministicIds,
    })
    expect(requests).toHaveLength(2)
    expect(requests[0].prompt).toBe(requests[1].prompt)
    expect(requests[0].system).toBe(requests[1].system)
    expect(requests[0].schema).toBe(requests[1].schema)
    expect(requests[0].maxRetries).toBe(0)
    expect(String(requests[0].prompt)).not.toMatch(/reviewer A output|reviewer B output|routing result|benchmark truth/i)
  })

  it('identifies slots only through safe execution metadata, not the semantic prompt', async () => {
    const requests: Array<Record<string, unknown>> = []
    await executeBlindMappingReviewers({
      recipeId: source.recipeId, source,
      generate: vi.fn(async request => { requests.push(request as Record<string, unknown>); return response() }) as never,
      now: deterministicNow, idFactory: deterministicIds,
    })
    expect(requests.map(item => item.feature)).toEqual(expect.arrayContaining([
      'cooking-mode-mapping-reviewer-a', 'cooking-mode-mapping-reviewer-b',
    ]))
    expect(requests[0].prompt).toBe(requests[1].prompt)
  })

  it('rejects an oversized source before any AI execution', async () => {
    const generate = vi.fn()
    await expect(executeMappingReviewer({
      reviewerSlot: 'A', recipeId: source.recipeId,
      source: { ...source, ingredients: new Array(201).fill('1 tsp basil') },
      generate: generate as never,
    })).rejects.toThrow(/ingredient row limit exceeded/)
    expect(generate).not.toHaveBeenCalled()
  })
})

describe('strict output parsing and hashing', () => {
  it('accepts a valid complete response', async () => {
    await expect(parseMappingReviewerOutput(response([relationship(1, 0)]), source, recipeRevision))
      .resolves.toMatchObject({ parseStatus: 'VALID', failure: null })
  })

  it('normalizes duplicate relationships deterministically', async () => {
    const parsed = await parseMappingReviewerOutput(response([
      relationship(2, 1), relationship(1, 0), relationship(2, 1),
    ]), source, recipeRevision)
    expect(parsed.acceptedRelationships).toEqual([relationship(1, 0), relationship(2, 1)])
  })

  it('normalizes relationship order outside parsing too', () => {
    expect(normalizeMappingReviewerRelationships([relationship(2, 1), relationship(1, 0)]))
      .toEqual([relationship(1, 0), relationship(2, 1)])
  })

  it.each([
    ['negative ingredient', relationship(-1, 0)],
    ['large ingredient', relationship(3, 0)],
    ['negative step', relationship(1, -1)],
    ['large step', relationship(1, 2)],
    ['header row', relationship(0, 0)],
  ])('marks %s structurally invalid without silently treating omissions as rejects', async (_label, invalid) => {
    const parsed = await parseMappingReviewerOutput(response([invalid]), source, recipeRevision)
    expect(parsed).toMatchObject({ parseStatus: 'INVALID', diagnosticCode: 'INVALID_RELATIONSHIP_INDEX' })
    expect(parsed.acceptedRelationships).toEqual([invalid])
  })

  it('rejects malformed JSON with a diagnostic hash', async () => {
    const parsed = await parseMappingReviewerOutput('{bad json', source, recipeRevision)
    expect(parsed).toMatchObject({ parseStatus: 'INVALID', failure: 'PARSE_FAILURE', diagnosticCode: 'INVALID_JSON' })
    expect(parsed.outputHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects schema-invalid output', async () => {
    await expect(parseMappingReviewerOutput({ acceptedRelationships: [] }, source, recipeRevision))
      .resolves.toMatchObject({ parseStatus: 'INVALID', failure: 'SCHEMA_FAILURE' })
  })

  it('rejects a partial coverage attestation', async () => {
    const parsed = await parseMappingReviewerOutput({ ...response(), coverage: { ...coverage(), reviewedCellCount: 3 } }, source, recipeRevision)
    expect(parsed).toMatchObject({ parseStatus: 'INVALID', failure: 'MISSING_REQUIRED_OUTPUT', diagnosticCode: 'INCOMPLETE_COVERAGE' })
  })

  it('rejects a source-revision mismatch', async () => {
    const parsed = await parseMappingReviewerOutput({ ...response(), recipeRevision: 'stale' }, source, recipeRevision)
    expect(parsed).toMatchObject({ parseStatus: 'INVALID', diagnosticCode: 'REVISION_MISMATCH' })
  })

  it('accepts an empty exhaustive result', async () => {
    const parsed = await parseMappingReviewerOutput(response(), source, recipeRevision)
    expect(parsed).toMatchObject({ parseStatus: 'VALID', acceptedRelationships: [] })
  })

  it('hashes equivalent duplicate/order variants identically', async () => {
    const first = await parseMappingReviewerOutput(response([relationship(2, 1), relationship(1, 0)]), source, recipeRevision)
    const second = await parseMappingReviewerOutput(response([relationship(1, 0), relationship(2, 1), relationship(1, 0)]), source, recipeRevision)
    expect(first.outputHash).toBe(second.outputHash)
  })
})

describe('bounded reviewer retry and provenance', () => {
  it('uses the repository-wide bounded maximum of two attempts', () => {
    expect(MAPPING_REVIEWER_MAX_ATTEMPTS).toBe(2)
  })

  it('retries an execution failure and retains both attempts', async () => {
    const generate = vi.fn().mockRejectedValueOnce(new Error('provider unavailable')).mockResolvedValueOnce(response())
    const result = await executeMappingReviewer({ reviewerSlot: 'A', recipeId: source.recipeId, source,
      generate: generate as never, now: deterministicNow, idFactory: deterministicIds })
    expect(result).toMatchObject({ parseStatus: 'VALID', attempt: 2 })
    expect(result.attempts).toHaveLength(2)
  })

  it('retries coverage/schema failure but not a valid semantic empty result', async () => {
    const partial = { ...response(), coverage: { ...coverage(), reviewedCellCount: 1 } }
    const retrying = vi.fn().mockResolvedValueOnce(partial).mockResolvedValueOnce(response())
    expect((await executeMappingReviewer({ reviewerSlot: 'A', recipeId: source.recipeId, source,
      generate: retrying as never, now: deterministicNow, idFactory: deterministicIds })).attempt).toBe(2)
    const semanticReject = vi.fn().mockResolvedValue(response())
    expect((await executeMappingReviewer({ reviewerSlot: 'A', recipeId: source.recipeId, source,
      generate: semanticReject as never, now: deterministicNow, idFactory: deterministicIds })).attempt).toBe(1)
    expect(semanticReject).toHaveBeenCalledOnce()
  })

  it('exhausts timeout as MISSING/NO_RESULT', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    const result = await executeMappingReviewer({ reviewerSlot: 'B', recipeId: source.recipeId, source,
      generate: vi.fn().mockRejectedValue(timeout) as never, now: deterministicNow, idFactory: deterministicIds })
    expect(result).toMatchObject({ parseStatus: 'NO_RESULT', attempt: 2, normalizedOutputHash: null })
  })

  it('exhausts provider schema output as UNPARSEABLE/INVALID with a hash', async () => {
    const schemaError = { name: 'AI_NoObjectGeneratedError', text: '{"bad":true}' }
    const result = await executeMappingReviewer({ reviewerSlot: 'A', recipeId: source.recipeId, source,
      generate: vi.fn().mockRejectedValue(schemaError) as never, now: deterministicNow, idFactory: deterministicIds })
    expect(result.parseStatus).toBe('INVALID')
    expect(result.normalizedOutputHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('assigns unique run and attempt IDs per retry', async () => {
    const result = await executeMappingReviewer({ reviewerSlot: 'A', recipeId: source.recipeId, source,
      generate: vi.fn().mockRejectedValue(new Error('fail')) as never, now: deterministicNow,
      idFactory: deterministicIds })
    expect(new Set(result.attempts.map(item => item.runId)).size).toBe(2)
    expect(new Set(result.attempts.map(item => item.attemptId)).size).toBe(2)
  })
})

describe('candidate union, votes, routing, and proposal readiness', () => {
  async function build(
    a: MappingReviewerExecutionResultV1,
    b: MappingReviewerExecutionResultV1,
    change: Partial<Parameters<typeof buildMappingProposal>[0]> = {},
  ) {
    return buildMappingProposal({
      recipeId: source.recipeId, source, recipeRevision, reviewerA: a, reviewerB: b,
      createdAt: '2026-08-28T12:00:00.000Z', ...change,
    })
  }

  it('deduplicates the A/B candidate union and records both origins', async () => {
    const rel = relationship(1, 0)
    const proposal = await build(execution('A', [rel, rel]), execution('B', [rel]))
    expect(proposal.candidates).toHaveLength(1)
    expect(proposal.candidates[0].provenance.acceptedByReviewerSlots).toEqual(['A', 'B'])
  })

  it.each([
    ['both accept', [relationship(1, 0)], [relationship(1, 0)], 'ACCEPT', 'ACCEPT'],
    ['A only', [relationship(1, 0)], [], 'ACCEPT', 'REJECT'],
    ['B only', [], [relationship(1, 0)], 'REJECT', 'ACCEPT'],
  ])('normalizes votes for %s', async (_label, a, b, voteA, voteB) => {
    const candidate = (await build(execution('A', a), execution('B', b))).candidates[0]
    expect([candidate.reviewerA.vote, candidate.reviewerB.vote]).toEqual([voteA, voteB])
  })

  it('never converts a failed reviewer omission into REJECT', async () => {
    const failed = execution('B', [], { parseStatus: 'NO_RESULT', completedAt: null, normalizedOutputHash: null })
    const candidate = (await build(execution('A', [relationship(1, 0)]), failed)).candidates[0]
    expect(candidate.reviewerB.vote).toBe('MISSING')
    expect(candidate.routingDecision).toBe('REVIEW_REQUIRED')
  })

  it('normalizes a schema-failed reviewer as UNPARSEABLE', async () => {
    const failed = execution('B', [], { parseStatus: 'INVALID' })
    const candidate = (await build(execution('A', [relationship(1, 0)]), failed)).candidates[0]
    expect(candidate.reviewerB.vote).toBe('UNPARSEABLE')
  })

  it('auto-accepts both complete accepts with complete no-risk V1 evidence', async () => {
    const rel = relationship(1, 0)
    const proposal = await build(execution('A', [rel]), execution('B', [rel]))
    expect(proposal.candidates[0].routingDecision).toBe('AUTO_ACCEPT')
    expect(proposal.reviewCompleteWithoutHuman).toBe(true)
  })

  it('routes reviewer disagreement to review and blocks readiness', async () => {
    const proposal = await build(execution('A', [relationship(1, 0)]), execution('B'))
    expect(proposal.candidates[0]).toMatchObject({ routingDecision: 'REVIEW_REQUIRED', routingReasons: ['REVIEWER_DISAGREEMENT'] })
    expect(proposal.blockingReasons).toContain('CANDIDATE_REVIEW_REQUIRED')
  })

  it('routes any frozen V1 risk to review', async () => {
    const rel = relationship(1, 0)
    const proposal = await build(execution('A', [rel]), execution('B', [rel]), {
      evidenceResolver: () => ({ status: 'COMPLETE', extractorFingerprint: FROZEN_V10B_SOURCE_EXTRACTOR_SHA256,
        frozenRiskFacts: safeFacts({ lifecycleRisk: true }) }),
    })
    expect(proposal.candidates[0]).toMatchObject({ routingDecision: 'REVIEW_REQUIRED', routingReasons: ['DETERMINISTIC_RISK_PRESENT'] })
  })

  it('keeps V10G diagnostic tags without routing authority', async () => {
    const rel = relationship(1, 0)
    const proposal = await build(execution('A', [rel]), execution('B', [rel]), {
      evidenceResolver: () => ({ status: 'COMPLETE', extractorFingerprint: FROZEN_V10B_SOURCE_EXTRACTOR_SHA256,
        frozenRiskFacts: safeFacts(), tags: ['V10G_FRONTIER_REJECT'] }),
    })
    expect(proposal.candidates[0].routingDecision).toBe('AUTO_ACCEPT')
  })

  it('materializes structural invalidity as AUTO_REJECT and blocks the proposal', async () => {
    const invalid = relationship(99, 0)
    const proposal = await build(execution('A', [invalid], { parseStatus: 'INVALID' }), execution('B'))
    expect(proposal.candidates[0]).toMatchObject({ routingDecision: 'AUTO_REJECT', finalDecision: 'REJECT' })
    expect(proposal.blockingReasons).toContain('STRUCTURAL_INVALIDITY')
  })

  it('fails evidence closed as review-required and blocks completion', async () => {
    const rel = relationship(1, 0)
    const proposal = await build(execution('A', [rel]), execution('B', [rel]), {
      evidenceResolver: () => { throw new Error('extractor failed') },
    })
    expect(proposal.candidates[0]).toMatchObject({ routingDecision: 'REVIEW_REQUIRED', reviewStatus: 'BLOCKED' })
    expect(proposal.blockingReasons).toContain('DETERMINISTIC_EVIDENCE_FAILURE')
  })

  it.each([
    ['A fails', 'A'],
    ['B fails', 'B'],
  ] as const)('%s with no one-reviewer fallback', async (_label, slot) => {
    const rel = relationship(1, 0)
    const a = execution('A', [rel], slot === 'A' ? { parseStatus: 'NO_RESULT', completedAt: null, normalizedOutputHash: null } : {})
    const b = execution('B', [rel], slot === 'B' ? { parseStatus: 'NO_RESULT', completedAt: null, normalizedOutputHash: null } : {})
    const proposal = await build(a, b)
    expect(proposal.approvalBlocked).toBe(true)
    expect(proposal.summary.autoAcceptCount).toBe(0)
  })

  it('blocks two-reviewer failure with zero auto-approved output', async () => {
    const failure = { parseStatus: 'NO_RESULT' as const, acceptedRelationships: [], completedAt: null, normalizedOutputHash: null }
    const proposal = await build(execution('A', [], failure), execution('B', [], failure))
    expect(proposal).toMatchObject({ approvalBlocked: true, summary: { candidateCount: 0, autoAcceptCount: 0 } })
    expect(proposal.blockingReasons).toEqual(expect.arrayContaining(['REVIEWER_A_INCOMPLETE', 'REVIEWER_B_INCOMPLETE']))
  })

  it('treats a fully valid empty union as complete but does not create an approved map', async () => {
    const proposal = await build(execution('A'), execution('B'))
    expect(proposal).toMatchObject({ approvalBlocked: false, reviewCompleteWithoutHuman: true, candidates: [] })
    expect(proposal).not.toHaveProperty('approvedMap')
  })

  it('reconciles every summary count to candidate count', async () => {
    const proposal = await build(
      execution('A', [relationship(1, 0), relationship(2, 1)]),
      execution('B', [relationship(1, 0)]),
    )
    expect(proposal.summary.autoAcceptCount + proposal.summary.reviewRequiredCount + proposal.summary.autoRejectCount)
      .toBe(proposal.summary.candidateCount)
  })

  it('blocks an explicit source identity mismatch', async () => {
    const rel = relationship(1, 0)
    const proposal = await build(execution('A', [rel]), execution('B', [rel]), { sourceIdentityMismatch: true })
    expect(proposal.blockingReasons).toContain('SOURCE_IDENTITY_MISMATCH')
  })
})

describe('deterministic proposal and candidate identity', () => {
  it('uses the normative proposal tuple and mp1 prefix', async () => {
    const id = await computeMappingProposalId({ recipeId: source.recipeId, recipeRevision })
    expect(id).toMatch(/^mp1:[0-9a-f]{64}$/)
  })

  it('keeps proposal identity stable across retry/run/timestamp metadata', async () => {
    const rel = relationship(1, 0)
    const first = await buildMappingProposal({ recipeId: source.recipeId, source, recipeRevision,
      reviewerA: execution('A', [rel]), reviewerB: execution('B', [rel]), createdAt: '2026-08-28T01:00:00Z' })
    const second = await buildMappingProposal({ recipeId: source.recipeId, source, recipeRevision,
      reviewerA: execution('A', [rel], { runId: 'retry-a', attempt: 2 }),
      reviewerB: execution('B', [rel], { attemptId: 'retry-b', attempt: 2 }), createdAt: '2026-08-29T01:00:00Z' })
    expect(second.proposalId).toBe(first.proposalId)
    expect(second.candidates[0].candidateId).toBe(first.candidates[0].candidateId)
  })

  it('does not duplicate candidates when a retry repeats relationships', async () => {
    const rel = relationship(1, 0)
    const proposal = await buildMappingProposal({ recipeId: source.recipeId, source, recipeRevision,
      reviewerA: execution('A', [rel, rel], { attempt: 2 }), reviewerB: execution('B', [rel]),
      createdAt: '2026-08-28T01:00:00Z' })
    expect(proposal.candidates).toHaveLength(1)
  })

  it('fails closed when the caller source changes during reviewer execution', async () => {
    const mutable: MappingRevisionSource = {
      ...source,
      ingredients: [...source.ingredients],
      instructions: [...source.instructions],
    }
    let mutated = false
    const generate = vi.fn(async () => {
      if (!mutated) {
        mutated = true
        mutable.instructions[0] = 'Changed while reviewers were running.'
      }
      return response([relationship(1, 0)])
    })
    const proposal = await generateMappingProposal({
      recipeId: mutable.recipeId, source: mutable, generate: generate as never,
      now: deterministicNow, idFactory: deterministicIds,
    })
    expect(proposal.blockingReasons).toContain('SOURCE_IDENTITY_MISMATCH')
    expect(proposal.approvalBlocked).toBe(true)
  })
})

describe('architecture boundaries', () => {
  it('keeps orchestration in-memory and out of Firestore, recipe writes, runtime, and UI', () => {
    const root = process.cwd()
    const sourceText = [
      'lib/cookingModeMappingReviewer.ts',
      'lib/cookingModeMappingOrchestrator.ts',
      'lib/cookingModeMappingProposal.ts',
      'lib/cookingModeMappingRiskFacts.ts',
    ].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n')
    expect(sourceText).not.toMatch(/firebase|firestore|setDoc|updateDoc|addDoc|saveRecipe\(|@\/components\/CookingMode|components\//i)
  })

  it('reuses only the central AI helper and contains no direct provider execution', () => {
    const reviewer = fs.readFileSync(path.join(process.cwd(), 'lib/cookingModeMappingReviewer.ts'), 'utf8')
    expect(reviewer).toContain("import { generateAIObject } from '@/lib/ai'")
    expect(reviewer).not.toMatch(/from ['"]ai['"]|@ai-sdk\/openai|@ai-sdk\/anthropic|@google\/generative-ai|new OpenAI/)
  })

  it('adds no persistence path, review UI, publish trigger, or runtime integration', () => {
    const changedProduction = [
      'types/cookingModeMapping.ts', 'lib/cookingModeMappingIdentity.ts',
      'lib/cookingModeMappingReviewer.ts', 'lib/cookingModeMappingProposal.ts',
      'lib/cookingModeMappingOrchestrator.ts', 'lib/cookingModeMappingRiskFacts.ts', 'lib/aiConfig.ts',
    ]
    expect(changedProduction.some(file => /app\/|components\/|firebase|recipes\.ts/.test(file))).toBe(false)
  })
})
