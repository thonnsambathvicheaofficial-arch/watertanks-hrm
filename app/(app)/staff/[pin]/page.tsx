import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { Button, EmptyState, Field, Flash, Input, PageHeader, Select } from '@/components/ui'
import { decodeEcho, echoOne } from '@/lib/echo'
import { to12h } from '@/lib/utils'
import { profileFromEcho } from '../profileEcho'
import { StaffForm } from '../StaffForm'
import { addAssignment, removeAssignment, updateStaff } from '../actions'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')

export const metadata: Metadata = { title: 'Staff member' }
export const dynamic = 'force-dynamic'

type Shift = { id: string; name: string; start: string; end: string }
type Asg = { id: string; shiftName: string; start: string; end: string; from: string; to: string | null; note: string }

export default async function StaffMemberPage({ params, searchParams }: { params: { pin: string }; searchParams: { error?: string; saved?: string; v?: string } }) {
  const pin = decodeURIComponent(params.pin)
  const ready = await hr.available()
  const [profile, shifts, departments, assignments] = await Promise.all([
    hr.staff.get(pin),
    ready ? hr.shifts.list() : [],
    ready ? hr.departments.list() : [],
    ready ? hr.assignments.list({ pin }) : [],
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
      <StaffForm profile={profile} fallback={fallback} shifts={shifts as Shift[]} departments={departments} ready={ready} action={updateStaff} />

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
          <form action={addAssignment} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr_auto] lg:items-end">
            <input type="hidden" name="pin" value={pin} />
            <Field label="Shift">
              <Select name="shiftId" required defaultValue={ev('shiftId') ?? ''}>
                <option value="" disabled>Choose a shift</option>
                {(shifts as Shift[]).map(s => <option key={s.id} value={s.id}>{s.name} · {to12h(s.start)} to {to12h(s.end)}</option>)}
              </Select>
            </Field>
            <Field label="From"><Input type="date" name="from" defaultValue={ev('from')} required /></Field>
            <Field label="To" hint="Empty = no end date."><Input type="date" name="to" defaultValue={ev('to')} /></Field>
            <Field label="Note"><Input name="note" defaultValue={ev('note')} /></Field>
            <Button type="submit" variant="primary">Add</Button>
          </form>
        </section>
      )}
    </>
  )
}
