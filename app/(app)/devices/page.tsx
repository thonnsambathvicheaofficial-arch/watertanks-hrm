import type { Metadata } from 'next'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { EmptyState, PageHeader } from '@/components/ui'
import { guard } from '@/lib/guard'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const store = require('@/lib/store')

export const metadata: Metadata = { title: 'Devices' }
export const dynamic = 'force-dynamic'

type Dev = { id: string; name: string; type: string; lastPullAt: string | null; lastPullOk: boolean | null; lastPullError: string | null; lastLogCount: number }

const ago = (iso: string | null) => {
  if (!iso) return 'Never'
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m} min ago`
  if (m < 1440) return `${Math.round(m / 60)} h ago`
  return `${Math.round(m / 1440)} d ago`
}

export default async function DevicesPage() {
  await guard()
  const [devices, counts, corrupted] = await Promise.all([store.devices.list(), store.punches.countsByDevice(), store.punches.corruptedCountsByDevice()])
  return (
    <>
      <PageHeader title="Devices" note="Fingerprint readers are only ever read from. Nothing here writes to or clears a device." />
      <TableWrap>
        <Table>
          <thead><tr><Th>Device</Th><Th>Sync</Th><Th>Last sync</Th><Th align="right">Scans stored</Th><Th align="right">On device</Th><Th align="right">Held aside</Th></tr></thead>
          <tbody>
            {devices.length === 0 && <tr><td colSpan={6}><EmptyState title="No devices registered" /></td></tr>}
            {(devices as Dev[]).map(d => {
              const ok = d.lastPullOk !== false && !!d.lastPullAt
              return (
                <tr key={d.id}>
                  <Td className="font-medium">{d.name}<div className="text-[12px] font-normal text-ink-soft">{d.type === 'pull' ? 'Pulled over the network' : 'Pushes to the server'}</div></Td>
                  <Td>
                    <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${ok ? 'text-present' : 'text-absent'}`}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />{ok ? 'Syncing' : 'Failed'}
                    </span>
                    {d.lastPullError && !ok && <div className="mt-0.5 max-w-[320px] text-[12px] text-ink-soft">{d.lastPullError}</div>}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-soft">{ago(d.lastPullAt)}</Td>
                  <Td align="right">{(counts[d.id] || 0).toLocaleString()}</Td>
                  <Td align="right">{d.lastLogCount ? d.lastLogCount.toLocaleString() : ''}</Td>
                  <Td align="right">{corrupted[d.id]?.n ? corrupted[d.id].n : ''}</Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </TableWrap>
    </>
  )
}
