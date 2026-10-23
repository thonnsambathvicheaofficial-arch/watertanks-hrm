// The leave side of the roster's Excel export: the grid of hours leaves leave days blank, so each person also gets their leave
// dates and reasons on their row, and a second sheet lists every leave day. Pure: it reads the roster built by lib/roster.js.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const shortDate = (date) => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`

// ts = the result of buildRoster: { days: [{ d, date }], rows: [{ pin, name, group, cells: { [day]: { status, note, leaveCode, leaveDays } } }] }
// Returns { byPin: Map(pin -> "23 Oct: Unpaid leave: reason; 26 Oct: …"), list: [[Date, Day, PIN, Name, Group, Code, Days, Note]] }.
function leaveDetails(ts, groupLabel = (g) => g || '') {
  const byPin = new Map(), list = []
  for (const r of ts.rows) {
    const parts = []
    for (const d of ts.days) {
      const c = r.cells[d.d]
      if (!c || c.status !== 'leave') continue
      const note = String(c.note || '').trim()
      parts.push(`${shortDate(d.date)}${note ? `: ${note}` : ''}`)
      list.push([d.date, DAYS[new Date(`${d.date}T00:00:00`).getDay()], r.pin, r.name, groupLabel(r.group), c.leaveCode || '', c.leaveDays != null ? c.leaveDays : 1, note])
    }
    if (parts.length) byPin.set(r.pin, parts.join('; '))
  }
  list.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : String(a[3]).localeCompare(String(b[3]))))
  return { byPin, list }
}

// The same one-line-per-person text, from a flat list of day rows (what the Reports exports have): [{ pin, date, status, note }].
function leaveLines(dayRows) {
  const byPin = new Map()
  for (const r of [...dayRows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    if (r.status !== 'leave') continue
    const note = String(r.note || '').trim()
    byPin.set(r.pin, [...(byPin.get(r.pin) || []), `${shortDate(r.date)}${note ? `: ${note}` : ''}`])
  }
  return new Map([...byPin].map(([pin, parts]) => [pin, parts.join('; ')]))
}

// The roster notes: HR's own note on a corrected day (day_overrides.note), per person and as a list. `status` is the corrected status.
function rosterDetails(ts, groupLabel = (g) => g || '', statusLabel = (s) => s || '') {
  const byPin = new Map(), list = []
  for (const r of ts.rows) {
    const parts = []
    for (const d of ts.days) {
      const c = r.cells[d.d]
      const note = c && String(c.rosterNote || '').trim()
      if (!note) continue
      parts.push(`${shortDate(d.date)}: ${note}`)
      list.push([d.date, DAYS[new Date(`${d.date}T00:00:00`).getDay()], r.pin, r.name, groupLabel(r.group), statusLabel(c.status), note])
    }
    if (parts.length) byPin.set(r.pin, parts.join('; '))
  }
  list.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : String(a[3]).localeCompare(String(b[3]))))
  return { byPin, list }
}

// The same one-line-per-person text from flat Reports day rows: [{ pin, date, rosterNote }].
function rosterLines(dayRows) {
  const byPin = new Map()
  for (const r of [...dayRows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    const note = String(r.rosterNote || '').trim()
    if (!note) continue
    byPin.set(r.pin, [...(byPin.get(r.pin) || []), `${shortDate(r.date)}: ${note}`])
  }
  return new Map([...byPin].map(([pin, parts]) => [pin, parts.join('; ')]))
}

const ROSTER_HEADER = ['Date', 'Day', 'PIN', 'Name', 'Group', 'Status', 'Note']
const LEAVE_HEADER = ['Date', 'Day', 'PIN', 'Name', 'Group', 'Code', 'Days', 'Reason']

module.exports = { leaveDetails, leaveLines, rosterDetails, rosterLines, LEAVE_HEADER, ROSTER_HEADER, shortDate }
