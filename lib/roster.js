// Month roster: every staff member by every day, built from the same engine
// output the reports use, so the grid, Reports and exports can never disagree.
const { reportData, todayStr } = require('./report-data')

const pad = n => String(n).padStart(2, '0')
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

async function buildRoster({ month, group, departmentId, pin }) {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  const from = `${month}-01`, to = `${month}-${pad(last)}`
  const { daily, holidaysInMonth } = await (async () => {
    // Group and department are filtered by the report engine itself, so the grid, Reports and exports agree.
    const r = await reportData({ from, to, group: group || undefined, departmentId: departmentId || undefined, pin: pin || undefined })
    return { daily: r.daily, holidaysInMonth: new Map(r.daily.filter(x => x.holiday).map(x => [x.date, x.holiday])) }
  })()

  const days = Array.from({ length: last }, (_, i) => {
    const d = i + 1, date = `${month}-${pad(d)}`, dow = new Date(y, m - 1, d).getDay()
    return { d, date, wd: WD[dow], sunday: dow === 0, holiday: holidaysInMonth.get(date) || null }
  })

  const today = todayStr()
  const byPin = new Map()
  for (const r of daily) {
    // A day that has not happened yet is not an absence. Leave, holidays and days off still show.
    if (r.date > today && r.status === 'absent') { if (!byPin.has(r.pin)) byPin.set(r.pin, { pin: r.pin, name: r.name || r.pin, group: r.group, cells: {}, t: { days: 0, hours: 0, late: 0, absent: 0, leave: 0, minLate: 0, early: 0 } }); continue }
    if (!byPin.has(r.pin)) byPin.set(r.pin, { pin: r.pin, name: r.name || r.pin, group: r.group, cells: {}, t: { days: 0, hours: 0, late: 0, absent: 0, leave: 0, minLate: 0, early: 0 } })
    const o = byPin.get(r.pin)
    o.cells[Number(r.date.slice(8, 10))] = {
      status: r.status, hours: r.hours, in: r.in, out: r.out, note: r.note, rosterNote: r.rosterNote, leaveReason: r.leaveReason, overridden: r.overridden,
      minutesLate: r.minutesLate, leaveCode: r.leaveCode, leaveDays: r.leaveDays, holiday: r.holiday,
    }
    if (['present', 'late', 'excused'].includes(r.status)) { o.t.days++; o.t.hours += r.hours }
    if (r.status === 'late') { o.t.late++; o.t.minLate += r.minutesLate || 0 }
    if (r.earlyLeave) o.t.early++
    if (r.status === 'absent') o.t.absent++
    if (r.status === 'leave') o.t.leave += r.leaveDays != null ? r.leaveDays : 1
  }
  const rows = [...byPin.values()]
    .map(o => ({ ...o, t: { ...o.t, hours: Math.round(o.t.hours * 10) / 10, leave: Math.round(o.t.leave * 10) / 10 } }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { month, from, to, days, rows }
}

module.exports = { buildRoster }
