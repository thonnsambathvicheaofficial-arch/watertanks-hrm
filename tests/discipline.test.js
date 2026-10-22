// The discipline register's rules (no database).
const D = require('../lib/discipline.js')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }
const base = { pin: '215', occurredOn: '2026-10-14', kind: 'verbal', reason: 'Late three times this week', deduction: '', payrollMonth: '' }

console.log('the ladder')
ok(D.KIND_KEYS.join() === 'guidance,verbal,written1,written2,final', 'guidance, verbal, first written, second written, final warning, in that order')
ok(D.KIND_KEYS.every((k, i) => D.KINDS[k].rank === i && D.KINDS[k].kh && D.KINDS[k].label), 'each step has a rank, an English name and a Khmer name')
ok(D.kindBoth('final') === 'Final warning / លិខិតព្រមានចុងក្រោយ' && D.kindLabel('nope') === 'nope', 'a step reads in both languages for the register')

console.log('checking a record')
let r = D.check(base, '2026-10-21')
ok(r.value && r.value.deduction === null && r.value.payrollYear === null, 'a warning with no deduction needs no payroll month')
ok(D.check({ ...base, pin: ' ' }, '2026-10-21').error === 'Choose a staff member.', 'a person is required')
ok(/date it happened/.test(D.check({ ...base, occurredOn: '2026-02-30' }, '2026-10-21').error) && /date it happened/.test(D.check({ ...base, occurredOn: '' }, '2026-10-21').error), 'the date must be a real date')
ok(/future/.test(D.check({ ...base, occurredOn: '2026-10-22' }, '2026-10-21').error) && !D.check({ ...base, occurredOn: '2026-10-21' }, '2026-10-21').error, 'it cannot have happened tomorrow, but today is fine')
ok(/guidance or the kind/.test(D.check({ ...base, kind: 'fired' }, '2026-10-21').error), 'the step must be on the ladder')
ok(/reason/.test(D.check({ ...base, reason: '  ' }, '2026-10-21').error) && /too long/.test(D.check({ ...base, reason: 'x'.repeat(2001) }, '2026-10-21').error), 'a reason is required and bounded')
ok(D.check({ ...base, reason: 'មកយឺតបីដង' }, '2026-10-21').value.reason === 'មកយឺតបីដង', 'Khmer text passes through untouched')

console.log('the salary deduction')
r = D.check({ ...base, deduction: '5' }, '2026-10-21')
ok(r.value.deduction === 5 && r.value.payrollYear === 2026 && r.value.payrollMonth === 10, 'a deduction defaults to the payroll month of the day it happened')
r = D.check({ ...base, deduction: '25.50', payrollMonth: '2026-11' }, '2026-10-21')
ok(r.value && r.value.deduction === 25.5 && r.value.payrollMonth === 11, 'it can come out of a chosen month, and amounts round to cents')
ok(D.check({ ...base, deduction: '1.005' }, '2026-10-21').value.deduction === 1.01 || D.check({ ...base, deduction: '1.005' }, '2026-10-21').value.deduction === 1, 'amounts are kept to two decimals')
ok(/above zero/.test(D.check({ ...base, deduction: '0' }, '2026-10-21').error) && /above zero/.test(D.check({ ...base, deduction: '-3' }, '2026-10-21').error) && /above zero/.test(D.check({ ...base, deduction: 'abc' }, '2026-10-21').error), 'zero, negative and non-numbers are refused')
ok(/too large/.test(D.check({ ...base, deduction: '10001' }, '2026-10-21').error), 'an absurd amount is caught as a typo')
ok(/payroll month/.test(D.check({ ...base, deduction: '5', payrollMonth: '2026-13' }, '2026-10-21').error), 'a bad payroll month is refused')

console.log('where someone is on the ladder')
const rec = (kind, status = 'confirmed') => ({ kind, status })
ok(JSON.stringify(D.ladder([])) === JSON.stringify({ warnings: 0, top: null, next: 'verbal' }), 'no warnings: the next step is a verbal warning')
ok(D.ladder([rec('verbal')]).next === 'written1' && D.ladder([rec('verbal'), rec('written1')]).next === 'written2', 'each step leads to the next')
ok(D.ladder([rec('written2')]).next === 'final' && D.ladder([rec('final')]).next === null, 'after a final warning there is no next step on the ladder')
ok(D.ladder([rec('verbal', 'draft'), rec('written1', 'withdrawn')]).warnings === 0, 'drafts and withdrawn records do not count')
ok(D.ladder([rec('guidance')]).warnings === 0 && D.ladder([rec('guidance')]).next === 'verbal', 'guidance is not a warning')

console.log('the register in the factory layout')
ok(D.REGISTER_HEADER.slice(0, 9).join('|') === 'No|Staff ID|Name|Position|Department|Amount of salary deduction|Occurrence date|ការណែនាំ/ការព្រមាន|Reason', 'the columns and their order match the factory sheet')
const rows = D.registerRows([{ pin: '1', occurredOn: '2026-10-01', kind: 'verbal', reason: 'Late', deduction: 5, status: 'confirmed' }, { pin: '2', occurredOn: '2026-10-02', kind: 'final', reason: 'ឈប់មិនប្រាប់', deduction: null, status: 'draft' }], { 1: { staffCode: 'SF0001', name: 'Ann', position: 'Driver', departmentName: 'Delivery' } })
ok(rows[0].join('|') === '1|SF0001|Ann|Driver|Delivery|5|2026-10-01|Verbal warning / ការព្រមានដោយផ្ទាល់មាត់|Late|Confirmed', 'a row carries the person, the deduction, the step in both languages and the status')
ok(rows[1][0] === 2 && rows[1][2] === '2' && rows[1][5] === '', 'numbered in order; an unknown person shows the PIN and no deduction is blank')

console.log('the warning letter')
const L = D.letterModel({ kind: 'written1', occurredOn: '2026-10-14', reason: 'x', deduction: 5, payrollYear: 2026, payrollMonth: 10 }, { name: 'Ann' })
ok(L.titleEn === 'First written warning' && L.titleKh === 'លិខិតព្រមានលើកទី១', 'the title follows the step, in both languages')
ok(/given a first written warning on 2026-10-14/.test(L.bodyEn) && /ត្រូវបានទទួលលិខិតព្រមានលើកទី១/.test(L.bodyKh), 'the body names the step and the date')
ok(L.deductionEn === 'Salary deduction: USD 5.00, taken from the 2026-10 payroll.' && /5\.00/.test(L.deductionKh), 'a deduction is stated with its amount and payroll month')
ok(D.letterModel({ kind: 'guidance', occurredOn: '2026-10-14', reason: 'x' }, {}).deductionEn === '' && /given guidance on/.test(D.letterModel({ kind: 'guidance', occurredOn: '2026-10-14', reason: 'x' }, {}).bodyEn), 'guidance reads as guidance and says nothing about a deduction when there is none')

console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
