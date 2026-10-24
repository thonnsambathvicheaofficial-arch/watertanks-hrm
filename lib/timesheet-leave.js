// The notes side of the roster: its screen and its Excel exports. The grid of hours leaves leave days blank and says nothing about
// why a day was corrected, so each person also gets their leave reasons and their roster notes, dated, on their row; the Excel
// export adds a sheet listing every such day. Pure: it reads the roster built by lib/roster.js (or the Reports day rows).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const cap = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

const shortDate = (date) => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`

// A day's leave reason: what was recorded on the leave request ("Unpaid leave: family event"), or for a day HR set to Leave on the roster,
// that note. Empty when the day has no leave. A roster correction can win over approved leave (the day then reads Present or Excused):
// the reason is still shown, marked with what the roster says, so nothing recorded on leave is hidden.
function leaveOf(c, statusLabel = cap) {
  if (!c) return null
  const isLeaveDay = c.status === 'leave'
  const reason = String(c.leaveReason || (isLeaveDay ? c.note : '') || '').trim()
  if (!isLeaveDay && !reason) return null
  return { reason: `${reason}${!isLeaveDay ? ` (roster: ${statusLabel(c.status)})` : ''}`.trim(), isLeaveDay }
}

// ts = the result of buildRoster: { days: [{ d, date }], rows: [{ pin, name, group, cells: { [day]: { status, note, leaveReason, rosterNote, leaveCode, leaveDays } } }] }
// Returns { byPin: Map(pin -> "23 Oct: Unpaid leave: reason; 26 Oct: …"), entries: Map(pin -> ["23 Oct: …", …]), list: [[Date, Day, PIN, Name, Group, Code, Days, Reason]] }.
function leaveDetails(ts, groupLabel = (g) => g || '', statusLabel = cap) {
  const byPin = new Map(), entries = new Map(), list = []
  for (const r of ts.rows) {
    const parts = []
    for (const d of ts.days) {
      const c = r.cells[d.d]
      const l = leaveOf(c, statusLabel)
      if (!l) continue
      parts.push(`${shortDate(d.date)}${l.reason ? `: ${l.reason}` : ''}`)
      list.push([d.date, DAYS[new Date(`${d.date}T00:00:00`).getDay()], r.pin, r.name, groupLabel(r.group), l.isLeaveDay ? c.leaveCode || '' : '', l.isLeaveDay ? (c.leaveDays != null ? c.leaveDays : 1) : '', l.reason])
    }
    if (parts.length) { byPin.set(r.pin, parts.join('; ')); entries.set(r.pin, parts) }
  }
  list.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : String(a[3]).localeCompare(String(b[3]))))
  return { byPin, entries, list }
}

// The same one-line-per-person text, from a flat list of day rows (what the Reports exports have): [{ pin, date, status, note, leaveReason }].
function leaveLines(dayRows, statusLabel = cap) {
  const byPin = new Map()
  for (const r of [...dayRows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    const l = leaveOf(r, statusLabel)
    if (!l) continue
    byPin.set(r.pin, [...(byPin.get(r.pin) || []), `${shortDate(r.date)}${l.reason ? `: ${l.reason}` : ''}`])
  }
  return new Map([...byPin].map(([pin, parts]) => [pin, parts.join('; ')]))
}

// The roster notes: HR's own note on a corrected day (day_overrides.note), per person and as a list. `status` is the corrected status.
function rosterDetails(ts, groupLabel = (g) => g || '', statusLabel = (s) => s || '') {
  const byPin = new Map(), entries = new Map(), list = []
  for (const r of ts.rows) {
    const parts = []
    for (const d of ts.days) {
      const c = r.cells[d.d]
      const note = c && String(c.rosterNote || '').trim()
      if (!note) continue
      parts.push(`${shortDate(d.date)}: ${note}`)
      list.push([d.date, DAYS[new Date(`${d.date}T00:00:00`).getDay()], r.pin, r.name, groupLabel(r.group), statusLabel(c.status), note])
    }
    if (parts.length) { byPin.set(r.pin, parts.join('; ')); entries.set(r.pin, parts) }
  }
  list.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : String(a[3]).localeCompare(String(b[3]))))
  return { byPin, entries, list }
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
