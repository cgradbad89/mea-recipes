// Week document identity follows the local calendar, including across DST.
export function weekIDFromDate(date: Date): string {
  const monday = new Date(date)
  const day = monday.getDay()
  monday.setDate(monday.getDate() - day + (day === 0 ? -6 : 1))
  const year = String(monday.getFullYear()).padStart(4, '0')
  const month = String(monday.getMonth() + 1).padStart(2, '0')
  const dayOfMonth = String(monday.getDate()).padStart(2, '0')
  return `${year}-${month}-${dayOfMonth}`
}

// Browser memory only: never use the original non-Monday key for a Firestore read.
export function normalizeRememberedWeekID(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(value + 'T12:00:00')
  if (!Number.isFinite(date.getTime()) || date.getFullYear() !== year ||
      date.getMonth() + 1 !== month || date.getDate() !== day) return null
  return weekIDFromDate(date)
}
