// Payroll data and orchestration: settings, pay setup, monthly items, overtime
// (suggested from scans, approved by HR), and payroll runs. The arithmetic lives
// in payroll-calc.js; tables come from migrations/003_payroll.sql, which the
// owner runs by hand. Until then ready() is false and every page shows a setup note.
const sb = require('./supabase')
const hr = require('./hr-store')
const lv = require('./leave-store')
const store = require('./store')
const { reportData, todayStr, fmt } = require('./report-data')
const { attendanceFigures, otTier, offDaysOn, suggestOvertime } = require('./payroll-attendance')
const { computeSlip, r2 } = require('./payroll-calc')

const { UserError } = hr
const fail = (m) => { throw new UserError(m) }
const YMD = /^\d{4}-\d{2}-\d{2}$/
const pad = (n) => String(n).padStart(2, '0')

const isMissingTable = (e) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /could not find the table|does not exist/i.test(e.message || ''))
let probe = { at: 0, ok: false }
async function ready() {
  if (Date.now() - probe.at < 15000) return probe.ok
  const { error } = await sb.from('payroll_settings').select('id').limit(1)
  probe = { at: Date.now(), ok: !error }
  if (error && !isMissingTable(error)) throw new Error(error.message)
  return probe.ok
}

const selectAll = require('./select-all')

const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v))
const monthRange = (year, month) => {
  const last = new Date(year, month, 0).getDate()
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}`, last }
}
const periodOk = (year, month) => { if (!(year >= 2000 && year <= 2100) || !(month >= 1 && month <= 12)) fail('Choose a valid month.') }

// ── settings ────────────────────────────────────────────────────────────────
const toSettings = (r, brackets) => ({
  exchangeRate: num(r.exchange_rate), dependentReliefKhr: num(r.dependent_relief_khr), nonResidentRate: num(r.non_resident_rate),
  nssfEmployeeRate: num(r.nssf_employee_rate), nssfEmployerPensionRate: num(r.nssf_employer_pension_rate),
  nssfEmployerHealthRate: num(r.nssf_employer_health_rate), nssfEmployerRiskRate: num(r.nssf_employer_risk_rate),
  nssfCeilingKhr: num(r.nssf_ceiling_khr), nssfFloorKhr: num(r.nssf_floor_khr),
  workDaysPerMonth: num(r.work_days_per_month), hoursPerDay: num(r.hours_per_day),
  otRateNormal: num(r.ot_rate_normal), otRateOff: num(r.ot_rate_off), otRateHoliday: num(r.ot_rate_holiday),
  otSuggestThresholdMin: Number(r.ot_suggest_threshold_min || 0), lateMode: r.late_mode || 'none', lateAmount: Number(r.late_amount || 0),
  updatedAt: r.updated_at, updatedBy: r.updated_by || '',
  brackets: (brackets || []).map(b => ({ min_amount: Number(b.min_amount), max_amount: b.max_amount == null ? null : Number(b.max_amount), rate: Number(b.rate), quick_deduction: Number(b.quick_deduction) })),
})

// Values HRM Hub's calculator uses when nothing is configured. OFFERED to the owner by a
// button, never applied silently. Overtime multipliers, work days and hours per day are
// deliberately NOT in this list: they are Song Fa's own policy.
const HRM_VALUES = {
  exchange_rate: 4100, dependent_relief_khr: 150000, non_resident_rate: 20,
  nssf_employee_rate: 2, nssf_employer_pension_rate: 2, nssf_employer_health_rate: 0.8, nssf_employer_risk_rate: 2.6,
  nssf_ceiling_khr: 1200000, nssf_floor_khr: 400000,
}
const HRM_BRACKETS = [
  { min_amount: 0, max_amount: 1500000, rate: 0, quick_deduction: 0 },
  { min_amount: 1500001, max_amount: 2000000, rate: 5, quick_deduction: 65000 },
  { min_amount: 2000001, max_amount: 8500000, rate: 10, quick_deduction: 165000 },
  { min_amount: 8500001, max_amount: 12500000, rate: 15, quick_deduction: 590000 },
  { min_amount: 12500001, max_amount: null, rate: 20, quick_deduction: 1225000 },
]

const settings = {
  get: async () => {
    const [{ data, error }, brackets] = await Promise.all([
      sb.from('payroll_settings').select('*').eq('id', 1).single(),
      selectAll('payroll_tax_brackets', q => q.select('*').order('sort_order').order('min_amount').order('id')),
    ])
    if (error) throw new Error(error.message)
    return toSettings(data, brackets)
  },

  // input uses the form field names; empty string clears a value.
  save: async (input, by) => {
    const rowNum = (key, label, { min = 0, max = null, int = false } = {}) => {
      const v = num(input[key]); if (v === null) return null
      if (!Number.isFinite(v) || v < min || (max !== null && v > max) || (int && !Number.isInteger(v))) fail(`${label} is not a valid number${max !== null ? ` between ${min} and ${max}` : ''}.`)
      return v
    }
    const row = {
      exchange_rate: rowNum('exchangeRate', 'Exchange rate', { min: 0.01 }),
      dependent_relief_khr: rowNum('dependentReliefKhr', 'Dependent relief'),
      non_resident_rate: rowNum('nonResidentRate', 'Non-resident tax rate', { max: 100 }),
      nssf_employee_rate: rowNum('nssfEmployeeRate', 'NSSF employee rate', { max: 100 }),
      nssf_employer_pension_rate: rowNum('nssfEmployerPensionRate', 'NSSF employer pension rate', { max: 100 }),
      nssf_employer_health_rate: rowNum('nssfEmployerHealthRate', 'NSSF employer health rate', { max: 100 }),
      nssf_employer_risk_rate: rowNum('nssfEmployerRiskRate', 'NSSF employer risk rate', { max: 100 }),
      nssf_ceiling_khr: rowNum('nssfCeilingKhr', 'NSSF ceiling'),
      nssf_floor_khr: rowNum('nssfFloorKhr', 'NSSF floor'),
      work_days_per_month: rowNum('workDaysPerMonth', 'Work days per month', { min: 1, max: 31 }),
      hours_per_day: rowNum('hoursPerDay', 'Hours per day', { min: 1, max: 24 }),
      ot_rate_normal: rowNum('otRateNormal', 'Normal-day overtime rate'),
      ot_rate_off: rowNum('otRateOff', 'Day-off overtime rate'),
      ot_rate_holiday: rowNum('otRateHoliday', 'Holiday overtime rate'),
      ot_suggest_threshold_min: rowNum('otSuggestThresholdMin', 'Overtime threshold', { int: true }) ?? 0,
      late_mode: ['none', 'per_day', 'per_minute'].includes(input.lateMode) ? input.lateMode : 'none',
      late_amount: rowNum('lateAmount', 'Late deduction amount') ?? 0,
      updated_at: new Date().toISOString(), updated_by: by || null,
    }
    if (row.nssf_floor_khr !== null && row.nssf_ceiling_khr !== null && row.nssf_floor_khr > row.nssf_ceiling_khr) fail('The NSSF floor is above the ceiling.')
    const { error } = await sb.from('payroll_settings').update(row).eq('id', 1)
    if (error) throw new Error(error.message)
  },

  saveBrackets: async (list) => {
    const rows = []
    for (const [i, b] of list.entries()) {
      const min = num(b.min), max = num(b.max), rate = num(b.rate), qd = num(b.quickDeduction)
      if (min === null && max === null && rate === null && qd === null) continue      // blank row
      if (min === null || rate === null) fail(`Bracket ${i + 1}: enter the lower limit and the rate.`)
      if (max !== null && max < min) fail(`Bracket ${i + 1}: the upper limit is below the lower limit.`)
      if (rate < 0 || rate > 100) fail(`Bracket ${i + 1}: the rate must be between 0 and 100.`)
      rows.push({ min_amount: min, max_amount: max, rate, quick_deduction: qd ?? 0, sort_order: i })
    }
    rows.sort((a, b) => a.min_amount - b.min_amount).forEach((r, i) => { r.sort_order = i })
    for (let i = 1; i < rows.length; i++) if (rows[i - 1].max_amount === null || rows[i].min_amount <= rows[i - 1].max_amount) fail('Brackets overlap. Each bracket must start above the previous one ends.')
    const { error: de } = await sb.from('payroll_tax_brackets').delete().not('id', 'is', null)
    if (de) throw new Error(de.message)
    if (rows.length) { const { error } = await sb.from('payroll_tax_brackets').insert(rows); if (error) throw new Error(error.message) }
  },

  // Fills only the fields that are still empty, and the brackets only if there are none.
  fillFromHrm: async (by) => {
    const cur = await settings.get()
    const map = { exchange_rate: 'exchangeRate', dependent_relief_khr: 'dependentReliefKhr', non_resident_rate: 'nonResidentRate', nssf_employee_rate: 'nssfEmployeeRate', nssf_employer_pension_rate: 'nssfEmployerPensionRate', nssf_employer_health_rate: 'nssfEmployerHealthRate', nssf_employer_risk_rate: 'nssfEmployerRiskRate', nssf_ceiling_khr: 'nssfCeilingKhr', nssf_floor_khr: 'nssfFloorKhr' }
    const patch = {}; let filled = 0
    for (const [col, key] of Object.entries(map)) if (cur[key] === null) { patch[col] = HRM_VALUES[col]; filled++ }
    if (Object.keys(patch).length) { patch.updated_at = new Date().toISOString(); patch.updated_by = by || null; const { error } = await sb.from('payroll_settings').update(patch).eq('id', 1); if (error) throw new Error(error.message) }
    let br = 0
    if (!cur.brackets.length) { const { error } = await sb.from('payroll_tax_brackets').insert(HRM_BRACKETS.map((b, i) => ({ ...b, sort_order: i }))); if (error) throw new Error(error.message); br = HRM_BRACKETS.length }
    return { filled, brackets: br }
  },
}

// What a run needs before it can be finalized, as a checklist for the settings page.
function readiness(s) {
  const items = [
    ['Exchange rate (KHR per USD)', s.exchangeRate !== null],
    ['Tax on salary brackets', s.brackets.length > 0],
    ['Dependent relief', s.dependentReliefKhr !== null],
    ['Non-resident tax rate', s.nonResidentRate !== null],
    ['NSSF employee and employer rates', [s.nssfEmployeeRate, s.nssfEmployerPensionRate, s.nssfEmployerHealthRate, s.nssfEmployerRiskRate].every(v => v !== null)],
    ['NSSF ceiling and floor', s.nssfCeilingKhr !== null && s.nssfFloorKhr !== null],
    ['Work days per month', s.workDaysPerMonth !== null],
    ['Hours per day', s.hoursPerDay !== null],
    ['Overtime multipliers (normal, day off, holiday)', [s.otRateNormal, s.otRateOff, s.otRateHoliday].every(v => v !== null)],
  ]
  return items.map(([label, done]) => ({ label, done }))
}

// ── pay setup per person ────────────────────────────────────────────────────
const toStructure = (r) => ({
  pin: r.pin, salary: num(r.salary), taxResident: r.tax_resident !== false, taxExempt: !!r.tax_exempt, nssfExempt: !!r.nssf_exempt,
  dependents: r.dependents || 0, paymentMethod: r.payment_method || '', bankName: r.bank_name || '', bankAccount: r.bank_account || '',
})
const structure = {
  list: async () => {
    const rows = await selectAll('payroll_structure', q => q.select('*').order('pin'))
    return Object.fromEntries(rows.map(r => [r.pin, toStructure(r)]))
  },
  // entries: [{ pin, salary, taxResident, taxExempt, nssfExempt, dependents, paymentMethod, bankName, bankAccount }]
  saveMany: async (entries, by) => {
    const rows = []
    for (const e of entries) {
      const salary = num(e.salary)
      if (salary !== null && (!Number.isFinite(salary) || salary < 0)) fail(`PIN ${e.pin}: salary must be a number of zero or more.`)
      const dep = Number(e.dependents || 0)
      if (!Number.isInteger(dep) || dep < 0) fail(`PIN ${e.pin}: dependents must be a whole number.`)
      if (e.paymentMethod && !['bank', 'cash'].includes(e.paymentMethod)) fail(`PIN ${e.pin}: payment method must be bank or cash.`)
      rows.push({ pin: e.pin, salary, tax_resident: e.taxResident !== false, tax_exempt: !!e.taxExempt, nssf_exempt: !!e.nssfExempt, dependents: dep, payment_method: e.paymentMethod || null, bank_name: String(e.bankName || '').trim() || null, bank_account: String(e.bankAccount || '').trim() || null, updated_at: new Date().toISOString(), updated_by: by || null })
    }
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from('payroll_structure').upsert(rows.slice(i, i + 500), { onConflict: 'pin' })
      if (error) throw new Error(error.message)
    }
    return rows.length
  },
}

// ── company allowances ──────────────────────────────────────────────────────
const allowances = {
  list: async () => (await selectAll('payroll_allowances', q => q.select('*').order('name').order('id'))).map(r => ({ id: r.id, name: r.name, kind: r.kind, amount: Number(r.amount), isActive: r.is_active })),
  save: async (id, input) => {
    const name = String(input.name || '').trim(); const amount = num(input.amount)
    if (!name) fail('Give the allowance a name.')
    if (amount === null || !(amount >= 0)) fail('Enter the amount.')
    const kind = input.kind === 'percent' ? 'percent' : 'fixed'
    if (kind === 'percent' && amount > 100) fail('A percentage cannot be more than 100.')
    const row = { name, kind, amount, is_active: input.isActive !== false }
    const { error } = id ? await sb.from('payroll_allowances').update(row).eq('id', id) : await sb.from('payroll_allowances').insert(row)
    if (error) { if (error.code === '23505') fail('There is already an allowance with that name.'); throw new Error(error.message) }
  },
  remove: async (id) => { const { error } = await sb.from('payroll_allowances').delete().eq('id', id); if (error) throw new Error(error.message) },
}

// ── runs ────────────────────────────────────────────────────────────────────
async function runFor(year, month) {
  const { data, error } = await sb.from('payroll_runs').select('*').eq('year', year).eq('month', month).maybeSingle()
  if (error) throw new Error(error.message)
  return data
}
const isFinalized = async (year, month) => { const r = await runFor(year, month); return !!r && r.status === 'finalized' }
const lockedMsg = (year, month) => `Payroll for ${year}-${pad(month)} is finalized. Record the correction as an adjustment next month instead.`

// ── monthly items ───────────────────────────────────────────────────────────
const KINDS = { bonus: 'Bonus', allowance: 'Allowance', advance: 'Advance or loan repayment', adjustment: 'Adjustment (+ or -)', withholding: 'Withholding (+ or -)' }
const entries = {
  KINDS,
  list: async (year, month) => {
    const rows = await selectAll('payroll_entries', q => q.select('*').eq('year', year).eq('month', month).order('created_at').order('id'))
    return rows.map(r => ({ id: r.id, pin: r.pin, kind: r.kind, label: r.label || '', amount: Number(r.amount), remarks: r.remarks || '', createdBy: r.created_by || '' }))
  },
  add: async ({ pin, year, month, kind, label, amount, remarks, by }) => {
    periodOk(year, month)
    if (!KINDS[kind]) fail('Choose what kind of item this is.')
    const a = num(amount)
    if (!String(pin || '').trim()) fail('Choose a staff member.')
    if (a === null || !Number.isFinite(a)) fail('Enter the amount.')
    if (!['adjustment', 'withholding'].includes(kind) && a < 0) fail('Enter a positive amount. Use Adjustment for a correction that reduces pay.')
    if (await isFinalized(year, month)) fail(lockedMsg(year, month))
    const { error } = await sb.from('payroll_entries').insert({ pin: String(pin).trim(), year, month, kind, label: String(label || '').trim() || null, amount: r2(a), remarks: String(remarks || '').trim() || null, created_by: by || null })
    if (error) { if (error.code === '23503') fail('That staff member no longer exists.'); throw new Error(error.message) }
  },
  remove: async (id) => {
    const { data } = await sb.from('payroll_entries').select('year,month').eq('id', id).maybeSingle()
    if (data && await isFinalized(data.year, data.month)) fail(lockedMsg(data.year, data.month))
    const { error } = await sb.from('payroll_entries').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },
}

// ── overtime ────────────────────────────────────────────────────────────────
const toOt = (r) => ({ id: r.id, pin: r.pin, date: r.date, hours: Number(r.hours), scanHours: r.scan_hours == null ? null : Number(r.scan_hours), source: r.source, status: r.status, note: r.note || '', decidedBy: r.decided_by || '' })

const overtime = {
  list: async (year, month, status) => {
    const { from, to } = monthRange(year, month)
    const rows = await selectAll('overtime_entries', q => { q = q.select('*').gte('date', from).lte('date', to).order('date').order('pin'); return status ? q.eq('status', status) : q })
    return rows.map(toOt)
  },

  // Scans suggest. Days that already have an entry (any status) are left alone.
  suggest: async (year, month, by) => {
    periodOk(year, month)
    if (await isFinalized(year, month)) fail(lockedMsg(year, month))
    const { from, to } = monthRange(year, month)
    const t = todayStr()
    const cap = to < t ? to : t      // do not look at days that have not happened
    if (cap < from) fail('That month has not started yet.')
    const [data, cfg, hols, have] = await Promise.all([reportData({ from, to: cap }), settings.get(), sb.from('public_holidays').select('date').gte('date', from).lte('date', to), overtime.list(year, month)])
    const holidays = new Set((hols.data || []).map(h => h.date))
    const taken = new Set(have.map(e => e.pin + '|' + e.date))
    const sched = await store.settings.get()      // the company's own default hours, for anyone without a shift
    const rows = suggestOvertime({ rows: data.daily, emps: data.employees, holidays, sched, thresholdMin: cfg.otSuggestThresholdMin, taken })
      .map(x => ({ pin: x.pin, date: x.date, hours: x.hours, scan_hours: x.hours, source: 'scan', status: 'pending', created_by: by || null }))
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from('overtime_entries').upsert(rows.slice(i, i + 500), { onConflict: 'pin,date', ignoreDuplicates: true })
      if (error) throw new Error(error.message)
    }
    return rows.length
  },

  add: async ({ pin, date, hours, note, by }) => {
    pin = String(pin || '').trim()
    if (!pin) fail('Choose a staff member.')
    if (!YMD.test(date || '')) fail('Choose the date.')
    const h = num(hours)
    if (h === null || !(h > 0 && h <= 24)) fail('Hours must be more than 0 and at most 24.')
    if (await isFinalized(Number(date.slice(0, 4)), Number(date.slice(5, 7)))) fail(lockedMsg(Number(date.slice(0, 4)), Number(date.slice(5, 7))))
    const { error } = await sb.from('overtime_entries').insert({ pin, date, hours: r2(h), source: 'manual', status: 'approved', note: String(note || '').trim() || null, created_by: by || null, decided_by: by || null, decided_at: new Date().toISOString() })
    if (error) { if (error.code === '23505') fail('That person already has an overtime entry for that day. Edit it instead.'); if (error.code === '23503') fail('That staff member no longer exists.'); throw new Error(error.message) }
  },

  // status approved | rejected | pending; hours optional (HR may correct the suggestion).
  decide: async (id, { status, hours, by, note }) => {
    if (!['approved', 'rejected', 'pending'].includes(status)) fail('Unknown decision.')
    const { data: cur, error: ge } = await sb.from('overtime_entries').select('*').eq('id', id).maybeSingle()
    if (ge) throw new Error(ge.message)
    if (!cur) fail('That overtime entry no longer exists.')
    if (await isFinalized(Number(cur.date.slice(0, 4)), Number(cur.date.slice(5, 7)))) fail(lockedMsg(Number(cur.date.slice(0, 4)), Number(cur.date.slice(5, 7))))
    const patch = { status, decided_by: status === 'pending' ? null : (by || null), decided_at: status === 'pending' ? null : new Date().toISOString() }
    if (hours !== undefined && hours !== null && hours !== '') {
      const h = num(hours); if (!(h > 0 && h <= 24)) fail('Hours must be more than 0 and at most 24.')
      patch.hours = r2(h)
    }
    if (note !== undefined) patch.note = String(note || '').trim() || null
    const { error } = await sb.from('overtime_entries').update(patch).eq('id', id)
    if (error) throw new Error(error.message)
  },
  // Approve or reject every PENDING entry of a month in one go. Entries HR already decided are untouched.
  decideAllPending: async (year, month, status, by) => {
    periodOk(year, month)
    if (!['approved', 'rejected'].includes(status)) fail('Unknown decision.')
    if (await isFinalized(year, month)) fail(lockedMsg(year, month))
    const { from, to } = monthRange(year, month)
    const { data, error } = await sb.from('overtime_entries').update({ status, decided_by: by || null, decided_at: new Date().toISOString() }).eq('status', 'pending').gte('date', from).lte('date', to).select('id')
    if (error) throw new Error(error.message)
    return (data || []).length
  },
  remove: async (id) => {
    const { data: cur } = await sb.from('overtime_entries').select('date').eq('id', id).maybeSingle()
    if (cur && await isFinalized(Number(cur.date.slice(0, 4)), Number(cur.date.slice(5, 7)))) fail(lockedMsg(Number(cur.date.slice(0, 4)), Number(cur.date.slice(5, 7))))
    const { error } = await sb.from('overtime_entries').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },
  tierOf: otTier,
}

// ── generating a run ────────────────────────────────────────────────────────
// Builds every slip for the month from attendance, approved overtime, the monthly
// items and the pay setup. Re-running a DRAFT replaces its slips; a finalized run
// is never touched.
async function buildSlips(year, month) {
  const { from, to } = monthRange(year, month)
  const today = todayStr()
  const [cfg, struct, ents, otRows, comps, data, hols] = await Promise.all([
    settings.get(), structure.list(), entries.list(year, month), overtime.list(year, month, 'approved'), allowances.list(),
    reportData({ from, to }), sb.from('public_holidays').select('date').gte('date', from).lte('date', to),
  ])
  const holidays = new Set((hols.data || []).map(h => h.date))
  const emps = data.employees

  const byPin = new Map()
  for (const r of data.daily) { if (!byPin.has(r.pin)) byPin.set(r.pin, []); byPin.get(r.pin).push(r) }

  const profiles = Object.fromEntries((await hr.staff.list()).map(p => [p.pin, p]))
  const slips = [], skipped = []
  for (const pin of Object.keys(emps).sort((a, b) => (emps[a].name || a).localeCompare(emps[b].name || b))) {
    const e = emps[pin]
    const rows = byPin.get(pin) || []
    if (rows.length === 0) continue                       // not employed at any point in this month
    const st = struct[pin]
    if (!st || st.salary === null) { skipped.push({ pin, name: e.name || pin, reason: 'No salary set' }); continue }

    const fig = attendanceFigures(rows, today)
    const ot = { normal: 0, off: 0, holiday: 0 }
    for (const o of otRows) if (o.pin === pin) ot[otTier(o.date, offDaysOn(e, o.date), holidays)] += o.hours
    const mine = ents.filter(x => x.pin === pin)
    const sum = (k) => r2(mine.filter(x => x.kind === k).reduce((a, x) => a + x.amount, 0))
    const companyAllowance = r2(comps.filter(c => c.isActive).reduce((a, c) => a + (c.kind === 'percent' ? st.salary * c.amount / 100 : c.amount), 0))

    const input = {
      salary: st.salary, dependents: st.dependents, resident: st.taxResident, taxExempt: st.taxExempt, nssfExempt: st.nssfExempt,
      absentDays: fig.absent, unpaidLeaveDays: fig.unpaidLeave, lateDays: fig.lateDays, lateMinutes: fig.lateMinutes, otHours: ot,
      bonus: sum('bonus'), allowance: r2(companyAllowance + sum('allowance')), advance: sum('advance'), adjustment: sum('adjustment'), withholding: sum('withholding'),
    }
    const calc = computeSlip(input, cfg)
    const notes = []
    if (fig.manualLeave) notes.push(`${fig.manualLeave} day(s) corrected to "leave" by hand are treated as paid. Record unpaid leave as a leave request so it is deducted.`)
    const emp = profiles[pin]
    if (calc.finalNet < 0) notes.push('Net pay is negative: deductions and NSSF exceed the pay for this month. Check attendance, advances and adjustments before paying.')
    if (emp && emp.joiningDate && emp.joiningDate > from) notes.push(`Joined ${emp.joiningDate}: the salary is not prorated. Use an adjustment if needed.`)
    if (emp && emp.resignedDate && emp.resignedDate < to) notes.push(`Resigned ${emp.resignedDate}: the salary is not prorated. Use an adjustment if needed.`)
    slips.push({
      pin, name: e.name || pin, payment_method: st.paymentMethod || null,
      gross: calc.gross, tax: calc.tax, nssf_employee: calc.nssfEmployee, nssf_employer: calc.nssfEmployer, net: calc.finalNet,
      calc: { ...calc, presentDays: fig.present, paidLeaveDays: fig.paidLeave, notes, bankName: st.bankName, bankAccount: st.bankAccount, group: e.group || null },
    })
  }
  return { slips, skipped, cfg, from, to }
}

const runs = {
  list: async () => {
    const rows = await selectAll('payroll_runs', q => q.select('*').order('year', { ascending: false }).order('month', { ascending: false }).order('id'))
    return rows.map(r => ({ id: r.id, year: r.year, month: r.month, status: r.status, createdBy: r.created_by || '', finalizedBy: r.finalized_by || '', finalizedAt: r.finalized_at }))
  },
  get: async (year, month) => {
    const run = await runFor(year, month)
    if (!run) return null
    const slips = await selectAll('payroll_slips', q => q.select('*').eq('run_id', run.id).order('name').order('pin'))
    return {
      id: run.id, year: run.year, month: run.month, status: run.status, createdBy: run.created_by || '', createdAt: run.created_at, finalizedBy: run.finalized_by || '', finalizedAt: run.finalized_at, settings: run.settings,
      slips: slips.map(s => ({ id: s.id, pin: s.pin, name: s.name || s.pin, paymentMethod: s.payment_method || '', gross: Number(s.gross), tax: Number(s.tax), nssfEmployee: Number(s.nssf_employee), nssfEmployer: Number(s.nssf_employer), net: Number(s.net), calc: s.calc })),
    }
  },
  slip: async (id) => {
    const { data, error } = await sb.from('payroll_slips').select('*, payroll_runs(year,month,status)').eq('id', id).maybeSingle()
    if (error) throw new Error(error.message)
    return data ? { id: data.id, pin: data.pin, name: data.name || data.pin, paymentMethod: data.payment_method || '', net: Number(data.net), calc: data.calc, year: data.payroll_runs.year, month: data.payroll_runs.month, status: data.payroll_runs.status } : null
  },

  // (Re)generate the draft for a month. Returns { slips, skipped }.
  generate: async (year, month, by) => {
    periodOk(year, month)
    const existing = await runFor(year, month)
    if (existing && existing.status === 'finalized') fail(lockedMsg(year, month))
    const built = await buildSlips(year, month)
    if (!built.slips.length) fail('No one with a salary was employed in that month. Set salaries on the Pay setup page first.')
    let runId = existing && existing.id
    if (!runId) {
      const { data, error } = await sb.from('payroll_runs').insert({ year, month, status: 'draft', created_by: by || null }).select('id').single()
      if (error) throw new Error(error.message)
      runId = data.id
    } else {
      const { error } = await sb.from('payroll_slips').delete().eq('run_id', runId)
      if (error) throw new Error(error.message)
    }
    const rows = built.slips.map(s => ({ ...s, run_id: runId }))
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await sb.from('payroll_slips').insert(rows.slice(i, i + 200))
      if (error) throw new Error(error.message)
    }
    return { count: rows.length, skipped: built.skipped, incomplete: rows.filter(s => s.calc.incomplete).length }
  },

  // Discards a DRAFT (never a finalized run).
  discard: async (year, month) => {
    const run = await runFor(year, month)
    if (!run) return
    if (run.status === 'finalized') fail(lockedMsg(year, month))
    const { error } = await sb.from('payroll_runs').delete().eq('id', run.id)
    if (error) throw new Error(error.message)
  },

  finalize: async (year, month, by) => {
    const run = await runs.get(year, month)
    if (!run) fail('Generate the payroll first.')
    if (run.status === 'finalized') fail('That payroll is already finalized.')
    if (!run.slips.length) fail('There are no slips to finalize.')
    const bad = run.slips.filter(s => s.calc.incomplete)
    if (bad.length) {
      const what = [...new Set(bad.flatMap(s => s.calc.missing))]
      fail(`${bad.length} slip${bad.length === 1 ? ' is' : 's are'} incomplete, so it cannot be finalized. Missing: ${what.join(', ')}. Fill those in and generate again.`)
    }
    // Slips are rebuilt from live data right now, so a finalized slip can never be stale.
    const built = await buildSlips(year, month)
    const stale = built.slips.length !== run.slips.length || built.slips.some(s => { const old = run.slips.find(r => r.pin === s.pin); return !old || old.net !== s.net })
    if (stale) fail('Something changed since this payroll was generated (attendance, overtime, settings or monthly items). Generate it again, check the figures, then finalize.')
    const [cfg, comps] = await Promise.all([settings.get(), allowances.list()])
    const { error } = await sb.from('payroll_runs').update({ status: 'finalized', finalized_by: by || null, finalized_at: new Date().toISOString(), settings: { ...cfg, allowances: comps, frozenAt: new Date().toISOString() } }).eq('id', run.id)
    if (error) throw new Error(error.message)
  },
}

module.exports = { ready, settings, readiness, structure, allowances, entries, overtime, runs, HRM_VALUES, HRM_BRACKETS, monthRange, KINDS }
