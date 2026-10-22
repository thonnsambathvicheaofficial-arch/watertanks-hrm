// The discipline register's rules (no database).
const D = require('../lib/discipline.js')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }
const base = { pin: '215', occurredOn: '2026-10-14', kind: 'verbal', reason: 'Late three times', deduction: '', payrollMonth: '' }

console.log('the steps')
ok(D.KIND_KEYS.join() === 'verbal_guidance,lead_guidance,guidance_letter,verbal,written1,written2,warning_letter,final,noted', "the factory's own steps, then verbal, first written, second written, warning letter, final, and a note")
ok(D.KIND_KEYS.every(k => D.KINDS[k] && D.KINDS[k].label && D.KINDS[k].kh && D.KINDS[k].phrase && D.KINDS[k].letterTitle && D.KINDS[k].letterTitleKh), 'each step has an English name, a Khmer name and its letter wording')
ok(D.kindBoth('final') === 'Final warning / លិខិតព្រមានចុងក្រោយ' && D.kindLabel('nope') === 'nope', 'a step reads in both languages for the register')
ok(['verbal_guidance', 'lead_guidance', 'guidance_letter', 'noted'].every(k => !D.KINDS[k].warning) && ['verbal', 'written1', 'written2', 'warning_letter', 'final'].every(k => D.KINDS[k].warning), 'guidance and notes are not warnings; the others are')

console.log('checking a record')
let r = D.check(base, '2026-10-21')
ok(r.value && r.value.deduction === null && r.value.payrollYear === null, 'a record with no deduction needs no payroll month')
ok(D.check({ ...base, pin: ' ' }, '2026-10-21').error === 'Choose a staff member.', 'a person is required')
ok(/date it happened/.test(D.check({ ...base, occurredOn: '2026-02-30' }, '2026-10-21').error) && /date it happened/.test(D.check({ ...base, occurredOn: '' }, '2026-10-21').error), 'the date must be a real date')
ok(/future/.test(D.check({ ...base, occurredOn: '2026-10-22' }, '2026-10-21').error) && !D.check({ ...base, occurredOn: '2026-10-21' }, '2026-10-21').error, 'it cannot have happened tomorrow, but today is fine')
ok(/kind of guidance/.test(D.check({ ...base, kind: 'fired' }, '2026-10-21').error) && D.check({ ...base, kind: 'lead_guidance' }, '2026-10-21').value, 'the step must be one on the list')
ok(/reason/.test(D.check({ ...base, reason: '  ' }, '2026-10-21').error) && /too long/.test(D.check({ ...base, reason: 'x'.repeat(2001) }, '2026-10-21').error), 'a reason is required and bounded')
ok(D.check({ ...base, reason: 'មកយឺតបីដង' }, '2026-10-21').value.reason === 'មកយឺតបីដង', 'Khmer text passes through untouched')

console.log('the salary deduction')
r = D.check({ ...base, deduction: '5' }, '2026-10-21')
ok(r.value.deduction === 5 && r.value.payrollYear === 2026 && r.value.payrollMonth === 10, 'a deduction defaults to the payroll month of the day it happened')
r = D.check({ ...base, deduction: '25.50', payrollMonth: '2026-11' }, '2026-10-21')
ok(r.value && r.value.deduction === 25.5 && r.value.payrollMonth === 11, 'it can come out of a chosen month')
ok(/above zero/.test(D.check({ ...base, deduction: '0' }, '2026-10-21').error) && /above zero/.test(D.check({ ...base, deduction: '-3' }, '2026-10-21').error) && /above zero/.test(D.check({ ...base, deduction: 'abc' }, '2026-10-21').error), 'zero, negative and non-numbers are refused')
ok(/too large/.test(D.check({ ...base, deduction: '10001' }, '2026-10-21').error), 'an absurd amount is caught as a typo')
ok(/payroll month/.test(D.check({ ...base, deduction: '5', payrollMonth: '2026-13' }, '2026-10-21').error), 'a bad payroll month is refused')

console.log('where someone is on the escalation ladder')
const rec = (kind, status = 'confirmed') => ({ kind, status })
ok(JSON.stringify(D.ladder([])) === JSON.stringify({ warnings: 0, top: null, next: 'verbal' }), 'no warnings: the next step is a verbal warning')
ok(D.ladder([rec('verbal')]).next === 'written1' && D.ladder([rec('verbal'), rec('written1')]).next === 'written2' && D.ladder([rec('written2')]).next === 'final', 'each step leads to the next')
ok(D.ladder([rec('final')]).next === null && D.ladder([rec('warning_letter')]).next === 'written2', 'after a final warning there is no next step; the factory warning letter counts like a first written warning')
ok(D.ladder([rec('verbal', 'draft'), rec('written1', 'withdrawn')]).warnings === 0, 'drafts and withdrawn records do not count')
ok(D.ladder([rec('verbal_guidance'), rec('lead_guidance'), rec('guidance_letter'), rec('noted')]).warnings === 0 && D.ladder([rec('verbal_guidance')]).next === 'verbal', 'guidance and notes are not warnings')

console.log('who a record is about')
const people = { 215: { staffCode: 'SF0215', name: 'Ann', nameKh: '', position: 'Driver', departmentName: 'Delivery' } }
ok(D.who({ pin: '215', staffName: 'Old name' }, people).name === 'Ann' && D.who({ pin: '215' }, people).inStaffList, 'a person in the staff list is shown from the live staff record')
const gone = D.who({ pin: null, staffCode: 'SF0149', staffName: 'ឈិន បារាំង', position: 'Trailer driver', department: 'ដឹកជញ្ជូន' }, people)
ok(gone.name === 'ឈិន បារាំង' && gone.staffCode === 'SF0149' && gone.position === 'Trailer driver' && gone.departmentName === 'ដឹកជញ្ជូន' && !gone.inStaffList, 'someone who left is shown from what is written on the record')

console.log('the register in the factory layout')
ok(D.REGISTER_HEADER.slice(0, 9).join('|') === 'No|Staff ID|Name|Position|Department|Amount of salary deduction|Occurrence date|ការណែនាំ/ការព្រមាន|Reason', 'the columns and their order match the factory sheet')
const rows = D.registerRows([{ pin: '215', occurredOn: '2026-10-01', kind: 'verbal', reason: 'Late', deduction: 5, status: 'confirmed' }, { pin: null, staffCode: 'SF0149', staffName: 'Bo', position: 'P', department: 'D', occurredOn: '2026-10-02', kind: 'noted', reason: 'ឈប់មិនប្រាប់', deduction: null, status: 'confirmed' }], people)
ok(rows[0].join('|') === '1|SF0215|Ann|Driver|Delivery|5|2026-10-01|Verbal warning / ការព្រមានដោយផ្ទាល់មាត់|Late|Confirmed', 'a row carries the person, the deduction, the step in both languages and the status')
ok(rows[1][0] === 2 && rows[1][1] === 'SF0149' && rows[1][2] === 'Bo' && rows[1][5] === '' && /កំណត់ហេតុ/.test(rows[1][7]), 'numbered in order; a person who left shows from the record; no deduction is blank')

console.log("reading the factory's Excel register")
ok(D.kindFromText('ណែនាំផ្ទាល់មាត់') === 'verbal_guidance' && D.kindFromText(' ប្រធានក្រុមណែនាំផ្ទាល់មាត់ ') === 'lead_guidance' && D.kindFromText('លិខិតណែនាំ') === 'guidance_letter' && D.kindFromText('លិខិតព្រមាន') === 'warning_letter', "the four Khmer words the factory uses map to their steps")
ok(D.kindFromText('N/A') === 'noted' && D.kindFromText('n/a') === 'noted' && D.kindFromText('') === null && D.kindFromText('something else') === null, 'N/A is a note; blank and unknown words are not guessed')
ok(D.kindFromText('Verbal warning') === 'verbal' && D.kindFromText('Final warning / លិខិតព្រមានចុងក្រោយ') === 'final', 'English names, and the exported "English / Khmer" form, read back in')
ok(D.kindFromText('ណែនាំ​ផ្ទាល់មាត់') === 'verbal_guidance' && D.kindFromText('ណែនាំ ផ្ទាល់មាត់'.replace(' ', '')) === 'verbal_guidance', 'invisible zero-width characters from Excel do not break a match')
ok(D.readAmount(' $5.00 ').amount === 5 && D.readAmount('5').amount === 5 && D.readAmount('$1,359.00').amount === 1359, 'dollar amounts read with the sign, spaces and commas')
ok(D.readAmount(' $-   ').amount === null && D.readAmount('').amount === null && D.readAmount('-').amount === null && D.readAmount('0').amount === null, 'a dash, blank or zero means no deduction')
ok(D.readAmount(' paid ').amount === null && /paid/.test(D.readAmount(' paid ').note), 'the word "paid" is not a deduction, and says so')
ok(/not a number/.test(D.readAmount('five').error) && /negative/.test(D.readAmount('-5').error) && /too large/.test(D.readAmount('99999').error), 'a word, a negative and an absurd amount are refused')
const k1 = D.importKey('SF0037', '2025-05-01', 'verbal_guidance', 'ប្រេះកញ្ចក់ឡាន')
ok(k1 === D.importKey(' sf0037 ', '2025-05-01', 'verbal_guidance', 'ប្រេះកញ្ចក់ឡាន ') && k1 !== D.importKey('SF0037', '2025-05-02', 'verbal_guidance', 'ប្រេះកញ្ចក់ឡាន') && k1 !== D.importKey('SF0037', '2025-05-01', 'guidance_letter', 'ប្រេះកញ្ចក់ឡាន') && k1 !== D.importKey('SF0159', '2025-05-01', 'verbal_guidance', 'ប្រេះកញ្ចក់ឡាន'), 'a row has a stable fingerprint that changes with the person, date, step or reason')

console.log('the warning letter')
const L = D.letterModel({ kind: 'written1', occurredOn: '2026-10-14', reason: 'x', deduction: 5, payrollYear: 2026, payrollMonth: 10 }, { name: 'Ann' })
ok(L.titleEn === 'First written warning' && L.titleKh === 'លិខិតព្រមានលើកទី១', 'the title follows the step, in both languages')
ok(/given a first written warning on 2026-10-14/.test(L.bodyEn) && /ត្រូវបានទទួលលិខិតព្រមានលើកទី១/.test(L.bodyKh), 'the body names the step and the date')
ok(L.deductionEn === 'Salary deduction: USD 5.00, taken from the 2026-10 payroll.' && /5\.00/.test(L.deductionKh), 'a deduction is stated with its amount and payroll month')
const G = D.letterModel({ kind: 'verbal_guidance', occurredOn: '2026-10-14', reason: 'x' }, {})
ok(/given verbal guidance on/.test(G.bodyEn) && G.deductionEn === '', 'guidance reads as guidance and says nothing about a deduction when there is none')

console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
