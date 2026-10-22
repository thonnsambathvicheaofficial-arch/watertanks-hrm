// Carrying a filtered list's address to the page opened from it, and keeping filters across a save.
const { safeReturn, withReturn, keepFilters } = require('../lib/return-to.ts')
let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }
const H = 'hr.example.com'

console.log('which return addresses are accepted')
ok(safeReturn('/roster?month=2026-10&group=worker&department=d1') === '/roster?month=2026-10&group=worker&department=d1', 'a same-site path with filters passes')
ok(['', null, undefined, 5, 'roster', 'https://evil.example/x', '//evil.example/x', '/\\evil','/a\nb', '/' + 'x'.repeat(700)].every(v => safeReturn(v) === ''), 'anything else is dropped: other sites, protocol-relative, backslashes, line breaks, huge values')
ok(withReturn('/roster/day?pin=1', '/roster?month=2026-10&group=worker') === '/roster/day?pin=1&return=%2Froster%3Fmonth%3D2026-10%26group%3Dworker', 'the list address is attached, encoded')
ok(withReturn('/staff/10', '/staff?q=an') === '/staff/10?return=%2Fstaff%3Fq%3Dan' && withReturn('/staff/10', '') === '/staff/10' && withReturn('/staff/10', 'https://x.y') === '/staff/10', 'it starts a query when there is none, and adds nothing for an empty or unsafe address')

console.log('a save keeps the filters of the page it came from')
ok(keepFilters('/leave', `https://${H}/leave?status=pending&year=2026&department=d1&saved=Done`, H) === '/leave?status=pending&year=2026&department=d1', 'back to the same page: filters kept, the old "saved" message dropped')
ok(keepFilters('/leave', `https://${H}/leave?error=x&v=abc`, H) === '/leave', 'only a message in the address: nothing to keep')
ok(keepFilters('/rotation', `https://${H}/leave?status=pending`, H) === '/rotation', 'a different page: unchanged')
ok(keepFilters('/payroll/items?year=2026&month=10', `https://${H}/payroll/items?year=2026&month=9`, H) === '/payroll/items?year=2026&month=10', 'a target with its own query is never altered')
ok(keepFilters('/leave', 'https://other.example/leave?status=pending', H) === '/leave', 'a form sent from another site keeps nothing')
ok(keepFilters('/leave', null, H) === '/leave' && keepFilters('/leave', 'not a url', H) === '/leave', 'no referer, or one that is not an address: unchanged')
ok(keepFilters('/staff/%E1%9E%80', `https://${H}/staff/%E1%9E%80?return=%2Fstaff%3Fq%3Dan&saved=1`, H) === '/staff/%E1%9E%80?return=%2Fstaff%3Fq%3Dan', 'a detail page keeps the address of the list it was opened from')

console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
