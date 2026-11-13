import { describe, expect, it } from 'vitest'
import { parsePlanDestination } from '@/lib/planDestination'

describe('plan destination validation', () => {
  it.each([
    ['2026-11-09', '2026-11-12', true], ['2025-12-29', '2026-01-04', true],
    ['2026-11-09', 'unscheduled', true], ['2026-11-10', '2026-11-10', false],
    ['2026-11-09', '2026-11-16', false], ['2026-02-30', 'unscheduled', false],
    ['2026-11-09', '2026-11-31', false], ['2026-11-09', null, false],
  ])('validates %s / %s', (week, day, valid) => {
    expect(Boolean(parsePlanDestination(week, day))).toBe(valid)
  })
})
