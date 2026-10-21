// Tests payroll-attendance.js through the REAL engine (dailyRows) with synthetic punches.
const { dailyRows } = require('../lib/attendance.js')
const { attendanceFigures, suggestOvertime, otTier } = require('../lib/payroll-attendance.js')
let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }
const settings = { workStart: '08:00', workEnd: '17:30', graceMinutes: 5 }
const P = (pin, t) => ({ pin, time: t })

// Staff: 1 = day shift 07:00-17:00 (Sun off). 2 = night shift 19:00-04:00 (Sun off). 3 = day shift, Saturday AND Sunday off.
const emps = {
  1: { name: 'Day', group: 'worker', timeIn: '07:00', timeOut: '17:00', offDays: [0], aliases: [] },
  2: { name: 'Night', group: 'worker', timeIn: '19:00', timeOut: '04:00', offDays: [0], aliases: [] },
  3: { name: 'FiveDay', group: 'worker', timeIn: '07:00', timeOut: '17:00', offDays: [0, 6], aliases: [] },
}
const punches = [
  P('1', '2030-11-04 07:00:00'), P('1', '2030-11-04 18:30:00'),   // Mon: out 90 min after the 17:00 end -> 1.5 h
  P('1', '2030-11-06 07:00:00'), P('1', '2030-11-06 17:10:00'),   // Wed: 10 min late out -> below a 30 min threshold
  P('1', '2030-11-07 07:00:00'), P('1', '2030-11-07 17:00:00'),   // Thu: exactly on time -> none
  P('1', '2030-11-08 07:00:00'), P('1', '2030-11-08 12:00:00'),   // Fri: leaves early -> none
  P('1', '2030-11-10 08:00:00'), P('1', '2030-11-10 13:00:00'),   // Sun (day off): worked 5 h -> all 5 h
  P('2', '2030-11-04 19:00:00'), P('2', '2030-11-05 05:15:00'),   // night: out 75 min after the 04:00 end -> 1.25 h
  P('2', '2030-11-06 19:00:00'), P('2', '2030-11-07 03:50:00'),   // night: early out -> none
  P('3', '2030-11-09 07:00:00'), P('3', '2030-11-09 15:00:00'),   // Sat is HER day off: worked 8 h -> all 8 h
  P('1', '2030-11-05 07:00:00'), P('1', '2030-11-05 09:00:00'),   // Tue is a holiday: 2 h -> all 2 h
  P('1', '2030-11-11 07:00:00'), P('1', '2030-11-11 17:00:00'), P('1', '2030-11-12 07:00:00'),   // Mon normal, then a lone IN
]
const holidays = new Map([['2030-11-05', 'Holiday']])
const rows = dailyRows(punches, emps, settings, [], '2030-11-03', '2030-11-12', { holidays })
const hset = new Set(holidays.keys())
const sug = (thr = 0) => suggestOvertime({ rows, emps, holidays: hset, sched: settings, thresholdMin: thr })
const find = (list, pin, date) => list.find(x => x.pin === pin && x.date === date)

let s = sug(0)
console.log('     ' + s.map(x => `${x.pin}@${x.date.slice(8)}=${x.hours}`).join('  '))
ok(find(s, '1', '2030-11-04')?.hours === 1.5, 'normal day: out 90 min past 17:00 -> 1.5 h')
ok(find(s, '1', '2030-11-06')?.hours === 0.17, 'normal day, no threshold: 10 min past end -> 0.17 h (rounded to 2 decimals)')
ok(!find(s, '1', '2030-11-07') && !find(s, '1', '2030-11-08'), 'on time, and early leaving: no suggestion')
ok(find(s, '1', '2030-11-10')?.hours === 5, 'worked a Sunday day off: every hour (5 h) suggested')
ok(find(s, '2', '2030-11-04')?.hours === 1.25, 'NIGHT shift 19:00-04:00: out at 05:15 next morning -> 1.25 h past the 04:00 end')
ok(!find(s, '2', '2030-11-06'), 'night shift leaving early: none')
ok(find(s, '3', '2030-11-09')?.hours === 8, "a Saturday that is THIS person's own day off counts as day-off work (8 h)")
ok(find(s, '1', '2030-11-05')?.hours === 2, 'worked on a public holiday: every hour (2 h)')
ok(!find(s, '1', '2030-11-12'), 'a lone IN with no OUT scan gives no suggestion')
ok(!find(sug(30), '1', '2030-11-06') && find(sug(30), '1', '2030-11-04'), 'a 30-minute threshold drops the 10-minute case and keeps the 90-minute one')
const taken = new Set(['1|2030-11-04'])
ok(!find(suggestOvertime({ rows, emps, holidays: hset, sched: settings, taken }), '1', '2030-11-04'), 'a day that already has an entry is not suggested again')
// A forgotten scan: OUT days later must not become a 30 h overtime claim.
const far = dailyRows([P('1', '2030-11-04 07:00:00'), P('1', '2030-11-05 22:00:00')], emps, settings, [], '2030-11-04', '2030-11-05')
ok(suggestOvertime({ rows: far, emps, holidays: new Set(), sched: settings }).every(x => x.hours <= 8), 'a missed scan (OUT the next evening) never suggests more than 8 h')

console.log('\n[tiers]')
ok(otTier('2030-11-05', [0], hset) === 'holiday' && otTier('2030-11-10', [0], hset) === 'off' && otTier('2030-11-09', [0, 6], hset) === 'off' && otTier('2030-11-09', [0], hset) === 'normal', 'tier: holiday beats day off; Saturday is "off" only for people with Saturday off')
ok(otTier('2030-11-05', [0], hset) === 'holiday' && otTier('2030-11-05', [2], hset) === 'holiday', 'a holiday that is also a day off stays a holiday')

console.log('\n[attendance figures]')
const leave = new Map([['1|2030-11-06', { code: 'AL', note: 'x', days: 1, rank: 1, paid: true }], ['1|2030-11-07', { code: 'UP', note: 'x', days: 1, rank: 4, paid: false }]])
const { addLeaveEntry } = require('../lib/leave-calc.js')
const lm = new Map(); for (const [k, v] of leave) addLeaveEntry(lm, k, v)
const half = new Map(); addLeaveEntry(half, '1|2030-11-08', { code: 'AL', note: 'am', days: 0.5, rank: 1, paid: true }); addLeaveEntry(half, '1|2030-11-08', { code: 'UP', note: 'pm', days: 0.5, rank: 4, paid: false })
const merged = new Map([...lm, ...half])
const r2 = dailyRows(punches, emps, settings, [{ pin: '1', date: '2030-11-12', status: 'leave', note: 'hand', timeIn: null, timeOut: null }], '2030-11-03', '2030-11-12', { holidays, leaves: merged })
const f = attendanceFigures(r2.filter(r => r.pin === '1'), '2030-11-12')
console.log('     ', JSON.stringify(f))
ok(f.unpaidLeave === 1.5, 'unpaid leave = 1 full unpaid day + the unpaid half of an AL/UP split day = 1.5')
ok(f.paidLeave === 2.5, 'paid leave = 1 AL day + the paid half day + a hand-made leave correction = 2.5')
ok(f.manualLeave === 1, 'a hand-made leave correction (no leave type) is counted so the payslip can warn about it')
ok(attendanceFigures(r2.filter(r => r.pin === '1'), '2030-11-05').absent === 0, 'days after "today" are never absences')
const fut = dailyRows([], emps, settings, [], '2030-11-04', '2030-11-09')
ok(attendanceFigures(fut.filter(r => r.pin === '1'), '2030-11-06').absent === 3, 'with today = Wed 6th: Mon, Tue and Wed with no scans = 3 absences (Thu to Sat are future, Sunday is off)')
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
