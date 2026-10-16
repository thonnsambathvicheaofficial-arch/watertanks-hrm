import type { Metadata } from 'next'
import { SelectAll } from '@/components/SelectAll'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { Button, EmptyState, Field, Flash, Input, MigrationNotice, PageHeader, Select } from '@/components/ui'
import { decodeEcho, echoAll, echoOne } from '@/lib/echo'
import { to12h } from '@/lib/utils'
import { assignRotation, removeRotation } from './actions'
import { guard } from '@/lib/guard'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { todayStr } = require('@/lib/report-data')

export const metadata: Metadata = { title: 'Rotation' }
export const dynamic = 'force-dynamic'

type Opt = { id: string; name: string }
type Shift = Opt & { start: string; end: string }
type P = { pin: string; name: string; group: string; departmentId: string; shiftId: string; resignedDate: string }
type Asg = { id: string; pin: string; shiftName: string; start: string; end: string; from: string; to: string | null; note: string }

export default async function RotationPage({ searchParams }: { searchParams: { department?: string; group?: string; error?: string; saved?: string; v?: string } }) {
  const me = await guard()
  const ready = await hr.available()
  if (!ready) return <><PageHeader title="Rotation" /><MigrationNotice /></>

  const [staff, shifts, depts, assignments]: [P[], Shift[], Opt[], Asg[]] = await Promise.all([hr.staff.list(), hr.shifts.list(), hr.departments.list(), hr.assignments.list()])
  const today = todayStr()
  const echo = decodeEcho(searchParams.v)
  const ticked = new Set(echoAll(echo, 'pins'))
  const name = Object.fromEntries(staff.map(p => [p.pin, p.name]))
  const shiftName = Object.fromEntries(shifts.map(s => [s.id, s.name]))
  const dept = searchParams.department || '', group = searchParams.group || ''
  const shown = staff
    .filter(p => !p.resignedDate && (!dept || p.departmentId === dept) && (!group || p.group === group))
    .sort((a, b) => (a.name || a.pin).localeCompare(b.name || b.pin))
  const current = assignments.filter(a => !a.to || a.to >= today).sort((a, b) => (a.from < b.from ? -1 : 1))

  return (
    <>
      <PageHeader title="Rotation" note="Move a team onto another shift for a set period, such as a week of nights. Attendance follows the assigned shift on those dates." />
      <Flash error={searchParams.error} saved={searchParams.saved} />
      {!me.perms.includes('staff.edit') && <ReadOnlyNotice />}

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3" aria-label="Choose who to show">
        <div className="w-[200px]"><Field label="Department"><Select name="department" defaultValue={dept}><option value="">All departments</option>{depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field></div>
        <div className="w-[170px]"><Field label="Group"><Select name="group" defaultValue={group}><option value="">Everyone</option><option value="office">Office staff</option><option value="worker">Workers</option></Select></Field></div>
        <Button type="submit">Show</Button>
      </form>

      <form action={assignRotation} className="mb-10">
        <div className="mb-4 grid gap-4 rounded-md border border-line bg-raised p-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr_auto] lg:items-end">
          <Field label="Shift">
            <Select name="shiftId" required defaultValue={echoOne(echo, 'shiftId') ?? ''}>
              <option value="" disabled>Choose a shift</option>
              {shifts.map(s => <option key={s.id} value={s.id}>{s.name} · {to12h(s.start)} to {to12h(s.end)}</option>)}
            </Select>
          </Field>
          <Field label="From"><Input type="date" name="from" defaultValue={echoOne(echo, 'from') ?? today} required /></Field>
          <Field label="To" hint="Empty = no end date."><Input type="date" name="to" defaultValue={echoOne(echo, 'to')} /></Field>
          <Field label="Note"><Input name="note" placeholder="Optional" defaultValue={echoOne(echo, 'note')} /></Field>
          <Button type="submit" variant="primary">Assign ticked staff</Button>
        </div>

        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold">Staff <span className="num font-normal text-ink-soft">({shown.length} shown)</span></h2>
          <SelectAll name="pins" />
        </div>
        <TableWrap>
          <Table wide={false}>
            <thead><tr><Th><span className="sr-only">Select</span></Th><Th>Name</Th><Th>PIN</Th><Th>Normal shift</Th></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={4}><EmptyState title="No staff match these filters" /></td></tr>}
              {shown.map(p => (
                <tr key={p.pin}>
                  <Td className="w-10"><input type="checkbox" name="pins" value={p.pin} defaultChecked={ticked.has(p.pin)} aria-label={`Select ${p.name || p.pin}`} className="h-4 w-4 accent-[oklch(0.46_0.15_258)]" /></Td>
                  <Td className="font-medium">{p.name || 'Unnamed'}</Td>
                  <Td className="num text-ink-soft">{p.pin}</Td>
                  <Td className="text-ink-soft">{shiftName[p.shiftId] || 'Own hours'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </form>

      <section aria-labelledby="sched-h">
        <h2 id="sched-h" className="mb-2 text-[15px] font-semibold">Current and upcoming assignments</h2>
        <TableWrap>
          <Table wide={false}>
            <thead><tr><Th>Staff</Th><Th>Shift</Th><Th>From</Th><Th>To</Th><Th>Note</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>
              {current.length === 0 && <tr><td colSpan={6}><EmptyState title="No rotation assignments" /></td></tr>}
              {current.map(a => (
                <tr key={a.id}>
                  <Td className="font-medium">{name[a.pin] || a.pin}<span className="num ml-2 text-[12px] font-normal text-ink-soft">{a.pin}</span></Td>
                  <Td>{a.shiftName}<div className="num text-[12px] text-ink-soft">{to12h(a.start)} to {to12h(a.end)}</div></Td>
                  <Td className="num whitespace-nowrap">{a.from}</Td>
                  <Td className="num whitespace-nowrap">{a.to || <span className="text-ink-soft">Open-ended</span>}</Td>
                  <Td className="text-ink-soft">{a.note}</Td>
                  <Td className="text-right"><form action={removeRotation}><input type="hidden" name="id" value={a.id} /><Button type="submit" variant="danger">Remove</Button></form></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </section>
    </>
  )
}
