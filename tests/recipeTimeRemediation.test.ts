import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'

const {
  ALLOWED_FIELDS,
  buildAudit,
  getTotalTime,
  parseArgs,
  parseTimeToMinutes,
  validateManifest,
} = require('../update-recipe-times.js') as {
  ALLOWED_FIELDS: Set<string>
  buildAudit: (docs: unknown[], manifest?: unknown) => {
    proposedUpdates: Array<{ patch: Record<string, string>; resultingTotalMinutes: number }>
  }
  getTotalTime: (prep?: string, cook?: string) => { minutes: number; display: string }
  parseArgs: (args: string[]) => Record<string, unknown>
  parseTimeToMinutes: (value?: string) => number
  validateManifest: (manifest?: unknown) => unknown
}

function contentSha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

const excludedContent = 'instructions unavailable'
const baseManifest = {
  projectId: 'malignant-metro',
  excludedRecipes: [{
    id: 'incomplete',
    contentSha256: contentSha256(excludedContent),
    reason: 'No usable method.',
  }],
  updates: [{
    id: 'missing-times',
    kind: 'backfill',
    before: { prepTime: null, cookTime: null },
    after: { prepTime: '10 min', cookTime: '20 min' },
    evidence: 'Reviewed method.',
  }],
}

const baseCatalog = [
  {
    id: 'missing-times',
    data: { title: 'Missing Times', content: 'Ingredients and instructions' },
    updateTime: { toMillis: () => 1 },
  },
  {
    id: 'complete',
    data: { title: 'Complete', content: 'Complete method', prepTime: '5 min', cookTime: '0 min' },
    updateTime: { toMillis: () => 2 },
  },
  {
    id: 'incomplete',
    data: { title: 'Incomplete', content: excludedContent },
    updateTime: { toMillis: () => 3 },
  },
]

describe('recipe-time remediation safety', () => {
  it('matches application parsing and derived-total semantics', () => {
    expect(parseTimeToMinutes('PT1H15M')).toBe(75)
    expect(parseTimeToMinutes('1 hr 15 min')).toBe(75)
    expect(parseTimeToMinutes('15-18 minutes')).toBe(18)
    expect(parseTimeToMinutes('20 minutes (plus 2-6 hours marinating)')).toBe(380)
    expect(parseTimeToMinutes('0 min')).toBe(0)
    expect(getTotalTime('10 min', '1 hr 5 min')).toEqual({ minutes: 75, display: '1 hr 15 min' })
  })

  it('limits proposed patches to prepTime and cookTime', () => {
    const audit = buildAudit(baseCatalog, baseManifest)
    expect(audit.proposedUpdates).toHaveLength(1)
    expect(audit.proposedUpdates[0].patch).toEqual({ prepTime: '10 min', cookTime: '20 min' })
    expect(audit.proposedUpdates[0].resultingTotalMinutes).toBe(30)
    expect([...ALLOWED_FIELDS].sort()).toEqual(['cookTime', 'prepTime'])
  })

  it('fails closed when reviewed current values no longer match', () => {
    const changed = baseCatalog.map(doc => ({ ...doc, data: { ...doc.data } }))
    changed[0].data.prepTime = '5 min'
    expect(() => buildAudit(changed, baseManifest)).toThrow(/changed since review/)
  })

  it('fails closed when any usable recipe would remain incomplete', () => {
    const incompleteCatalog: any[] = baseCatalog.map(doc => ({ ...doc, data: { ...doc.data } }))
    incompleteCatalog.push({
      id: 'unreviewed',
      data: { title: 'Unreviewed', content: 'Method', prepTime: '5 min' },
      updateTime: { toMillis: () => 4 },
    })
    expect(() => buildAudit(incompleteCatalog, baseManifest)).toThrow(/coverage failed/)
  })

  it('rejects forbidden manifest fields and unknown CLI arguments', () => {
    const unsafe: any = structuredClone(baseManifest)
    unsafe.updates[0].after.totalTime = '30 min'
    expect(() => validateManifest(unsafe)).toThrow(/after fields invalid/)
    expect(() => parseArgs(['--deploy'])).toThrow(/unknown argument/)
  })
})
