// Everything the Live dashboard shows, computed from one day of report rows. Pure (no database, no clock of its own),
// so it is tested directly and the page only has to lay the answers out.
const { labelScans } = require('./notify')

const toMin = (hhmm) => { const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null }
const ts = (t) => String(t).replace('T', ' ')
const hhmm = (t) => ts(t).slice(11, 16)

// A reader that has not been checked for this long during working hours needs attention.
const STALE_MIN = 10
const WORK_FROM_MIN = 5 * 60, WORK_TO_MIN = 20 * 60

function summarize({ rows, employees, departments = [], punches = [], devices = [], nowMin, nowMs, latest = 30 }) {
  const deptName = Object.fromEntries(departments.map(d => [d.id, d.name]))
  const deptOf = (pin) => deptName[employees[pin] && employees[pin].departmentId] || ''
  const byStatus = (s) => rows.filter(r => r.status === s)

  const present = byStatus('present'), late = byStatus('late'), notYet = byStatus('absent'), leave = byStatus('leave')
  const counts = {
    expected: present.length + late.length + notYet.length,
    onTime: present.length,
    late: late.length,
    notYet: notYet.length,
    leave: leave.length,
    dayOff: byStatus('day_off').length,
    other: rows.length - present.length - late.length - notYet.length - leave.length - byStatus('day_off').length,
  }
  counts.in = counts.onTime + counts.late
  counts.pctIn = counts.expected ? Math.round((counts.in / counts.expected) * 100) : 0
  counts.lateMinutes = late.reduce((n, r) => n + (r.minutesLate || 0), 0)

  // Who has not scanned: the ones whose shift started longest ago first, so the real problems lead.
  const notIn = notYet.map(r => {
    const start = employees[r.pin] && employees[r.pin].timeIn || null
    const s = toMin(start)
    return { pin: r.pin, name: r.name || r.pin, dept: deptOf(r.pin), start, overdueMin: s == null || nowMin == null ? null : Math.max(0, nowMin - s) }
  }).sort((a, b) => (b.overdueMin ?? -1) - (a.overdueMin ?? -1) || a.name.localeCompare(b.name))

  const lateList = late.map(r => ({ pin: r.pin, name: r.name || r.pin, dept: deptOf(r.pin), in: r.in, minutesLate: r.minutesLate || 0 }))
    .sort((a, b) => b.minutesLate - a.minutesLate || a.name.localeCompare(b.name))

  const leaveList = leave.map(r => ({ pin: r.pin, name: r.name || r.pin, dept: deptOf(r.pin), code: r.leaveCode || '', days: r.leaveDays || null, note: r.note || '' }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Department table: only people the day expects something from (present, late, not yet, on leave).
  const dep = new Map()
  for (const r of rows) {
    if (!['present', 'late', 'absent', 'leave'].includes(r.status)) continue
    const id = (employees[r.pin] && employees[r.pin].departmentId) || ''
    if (!dep.has(id)) dep.set(id, { id, name: id ? (deptName[id] || 'Unknown') : 'No department', onTime: 0, late: 0, notYet: 0, leave: 0 })
    const d = dep.get(id)
    if (r.status === 'present') d.onTime++; else if (r.status === 'late') d.late++; else if (r.status === 'absent') d.notYet++; else d.leave++
  }
  const byDepartment = [...dep.values()].map(d => ({ ...d, total: d.onTime + d.late + d.notYet + d.leave, in: d.onTime + d.late }))
    .sort((a, b) => (a.id === '') - (b.id === '') || b.notYet - a.notYet || a.name.localeCompare(b.name))

  // Scans from a PIN that belongs to nobody on the staff list (a person not entered yet, or a mistyped PIN).
  const unknown = new Map()
  for (const p of punches) if (!employees[p.pin]) { const u = unknown.get(p.pin) || { pin: p.pin, scans: 0, last: '' }; u.scans++; if (ts(p.time) > u.last) u.last = ts(p.time); unknown.set(p.pin, u) }

  // Latest scans, newest first, each marked in or out the same way the Telegram messages are, and late when it is the late arrival.
  const rowByPin = new Map(rows.map(r => [r.pin, r]))
  const asc = [...punches].sort((a, b) => (ts(a.time) < ts(b.time) ? -1 : 1))
  const dir = new Map()   // pin -> labels in ascending order
  const idxByPin = new Map()
  for (const p of asc) { if (!idxByPin.has(p.pin)) idxByPin.set(p.pin, []); idxByPin.get(p.pin).push(p) }
  for (const [pin, list] of idxByPin) dir.set(pin, labelScans(list.map(p => ts(p.time))))
  const seen = new Map()
  const labelled = asc.map(p => {
    const n = seen.get(p.pin) || 0; seen.set(p.pin, n + 1)
    const row = rowByPin.get(p.pin)
    const isLateArrival = !!row && row.status === 'late' && n === 0 && hhmm(p.time) === row.in
    return { id: p.id, pin: p.pin, time: ts(p.time), deviceId: p.deviceId, direction: dir.get(p.pin)[n], lateMin: isLateArrival ? row.minutesLate || 0 : 0 }
  })
  const recent = labelled.reverse().slice(0, latest)

  const scansPerDevice = new Map()
  for (const p of punches) scansPerDevice.set(p.deviceId, (scansPerDevice.get(p.deviceId) || 0) + 1)
  const readers = devices.map(d => {
    const last = Math.max(Date.parse(d.lastPullAt || '') || 0, Date.parse(d.fastAt || '') || 0) || null
    const ageMin = last && nowMs != null ? Math.max(0, Math.round((nowMs - last) / 60000)) : null
    const working = nowMin != null && nowMin >= WORK_FROM_MIN && nowMin <= WORK_TO_MIN
    const state = d.lastPullOk === false ? 'failed' : (working && (ageMin == null || ageMin > STALE_MIN)) ? 'stale' : 'ok'
    return { id: d.id, name: d.name, lastCheckMs: last, ageMin, scansToday: scansPerDevice.get(d.id) || 0, state, error: d.lastPullOk === false ? d.lastPullError || '' : '' }
  })

  return {
    counts, notIn, late: lateList, leave: leaveList, byDepartment, unknown: [...unknown.values()], recent, readers,
    lastScan: recent.length ? recent[0] : null, scansToday: punches.length,
  }
}

// "just now", "4 min ago", "2 h 5 min ago".
function ago(min) {
  if (min == null) return ''
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60), m = min % 60
  return m ? `${h} h ${m} min ago` : `${h} h ago`
}

module.exports = { summarize, ago, toMin, STALE_MIN }
