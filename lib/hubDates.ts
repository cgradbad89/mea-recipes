const NEW_YORK = 'America/New_York'

/** Civil-date arithmetic uses UTC solely to avoid host zone and DST offsets. */
export function addCivilDays(date: string, days: number): string {
  const instant = new Date(`${date}T00:00:00Z`)
  instant.setUTCDate(instant.getUTCDate() + days)
  return instant.toISOString().slice(0, 10)
}

export function newYorkWeek(now: Date): { today: string; monday: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NEW_YORK, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)!.value
  const today = `${part('year')}-${part('month')}-${part('day')}`
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay()
  return { today, monday: addCivilDays(today, -(weekday === 0 ? 6 : weekday - 1)) }
}

export function hubPeriodLabel(monday: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: NEW_YORK, month: 'short', day: 'numeric',
  })
  // Noon UTC stays on the same civil date in New York throughout the year.
  const label = (date: string) => formatter.format(new Date(`${date}T12:00:00Z`))
  return `${label(monday)} to ${label(addCivilDays(monday, 6))}`
}
