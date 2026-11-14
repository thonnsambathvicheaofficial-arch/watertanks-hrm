import type { Metadata } from 'next'
import Link from 'next/link'
import { Flash, PageHeader } from '@/components/ui'
import { decodeEcho } from '@/lib/echo'
import { profileFromEcho } from '../profileEcho'
import { blankProfile, StaffForm } from '../StaffForm'
import { createStaff } from '../actions'
import { guard } from '@/lib/guard'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')

export const metadata: Metadata = { title: 'Add staff' }
export const dynamic = 'force-dynamic'

export default async function NewStaffPage({ searchParams }: { searchParams: { error?: string; v?: string; pin?: string; name?: string; from?: string } }) {
  await guard()
  const ready = await hr.available()
  const [shifts, departments, ext, photos, idCards, idOriginals] = await Promise.all([ready ? hr.shifts.list() : [], ready ? hr.departments.list() : [], hr.extended(), hr.photos(), hr.idCards(), hr.idOriginals()])
  // "Add staff from ID" needs the fuller profile (migration 005) for the Khmer name, gender, birth date, ID number and address, and the ID card store (011).
  const fromId = searchParams.from === 'id' && ext && idCards
  const managers = ext ? (await hr.staff.list()).map((p: { pin: string; name: string }) => ({ pin: p.pin, name: p.name })) : []
  return (
    <>
      <PageHeader title={fromId ? 'Add staff from ID' : 'Add staff member'} note={fromId ? 'Read the national ID card, check what was filled in, then add the person. Their scans start counting as soon as the PIN matches a fingerprint ID.' : 'Their scans start counting as soon as the PIN matches a fingerprint ID.'}>
        <Link href="/staff" className="text-[14px] text-ink-soft underline decoration-line-strong hover:text-ink">All staff</Link>
      </PageHeader>
      <Flash error={searchParams.error} />
      <StaffForm profile={null} fallback={profileFromEcho(decodeEcho(searchParams.v), null) ?? (searchParams.pin ? blankProfile({ pin: searchParams.pin.slice(0, 32), name: (searchParams.name || '').slice(0, 120) }) : null)} shifts={shifts} departments={departments} managers={managers} ready={ready} ext={ext} photos={photos} idReader={fromId} idOriginals={idOriginals} action={createStaff} />
    </>
  )
}
