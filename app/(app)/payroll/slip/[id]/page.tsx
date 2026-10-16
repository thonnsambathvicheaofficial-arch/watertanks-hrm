import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Logo } from '@/components/Logo'
import { PrintButton } from '@/components/PrintButton'
import { MONTH_NAMES, usd } from '@/lib/utils'
import { guard } from '@/lib/guard'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pr = require('@/lib/payroll-store')

export const metadata: Metadata = { title: 'Payslip' }
export const dynamic = 'force-dynamic'

type Calc = {
  salary: number; otHours: { normal: number; off: number; holiday: number }; otPay: { normal: number; off: number; holiday: number }; otTotal: number; gross: number
  absentDays: number; unpaidLeaveDays: number; absentDeduction: number; lateDays: number; lateMinutes: number; lateDeduction: number; deductions: number
  bonus: number; allowance: number; netAfterDeduction: number; reliefUsd: number; taxableUsd: number; taxRate: number; tax: number; taxExempt: boolean; resident: boolean
  nssfWage: number; nssfEmployee: number; nssfEmployer: number; nssfExempt: boolean; advance: number; adjustment: number; withholding: number; finalNet: number
  presentDays: number; paidLeaveDays: number; notes: string[]; missing: string[]; incomplete: boolean; bankName?: string; bankAccount?: string; hourlyRate: number; dailyRate: number
}

function Line({ label, value, strong, sub }: { label: string; value: string; strong?: boolean; sub?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-6 border-b border-line py-2 ${strong ? 'font-semibold' : ''}`}>
      <span>{label}{sub && <span className="ml-2 text-[12px] font-normal text-ink-soft">{sub}</span>}</span>
      <span className="num whitespace-nowrap">{value}</span>
    </div>
  )
}

export default async function SlipPage({ params }: { params: { id: string } }) {
  await guard()
  if (!(await pr.ready())) notFound()
  const s = await pr.runs.slip(params.id)
  if (!s) notFound()
  const c: Calc = s.calc
  const otHrs = c.otHours.normal + c.otHours.off + c.otHours.holiday
  const draft = s.status !== 'finalized'

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3 print:hidden">
        <Link href={`/payroll/${s.year}-${String(s.month).padStart(2, '0')}`} className="text-[14px] text-ink-soft underline decoration-line-strong hover:text-ink">Back to {MONTH_NAMES[s.month - 1]} {s.year}</Link>
        <div className="ml-auto"><PrintButton label="Print payslip" /></div>
      </div>

      <article className="mx-auto max-w-[720px] rounded-md border border-line bg-raised p-6 text-[14px] sm:p-8 print:max-w-none print:border-0 print:p-0">
        <header className="mb-6 flex items-start justify-between gap-4 border-b border-line-strong pb-5">
          <div className="flex items-center gap-3"><Logo size={44} /><div><p className="text-[16px] font-semibold">Song Fa Water Tanks</p><p className="text-ink-soft">Payslip for {MONTH_NAMES[s.month - 1]} {s.year}</p></div></div>
          {draft && <span className="rounded-sm bg-late-wash px-2 py-1 text-[12px] font-medium text-late">DRAFT</span>}
        </header>

        <dl className="mb-6 grid gap-x-8 gap-y-1 sm:grid-cols-2">
          <div className="flex justify-between gap-4"><dt className="text-ink-soft">Name</dt><dd className="font-medium">{s.name}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-ink-soft">PIN</dt><dd className="num font-medium">{s.pin}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-ink-soft">Days worked</dt><dd className="num">{c.presentDays}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-ink-soft">Paid by</dt><dd className="capitalize">{s.paymentMethod || 'Not set'}{s.paymentMethod === 'bank' && c.bankAccount ? `, ${c.bankName || ''} ${c.bankAccount}` : ''}</dd></div>
        </dl>

        <h2 className="mb-1 text-[13px] font-semibold text-ink-soft">Earnings</h2>
        <Line label="Monthly salary" value={usd(c.salary)} />
        {c.otTotal > 0 && <Line label="Overtime" sub={`${Math.round(otHrs * 100) / 100} h`} value={usd(c.otTotal)} />}
        {c.bonus > 0 && <Line label="Bonus" value={usd(c.bonus)} />}
        {c.allowance > 0 && <Line label="Allowances" value={usd(c.allowance)} />}

        {c.deductions > 0 && <h2 className="mb-1 mt-5 text-[13px] font-semibold text-ink-soft">Deductions for time</h2>}
        {c.absentDeduction > 0 && <Line label="Absent and unpaid leave" sub={`${c.absentDays + c.unpaidLeaveDays} day${c.absentDays + c.unpaidLeaveDays === 1 ? '' : 's'} at ${usd(c.dailyRate)}`} value={usd(-c.absentDeduction)} />}
        {c.lateDeduction > 0 && <Line label="Late arrivals" sub={`${c.lateDays} day${c.lateDays === 1 ? '' : 's'}, ${c.lateMinutes} min`} value={usd(-c.lateDeduction)} />}
        <Line label="Pay before tax and NSSF" value={usd(c.netAfterDeduction)} strong />

        <h2 className="mb-1 mt-5 text-[13px] font-semibold text-ink-soft">Tax and contributions</h2>
        <Line label="Tax on salary" sub={c.taxExempt ? 'exempt' : c.resident ? `${c.taxRate}% bracket${c.reliefUsd ? `, ${usd(c.reliefUsd)} relief` : ''}` : `non-resident ${c.taxRate}%`} value={usd(-c.tax)} />
        <Line label="NSSF, employee" sub={c.nssfExempt ? 'exempt' : `on ${usd(c.nssfWage)}`} value={usd(-c.nssfEmployee)} />
        {c.advance > 0 && <Line label="Advance or loan repaid" value={usd(-c.advance)} />}
        {c.adjustment !== 0 && <Line label="Adjustment" value={usd(c.adjustment)} />}
        {c.withholding !== 0 && <Line label="Withholding" value={usd(c.withholding)} />}

        <div className="mt-4 flex items-baseline justify-between gap-6 rounded-md bg-brand-wash px-4 py-3 text-[16px] font-semibold text-brand-deep"><span>Net pay</span><span className="num">{usd(c.finalNet)}</span></div>

        {c.nssfEmployer > 0 && <p className="mt-4 text-[12px] text-ink-soft">Employer NSSF contribution of {usd(c.nssfEmployer)} is paid by the company and is not deducted from this pay.</p>}
        {c.notes.map(n => <p key={n} className="mt-2 text-[12px] text-ink-soft">{n}</p>)}
        {c.incomplete && <p className="mt-4 rounded border border-late/35 bg-late-wash px-3 py-2 text-[13px] text-late print:border-late">Incomplete: missing {c.missing.join(', ')}. The figures above leave those out.</p>}
      </article>
    </>
  )
}
