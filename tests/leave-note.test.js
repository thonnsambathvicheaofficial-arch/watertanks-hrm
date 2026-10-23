// What a leave day says in the reports: the leave type plus the reason HR wrote.
const { leaveNote, addLeaveEntry } = require('../lib/leave-calc.js')
let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }

console.log('the note on a leave day')
ok(leaveNote('Unpaid leave', null, 'Family event') === 'Unpaid leave: Family event', 'the reason follows the leave type')
ok(leaveNote('Unpaid leave', null, '') === 'Unpaid leave' && leaveNote('Unpaid leave', null, null) === 'Unpaid leave' && leaveNote('Unpaid leave', null, '   ') === 'Unpaid leave', 'no reason: the note is just the leave type, as before')
ok(leaveNote('Annual leave', 'morning', 'Dentist') === 'Annual leave (morning half day): Dentist', 'a half day names the half, then the reason')
ok(leaveNote('Sick leave', null, '  fever\n and   cough ') === 'Sick leave: fever and cough', 'line breaks and extra spaces are tidied (a cell must stay on one line)')
ok(leaveNote('Sick leave', null, 'ឈឺក្បាល') === 'Sick leave: ឈឺក្បាល', 'Khmer reasons pass through')
ok(leaveNote('Sick leave', null, 'x'.repeat(500)).length === 'Sick leave: '.length + 200, 'a very long reason is cut to 200 characters')

console.log('two requests on one day')
const map = new Map()
addLeaveEntry(map, '1|2026-10-29', { code: 'AL', note: leaveNote('Annual leave', 'morning', 'Dentist'), days: 0.5, rank: 1, paid: true, period: 'morning' })
addLeaveEntry(map, '1|2026-10-29', { code: 'UP', note: leaveNote('Unpaid leave', 'afternoon', 'Family'), days: 0.5, rank: 2, paid: false, period: 'afternoon' })
const e = map.get('1|2026-10-29')
ok(e.code === 'AL/UP' && e.note === 'Annual leave (morning half day): Dentist + Unpaid leave (afternoon half day): Family', 'a morning and an afternoon request keep each reason in the combined note')

console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
