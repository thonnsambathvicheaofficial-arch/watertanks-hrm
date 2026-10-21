import type { Metadata } from 'next'
import Link from 'next/link'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { Button, EmptyState, Field, Input, PageHeader } from '@/components/ui'
import { guard } from '@/lib/guard'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const store = require('@/lib/store')

export const metadata: Metadata = { title: 'Unlisted PINs' }
export const dynamic = 'force-dynamic'

type Cand = { pin: string; name: string; punches: number; lastSeen: string; devices: string[] }

export default async function SuggestionsPage({ searchParams }: { searchParams: { days?: string } }) {
  await guard()
  const days = Math.max(1, Math.min(365, Number(searchParams.days) || 60))
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  const emps = await store.employees.get()
  // A PIN is mapped when it is someone's main PIN or one of their Other PINs.
  const mapped = new Set<string>(Object.keys(emps))
  for (const e of Object.values(emps) as { aliases?: string[] }[]) for (const a of e.aliases || []) mapped.add(a)
  const [activity, names] = await Promise.all([store.punches.pinActivity(), store.deviceUsers.getCache().catch(() => ({}))])
  const rows: Cand[] = (activity as { pin: string; total: number; lastSeen: string }[])
    .filter(a => !mapped.has(a.pin) && String(a.lastSeen).slice(0, 10) >= cutoff)
    .map(a => {
      const hit = (names as Record<string, { name: string; devices: string[] }>)[a.pin]
      return { pin: a.pin, name: hit && hit.name && hit.name !== a.pin ? hit.name : '', punches: a.total, lastSeen: String(a.lastSeen).slice(0, 10), devices: hit ? hit.devices : [] }
    })
    .sort((x, y) => y.punches - x.punches)

  return (
    <>
      <PageHeader title="Unlisted PINs" note={`Fingerprint IDs that scanned in the last ${days} days but are not on the staff list. Names come from the devices, when they have one.`}>
        <Link href="/staff" className="text-[14px] text-ink-soft underline decoration-line-strong hover:text-ink">All staff</Link>
      </PageHeader>
      <form method="get" className="mb-5 flex items-end gap-3">
        <div className="w-32"><Field label="Active in the last (days)"><Input name="days" type="number" min={1} max={365} defaultValue={days} /></Field></div>
        <Button type="submit">Show</Button>
      </form>
      <TableWrap>
        <Table wide={false}>
          <thead><tr><Th>PIN</Th><Th>Name on the device</Th><Th align="right">Scans</Th><Th>Last scan</Th><Th>Device</Th><Th><span className="sr-only">Add</span></Th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6}><EmptyState title="Every active PIN is on the staff list" /></td></tr>}
            {rows.map(r => (
              <tr key={r.pin}>
                <Td className="num font-medium">{r.pin}</Td>
                <Td>{r.name || <span className="text-ink-soft">No name</span>}</Td>
                <Td align="right">{r.punches.toLocaleString()}</Td>
                <Td className="num whitespace-nowrap">{r.lastSeen}</Td>
                <Td className="text-[13px] text-ink-soft">{r.devices.join(', ')}</Td>
                <Td className="text-right"><Link className="text-brand-deep underline decoration-line-strong hover:decoration-brand" href={`/staff/new?pin=${encodeURIComponent(r.pin)}&name=${encodeURIComponent(r.name)}`}>Add as staff</Link></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
      <p className="mt-3 max-w-[64ch] text-[13px] text-ink-soft">This list only reads. A person who is the same human as someone already listed should be added under that person&apos;s Other PINs instead of as new staff.</p>
    </>
  )
}
