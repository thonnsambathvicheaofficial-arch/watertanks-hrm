// Payroll calculation for ONE person and ONE month. Pure: no database, no clock.
//
// Chain (USD unless stated; tax brackets, relief and the NSSF ceiling/floor are KHR):
//   dailyRate     = salary / workDaysPerMonth
//   hourlyRate    = salary / (workDaysPerMonth x hoursPerDay)
//   overtime pay  = hourlyRate x sum(hours in a tier x that tier's multiplier)
//   deductions    = (absent days + unpaid-leave days) x dailyRate + late rule
//   additions     = bonus + allowances (company + this month's register)
//   net-after-ded = salary + overtime - deductions + additions            (W)
//   tax           = progressive brackets on (W - relief) in KHR, or flat for non-residents
//   NSSF          = rate x clamp(W, floor, ceiling)  (employee 1 rate, employer 3 rates)
//   payment due   = W - tax - NSSF(employee) - advance
//   final net     = payment due + adjustment + withholding
//
// This is the same chain HRM Hub uses (cross-checked by test), except that NOTHING is
// assumed: every rate, the exchange rate, the brackets and the work-day/hour basis come from
// settings, and anything a slip needs that is not set is listed in `missing` so the slip is
// flagged incomplete and cannot be finalized. Missing items count as zero in the figures
// shown; they are never guessed.

const r2 = n => Math.round(n * 100) / 100
const num = v => (v === null || v === undefined || v === '' ? null : Number(v))

// Progressive tax on salary in KHR: the bracket the amount falls in, rate x amount - quick deduction.
function progressiveTaxKHR(taxableKHR, brackets) {
  if (!(taxableKHR > 0) || !brackets || !brackets.length) return { rate: 0, taxKHR: 0 }
  const sorted = [...brackets].sort((a, b) => a.min_amount - b.min_amount)
  let chosen = null
  for (const b of sorted) {
    const max = b.max_amount == null ? Infinity : b.max_amount
    if (taxableKHR >= b.min_amount && taxableKHR <= max) { chosen = b; break }
  }
  if (!chosen) chosen = sorted[sorted.length - 1]
  return { rate: chosen.rate, taxKHR: Math.max(0, taxableKHR * (chosen.rate / 100) - chosen.quick_deduction) }
}

/**
 * input: {
 *   salary, dependents, resident (default true), taxExempt, nssfExempt,
 *   absentDays, unpaidLeaveDays, lateDays, lateMinutes,
 *   otHours: { normal, off, holiday },
 *   bonus, allowance, advance, adjustment, withholding
 * }
 * cfg: settings row in camelCase { exchangeRate, dependentReliefKhr, nonResidentRate, nssfEmployeeRate,
 *   nssfEmployerPensionRate, nssfEmployerHealthRate, nssfEmployerRiskRate, nssfCeilingKhr, nssfFloorKhr,
 *   workDaysPerMonth, hoursPerDay, otRateNormal, otRateOff, otRateHoliday, lateMode, lateAmount, brackets[] }
 */
function computeSlip(input, cfg) {
  const missing = []
  const need = (cond, what) => { if (!cond) missing.push(what) }

  const salary = num(input.salary) || 0
  const ot = { normal: input.otHours?.normal || 0, off: input.otHours?.off || 0, holiday: input.otHours?.holiday || 0 }
  const resident = input.resident !== false
  const taxExempt = input.taxExempt === true
  const nssfExempt = input.nssfExempt === true
  const dependents = input.dependents || 0

  const workDays = num(cfg.workDaysPerMonth), hoursPerDay = num(cfg.hoursPerDay)
  const absent = (input.absentDays || 0) + (input.unpaidLeaveDays || 0)

  need(num(input.salary) !== null && salary > 0, 'salary')
  if (absent > 0) need(workDays > 0, 'work days per month')
  const hasOt = ot.normal > 0 || ot.off > 0 || ot.holiday > 0
  if (hasOt) { need(workDays > 0, 'work days per month'); need(hoursPerDay > 0, 'hours per day') }

  const dailyRate = workDays > 0 ? salary / workDays : 0
  const hourlyRate = workDays > 0 && hoursPerDay > 0 ? salary / (workDays * hoursPerDay) : 0

  const rate = { normal: num(cfg.otRateNormal), off: num(cfg.otRateOff), holiday: num(cfg.otRateHoliday) }
  const label = { normal: 'normal-day overtime rate', off: 'day-off overtime rate', holiday: 'holiday overtime rate' }
  for (const t of ['normal', 'off', 'holiday']) if (ot[t] > 0) need(rate[t] !== null, label[t])
  const otPay = { normal: r2(hourlyRate * ot.normal * (rate.normal || 0)), off: r2(hourlyRate * ot.off * (rate.off || 0)), holiday: r2(hourlyRate * ot.holiday * (rate.holiday || 0)) }
  const otTotal = r2(otPay.normal + otPay.off + otPay.holiday)

  const gross = r2(salary + otTotal)

  // Absences can never take more than the salary: a month with 27 working days on a 26-day basis would
  // otherwise dock a fully absent person 27/26 of what they earn.
  const absentDeduction = r2(Math.min(salary, absent * dailyRate))
  let lateDeduction = 0
  if (cfg.lateMode === 'per_day') lateDeduction = r2((input.lateDays || 0) * (num(cfg.lateAmount) || 0))
  else if (cfg.lateMode === 'per_minute') lateDeduction = r2((input.lateMinutes || 0) * (num(cfg.lateAmount) || 0))
  const deductions = r2(absentDeduction + lateDeduction)

  const bonus = input.bonus || 0, allowance = input.allowance || 0
  const w = r2(gross - deductions + bonus + allowance)    // net after deduction: the base for tax and NSSF

  const fx = num(cfg.exchangeRate)
  const fxOk = fx > 0
  const needsKhr = !(taxExempt && nssfExempt)
  if (needsKhr) need(fxOk, 'exchange rate')

  // Tax
  let reliefUsd = 0, taxableUsd = w, taxRate = 0, tax = 0
  if (!taxExempt) {
    if (resident) {
      if (dependents > 0) { need(num(cfg.dependentReliefKhr) !== null, 'dependent relief'); reliefUsd = fxOk ? r2(((num(cfg.dependentReliefKhr) || 0) / fx) * dependents) : 0 }
      taxableUsd = Math.max(0, r2(w - reliefUsd))
      need(cfg.brackets && cfg.brackets.length > 0, 'tax brackets')
      if (fxOk && cfg.brackets && cfg.brackets.length) {
        const t = progressiveTaxKHR(taxableUsd * fx, cfg.brackets)
        taxRate = t.rate; tax = r2(t.taxKHR / fx)
      }
    } else {
      need(num(cfg.nonResidentRate) !== null, 'non-resident tax rate')
      taxRate = num(cfg.nonResidentRate) || 0; taxableUsd = w; tax = r2(w * (taxRate / 100))
    }
  }

  // NSSF
  let nssfWage = 0, nssfEmployee = 0, ePension = 0, eHealth = 0, eRisk = 0
  if (!nssfExempt) {
    need(num(cfg.nssfCeilingKhr) !== null && num(cfg.nssfFloorKhr) !== null, 'NSSF ceiling and floor')
    for (const [k, what] of [['nssfEmployeeRate', 'NSSF employee rate'], ['nssfEmployerPensionRate', 'NSSF employer pension rate'], ['nssfEmployerHealthRate', 'NSSF employer health rate'], ['nssfEmployerRiskRate', 'NSSF employer risk rate']]) need(num(cfg[k]) !== null, what)
    if (fxOk && num(cfg.nssfCeilingKhr) !== null && num(cfg.nssfFloorKhr) !== null) {
      const floor = num(cfg.nssfFloorKhr) / fx, ceil = num(cfg.nssfCeilingKhr) / fx
      nssfWage = Math.min(Math.max(w, floor), ceil)
    }
    nssfEmployee = r2(nssfWage * ((num(cfg.nssfEmployeeRate) || 0) / 100))
    ePension = r2(nssfWage * ((num(cfg.nssfEmployerPensionRate) || 0) / 100))
    eHealth = r2(nssfWage * ((num(cfg.nssfEmployerHealthRate) || 0) / 100))
    eRisk = r2(nssfWage * ((num(cfg.nssfEmployerRiskRate) || 0) / 100))
  }
  const nssfEmployer = r2(ePension + eHealth + eRisk)

  const netAfterTax = r2(w - tax)
  const advance = input.advance || 0
  const paymentDue = r2(netAfterTax - nssfEmployee - advance)
  const finalNet = r2(paymentDue + (input.adjustment || 0) + (input.withholding || 0))

  return {
    missing: [...new Set(missing)],
    incomplete: missing.length > 0,
    salary, dailyRate: r2(dailyRate), hourlyRate: Math.round(hourlyRate * 10000) / 10000,
    otHours: ot, otPay, otTotal, gross,
    absentDays: input.absentDays || 0, unpaidLeaveDays: input.unpaidLeaveDays || 0, absentDeduction,
    lateDays: input.lateDays || 0, lateMinutes: input.lateMinutes || 0, lateDeduction, deductions,
    bonus, allowance, netAfterDeduction: w,
    reliefUsd, taxableUsd, taxRate, tax, taxExempt, resident,
    nssfWage: r2(nssfWage), nssfEmployee, nssfEmployerPension: ePension, nssfEmployerHealth: eHealth, nssfEmployerRisk: eRisk, nssfEmployer, nssfExempt,
    netAfterTax, advance, paymentDue, adjustment: input.adjustment || 0, withholding: input.withholding || 0, finalNet,
  }
}

module.exports = { computeSlip, progressiveTaxKHR, r2 }
