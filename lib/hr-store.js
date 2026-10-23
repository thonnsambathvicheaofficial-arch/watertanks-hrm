// Departments, shifts, rotating-shift assignments and the staff profile.
// Tables come from migrations/001_shifts_departments_staff_profile.sql, which the
// owner runs by hand. Until then available() is false and every read degrades to
// "nothing configured", so reports and the engine behave exactly as before.
//
// Shifts define working HOURS. A staff member linked to a shift gets its start and
// end COPIED onto employees.time_in / time_out, which the attendance engine and the
// legacy app read, so results do not move. A person's weekly days off stay THEIR
// OWN (employees.off_days): real staff on one shift have different days off, so a
// shift's off_days is only the default for new staff and for rotation periods.
const sb = require('./supabase')

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/
const YMD = /^\d{4}-\d{2}-\d{2}$/

class UserError extends Error {}   // safe to show to the person using the app
const fail = (m) => { throw new UserError(m) }

const isMissingTable = (e) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /could not find the table|does not exist/i.test(e.message || ''))
const dbError = (e) => { if (e.code === '23505') fail('That name is already in use.'); throw new Error(e.message) }

let probe = { at: 0, ok: false }
async function available() {
  if (Date.now() - probe.at < 15000) return probe.ok
  const { error } = await sb.from('shifts').select('id').limit(1)
  probe = { at: Date.now(), ok: !error }
  if (error && !isMissingTable(error)) throw new Error(error.message)
  return probe.ok
}
const resetProbe = () => { probe = { at: 0, ok: false }; extProbe = { at: 0, ok: false } }

// Migration 005 adds the fuller profile columns. Until it is run they are simply not read or written.
let extProbe = { at: 0, ok: false }
async function extended() {
  if (Date.now() - extProbe.at < 15000) return extProbe.ok
  const { error } = await sb.from('employees').select('staff_code').limit(1)
  extProbe = { at: Date.now(), ok: !error }
  if (error && !isMissingTable(error) && !/column .*does not exist|could not find/i.test(error.message || '')) throw new Error(error.message)
  return extProbe.ok
}

const selectAll = require('./select-all')

// ── shapes ──────────────────────────────────────────────────────────────────
const toShift = (r) => ({
  id: r.id, name: r.name, start: r.start_time, end: r.end_time,
  graceMinutes: r.grace_minutes, offDays: r.off_days || [], isActive: r.is_active,
  overnight: r.end_time < r.start_time,
})
const toDept = (r) => ({ id: r.id, name: r.name })
const toAssignment = (r) => ({
  id: r.id, pin: r.pin, shiftId: r.shift_id, from: r.from_date, to: r.to_date, note: r.note || '',
  createdBy: r.created_by || '', shiftName: r.shifts ? r.shifts.name : '',
  start: r.shifts ? r.shifts.start_time : '', end: r.shifts ? r.shifts.end_time : '',
})

// ── departments ─────────────────────────────────────────────────────────────
const departments = {
  list: async () => {
    if (!(await available())) return []
    const [{ data, error }, emps] = await Promise.all([
      sb.from('departments').select('id,name').order('name'),
      selectAll('employees', q => q.select('pin,department_id').order('pin')),
    ])
    if (error) throw new Error(error.message)
    const n = {}
    for (const e of emps) if (e.department_id) n[e.department_id] = (n[e.department_id] || 0) + 1
    return data.map(d => ({ ...toDept(d), staff: n[d.id] || 0 }))
  },
  create: async (name) => {
    name = String(name || '').trim()
    if (!name) fail('Give the department a name.')
    const { error } = await sb.from('departments').insert({ name })
    if (error) dbError(error)
  },
  rename: async (id, name) => {
    name = String(name || '').trim()
    if (!name) fail('Give the department a name.')
    const { error } = await sb.from('departments').update({ name }).eq('id', id)
    if (error) dbError(error)
  },
  // Staff in the department are simply un-assigned (FK is ON DELETE SET NULL).
  remove: async (id) => {
    const { error } = await sb.from('departments').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },
}

// ── shifts ──────────────────────────────────────────────────────────────────
function cleanShift(input) {
  const name = String(input.name || '').trim()
  const start = String(input.start || '').trim()
  const end = String(input.end || '').trim()
  if (!name) fail('Give the shift a name.')
  if (!HHMM.test(start) || !HHMM.test(end)) fail('Start and end must be times like 07:00.')
  if (start === end) fail('Start and end cannot be the same time.')
  let grace = null
  if (input.graceMinutes !== '' && input.graceMinutes != null) {
    grace = Number(input.graceMinutes)
    if (!Number.isInteger(grace) || grace < 0 || grace > 120) fail('Grace must be a whole number of minutes from 0 to 120.')
  }
  const offDays = [...new Set((input.offDays || []).map(Number))].filter(n => Number.isInteger(n) && n >= 0 && n <= 6).sort()
  // The attendance engine treats an empty list as "Saturday and Sunday", so an empty week would silently mean something else.
  if (!offDays.length) fail('Choose at least one weekly day off.')
  return { name, start_time: start, end_time: end, grace_minutes: grace, off_days: offDays, is_active: input.isActive !== false }
}

const shifts = {
  list: async () => {
    if (!(await available())) return []
    const [{ data, error }, emps] = await Promise.all([
      sb.from('shifts').select('*').order('start_time').order('name'),
      selectAll('employees', q => q.select('pin,shift_id').order('pin')),
    ])
    if (error) throw new Error(error.message)
    const n = {}
    for (const e of emps) if (e.shift_id) n[e.shift_id] = (n[e.shift_id] || 0) + 1
    return data.map(r => ({ ...toShift(r), staff: n[r.id] || 0 }))
  },
  get: async (id) => {
    const { data, error } = await sb.from('shifts').select('*').eq('id', id).maybeSingle()
    if (error) throw new Error(error.message)
    return data ? toShift(data) : null
  },
  create: async (input) => {
    const { error } = await sb.from('shifts').insert(cleanShift(input))
    if (error) dbError(error)
  },
  // Editing a shift moves everyone linked to it: their copied start and end follow.
  // Their own weekly days off are never touched.
  update: async (id, input) => {
    const row = cleanShift(input)
    const { error } = await sb.from('shifts').update(row).eq('id', id)
    if (error) dbError(error)
    const { error: e2 } = await sb.from('employees').update({ time_in: row.start_time, time_out: row.end_time }).eq('shift_id', id)
    if (e2) throw new Error(e2.message)
  },
  remove: async (id) => {
    const { count, error: e1 } = await sb.from('shift_assignments').select('*', { count: 'exact', head: true }).eq('shift_id', id)
    if (e1) throw new Error(e1.message)
    if (count) fail(`${count} rotation assignment${count === 1 ? ' uses' : 's use'} this shift. Remove ${count === 1 ? 'it' : 'them'} first.`)
    // Staff keep their current times; they just stop being linked to a named shift.
    const { error } = await sb.from('shifts').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },
}

// ── rotation assignments ────────────────────────────────────────────────────
const assignments = {
  list: async ({ pin } = {}) => {
    if (!(await available())) return []
    const rows = await selectAll('shift_assignments', q => {
      q = q.select('*, shifts(name,start_time,end_time)').order('from_date', { ascending: false }).order('id')
      return pin ? q.eq('pin', String(pin)) : q
    })
    return rows.map(toAssignment)
  },
  // Create one assignment. Returns nothing; throws UserError with a readable reason.
  create: async ({ pin, shiftId, from, to, note, by }) => {
    pin = String(pin || '').trim()
    if (!pin) fail('Choose a staff member.')
    if (!shiftId) fail('Choose a shift.')
    if (!YMD.test(from || '')) fail('Choose a start date.')
    if (to && !YMD.test(to)) fail('The end date is not a valid date.')
    if (to && to < from) fail('The end date is before the start date.')
    const { data: clash, error: ce } = await sb.from('shift_assignments').select('from_date,to_date,shifts(name)').eq('pin', pin)
    if (ce) throw new Error(ce.message)
    const hit = (clash || []).find(a => a.from_date <= (to || '9999-12-31') && (!a.to_date || a.to_date >= from))
    if (hit) fail(`Already on ${hit.shifts ? hit.shifts.name : 'a shift'} from ${hit.from_date}${hit.to_date ? ' to ' + hit.to_date : ' onward'}.`)
    const { error } = await sb.from('shift_assignments').insert({ pin, shift_id: shiftId, from_date: from, to_date: to || null, note: (note || '').trim() || null, created_by: by || null })
    if (error) { if (error.code === '23P01') fail('That overlaps another assignment for this person.'); if (error.code === '23503') fail('That staff member or shift no longer exists.'); throw new Error(error.message) }
  },
  // Same shift and dates for many people. One failure never blocks the others.
  createMany: async ({ pins, shiftId, from, to, note, by }) => {
    const created = [], conflicts = []
    for (const pin of pins) {
      try { await assignments.create({ pin, shiftId, from, to, note, by }); created.push(pin) }
      catch (e) { if (e instanceof UserError) conflicts.push({ pin, reason: e.message }); else throw e }
    }
    return { created, conflicts }
  },
  remove: async (id) => {
    const { error } = await sb.from('shift_assignments').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },
}

// ── staff profile ───────────────────────────────────────────────────────────
const toProfile = (r) => ({
  pin: r.pin, name: r.name || '', group: r.group || '', timeIn: r.time_in || '', timeOut: r.time_out || '',
  offDays: Array.isArray(r.off_days) ? r.off_days : [0, 6], aliases: r.aliases || [],
  departmentId: r.department_id || '', shiftId: r.shift_id || '', position: r.position || '', phone: r.phone || '',
  joiningDate: r.joining_date || '', resignedDate: r.resigned_date || '',
  staffCode: r.staff_code || '', nameKh: r.name_kh || '', gender: r.gender || '', dateOfBirth: r.date_of_birth || '',
  maritalStatus: r.marital_status || '', idCardNo: r.id_card_no || '', nssfNo: r.nssf_no || '', address: r.address || '',
  personalEmail: r.personal_email || '', emergencyContact: r.emergency_contact || '', emergencyPhone: r.emergency_phone || '',
  employmentType: r.employment_type || '', probationEnd: r.probation_end || '', lineManager: r.line_manager || '', resignReason: r.resign_reason || '',
})

const GENDERS = { m: 'M', male: 'M', f: 'F', female: 'F' }
const EMAIL = /^[^s@]+@[^s@]+.[^s@]+$/
const txt = (v) => { const t = String(v == null ? '' : v).trim(); return t || null }

// The fuller profile columns (migration 005), validated. Only keys present in the input are written, so a
// form or import that does not mention a field never erases it.
async function extendedRow(pin, input, all, create) {
  const out = {}
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k)
  const map = { nameKh: 'name_kh', maritalStatus: 'marital_status', idCardNo: 'id_card_no', nssfNo: 'nssf_no', address: 'address', emergencyContact: 'emergency_contact', emergencyPhone: 'emergency_phone', employmentType: 'employment_type', resignReason: 'resign_reason' }
  for (const [k, col] of Object.entries(map)) if (has(k)) out[col] = txt(input[k])
  if (has('staffCode')) {
    const code = txt(input.staffCode)
    if (code) {
      const clash = all.find(e => e.pin !== pin && String(e.staff_code || '').toLowerCase() === code.toLowerCase())
      if (clash) fail(`Staff ID ${code} already belongs to ${clash.name || 'another staff member'} (PIN ${clash.pin}).`)
    }
    out.staff_code = code
  }
  if (has('gender')) {
    const g = txt(input.gender)
    if (g && !GENDERS[g.toLowerCase()]) fail('Gender must be Male or Female.')
    out.gender = g ? GENDERS[g.toLowerCase()] : null
  }
  if (has('personalEmail')) {
    const e = txt(input.personalEmail)
    if (e && !EMAIL.test(e)) fail('The email address is not valid.')
    out.personal_email = e
  }
  for (const [k, col, label] of [['dateOfBirth', 'date_of_birth', 'Date of birth'], ['probationEnd', 'probation_end', 'Probation end date']]) {
    if (!has(k)) continue
    const d = txt(input[k])
    if (d && !YMD.test(d)) fail(`${label} is not a valid date.`)
    out[col] = d
  }
  if (has('lineManager')) {
    const m = txt(input.lineManager)
    if (m) {
      if (m === pin) fail('A person cannot be their own line manager.')
      if (!all.some(e => e.pin === m)) fail(`Line manager PIN ${m} is not a staff member.`)
    }
    out.line_manager = m
  }
  return out
}

const staff = {
  get: async (pin) => {
    const { data, error } = await sb.from('employees').select('*').eq('pin', String(pin)).maybeSingle()
    if (error) throw new Error(error.message)
    return data ? toProfile(data) : null
  },

  // Every staff member with profile fields, for the staff list.
  list: async () => {
    const rows = await selectAll('employees', q => q.select('*').order('pin'))
    return rows.map(toProfile)
  },

  // create=true inserts a new person; otherwise updates an existing one.
  save: async (pin, input, { create = false } = {}) => {
    pin = String(pin || '').trim()
    if (!pin) fail('PIN is required.')
    const hr = await available()
    const name = String(input.name || '').trim()
    if (!name) fail('Name is required.')

    const aliases = [...new Set(String(input.aliases || '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean))]
    if (aliases.includes(pin)) fail('The main PIN cannot also be listed as another PIN.')
    // An alias must not already identify someone else.
    const ext = await extended()
    const all = await selectAll('employees', q => q.select(ext ? 'pin,name,aliases,staff_code' : 'pin,aliases').order('pin'))
    for (const a of aliases) {
      const owner = all.find(e => e.pin !== pin && (e.pin === a || (e.aliases || []).includes(a)))
      if (owner) fail(`PIN ${a} already belongs to staff ${owner.pin}.`)
    }
    if (create && all.some(e => e.pin === pin)) fail(`PIN ${pin} already exists.`)
    if (!create && !all.some(e => e.pin === pin)) fail('That staff member no longer exists.')

    const group = ['office', 'worker'].includes(input.group) ? input.group : null
    const row = { name, group, aliases }
    let offDays = [...new Set((input.offDays || []).map(Number))].filter(n => Number.isInteger(n) && n >= 0 && n <= 6).sort()

    let shift = null
    if (hr && input.shiftId) {
      shift = await shifts.get(input.shiftId)
      if (!shift) fail('That shift no longer exists.')
      row.shift_id = shift.id
      row.time_in = shift.start; row.time_out = shift.end
    } else {
      const ti = String(input.timeIn || '').trim(), to = String(input.timeOut || '').trim()
      if ((ti && !HHMM.test(ti)) || (to && !HHMM.test(to))) fail('Times must look like 07:00.')
      if (!!ti !== !!to) fail('Enter both a start and an end time, or neither.')
      row.time_in = ti || null; row.time_out = to || null
      if (hr) row.shift_id = null
    }
    if (!offDays.length) fail('Choose at least one weekly day off.')
    row.off_days = offDays

    if (hr) {
      const jd = String(input.joiningDate || ''), rd = String(input.resignedDate || '')
      if ((jd && !YMD.test(jd)) || (rd && !YMD.test(rd))) fail('Dates are not valid.')
      if (jd && rd && rd < jd) fail('The resigned date is before the joining date.')
      row.department_id = input.departmentId || null
      row.position = String(input.position || '').trim() || null
      row.phone = String(input.phone || '').trim() || null
      row.joining_date = jd || null
      row.resigned_date = rd || null
    }

    if (ext) Object.assign(row, await extendedRow(pin, input, all, create))

    const q = create ? sb.from('employees').insert({ pin, ...row }) : sb.from('employees').update(row).eq('pin', pin)
    const { error } = await q
    if (error) throw new Error(error.message)
  },

  // Corrects a person's PIN. Rotation, leave, entitlements and payroll tables follow the new
  // PIN by themselves (foreign keys with ON UPDATE CASCADE), so the one UPDATE below moves
  // them together. Scans and day corrections are keyed by PIN without a foreign key, so they
  // are re-pointed FIRST: if a step fails the person is still under the old PIN with nothing
  // lost, and the rename can simply be repeated. Finalized payslips keep the PIN they were
  // issued under. keepOld also lists the old PIN under Other PINs, so a device that still scans
  // under it keeps counting for this person.
  rename: async (pin, newPin, { keepOld = true } = {}) => {
    pin = String(pin || '').trim(); newPin = String(newPin || '').trim()
    if (!newPin) fail('Enter the new PIN.')
    if (newPin === pin) fail('That is already this person\'s PIN.')
    if (!/^[A-Za-z0-9_.-]{1,32}$/.test(newPin)) fail('A PIN can use letters, numbers, dots, dashes and underscores, up to 32 characters.')
    const all = await selectAll('employees', q => q.select('pin,name,aliases').order('pin'))
    const me = all.find(e => e.pin === pin)
    if (!me) fail('That staff member no longer exists.')
    const owner = all.find(e => e.pin === newPin || (e.aliases || []).includes(newPin))
    if (owner) fail(`PIN ${newPin} already belongs to ${owner.name || 'another staff member'} (${owner.pin}).`)
    const [{ count: scans, error: e1 }, { count: theirScans, error: e2 }, { count: theirDays, error: e3 }] = await Promise.all([
      sb.from('punches').select('pin', { count: 'exact', head: true }).eq('pin', pin),
      sb.from('punches').select('pin', { count: 'exact', head: true }).eq('pin', newPin),
      sb.from('day_overrides').select('pin', { count: 'exact', head: true }).eq('pin', newPin),
    ])
    if (e1 || e2 || e3) throw new Error((e1 || e2 || e3).message)
    if (theirScans || theirDays) fail(`PIN ${newPin} already has scans or corrections recorded under it, so the two histories cannot be merged here. If it is the same person, add ${newPin} under Other PINs instead.`)

    const { error: pErr } = await sb.from('punches').update({ pin: newPin }).eq('pin', pin)
    if (pErr) throw new Error(`Nothing was renamed. Scans could not be moved: ${pErr.message}`)
    const { error: oErr } = await sb.from('day_overrides').update({ pin: newPin }).eq('pin', pin)
    if (oErr) {
      const { error: back } = await sb.from('punches').update({ pin }).eq('pin', newPin)   // put the scans back
      if (back) throw new Error(`The PIN change failed and the scans could not be put back (they are under ${newPin}). Do not retry: ${back.message}`)
      throw new Error(`Nothing was renamed. Corrections could not be moved: ${oErr.message}`)
    }
    const patch = { pin: newPin }
    if (keepOld) patch.aliases = [...new Set([...(me.aliases || []), pin])]
    const { error } = await sb.from('employees').update(patch).eq('pin', pin)
    if (error) {
      const b1 = await sb.from('punches').update({ pin }).eq('pin', newPin)
      const b2 = await sb.from('day_overrides').update({ pin }).eq('pin', newPin)
      if (b1.error || b2.error) throw new Error(`The PIN change failed and the scans or corrections could not be put back (they are under ${newPin}). Do not retry: ${(b1.error || b2.error).message}`)
      throw new Error(`Nothing was renamed: ${error.message}`)
    }
    return { scans: scans || 0, name: me.name }
  },
}

// ── engine input ────────────────────────────────────────────────────────────
// Attach each person's rotation plan and shift grace to the employees map the
// engine reads. With no tables or no assignments this changes nothing.
async function decorate(employees) {
  if (!(await available())) return employees
  const [shiftRows, asg, emps] = await Promise.all([
    selectAll('shifts', q => q.select('id,start_time,end_time,grace_minutes,off_days').order('id')),
    selectAll('shift_assignments', q => q.select('pin,shift_id,from_date,to_date').order('from_date').order('id')),
    selectAll('employees', q => q.select('pin,shift_id,department_id,joining_date,resigned_date').order('pin')),
  ])
  const byId = Object.fromEntries(shiftRows.map(s => [s.id, s]))
  for (const e of emps) {
    // Employment window: reports never invent absences before someone joined or after they resigned.
    // The department rides along too, so every report can be narrowed to one (reportData's `department` filter).
    if (employees[e.pin]) { employees[e.pin].joiningDate = e.joining_date || null; employees[e.pin].resignedDate = e.resigned_date || null; employees[e.pin].departmentId = e.department_id || '' }
    const s = e.shift_id && byId[e.shift_id]
    if (s && employees[e.pin] && s.grace_minutes != null) employees[e.pin].graceMinutes = s.grace_minutes
  }
  for (const a of asg) {
    const s = byId[a.shift_id]
    if (!s || !employees[a.pin]) continue
    ;(employees[a.pin].plan ||= []).push({
      from: a.from_date, to: a.to_date || null, start: s.start_time, end: s.end_time,
      grace: s.grace_minutes, offDays: s.off_days && s.off_days.length ? s.off_days : null,
    })
  }
  return employees
}

module.exports = { UserError, available, extended, resetProbe, departments, shifts, assignments, staff, decorate, HHMM }
