// Leave types, yearly entitlements, leave requests, public holidays, and the
// roster override writer. Tables come from migrations/002_leave_holidays_roster.sql,
// which the owner runs by hand; until then ready() is false and every read is empty,
// so reports behave exactly as before.
//
// Leave is entered and decided by HR (staff are not users of the system).
const sb = require('./supabase')
const store = require('./store')
const hr = require('./hr-store')
const calc = require('./leave-calc')

const { UserError } = hr
const fail = (m) => { throw new UserError(m) }
const YMD = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/
const round1 = (n) => Math.round(n * 10) / 10

const isMissingTable = (e) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /could not find the table|does not exist/i.test(e.message || ''))
let probe = { at: 0, ok: false }
async function ready() {
  if (Date.now() - probe.at < 15000) return probe.ok
  const { error } = await sb.from('leave_types').select('id').limit(1)
  probe = { at: Date.now(), ok: !error }
  if (error && !isMissingTable(error)) throw new Error(error.message)
  return probe.ok
}

const selectAll = require('./select-all')

// ── leave types ─────────────────────────────────────────────────────────────
const toType = (r) => ({ id: r.id, code: r.code, name: r.name, isPaid: r.is_paid, defaultDays: r.default_days == null ? null : Number(r.default_days), isActive: r.is_active, sortOrder: r.sort_order })

const types = {
  list: async ({ activeOnly = false } = {}) => {
    if (!(await ready())) return []
    const rows = await selectAll('leave_types', q => { q = q.select('*').order('sort_order').order('name'); return activeOnly ? q.eq('is_active', true) : q })
    return rows.map(toType)
  },
  save: async (id, input) => {
    const code = String(input.code || '').trim().toUpperCase()
    const name = String(input.name || '').trim()
    if (!name) fail('Give the leave type a name.')
    if (!/^[A-Z0-9]{1,6}$/.test(code)) fail('The code is 1 to 6 letters or numbers, like AL.')
    let defaultDays = null
    if (input.defaultDays !== '' && input.defaultDays != null) {
      defaultDays = Number(input.defaultDays)
      if (!(defaultDays >= 0 && defaultDays <= 365)) fail('Default days must be a number from 0 to 365.')
    }
    const row = { code, name, is_paid: !!input.isPaid, default_days: defaultDays, is_active: input.isActive !== false }
    let error
    if (id) ({ error } = await sb.from('leave_types').update(row).eq('id', id))
    else {
      const { data } = await sb.from('leave_types').select('sort_order').order('sort_order', { ascending: false }).limit(1)
      ;({ error } = await sb.from('leave_types').insert({ ...row, sort_order: ((data && data[0] && data[0].sort_order) || 0) + 1 }))
    }
    if (error) { if (error.code === '23505') fail('That code or name is already used by another leave type.'); throw new Error(error.message) }
  },
  remove: async (id) => {
    const { count, error: e1 } = await sb.from('leave_requests').select('*', { count: 'exact', head: true }).eq('leave_type_id', id)
    if (e1) throw new Error(e1.message)
    if (count) fail(`${count} leave request${count === 1 ? ' uses' : 's use'} this type. Turn it off instead of deleting it.`)
    const { error } = await sb.from('leave_types').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },
}

// ── entitlements ────────────────────────────────────────────────────────────
const entitlements = {
  // { [pin]: { [leaveTypeId]: days } } for one year.
  forYear: async (year) => {
    if (!(await ready())) return {}
    const rows = await selectAll('leave_entitlements', q => q.select('pin,leave_type_id,days').eq('year', year).order('pin').order('leave_type_id'))
    const out = {}
    for (const r of rows) (out[r.pin] ||= {})[r.leave_type_id] = Number(r.days)
    return out
  },
  // entries: [{ pin, typeId, days }]; empty days removes the entitlement.
  saveMany: async (year, entries) => {
    const keep = [], drop = []
    for (const e of entries) {
      if (e.days === '' || e.days == null) { drop.push(e); continue }
      const d = Number(e.days)
      if (!(d >= 0 && d <= 365)) fail(`PIN ${e.pin}: days must be a number from 0 to 365.`)
      keep.push({ pin: e.pin, year, leave_type_id: e.typeId, days: round1(d), updated_at: new Date().toISOString() })
    }
    for (let i = 0; i < keep.length; i += 500) {
      const { error } = await sb.from('leave_entitlements').upsert(keep.slice(i, i + 500), { onConflict: 'pin,year,leave_type_id' })
      if (error) throw new Error(error.message)
    }
    for (const e of drop) {
      const { error } = await sb.from('leave_entitlements').delete().eq('pin', e.pin).eq('year', year).eq('leave_type_id', e.typeId)
      if (error) throw new Error(error.message)
    }
    return { saved: keep.length, cleared: drop.length }
  },
  // Gives every current staff member the type's default days where they have none yet.
  fillDefaults: async (year) => {
    const [tp, emps, have] = await Promise.all([types.list({ activeOnly: true }), hr.staff.list(), entitlements.forYear(year)])
    const rows = []
    for (const e of emps) {
      if (e.resignedDate) continue
      for (const t of tp) {
        if (t.defaultDays == null) continue
        if (have[e.pin] && have[e.pin][t.id] != null) continue
        rows.push({ pin: e.pin, year, leave_type_id: t.id, days: t.defaultDays })
      }
    }
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from('leave_entitlements').insert(rows.slice(i, i + 500))
      if (error) throw new Error(error.message)
    }
    return rows.length
  },
}

// ── requests ────────────────────────────────────────────────────────────────
const toRequest = (r) => ({
  id: r.id, pin: r.pin, typeId: r.leave_type_id, typeCode: r.leave_types ? r.leave_types.code : '', typeName: r.leave_types ? r.leave_types.name : '',
  from: r.from_date, to: r.to_date, halfDayPeriod: r.half_day_period || '', days: Number(r.days), reason: r.reason || '', status: r.status,
  createdBy: r.created_by || '', createdAt: r.created_at, decidedBy: r.decided_by || '', decidedAt: r.decided_at, decisionNote: r.decision_note || '',
})

const holidaySet = async (from, to) => {
  const rows = await selectAll('public_holidays', q => { q = q.select('date').order('date'); if (from) q = q.gte('date', from); if (to) q = q.lte('date', to); return q })
  return new Set(rows.map(r => r.date))
}

const requests = {
  list: async (f = {}) => {
    if (!(await ready())) return []
    const rows = await selectAll('leave_requests', q => {
      q = q.select('*, leave_types(code,name)').order('from_date', { ascending: false }).order('id')
      if (f.status) q = q.eq('status', f.status)
      if (f.pin) q = q.eq('pin', f.pin)
      if (f.typeId) q = q.eq('leave_type_id', f.typeId)
      if (f.year) q = q.gte('to_date', `${f.year}-01-01`).lte('from_date', `${f.year}-12-31`)
      return q
    })
    return rows.map(toRequest)
  },

  get: async (id) => {
    const { data, error } = await sb.from('leave_requests').select('*, leave_types(code,name)').eq('id', id).maybeSingle()
    if (error) throw new Error(error.message)
    return data ? toRequest(data) : null
  },

  // Entitled / used (approved) / pending days for one person, year and type.
  balance: async (pin, year, typeId) => {
    const [ent, reqs] = await Promise.all([
      sb.from('leave_entitlements').select('days').eq('pin', pin).eq('year', year).eq('leave_type_id', typeId).maybeSingle(),
      selectAll('leave_requests', q => q.select('days,status,from_date').eq('pin', pin).eq('leave_type_id', typeId).in('status', ['pending', 'approved']).gte('from_date', `${year}-01-01`).lte('from_date', `${year}-12-31`).order('id')),
    ])
    if (ent.error) throw new Error(ent.error.message)
    const sum = (st) => round1(reqs.filter(r => r.status === st).reduce((a, r) => a + Number(r.days), 0))
    return { entitled: ent.data ? Number(ent.data.days) : null, used: sum('approved'), pending: sum('pending') }
  },

  // Returns { id, warning|null }. status is 'approved' (HR recording leave) or 'pending'.
  create: async ({ pin, typeId, from, to, halfDay, period, reason, status, by }) => {
    pin = String(pin || '').trim()
    if (!pin) fail('Choose a staff member.')
    if (!typeId) fail('Choose a leave type.')
    if (!YMD.test(from || '')) fail('Choose the first day of leave.')
    const isHalf = !!halfDay
    to = isHalf ? from : (to || from)
    if (!YMD.test(to)) fail('The last day is not a valid date.')
    if (to < from) fail('The last day is before the first day.')
    if (isHalf && !['morning', 'afternoon'].includes(period)) fail('Choose morning or afternoon for a half day.')
    status = status === 'pending' ? 'pending' : 'approved'

    const [emp, type, hols] = await Promise.all([hr.staff.get(pin), sb.from('leave_types').select('*').eq('id', typeId).maybeSingle(), holidaySet(from, to)])
    if (!emp) fail('That staff member no longer exists.')
    if (type.error) throw new Error(type.error.message)
    if (!type.data || !type.data.is_active) fail('That leave type is not available.')

    const days = calc.leaveDays({ from, to, halfDayPeriod: isHalf ? period : null }, emp.offDays, hols)
    if (days <= 0) fail(isHalf ? 'That day is a day off or a public holiday, so there is nothing to take leave from.' : 'Every one of those dates is a day off or a public holiday.')

    // Overlap with this person's pending/approved leave. Full days clash with everything
    // on the same dates; two half days only clash when they are the same period.
    const { data: others, error: oe } = await sb.from('leave_requests').select('from_date,to_date,half_day_period,status').eq('pin', pin).in('status', ['pending', 'approved']).lte('from_date', to).gte('to_date', from)
    if (oe) throw new Error(oe.message)
    for (const o of others || []) {
      const bothHalf = isHalf && o.half_day_period
      if (bothHalf && o.half_day_period !== period) continue
      fail(`Already has ${o.status} leave ${o.from_date === o.to_date ? 'on ' + o.from_date : 'from ' + o.from_date + ' to ' + o.to_date}${o.half_day_period ? ' (' + o.half_day_period + ')' : ''}.`)
    }

    const row = {
      pin, leave_type_id: typeId, from_date: from, to_date: to, half_day_period: isHalf ? period : null, days,
      reason: String(reason || '').trim() || null, status, created_by: by || null,
      ...(status === 'approved' ? { decided_by: by || null, decided_at: new Date().toISOString() } : {}),
    }
    const { data, error } = await sb.from('leave_requests').insert(row).select('id').single()
    if (error) { if (error.code === '23P01') fail('That overlaps other leave for this person.'); throw new Error(error.message) }

    const year = Number(from.slice(0, 4))
    const b = await requests.balance(pin, year, typeId)
    const warning = b.entitled != null && b.used + (status === 'pending' ? b.pending : 0) > b.entitled
      ? `${emp.name || pin} is now ${round1(b.used + b.pending - b.entitled)} day(s) over the ${year} ${type.data.name.toLowerCase()} entitlement of ${b.entitled}.`
      : null
    return { id: data.id, days, warning }
  },

  decide: async (id, { status, by, note }) => {
    if (!['approved', 'rejected', 'cancelled'].includes(status)) fail('Unknown decision.')
    const req = await requests.get(id)
    if (!req) fail('That request no longer exists.')
    if (status === 'rejected' && !String(note || '').trim()) fail('Say why it is rejected.')
    if (status === 'approved' && req.status !== 'pending') fail('Only a pending request can be approved.')
    if (status === 'rejected' && req.status !== 'pending') fail('Only a pending request can be rejected.')
    if (status === 'cancelled' && !['pending', 'approved'].includes(req.status)) fail('That request is already closed.')
    const { error } = await sb.from('leave_requests').update({ status, decided_by: by || null, decided_at: new Date().toISOString(), decision_note: String(note || '').trim() || null }).eq('id', id)
    if (error) throw new Error(error.message)
    if (status === 'approved') {
      const b = await requests.balance(req.pin, Number(req.from.slice(0, 4)), req.typeId)
      if (b.entitled != null && b.used > b.entitled) return `Approved. Note: ${round1(b.used - b.entitled)} day(s) over the ${req.from.slice(0, 4)} ${req.typeName.toLowerCase()} entitlement of ${b.entitled}.`
    }
    return null
  },
}

// ── public holidays ─────────────────────────────────────────────────────────
const holidays = {
  list: async (year) => {
    if (!(await ready())) return []
    const rows = await selectAll('public_holidays', q => q.select('*').gte('date', `${year}-01-01`).lte('date', `${year}-12-31`).order('date'))
    return rows.map(r => ({ date: r.date, name: r.name, nameKh: r.name_kh || '' }))
  },
  add: async ({ date, name, nameKh }) => {
    name = String(name || '').trim()
    if (!YMD.test(date || '')) fail('Choose the date of the holiday.')
    if (!name) fail('Give the holiday a name.')
    const { error } = await sb.from('public_holidays').insert({ date, name, name_kh: String(nameKh || '').trim() || null })
    if (error) { if (error.code === '23505') fail(`${date} is already a holiday.`); throw new Error(error.message) }
  },
  // A holiday that lasts several days in a row (Khmer New Year, Pchum Ben): one entry per day, all or nothing.
  addRange: async ({ date, days, name, nameKh }) => {
    name = String(name || '').trim()
    if (!YMD.test(date || '') || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) fail('Choose the date of the holiday.')
    if (!name) fail('Give the holiday a name.')
    const n = Math.floor(Number(days) || 1)
    if (n < 1 || n > 10) fail('A holiday can last from 1 to 10 days in a row.')
    const dates = Array.from({ length: n }, (_, i) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10) })
    const { data: taken, error: readErr } = await sb.from('public_holidays').select('date').in('date', dates)
    if (readErr) throw new Error(readErr.message)
    if (taken && taken.length) fail(`${taken.map(r => r.date).join(', ')} ${taken.length === 1 ? 'is' : 'are'} already ${taken.length === 1 ? 'a holiday' : 'holidays'}. Nothing was added.`)
    const nk = String(nameKh || '').trim() || null
    const { error } = await sb.from('public_holidays').insert(dates.map(d => ({ date: d, name, name_kh: nk })))
    if (error) { if (error.code === '23505') fail('One of those days is already a holiday. Nothing was added.'); throw new Error(error.message) }
    return dates
  },
  // Rename a holiday (its date is its identity: to move it, remove it and add it on the new date).
  update: async ({ date, name, nameKh }) => {
    name = String(name || '').trim()
    if (!YMD.test(date || '')) fail('Choose the date of the holiday.')
    if (!name) fail('Give the holiday a name.')
    const { data, error } = await sb.from('public_holidays').update({ name, name_kh: String(nameKh || '').trim() || null }).eq('date', date).select('date')
    if (error) throw new Error(error.message)
    if (!data || !data.length) fail(`There is no holiday on ${date} any more. Reload the page.`)
  },
  remove: async (date) => {
    const { error } = await sb.from('public_holidays').delete().eq('date', date)
    if (error) throw new Error(error.message)
  },
}

// ── roster overrides (day_overrides) ────────────────────────────────────────
const STATUSES = ['present', 'day_off', 'leave', 'excused']
const overrides = {
  // originalStatus: what the system had worked out before HR overrode it (audit).
  set: async ({ pin, date, status, note, timeIn, timeOut, by, originalStatus }) => {
    pin = String(pin || '').trim(); note = String(note || '').trim()
    if (!pin) fail('Choose a staff member.')
    if (!YMD.test(date || '')) fail('Choose a date.')
    if (!STATUSES.includes(status)) fail('Choose a status.')
    if (!note) fail('A note is required. Describe what happened.')
    timeIn = String(timeIn || '').trim(); timeOut = String(timeOut || '').trim()
    if ((timeIn && !HHMM.test(timeIn)) || (timeOut && !HHMM.test(timeOut))) fail('Times must look like 07:00.')
    if (!!timeIn !== !!timeOut) fail('Enter both an in and an out time, or neither.')
    const row = { pin, date, status, note, time_in: timeIn || null, time_out: timeOut || null, set_by: by || null, set_at: new Date().toISOString() }
    if (await ready() && originalStatus) {
      // Keep the FIRST computed status if this day was already overridden: that is the real original.
      const { data: cur } = await sb.from('day_overrides').select('original_status').eq('pin', pin).eq('date', date).maybeSingle()
      row.original_status = (cur && cur.original_status) || originalStatus
    }
    const { error } = await sb.from('day_overrides').upsert(row, { onConflict: 'pin,date' })
    if (error) throw new Error(error.message)
  },
  remove: async (pin, date) => store.overrides.remove(String(pin), date),
}

// ── engine input ────────────────────────────────────────────────────────────
// { holidays: Map(date -> name), leaves: Map("pin|date" -> {code,note,days}) } for a range.
async function extraFor(from, to, employees) {
  if (!(await ready())) return { holidays: null, leaves: null }
  const [hRows, reqs, tp] = await Promise.all([
    selectAll('public_holidays', q => q.select('date,name').gte('date', from).lte('date', to).order('date')),
    selectAll('leave_requests', q => q.select('pin,leave_type_id,from_date,to_date,half_day_period').eq('status', 'approved').lte('from_date', to).gte('to_date', from).order('id')),
    types.list(),
  ])
  const holidaysMap = new Map(hRows.map(h => [h.date, h.name]))
  // Skip holidays when expanding, using every holiday in the span (not only the report range).
  const hols = new Set(hRows.map(h => h.date))
  const byId = Object.fromEntries(tp.map(t => [t.id, t]))
  const leaves = new Map()
  for (const r of reqs) {
    const e = employees[r.pin]; const t = byId[r.leave_type_id]
    if (!e || !t) continue
    const note = `${t.name}${r.half_day_period ? ` (${r.half_day_period} half day)` : ''}`
    for (const d of calc.expandLeave({ from: r.from_date, to: r.to_date, halfDayPeriod: r.half_day_period }, e.offDays, hols, from, to)) {
      calc.addLeaveEntry(leaves, `${r.pin}|${d.date}`, { code: t.code, note, days: d.days, rank: t.sortOrder, paid: t.isPaid, period: r.half_day_period || null, typeName: t.name })
    }
  }
  return { holidays: holidaysMap, leaves }
}

module.exports = { ready, types, entitlements, requests, holidays, overrides, extraFor, STATUSES }
