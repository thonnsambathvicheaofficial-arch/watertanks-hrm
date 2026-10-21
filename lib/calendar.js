// Month grid for the Holidays calendar. Pure: no database, no clock of its own (the caller passes "today"), so it is tested directly.
// Weeks run Monday to Sunday: the factory works Monday to Saturday and Sunday is the usual day off, so Sunday is the last column.
const pad = n => String(n).padStart(2, '0')
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/
const DATE_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const isMonth = s => MONTH_RE.test(String(s || ''))
// A real calendar date, not just the right shape (2026-02-30 is not one).
function isDate(s) {
  const m = DATE_RE.exec(String(s || ''))
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}
const monthOf = date => String(date).slice(0, 7)
const monthLabel = month => { const [y, m] = month.split('-').map(Number); return `${MONTHS[m - 1]} ${y}` }
const shiftMonth = (month, n) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}` }
// 0 = Monday ... 6 = Sunday.
const weekdayIndex = date => { const [y, m, d] = date.split('-').map(Number); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7 }
const weekdayName = date => WEEKDAYS[weekdayIndex(date)]
const longDate = date => { const [y, m, d] = date.split('-').map(Number); return `${weekdayName(date)}, ${d} ${MONTHS[m - 1]} ${y}` }

// holidays: Map or object keyed by date -> { name, nameKh }. Returns { month, weeks }, each week 7 cells.
function buildMonth(month, holidays = {}, today = '') {
  if (!isMonth(month)) throw new Error('Bad month: ' + month)
  const get = d => (holidays instanceof Map ? holidays.get(d) : holidays[d]) || null
  const [y, m] = month.split('-').map(Number)
  const first = `${month}-01`
  const lead = weekdayIndex(first)                       // empty days before the 1st in the first week
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const total = Math.ceil((lead + daysIn) / 7) * 7
  const cells = []
  for (let i = 0; i < total; i++) {
    const dt = new Date(Date.UTC(y, m - 1, 1 - lead + i))
    const date = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
    const inMonth = monthOf(date) === month
    cells.push({ date, day: dt.getUTCDate(), inMonth, sunday: i % 7 === 6, today: date === today, holiday: inMonth ? get(date) : null })
  }
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return { month, weeks }
}

module.exports = { buildMonth, isMonth, isDate, monthOf, monthLabel, shiftMonth, weekdayIndex, weekdayName, longDate, MONTHS, WEEKDAYS }
