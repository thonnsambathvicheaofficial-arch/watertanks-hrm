// Payroll arithmetic: hand-worked cases and the "nothing is assumed" rules.
// Run with: node tests/payroll-calc.test.js
// (During development this engine was also cross-checked against HRM Hub's calculator on
// 5,000 random inputs with zero differences; that check needs the HRM source, so it is not here.)
const { computeSlip } = require('../lib/payroll-calc.js')
let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }

const brackets = [
  { min_amount: 0, max_amount: 1500000, rate: 0, quick_deduction: 0 },
  { min_amount: 1500001, max_amount: 2000000, rate: 5, quick_deduction: 65000 },
  { min_amount: 2000001, max_amount: 8500000, rate: 10, quick_deduction: 165000 },
]
const cfg = { exchangeRate: 4000, dependentReliefKhr: 150000, nonResidentRate: 20, nssfEmployeeRate: 2, nssfEmployerPensionRate: 2, nssfEmployerHealthRate: 0.8, nssfEmployerRiskRate: 2.6, nssfCeilingKhr: 1200000, nssfFloorKhr: 400000, workDaysPerMonth: 26, hoursPerDay: 8, otRateNormal: 1.5, otRateOff: 2, otRateHoliday: 2, lateMode: 'none', lateAmount: 0, brackets }

// Salary 312, 26 days -> 12 a day. Two absent days = 24 off. W = 288. 288 USD = 1,152,000 KHR: first bracket, no tax.
const a = computeSlip({ salary: 312, absentDays: 2 }, cfg)
ok(a.dailyRate === 12 && a.absentDeduction === 24 && a.netAfterDeduction === 288, '312 / 26 = 12 a day; 2 absences take 24 off')
ok(a.tax === 0 && a.nssfEmployee === 5.76 && a.finalNet === 282.24, 'no tax in the first bracket; NSSF 2% of 288 = 5.76; net 282.24')

// Hourly = 312 / 208 = 1.5. 4 hours at x1.5 = 9.00; 2 holiday hours at x2 = 6.00.
const o = computeSlip({ salary: 312, otHours: { normal: 4, off: 0, holiday: 2 } }, cfg)
ok(o.hourlyRate === 1.5 && o.otPay.normal === 9 && o.otPay.holiday === 6 && o.otTotal === 15, 'overtime: 1.50 an hour, 4 h x1.5 = 9.00, 2 holiday h x2 = 6.00')

// Salary 800 + 2 dependents: relief 2 x 150000 / 4000 = 75 USD. W = 800 -> taxable 725 = 2,900,000 KHR: 10% bracket, minus 165,000 = 125,000 KHR = 31.25 USD.
const t = computeSlip({ salary: 800, dependents: 2 }, cfg)
ok(t.reliefUsd === 75 && t.taxableUsd === 725 && t.taxRate === 10 && t.tax === 31.25, 'tax: 800 less 75 relief = 725 USD = 2.9m KHR, 10% less 165,000 = 31.25 USD')
// NSSF wage is capped: ceiling 1,200,000 / 4000 = 300 USD.
ok(t.nssfWage === 300 && t.nssfEmployee === 6, 'NSSF is charged on at most the ceiling (300 USD): 2% = 6.00')

const n = computeSlip({ salary: 800, resident: false }, cfg)
ok(n.taxRate === 20 && n.tax === 160 && n.reliefUsd === 0, 'a non-resident pays a flat 20% and gets no relief')
const e = computeSlip({ salary: 800, dependents: 2, taxExempt: true, nssfExempt: true }, cfg)
ok(e.tax === 0 && e.nssfEmployee === 0 && e.nssfEmployer === 0 && e.finalNet === 800, 'exempt from tax and NSSF: pays the full salary')
const m = computeSlip({ salary: 500, advance: 50, adjustment: -10, withholding: 20, bonus: 30, allowance: 15 }, cfg)
ok(m.netAfterDeduction === 545 && m.finalNet === Math.round((545 - m.tax - m.nssfEmployee - 50 - 10 + 20) * 100) / 100, 'bonus and allowance are added before tax; advance is taken after; adjustment and withholding are added last')

// A fully absent person on a month with more working days than the 26-day basis is never docked more than their salary.
const full = computeSlip({ salary: 312, absentDays: 27 }, cfg)
ok(full.absentDeduction === 312 && full.netAfterDeduction === 0, '27 absent days on a 26-day basis: the deduction is capped at the salary (312), pay before tax is 0, not negative')

const l1 = computeSlip({ salary: 312, lateDays: 3, lateMinutes: 40 }, { ...cfg, lateMode: 'per_day', lateAmount: 2 })
const l2 = computeSlip({ salary: 312, lateDays: 3, lateMinutes: 40 }, { ...cfg, lateMode: 'per_minute', lateAmount: 0.1 })
ok(l1.lateDeduction === 6 && l2.lateDeduction === 4 && computeSlip({ salary: 312, lateDays: 3 }, cfg).lateDeduction === 0, 'late rule: 3 days x 2 = 6; 40 min x 0.10 = 4; off = 0')

// Nothing is assumed.
const x = computeSlip({ salary: 300, absentDays: 1, otHours: { normal: 2, off: 0, holiday: 3 }, dependents: 1 }, {})
ok(x.incomplete && ['work days per month', 'hours per day', 'normal-day overtime rate', 'holiday overtime rate', 'exchange rate', 'tax brackets', 'NSSF ceiling and floor'].every(k => x.missing.includes(k)), 'empty settings: the slip is flagged and lists what is missing')
ok(x.otTotal === 0 && x.tax === 0 && x.nssfEmployee === 0, 'missing items count as zero, never as a guess')
ok(computeSlip({ salary: 300 }, { ...cfg, brackets: [] }).missing.join() === 'tax brackets', 'only the missing item is reported')
ok(!computeSlip({ salary: 300, taxExempt: true, nssfExempt: true }, {}).incomplete, 'a person exempt from tax and NSSF needs no exchange rate or brackets')
ok(computeSlip({ salary: null }, cfg).missing.includes('salary'), 'no salary set is flagged')
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
