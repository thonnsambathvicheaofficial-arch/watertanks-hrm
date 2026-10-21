import type { Metadata } from 'next'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { EmptyState, Flash, MigrationNotice, PageHeader } from '@/components/ui'
import { DAY_NAMES, to12h } from '@/lib/utils'
import { guard } from '@/lib/guard'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')

export const metadata: Metadata = { title: 'Shifts' }
export const dynamic = 'force-dynamic'

type Shift = { id: string; name: string; start: string; end: string; graceMinutes: number | null; offDays: number[]; overnight: boolean; staff: number }

export default async function ShiftsPage({ searchParams }: { searchParams: { error?: string; saved?: string } }) {
  const me = await guard()
  const ready = await hr.available()
  const shifts: Shift[] = ready ? await hr.shifts.list() : []
  return (
    <>
      <PageHeader title="Shifts" note="A shift is a named working pattern. Staff linked to one take its start and end times.">
        {ready && <Link href="/settings/shifts/new" className="inline-flex h-9 items-center gap-2 rounded bg-brand px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-brand-deep"><Plus size={16} aria-hidden /> New shift</Link>}
      </PageHeader>
      <Flash error={searchParams.error} saved={searchParams.saved} />
      {!me.perms.includes('setup.edit') && <ReadOnlyNotice />}
      {!ready ? <MigrationNotice /> : (
        <TableWrap>
          <Table>
            <thead><tr><Th>Shift</Th><Th>Hours</Th><Th>Grace</Th><Th>Default days off</Th><Th align="right">Staff</Th></tr></thead>
            <tbody>
              {shifts.length === 0 && <tr><td colSpan={5}><EmptyState title="No shifts yet">Create the day shift first, then a night shift if the factory runs one.</EmptyState></td></tr>}
              {shifts.map(s => (
                <tr key={s.id}>
                  <Td className="font-medium"><Link href={`/settings/shifts/${s.id}`} className="text-brand-deep underline decoration-line-strong hover:decoration-brand">{s.name}</Link></Td>
                  <Td className="num whitespace-nowrap">{to12h(s.start)} to {to12h(s.end)}{s.overnight && <span className="ml-2 rounded-sm bg-leave-wash px-1.5 py-0.5 text-[12px] font-medium text-leave">Overnight</span>}</Td>
                  <Td className="text-ink-soft">{s.graceMinutes == null ? 'Company default' : `${s.graceMinutes} min`}</Td>
                  <Td className="text-ink-soft">{s.offDays.length ? s.offDays.map(d => DAY_NAMES[d].slice(0, 3)).join(', ') : 'None'}</Td>
                  <Td align="right">{s.staff || ''}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </>
  )
}
