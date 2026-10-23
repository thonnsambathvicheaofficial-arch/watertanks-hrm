// The leave details added to the roster's Excel export.
const { leaveDetails, LEAVE_HEADER, shortDate } = require('../lib/timesheet-leave.js')
let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }

const days = [23, 24, 25, 26, 27].map(d => ({ d, date: `2026-10-${d}` }))
const ts = {
  days,
  rows: [
    { pin: '443', name: 'Vin Sovan', group: 'worker', cells: { 23: { status: 'leave', note: 'Unpaid leave: ភ្លៀងខ្លាំង', leaveCode: 'UP', leaveDays: 1 }, 24: { status: 'present', hours: 8 }, 26: { status: 'leave', note: 'Annual leave (morning half day): Dentist', leaveCode: 'AL', leaveDays: 0.5 } } },
    { pin: '9', name: 'Bunh Pech', group: 'office', cells: { 23: { status: 'leave', note: 'Sick leave', leaveCode: 'SL', leaveDays: 1 }, 25: { status: 'absent' } } },
    { pin: '7', name: 'No Leave', group: 'worker', cells: { 23: { status: 'present', hours: 8 } } },
    { pin: '12', name: 'Hand Set', group: 'worker', cells: { 27: { status: 'leave', note: '  HR correction  ' } } },
  ],
}
const g = (x) => ({ office: 'Office Staff', worker: 'Worker' }[x] || '')
const { byPin, list } = leaveDetails(ts, g)

console.log('one line per person')
ok(byPin.get('443') === '23 Oct: Unpaid leave: ភ្លៀងខ្លាំង; 26 Oct: Annual leave (morning half day): Dentist', 'each leave day with its reason, in date order, joined by semicolons')
ok(byPin.get('9') === '23 Oct: Sick leave', 'a leave day with only the leave type shows just that')
ok(!byPin.has('7'), 'someone with no leave has no entry (the cell stays empty)')
ok(byPin.get('12') === '27 Oct: HR correction', 'a leave day set by hand keeps its note, tidied')

console.log('the leave sheet')
ok(LEAVE_HEADER.join() === 'Date,Day,PIN,Name,Group,Code,Days,Reason', 'the columns')
ok(list.length === 4, 'one row for every leave day, and only leave days (present and absent days are left out)')
ok(list[0].join('|') === '2026-10-23|Friday|9|Bunh Pech|Office Staff|SL|1|Sick leave' && list[1][3] === 'Vin Sovan', 'sorted by date, then name; day name and group label filled in')
ok(list.find(r => r[2] === '443' && r[0] === '2026-10-26')[6] === 0.5, 'a half day is 0.5')
ok(list.find(r => r[2] === '12')[5] === '' && list.find(r => r[2] === '12')[6] === 1, 'a hand-set leave day with no code or days still gets a row (1 day, empty code)')
ok(leaveDetails({ days, rows: [] }).list.length === 0 && leaveDetails({ days, rows: [] }).byPin.size === 0, 'an empty roster gives nothing')
ok(shortDate('2026-01-05') === '5 Jan' && shortDate('2026-12-31') === '31 Dec', 'dates read like "5 Jan"')

console.log('the same line from the Reports day rows (summary export)')
const { leaveLines } = require('../lib/timesheet-leave.js')
const flat = [
  { pin: '443', date: '2026-10-26', status: 'leave', note: 'Annual leave: Dentist' }, { pin: '443', date: '2026-10-23', status: 'leave', note: 'Unpaid leave: rain' },
  { pin: '443', date: '2026-10-24', status: 'present', note: null }, { pin: '9', date: '2026-10-23', status: 'leave', note: '' }, { pin: '7', date: '2026-10-23', status: 'absent', note: 'x' },
]
const ll = leaveLines(flat)
ok(ll.get('443') === '23 Oct: Unpaid leave: rain; 26 Oct: Annual leave: Dentist', 'leave days only, in date order, with their reasons')
ok(ll.get('9') === '23 Oct' && !ll.has('7'), 'a leave day with no note is just the date; absent days are not listed')

console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
