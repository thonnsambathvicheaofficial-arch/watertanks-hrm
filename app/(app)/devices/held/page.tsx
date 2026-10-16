import type { Metadata } from 'next'
import Link from 'next/link'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { EmptyState, PageHeader } from '@/components/ui'
import { guard } from '@/lib/guard'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { devices } = require('@/lib/device-admin')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const store = require('@/lib/store')

export const metadata: Metadata = { title: 'Scans held aside' }
export const dynamic = 'force-dynamic'

type Row = { id: string; device_id: string | null; device_name: string | null; pin: string; ts: string; reason: string | null; detected_at: string }
const REASON: Record<string, string> = { out_of_range_timestamp: 'Date far outside the real range', midnight_artifact: 'Midnight artifact from a clock reset' }
const LIMIT = 500

export default async function HeldPage({ searchParams }: { searchParams: { deviceId?: string } }) {
  await guard()
  const [{ rows, total }, names, devs] = await Promise.all([devices.held({ deviceId: searchParams.deviceId, limit: LIMIT }), store.employees.names(), store.devices.list()])
  const dev = (devs as { id: string; name: string }[]).find(d => d.id === searchParams.deviceId)
  return (
    <>
      <PageHeader title="Scans held aside" note={`${total.toLocaleString()} scan${total === 1 ? '' : 's'}${dev ? ` from ${dev.name}` : ''}. Their time is impossible, usually a dead clock battery or a restart after a power cut, so they are kept out of attendance. Nothing is deleted.`}>
        <Link href="/devices" className="text-[14px] text-ink-soft underline decoration-line-strong hover:text-ink">All devices</Link>
      </PageHeader>
      <TableWrap>
        <Table>
          <thead><tr><Th>Device</Th><Th>PIN</Th><Th>Name</Th><Th>Time the device recorded</Th><Th>Why held</Th><Th>Found</Th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6}><EmptyState title="Nothing is held aside" /></td></tr>}
            {(rows as Row[]).map(r => (
              <tr key={r.id}>
                <Td>{r.device_name || ''}</Td>
                <Td className="num">{r.pin}</Td>
                <Td>{names[r.pin] || <span className="text-ink-soft">Not on the staff list</span>}</Td>
                <Td className="num whitespace-nowrap">{String(r.ts).replace('T', ' ').slice(0, 19)}</Td>
                <Td className="text-[13px]">{(r.reason && REASON[r.reason]) || r.reason || ''}</Td>
                <Td className="num whitespace-nowrap text-ink-soft">{r.detected_at.slice(0, 10)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
      {total > rows.length && <p className="mt-3 text-[13px] text-ink-soft">Showing the newest {rows.length.toLocaleString()} of {total.toLocaleString()}.</p>}
    </>
  )
}
