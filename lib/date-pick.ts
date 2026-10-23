// Date maths for the date pickers: no time zones, no Date objects kept around, only YYYY-MM-DD text in and out.

const pad = (n: number) => String(n).padStart(2, '0')
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const utc = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) }
const fromUtc = (t: number) => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` }

// A real calendar date written YYYY-MM-DD.
export function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

// What a person types: 25/10/2026, 25-10-26, 25.10.2026, 5/1/2027 or 2026-10-25. Returns YYYY-MM-DD, or '' if it is not a real date.
export function parseDate(text: string): string {
  const t = String(text || '').trim()
  if (!t) return ''
  let y: number, m: number, d: number
  let hit = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  if (hit) { y = +hit[1]; m = +hit[2]; d = +hit[3] } else {
    hit = /^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{2}|\d{4})$/.exec(t)
    if (!hit) return ''
    d = +hit[1]; m = +hit[2]; y = hit[3].length === 2 ? 2000 + +hit[3] : +hit[3]
  }
  const iso = `${y}-${pad(m)}-${pad(d)}`
  return isRealDate(iso) ? iso : ''
}

export const formatDMY = (iso: string) => (isRealDate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '')
export const weekday = (iso: string) => DAY[new Date(utc(iso)).getUTCDay()]
export const weekdayLong = (iso: string) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(utc(iso)).getUTCDay()]
// "Mon 26 Oct"
export const formatShort = (iso: string) => (isRealDate(iso) ? `${weekday(iso)} ${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}` : '')

export const addDays = (iso: string, n: number) => fromUtc(utc(iso) + n * 86400000)
// Whole days from a to b, counting both ends (26th to 28th is 3).
export const daysInclusive = (a: string, b: string) => Math.round((utc(b) - utc(a)) / 86400000) + 1
export const orderRange = (a: string, b: string): [string, string] => (a <= b ? [a, b] : [b, a])

// YYYY-MM moved by n months.
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`
}

export const daysInMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate() }
// The same day number in another month, or that month's last day when it is shorter (31 January -> 28 February).
export const sameDayInMonth = (ym: string, day: number) => `${ym}-${pad(Math.min(day, daysInMonth(ym)))}`

// The 6 weeks (42 days) that show a month, Monday first. inMonth is false for the days borrowed from the neighbouring months.
export function monthGrid(ym: string): { date: string; inMonth: boolean; dow: number }[] {
  const first = `${ym}-01`
  const lead = (new Date(utc(first)).getUTCDay() + 6) % 7   // Monday = 0
  const start = utc(first) - lead * 86400000
  return Array.from({ length: 42 }, (_, i) => {
    const date = fromUtc(start + i * 86400000)
    return { date, inMonth: date.slice(0, 7) === ym, dow: new Date(utc(date)).getUTCDay() }
  })
}

// Today in Phnom Penh, as YYYY-MM-DD (the factory's day, whatever the viewer's computer is set to).
export const todayISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Phnom_Penh' })
