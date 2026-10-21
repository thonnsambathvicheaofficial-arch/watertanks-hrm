import type { Metadata } from 'next'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { Button, EmptyState, Flash, PageHeader } from '@/components/ui'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
import { SubmitButton } from '@/components/SubmitButton'
import { guard } from '@/lib/guard'
import { pullNow } from './actions'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const store = require('@/lib/store')

export const metadata: Metadata = { title: 'Devices' }
export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Dev = { id: string; name: string; type: string; ip: string | null; port: number; serial: string | null; publicHost: string | null; publicPort: number | null; lastPullAt: string | null; lastPullOk: boolean | null; lastPullError: string | null; lastLogCount: number }

const ago = (iso: string | null) => {
  if (!iso) return 'Never'
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m} min ago`
  if (m < 1440) return `${Math.round(m / 60)} h ago`
  return `${Math.round(m / 1440)} d ago`
}

export default async function DevicesPage({ searchParams }: { searchParams: { error?: string; saved?: string } }) {
  const me = await guard()
  const canEdit = me.perms.includes('setup.edit')
  const [devices, counts, corrupted] = await Promise.all([store.devices.list(), store.punches.countsByDevice(), store.punches.corruptedCountsByDevice()])
  return (
    <>
      <PageHeader title="Devices" note="Fingerprint readers are only ever read from. Nothing here writes to or clears a device.">
        {canEdit && <Link href="/devices/new" className="inline-flex h-9 items-center gap-2 rounded bg-brand px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-brand-deep"><Plus size={16} aria-hidden /> Add device</Link>}
      </PageHeader>
      <Flash error={searchParams.error} saved={searchParams.saved} />
      {!canEdit && <ReadOnlyNotice />}
      <TableWrap>
        <Table>
          <thead><tr><Th>Device</Th><Th>Address</Th><Th>Sync</Th><Th>Last sync</Th><Th align="right">Scans stored</Th><Th align="right">On device</Th><Th align="right">Held aside</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody>
            {devices.length === 0 && <tr><td colSpan={8}><EmptyState title="No devices registered" /></td></tr>}
            {(devices as Dev[]).map(d => {
              const ok = d.lastPullOk !== false && !!d.lastPullAt
              const held = corrupted[d.id]?.n || 0
              return (
                <tr key={d.id}>
                  <Td className="font-medium">{d.name}<div className="text-[12px] font-normal text-ink-soft">{d.type === 'pull' ? 'Pulled over the network' : 'Pushes to the server'}</div></Td>
                  <Td className="text-[13px]">
                    {d.publicHost ? <span className="num">{d.publicHost}:{d.publicPort || 4370}</span> : <span className="text-ink-soft">{d.type === 'pull' ? 'No public host: not synced' : 'Not applicable'}</span>}
                    {d.ip && <div className="num text-[12px] text-ink-soft">LAN {d.ip}:{d.port}</div>}
                  </Td>
                  <Td>
                    <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${ok ? 'text-present' : 'text-absent'}`}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />{ok ? 'Syncing' : 'Failed'}
                    </span>
                    {d.lastPullError && !ok && <div className="mt-0.5 max-w-[320px] text-[12px] text-ink-soft">{d.lastPullError}</div>}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-soft">{ago(d.lastPullAt)}</Td>
                  <Td align="right">{(counts[d.id] || 0).toLocaleString()}</Td>
                  <Td align="right">{d.lastLogCount ? d.lastLogCount.toLocaleString() : ''}</Td>
                  <Td align="right">{held ? <Link className="text-absent underline" href={`/devices/held?deviceId=${d.id}`}>{held}</Link> : ''}</Td>
                  <Td>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {d.type === 'pull' && d.publicHost && (
                        <form action={pullNow} className="flex items-center gap-2">
                          <input type="hidden" name="id" value={d.id} />
                          <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-soft"><input type="checkbox" name="full" className="h-3.5 w-3.5 accent-[oklch(0.46_0.15_258)]" />Read everything</label>
                          <SubmitButton pendingLabel="Reading">Read now</SubmitButton>
                        </form>
                      )}
                      {canEdit && <Link href={`/devices/edit/${d.id}`}><Button type="button">Edit</Button></Link>}
                    </div>
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </TableWrap>
      <p className="mt-4 max-w-[70ch] text-[13px] text-ink-soft">
        <Link className="underline decoration-line-strong hover:text-ink" href="/devices/held">Scans held aside</Link> are ones whose time the device clock got wrong, so they stay out of attendance. They are kept, never deleted.
      </p>
    </>
  )
}
