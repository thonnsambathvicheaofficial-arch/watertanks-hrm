import type { Metadata } from 'next'
import { MonthNav } from '@/components/MonthNav'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { Button, EmptyState, Field, Flash, Input, LeaveStatusBadge, MigrationNotice, PageHeader, Select } from '@/components/ui'
import { decodeEcho, echoOne } from '@/lib/echo'
import { MONTH_NAMES, dayName } from '@/lib/utils'
import { ConfirmButton } from '@/components/ConfirmButton'
import { SubmitButton } from '@/components/SubmitButton'
import { addOvertime, decideAllOvertime, decideOvertime, suggestOvertime } from './actions'
import { guard } from '@/lib/guard'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pr = require('@/lib/payroll-store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lv = require('@/lib/leave-store')

export const metadata: Metadata = { title: 'Overtime' }
export const dynamic = 'force-dynamic'

type O = { id: string; pin: string; date: string; hours: number; scanHours: number | null; source: string; status: string; note: string }
type P = { pin: string; name: string; offDays: number[]; resignedDate: string }
type Cfg = { otRateNormal: number | null; otRateOff: number | null; otRateHoliday: number | null }

const TIER: Record<string, string> = { normal: 'Normal day', off: 'Day off', holiday: 'Holiday' }
const shift = (y: number, m: number, n: number) => { const d = new Date(y, m - 1 + n, 1); return { y: d.getFullYear(), m: d.getMonth() + 1 } }

export default async function OvertimePage({ searchParams }: { searchParams: { year?: string; month?: string; status?: string; error?: string; saved?: string; v?: string } }) {
  const me = await guard()
  if (!(await pr.ready())) return <><PageHeader title="Overtime" /><MigrationNotice file="003_payroll.sql" /></>
  const now = new Date()
  const year = Number(searchParams.year) || now.getFullYear(), month = Number(searchParams.month) || now.getMonth() + 1
  const status = searchParams.status || ''
  const [all, staff, hols, cfg, run]: [O[], P[], { date: string }[], Cfg, { status: string } | null] = await Promise.all([pr.overtime.list(year, month), hr.staff.list(), lv.holidays.list(year), pr.settings.get(), pr.runs.get(year, month)])
  const list = status ? all.filter(o => o.status === status) : all
  const byPin = Object.fromEntries(staff.map(p => [p.pin, p]))
  const holidays = new Set(hols.map(h => h.date))
  const people = staff.filter(p => !p.resignedDate).sort((a, b) => (a.name || a.pin).localeCompare(b.name || b.pin))
  const locked = run?.status === 'finalized'
  const prev = shift(year, month, -1), next = shift(year, month, 1)
  const echo = decodeEcho(searchParams.v)
  const count = (s: string) => all.filter(o => o.status === s).length
  const approvedHours = Math.round(all.filter(o => o.status === 'approved').reduce((a, o) => a + o.hours, 0) * 100) / 100
  const rateOf = (tier: string) => (tier === 'normal' ? cfg.otRateNormal : tier === 'off' ? cfg.otRateOff : cfg.otRateHoliday)
  const noRates = [cfg.otRateNormal, cfg.otRateOff, cfg.otRateHoliday].some(r => r === null)
  const hidden = (<><input type="hidden" name="year" value={year} /><input type="hidden" name="month" value={month} />{status && <input type="hidden" name="status" value={status} />}</>)

  return (
    <>
      <PageHeader title="Overtime" note={`${count('pending')} waiting for approval · ${count('approved')} approved (${approvedHours} h). Only approved hours are paid.`}>
        <MonthNav label={`${MONTH_NAMES[month - 1]} ${year}`} prev={`/payroll/overtime?year=${prev.y}&month=${prev.m}`} next={`/payroll/overtime?year=${next.y}&month=${next.m}`} />
      </PageHeader>
      <Flash error={searchParams.error} saved={searchParams.saved} />
      {!me.perms.includes('payroll.edit') && <ReadOnlyNotice />}
      {noRates && <p className="mb-5 rounded border border-late/35 bg-late-wash px-3.5 py-2.5 text-[14px] text-late">Overtime multipliers are not set yet, so approved hours will not be paid until they are. Set them in Payroll settings.</p>}
      {locked && <p className="mb-5 rounded border border-line bg-raised px-3.5 py-2.5 text-[14px] text-ink-soft">Payroll for this month is finalized. Overtime can no longer be changed.</p>}

      <div className="mb-5 flex flex-wrap items-end gap-3">
        {!locked && <form action={suggestOvertime}>{hidden}<SubmitButton variant="primary" pendingLabel="Reading the month's scans">Suggest from scans</SubmitButton></form>}
        {!locked && count('pending') > 0 && (
          <>
            <form action={decideAllOvertime}>{hidden}<input type="hidden" name="decision" value="approve" /><ConfirmButton pendingLabel="Approving" message={`Approve all ${count('pending')} pending entries for ${MONTH_NAMES[month - 1]}? Reject any you do not want first.`}>Approve all {count('pending')} pending</ConfirmButton></form>
            <form action={decideAllOvertime}>{hidden}<input type="hidden" name="decision" value="reject" /><ConfirmButton variant="danger" pendingLabel="Rejecting" message={`Reject all ${count('pending')} pending entries?`}>Reject all pending</ConfirmButton></form>
          </>
        )}
        <form method="get" className="flex items-end gap-3">
          <input type="hidden" name="year" value={year} /><input type="hidden" name="month" value={month} />
          <div className="w-[170px]"><Select name="status" defaultValue={status} aria-label="Status"><option value="">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></Select></div>
          <Button type="submit">Filter</Button>
        </form>
      </div>

      <TableWrap className="mb-8">
        <Table>
          <thead><tr><Th>Date</Th><Th>Staff</Th><Th>Rate tier</Th><Th align="right">Hours</Th><Th>Source</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={7}><EmptyState title="No overtime entries" >Use Suggest from scans to propose overtime from the month&apos;s scans, or add hours by hand below.</EmptyState></td></tr>}
            {list.map(o => {
              const p = byPin[o.pin]
              const tier = pr.overtime.tierOf(o.date, p?.offDays || [], holidays) as string
              const r = rateOf(tier)
              return (
                <tr key={o.id}>
                  <Td className="num whitespace-nowrap">{o.date} <span className="text-ink-faint">{dayName(o.date).slice(0, 3)}</span></Td>
                  <Td className="font-medium">{p?.name || o.pin}<span className="num ml-2 text-[12px] font-normal text-ink-soft">{o.pin}</span></Td>
                  <Td className="whitespace-nowrap">{TIER[tier]}<span className="num ml-2 text-[12px] text-ink-soft">{r === null ? 'rate not set' : `x${r}`}</span></Td>
                  <Td align="right" className="whitespace-nowrap">{o.hours}{o.scanHours !== null && o.scanHours !== o.hours && <span className="ml-1.5 text-[12px] text-ink-faint">scan {o.scanHours}</span>}</Td>
                  <Td className="text-ink-soft">{o.source === 'scan' ? 'From scans' : 'Entered by hand'}</Td>
                  <Td><LeaveStatusBadge status={o.status} /></Td>
                  <Td>
                    {!locked && (
                      <form action={decideOvertime} className="flex flex-wrap items-center gap-2">
                        {hidden}<input type="hidden" name="id" value={o.id} />
                        <Input type="number" step="0.05" min={0.05} max={24} name="hours" defaultValue={o.hours} aria-label={`Hours for ${p?.name || o.pin} on ${o.date}`} className="w-[84px]" />
                        {o.status !== 'approved' && <Button type="submit" name="decision" value="approve" variant="primary">Approve</Button>}
                        {o.status === 'approved' && <Button type="submit" name="decision" value="approve">Save hours</Button>}
                        {o.status !== 'rejected' && <Button type="submit" name="decision" value="reject" variant="danger">Reject</Button>}
                        {o.source === 'manual' && <Button type="submit" name="decision" value="remove" variant="danger">Remove</Button>}
                      </form>
                    )}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </TableWrap>

      {!locked && (
        <section aria-labelledby="add-h" className="max-w-[900px]">
          <h2 id="add-h" className="mb-3 text-[15px] font-semibold">Add overtime by hand</h2>
          <form action={addOvertime} className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_100px_1.2fr_auto]">
            {hidden}
            <Field label="Staff member"><Select name="pin" required defaultValue={echoOne(echo, 'pin') ?? ''}><option value="" disabled>Choose a person</option>{people.map(p => <option key={p.pin} value={p.pin}>{p.name || 'Unnamed'} · {p.pin}</option>)}</Select></Field>
            <Field label="Date"><Input type="date" name="date" defaultValue={echoOne(echo, 'date') ?? `${year}-${String(month).padStart(2, '0')}-01`} required /></Field>
            <Field label="Hours"><Input type="number" step="0.05" min={0.05} max={24} name="hours" defaultValue={echoOne(echo, 'hours')} required /></Field>
            <Field label="Note"><Input name="note" defaultValue={echoOne(echo, 'note')} placeholder="Optional" /></Field>
            <Button type="submit" variant="primary">Add and approve</Button>
          </form>
        </section>
      )}
    </>
  )
}
