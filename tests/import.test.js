// Tests the batch import (lib/import.js): reading cells, matching headings, and planning each kind
// against stand-ins for the stores, so no database is touched.
const path = require('path')
const XLSX = require('xlsx')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }

// ── stand-ins for the stores (installed before lib/import.js loads them) ──
const stub = (rel, exports) => { const id = require.resolve(path.join('..', rel)); require.cache[id] = { id, filename: id, loaded: true, exports } }
class UserError extends Error {}
const people = [
  { pin: '1', name: 'Sok Dara', group: 'worker', timeIn: '07:00', timeOut: '16:00', offDays: [0], aliases: ['901'], departmentId: 'd1', shiftId: 's1', position: 'Operator', phone: '', joiningDate: '2025-03-01', resignedDate: '', staffCode: 'SF0001', nameKh: '' },
  { pin: '2', name: 'Chan Vy', group: 'office', timeIn: '', timeOut: '', offDays: [0, 6], aliases: [], departmentId: '', shiftId: '', position: '', phone: '', joiningDate: '', resignedDate: '' },
]
const saved = []
const createdDepts = []
stub('lib/hr-store.js', {
  UserError, available: async () => true, extended: async () => true,
  staff: { list: async () => people, save: async (pin, input, o) => { saved.push({ pin, input, o }) } },
  departments: { list: async () => [{ id: 'd1', name: 'Production' }, { id: 'd2', name: 'Admin' }, ...createdDepts], create: async (n) => { createdDepts.push({ id: 'dn' + createdDepts.length, name: n }) } },
  shifts: { list: async () => [{ id: 's1', name: 'Day shift', start: '07:00', end: '16:00' }, { id: 's2', name: 'Night shift', start: '19:00', end: '04:00' }] },
})
const holidays = [{ date: '2026-10-10', name: 'Pchum Ben', nameKh: '' }]
stub('lib/leave-store.js', {
  ready: async () => true,
  types: { list: async () => [{ id: 't1', code: 'AL', name: 'Annual leave', isActive: true }, { id: 't2', code: 'SL', name: 'Sick leave', isActive: true }] },
  holidays: { list: async () => holidays, add: async () => {}, remove: async () => {} },
  entitlements: { forYear: async (y) => (y === 2026 ? { 1: { t1: 18 } } : {}), saveMany: async () => ({}) },
  overrides: { set: async () => {} },
})
stub('lib/payroll-store.js', { structure: { list: async () => ({ 1: { pin: '1', salary: 200, taxResident: true, taxExempt: false, nssfExempt: false, dependents: 0, paymentMethod: 'cash', bankName: '', bankAccount: '' } }), saveMany: async () => 0 } })
stub('lib/store.js', { overrides: { query: async () => [{ pin: '1', date: '2026-10-02', status: 'present', note: 'forgot', timeIn: '07:00:00', timeOut: '16:00:00' }] } })

const savedKeys = new Set(), imported = []
stub('lib/discipline-store.js', { records: { ready: async () => true, importKeysSaved: async (keys) => new Set(keys.filter(k => savedKeys.has(k))), importOne: async (d) => { imported.push(d) } } })

const imp = require('../lib/import.js')
const book = (rows) => XLSX.write({ SheetNames: ['S'], Sheets: { S: XLSX.utils.aoa_to_sheet(rows) } }, { type: 'buffer', bookType: 'xlsx' })
const serial = (ymd) => (Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8)) - Date.UTC(1899, 11, 30)) / 86400000
const run = async (kind, rows) => { const { rows: r } = await imp.parse(kind, book(rows)); return imp.plan(kind, r) }
const rejects = async (fn) => { try { await fn(); return null } catch (e) { return e.message } }

;(async () => {
  console.log('reading the file')
  let { rows, ignored } = await imp.parse('staff', book([['pin', ' NAME ', 'Joined', 'Day off', 'Mystery'], [3, 'New Person', serial('2026-08-14'), 'Sat, Sun', 'x']]))
  ok(rows.length === 1 && rows[0].pin === '3' && rows[0].name === 'New Person', 'headings match in any case, with spaces; a number PIN becomes text')
  ok(rows[0].joiningDate === '2026-08-14', 'a real Excel date is read as YYYY-MM-DD')
  ok(ignored.length === 1 && ignored[0] === 'Mystery', 'an unknown column is reported, not guessed')
  ;({ rows } = await imp.parse('staff', book([['PIN', 'Name', 'Joining date', 'In'], ['4', 'A', '14/08/2026', '7:00 AM'], ['5', 'B', '2026-8-4', '19:23'], ['6', 'C', '31/02/2026', '0.5'], ['7', 'D', '14 Aug 2026', 0.75]])))
  ok(rows[0].joiningDate === '2026-08-14' && rows[0].timeIn === '07:00', 'day-first text dates and 12-hour times')
  ok(rows[1].joiningDate === '2026-08-04' && rows[1].timeIn === '19:23', 'single-digit months and 24-hour times')
  ok(rows[2].joiningDate.startsWith('?') && rows[2].timeIn.startsWith('?'), 'an impossible date and a time-like "0.5" text are flagged, not accepted')
  ok(rows[3].joiningDate === '2026-08-14' && rows[3].timeIn === '18:00', 'a month name works; an Excel time fraction (0.75) is 18:00')
  ok(/at least one of/.test(await rejects(() => imp.parse('staff', book([['Colour'], ['red']])))), 'a file with no recognisable heading is explained')
  ok(/Missing: PIN/.test(await rejects(() => imp.parse('paysetup', book([['Salary'], ['1']])))), 'a missing required heading is explained')
  ok(/empty/.test(await rejects(() => imp.parse('staff', book([['PIN', 'Name']])))) || /no rows/.test(await rejects(() => imp.parse('staff', book([['PIN', 'Name']])))), 'a file with only headings is refused')
  ok(await rejects(() => imp.parse('staff', Buffer.alloc(0))), 'an empty upload is refused')
  ok(await rejects(() => imp.parse('nope', book([['a'], ['b']]))), 'an unknown kind is refused')

  console.log('staff')
  let p = await run('staff', [['PIN', 'Name', 'Department', 'Shift', 'Days off', 'Other PINs'],
    ['2', '', '', '', '', ''],                      // nothing given for an existing person: same
    ['1', 'Sok Dara', 'Admin', '', '', ''],         // changed department
    ['9', 'Brand New', 'Production', 'Night shift', 'Sun', ''],
    ['13', 'Ghost Dept', 'Nowhere', '', 'Sun', ''],
    ['10', 'No Days', '', '', '', ''],
    ['11', 'Alias Clash', '', '', 'Sun', '901'],
    ['9', 'Dupe', '', '', 'Sun', ''],
    ['', 'No Pin', '', '', 'Sun', ''],
    ['12', 'Bad Day', '', '', 'Funday', '']])
  const st = (i) => p[i].status
  ok(st(0) === 'same', 'a row with blank cells for an existing person changes nothing (blank keeps)')
  ok(st(1) === 'changed' && p[1].changes.length === 1 && p[1].changes[0].field === 'Department' && p[1].changes[0].to === 'Admin', 'a department change is shown as exactly that one change')
  ok(st(2) === 'new' && p[2].data.create && p[2].data.save.shiftId === 's2' && p[2].data.save.timeIn === '19:00', 'a new person with a shift takes the shift hours')
  ok(st(3) === 'new' && p.notices.length === 1 && /Nowhere/.test(p.notices[0]), 'a department that does not exist yet is created, and the preview says so')
  ok(st(4) === 'error' && /Days off/.test(p[4].message), 'a new person without days off is an error')
  ok(st(5) === 'error' && /901/.test(p[5].message), 'an alias that belongs to someone else is an error')
  ok(st(6) === 'error' && /line 4/.test(p[6].message), 'a PIN repeated in the file is an error that names the first line')
  ok(st(7) === 'error' && st(8) === 'error', 'an empty PIN and an unrecognised weekday are errors')
  const ap = await imp.apply('staff', (await imp.parse('staff', book([['PIN', 'Name', 'Department', 'Days off', 'Shift'], ['1', 'Sok Dara', 'Admin', '', ''], ['2', 'Chan Vy', '', '', ''], ['20', 'Zed', 'Production', 'Sun', ''], ['21', 'Bad', '', 'Sun', 'No such shift']]))).rows, 'tester')
  ok(ap.changed === 1 && ap.added === 1 && ap.same === 1 && ap.skipped === 1 && saved.length === 2, 'apply writes only new and changed rows, once each; errors and unchanged are left alone')
  ok(saved.find(s => s.pin === '1').input.departmentId === 'd2' && saved.find(s => s.pin === '20').o.create === true, 'apply goes through hr.staff.save with the right flags')

  console.log('staff list in the company own layout (no PIN column)')
  p = await run('staff', [[], ['No', 'ID CARD', 'EMPLOYEE NAME', '', 'DOB', 'Gender', 'Start Date', 'Group', 'Department', 'Position', 'Phone Number'],
    [1, 'SF0001', 'Sok Dara', 'សុខ ដារ៉ា', serial('1990-05-01'), 'M', serial('2025-03-01'), 'Worker', 'Production', 'ជាងកាន់ម៉ាស៊ីន', '012 345 678'],
    [2, 'SF0099', 'Chan  Vy ', 'ចាន់ វី', serial('1995-01-02'), 'F', serial('2024-01-02'), 'Office', 'Brand New Dept', 'Clerk', ''],
    [3, 'SF0500', 'Nobody Here', '', '', 'F', serial('2024-01-02'), 'Office', 'Production', 'x', ''],])
  ok(p.length === 3 && p[0].line === 3, 'the heading row is found on line 2 and rows keep their Excel line numbers')
  ok(p[0].status === 'changed' && /matched by Staff ID/.test(p[0].label) && p[0].changes.some(c => c.field === 'Name (Khmer)' && c.to === 'សុខ ដារ៉ា'), 'a row with no PIN is matched by Staff ID, and the blank-headed Khmer column is read as the Khmer name')
  ok(p[0].changes.some(c => c.field === 'Gender' && c.to === 'Male') && p[0].changes.some(c => c.field === 'Date of birth' && c.to === '1990-05-01'), 'gender M becomes Male and the Excel date becomes a date of birth')
  ok(p[1].status === 'changed' && /matched by name/.test(p[1].label) && p[1].data.newDepartment === 'Brand New Dept', 'with no Staff ID match, a name matches regardless of spacing and case')
  ok(p.notices.length === 1 && /Brand New Dept/.test(p.notices[0]), 'the preview names the department that will be created')
  ok(p[2].status === 'error' && /No staff member matches/.test(p[2].message), 'a person who matches nobody is an error, never a guess')
  p = await run('staff', [['PIN', 'Gender'], ['2', 'X']])
  ok(p[0].status === 'error' && /Gender "X"/.test(p[0].message), 'a gender other than Male or Female is an error')
  const before = createdDepts.length
  const ap2 = await imp.apply('staff', (await imp.parse('staff', book([[], ['ID CARD', 'EMPLOYEE NAME', 'Department'], ['SF0001', 'Sok Dara', 'Brand New Dept']]))).rows, 'tester')
  ok(createdDepts.length === before + 1 && ap2.changed === 1, 'applying creates the new department once, then saves the person into it')

  console.log('pay setup')
  p = await run('paysetup', [['PIN', 'Salary', 'Tax resident', 'Dependents', 'Payment method', 'Bank account'],
    ['1', '', '', '', '', ''], ['1', '$250.00', 'no', '2', 'Bank', '000123456'], ['2', '300', '', '', '', ''], ['3', '100', '', '', '', ''], ['2', '-5', '', '', '', ''], ['2', 'abc', '', '', '', ''], ['2', '', 'maybe', '', '', '']])
  ok(p[0].status === 'same', 'pay setup: blank cells keep the saved values')
  ok(p[1].status === 'error' && /line 2/.test(p[1].message), 'pay setup: the same PIN twice is an error')
  p = await run('paysetup', [['PIN', 'Salary', 'Tax resident', 'Dependents', 'Payment method', 'Bank account'], ['1', '$250.00', 'no', '2', 'Bank', '000123456'], ['2', '300', '', '', '', ''], ['3', '100', '', '', '', ''], ['2', '-5', '', '', '', '']])
  ok(p[0].status === 'changed' && p[0].data.salary === 250 && p[0].data.taxResident === false && p[0].data.dependents === 2 && p[0].data.paymentMethod === 'bank', 'pay setup: "$250.00", "no", "Bank" read correctly')
  ok(p[0].changes.find(c => c.field === 'Bank account').to.endsWith('3456') && !/000123456/.test(JSON.stringify(p[0].changes)), 'pay setup: bank account numbers are masked in the preview')
  ok(p[1].status === 'new' && p[1].data.taxResident === true, 'pay setup: a person with no setup yet is new, tax resident by default')
  ok(p[2].status === 'error' && /not in the system/.test(p[2].message), 'pay setup: an unknown PIN is an error')
  p = await run('paysetup', [['PIN', 'Salary', 'Tax resident'], ['1', 'abc', ''], ['1', '', 'maybe']])
  ok(p[0].status === 'error' && /Salary/.test(p[0].message), 'pay setup: a salary that is not a number is an error')

  console.log('holidays')
  p = await run('holidays', [['Date', 'Name'], ['2026-10-10', 'Pchum Ben'], ['10/10/2026', 'Pchum Ben Day'], ['2026-11-09', 'Independence Day'], ['not a date', 'X'], ['2026-12-01', '']])
  ok(p[0].status === 'same', 'holidays: the same date and name is unchanged')
  ok(p[1].status === 'error' && /line 2/.test(p[1].message), 'holidays: the same date twice is an error (10/10/2026 is read day-first)')
  ok(p[2].status === 'new' && p[3].status === 'error' && p[4].status === 'error', 'holidays: new date is new; a bad date and a missing name are errors')
  p = await run('holidays', [['Date', 'Name'], ['2026-10-10', 'Pchum Ben Day']])
  ok(p[0].status === 'changed' && p[0].data.replace, 'holidays: a new name on an existing date is a change')

  console.log('entitlements')
  p = await run('entitlements', [['PIN', 'Year', 'AL', 'Sick leave'], ['1', 2026, 18, 7], ['1', 2026, 18, ''], ['2', 2026, 20, ''], ['99', 2026, 5, ''], ['2', 1900, 5, ''], ['1', 2026, '', '']])
  ok(p[0].status === 'new' && p[0].data.entries.length === 1 && p[0].data.entries[0].typeId === 't2', 'entitlements: only the cell that differs is written; leave types match by code or name')
  ok(p[1].status === 'error' && /line 2/.test(p[1].message), 'entitlements: PIN and year repeated is an error')
  ok(p[2].status === 'new', 'entitlements: nothing saved yet for that person is new')
  ok(p[5].status === 'error' && /line 2/.test(p[5].message), 'entitlements: (a row repeating PIN and year is checked before its days)')
  ok(p[3].status === 'error' && p[4].status === 'error', 'entitlements: unknown PIN and impossible year are errors')
  p = await run('entitlements', [['PIN', 'Year', 'AL'], ['1', 2026, 18], ['1', 2027, 21]])
  ok(p[0].status === 'same' && p[1].status === 'new', 'entitlements: an identical value is unchanged')
  p = await run('entitlements', [['PIN', 'Year', 'AL'], ['2', 2026, '']])
  ok(p[0].status === 'error' && /No days/.test(p[0].message), 'entitlements: a row with no days is an error, not a silent clear')

  console.log('corrections')
  p = await run('corrections', [['PIN', 'Date', 'Status', 'Note', 'In', 'Out'],
    ['1', '2026-10-02', 'Present', 'forgot', '07:00', '16:00'],
    ['1', '2026-10-03', 'Day off', 'agreed', '', ''],
    ['1', '2026-10-04', 'Present', '', '', ''],
    ['1', '2026-10-05', 'Sleeping', 'x', '', ''],
    ['1', '2026-10-06', 'Leave', 'x', '07:00', '16:00'],
    ['1', '2026-10-07', 'Present', 'x', '07:00', ''],
    ['2', '2026-10-02', 'Excused', 'doctor', '', '']])
  ok(p[0].status === 'same', 'corrections: 07:00:00 saved equals 07:00 in the file')
  ok(p[1].status === 'new' && p[1].data.status === 'day_off', 'corrections: "Day off" becomes day_off')
  ok([2, 3, 4, 5].every(i => p[i].status === 'error'), 'corrections: missing note, unknown status, times on a non-present day, half a time pair are all errors')
  ok(p[6].status === 'new', 'corrections: the same date for a different person is separate')

  console.log('discipline register')
  const Dsc = require('../lib/discipline.js')
  const head = ['No', 'Staff ID', 'Name', 'Position', 'Department', 'Amount of salary deduction', 'Occurrence date', 'ការណែនាំ/ការព្រមាន', 'Reason']
  const dRows = [['Staff discipline register'], head,
    [1, 'SF0001', 'Sok Dara', 'Operator', 'Production', ' $5.00 ', serial('2026-08-14'), 'ណែនាំផ្ទាល់មាត់', 'Late'],
    [2, 'SF0149', 'ឈិន បារាំង', 'Trailer driver', 'ដឹកជញ្ជូន', ' $-   ', serial('2026-08-15'), 'លិខិតព្រមាន', 'ប្រេះកញ្ចក់'],
    [3, '', '', '', '', '', '', '', ''],
    [4, 'SF0001', 'Sok Dara', 'Operator', 'Production', 'paid', serial('2026-08-16'), 'N/A', 'Damaged'],
    [5, 'SF0001', 'Sok Dara', 'Operator', 'Production', '', serial('2026-08-17'), 'mystery', 'x'],
    [6, 'SF0001', 'Sok Dara', 'Operator', 'Production', '', serial('2026-08-14'), 'ណែនាំផ្ទាល់មាត់', 'Late'],
    [7, 'SF0001', 'Sok Dara', 'Operator', 'Production', 'five', serial('2026-08-18'), 'ណែនាំផ្ទាល់មាត់', 'Late again'],
    [8, 'SF0001', 'Sok Dara', 'Operator', 'Production', '', serial('2099-01-01'), 'ណែនាំផ្ទាល់មាត់', 'Future']]
  p = await run('discipline', dRows)
  ok(p.length === 7, 'discipline: the heading row is found below a title and the blank numbered row is skipped')
  ok(p[0].status === 'new' && p[0].data.pin === '1' && p[0].data.kind === 'verbal_guidance' && p[0].data.deduction === 5 && p[0].data.occurredOn === '2026-08-14', 'discipline: Staff ID matches the staff list, Khmer type and dollar amount are read')
  ok(p[1].status === 'new' && p[1].data.pin === null && p[1].data.staffName === 'ឈិន បារាំង' && p[1].data.kind === 'warning_letter' && p[1].data.deduction === null && p[1].changes.some(c => /Not in the staff list/.test(c.to)), 'discipline: someone not in the staff list is kept by name')
  ok(p[2].status === 'new' && p[2].data.kind === 'noted' && p[2].data.deduction === null && p[2].changes.some(c => /paid/.test(c.to)), 'discipline: N/A is a note, and "paid" is flagged instead of treated as money')
  ok(p[3].status === 'error' && /not one the register knows/.test(p[3].message), 'discipline: an unknown type is an error, never guessed')
  ok(p[4].status === 'error' && /repeats line/.test(p[4].message), 'discipline: a repeated row is an error')
  ok(p[5].status === 'error' && /not a number/.test(p[5].message), 'discipline: a bad amount is an error')
  ok(p[6].status === 'error' && /future/.test(p[6].message), 'discipline: a future date is an error')
  savedKeys.add(p[0].data.importKey)
  p = await run('discipline', dRows)
  ok(p[0].status === 'same' && p[1].status === 'new', 'discipline: a row already saved shows as no change')
  const res = await imp.apply('discipline', (await imp.parse('discipline', book(dRows))).rows, 'hr')
  ok(res.added === 2 && res.same === 1 && res.skipped === 4 && res.failed.length === 0 && imported.length === 2 && imported.every(d => d.importKey), 'discipline: apply saves only the new rows, leaves saved and error rows alone')

  console.log(fails ? `\n${fails} FAILED` : '\nall passed')
  process.exit(fails ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
