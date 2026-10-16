import type { Metadata } from 'next'
import Link from 'next/link'
import { Button, Field, Flash, Input, MigrationNotice, PageHeader, Select } from '@/components/ui'
import { decodeEcho, echoOne } from '@/lib/echo'
import { createLeave } from '../actions'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lv = require('@/lib/leave-store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')

export const metadata: Metadata = { title: 'Record leave' }
export const dynamic = 'force-dynamic'

export default async function NewLeavePage({ searchParams }: { searchParams: { error?: string; v?: string; pin?: string } }) {
  if (!(await lv.ready())) return <><PageHeader title="Record leave" /><MigrationNotice /></>
  const [types, staff] = await Promise.all([lv.types.list({ activeOnly: true }), hr.staff.list()])
  const people = (staff as { pin: string; name: string; resignedDate: string }[]).filter(s => !s.resignedDate).sort((a, b) => (a.name || a.pin).localeCompare(b.name || b.pin))
  const echo = decodeEcho(searchParams.v)
  const v = (k: string, fb = '') => echoOne(echo, k) ?? fb
  return (
    <>
      <PageHeader title="Record leave" note="Days off and public holidays inside the dates are not counted.">
        <Link href="/leave" className="text-[14px] text-ink-soft underline decoration-line-strong hover:text-ink">All leave</Link>
      </PageHeader>
      <Flash error={searchParams.error} />
      <form action={createLeave} className="max-w-[620px] space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Staff member">
            <Select name="pin" required defaultValue={v('pin', searchParams.pin || '')}>
              <option value="" disabled>Choose a person</option>
              {people.map(p => <option key={p.pin} value={p.pin}>{p.name || 'Unnamed'} · {p.pin}</option>)}
            </Select>
          </Field>
          <Field label="Leave type">
            <Select name="typeId" required defaultValue={v('typeId')}>
              <option value="" disabled>Choose a type</option>
              {types.map((t: { id: string; name: string; code: string }) => <option key={t.id} value={t.id}>{t.name} ({t.code})</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="First day"><Input type="date" name="from" defaultValue={v('from')} required /></Field>
          <Field label="Last day" hint="Leave empty for a single day."><Input type="date" name="to" defaultValue={v('to')} /></Field>
        </div>
        <fieldset className="rounded-md border border-line bg-raised p-4">
          <legend className="px-1 text-[13px] font-medium">Half day</legend>
          <div className="grid items-center gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-2.5 text-[14px]"><input type="checkbox" name="halfDay" defaultChecked={v('halfDay') === 'on'} className="h-4 w-4 accent-[oklch(0.46_0.15_258)]" /> Only half of the first day</label>
            <Select name="period" defaultValue={v('period', 'morning')} aria-label="Which half"><option value="morning">Morning off</option><option value="afternoon">Afternoon off</option></Select>
          </div>
          <p className="mt-2 text-[12px] text-ink-soft">A morning request and an afternoon request on the same day can both be recorded. The last day is ignored for a half day.</p>
        </fieldset>
        <Field label="Reason"><Input name="reason" defaultValue={v('reason')} /></Field>
        <Field label="Status" hint="Choose Approved when HR has already agreed. Pending waits in the queue until someone decides.">
          <Select name="status" defaultValue={v('status', 'approved')}><option value="approved">Approved</option><option value="pending">Pending</option></Select>
        </Field>
        <Button type="submit" variant="primary">Record leave</Button>
      </form>
    </>
  )
}
