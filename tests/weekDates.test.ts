import { beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const cases = [
  ['Sunday morning', '2026-10-04T08:00:00', '2026-09-28'],
  ['Sunday noon', '2026-10-04T12:00:00', '2026-09-28'],
  ['October 4 evening', '2026-10-04T20:30:00', '2026-09-28'],
  ['October 11 evening', '2026-10-11T20:30:00', '2026-10-05'],
  ['Monday morning', '2026-10-05T08:00:00', '2026-10-05'],
  ['Monday evening', '2026-10-05T20:30:00', '2026-10-05'],
  ['midweek evening', '2026-10-07T21:00:00', '2026-10-05'],
  ['month crossing', '2026-11-01T20:30:00', '2026-10-26'],
  ['year crossing', '2027-01-01T20:30:00', '2026-12-28'],
  ['spring before jump', '2026-03-08T01:30:00', '2026-03-02'],
  ['spring after jump', '2026-03-08T03:30:00', '2026-03-02'],
  ['spring evening', '2026-03-08T20:30:00', '2026-03-02'],
  ['spring Monday', '2026-03-09T20:30:00', '2026-03-09'],
  ['fall before rollback', '2026-11-01T00:30:00', '2026-10-26'],
  ['fall after rollback', '2026-11-01T02:30:00', '2026-10-26'],
  ['fall Monday', '2026-11-02T20:30:00', '2026-11-02'],
] as const
const remembered = [
  ['2026-09-28', '2026-09-28'],
  ['2026-09-29', '2026-09-28'],
  ['2026-10-06', '2026-10-05'],
  ['2027-01-01', '2026-12-28'],
  ['2028-02-29', '2028-02-28'],
  ['malformed', null],
  ['2026-02-29', null],
  ['2026-02-30', null],
  ['2026-13-01', null],
  ['2026-10-06T00:00:00Z', null],
  ['2026-9-29', null],
  ['', null],
  [null, null],
] as const
let result: { zone: string; weeks: string[]; offsets: number[]; remembered: Array<string | null>; adjacent: string[] }

beforeAll(() => {
  // Run the actual production helper in a fresh TZ-controlled Node process.
  // Setting TZ inside a Vitest worker can depend on the host's thread/date cache.
  const moduleURL = pathToFileURL(resolve('lib/weekDates.ts')).href
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `
    import { weekIDFromDate, normalizeRememberedWeekID } from ${JSON.stringify(moduleURL)};
    const dates = ${JSON.stringify(cases.map(([, value]) => value))}.map(value => new Date(value));
    const adjacent = [0, 1, 2, 3, 4].map(offset => {
      const date = new Date('2026-10-04T20:30:00');
      date.setDate(date.getDate() + offset * 7);
      return weekIDFromDate(date);
    });
    process.stdout.write(JSON.stringify({
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      weeks: dates.map(weekIDFromDate), offsets: dates.map(date => date.getTimezoneOffset()),
      remembered: ${JSON.stringify(remembered.map(([value]) => value))}.map(normalizeRememberedWeekID),
      adjacent,
    }));
  `], { encoding: 'utf8', env: { ...process.env, TZ: 'America/New_York' } })
  expect(child.error).toBeUndefined()
  expect(child.status, child.stderr).toBe(0)
  result = JSON.parse(child.stdout)
})

describe('local-calendar Monday week identity', () => {
  it('actually runs in New York and crosses both DST offsets', () => {
    expect(result.zone).toBe('America/New_York')
    expect(result.offsets[9]).toBe(300)
    expect(result.offsets[10]).toBe(240)
    expect(result.offsets[13]).toBe(240)
    expect(result.offsets[14]).toBe(300)
  })
  it.each(cases)('%s (%s) produces %s', (_name, _input, expected) => {
    const index = cases.findIndex(([name]) => name === _name)
    expect(result.weeks[index]).toBe(expected)
  })
  it('keeps all five picker/Discover offsets on consecutive Mondays', () => {
    expect(result.adjacent).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'])
  })
  it.each(remembered)('normalizes browser memory %s to %s', (input, expected) => {
    expect(result.remembered[remembered.findIndex(([value]) => value === input)]).toBe(expected)
  })
})
