// Excel exports for a payroll run: register, bank list, cash list, NSSF report.
const payroll = require('./payroll-store')
const { toXlsx } = require('./excel')
const { glabel } = require('./exports')

const pad = n => String(n).padStart(2, '0')
const money = n => (n === 0 ? 0 : Number(n.toFixed(2)))
const sum = (rows, f) => Math.round(rows.reduce((a, r) => a + f(r), 0) * 100) / 100

async function buildPayrollExport(kind, year, month) {
  if (!(await payroll.ready())) throw new Error('Payroll is not set up yet. Run migrations/003_payroll.sql in the Supabase SQL editor.')
  const run = await payroll.runs.get(year, month)
  if (!run) throw new Error('There is no payroll for that month.')
  const label = run.status === 'finalized' ? 'Final' : 'DRAFT'
  const stamp = `${year}-${pad(month)}`
  const s = run.slips
  let sheet, name

  if (kind === 'register') {
    name = `Payroll_${stamp}_${label}.xlsx`
    const rows = s.map((x, i) => {
      const c = x.calc
      return [i + 1, x.pin, x.name, glabel(c.group), c.salary, c.otTotal, c.gross, c.absentDays, c.unpaidLeaveDays, c.deductions, c.bonus, c.allowance, c.netAfterDeduction, c.tax, c.nssfEmployee, c.advance, c.adjustment, c.withholding, x.net, x.paymentMethod || '', c.incomplete ? 'INCOMPLETE: ' + c.missing.join(', ') : '']
    })
    rows.push(['', '', 'TOTAL', '', sum(s, x => x.calc.salary), sum(s, x => x.calc.otTotal), sum(s, x => x.calc.gross), '', '', sum(s, x => x.calc.deductions), sum(s, x => x.calc.bonus), sum(s, x => x.calc.allowance), sum(s, x => x.calc.netAfterDeduction), sum(s, x => x.calc.tax), sum(s, x => x.calc.nssfEmployee), sum(s, x => x.calc.advance), sum(s, x => x.calc.adjustment), sum(s, x => x.calc.withholding), sum(s, x => x.net), '', ''])
    sheet = { name: 'Payroll', header: ['No', 'PIN', 'Name', 'Group', 'Salary (USD)', 'Overtime', 'Gross', 'Absent days', 'Unpaid leave days', 'Deductions', 'Bonus', 'Allowance', 'Net after deduction', 'Tax on salary', 'NSSF (employee)', 'Advance repaid', 'Adjustment', 'Withholding', 'Net pay', 'Paid by', 'Notes'], rows, cols: [5, 8, 24, 12, 12, 10, 10, 10, 12, 11, 9, 10, 14, 11, 12, 11, 11, 11, 11, 9, 30] }
  } else if (kind === 'bank' || kind === 'cash') {
    const list = s.filter(x => x.paymentMethod === kind)
    name = `Payroll_${stamp}_${kind === 'bank' ? 'Bank' : 'Cash'}_${label}.xlsx`
    const rows = list.map((x, i) => kind === 'bank' ? [i + 1, x.pin, x.name, x.calc.bankName || '', x.calc.bankAccount || '', money(x.net)] : [i + 1, x.pin, x.name, money(x.net), ''])
    rows.push(kind === 'bank' ? ['', '', 'TOTAL', '', '', sum(list, x => x.net)] : ['', '', 'TOTAL', sum(list, x => x.net), ''])
    const unset = s.filter(x => !x.paymentMethod)
    if (unset.length) rows.push([], [`${unset.length} staff have no payment method set and are on neither list: ${unset.map(x => x.name).join(', ')}`])
    sheet = kind === 'bank'
      ? { name: 'Bank', header: ['No', 'PIN', 'Name', 'Bank', 'Account', 'Net pay (USD)'], rows, cols: [5, 8, 26, 18, 22, 14] }
      : { name: 'Cash', header: ['No', 'PIN', 'Name', 'Net pay (USD)', 'Signature'], rows, cols: [5, 8, 26, 14, 24] }
  } else if (kind === 'nssf') {
    name = `Payroll_${stamp}_NSSF_${label}.xlsx`
    const list = s.filter(x => !x.calc.nssfExempt)
    const rows = list.map((x, i) => { const c = x.calc; return [i + 1, x.pin, x.name, c.nssfWage, c.nssfEmployee, c.nssfEmployerPension, c.nssfEmployerHealth, c.nssfEmployerRisk, c.nssfEmployer, Math.round((c.nssfEmployee + c.nssfEmployer) * 100) / 100] })
    rows.push(['', '', 'TOTAL', sum(list, x => x.calc.nssfWage), sum(list, x => x.calc.nssfEmployee), sum(list, x => x.calc.nssfEmployerPension), sum(list, x => x.calc.nssfEmployerHealth), sum(list, x => x.calc.nssfEmployerRisk), sum(list, x => x.calc.nssfEmployer), sum(list, x => x.calc.nssfEmployee + x.calc.nssfEmployer)])
    sheet = { name: 'NSSF', header: ['No', 'PIN', 'Name', 'Insurable wage (USD)', 'Employee', 'Employer pension', 'Employer health', 'Employer risk', 'Employer total', 'Total contribution'], rows, cols: [5, 8, 26, 18, 11, 16, 15, 13, 14, 16] }
  } else throw new Error('Unknown export.')
  return { filename: name, buffer: toXlsx([sheet]) }
}

module.exports = { buildPayrollExport }
