// The discipline register's saving rules, run against an in-memory stand-in for the database and for payroll.
// What matters most: a salary deduction reaches payroll only on confirm, comes back out on withdraw, never gets stranded,
// and a finalized payroll month is never touched.
const path = require('path')

class UserError extends Error {}
const state = { finalized: false, entries: [], removed: [], raceOnConfirm: false }

// ── a tiny chainable fake of the parts of the Supabase client the store uses ──
const tables = { discipline_records: [] }
let seq = 0
function from(name) {
  const rows = tables[name]
  const q = { op: 'select', filters: [], payload: null, one: false, maybe: false }
  const match = (r) => q.filters.every(f => f(r))
  const run = () => {
    if (q.op === 'insert') {
      const row = { status: 'draft', payroll_entry_id: null, created_at: new Date().toISOString(), ...q.payload, id: 'rec-' + (++seq) }
      rows.push(row)
      return { data: q.one ? { id: row.id } : [{ id: row.id }], error: null }
    }
    if (q.op === 'update') {
      let hit = rows.filter(match)
      if (state.raceOnConfirm && q.payload.status === 'confirmed') { state.raceOnConfirm = false; hit = [] }
      hit.forEach(r => Object.assign(r, q.payload))
      return { data: hit.map(r => ({ id: r.id })), error: null }
    }
    if (q.op === 'delete') { const hit = rows.filter(match); hit.forEach(r => rows.splice(rows.indexOf(r), 1)); return { data: null, error: null } }
    const hit = rows.filter(match)
    if (q.maybe) return { data: hit[0] || null, error: null }
    return { data: hit, error: null }
  }
  const api = {
    select() { return api }, limit() { return api }, order() { return api }, gte() { return api }, lte() { return api },
    insert(p) { q.op = 'insert'; q.payload = p; return api }, update(p) { q.op = 'update'; q.payload = p; return api }, delete() { q.op = 'delete'; return api },
    eq(k, v) { q.filters.push(r => r[k] === v); return api },
    single() { q.one = true; return api }, maybeSingle() { q.maybe = true; return api },
    then(res, rej) { return Promise.resolve(run()).then(res, rej) },
  }
  return api
}
const stub = (rel, exports) => { const f = require.resolve(path.join('../lib', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports } }
stub('supabase.js', { from })
stub('hr-store.js', { UserError, available: async () => true, staff: { list: async () => [] }, departments: { list: async () => [] } })
stub('report-data.js', { todayStr: () => '2026-10-21' })
stub('payroll-store.js', {
  ready: async () => true,
  entries: {
    add: async (o) => { if (state.finalized) throw new UserError(`Payroll for ${o.year}-${o.month} is finalized.`); state.entries.push(o); return 'entry-' + state.entries.length },
    remove: async (id) => { if (state.finalized) throw new UserError('Payroll for that month is finalized.'); state.removed.push(id) },
  },
})
const { records } = require('../lib/discipline-store.js')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }
const rejects = async (p, re) => { try { await p; return false } catch (e) { return e instanceof UserError && re.test(e.message) } }
const row = (id) => tables.discipline_records.find(r => r.id === id)
const base = { pin: '215', occurredOn: '2026-10-14', kind: 'verbal', reason: 'Late three times', deduction: '', payrollMonth: '', by: 'hr' }

;(async () => {
  console.log('a new record is only a draft')
  const a = await records.add(base)
  ok(row(a).status === 'draft' && row(a).deduction === null && state.entries.length === 0, 'it saves as a draft and nothing reaches payroll')
  ok(await rejects(records.add({ ...base, reason: '' }), /reason/), 'the same checks as the form apply')

  console.log('confirming without a deduction')
  await records.confirm(a, 'hr')
  ok(row(a).status === 'confirmed' && row(a).confirmed_by === 'hr' && state.entries.length === 0, 'it becomes confirmed and payroll is untouched')
  ok(await rejects(records.confirm(a, 'hr'), /already confirmed/), 'it cannot be confirmed twice')
  ok(await rejects(records.update(a, base), /Only a draft/) && await rejects(records.discard(a), /Only a draft/), 'a confirmed record cannot be edited or discarded')

  console.log('a salary deduction')
  const b = await records.add({ ...base, kind: 'written1', deduction: '5', payrollMonth: '2026-10' })
  ok(state.entries.length === 0, 'saving the draft with a deduction still does not touch payroll')
  const res = await records.confirm(b, 'hr')
  const e = state.entries[0]
  ok(state.entries.length === 1 && e.pin === '215' && e.year === 2026 && e.month === 10 && e.kind === 'withholding' && e.amount === -5, 'confirming adds a NEGATIVE withholding of the amount to that payroll month')
  ok(/First written warning/.test(e.label) && /Late three times/.test(e.remarks) && e.by === 'hr', 'the payroll item says what it is for and who confirmed it')
  ok(row(b).payroll_entry_id === res.entryId && res.entryId === 'entry-1', 'the record keeps the link to its payroll item')

  console.log('the letter and the signature')
  ok(await records.issueLetter(b, 'hr') === '2026-10-21' && row(b).letter_issued_by === 'hr', 'issuing the letter records the date and who')
  row(b).letter_issued_by = 'first-person'
  await records.issueLetter(b, 'someone-else')
  ok(row(b).letter_issued_by === 'first-person', 'reprinting never changes who issued it, or when')
  ok(await rejects(records.acknowledge(b, '2026-10-22'), /future/) && await rejects(records.acknowledge(b, 'x'), /date/), 'the signing date must be real and not in the future')
  await records.acknowledge(b, '2026-10-20')
  ok(row(b).acknowledged_on === '2026-10-20', 'the signing is recorded')
  const draft = await records.add(base)
  ok(await rejects(records.issueLetter(draft, 'hr'), /Confirm the record/) && await rejects(records.acknowledge(draft), /confirmed/), 'a draft has no letter and cannot be marked signed')

  console.log('withdrawing')
  ok(await rejects(records.withdraw(b, { by: 'hr' }), /Say why/), 'a withdrawal needs a reason')
  await records.withdraw(b, { reason: 'Mistaken identity', by: 'hr' })
  ok(row(b).status === 'withdrawn' && row(b).withdrawn_reason === 'Mistaken identity' && state.removed[0] === 'entry-1' && row(b).payroll_entry_id === null, 'withdrawing removes the payroll deduction and keeps the record')
  ok(await rejects(records.withdraw(b, { reason: 'x' }), /already withdrawn/) && await rejects(records.withdraw(draft, { reason: 'x' }), /discarded/), 'withdrawn twice or a draft cannot be withdrawn')

  console.log('a finalized payroll month is never touched')
  state.finalized = true
  const c = await records.add({ ...base, kind: 'final', deduction: '10', payrollMonth: '2026-09' })
  ok(await rejects(records.confirm(c, 'hr'), /finalized/) && row(c).status === 'draft' && row(c).payroll_entry_id === null, 'confirming into a finalized month fails and the record stays a draft')
  state.finalized = false
  await records.confirm(c, 'hr')
  state.finalized = true
  const before = state.removed.length
  ok(await rejects(records.withdraw(c, { reason: 'x' }), /finalized/) && row(c).status === 'confirmed' && state.removed.length === before, 'withdrawing a record whose month is now finalized fails and changes nothing')
  state.finalized = false

  console.log('never leave a stranded deduction')
  const d = await records.add({ ...base, deduction: '3', payrollMonth: '2026-10' })
  state.raceOnConfirm = true
  const added = state.entries.length, removedBefore = state.removed.length
  ok(await rejects(records.confirm(d, 'hr'), /just changed/) && row(d).status === 'draft' && state.entries.length === added + 1 && state.removed.length === removedBefore + 1, 'if the record changed under us, the payroll item that was just added is taken out again')

  console.log('drafts')
  const f = await records.add(base)
  await records.update(f, { occurredOn: '2026-10-15', kind: 'final', reason: 'Edited', deduction: '', payrollMonth: '' })
  ok(row(f).kind === 'final' && row(f).reason === 'Edited' && row(f).occurred_on === '2026-10-15', 'a draft can be edited')
  await records.discard(f)
  ok(!row(f), 'a draft can be discarded')

  console.log(fails ? `\n${fails} FAILED` : '\nall passed')
  process.exit(fails ? 1 : 0)
})().catch(e => { console.error('ERROR', e.stack); process.exit(1) })
