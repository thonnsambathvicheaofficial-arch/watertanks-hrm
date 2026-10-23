// Roster notes (HR's correction on a day) and leave reasons are kept apart on every report row, and reach the exports' helpers.
const { dailyRows } = require('../lib/attendance.js')
const { addLeaveEntry, leaveNote } = require('../lib/leave-calc.js')
const { rosterDetails, rosterLines, ROSTER_HEADER } = require('../lib/timesheet-leave.js')
let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }
const settings = { workStart: '08:00', workEnd: '17:30', graceMinutes: 5 }
const emps = { 1: { name: 'Day', group: 'worker', timeIn: '07:00', timeOut: '17:00', offDays: [0], aliases: [] } }
const P = (t) => ({ pin: '1', time: t })
const punches = [P('2030-11-05 07:00:00'), P('2030-11-05 17:00:00')]
const leaves = new Map()
addLeaveEntry(leaves, '1|2030-11-06', { code: 'UP', note: leaveNote('Unpaid leave', null, 'Family event'), days: 1, rank: 4, paid: false })   // approved leave only
addLeaveEntry(leaves, '1|2030-11-07', { code: 'AL', note: leaveNote('Annual leave', null, 'Dentist'), days: 1, rank: 1, paid: true })        // leave AND a correction on the same day
const overrides = [
  { pin: '1', date: '2030-11-05', status: 'present', note: 'Forgot to scan out, confirmed by supervisor', timeIn: null, timeOut: null },   // a correction on a worked day
  { pin: '1', date: '2030-11-07', status: 'present', note: 'Came in after all', timeIn: null, timeOut: null },                              // beats the leave
]
const rows = dailyRows(punches, emps, settings, overrides, '2030-11-04', '2030-11-08', { holidays: new Map(), leaves })
const day = (d) => rows.find(r => r.pin === '1' && r.date === d)

console.log('on the daily rows')
ok(day('2030-11-05').rosterNote === 'Forgot to scan out, confirmed by supervisor' && day('2030-11-05').leaveReason === '', 'a corrected day has a roster note and no leave reason')
ok(day('2030-11-06').status === 'leave' && day('2030-11-06').leaveReason === 'Unpaid leave: Family event' && day('2030-11-06').rosterNote === '', 'a leave day has the leave reason and no roster note (it is not a correction)')
ok(day('2030-11-07').status === 'present' && day('2030-11-07').rosterNote === 'Came in after all' && day('2030-11-07').leaveReason === 'Annual leave: Dentist', 'a correction on a leave day keeps BOTH: the roster note and the leave reason that it overrode')
ok(day('2030-11-04').rosterNote === '' && day('2030-11-04').leaveReason === '', 'an ordinary day has neither')
ok(rows.every(r => typeof r.rosterNote === 'string' && typeof r.leaveReason === 'string'), 'every row has both fields (never undefined)')
ok(day('2030-11-06').note === 'Unpaid leave: Family event' && day('2030-11-05').note === 'Forgot to scan out, confirmed by supervisor', 'the original note field is unchanged for anything that still reads it')

console.log('the roster notes in the exports')
const ts = { days: [5, 6, 7].map(d => ({ d, date: `2030-11-0${d}` })), rows: [{ pin: '1', name: 'Day', group: 'worker', cells: { 5: { status: 'present', rosterNote: 'Forgot to scan out' }, 6: { status: 'leave', rosterNote: '', leaveReason: 'Unpaid leave: Family event' }, 7: { status: 'present', rosterNote: ' Came in after all ' } } }] }
const rd = rosterDetails(ts, (g) => (g === 'worker' ? 'Worker' : g), (s) => ({ present: 'Present', leave: 'Leave' }[s] || s))
ok(rd.byPin.get('1') === '5 Nov: Forgot to scan out; 7 Nov: Came in after all', 'one line per person: each corrected day with its note, in date order')
ok(rd.list.length === 2 && rd.list[0].join('|') === '2030-11-05|Tuesday|1|Day|Worker|Present|Forgot to scan out' && ROSTER_HEADER.join() === 'Date,Day,PIN,Name,Group,Status,Note', 'the Roster notes sheet lists corrected days only (a plain leave day is not one)')
const rl = rosterLines([{ pin: '1', date: '2030-11-07', rosterNote: 'Came in after all' }, { pin: '1', date: '2030-11-05', rosterNote: 'Forgot to scan out' }, { pin: '2', date: '2030-11-05', rosterNote: '' }, { pin: '3', date: '2030-11-05' }])
ok(rl.get('1') === '5 Nov: Forgot to scan out; 7 Nov: Came in after all' && !rl.has('2') && !rl.has('3'), 'the Summary export gets the same line from the Reports day rows; empty notes are skipped')

console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
