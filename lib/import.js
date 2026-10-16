// Batch import from Excel. Five kinds of sheet, each with the same three steps:
//   parse (read the file into rows)  ->  plan (compare with what is saved: new / changed / same / error)
//   ->  apply (write the rows that are new or changed, through the same store functions the pages use,
//   so permissions, validation and the audit log behave exactly as for a single edit).
//
// Rules shared by every kind:
//  - A blank cell never erases anything. It keeps what is already saved.
//  - Nothing is guessed. A department, shift, leave type or PIN that does not exist is an error on that row.
//  - Planning is repeated on the server for every batch that is applied, so the preview can never
//    be used to write something the checks would have refused.
const XLSX = require('xlsx')
const store = require('./store')
const hr = require('./hr-store')
const lv = require('./leave-store')
const pr = require('./payroll-store')

const { UserError } = hr
const MAX_ROWS = 2000
const MAX_BYTES = 4 * 1024 * 1024
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ── cell readers ────────────────────────────────────────────────────────────
const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '')
const YMD = /^\d{4}-\d{2}-\d{2}$/
const validYmd = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d }
const pad = (n) => String(n).padStart(2, '0')
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

const readText = (v) => (typeof v === 'number' ? String(v) : String(v == null ? '' : v).trim())
const readNumber = (v) => (typeof v === 'number' ? String(v) : String(v == null ? '' : v).replace(/[$,\s]/g, ''))

// A date is a real Excel date (serial number) or text: 2026-08-14, 14/08/2026 (day first), 14 Aug 2026.
function readDate(v) {
  if (v == null || v === '') return ''
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`
  if (typeof v === 'number') {
    if (!(v >= 20000 && v < 80000)) return `?${v}`
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000).toISOString().slice(0, 10)
  }
  const s = String(v).trim()
  let m
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return validYmd(+m[1], +m[2], +m[3]) ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : `?${s}`
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) return validYmd(+m[3], +m[2], +m[1]) ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : `?${s}`
  if ((m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3})[a-z]*[\s-,]+(\d{4})$/)) && MONTHS[m[2].toLowerCase()]) { const mo = MONTHS[m[2].toLowerCase()]; return validYmd(+m[3], mo, +m[1]) ? `${m[3]}-${pad(mo)}-${pad(m[1])}` : `?${s}` }
  return `?${s}`
}

// A time is a real Excel time (fraction of a day) or text: 7:00, 07:00, 7:00 AM, 19:23.
function readTime(v) {
  if (v == null || v === '') return ''
  if (typeof v === 'number') {
    if (!(v >= 0 && v < 1)) return `?${v}`
    const mins = Math.round(v * 1440) % 1440
    return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`
  }
  const s = String(v).trim()
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i)
  if (!m) return `?${s}`
  let h = +m[1]
  const mi = +m[2]
  if (m[3]) { if (h < 1 || h > 12) return `?${s}`; h = (h % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0) }
  if (h > 23 || mi > 59) return `?${s}`
  return `${pad(h)}:${pad(mi)}`
}

const READERS = { text: readText, number: readNumber, date: readDate, time: readTime }

function readBool(v) {
  const s = norm(v)
  if (!s) return null
  if (['yes', 'y', 'true', '1', 'x'].includes(s)) return true
  if (['no', 'n', 'false', '0'].includes(s)) return false
  return undefined
}

function readOffDays(v) {
  const out = new Set()
  for (const t of String(v || '').toLowerCase().split(/[,;/\s]+/).filter(Boolean)) {
    const i = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(t.slice(0, 3))
    if (i < 0 && t.slice(0, 3) === 'thr') out.add(4)
    else if (i < 0) return null
    else out.add(i)
  }
  return [...out].sort()
}
const offDayNames = (a) => (a || []).map(i => DAYS[i]).join(', ')

// ── column definitions ──────────────────────────────────────────────────────
// type: how the cell is read. required: the column must exist in the file (a blank value is judged per row).
const C = (key, header, type = 'text', opts = {}) => ({ key, header, type, aliases: [], ...opts })

const entitlementColumns = async () => {
  const types = (await lv.types.list()).filter(t => t.isActive)
  return [C('pin', 'PIN', 'text', { required: true }), C('year', 'Year', 'number', { required: true }),
    ...types.map(t => C(`t:${t.id}`, t.code, 'number', { aliases: [t.name], typeId: t.id, typeName: t.name }))]
}

const KINDS = {
  staff: {
    label: 'Staff details',
    perm: 'staff.edit',
    blurb: 'Department, shift, days off, position, phone and employment dates, matched by PIN. People must already exist or be new here.',
    columns: async () => [
      C('pin', 'PIN', 'text', { required: true }), C('name', 'Name', 'text', { required: true }),
      C('group', 'Group', 'text', { aliases: ['Office or worker'] }), C('department', 'Department', 'text'),
      C('shift', 'Shift', 'text'), C('offDays', 'Days off', 'text', { aliases: ['Day off', 'Weekly days off'] }),
      C('timeIn', 'In', 'time', { aliases: ['Time in', 'Start'] }), C('timeOut', 'Out', 'time', { aliases: ['Time out', 'End'] }),
      C('position', 'Position', 'text', { aliases: ['Job title'] }), C('phone', 'Phone', 'text'),
      C('joiningDate', 'Joining date', 'date', { aliases: ['Joined', 'Start date'] }), C('resignedDate', 'Resigned date', 'date', { aliases: ['Resigned', 'Left'] }),
      C('aliases', 'Other PINs', 'text', { aliases: ['Aliases'] }),
    ],
    notes: [
      'PIN is the key. A PIN already in the system is updated; a new PIN adds a person.',
      'Blank cells keep what is saved. They never erase anything.',
      'Group: Office or Worker.',
      'Department and Shift must match a name already set up, spelled the same.',
      'Days off: weekday names, e.g. Sun or Sat, Sun. New people need at least one.',
      'In and Out are used only when Shift is blank. A shift supplies its own hours.',
      'Dates: 2026-08-14 or 14/08/2026 (day first). A real Excel date also works.',
      'Other PINs: further numbers the same person scans under, separated by spaces or commas.',
    ],
    async plan(rows) {
      if (!(await hr.available())) throw new UserError('Staff import needs migration 001 (departments and shifts). Run it first.')
      const [all, depts, shifts] = await Promise.all([hr.staff.list(), hr.departments.list(), hr.shifts.list()])
      const byPin = new Map(all.map(s => [s.pin, s]))
      const dept = new Map(depts.map(d => [norm(d.name), d]))
      const shift = new Map(shifts.map(s => [norm(s.name), s]))
      const deptName = (id) => (depts.find(d => d.id === id) || {}).name || ''
      const shiftName = (id) => (shifts.find(s => s.id === id) || {}).name || ''
      const seen = new Map()
      return rows.map(r => {
        const pin = r.pin
        const out = { line: r.line, label: pin ? `PIN ${pin}${r.name ? ` · ${r.name}` : ''}` : 'No PIN' }
        const err = (message) => ({ ...out, status: 'error', message })
        if (!pin) return err('PIN is empty.')
        if (seen.has(pin)) return err(`PIN ${pin} is also on line ${seen.get(pin)}.`)
        seen.set(pin, r.line)
        const cur = byPin.get(pin)
        for (const f of ['timeIn', 'timeOut', 'joiningDate', 'resignedDate']) if (String(r[f]).startsWith('?')) return err(`${f === 'timeIn' ? 'In' : f === 'timeOut' ? 'Out' : f === 'joiningDate' ? 'Joining date' : 'Resigned date'} "${String(r[f]).slice(1)}" is not a valid ${f.endsWith('Date') ? 'date' : 'time'}.`)
        const next = cur ? { ...cur } : { pin, name: '', group: '', timeIn: '', timeOut: '', offDays: null, aliases: [], departmentId: '', shiftId: '', position: '', phone: '', joiningDate: '', resignedDate: '' }
        if (r.name) next.name = r.name
        if (!next.name) return err('Name is empty. New people need a name.')
        if (r.group) {
          const g = norm(r.group)
          if (['office', 'officestaff'].includes(g)) next.group = 'office'
          else if (['worker', 'workers'].includes(g)) next.group = 'worker'
          else return err(`Group "${r.group}" must be Office or Worker.`)
        }
        if (r.department) { const d = dept.get(norm(r.department)); if (!d) return err(`Department "${r.department}" is not set up. Add it under Departments first.`); next.departmentId = d.id }
        if (r.shift) { const s = shift.get(norm(r.shift)); if (!s) return err(`Shift "${r.shift}" is not set up. Add it under Shifts first.`); next.shiftId = s.id; next.timeIn = s.start; next.timeOut = s.end }
        else if (r.timeIn || r.timeOut) { if (!r.timeIn || !r.timeOut) return err('Give both In and Out, or neither.'); next.shiftId = ''; next.timeIn = r.timeIn; next.timeOut = r.timeOut }
        if (r.offDays) { const d = readOffDays(r.offDays); if (!d || !d.length) return err(`Days off "${r.offDays}" is not a list of weekday names.`); next.offDays = d }
        if (!next.offDays || !next.offDays.length) return err('Days off is empty. New people need at least one weekly day off.')
        if (r.position) next.position = r.position
        if (r.phone) next.phone = r.phone
        if (r.joiningDate) next.joiningDate = r.joiningDate
        if (r.resignedDate) next.resignedDate = r.resignedDate
        if (next.joiningDate && next.resignedDate && next.resignedDate < next.joiningDate) return err('Resigned date is before the joining date.')
        if (r.aliases) next.aliases = [...new Set(r.aliases.split(/[,\s]+/).map(s => s.trim()).filter(Boolean))]
        if (next.aliases.includes(pin)) return err('The main PIN cannot also be listed under Other PINs.')
        for (const a of next.aliases) {
          const owner = all.find(e => e.pin !== pin && (e.pin === a || (e.aliases || []).includes(a)))
          if (owner) return err(`PIN ${a} already belongs to ${owner.name} (${owner.pin}).`)
        }
        const view = (o) => ({ Name: o.name, Group: o.group === 'office' ? 'Office' : o.group === 'worker' ? 'Worker' : '', Department: deptName(o.departmentId), Shift: shiftName(o.shiftId), 'Days off': offDayNames(o.offDays), In: o.shiftId ? '' : o.timeIn, Out: o.shiftId ? '' : o.timeOut, Position: o.position, Phone: o.phone, 'Joining date': o.joiningDate, 'Resigned date': o.resignedDate, 'Other PINs': (o.aliases || []).join(' ') })
        const changes = cur ? diffView(view(cur), view(next)) : []
        const save = { ...next, aliases: next.aliases.join(' ') }
        return { ...out, label: `PIN ${pin} · ${next.name}`, status: !cur ? 'new' : changes.length ? 'changed' : 'same', changes, data: { pin, save, create: !cur } }
      })
    },
    async apply(planned) {
      const done = []
      for (const p of planned) {
        try { await hr.staff.save(p.data.pin, p.data.save, { create: p.data.create }); done.push({ p }) } catch (e) { done.push({ p, error: e }) }
      }
      return done
    },
    async current() {
      const [all, depts, shifts] = await Promise.all([hr.staff.list(), hr.departments.list(), hr.shifts.list()])
      const dn = Object.fromEntries(depts.map(d => [d.id, d.name])), sn = Object.fromEntries(shifts.map(s => [s.id, s.name]))
      return all.map(s => ({ pin: s.pin, name: s.name, group: s.group === 'office' ? 'Office' : s.group === 'worker' ? 'Worker' : '', department: dn[s.departmentId] || '', shift: sn[s.shiftId] || '', offDays: offDayNames(s.offDays), timeIn: s.shiftId ? '' : s.timeIn, timeOut: s.shiftId ? '' : s.timeOut, position: s.position, phone: s.phone, joiningDate: s.joiningDate, resignedDate: s.resignedDate, aliases: (s.aliases || []).join(' ') }))
    },
    example: [{ pin: '1001', name: 'Sok Dara', group: 'Worker', department: 'Production', shift: 'Day shift', offDays: 'Sun', position: 'Operator', phone: '012 345 678', joiningDate: '2025-03-01' }],
  },

  paysetup: {
    label: 'Pay setup',
    perm: 'payroll.edit',
    blurb: 'Monthly salary, tax and NSSF flags, dependents and bank details per person, matched by PIN.',
    columns: async () => [
      C('pin', 'PIN', 'text', { required: true }), C('name', 'Name', 'text'),
      C('salary', 'Monthly salary (USD)', 'number', { aliases: ['Salary'] }),
      C('taxResident', 'Tax resident', 'text'), C('taxExempt', 'Tax exempt', 'text'), C('nssfExempt', 'NSSF exempt', 'text'),
      C('dependents', 'Dependents', 'number'), C('paymentMethod', 'Payment method', 'text', { aliases: ['Pay by'] }),
      C('bankName', 'Bank name', 'text', { aliases: ['Bank'] }), C('bankAccount', 'Bank account', 'text', { aliases: ['Account number'] }),
    ],
    notes: [
      'PIN must belong to someone already in the system. The Name column is only for your own reference and is ignored.',
      'Blank cells keep what is saved. They never erase anything.',
      'Monthly salary: a number in USD.',
      'Tax resident, Tax exempt, NSSF exempt: Yes or No.',
      'Dependents: a whole number.',
      'Payment method: Bank or Cash.',
      'Bank account: keep as text so leading zeros survive.',
    ],
    async plan(rows) {
      const [all, cur] = await Promise.all([hr.staff.list(), pr.structure.list()])
      const byPin = new Map(all.map(s => [s.pin, s]))
      const seen = new Map()
      const view = (o) => ({ 'Monthly salary': o.salary == null ? '' : o.salary, 'Tax resident': o.taxResident ? 'Yes' : 'No', 'Tax exempt': o.taxExempt ? 'Yes' : 'No', 'NSSF exempt': o.nssfExempt ? 'Yes' : 'No', Dependents: o.dependents, 'Payment method': o.paymentMethod, 'Bank name': o.bankName, 'Bank account': mask(o.bankAccount) })
      return rows.map(r => {
        const person = byPin.get(r.pin)
        const out = { line: r.line, label: r.pin ? `PIN ${r.pin}${person ? ` · ${person.name}` : ''}` : 'No PIN' }
        const err = (message) => ({ ...out, status: 'error', message })
        if (!r.pin) return err('PIN is empty.')
        if (!person) return err(`PIN ${r.pin} is not in the system.`)
        if (seen.has(r.pin)) return err(`PIN ${r.pin} is also on line ${seen.get(r.pin)}.`)
        seen.set(r.pin, r.line)
        const before = cur[r.pin]
        const next = before ? { ...before } : { pin: r.pin, salary: null, taxResident: true, taxExempt: false, nssfExempt: false, dependents: 0, paymentMethod: '', bankName: '', bankAccount: '' }
        if (r.salary !== '') { const n = Number(r.salary); if (!Number.isFinite(n) || n < 0) return err(`Salary "${r.salary}" must be a number of zero or more.`); next.salary = Math.round(n * 100) / 100 }
        for (const [k, label] of [['taxResident', 'Tax resident'], ['taxExempt', 'Tax exempt'], ['nssfExempt', 'NSSF exempt']]) {
          const b = readBool(r[k]); if (b === undefined) return err(`${label} "${r[k]}" must be Yes or No.`); if (b !== null) next[k] = b
        }
        if (r.dependents !== '') { const n = Number(r.dependents); if (!Number.isInteger(n) || n < 0) return err(`Dependents "${r.dependents}" must be a whole number.`); next.dependents = n }
        if (r.paymentMethod) { const m = norm(r.paymentMethod); if (!['bank', 'cash'].includes(m)) return err(`Payment method "${r.paymentMethod}" must be Bank or Cash.`); next.paymentMethod = m }
        if (r.bankName) next.bankName = r.bankName
        if (r.bankAccount) next.bankAccount = r.bankAccount
        const changes = before ? diffView(view(before), view(next)) : []
        return { ...out, status: !before ? 'new' : changes.length ? 'changed' : 'same', changes, data: next }
      })
    },
    async apply(planned, by) {
      try { await pr.structure.saveMany(planned.map(p => p.data), by); return planned.map(p => ({ p })) } catch (e) { return planned.map(p => ({ p, error: e })) }
    },
    async current() {
      const [all, cur] = await Promise.all([hr.staff.list(), pr.structure.list()])
      return all.map(s => { const c = cur[s.pin]; return { pin: s.pin, name: s.name, salary: c && c.salary != null ? c.salary : '', taxResident: c ? (c.taxResident === false ? 'No' : 'Yes') : '', taxExempt: c ? (c.taxExempt ? 'Yes' : 'No') : '', nssfExempt: c ? (c.nssfExempt ? 'Yes' : 'No') : '', dependents: c ? c.dependents : '', paymentMethod: c && c.paymentMethod ? (c.paymentMethod === 'bank' ? 'Bank' : 'Cash') : '', bankName: c ? c.bankName : '', bankAccount: c ? c.bankAccount : '' } })
    },
    example: [{ pin: '1001', name: 'Sok Dara', salary: 220, taxResident: 'Yes', taxExempt: 'No', nssfExempt: 'No', dependents: 1, paymentMethod: 'Bank', bankName: 'ABA', bankAccount: '000123456' }],
  },

  holidays: {
    label: 'Public holidays',
    perm: 'setup.edit',
    blurb: 'Public holidays by date. An existing date has its name updated.',
    columns: async () => [C('date', 'Date', 'date', { required: true }), C('name', 'Name', 'text', { required: true }), C('nameKh', 'Name (Khmer)', 'text', { aliases: ['Khmer name'] })],
    notes: ['Date is the key. A date already listed has its name updated.', 'Dates: 2026-10-10 or 10/10/2026 (day first). A real Excel date also works.', 'Name (Khmer) is optional. Blank keeps what is saved.'],
    async plan(rows) {
      if (!(await lv.ready())) throw new UserError('Holiday import needs migration 002 (leave and holidays). Run it first.')
      const years = [...new Set(rows.map(r => r.date.slice(0, 4)).filter(y => /^\d{4}$/.test(y)))]
      const have = new Map((await Promise.all(years.map(y => lv.holidays.list(Number(y))))).flat().map(h => [h.date, h]))
      const seen = new Map()
      return rows.map(r => {
        const out = { line: r.line, label: r.date && !r.date.startsWith('?') ? `${r.date}${r.name ? ` · ${r.name}` : ''}` : r.name || 'No date' }
        const err = (message) => ({ ...out, status: 'error', message })
        if (!r.date) return err('Date is empty.')
        if (r.date.startsWith('?')) return err(`Date "${r.date.slice(1)}" is not a valid date.`)
        if (!r.name) return err('Name is empty.')
        if (seen.has(r.date)) return err(`${r.date} is also on line ${seen.get(r.date)}.`)
        seen.set(r.date, r.line)
        const cur = have.get(r.date)
        const next = { date: r.date, name: r.name, nameKh: r.nameKh || (cur ? cur.nameKh : '') }
        const changes = cur ? diffView({ Name: cur.name, 'Name (Khmer)': cur.nameKh }, { Name: next.name, 'Name (Khmer)': next.nameKh }) : []
        return { ...out, status: !cur ? 'new' : changes.length ? 'changed' : 'same', changes, data: { ...next, replace: !!cur } }
      })
    },
    async apply(planned) {
      const done = []
      for (const p of planned) {
        const { replace, ...h } = p.data
        try {
          if (replace) {
            const old = (await lv.holidays.list(Number(h.date.slice(0, 4)))).find(x => x.date === h.date)
            await lv.holidays.remove(h.date)
            try { await lv.holidays.add(h) } catch (e) { if (old) await lv.holidays.add(old); throw e }
          } else await lv.holidays.add(h)
          done.push({ p })
        } catch (e) { done.push({ p, error: e }) }
      }
      return done
    },
    async current() { const y = new Date().getFullYear(); return (await lv.holidays.list(y)).map(h => ({ date: h.date, name: h.name, nameKh: h.nameKh })) },
    example: [{ date: '2026-10-10', name: 'Pchum Ben Day', nameKh: '' }],
  },

  entitlements: {
    label: 'Leave entitlements',
    perm: 'leave.edit',
    blurb: 'Yearly leave days per person and leave type, matched by PIN and year.',
    columns: entitlementColumns,
    notes: ['PIN and Year together are the key.', 'One column per leave type, headed by its code. Days: 0 to 365.', 'Blank cells keep what is saved. They never clear an entitlement.'],
    async plan(rows) {
      if (!(await lv.ready())) throw new UserError('Entitlement import needs migration 002 (leave and holidays). Run it first.')
      const [cols, all] = await Promise.all([entitlementColumns(), hr.staff.list()])
      const typeCols = cols.filter(c => c.typeId)
      const pins = new Set(all.map(s => s.pin))
      const nameOf = new Map(all.map(s => [s.pin, s.name]))
      const years = [...new Set(rows.map(r => Number(r.year)).filter(y => Number.isInteger(y) && y >= 2000 && y <= 2100))]
      const have = new Map((await Promise.all(years.map(async y => [y, await lv.entitlements.forYear(y)]))))
      const seen = new Map()
      return rows.map(r => {
        const out = { line: r.line, label: r.pin ? `PIN ${r.pin}${nameOf.get(r.pin) ? ` · ${nameOf.get(r.pin)}` : ''} · ${r.year || '?'}` : 'No PIN' }
        const err = (message) => ({ ...out, status: 'error', message })
        if (!r.pin) return err('PIN is empty.')
        if (!pins.has(r.pin)) return err(`PIN ${r.pin} is not in the system.`)
        const year = Number(r.year)
        if (!Number.isInteger(year) || year < 2000 || year > 2100) return err(`Year "${r.year}" is not a valid year.`)
        const k = `${r.pin}|${year}`
        if (seen.has(k)) return err(`PIN ${r.pin} for ${year} is also on line ${seen.get(k)}.`)
        seen.set(k, r.line)
        const cur = (have.get(year) || {})[r.pin] || {}
        const entries = [], changes = []
        let anyNew = false
        for (const c of typeCols) {
          const raw = r[c.key]
          if (raw === '' || raw == null) continue
          const d = Number(raw)
          if (!(d >= 0 && d <= 365)) return err(`${c.header} "${raw}" must be a number from 0 to 365.`)
          const was = cur[c.typeId]
          if (was === undefined) anyNew = true
          if (was === undefined || Math.round(was * 10) !== Math.round(d * 10)) { entries.push({ pin: r.pin, typeId: c.typeId, days: d }); changes.push({ field: c.header, from: was === undefined ? '' : was, to: d }) }
        }
        if (!typeCols.some(c => r[c.key] !== '' && r[c.key] != null)) return err('No days entered. Fill at least one leave type column.')
        return { ...out, status: !entries.length ? 'same' : (anyNew && changes.every(c => c.from === '')) ? 'new' : 'changed', changes, data: { year, entries } }
      })
    },
    async apply(planned) {
      const byYear = new Map()
      for (const p of planned) { const a = byYear.get(p.data.year) || []; a.push(...p.data.entries); byYear.set(p.data.year, a) }
      const failed = new Map()
      for (const [year, entries] of byYear) {
        try { await lv.entitlements.saveMany(year, entries) } catch (e) { failed.set(year, e) }
      }
      return planned.map(p => (failed.has(p.data.year) ? { p, error: failed.get(p.data.year) } : { p }))
    },
    async current() {
      const [all, types] = await Promise.all([hr.staff.list(), lv.types.list()])
      const y = new Date().getFullYear()
      const have = await lv.entitlements.forYear(y)
      return all.map(s => { const row = { pin: s.pin, year: y }; for (const t of types.filter(t => t.isActive)) { const d = (have[s.pin] || {})[t.id]; row[`t:${t.id}`] = d === undefined ? '' : d } return row })
    },
    example: [{ pin: '1001', year: new Date().getFullYear() }],
  },

  corrections: {
    label: 'Day corrections',
    perm: 'attendance.edit',
    blurb: 'Manual corrections to a person\'s day: present, day off, leave or excused, each with a note saying why.',
    columns: async () => [
      C('pin', 'PIN', 'text', { required: true }), C('date', 'Date', 'date', { required: true }), C('status', 'Status', 'text', { required: true }),
      C('note', 'Note', 'text', { required: true, aliases: ['Reason'] }), C('timeIn', 'In', 'time'), C('timeOut', 'Out', 'time'),
    ],
    notes: ['PIN and Date together are the key. A day already corrected is replaced.', 'Status: Present, Day off, Leave or Excused.', 'Note is required. Say what happened.', 'In and Out are only for Present: give both, or neither.'],
    async plan(rows) {
      const all = await hr.staff.list()
      const nameOf = new Map(all.map(s => [s.pin, s.name]))
      const dates = rows.map(r => r.date).filter(d => YMD.test(d)).sort()
      const have = new Map()
      if (dates.length) for (const o of await store.overrides.query({ from: dates[0], to: dates[dates.length - 1] })) have.set(`${o.pin}|${o.date}`, o)
      const STATUS = { present: 'present', dayoff: 'day_off', off: 'day_off', leave: 'leave', excused: 'excused', excuse: 'excused' }
      const label = (s) => ({ present: 'Present', day_off: 'Day off', leave: 'Leave', excused: 'Excused' }[s] || s)
      const seen = new Map()
      return rows.map(r => {
        const out = { line: r.line, label: r.pin ? `PIN ${r.pin}${nameOf.get(r.pin) ? ` · ${nameOf.get(r.pin)}` : ''} · ${YMD.test(r.date) ? r.date : '?'}` : 'No PIN' }
        const err = (message) => ({ ...out, status: 'error', message })
        if (!r.pin) return err('PIN is empty.')
        if (!nameOf.has(r.pin)) return err(`PIN ${r.pin} is not in the system.`)
        if (!r.date) return err('Date is empty.')
        if (!YMD.test(r.date)) return err(`Date "${r.date.replace(/^\?/, '')}" is not a valid date.`)
        const status = STATUS[norm(r.status)]
        if (!status) return err(`Status "${r.status}" must be Present, Day off, Leave or Excused.`)
        if (!r.note) return err('Note is empty. Say what happened.')
        for (const f of ['timeIn', 'timeOut']) if (r[f].startsWith('?')) return err(`${f === 'timeIn' ? 'In' : 'Out'} "${r[f].slice(1)}" is not a valid time.`)
        if (!!r.timeIn !== !!r.timeOut) return err('Give both In and Out, or neither.')
        if (r.timeIn && status !== 'present') return err('In and Out only apply to Present.')
        const k = `${r.pin}|${r.date}`
        if (seen.has(k)) return err(`PIN ${r.pin} on ${r.date} is also on line ${seen.get(k)}.`)
        seen.set(k, r.line)
        const cur = have.get(k)
        const view = (o) => ({ Status: label(o.status), Note: o.note || '', In: o.timeIn ? o.timeIn.slice(0, 5) : '', Out: o.timeOut ? o.timeOut.slice(0, 5) : '' })
        const next = { status, note: r.note, timeIn: r.timeIn, timeOut: r.timeOut }
        const changes = cur ? diffView(view(cur), view(next)) : []
        return { ...out, status: !cur ? 'new' : changes.length ? 'changed' : 'same', changes, data: { pin: r.pin, date: r.date, ...next } }
      })
    },
    async apply(planned, by) {
      const done = []
      for (const p of planned) { try { await lv.overrides.set({ ...p.data, by }); done.push({ p }) } catch (e) { done.push({ p, error: e }) } }
      return done
    },
    async current() { return [] },
    example: [{ pin: '1001', date: '2026-10-02', status: 'Present', note: 'Forgot to scan out, supervisor confirmed', timeIn: '07:00', timeOut: '16:00' }],
  },
}

// ── helpers shared by the kinds ─────────────────────────────────────────────
const mask = (s) => { s = String(s || ''); return s.length > 4 ? `${'•'.repeat(s.length - 4)}${s.slice(-4)}` : s }
function diffView(a, b) {
  const out = []
  for (const k of Object.keys(b)) if (String(a[k] ?? '') !== String(b[k] ?? '')) out.push({ field: k, from: a[k] ?? '', to: b[k] ?? '' })
  return out
}

// ── parse ───────────────────────────────────────────────────────────────────
// Reads the first sheet. Returns { rows, ignored } where each row is { line, [column key]: value }.
async function parse(kind, buffer) {
  const def = KINDS[kind]
  if (!def) throw new UserError('Choose what you are importing.')
  if (!buffer || !buffer.length) throw new UserError('Choose an Excel file to import.')
  if (buffer.length > MAX_BYTES) throw new UserError('That file is larger than 4 MB. Split it into smaller files.')
  let wb
  try { wb = XLSX.read(buffer, { type: 'buffer', cellDates: false }) } catch { throw new UserError('That file could not be read. Use an .xlsx file saved from Excel.') }
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw new UserError('The file has no sheets.')
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: false })
  if (!grid.length) throw new UserError('The first sheet is empty.')

  const cols = await def.columns()
  const index = new Map()
  for (const c of cols) for (const h of [c.header, ...c.aliases]) index.set(norm(h), c)
  const headers = grid[0].map(h => String(h == null ? '' : h).trim())
  const map = []   // column position -> column definition
  const ignored = []
  headers.forEach((h, i) => {
    if (!h) return
    const c = index.get(norm(h))
    if (c && !map.some(m => m && m.col === c)) map[i] = { col: c }
    else ignored.push(h)
  })
  const missing = cols.filter(c => c.required && !map.some(m => m && m.col === c)).map(c => c.header)
  if (missing.length) throw new UserError(`The first row must hold column headings. Missing: ${missing.join(', ')}. Download the template to see the layout.`)

  const rows = []
  for (let i = 1; i < grid.length; i++) {
    const line = grid[i]
    if (!line.some(v => String(v == null ? '' : v).trim() !== '')) continue
    const row = { line: i + 1 }
    for (const c of cols) row[c.key] = ''
    map.forEach((m, pos) => { if (m) row[m.col.key] = READERS[m.col.type](line[pos]) })
    rows.push(row)
  }
  if (!rows.length) throw new UserError('The file has headings but no rows.')
  if (rows.length > MAX_ROWS) throw new UserError(`The file has ${rows.length} rows. The limit is ${MAX_ROWS} per file.`)
  return { rows, ignored }
}

const count = (plan) => {
  const c = { new: 0, changed: 0, same: 0, error: 0 }
  for (const p of plan) c[p.status]++
  return c
}

// Writes the new and changed rows of `rows`; rows with errors or no change are left alone.
async function apply(kind, rows, by) {
  const def = KINDS[kind]
  if (!def) throw new UserError('Choose what you are importing.')
  const plan = await def.plan(rows)
  const todo = plan.filter(p => p.status === 'new' || p.status === 'changed')
  const results = todo.length ? await def.apply(todo, by) : []
  const failed = results.filter(r => r.error).map(r => ({ line: r.p.line, label: r.p.label, message: r.error instanceof UserError ? r.error.message : 'Could not be saved.' }))
  for (const r of results) if (r.error && !(r.error instanceof UserError)) console.error('[import]', kind, r.p.label, '-', r.error.message)
  return {
    added: results.filter(r => !r.error && r.p.status === 'new').length,
    changed: results.filter(r => !r.error && r.p.status === 'changed').length,
    same: plan.filter(p => p.status === 'same').length,
    skipped: plan.filter(p => p.status === 'error').length,
    failed,
  }
}

// A downloadable sheet: the headings, then what is saved now (or an example), plus a Notes sheet.
async function template(kind, { blank = false } = {}) {
  const def = KINDS[kind]
  if (!def) throw new UserError('Unknown import.')
  const cols = await def.columns()
  const data = blank ? def.example : ((await def.current()).length ? await def.current() : def.example)
  const rows = data.map(d => cols.map(c => (d[c.key] === undefined ? '' : d[c.key])))
  return {
    filename: `Import_${kind}.xlsx`,
    sheets: [
      { name: def.label.slice(0, 31), header: cols.map(c => c.header), rows, cols: cols.map(c => Math.max(12, c.header.length + 4)) },
      { name: 'How to fill', header: ['Notes'], rows: def.notes.map(n => [n]), cols: [110] },
    ],
  }
}

module.exports = { KINDS, MAX_ROWS, parse, apply, count, template, plan: (kind, rows) => KINDS[kind].plan(rows) }
