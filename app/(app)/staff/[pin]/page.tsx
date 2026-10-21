import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { Button, EmptyState, Field, Flash, Input, PageHeader, Select } from '@/components/ui'
import { decodeEcho, echoOne } from '@/lib/echo'
import { to12h } from '@/lib/utils'
import { profileFromEcho } from '../profileEcho'
import { StaffForm } from '../StaffForm'
import { addAssignment, removeAssignment, renamePin, updateStaff } from '../actions'
import { guard } from '@/lib/guard'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')

export const metadata: Metadata = { title: 'Staff member' }
export const dynamic = 'force-dynamic'

type Shift = { id: string; name: string; start: string; end: string }
type Asg = { id: string; shiftName: string; start: string; end: string; from: string; to: string | null; note: string }

export default async function StaffMemberPage({ params, searchParams }: { params: { pin: string }; searchParams: { error?: string; saved?: string; v?: string } }) {
  const me = await guard()
  const pin = decodeURIComponent(params.pin)
  const ready = await hr.available()
  const ext = await hr.extended()
  const [profile, shifts, departments, assignments, everyone] = await Promise.all([
    hr.staff.get(pin),
    ready ? hr.shifts.list() : [],
    ready ? hr.departments.list() : [],
    ready ? hr.assignments.list({ pin }) : [],
    ext ? hr.staff.list() : [],
  ])
  if (!profile) notFound()
  const echo = decodeEcho(searchParams.v)
  const fallback = echo && echo.name !== undefined ? profileFromEcho(echo, profile) : null
  const ev = (k: string) => echoOne(echo, k)

  return (
    <>
      <PageHeader title={profile.name || `PIN ${pin}`} note={<>PIN <span className="num">{pin}</span></>}>
        <Link href="/staff" className="text-[14px] text-ink-soft underline decoration-line-strong hover:text-ink">All staff</Link>
      </PageHeader>
      <Flash error={searchParams.error} saved={searchParams.saved} />
      {!me.perms.includes('staff.edit') && <ReadOnlyNotice />}
      <StaffForm profile={profile} fallback={fallback} shifts={shifts as Shift[]} departments={departments} managers={(everyone as { pin: string; name: string }[]).map(p => ({ pin: p.pin, name: p.name }))} ready={ready} ext={ext} action={updateStaff} />

      {ready && (
        <section className="mt-12 max-w-[820px] border-t border-line pt-6" aria-labelledby="rot-h">
          <h2 id="rot-h" className="text-[15px] font-semibold">Rotation</h2>
          <p className="mb-4 mt-1 max-w-[62ch] text-[14px] text-ink-soft">
            Put this person on a different shift for a set period, for example a week of nights. Outside these dates they follow their normal shift above. To move a whole team at once, use Rotation in the sidebar.
          </p>
          <TableWrap className="mb-5">
            <Table wide={false}>
              <thead><tr><Th>Shift</Th><Th>From</Th><Th>To</Th><Th>Note</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
              <tbody>
                {assignments.length === 0 && <tr><td colSpan={5}><EmptyState title="No rotation assignments" /></td></tr>}
                {(assignments as Asg[]).map(a => (
                  <tr key={a.id}>
                    <Td className="font-medium">{a.shiftName}<div className="num text-[12px] font-normal text-ink-soft">{to12h(a.start)} to {to12h(a.end)}</div></Td>
                    <Td className="num whitespace-nowrap">{a.from}</Td>
                    <Td className="num whitespace-nowrap">{a.to || <span className="text-ink-soft">Open-ended</span>}</Td>
                    <Td className="text-ink-soft">{a.note}</Td>
                    <Td className="text-right">
                      <form action={removeAssignment}><input type="hidden" name="pin" value={pin} /><input type="hidden" name="id" value={a.id} /><Button type="submit" variant="danger">Remove</Button></form>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
          <form action={addAssignment} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr_auto] items-end">
            <input type="hidden" name="pin" value={pin} />
            <Field label="Shift">
              <Select name="shiftId" required defaultValue={ev('shiftId') ?? ''}>
                <option value="" disabled>Choose a shift</option>
                {(shifts as Shift[]).map(s => <option key={s.id} value={s.id}>{s.name} · {to12h(s.start)} to {to12h(s.end)}</option>)}
              </Select>
            </Field>
            <Field label="From"><Input type="date" name="from" defaultValue={ev('from')} required /></Field>
            <Field label="To (optional)"><Input type="date" name="to" defaultValue={ev('to')} /></Field>
            <Field label="Note"><Input name="note" defaultValue={ev('note')} /></Field>
            <Button type="submit" variant="primary">Add</Button>
          </form>
        </section>
      )}

      <section className="mt-12 max-w-[820px] border-t border-line pt-6" aria-labelledby="pin-h">
        <h2 id="pin-h" className="text-[15px] font-semibold">Change PIN</h2>
        <p className="mb-4 mt-1 max-w-[62ch] text-[14px] text-ink-soft">
          For a PIN that was typed wrongly. Scans, corrections, rotation, leave and payroll setup move to the new PIN together. The fingerprint device itself is not changed, so it may keep scanning this person under the old PIN. Keeping the old PIN listed under Other PINs makes those scans still count.
        </p>
        <form action={renamePin} className="grid items-end gap-4 sm:grid-cols-[minmax(0,220px)_1fr_auto]">
          <input type="hidden" name="pin" value={pin} />
          <Field label="New PIN"><Input name="newPin" defaultValue={ev('newPin')} autoComplete="off" required /></Field>
          <label className="flex cursor-pointer items-center gap-2 pb-2 text-[14px]"><input type="checkbox" name="keepOld" defaultChecked className="h-4 w-4 accent-[oklch(0.46_0.15_258)]" />Keep {pin} under Other PINs</label>
          <Button type="submit">Change PIN</Button>
        </form>
      </section>
    </>
  )
}
