import type { Metadata } from 'next'
import { Button, Field, Flash, Input, PageHeader } from '@/components/ui'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
import { decodeEcho, echoOne } from '@/lib/echo'
import { guard } from '@/lib/guard'
import { saveWorkHours } from './actions'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const store = require('@/lib/store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')

export const metadata: Metadata = { title: 'Default work hours' }
export const dynamic = 'force-dynamic'

export default async function WorkHoursPage({ searchParams }: { searchParams: { error?: string; saved?: string; v?: string } }) {
  const me = await guard()
  const [s, staff] = await Promise.all([store.settings.get(), hr.staff.list()])
  const onDefaults = (staff as { shiftId: string; timeIn: string; resignedDate: string }[]).filter(p => !p.shiftId && !p.timeIn && !p.resignedDate).length
  const e = decodeEcho(searchParams.v)
  return (
    <>
      <PageHeader title="Default work hours" note="Used only for staff who have neither a shift nor their own start and end times. Everyone else follows their shift or their own times." />
      <Flash error={searchParams.error} saved={searchParams.saved} />
      {!me.perms.includes('setup.edit') && <ReadOnlyNotice />}
      <form action={saveWorkHours} className="max-w-[560px] space-y-5">
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Work starts" hint="Late after this plus grace."><Input name="workStart" defaultValue={echoOne(e, 'workStart') ?? String(s.workStart).slice(0, 5)} placeholder="08:00" required /></Field>
          <Field label="Work ends" hint="Early leave before this."><Input name="workEnd" defaultValue={echoOne(e, 'workEnd') ?? String(s.workEnd).slice(0, 5)} placeholder="17:30" required /></Field>
          <Field label="Grace minutes"><Input name="graceMinutes" type="number" min={0} max={120} defaultValue={echoOne(e, 'graceMinutes') ?? s.graceMinutes} required /></Field>
        </div>
        <p className="max-w-[60ch] text-[14px] text-ink-soft">
          {onDefaults === 0 ? 'Every current staff member has a shift or their own times, so these defaults apply to no one right now.' : `${onDefaults} current staff member${onDefaults === 1 ? ' has' : 's have'} no shift or own times and follow these defaults. Changing them changes who counts as late for those people, in every report, past and future.`}
        </p>
        <Button type="submit" variant="primary">Save</Button>
      </form>
    </>
  )
}
