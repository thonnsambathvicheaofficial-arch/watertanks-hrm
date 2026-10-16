import type { Metadata } from 'next'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { Button, EmptyState, Flash, Input, LeaveStatusBadge, MigrationNotice, PageHeader, Select } from '@/components/ui'
import { dayName } from '@/lib/utils'
import { decideLeave } from './actions'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lv = require('@/lib/leave-store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')

export const metadata: Metadata = { title: 'Leave' }
export const dynamic = 'force-dynamic'

type Req = { id: string; pin: string; typeCode: string; typeName: string; from: string; to: string; halfDayPeriod: string; days: number; reason: string; status: string; decidedBy: string; decisionNote: string; createdBy: string }

export default async function LeavePage({ searchParams }: { searchParams: { status?: string; year?: string; typeId?: string; pin?: string; error?: string; saved?: string } }) {
  if (!(await lv.ready())) return <><PageHeader title="Leave" /><MigrationNotice /></>
  const status = searchParams.status ?? 'pending'
  // Every view shows all years (newest first) unless a year is typed, so a request is never hidden by a default.
  const year = searchParams.year ?? ''
  const [types, staff, pending] = await Promise.all([lv.types.list(), hr.staff.list(), lv.requests.list({ status: 'pending' })])
  const rows: Req[] = await lv.requests.list({ status: status || undefined, year: year ? Number(year) : undefined, typeId: searchParams.typeId || undefined, pin: searchParams.pin || undefined })
  const name: Record<string, string> = Object.fromEntries(staff.map((s: { pin: string; name: string }) => [s.pin, s.name]))
  const when = (r: Req) => (r.from === r.to ? `${r.from} ${dayName(r.from).slice(0, 3)}${r.halfDayPeriod ? ` · ${r.halfDayPeriod} half day` : ''}` : `${r.from} to ${r.to}`)

  return (
    <>
      <PageHeader title="Leave" note={pending.length ? `${pending.length} waiting for a decision.` : 'Nothing is waiting for a decision.'}>
        <Link href="/leave/new" className="inline-flex h-9 items-center gap-2 rounded bg-brand px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-brand-deep"><Plus size={16} aria-hidden /> Record leave</Link>
      </PageHeader>
      <Flash error={searchParams.error} saved={searchParams.saved} />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-[160px]"><Select name="status" defaultValue={status} aria-label="Status"><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option><option value="">All statuses</option></Select></div>
        <div className="w-[190px]"><Select name="typeId" defaultValue={searchParams.typeId || ''} aria-label="Leave type"><option value="">All types</option>{types.map((t: { id: string; name: string }) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></div>
        <div className="w-[110px]"><Input name="year" type="number" min={2000} max={2100} defaultValue={year} placeholder="All years" aria-label="Year" /></div>
        <div className="w-[130px]"><Input name="pin" defaultValue={searchParams.pin} placeholder="PIN" inputMode="numeric" aria-label="PIN" /></div>
        <Button type="submit">Filter</Button>
      </form>

      <TableWrap>
        <Table>
          <thead><tr><Th>Staff</Th><Th>Type</Th><Th>Dates</Th><Th align="right">Days</Th><Th>Status</Th><Th>Reason</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7}><EmptyState title="No leave for these filters">{status === 'pending' ? 'Nothing is waiting. Use Record leave to add leave HR has agreed.' : 'Try a different status or year.'}</EmptyState></td></tr>}
            {rows.map(r => (
              <tr key={r.id}>
                <Td className="font-medium">{name[r.pin] || r.pin}<span className="num ml-2 text-[12px] font-normal text-ink-soft">{r.pin}</span></Td>
                <Td className="whitespace-nowrap">{r.typeName}</Td>
                <Td className="num whitespace-nowrap">{when(r)}</Td>
                <Td align="right">{r.days}</Td>
                <Td><LeaveStatusBadge status={r.status} />{r.decidedBy && <div className="mt-0.5 text-[12px] text-ink-soft">by {r.decidedBy}</div>}</Td>
                <Td className="max-w-[260px] text-ink-soft">{r.reason}{r.decisionNote && <div className="text-[12px]">Decision: {r.decisionNote}</div>}</Td>
                <Td>
                  {r.status === 'pending' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <form action={decideLeave}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="approve" /><Button type="submit" variant="primary">Approve</Button></form>
                      <form action={decideLeave} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="reject" />
                        <Input name="note" placeholder="Reason" aria-label={`Reason for rejecting ${name[r.pin] || r.pin}`} required className="w-[130px]" />
                        <Button type="submit" variant="danger">Reject</Button>
                      </form>
                    </div>
                  )}
                  {r.status === 'approved' && (
                    <form action={decideLeave}>
                      <input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="cancel" />
                      <ConfirmButton variant="danger" message="Cancel this approved leave? Those days count as normal working days again.">Cancel leave</ConfirmButton>
                    </form>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </>
  )
}
