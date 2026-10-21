// The Group / Department filter rule shared by Live, Reports, Roster, Staff, Leave and Rotation.
const { NO_DEPARTMENT, matchesDepartment, matchesGroup } = require('../lib/staff-filter.js')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }

console.log('department filter')
ok(matchesDepartment('', 'd1') && matchesDepartment('', '') && matchesDepartment('', null), 'no filter lets everyone through, assigned or not')
ok(matchesDepartment('d1', 'd1') && !matchesDepartment('d1', 'd2'), 'a department id keeps only that department')
ok(!matchesDepartment('d1', '') && !matchesDepartment('d1', null) && !matchesDepartment('d1', undefined), 'staff with no department are not inside any named department')
ok(NO_DEPARTMENT === 'none' && matchesDepartment('none', '') && matchesDepartment('none', null) && !matchesDepartment('none', 'd1'), '"none" picks exactly the staff with no department, so nobody falls out of every filter unseen')

console.log('group filter')
ok(matchesGroup('', 'office') && matchesGroup('', null), 'no filter lets everyone through')
ok(matchesGroup('office', 'office') && !matchesGroup('office', 'worker') && !matchesGroup('office', null), 'office keeps only office staff')
ok(matchesGroup('worker', 'worker') && !matchesGroup('worker', 'office'), 'worker keeps only workers')

console.log('both together')
const staff = [{ g: 'office', d: 'a' }, { g: 'worker', d: 'a' }, { g: 'worker', d: 'b' }, { g: 'worker', d: '' }]
const pick = (g, d) => staff.filter(s => matchesGroup(g, s.g) && matchesDepartment(d, s.d)).length
ok(pick('', '') === 4 && pick('worker', '') === 3 && pick('', 'a') === 2 && pick('worker', 'a') === 1 && pick('office', 'b') === 0 && pick('worker', 'none') === 1, 'a person must match every filter given (group AND department)')

console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
