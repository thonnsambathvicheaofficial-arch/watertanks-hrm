import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { Button, EmptyState, Flash, Input, MigrationNotice, PageHeader } from '@/components/ui'
import { fillDefaults, saveEntitlements } from './actions'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lv = require('@/lib/leave-store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')

export const metadata: Metadata = { title: 'Entitlements' }
export const dynamic = 'force-dynamic'

type T = { id: string; code: string; name: string; defaultDays: number | null }
type P = { pin: string; name: string; resignedDate: string }
type Req = { pin: string; typeId: string; days: number; status: string }

export default async function EntitlementsPage({ searchParams }: { searchParams: { year?: string; q?: string; error?: string; saved?: string } }) {
  if (!(await lv.ready())) return <><PageHeader title="Entitlements" /><MigrationNotice file="002_leave_holidays_roster.sql" /></>
  const year = Number(searchParams.year) || new Date().getFullYear()
  const q = (searchParams.q || '').trim().toLowerCase()
  const [types, staff, ent, reqs] = await Promise.all([lv.types.list({ activeOnly: true }), hr.staff.list(), lv.entitlements.forYear(year), lv.requests.list({ year, status: 'approved' })]) as [T[], P[], Record<string, Record<string, number>>, Req[]]
  const used: Record<string, Record<string, number>> = {}
  for (const r of reqs) ((used[r.pin] ||= {})[r.typeId] = (used[r.pin][r.typeId] || 0) + r.days)
  const people = staff.filter(s => !s.resignedDate && (!q || s.pin.includes(q) || s.name.toLowerCase().includes(q))).sort((a, b) => (a.name || a.pin).localeCompare(b.name || b.pin))
  const withDefaults = types.filter(t => t.defaultDays != null).length

  return (
    <>
      <PageHeader title="Entitlements" note="Days each person may take in the year. Leave a box empty if that type is not tracked for them. Used counts approved leave.">
        <div className="flex items-center gap-1">
          <Link href={`/settings/entitlements?year=${year - 1}`} aria-label="Previous year" className="inline-flex h-9 w-9 items-center justify-center rounded border border-line-strong bg-raised text-ink-soft transition-colors hover:bg-brand-wash"><ChevronLeft size={18} /></Link>
          <span className="num min-w-[64px] text-center text-[15px] font-semibold">{year}</span>
          <Link href={`/settings/entitlements?year=${year + 1}`} aria-label="Next year" className="inline-flex h-9 w-9 items-center justify-center rounded border border-line-strong bg-raised text-ink-soft transition-colors hover:bg-brand-wash"><ChevronRight size={18} /></Link>
        </div>
      </PageHeader>
      <Flash error={searchParams.error} saved={searchParams.saved} />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <form method="get" className="flex items-end gap-3"><input type="hidden" name="year" value={year} /><div className="w-[260px]"><Input name="q" defaultValue={searchParams.q} placeholder="Search name or PIN" aria-label="Search staff" /></div><Button type="submit">Search</Button></form>
        <form action={fillDefaults} className="ml-auto"><input type="hidden" name="year" value={year} /><Button type="submit" disabled={!withDefaults} title={withDefaults ? undefined : 'Set default days on a leave type first'}>Fill from defaults</Button></form>
      </div>

      <form action={saveEntitlements}>
        <input type="hidden" name="year" value={year} />
        <TableWrap>
          <Table>
            <thead><tr><Th>Staff</Th>{types.map(t => <Th key={t.id} align="right">{t.name}</Th>)}</tr></thead>
            <tbody>
              {people.length === 0 && <tr><td colSpan={types.length + 1}><EmptyState title="No staff match" /></td></tr>}
              {people.map(p => (
                <tr key={p.pin}>
                  <Td className="font-medium">{p.name || 'Unnamed'}<span className="num ml-2 text-[12px] font-normal text-ink-soft">{p.pin}</span></Td>
                  {types.map(t => (
                    <Td key={t.id} className="text-right">
                      <div className="ml-auto flex w-[150px] items-center justify-end gap-2">
                        <span className="num whitespace-nowrap text-[12px] text-ink-soft">{used[p.pin]?.[t.id] ? `used ${used[p.pin][t.id]}` : ''}</span>
                        <Input type="number" step="0.5" min={0} name={`e|${p.pin}|${t.id}`} defaultValue={ent[p.pin]?.[t.id] ?? ''} aria-label={`${t.name} days for ${p.name || p.pin}`} className="w-[72px] text-right" />
                      </div>
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
        <div className="sticky bottom-0 -mx-4 mt-4 border-t border-line bg-paper/95 px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"><Button type="submit" variant="primary">Save entitlements</Button></div>
      </form>
    </>
  )
}
