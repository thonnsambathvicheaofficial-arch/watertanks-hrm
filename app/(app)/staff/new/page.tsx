import type { Metadata } from 'next'
import Link from 'next/link'
import { Flash, PageHeader } from '@/components/ui'
import { decodeEcho } from '@/lib/echo'
import { profileFromEcho } from '../profileEcho'
import { StaffForm } from '../StaffForm'
import { createStaff } from '../actions'
import { guard } from '@/lib/guard'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')

export const metadata: Metadata = { title: 'Add staff' }
export const dynamic = 'force-dynamic'

export default async function NewStaffPage({ searchParams }: { searchParams: { error?: string; v?: string; pin?: string; name?: string } }) {
  await guard()
  const ready = await hr.available()
  const [shifts, departments] = await Promise.all([ready ? hr.shifts.list() : [], ready ? hr.departments.list() : []])
  return (
    <>
      <PageHeader title="Add staff member" note="Their scans start counting as soon as the PIN matches a fingerprint ID.">
        <Link href="/staff" className="text-[14px] text-ink-soft underline decoration-line-strong hover:text-ink">All staff</Link>
      </PageHeader>
      <Flash error={searchParams.error} />
      <StaffForm profile={null} fallback={profileFromEcho(decodeEcho(searchParams.v), null) ?? (searchParams.pin ? { pin: searchParams.pin.slice(0, 32), name: (searchParams.name || '').slice(0, 120), group: '', timeIn: '', timeOut: '', offDays: [], aliases: [], departmentId: '', shiftId: '', position: '', phone: '', joiningDate: '', resignedDate: '' } : null)} shifts={shifts} departments={departments} ready={ready} action={createStaff} />
    </>
  )
}
