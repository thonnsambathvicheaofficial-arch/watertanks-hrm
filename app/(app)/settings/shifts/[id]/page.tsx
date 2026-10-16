import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button, Field, Flash, Input, MigrationNotice, PageHeader, WeekdayChecks } from '@/components/ui'
import { ConfirmButton } from '@/components/ConfirmButton'
import { decodeEcho, echoAll, echoOne } from '@/lib/echo'
import { createShift, deleteShift, updateShift } from '../actions'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')

export const metadata: Metadata = { title: 'Shift' }
export const dynamic = 'force-dynamic'

type Shift = { id: string; name: string; start: string; end: string; graceMinutes: number | null; offDays: number[]; overnight: boolean }

// One page for both "new" (id = "new") and editing an existing shift.
export default async function ShiftPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; saved?: string; v?: string } }) {
  if (!(await hr.available())) return <><PageHeader title="Shift" /><MigrationNotice /></>
  const isNew = params.id === 'new'
  const shift: Shift | null = isNew ? null : await hr.shifts.get(params.id).catch(() => null)
  if (!isNew && !shift) notFound()
  // After a rejected save the form comes back with what was typed.
  const echo = decodeEcho(searchParams.v)
  const val = (k: string, fallback: string | number | null | undefined) => echoOne(echo, k) ?? (fallback ?? '')
  const offDays = echo ? echoAll(echo, 'offDays').map(Number) : (shift?.offDays ?? [0])

  return (
    <>
      <PageHeader title={isNew ? 'New shift' : shift!.name} note={isNew ? 'Set the hours people scan in and out.' : 'Changing the hours updates every staff member on this shift.'} />
      <Flash error={searchParams.error} saved={searchParams.saved} />
      <form action={isNew ? createShift : updateShift} className="max-w-[560px] space-y-5">
        {!isNew && <input type="hidden" name="id" value={shift!.id} />}
        <Field label="Name"><Input name="name" defaultValue={val('name', shift?.name)} placeholder="Day, Night, Driver" required /></Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Starts"><Input type="time" name="start" defaultValue={val('start', shift?.start)} required /></Field>
          <Field label="Ends" hint="An end earlier than the start means the shift runs past midnight."><Input type="time" name="end" defaultValue={val('end', shift?.end)} required /></Field>
        </div>
        <Field label="Grace minutes" hint="Late is counted after this many minutes. Leave empty to use the company default."><Input type="number" name="graceMinutes" min={0} max={120} defaultValue={val('graceMinutes', shift?.graceMinutes)} className="max-w-[140px]" /></Field>
        <div>
          <span id="off-label" className="mb-1.5 block text-[13px] font-medium">Default weekly days off</span>
          <WeekdayChecks selected={offDays} labelledBy="off-label" />
          <p className="mt-1 max-w-[52ch] text-[12px] text-ink-soft">New staff on this shift start with these days off, and rotation periods on this shift use them. Each person&apos;s own days off are set on their record and are never changed by editing a shift.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button type="submit" variant="primary">{isNew ? 'Create shift' : 'Save shift'}</Button>
          <Link href="/settings/shifts" className="text-[14px] text-ink-soft underline decoration-line-strong hover:text-ink">Back to shifts</Link>
        </div>
      </form>

      {!isNew && (
        <form action={deleteShift} className="mt-10 max-w-[560px] border-t border-line pt-5">
          <input type="hidden" name="id" value={shift!.id} />
          <p className="mb-3 text-[14px] text-ink-soft">Deleting a shift keeps each person's current times. They just stop being linked to it. A shift with rotation assignments cannot be deleted.</p>
          <ConfirmButton variant="danger" message={`Delete the shift "${shift!.name}"? Staff keep their current times.`}>Delete shift</ConfirmButton>
        </form>
      )}
    </>
  )
}
