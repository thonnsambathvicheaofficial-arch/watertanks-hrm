// The roster day page lists the scans of the SHIFT that starts on the day, not the ones stamped with its date.
// Regression: PIN 391 (night, 16:00-00:00), 19-20 Nov 2026 - Fri's page showed Thu's 00:02 OUT above Fri's own 16:08 IN
// while its status line said "no out scan".
const { dailyRows } = require('../lib/attendance.js')
const { dayScans } = require('../lib/day-scans.js')
let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }
const settings = { workStart: '08:00', workEnd: '17:30', graceMinutes: 5 }
const emps = { 1: { name: 'Night', group: 'worker', timeIn: '16:00', timeOut: '00:00', offDays: [0], aliases: [] } }
let n = 0
const P = t => ({ id: 'p' + ++n, pin: '1', time: t, deviceId: 'd' })
// 2030-11-18 Mon. Mon: IN 16:40, OUT 00:13 (Tue). Tue: IN 16:09, repeat 16:46, OUT 00:02 (Wed). Wed: IN 16:08, never scanned out.
const punches = [P('2030-11-18 16:40:25'), P('2030-11-19 00:13:13'), P('2030-11-19 16:09:30'), P('2030-11-19 16:46:33'), P('2030-11-20 00:02:59'), P('2030-11-20 16:08:37')]
const rows = dailyRows(punches, emps, settings, [], '2030-11-17', '2030-11-21')
const t = (date) => dayScans(punches, rows.filter(r => r.date >= '2030-11-17'), date)
const times = a => a.map(p => p.time.slice(5, 16)).join(' | ')

const tue = t('2030-11-19')
ok(times(tue.mine) === '11-19 16:09 | 11-19 16:46 | 11-20 00:02', `Tue lists its own shift, incl. the OUT stamped Wed (got ${times(tue.mine)})`)
ok(tue.mine.find(p => p.time.includes('00:02')).onDate === false && tue.mine[0].onDate === true, 'the after-midnight OUT is marked as stamped with another date')
ok(times(tue.elsewhere) === '11-19 00:13' && tue.elsewhere[0].belongsTo === '2030-11-18', `Tue's 00:13 is shown as closing Mon's shift (got ${times(tue.elsewhere)})`)

const wed = t('2030-11-20')
ok(times(wed.mine) === '11-20 16:08', `Wed lists only its 16:08 IN: no out scan, like the status line (got ${times(wed.mine)})`)
ok(times(wed.elsewhere) === '11-20 00:02' && wed.elsewhere[0].belongsTo === '2030-11-19', 'Wed notes that its 00:02 belongs to Tue')

const mon = t('2030-11-18')
ok(times(mon.mine) === '11-18 16:40 | 11-19 00:13' && mon.elsewhere.length === 0, `Mon lists its IN and the OUT after midnight (got ${times(mon.mine)})`)

// a scan no shift claims is never hidden, and a day with no scans is empty
const stray = [P('2030-11-21 03:30:00')]
const sr = dailyRows(stray, emps, settings, [], '2030-11-20', '2030-11-22')
ok(dayScans(stray, sr, '2030-11-21').mine.length + dayScans(stray, sr, '2030-11-21').elsewhere.length >= 1, 'every scan shows up on some page')
ok(dayScans([], dailyRows([], emps, settings, [], '2030-11-20', '2030-11-22'), '2030-11-21').mine.length === 0, 'no scans, nothing listed')

// day-shift worker: calendar day and shift agree, nothing changes
const dEmps = { 1: { name: 'Day', group: 'worker', timeIn: '08:00', timeOut: '17:00', offDays: [0], aliases: [] } }
const dp = [P('2030-11-19 07:58:00'), P('2030-11-19 17:03:00')]
const dr = dailyRows(dp, dEmps, settings, [], '2030-11-18', '2030-11-20')
const dd = dayScans(dp, dr, '2030-11-19')
ok(times(dd.mine) === '11-19 07:58 | 11-19 17:03' && dd.elsewhere.length === 0 && dd.mine.every(p => p.onDate), 'a day worker sees both scans, as before')

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
