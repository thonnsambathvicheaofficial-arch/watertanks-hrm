import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, Download } from 'lucide-react'
import { ConfirmButton } from '@/components/ConfirmButton'
import { SubmitButton } from '@/components/SubmitButton'
import { MonthNav } from '@/components/MonthNav'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { Button, EmptyState, Flash, MigrationNotice, PageHeader } from '@/components/ui'
import { MONTH_NAMES, usd } from '@/lib/utils'
import { discardRun, finalizeRun, generateRun } from '../actions'
import { guard } from '@/lib/guard'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pr = require('@/lib/payroll-store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')

export const metadata: Metadata = { title: 'Payroll month' }
export const dynamic = 'force-dynamic'

type Slip = { id: string; pin: string; name: string; paymentMethod: string; gross: number; tax: number; nssfEmployee: number; nssfEmployer: number; net: number; calc: Record<string, number | boolean | string[] | string | null> & { missing: string[]; notes: string[]; otTotal: number; deductions: number; bonus: number; allowance: number; salary: number } }
const pad = (n: number) => String(n).padStart(2, '0')
const shift = (y: number, m: number, n: number) => { const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` }
const total = (s: Slip[], f: (x: Slip) => number) => Math.round(s.reduce((a, x) => a + f(x), 0) * 100) / 100

export default async function PayrollMonthPage({ params, searchParams }: { params: { period: string }; searchParams: { error?: string; saved?: string } }) {
  const me = await guard()
  const m = /^(\d{4})-(\d{2})$/.exec(params.period)
  if (!m) notFound()
  const year = Number(m[1]), month = Number(m[2])
  if (month < 1 || month > 12) notFound()
  if (!(await pr.ready())) return <><PageHeader title="Payroll" /><MigrationNotice file="003_payroll.sql" /></>

  const [run, struct, staff, cfg] = await Promise.all([pr.runs.get(year, month), pr.structure.list(), hr.staff.list(), pr.settings.get()])
  const slips: Slip[] = run?.slips ?? []
  const finalized = run?.status === 'finalized'
  const noSalary = (staff as { pin: string; name: string; resignedDate: string }[]).filter(p => !p.resignedDate && struct[p.pin]?.salary == null)
  const incomplete = slips.filter(s => s.calc.incomplete)
  const missingAll = [...new Set(incomplete.flatMap(s => s.calc.missing))]
  const noMethod = slips.filter(s => !s.paymentMethod).length
  const hidden = (<><input type="hidden" name="year" value={year} /><input type="hidden" name="month" value={month} /></>)
  const exportHref = (k: string) => `/api/export/payroll/${k}?year=${year}&month=${month}`

  return (
    <>
      <PageHeader title={`Payroll, ${MONTH_NAMES[month - 1]} ${year}`} note={run ? (finalized ? `Finalized${run.finalizedBy ? ' by ' + run.finalizedBy : ''}${run.finalizedAt ? ' on ' + run.finalizedAt.slice(0, 10) : ''}. These figures are locked.` : 'Draft. Nothing is locked until you finalize.') : 'Not generated yet.'}>
        <MonthNav label={`${MONTH_NAMES[month - 1]} ${year}`} prev={`/payroll/${shift(year, month, -1)}`} next={`/payroll/${shift(year, month, 1)}`} />
      </PageHeader>
      <Flash error={searchParams.error} saved={searchParams.saved} />
      {!me.perms.includes('payroll.edit') && <ReadOnlyNotice />}

      <div className="mb-5 flex flex-wrap items-center gap-3">
        {!finalized && <form action={generateRun}>{hidden}<SubmitButton variant={run ? 'quiet' : 'primary'} pendingLabel="Building payroll">{run ? 'Generate again' : 'Generate payroll'}</SubmitButton></form>}
        {run && !finalized && <form action={finalizeRun}>{hidden}<ConfirmButton variant="primary" pendingLabel="Finalizing" message={`Finalize payroll for ${MONTH_NAMES[month - 1]} ${year}? The figures will be locked and cannot be edited.`}>Finalize</ConfirmButton></form>}
        {run && !finalized && <form action={discardRun}>{hidden}<ConfirmButton variant="danger" message="Discard this draft? You can generate it again later.">Discard draft</ConfirmButton></form>}
        {run && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <a href={exportHref('register')}><Button><Download size={16} aria-hidden /> Register</Button></a>
            <a href={exportHref('bank')}><Button><Download size={16} aria-hidden /> Bank list</Button></a>
            <a href={exportHref('cash')}><Button><Download size={16} aria-hidden /> Cash list</Button></a>
            <a href={exportHref('nssf')}><Button><Download size={16} aria-hidden /> NSSF</Button></a>
          </div>
        )}
      </div>

      {incomplete.length > 0 && (
        <div role="alert" className="mb-5 flex max-w-[860px] items-start gap-3 rounded border border-late/35 bg-late-wash px-4 py-3 text-[14px] text-late">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
          <p><span className="font-medium">{incomplete.length} slip{incomplete.length === 1 ? ' is' : 's are'} incomplete</span>, so this month cannot be finalized. Missing: {missingAll.join(', ')}. Fill these in under <Link href="/settings/payroll" className="font-medium underline">Payroll settings</Link>, then generate again.</p>
        </div>
      )}
      {run && noSalary.length > 0 && <p className="mb-3 text-[13px] text-ink-soft">{noSalary.length} current staff have no salary and are not in this payroll. <Link href="/payroll/setup?show=missing" className="underline decoration-line-strong hover:text-ink">Open Pay setup</Link>.</p>}
      {run && noMethod > 0 && <p className="mb-3 text-[13px] text-ink-soft">{noMethod} slip{noMethod === 1 ? ' has' : 's have'} no payment method (bank or cash) and will not appear on either list.</p>}

      {!run ? (
        <div className="rounded-md border border-line bg-raised">
          <EmptyState title="This month has not been generated">
            {noSalary.length > 0 ? `${noSalary.length} current staff have no salary yet and would be left out. ` : ''}Generating builds a draft from attendance, approved overtime, monthly items and pay setup. You can review it and generate again as often as you like before finalizing.
          </EmptyState>
        </div>
      ) : (
        <TableWrap>
          <Table>
            <thead><tr><Th>Staff</Th><Th align="right">Salary</Th><Th align="right">Overtime</Th><Th align="right">Deductions</Th><Th align="right">Bonus and allowance</Th><Th align="right">Tax</Th><Th align="right">NSSF</Th><Th align="right">Net pay</Th><Th>Paid by</Th></tr></thead>
            <tbody>
              {slips.map(s => (
                <tr key={s.id}>
                  <Td className="font-medium"><Link href={`/payroll/slip/${s.id}`} className="text-brand-deep underline decoration-line-strong hover:decoration-brand">{s.name}</Link><span className="num ml-2 text-[12px] font-normal text-ink-soft">{s.pin}</span>
                    {s.calc.incomplete && <span className="ml-2 inline-flex items-center rounded-sm bg-late-wash px-1.5 py-0.5 text-[11px] font-medium text-late">Incomplete</span>}
                    {s.calc.notes.length > 0 && <div className="mt-0.5 max-w-[320px] text-[12px] font-normal text-ink-soft">{s.calc.notes[0]}</div>}
                  </Td>
                  <Td align="right">{usd(s.calc.salary)}</Td>
                  <Td align="right">{s.calc.otTotal ? usd(s.calc.otTotal) : ''}</Td>
                  <Td align="right">{s.calc.deductions ? usd(-s.calc.deductions) : ''}</Td>
                  <Td align="right">{s.calc.bonus + s.calc.allowance ? usd(s.calc.bonus + s.calc.allowance) : ''}</Td>
                  <Td align="right">{s.tax ? usd(s.tax) : ''}</Td>
                  <Td align="right">{s.nssfEmployee ? usd(s.nssfEmployee) : ''}</Td>
                  <Td align="right" className="font-medium">{usd(s.net)}</Td>
                  <Td className="capitalize text-ink-soft">{s.paymentMethod}</Td>
                </tr>
              ))}
              <tr className="bg-paper">
                <Td className="font-medium">Total ({slips.length})</Td>
                <Td align="right" className="font-medium">{usd(total(slips, s => s.calc.salary))}</Td>
                <Td align="right" className="font-medium">{usd(total(slips, s => s.calc.otTotal))}</Td>
                <Td align="right" className="font-medium">{usd(-total(slips, s => s.calc.deductions))}</Td>
                <Td align="right" className="font-medium">{usd(total(slips, s => s.calc.bonus + s.calc.allowance))}</Td>
                <Td align="right" className="font-medium">{usd(total(slips, s => s.tax))}</Td>
                <Td align="right" className="font-medium">{usd(total(slips, s => s.nssfEmployee))}</Td>
                <Td align="right" className="font-medium">{usd(total(slips, s => s.net))}</Td>
                <Td />
              </tr>
            </tbody>
          </Table>
        </TableWrap>
      )}
      {run && <p className="mt-3 text-[13px] text-ink-soft">Employer NSSF this month: {usd(total(slips, s => s.nssfEmployer))}. It is a cost to the company and is not taken from anyone&apos;s pay. Exchange rate used: {(finalized && run.settings?.exchangeRate) || cfg.exchangeRate || 'not set'}.</p>}
    </>
  )
}
