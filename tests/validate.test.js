// Checks for values that arrive in an address: dates, months, ids and the longest report range.
const { realDate, realMonth, isUuid, normalizeRange, MAX_RANGE_DAYS } = require('../lib/validate.js')
let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }
const D = { from: '2026-10-01', to: '2026-10-22' }

console.log('dates and months')
ok(realDate('2026-10-22') && realDate('2028-02-29') && realDate('2026-12-31'), 'real dates pass, including a leap day')
ok(!realDate('2026-02-30') && !realDate('2026-13-45') && !realDate('2026-00-10') && !realDate('2027-02-29'), 'impossible dates fail')
ok(!realDate('garbage') && !realDate('') && !realDate(null) && !realDate(undefined) && !realDate(20261022) && !realDate('2026-1-5') && !realDate('2026-10-22T00:00'), 'anything not written YYYY-MM-DD fails')
ok(realMonth('2026-01') && realMonth('2026-12') && !realMonth('2026-13') && !realMonth('2026-00') && !realMonth('garbage') && !realMonth('') && !realMonth(null) && !realMonth('2026-1'), 'months are 01 to 12')

console.log('ids')
ok(isUuid('e100f562-6843-4f44-b9f8-aaf1dcd156a8') && isUuid('E100F562-6843-4F44-B9F8-AAF1DCD156A8'), 'a uuid passes, in either case')
ok(!isUuid('not-a-uuid') && !isUuid('') && !isUuid(null) && !isUuid('zzz') && !isUuid('e100f562-6843-4f44-b9f8-aaf1dcd156a8x') && !isUuid("' or 1=1 --"), 'anything else is not an id')

console.log('report ranges')
let r = normalizeRange('2026-10-01', '2026-10-22', D)
ok(r.from === '2026-10-01' && r.to === '2026-10-22' && r.note === '', 'a normal range is untouched')
r = normalizeRange('garbage', '2026-13-45', D)
ok(r.from === D.from && r.to === D.to && r.note === '', 'invalid dates fall back to the defaults')
r = normalizeRange(undefined, undefined, D)
ok(r.from === D.from && r.to === D.to, 'missing dates fall back to the defaults')
r = normalizeRange('2026-10-30', '2026-10-01', D)
ok(r.from === '2026-10-30' && r.to === '2026-10-01' && r.note === '', 'an end before the start is left alone (it simply has no rows)')
r = normalizeRange('2025-01-01', '2025-12-31', D)
ok(r.to === '2025-12-31' && r.note === '', 'a full year is allowed')
r = normalizeRange('1900-01-01', '2100-01-01', D)
ok(r.from === '1900-01-01' && r.to !== '2100-01-01' && /at most 400 days/.test(r.note), 'a range of centuries is cut short, with a note')
ok(Math.round((new Date(r.to) - new Date(r.from)) / 86400000) + 1 === MAX_RANGE_DAYS, 'and cut to exactly the longest allowed')
r = normalizeRange('2026-01-01', '2027-02-04', D)
ok(r.note === '' && r.to === '2027-02-04', 'exactly 400 days is still allowed')
r = normalizeRange('2026-01-01', '2027-02-05', D)
ok(/at most 400 days/.test(r.note) && r.to === '2027-02-04', 'one day more is cut')

console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
