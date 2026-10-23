import type { Metadata } from 'next'
import { Download } from 'lucide-react'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { Button, EmptyState, Field, Input, PageHeader, StatusBadge } from '@/components/ui'
import { dayName, to12h } from '@/lib/utils'
import { guard } from '@/lib/guard'
import { DepartmentSelect, GroupSelect, type Dept } from '@/components/StaffFilters'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { reportData, todayStr, monthStartStr } = require('@/lib/report-data')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const store = require('@/lib/store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { glabel } = require('@/lib/exports')

export const metadata: Metadata = { title: 'Reports' }
export const dynamic = 'force-dynamic'

type SP = { from?: string; to?: string; pin?: string; group?: string; department?: string; deviceId?: string; view?: string }
type Daily = { date: string; pin: string; name: string; group: string | null; status: string; in: string | null; out: string | null; hours: number; punches: number; minutesLate: number; earlyLeave: boolean; note?: string; rosterNote?: string; leaveReason?: string }
type Punch = { pin: string; time: string; deviceId?: string | null; source?: string | null; verify?: number | null }
type Summary = { pin: string; name: string; group: string | null; days: number; hours: number; late: number; minLate: number; early: number; absent: number; dayOff: number; leave: number; excused: number }

const select = 'h-9 w-full rounded border border-line-strong bg-raised px-3 text-[14px] text-ink hover:border-ink-faint focus-visible:border-brand'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { normalizeRange } = require('@/lib/validate')

export default async function ReportsPage({ searchParams }: { searchParams: SP }) {
  await guard()
  const { from, to, note: rangeNote } = normalizeRange(searchParams.from, searchParams.to, { from: monthStartStr(), to: todayStr() })
  const view = searchParams.view === 'summary' ? 'summary' : searchParams.view === 'punches' ? 'punches' : 'daily'
  const q = { from, to, pin: searchParams.pin || '', group: searchParams.group || '', department: searchParams.department || '', deviceId: searchParams.deviceId || '' }

  const ready = await hr.available()
  const [{ daily, summary, punches, names, employees }, devices, depts]: [any, any, Dept[]] = await Promise.all([reportData(q), store.devices.list(), ready ? hr.departments.list() : []])  // eslint-disable-line @typescript-eslint/no-explicit-any
  const deptName: Record<string, string> = Object.fromEntries(depts.map(d => [d.id, d.name]))
  const deptOf = (pin: string) => deptName[employees[pin]?.departmentId] || ''
  const showDept = depts.length > 0
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString()
  const exportHref = (kind: string, extra = '') => `/api/export/${kind}?${qs}${extra}`
  const count = view === 'summary' ? summary.length : view === 'punches' ? punches.length : daily.length

  return (
    <>
      <PageHeader title="Reports" note={`${from} to ${to} · ${count} ${view === 'summary' ? 'staff' : view === 'punches' ? 'scans' : 'rows'}${rangeNote ? ` · ${rangeNote}` : ''}`}>
        <a href={exportHref(view)}><Button><Download size={16} aria-hidden /> Export Excel</Button></a>
        {view === 'daily' && <a href={exportHref('daily', '&allPunches=1')}><Button><Download size={16} aria-hidden /> With every punch</Button></a>}
      </PageHeader>

      <form method="get" className="mb-5 grid grid-cols-2 items-end gap-3 rounded-md border border-line bg-raised p-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-[repeat(7,minmax(0,1fr))_auto]">
        <Field label="From"><Input type="date" name="from" defaultValue={from} /></Field>
        <Field label="To"><Input type="date" name="to" defaultValue={to} /></Field>
        <Field label="Device">
          <select name="deviceId" defaultValue={q.deviceId} className={select}>
            <option value="">All devices</option>
            {devices.map((d: { id: string; name: string }) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Group"><GroupSelect value={q.group} allLabel="Everyone" /></Field>
        {showDept && <Field label="Department"><DepartmentSelect value={q.department} departments={depts} /></Field>}
        <Field label="PIN"><Input name="pin" defaultValue={q.pin} placeholder="All" inputMode="numeric" /></Field>
        <Field label="View">
          <select name="view" defaultValue={view} className={select}><option value="daily">Daily attendance</option><option value="summary">Summary</option><option value="punches">Raw scans</option></select>
        </Field>
        <Button type="submit" variant="primary" className="col-span-2 sm:col-span-1">Run report</Button>
      </form>

      {view === 'daily' ? <DailyTable rows={daily as Daily[]} deptOf={showDept ? deptOf : null} /> : view === 'summary' ? <SummaryTable rows={summary as Summary[]} deptOf={showDept ? deptOf : null} /> : <PunchTable rows={punches as Punch[]} names={names} devices={devices} />}
    </>
  )
}

type DeptOf = ((pin: string) => string) | null

function DailyTable({ rows, deptOf }: { rows: Daily[]; deptOf: DeptOf }) {
  return (
    <TableWrap>
      <Table>
        <thead>
          <tr><Th>Date</Th><Th>PIN</Th><Th>Name</Th><Th>Group</Th>{deptOf && <Th>Department</Th>}<Th>Status</Th><Th>In</Th><Th>Out</Th><Th align="right">Hours</Th><Th align="right">Punches</Th><Th align="right">Min late</Th><Th>Roster note</Th><Th>Leave reason</Th></tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={13}><EmptyState title="No rows for these filters">Widen the date range or clear the PIN, group and department filters.</EmptyState></td></tr>}
          {rows.map(r => (
            <tr key={r.pin + r.date}>
              <Td className="whitespace-nowrap"><span className="num">{r.date}</span> <span className="text-ink-faint">{dayName(r.date).slice(0, 3)}</span></Td>
              <Td className="num text-ink-soft">{r.pin}</Td>
              <Td className="font-medium">{r.name || '—'}</Td>
              <Td className="text-ink-soft">{glabel(r.group)}</Td>
              {deptOf && <Td className="text-ink-soft">{deptOf(r.pin)}</Td>}
              <Td><StatusBadge status={r.status} /></Td>
              <Td className="num whitespace-nowrap">{to12h(r.in)}</Td>
              <Td className="num whitespace-nowrap">{to12h(r.out)}</Td>
              <Td align="right">{r.hours || ''}</Td>
              <Td align="right">{r.punches || ''}</Td>
              <Td align="right">{r.minutesLate || ''}</Td>
              <Td className="min-w-[140px] max-w-[280px] text-ink-soft">{r.rosterNote}</Td>
              <Td className="min-w-[140px] max-w-[280px] text-ink-soft">{r.leaveReason}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  )
}

function SummaryTable({ rows, deptOf }: { rows: Summary[]; deptOf: DeptOf }) {
  return (
    <TableWrap>
      <Table>
        <thead>
          <tr><Th>PIN</Th><Th>Name</Th><Th>Group</Th>{deptOf && <Th>Department</Th>}<Th align="right">Days</Th><Th align="right">Hours</Th><Th align="right">Late days</Th><Th align="right">Min late</Th><Th align="right">Early</Th><Th align="right">Absent</Th><Th align="right">Day off</Th><Th align="right">Leave</Th><Th align="right">Excused</Th></tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={13}><EmptyState title="No staff match these filters" /></td></tr>}
          {rows.map(r => (
            <tr key={r.pin}>
              <Td className="num text-ink-soft">{r.pin}</Td><Td className="font-medium">{r.name || '—'}</Td><Td className="text-ink-soft">{glabel(r.group)}</Td>
              {deptOf && <Td className="text-ink-soft">{deptOf(r.pin)}</Td>}
              <Td align="right">{r.days}</Td><Td align="right">{r.hours}</Td><Td align="right">{r.late || ''}</Td><Td align="right">{r.minLate || ''}</Td>
              <Td align="right">{r.early || ''}</Td><Td align="right">{r.absent || ''}</Td><Td align="right">{r.dayOff || ''}</Td><Td align="right">{r.leave || ''}</Td><Td align="right">{r.excused || ''}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  )
}

const PUNCH_LIMIT = 1000

function PunchTable({ rows, names, devices }: { rows: Punch[]; names: Record<string, string>; devices: { id: string; name: string }[] }) {
  const dev = Object.fromEntries(devices.map(d => [d.id, d.name]))
  const shown = [...rows].sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0)).slice(0, PUNCH_LIMIT)
  return (
    <>
      <TableWrap>
        <Table wide={false}>
          <thead><tr><Th>Date</Th><Th>Time</Th><Th>PIN</Th><Th>Name</Th><Th>Device</Th><Th>Verify code</Th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={6}><EmptyState title="No scans for these filters">Widen the date range or clear the PIN and device filters.</EmptyState></td></tr>}
            {shown.map((r, i) => (
              <tr key={r.pin + r.time + i}>
                <Td className="whitespace-nowrap"><span className="num">{r.time.slice(0, 10)}</span> <span className="text-ink-faint">{dayName(r.time.slice(0, 10)).slice(0, 3)}</span></Td>
                <Td className="num whitespace-nowrap">{to12h(r.time.slice(11, 19))}</Td>
                <Td className="num text-ink-soft">{r.pin}</Td>
                <Td className="font-medium">{names[r.pin] || '—'}</Td>
                <Td className="text-ink-soft">{(r.deviceId && dev[r.deviceId]) || ''}</Td>
                <Td className="text-ink-soft">{r.verify ?? ''}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
      {rows.length > PUNCH_LIMIT && <p className="mt-3 text-[13px] text-ink-soft">Showing the newest {PUNCH_LIMIT.toLocaleString()} of {rows.length.toLocaleString()} scans. The Excel export has all of them.</p>}
    </>
  )
}
