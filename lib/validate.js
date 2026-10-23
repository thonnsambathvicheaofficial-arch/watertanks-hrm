// Checks for values that arrive in an address (?from=…&month=…) or in an id, shared by every page and export, so a
// mistyped or hand-edited address gives a sensible default or "not found" instead of a database error or a crash.

const pad = (n) => String(n).padStart(2, '0')
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// A real calendar date written YYYY-MM-DD ("2026-02-30" and "2026-13-45" are not).
function realDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(s + 'T00:00:00')
  return !Number.isNaN(d.getTime()) && fmt(d) === s
}

// A month written YYYY-MM, 01 to 12.
const realMonth = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (s) => typeof s === 'string' && UUID.test(s)

// The longest date range any report or export will read. A range of centuries makes the server read every scan in it and
// run out of memory, so a longer one is cut short (and the person is told) instead.
const MAX_RANGE_DAYS = 400

const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return fmt(d) }
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000)

// { from, to, note }. A missing or invalid date falls back to the default; an over-long range is shortened, with a note.
function normalizeRange(from, to, defaults) {
  const f = realDate(from) ? from : defaults.from
  let t = realDate(to) ? to : defaults.to
  let note = ''
  if (daysBetween(f, t) + 1 > MAX_RANGE_DAYS) {
    t = addDays(f, MAX_RANGE_DAYS - 1)
    note = `A range can be at most ${MAX_RANGE_DAYS} days, so this shows ${f} to ${t}.`
  }
  return { from: f, to: t, note }
}

module.exports = { realDate, realMonth, isUuid, normalizeRange, MAX_RANGE_DAYS }
