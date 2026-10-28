// Pure date maths for leave. No database, so it can be tested on its own.
//
// A leave request covers calendar dates, but only the days the person would
// actually have worked count: their own weekly days off and public holidays are
// skipped. A half day is one date and counts 0.5.

const pad = n => String(n).padStart(2, '0')
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parse = s => new Date(s + 'T00:00:00')

// Every "YYYY-MM-DD" from..to inclusive.
function dates(from, to) {
  const out = []
  for (const d = parse(from); d <= parse(to); d.setDate(d.getDate() + 1)) out.push(fmt(d))
  return out
}

const isWorkingDay = (date, offDays, holidays) =>
  !(offDays || []).includes(parse(date).getDay()) && !(holidays && holidays.has(date))

// Days of a request that count against the person's balance.
function leaveDays({ from, to, halfDayPeriod }, offDays, holidays) {
  if (halfDayPeriod) return isWorkingDay(from, offDays, holidays) ? 0.5 : 0
  return dates(from, to).filter(d => isWorkingDay(d, offDays, holidays)).length
}

// The dated entries the attendance engine needs: one per counted day.
function expandLeave(req, offDays, holidays, rangeFrom, rangeTo) {
  const out = []
  const half = !!req.halfDayPeriod
  for (const d of dates(req.from, req.to)) {
    if (rangeFrom && d < rangeFrom) continue
    if (rangeTo && d > rangeTo) continue
    if (!isWorkingDay(d, offDays, holidays)) continue
    out.push({ date: d, days: half ? 0.5 : 1 })
  }
  return out
}

// Fold same-day entries (a morning request plus an afternoon request) into one cell.
// The combined code always lists the leave types in their configured order (entry.rank),
// so it reads AL/UP whichever request the database returns first.
function addLeaveEntry(map, key, entry) {
  const cur = map.get(key)
  if (!cur) { map.set(key, { ...entry, parts: [{ code: entry.code, rank: entry.rank ?? 0, note: entry.note, days: entry.days, paid: entry.paid !== false, period: entry.period || null, typeName: entry.typeName || null }] }); return }
  const parts = [...cur.parts, { code: entry.code, rank: entry.rank ?? 0, note: entry.note, days: entry.days, paid: entry.paid !== false, period: entry.period || null, typeName: entry.typeName || null }]
    .sort((a, b) => a.rank - b.rank || (a.code < b.code ? -1 : 1))
  const codes = [...new Set(parts.map(p => p.code))]
  map.set(key, { code: codes.join('/'), note: parts.map(p => p.note).join(' + '), days: Math.round((cur.days + entry.days) * 10) / 10, parts })
}

module.exports = { dates, leaveDays, expandLeave, addLeaveEntry, isWorkingDay }
