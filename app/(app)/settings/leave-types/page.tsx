import type { Metadata } from 'next'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Button, EmptyState, Flash, Input, MigrationNotice, PageHeader } from '@/components/ui'
import { decodeEcho, echoOne } from '@/lib/echo'
import { addLeaveType, deleteLeaveType, updateLeaveType } from './actions'
import { guard } from '@/lib/guard'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lv = require('@/lib/leave-store')

export const metadata: Metadata = { title: 'Leave types' }
export const dynamic = 'force-dynamic'

type T = { id: string; code: string; name: string; isPaid: boolean; defaultDays: number | null; isActive: boolean }

const check = 'h-4 w-4 accent-[oklch(0.46_0.15_258)]'
// Header and rows share one column template so every label sits over its field.
const lg = 'lg:grid lg:grid-cols-[84px_minmax(180px,1fr)_72px_150px_80px_72px_88px] lg:items-center'

export default async function LeaveTypesPage({ searchParams }: { searchParams: { error?: string; saved?: string; v?: string } }) {
  const me = await guard()
  const ready = await lv.ready()
  const types: T[] = ready ? await lv.types.list() : []
  const echo = decodeEcho(searchParams.v)
  return (
    <>
      <PageHeader title="Leave types" note="The kinds of leave HR can record. Default days is the yearly allowance used by Fill from defaults on the Entitlements page. Leave it empty if a type has no fixed allowance." />
      <Flash error={searchParams.error} saved={searchParams.saved} />
      {!me.perms.includes('setup.edit') && <ReadOnlyNotice />}
      {!ready ? <MigrationNotice file="002_leave_holidays_roster.sql" /> : (
        <>
          <div className="mb-8 overflow-x-auto rounded-md border border-line bg-raised">
            <div className="lg:min-w-[760px]">
              <div className={`hidden gap-3 px-3 ${lg} border-b border-line bg-paper py-2.5 text-[12px] font-medium text-ink-soft`}>
                <span>Code</span><span>Name</span><span>Paid</span><span>Default days</span><span>Active</span><span /><span />
              </div>
              {types.length === 0 && <EmptyState title="No leave types" />}
              {types.map(t => (
                <div key={t.id} className={`grid gap-3 px-3 ${lg} border-b border-line py-3 last:border-b-0 lg:gap-3 lg:py-2.5`}>
                  <form id={`u-${t.id}`} action={updateLeaveType} className="hidden"><input type="hidden" name="id" value={t.id} /></form>
                  <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-3 lg:contents">
                    <div><span className="mb-1 block text-[12px] text-ink-soft lg:hidden">Code</span><Input form={`u-${t.id}`} name="code" defaultValue={t.code} aria-label={`Code for ${t.name}`} maxLength={6} required /></div>
                    <div><span className="mb-1 block text-[12px] text-ink-soft lg:hidden">Name</span><Input form={`u-${t.id}`} name="name" defaultValue={t.name} aria-label="Name" required /></div>
                  </div>
                  <div className="flex flex-wrap items-end gap-x-5 gap-y-3 lg:contents">
                    <label className="flex min-h-11 items-center gap-2 text-[13px] lg:min-h-0"><input form={`u-${t.id}`} type="checkbox" name="isPaid" defaultChecked={t.isPaid} className={check} /> Paid</label>
                    <div className="w-36 lg:w-auto"><span className="mb-1 block text-[12px] text-ink-soft lg:hidden">Default days</span><Input form={`u-${t.id}`} name="defaultDays" type="number" step="0.5" min={0} defaultValue={t.defaultDays ?? ''} placeholder="Not set" aria-label={`Default days for ${t.name}`} /></div>
                    <label className="flex min-h-11 items-center gap-2 text-[13px] lg:min-h-0"><input form={`u-${t.id}`} type="checkbox" name="isActive" defaultChecked={t.isActive} className={check} /> On</label>
                  </div>
                  <div className="flex items-center gap-2 lg:contents">
                    <Button form={`u-${t.id}`} type="submit">Save</Button>
                    <form action={deleteLeaveType}><input type="hidden" name="id" value={t.id} /><ConfirmButton variant="danger" message={`Delete the leave type "${t.name}"? This only works if no leave has been recorded with it.`}>Delete</ConfirmButton></form>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <section aria-labelledby="add-h" className="max-w-[820px]">
            <h2 id="add-h" className="mb-3 text-[15px] font-semibold">Add a leave type</h2>
            <form action={addLeaveType} className="grid items-end gap-3 sm:grid-cols-[90px_minmax(160px,1fr)_150px_auto_auto]">
              <label className="block"><span className="mb-1.5 block text-[13px] font-medium">Code</span><Input name="code" maxLength={6} defaultValue={echoOne(echo, 'code')} placeholder="EL" required /></label>
              <label className="block"><span className="mb-1.5 block text-[13px] font-medium">Name</span><Input name="name" defaultValue={echoOne(echo, 'name')} placeholder="Emergency leave" required /></label>
              <label className="block"><span className="mb-1.5 block text-[13px] font-medium">Default days</span><Input name="defaultDays" type="number" step="0.5" min={0} defaultValue={echoOne(echo, 'defaultDays')} placeholder="Not set" /></label>
              <label className="flex h-9 items-center gap-2 text-[13px]"><input type="checkbox" name="isPaid" defaultChecked className={check} /> Paid</label>
              <input type="hidden" name="isActive" value="on" />
              <Button type="submit" variant="primary">Add</Button>
            </form>
          </section>
        </>
      )}
    </>
  )
}
