// A finalized payroll month must stay locked even when the database cannot answer the question "which month is this item in?".
// It used to skip the check on a read error and delete the item anyway.
const path = require('path')

class UserError extends Error {}
const state = { lookupFails: false, finalized: false, deleted: [] }

// A tiny chainable fake of the parts of the Supabase client these functions use.
function from(name) {
  const q = { op: 'select', cols: '' }
  const run = () => {
    if (q.op === 'delete') { state.deleted.push(name); return { data: null, error: null } }
    if (name === 'payroll_runs') return { data: state.finalized ? { id: 'r1', year: 2026, month: 9, status: 'finalized' } : null, error: null }
    if (name === 'payroll_entries') return state.lookupFails ? { data: null, error: { message: 'connection reset' } } : { data: { year: 2026, month: 9 }, error: null }
    if (name === 'overtime_entries') return state.lookupFails ? { data: null, error: { message: 'connection reset' } } : { data: { date: '2026-09-15' }, error: null }
    return { data: null, error: null }
  }
  const api = { select() { return api }, eq() { return api }, maybeSingle() { return api }, single() { return api }, delete() { q.op = 'delete'; return api }, then(res, rej) { return Promise.resolve(run()).then(res, rej) } }
  return api
}
const stub = (rel, exports) => { const f = require.resolve(path.join('../lib', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports } }
stub('supabase.js', { from })
stub('hr-store.js', { UserError })
stub('leave-store.js', {})
stub('store.js', {})
stub('report-data.js', { reportData: async () => ({}), todayStr: () => '2026-10-23', fmt: () => '' })
stub('payroll-attendance.js', { attendanceFigures: () => ({}), otTier: () => ({}), offDaysOn: () => [], suggestOvertime: () => [] })
stub('payroll-calc.js', { computeSlip: () => ({}), r2: (n) => n })
const pr = require('../lib/payroll-store.js')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }
const rejects = async (p, re) => { try { await p; return false } catch (e) { return re.test(e.message) } }

;(async () => {
  console.log('removing a monthly item')
  state.deleted.length = 0
  await pr.entries.remove('e1')
  ok(state.deleted.length === 1, 'an item in an open month is removed')

  state.finalized = true; state.deleted.length = 0
  ok(await rejects(pr.entries.remove('e1'), /finalized/) && state.deleted.length === 0, 'an item in a finalized month is refused and nothing is deleted')

  state.finalized = true; state.lookupFails = true; state.deleted.length = 0
  ok(await rejects(pr.entries.remove('e1'), /connection reset/) && state.deleted.length === 0, 'if the item cannot be looked up, nothing is deleted (it used to skip the lock and delete)')

  console.log('removing overtime')
  state.finalized = false; state.lookupFails = false; state.deleted.length = 0
  await pr.overtime.remove('o1')
  ok(state.deleted.length === 1, 'overtime in an open month is removed')

  state.finalized = true; state.deleted.length = 0
  ok(await rejects(pr.overtime.remove('o1'), /finalized/) && state.deleted.length === 0, 'overtime in a finalized month is refused')

  state.finalized = true; state.lookupFails = true; state.deleted.length = 0
  ok(await rejects(pr.overtime.remove('o1'), /connection reset/) && state.deleted.length === 0, 'if the overtime cannot be looked up, nothing is deleted')

  console.log(fails ? `\n${fails} FAILED` : '\nall passed')
  process.exit(fails ? 1 : 0)
})().catch(e => { console.error('ERROR', e.stack); process.exit(1) })
