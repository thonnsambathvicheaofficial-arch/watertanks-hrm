// The discipline register: guidance, warnings and the salary deductions that go with them.
// Table from migrations/009_discipline.sql (run by hand); until then ready() is false and everything is empty.
//
// A record starts as a DRAFT and changes nothing. Confirming it is the one step that moves money: a salary deduction
// becomes a negative "withholding" on Monthly items for the chosen payroll month, and the record keeps the link, so the
// two stay together. Withdrawing a confirmed record removes that payroll item again. A payroll month that is already
// finalized cannot be touched; the message says what to do instead. Records are never deleted once confirmed.
const sb = require('./supabase')
const hr = require('./hr-store')
const pr = require('./payroll-store')
const D = require('./discipline')
const { isUuid } = require('./validate')
const { todayStr } = require('./report-data')

const { UserError } = hr
const fail = (m) => { throw new UserError(m) }
const pad = (n) => String(n).padStart(2, '0')

let probe = { at: 0, ok: false }
async function ready() {
  if (Date.now() - probe.at < 15000) return probe.ok
  const { error } = await sb.from('discipline_records').select('id').limit(1)
  probe = { at: Date.now(), ok: !error }
  if (error && !/relation|schema cache|does not exist|Could not find/i.test(error.message || '')) throw new Error(error.message)
  return probe.ok
}

const toRecord = (r) => ({
  id: r.id, pin: r.pin || null, staffCode: r.staff_code || '', staffName: r.staff_name || '', position: r.position || '', department: r.department || '', source: r.source || 'app', importKey: r.import_key || null, occurredOn: String(r.occurred_on).slice(0, 10), kind: r.kind, reason: r.reason,
  deduction: r.deduction == null ? null : Number(r.deduction), payrollYear: r.payroll_year, payrollMonth: r.payroll_month,
  status: r.status, payrollEntryId: r.payroll_entry_id || null,
  letterIssuedOn: r.letter_issued_on || null, letterIssuedBy: r.letter_issued_by || '', acknowledgedOn: r.acknowledged_on || null,
  createdBy: r.created_by || '', createdAt: r.created_at, confirmedBy: r.confirmed_by || '', confirmedAt: r.confirmed_at,
  withdrawnBy: r.withdrawn_by || '', withdrawnAt: r.withdrawn_at, withdrawnReason: r.withdrawn_reason || '',
})

// The people the register shows: pin -> { staffCode, name, nameKh, position, departmentId, departmentName, group }.
async function people() {
  const [staff, depts] = await Promise.all([hr.staff.list(), hr.available().then(a => (a ? hr.departments.list() : []))])
  const dn = Object.fromEntries(depts.map(d => [d.id, d.name]))
  return Object.fromEntries(staff.map(s => [s.pin, { staffCode: s.staffCode || '', name: s.name || '', nameKh: s.nameKh || '', position: s.position || '', departmentId: s.departmentId || '', departmentName: dn[s.departmentId] || '', group: s.group || null }]))
}

const selectAll = require('./select-all')

const records = {
  ready, people,
  // filters: { from, to, kind, status, departmentId ('none' = no department), q (name, PIN or staff ID), pin }
  list: async (f = {}) => {
    if (!(await ready())) return []
    let rows = (await selectAll('discipline_records', q => {
      q = q.select('*').order('occurred_on', { ascending: true }).order('created_at', { ascending: true }).order('id')
      if (f.from) q = q.gte('occurred_on', f.from)
      if (f.to) q = q.lte('occurred_on', f.to)
      if (f.kind) q = q.eq('kind', f.kind)
      if (f.status) q = q.eq('status', f.status)
      if (f.pin) q = q.eq('pin', f.pin)
      return q
    })).map(toRecord)
    if (f.departmentId || f.q) {
      const ppl = await people()
      const needle = String(f.q || '').trim().toLowerCase()
      rows = rows.filter(r => {
        const p = ppl[r.pin] || {}
        // A person who is not in the staff list has no department id, so a department filter leaves them out (they show under "No department").
        if (f.departmentId && (f.departmentId === 'none' ? p.departmentId : p.departmentId !== f.departmentId)) return false
        const w = D.who(r, ppl)
        if (needle && !((r.pin || '').includes(needle) || (w.name || '').toLowerCase().includes(needle) || (w.staffCode || '').toLowerCase().includes(needle) || (w.nameKh || '').includes(needle))) return false
        return true
      })
    }
    return rows
  },
  get: async (id) => {
    if (!isUuid(id) || !(await ready())) return null
    const { data, error } = await sb.from('discipline_records').select('*').eq('id', id).maybeSingle()
    if (error) throw new Error(error.message)
    return data ? toRecord(data) : null
  },

  add: async (input) => {
    if (!(await ready())) fail('The discipline register needs migration 009 first. Ask whoever runs the database to run it.')
    const c = D.check(input, todayStr())
    if (c.error) fail(c.error)
    const v = c.value
    const who = (await people())[v.pin]
    if (!who) fail('That staff member no longer exists.')
    const { data, error } = await sb.from('discipline_records').insert({
      pin: v.pin, staff_code: who.staffCode || null, staff_name: who.name || null, position: who.position || null, department: who.departmentName || null, occurred_on: v.occurredOn, kind: v.kind, reason: v.reason, deduction: v.deduction, payroll_year: v.payrollYear, payroll_month: v.payrollMonth, created_by: input.by || null,
    }).select('id').single()
    if (error) { if (error.code === '23503') fail('That staff member no longer exists.'); throw new Error(error.message) }
    return data.id
  },

  // Only a draft can be edited. A confirmed record is withdrawn and recorded again, so the history stays honest.
  update: async (id, input) => {
    const cur = await records.get(id)
    if (!cur) fail('That record no longer exists.')
    if (cur.status !== 'draft') fail('Only a draft can be changed. Withdraw this record and record it again.')
    const c = D.check({ ...input, pin: cur.pin }, todayStr())
    if (c.error) fail(c.error)
    const v = c.value
    const { error } = await sb.from('discipline_records').update({ occurred_on: v.occurredOn, kind: v.kind, reason: v.reason, deduction: v.deduction, payroll_year: v.payrollYear, payroll_month: v.payrollMonth }).eq('id', id).eq('status', 'draft')
    if (error) throw new Error(error.message)
  },

  // A draft that was never confirmed can simply be discarded.
  discard: async (id) => {
    const cur = await records.get(id)
    if (!cur) return
    if (cur.status !== 'draft') fail('Only a draft can be discarded. A confirmed record is withdrawn instead.')
    const { error } = await sb.from('discipline_records').delete().eq('id', id).eq('status', 'draft')
    if (error) throw new Error(error.message)
  },

  // Confirming makes the record official, and moves a salary deduction into payroll.
  confirm: async (id, by) => {
    const cur = await records.get(id)
    if (!cur) fail('That record no longer exists.')
    if (cur.status !== 'draft') fail('This record is already confirmed.')
    let entryId = null
    if (cur.deduction) {
      if (!(await pr.ready())) fail('Payroll is not set up yet, so the salary deduction cannot be added to it. Run the payroll migration first.')
      // Throws a plain message if that payroll month is finalized.
      entryId = await pr.entries.add({
        pin: cur.pin, year: cur.payrollYear, month: cur.payrollMonth, kind: 'withholding', amount: -cur.deduction,
        label: `Discipline: ${D.kindLabel(cur.kind)}`, remarks: `${cur.occurredOn}: ${cur.reason}`.slice(0, 300), by,
      })
    }
    const { data, error } = await sb.from('discipline_records').update({ status: 'confirmed', confirmed_by: by || null, confirmed_at: new Date().toISOString(), payroll_entry_id: entryId }).eq('id', id).eq('status', 'draft').select('id')
    if (error || !data || !data.length) {
      if (entryId) { try { await pr.entries.remove(entryId) } catch { /* nothing more to undo */ } }   // never leave a deduction in payroll for a record that is not confirmed
      if (error) throw new Error(error.message)
      fail('This record was just changed by someone else. Reload and try again.')
    }
    return { entryId }
  },

  // Withdrawing removes the payroll deduction again. If that month is finalized it cannot be, and the message says so.
  withdraw: async (id, { reason, by } = {}) => {
    const cur = await records.get(id)
    if (!cur) fail('That record no longer exists.')
    if (cur.status === 'withdrawn') fail('This record is already withdrawn.')
    if (cur.status === 'draft') fail('A draft is discarded, not withdrawn.')
    const why = String(reason || '').trim()
    if (!why) fail('Say why it is being withdrawn.')
    if (cur.payrollEntryId) await pr.entries.remove(cur.payrollEntryId)
    const { error } = await sb.from('discipline_records').update({ status: 'withdrawn', withdrawn_by: by || null, withdrawn_at: new Date().toISOString(), withdrawn_reason: why, payroll_entry_id: null }).eq('id', id)
    if (error) throw new Error(error.message)
  },

  // Marks that the warning letter was issued (first time only; reprinting does not change who or when).
  issueLetter: async (id, by) => {
    const cur = await records.get(id)
    if (!cur) fail('That record no longer exists.')
    if (cur.status !== 'confirmed') fail('Confirm the record before issuing its letter.')
    if (cur.kind === 'noted') fail('A note with no action has no letter.')
    if (cur.letterIssuedOn) return cur.letterIssuedOn
    const today = todayStr()
    const { error } = await sb.from('discipline_records').update({ letter_issued_on: today, letter_issued_by: by || null }).eq('id', id)
    if (error) throw new Error(error.message)
    return today
  },

  // ── the factory's Excel register ──
  // Which of these import keys are already saved (so a second import of the same file adds nothing).
  importKeysSaved: async (keys) => {
    if (!(await ready()) || !keys.length) return new Set()
    const out = new Set()
    for (let i = 0; i < keys.length; i += 100) {
      const { data, error } = await sb.from('discipline_records').select('import_key').in('import_key', keys.slice(i, i + 100))
      if (error) throw new Error(error.message)
      for (const r of data || []) out.add(r.import_key)
    }
    return out
  },
  // One row of the register. It is history: confirmed straight away, and its deduction (already taken from pay before this
  // system) is NOT sent to payroll. pin is null for someone who is not in the staff list; the record then carries their name.
  importOne: async (d, by) => {
    if (!(await ready())) fail('The discipline register needs migration 009 first.')
    if (!D.KINDS[d.kind]) fail('Unknown type.')
    if (!d.pin && !String(d.staffName || '').trim()) fail('The row has no staff member.')
    const { error } = await sb.from('discipline_records').insert({
      pin: d.pin || null, staff_code: d.staffCode || null, staff_name: d.staffName || null, position: d.position || null, department: d.department || null,
      occurred_on: d.occurredOn, kind: d.kind, reason: d.reason, deduction: d.deduction || null,
      payroll_year: d.deduction ? Number(d.occurredOn.slice(0, 4)) : null, payroll_month: d.deduction ? Number(d.occurredOn.slice(5, 7)) : null,
      status: 'confirmed', source: 'import', import_key: d.importKey, created_by: by || null, confirmed_by: by || null, confirmed_at: new Date().toISOString(),
    })
    if (error) { if (error.code === '23505') fail('This row was already imported.'); throw new Error(error.message) }
  },

  // The staff member has signed the letter.
  acknowledge: async (id, date) => {
    const cur = await records.get(id)
    if (!cur) fail('That record no longer exists.')
    if (cur.status !== 'confirmed') fail('Only a confirmed record can be marked as signed.')
    const d = String(date || '').trim() || todayStr()
    if (!D.validDate(d)) fail('Enter the date it was signed.')
    if (d > todayStr()) fail('The signing date cannot be in the future.')
    const { error } = await sb.from('discipline_records').update({ acknowledged_on: d }).eq('id', id)
    if (error) throw new Error(error.message)
  },
}

module.exports = { records, ready, people }
