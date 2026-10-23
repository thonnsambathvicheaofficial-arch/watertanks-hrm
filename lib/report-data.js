// Report data assembly shared by the Next.js pages. Same logic the legacy
// Express server uses in reportData(): fetch a +-1 day margin so shifts that
// cross midnight pair correctly, canonicalise PINs (device remap, then aliases),
// then roll up. Kept in lib/ so every screen and export reads one path.
const store = require('./store')
const { dailyRows, summaryRows, aliasToPrimary } = require('./attendance')
const { applyPinRemaps } = require('./pinremap')
const hr = require('./hr-store')
const leave = require('./leave-store')
const { matchesDepartment, matchesGroup } = require('./staff-filter')
const { normalizeRange } = require('./validate')

const pad = n => String(n).padStart(2, '0')
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const todayStr = () => fmt(new Date())
const monthStartStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01` }
const shiftDate = (s, delta) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + delta); return fmt(d) }

function canonPunches(punches, employees) {
  punches = applyPinRemaps(punches)
  const a = aliasToPrimary(employees)
  return Object.keys(a).length ? punches.map(p => (a[p.pin] ? { ...p, pin: a[p.pin] } : p)) : punches
}

async function reportData(q = {}) {
  // A missing or invalid date means the default; a range longer than ~13 months is cut short (and says so in `note`).
  const { from, to, note } = normalizeRange(q.from, q.to, { from: monthStartStr(), to: todayStr() })
  // Rotation plans and per-shift grace ride along on each employee (no-op until the migration is run).
  // Every read below is independent of the others, so they run together: two rounds of waiting on
  // the database instead of nine. (Each round trip is slow from here, so this is most of the page time.)
  const [rawEmployees, rawPunches, settings, rangeOverrides] = await Promise.all([
    store.employees.get(),
    store.punches.query({ deviceId: q.deviceId, from: shiftDate(from, -1), to: shiftDate(to, 1) }),
    store.settings.get(),
    q.skipOverrides ? [] : store.overrides.query({ from, to }),
  ])
  // Rotation plans and holidays/leave both need the staff list; they read different tables.
  const [allEmployees, extra] = await Promise.all([hr.decorate(rawEmployees), leave.extraFor(from, to, rawEmployees)])
  let punches = canonPunches(rawPunches, allEmployees)
  // Narrow to a group (office / worker) and/or a department. Both may be given; a person must match every one given.
  const group = q.group || null
  const dept = q.departmentId || q.department || null
  const only = Array.isArray(q.pins) ? new Set(q.pins.map(String)) : null   // e.g. the people a staff search found
  const allowed = (group || dept || only)
    ? new Set(Object.keys(allEmployees).filter(p => matchesGroup(group, allEmployees[p].group) && matchesDepartment(dept, allEmployees[p].departmentId) && (!only || only.has(p))))
    : null
  const pin = q.pin ? (aliasToPrimary(allEmployees)[String(q.pin)] || String(q.pin)) : null
  if (allowed) punches = punches.filter(p => allowed.has(p.pin))
  if (pin) punches = punches.filter(p => p.pin === pin)
  let employees = allEmployees
  if (pin) employees = Object.fromEntries(Object.entries(employees).filter(([k]) => k === pin))
  if (allowed) employees = Object.fromEntries(Object.entries(employees).filter(([k]) => allowed.has(k)))
  const overrides = pin ? rangeOverrides.filter(o => o.pin === pin) : rangeOverrides
  let daily = dailyRows(punches, employees, settings, overrides, from, to, extra)
  // Employment window: no rows before the joining date or after the resigned date.
  daily = daily.filter(r => { const e = allEmployees[r.pin]; return !e || ((!e.joiningDate || r.date >= e.joiningDate) && (!e.resignedDate || r.date <= e.resignedDate)) })
  const scoped = punches.filter(p => { const d = p.time.slice(0, 10); return d >= from && d <= to })
  return { from, to, note, punches: scoped, daily, summary: summaryRows(daily), employees: allEmployees, names: Object.fromEntries(Object.entries(allEmployees).map(([k, e]) => [k, e.name || ''])) }
}

const defaultRange = () => ({ from: monthStartStr(), to: todayStr() })

module.exports = { reportData, canonPunches, todayStr, monthStartStr, shiftDate, fmt, defaultRange }
