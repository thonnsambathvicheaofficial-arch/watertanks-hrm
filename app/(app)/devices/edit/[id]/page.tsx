import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Flash, PageHeader } from '@/components/ui'
import { decodeEcho, echoOne } from '@/lib/echo'
import { guard } from '@/lib/guard'
import { removeDevice, updateDevice } from '../../actions'
import { DeviceForm } from '../../DeviceForm'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { devices } = require('@/lib/device-admin')

export const metadata: Metadata = { title: 'Device' }
export const dynamic = 'force-dynamic'

export default async function EditDevicePage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; saved?: string; v?: string } }) {
  await guard()
  const d = await devices.get(params.id)
  if (!d) notFound()
  const e = decodeEcho(searchParams.v)
  const g = (k: string, fb: unknown) => echoOne(e, k) ?? fb
  return (
    <>
      <PageHeader title={d.name} note="Devices are only ever read from. Nothing here writes to or clears a device.">
        <Link href="/devices" className="text-[14px] text-ink-soft underline decoration-line-strong hover:text-ink">All devices</Link>
      </PageHeader>
      <Flash error={searchParams.error} saved={searchParams.saved} />
      <DeviceForm action={updateDevice} submit="Save device" v={{ id: d.id, name: g('name', d.name) as string, type: g('type', d.type) as string, ip: g('ip', d.ip) as string, port: g('port', d.port) as string, serial: g('serial', d.serial) as string, publicHost: g('publicHost', d.publicHost) as string, publicPort: g('publicPort', d.publicPort) as string }} />
      <form action={removeDevice} className="mt-10 max-w-[720px] border-t border-line pt-5">
        <input type="hidden" name="id" value={d.id} />
        <p className="mb-3 text-[14px] text-ink-soft">A device can only be removed while it has no scans stored. One with history cannot be removed, so no attendance is ever detached from it.</p>
        <ConfirmButton variant="danger" message={`Remove the device "${d.name}"?`}>Remove device</ConfirmButton>
      </form>
    </>
  )
}
