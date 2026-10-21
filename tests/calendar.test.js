// The month grid behind the Holidays calendar (no database).
const { buildMonth, isMonth, isDate, monthOf, monthLabel, shiftMonth, weekdayName, longDate } = require('../lib/calendar.js')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }

console.log('reading months and dates')
ok(isMonth('2026-10') && !isMonth('2026-13') && !isMonth('2026-1') && !isMonth('') && !isMonth(undefined), 'a month is YYYY-MM with a real month number')
ok(isDate('2026-10-21') && isDate('2028-02-29') && !isDate('2026-02-29') && !isDate('2026-02-30') && !isDate('2026-10-32') && !isDate('10/21/2026'), 'a date must exist on the calendar (leap years included)')
ok(monthOf('2026-10-21') === '2026-10' && monthLabel('2026-10') === 'October 2026', 'month of a date, and its label')
ok(shiftMonth('2026-12', 1) === '2027-01' && shiftMonth('2026-01', -1) === '2025-12' && shiftMonth('2026-10', 0) === '2026-10', 'stepping months crosses the year')
ok(weekdayName('2026-10-21') === 'Wednesday' && weekdayName('2026-10-25') === 'Sunday' && weekdayName('2026-10-19') === 'Monday', 'weekday names are right (week starts Monday)')
ok(longDate('2026-10-21') === 'Wednesday, 21 October 2026', 'a date reads in full')

console.log('the grid')
const oct = buildMonth('2026-10', { '2026-10-10': { name: 'Pchum Ben', nameKh: '' } }, '2026-10-21')
ok(oct.weeks.every(w => w.length === 7), 'every week has seven days')
ok(oct.weeks.length === 5 && oct.weeks[0][0].date === '2026-09-28' && oct.weeks[0][3].date === '2026-10-01', 'October 2026 starts on a Thursday: 5 weeks, first row begins on Monday 28 September')
ok(oct.weeks[0].slice(0, 3).every(c => !c.inMonth) && oct.weeks[0][3].inMonth, 'days from the neighbouring months are marked as outside the month')
const flat = oct.weeks.flat()
ok(flat.filter(c => c.inMonth).length === 31, 'all 31 days of the month appear once')
ok(flat.filter(c => c.sunday).every(c => weekdayName(c.date) === 'Sunday') && flat.filter(c => c.sunday).length === oct.weeks.length, 'the last column is Sunday')
ok(flat.find(c => c.today).date === '2026-10-21' && flat.filter(c => c.today).length === 1, 'today is marked once')
ok(flat.find(c => c.date === '2026-10-10').holiday.name === 'Pchum Ben' && flat.filter(c => c.holiday).length === 1, 'a holiday lands on its own day only')
ok(buildMonth('2026-09', { '2026-10-01': { name: 'X' } }).weeks.flat().every(c => !c.holiday), 'a holiday in the next month does not show in the spill-over days')
ok(buildMonth('2027-02').weeks.length === 4 && buildMonth('2027-02').weeks[0][0].date === '2027-02-01' && buildMonth('2026-02').weeks.length === 5 && buildMonth('2026-02').weeks[0][0].date === '2026-01-26', 'February 2027 starts on a Monday and fits four weeks; February 2026 starts on a Sunday and needs five')
ok(buildMonth('2028-02').weeks.flat().filter(c => c.inMonth).length === 29, 'February 2028 has 29 days')
ok(buildMonth('2026-11', new Map([['2026-11-09', { name: 'Independence Day' }]])).weeks.flat().find(c => c.date === '2026-11-09').holiday.name === 'Independence Day', 'a Map of holidays works too')
let threw = false; try { buildMonth('2026-13') } catch { threw = true }
ok(threw, 'a bad month is refused')

console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
