// What the Live dashboard shows, computed from a day of report rows (no database).
const { summarize, ago } = require('../lib/live-summary.js')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }

const departments = [{ id: 'D1', name: 'Delivery' }, { id: 'D2', name: 'Account' }]
const employees = {
  1: { name: 'Ann', group: 'office', timeIn: '07:00', departmentId: 'D2' },
  2: { name: 'Bo', group: 'worker', timeIn: '07:00', departmentId: 'D1' },
  3: { name: 'Cy', group: 'worker', timeIn: '07:00', departmentId: 'D1' },
  4: { name: 'Di', group: 'worker', timeIn: '08:00', departmentId: 'D1' },
  5: { name: 'Ed', group: 'worker', timeIn: '07:00', departmentId: '' },
  6: { name: 'Flo', group: 'office', timeIn: '07:00', departmentId: 'D2' },
}
const row = (pin, status, extra = {}) => ({ pin, name: employees[pin].name, status, in: null, minutesLate: 0, ...extra })
const rows = [
  row('1', 'present', { in: '06:55' }), row('2', 'late', { in: '07:20', minutesLate: 20 }), row('3', 'absent'),
  row('4', 'absent'), row('5', 'leave', { leaveCode: 'AL', leaveDays: 1 }), row('6', 'day_off'),
]
const P = (id, pin, time, deviceId = 'k40') => ({ id, pin, time, deviceId })
const punches = [P('a', '1', '2026-10-21 06:55:00'), P('b', '2', '2026-10-21 07:20:10'), P('c', '1', '2026-10-21 12:01:00'), P('d', '99', '2026-10-21 07:30:00', 'b3c')]
const devices = [
  { id: 'k40', name: 'K40', lastPullAt: '2026-10-21T03:50:00Z', fastAt: '2026-10-21T03:59:50Z', lastPullOk: true },
  { id: 'b3c', name: 'B3-C', lastPullAt: '2026-10-21T03:20:00Z', fastAt: null, lastPullOk: true },
  { id: 'old', name: 'Old', lastPullAt: '2026-10-21T03:59:00Z', lastPullOk: false, lastPullError: 'timeout' },
]
const nowMs = Date.parse('2026-10-21T04:00:00Z'), nowMin = 8 * 60 + 40   // two independent inputs here: 08:40 for shift maths, a fixed clock for reader ages
const s = summarize({ rows, employees, departments, punches, devices, nowMin, nowMs })

console.log('the headline numbers')
ok(s.counts.expected === 4 && s.counts.in === 2 && s.counts.onTime === 1 && s.counts.late === 1 && s.counts.notYet === 2, 'expected = present + late + not yet; in = on time + late')
ok(s.counts.pctIn === 50 && s.counts.lateMinutes === 20, 'the share who scanned in and the total minutes late')
ok(s.counts.leave === 1 && s.counts.dayOff === 1 && s.counts.other === 0, 'leave and day off are counted apart and never counted as expected')
ok(summarize({ rows: [], employees, nowMin, nowMs }).counts.pctIn === 0, 'an empty day divides by nothing without breaking')

console.log('who needs attention')
ok(s.notIn.map(n => n.name).join() === 'Cy,Di', 'not scanned yet: everyone expected without a scan')
ok(s.notIn[0].overdueMin === 100 && s.notIn[1].overdueMin === 40, 'with how long past their shift start (07:00 at 08:40 = 100 min; 08:00 = 40 min); the longest overdue comes first')
ok(s.late.length === 1 && s.late[0].name === 'Bo' && s.late[0].minutesLate === 20, 'late list with minutes late')
ok(s.leave.length === 1 && s.leave[0].code === 'AL', 'on leave today, with the leave code')
ok(s.unknown.length === 1 && s.unknown[0].pin === '99' && s.unknown[0].scans === 1, 'a scan from a PIN nobody owns is flagged')

console.log('by department')
const d1 = s.byDepartment.find(d => d.id === 'D1'), d2 = s.byDepartment.find(d => d.id === 'D2'), none = s.byDepartment.find(d => d.id === '')
ok(d1.name === 'Delivery' && d1.total === 3 && d1.in === 1 && d1.late === 1 && d1.notYet === 2, 'Delivery: Bo late, Cy and Di not yet')
ok(d2.total === 1 && d2.onTime === 1, 'Account: only Ann is expected (Flo has the day off)')
ok(none && none.name === 'No department' && none.leave === 1 && s.byDepartment[s.byDepartment.length - 1].id === '', 'staff with no department are listed last, not dropped')
ok(s.byDepartment[0].id === 'D1', 'the department with the most people not in yet comes first')

console.log('latest scans')
ok(s.recent.map(r => r.id).join('') === 'cdba', 'newest first')
ok(s.recent.find(r => r.id === 'a').direction === 'in' && s.recent.find(r => r.id === 'c').direction === 'out', 'first scan is in, the next one out')
ok(s.recent.find(r => r.id === 'b').lateMin === 20 && s.recent.find(r => r.id === 'a').lateMin === 0, 'the late arrival scan carries its minutes late; others do not')
ok(summarize({ rows, employees, departments, punches, devices, nowMin, nowMs, latest: 2 }).recent.length === 2, 'the list is capped')
ok(s.lastScan.id === 'c' && s.scansToday === 4, 'last scan and scans today')

console.log('readers')
const r = Object.fromEntries(s.readers.map(x => [x.name, x]))
ok(r.K40.state === 'ok' && r.K40.ageMin === 0 && r.K40.scansToday === 3, 'a recently checked reader is fine; its scans today are counted')
ok(r['B3-C'].state === 'stale' && r['B3-C'].ageMin === 40, 'unchecked for over 10 minutes during working hours is flagged stale')
ok(r.Old.state === 'failed' && r.Old.error === 'timeout', 'a failed last pull is flagged with the reason')
ok(summarize({ rows, employees, punches, devices, nowMin: 22 * 60, nowMs }).readers.find(x => x.name === 'B3-C').state === 'ok', 'outside working hours a quiet reader is not an alarm')

console.log('wording')
ok(ago(0) === 'just now' && ago(4) === '4 min ago' && ago(60) === '1 h ago' && ago(125) === '2 h 5 min ago' && ago(null) === '', 'ages read naturally')

console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
