// A night worker's lone dawn OUT (the evening IN was never recorded) belongs to the shift that started the evening before.
// Regression: PIN 341 (17:00-00:00) missed his IN on 5 Nov; the 00:02 OUT on 6 Nov was filed under 6 Nov, merged with that
// evening's real shift, and the "inverted IN/OUT" correction turned it into IN 00:02 / OUT 15:59 / 16.0 h (and 5 Nov Absent).
const { dailyRows } = require('../lib/attendance.js')
let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }
const settings = { workStart: '08:00', workEnd: '17:30', graceMinutes: 5 }
const P = (pin, t) => ({ pin, time: t })

// 1 = night 17:00-00:00 (Sun off), 2 = day 08:00-17:00 (Sun off). 2030-11-04 is a Monday.
const emps = {
  1: { name: 'Night', group: 'worker', timeIn: '17:00', timeOut: '00:00', offDays: [0], aliases: [] },
  2: { name: 'Day', group: 'worker', timeIn: '08:00', timeOut: '17:00', offDays: [0], aliases: [] },
}
const get = (rows, pin, date) => rows.find(r => r.pin === pin && r.date === date)

// ── the PIN 341 case ────────────────────────────────────────────────────────
const punches = [
  P('1', '2030-11-04 16:05:00'), P('1', '2030-11-05 00:04:00'),   // Mon: a normal night (IN, then OUT after midnight)
  /* Tue 5: no IN scan at all */                                  P('1', '2030-11-06 00:02:00'),   // Tue's shift OUT, IN missing
  P('1', '2030-11-06 15:59:00'), P('1', '2030-11-07 00:02:00'),   // Wed: a normal night again
]
const rows = dailyRows(punches, emps, settings, [], '2030-11-04', '2030-11-07')
const mon = get(rows, '1', '2030-11-04'), tue = get(rows, '1', '2030-11-05'), wed = get(rows, '1', '2030-11-06')
ok(mon.status === 'present' && mon.in === '16:05' && mon.out === '00:04' && mon.outNextDay === true && mon.hours === 8, 'a normal night is untouched: Mon 16:05 -> 00:04, about 8 h')
ok(tue.status === 'present', 'the night with a missing IN is NOT absent (the worker scanned out)')
ok(tue.in === null && tue.out === '00:02' && tue.outNextDay === true && tue.hours === 0, 'Tue shows the dawn OUT on the next day with no IN and no invented hours')
ok(wed.status === 'present' && wed.in === '15:59' && wed.out === '00:02' && wed.outNextDay === true, 'Wed is IN 15:59 / OUT 00:02 next day, not swapped')
ok(wed.hours > 7.9 && wed.hours < 8.3, `Wed is about 8 h, not 16 (got ${wed.hours})`)
ok(wed.punches === 2, `Wed counts only its own two scans (got ${wed.punches})`)

// ── a lone OUT before midnight stays on its own date ────────────────────────
const late = dailyRows([P('1', '2030-11-05 23:50:00')], emps, settings, [], '2030-11-04', '2030-11-06')
ok(get(late, '1', '2030-11-05').out === '23:50' && !get(late, '1', '2030-11-05').outNextDay, 'a 23:50 OUT with no IN belongs to that same evening, not the day before')
ok(get(late, '1', '2030-11-04').status === 'absent', 'and the day before is still absent')

// ── day shifts behave as before ─────────────────────────────────────────────
const day = dailyRows([P('2', '2030-11-05 17:05:00')], emps, settings, [], '2030-11-04', '2030-11-06')
const d5 = get(day, '2', '2030-11-05')
ok(d5.status === 'present' && d5.in === null && d5.out === '17:05' && !d5.outNextDay, 'a day worker with only an evening OUT keeps the same row as before')

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
