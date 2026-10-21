import type { Metadata } from 'next'
import Link from 'next/link'
import { Flash, PageHeader } from '@/components/ui'
import { decodeEcho, echoOne } from '@/lib/echo'
import { guard } from '@/lib/guard'
import { addDevice } from '../actions'
import { DeviceForm } from '../DeviceForm'

export const metadata: Metadata = { title: 'Add device' }
export const dynamic = 'force-dynamic'

export default async function NewDevicePage({ searchParams }: { searchParams: { error?: string; v?: string } }) {
  await guard()
  const e = decodeEcho(searchParams.v)
  const g = (k: string) => echoOne(e, k)
  return (
    <>
      <PageHeader title="Add device" note="Devices are only ever read from. Nothing here writes to or clears a device.">
        <Link href="/devices" className="text-[14px] text-ink-soft underline decoration-line-strong hover:text-ink">All devices</Link>
      </PageHeader>
      <Flash error={searchParams.error} />
      <DeviceForm action={addDevice} submit="Add device" v={{ name: g('name'), type: g('type'), ip: g('ip'), port: g('port'), serial: g('serial'), publicHost: g('publicHost'), publicPort: g('publicPort') }} />
    </>
  )
}
