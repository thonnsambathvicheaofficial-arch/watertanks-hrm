// The date maths behind the date pickers.
const D = require('../lib/date-pick.ts')
let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }

console.log('typing a date')
ok(D.parseDate('25/10/2026') === '2026-10-25' && D.parseDate('5/1/2027') === '2027-01-05' && D.parseDate(' 25-10-26 ') === '2026-10-25' && D.parseDate('25.10.2026') === '2026-10-25' && D.parseDate('2026-10-25') === '2026-10-25' && D.parseDate('2026-1-5') === '2026-01-05', 'day-first dates in the usual forms, and ISO, are read')
ok(D.parseDate('31/02/2026') === '' && D.parseDate('29/02/2027') === '' && D.parseDate('29/02/2028') === '2028-02-29' && D.parseDate('00/10/2026') === '' && D.parseDate('25/13/2026') === '', 'impossible dates are refused (and a leap day is allowed)')
ok(D.parseDate('') === '' && D.parseDate('garbage') === '' && D.parseDate('25/10') === '' && D.parseDate(null) === '' && D.parseDate(undefined) === '' && D.parseDate('25//2026') === '', 'junk and half dates are refused')
ok(D.formatDMY('2026-10-25') === '25/10/2026' && D.formatDMY('') === '' && D.formatDMY('nope') === '', 'shown as dd/mm/yyyy')
ok(D.formatShort('2026-10-26') === 'Mon 26 Oct' && D.formatShort('2026-10-25') === 'Sun 25 Oct' && D.formatShort('x') === '', 'a short day name for the summary line')
ok(D.isRealDate('2026-10-25') && !D.isRealDate('2026-02-30') && !D.isRealDate('2026-10-5'), 'real dates')

console.log('moving around')
ok(D.addDays('2026-10-31', 1) === '2026-11-01' && D.addDays('2026-01-01', -1) === '2025-12-31' && D.addDays('2028-02-28', 1) === '2028-02-29' && D.addDays('2026-10-25', 7) === '2026-11-01', 'adding days crosses months, years and a leap day')
ok(D.addMonths('2026-10', 1) === '2026-11' && D.addMonths('2026-12', 1) === '2027-01' && D.addMonths('2026-01', -1) === '2025-12' && D.addMonths('2026-10', 14) === '2027-12' && D.addMonths('2026-10', -10) === '2025-12', 'adding months crosses years both ways')
ok(D.daysInclusive('2026-10-26', '2026-10-28') === 3 && D.daysInclusive('2026-10-26', '2026-10-26') === 1 && D.daysInclusive('2026-10-30', '2026-11-02') === 4, 'a range counts both ends')
ok(JSON.stringify(D.orderRange('2026-10-28', '2026-10-26')) === '["2026-10-26","2026-10-28"]' && JSON.stringify(D.orderRange('2026-10-26', '2026-10-28')) === '["2026-10-26","2026-10-28"]', 'a range picked backwards is put in order')

console.log('the month grid')
const g = D.monthGrid('2026-10')
ok(g.length === 42 && g.every((c, i) => i === 0 || c.date === D.addDays(g[i - 1].date, 1)), 'six weeks of 42 consecutive days')
ok(g[0].date === '2026-09-28' && g[0].dow === 1 && !g[0].inMonth, 'October 2026 starts on Thursday, so the grid starts on Monday 28 September')
ok(g.filter(c => c.inMonth).length === 31 && g.find(c => c.date === '2026-10-01').inMonth && g.find(c => c.date === '2026-10-31').inMonth && !g.find(c => c.date === '2026-11-01').inMonth, 'exactly the 31 days of October are in the month')
ok(D.monthGrid('2026-06')[0].date === '2026-06-01' && D.monthGrid('2026-06')[0].dow === 1 && D.monthGrid('2026-02')[0].date === '2026-01-26', 'a month that starts on Monday starts the grid; February 2026 starts on Sunday so 26 January leads')
ok(g.find(c => c.date === '2026-10-25').dow === 0 && g.find(c => c.date === '2026-10-24').dow === 6, 'weekday numbers: Sunday 0, Saturday 6')
ok(/^\d{4}-\d{2}-\d{2}$/.test(D.todayISO()), 'today is a date')
ok(D.daysInMonth('2026-02') === 28 && D.daysInMonth('2028-02') === 29 && D.daysInMonth('2026-10') === 31 && D.daysInMonth('2026-11') === 30, 'days in a month, including a leap February')
ok(D.sameDayInMonth('2026-02', 31) === '2026-02-28' && D.sameDayInMonth('2026-11', 31) === '2026-11-30' && D.sameDayInMonth('2026-11', 15) === '2026-11-15' && D.sameDayInMonth('2028-02', 31) === '2028-02-29', 'the same day in another month, or its last day when that month is shorter')
ok(D.weekdayLong('2026-10-26') === 'Monday' && D.weekdayLong('2026-10-25') === 'Sunday', 'full weekday names for screen readers')

console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
