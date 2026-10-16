import type { Metadata } from 'next'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { Button, EmptyState, Flash, Input, PageHeader, Select } from '@/components/ui'
import { DAY_NAMES, to12h } from '@/lib/utils'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { glabel } = require('@/lib/exports')

export const metadata: Metadata = { title: 'Staff' }
export const dynamic = 'force-dynamic'

type P = { pin: string; name: string; group: string; timeIn: string; timeOut: string; offDays: number[]; aliases: string[]; departmentId: string; shiftId: string; position: string }
type Opt = { id: string; name: string }

export default async function StaffPage({ searchParams }: { searchParams: { q?: string; group?: string; error?: string; saved?: string } }) {
  const ready = await hr.available()
  const [all, shifts, depts]: [P[], Opt[], Opt[]] = await Promise.all([hr.staff.list(), ready ? hr.shifts.list() : [], ready ? hr.departments.list() : []])
  const shiftName = Object.fromEntries(shifts.map(s => [s.id, s.name]))
  const deptName = Object.fromEntries(depts.map(d => [d.id, d.name]))
  const q = (searchParams.q || '').trim().toLowerCase()
  const group = searchParams.group || ''
  const rows = all
    .filter(e => (!group || e.group === group) && (!q || e.pin.includes(q) || e.name.toLowerCase().includes(q)))
    .sort((a, b) => (a.name || a.pin).localeCompare(b.name || b.pin))

  return (
    <>
      <PageHeader title="Staff" note={`${rows.length} of ${all.length} on record`}>
        <Link href="/staff/new" className="inline-flex h-9 items-center gap-2 rounded bg-brand px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-brand-deep"><Plus size={16} aria-hidden /> Add staff</Link>
      </PageHeader>
      <Flash error={searchParams.error} saved={searchParams.saved} />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-full max-w-[280px]"><Input name="q" defaultValue={searchParams.q} placeholder="Search name or PIN" aria-label="Search staff" /></div>
        <div className="w-[170px]"><Select name="group" defaultValue={group} aria-label="Group"><option value="">All groups</option><option value="office">Office staff</option><option value="worker">Workers</option></Select></div>
        <Button type="submit">Filter</Button>
      </form>
      <TableWrap>
        <Table>
          <thead><tr><Th>PIN</Th><Th>Name</Th><Th>Group</Th>{ready && <Th>Department</Th>}<Th>{ready ? 'Shift' : 'Hours'}</Th><Th>Off days</Th><Th>Also scans as</Th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={ready ? 7 : 6}><EmptyState title="No staff match" /></td></tr>}
            {rows.map(e => (
              <tr key={e.pin}>
                <Td className="num text-ink-soft">{e.pin}</Td>
                <Td className="font-medium"><Link href={`/staff/${encodeURIComponent(e.pin)}`} className="text-brand-deep underline decoration-line-strong hover:decoration-brand">{e.name || 'Unnamed'}</Link></Td>
                <Td className="text-ink-soft">{glabel(e.group)}</Td>
                {ready && <Td className="text-ink-soft">{deptName[e.departmentId] || ''}</Td>}
                <Td className="num whitespace-nowrap">
                  {ready && e.shiftId ? shiftName[e.shiftId]
                    : e.timeIn && e.timeOut ? <>{to12h(e.timeIn)} to {to12h(e.timeOut)}</>
                    : <span className="text-ink-faint">Company default</span>}
                </Td>
                <Td className="text-ink-soft">{e.offDays.map(d => DAY_NAMES[d].slice(0, 3)).join(', ')}</Td>
                <Td className="num text-ink-soft">{e.aliases.join(', ')}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </>
  )
}
