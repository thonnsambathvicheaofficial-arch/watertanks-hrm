import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { Button, Flash, PageHeader, Select } from '@/components/ui'
import { cn } from '@/lib/utils'
import { LEGEND, cellStyle, type Cell } from '@/lib/roster-codes'
import { guard } from '@/lib/guard'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildRoster } = require('@/lib/roster')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')

export const metadata: Metadata = { title: 'Roster' }
export const dynamic = 'force-dynamic'

type SP = { month?: string; group?: string; department?: string; view?: string; error?: string; saved?: string }
type Day = { d: number; date: string; wd: string; sunday: boolean; holiday: string | null }
type Row = { pin: string; name: string; group: string | null; cells: Record<number, Cell>; t: { days: number; hours: number; late: number; absent: number; leave: number } }

const pad = (n: number) => String(n).padStart(2, '0')
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` }
const shiftMonth = (m: string, n: number) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` }
const monthLabel = (m: string) => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

export default async function RosterPage({ searchParams }: { searchParams: SP }) {
  const me = await guard()
  const month = /^\d{4}-\d{2}$/.test(searchParams.month || '') ? searchParams.month! : thisMonth()
  const view = searchParams.view === 'hours' ? 'hours' : 'status'
  const group = searchParams.group || '', department = searchParams.department || ''
  const ready = await hr.available()
  const [roster, depts] = await Promise.all([buildRoster({ month, group, departmentId: department }), ready ? hr.departments.list() : []])
  const days: Day[] = roster.days, rows: Row[] = roster.rows

  const href = (over: Partial<SP>) => {
    const p = new URLSearchParams(Object.entries({ month, group, department, view, ...over }).filter(([, v]) => v) as [string, string][])
    return `/roster?${p.toString()}`
  }
  const exportQs = new URLSearchParams(Object.entries({ month, group }).filter(([, v]) => v) as [string, string][]).toString()

  return (
    <>
      <PageHeader title="Roster" note={`${monthLabel(month)} · ${rows.length} staff. Select a day to correct it.`}>
        <a href={`/api/export/timesheet?${exportQs}`}><Button><Download size={16} aria-hidden /> Export Excel</Button></a>
      </PageHeader>
      <Flash error={searchParams.error} saved={searchParams.saved} />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-1">
          <Link href={href({ month: shiftMonth(month, -1) })} aria-label="Previous month" className="inline-flex h-9 w-9 items-center justify-center rounded border border-line-strong bg-raised text-ink-soft transition-colors hover:bg-brand-wash"><ChevronLeft size={18} /></Link>
          <span className="num min-w-[150px] px-2 text-center text-[15px] font-semibold">{monthLabel(month)}</span>
          <Link href={href({ month: shiftMonth(month, 1) })} aria-label="Next month" className="inline-flex h-9 w-9 items-center justify-center rounded border border-line-strong bg-raised text-ink-soft transition-colors hover:bg-brand-wash"><ChevronRight size={18} /></Link>
        </div>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="month" value={month} />
          <input type="hidden" name="view" value={view} />
          <div className="w-[150px]"><Select name="group" defaultValue={group} aria-label="Group"><option value="">Everyone</option><option value="office">Office staff</option><option value="worker">Workers</option></Select></div>
          {ready && depts.length > 0 && <div className="w-[170px]"><Select name="department" defaultValue={department} aria-label="Department"><option value="">All departments</option>{depts.map((d: { id: string; name: string }) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>}
          <Button type="submit">Filter</Button>
        </form>
        <div className="ml-auto inline-flex rounded border border-line-strong bg-raised p-0.5 text-[13px]" role="group" aria-label="Cell content">
          {(['status', 'hours'] as const).map(v => (
            <Link key={v} href={href({ view: v })} aria-current={view === v ? 'true' : undefined} className={cn('rounded-sm px-3 py-1.5 font-medium transition-colors', view === v ? 'bg-brand text-white' : 'text-ink-soft hover:bg-brand-wash')}>{v === 'status' ? 'Status' : 'Hours'}</Link>
          ))}
        </div>
      </div>

      <div className="max-h-[calc(100vh-260px)] overflow-auto rounded-md border border-line bg-raised">
        <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 top-0 z-30 min-w-[190px] border-b border-r border-line bg-paper px-3 py-2 text-left text-[12px] font-medium text-ink-soft">Staff</th>
              {days.map(d => (
                <th key={d.d} scope="col" title={d.holiday || undefined} className={cn('sticky top-0 z-20 w-[34px] min-w-[34px] border-b border-line px-0 py-1.5 text-center text-[11px] font-medium', d.holiday ? 'bg-holiday-wash text-holiday' : d.sunday ? 'bg-dayoff-wash text-ink-soft' : 'bg-paper text-ink-soft')}>
                  <div className="num text-[13px] text-ink">{d.d}</div>{d.wd.slice(0, 2)}
                </th>
              ))}
              {['Days', 'Hours', 'Late', 'Absent', 'Leave'].map(h => <th key={h} scope="col" className="sticky top-0 z-20 min-w-[54px] border-b border-l border-line bg-paper px-2 py-2 text-right text-[12px] font-medium text-ink-soft first:border-l-2">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={days.length + 6} className="px-6 py-12 text-center text-ink-soft">No staff for these filters in this month.</td></tr>}
            {rows.map(r => (
              <tr key={r.pin} className="group">
                <th scope="row" className="sticky left-0 z-10 border-b border-r border-line bg-raised px-3 py-1.5 text-left font-normal group-hover:bg-brand-wash">
                  <Link href={`/staff/${encodeURIComponent(r.pin)}`} className="font-medium text-ink hover:underline">{r.name}</Link>
                  <span className="num ml-2 text-[12px] text-ink-faint">{r.pin}</span>
                </th>
                {days.map(d => {
                  const c = r.cells[d.d]
                  if (!c) return <td key={d.d} className="border-b border-line p-0" />
                  const s = cellStyle(c)
                  const label = view === 'hours' && c.hours > 0 ? String(c.hours) : s.code
                  const tip = `${r.name}, ${d.date}: ${c.status.replace('_', ' ')}${c.in ? `, ${c.in} to ${c.out ?? '?'}` : ''}${c.hours ? `, ${c.hours} h` : ''}${c.overridden ? ' (corrected by HR)' : ''}${c.note ? ` · ${c.note}` : ''}`
                  return (
                    <td key={d.d} className="border-b border-line p-[2px]">
                      {me.perms.includes('attendance.edit') ? (
                        <Link href={`/roster/day?pin=${encodeURIComponent(r.pin)}&date=${d.date}&month=${month}`} title={tip} aria-label={tip}
                          className={cn('num relative flex h-7 items-center justify-center rounded-sm text-[12px] font-medium transition-[filter] hover:brightness-95', s.cls, c.overridden && 'ring-1 ring-inset ring-ink/35')}>
                        {label}
                      </Link>
                        ) : (
                        <span title={tip} aria-label={tip} className={cn('num relative flex h-7 items-center justify-center rounded-sm text-[12px] font-medium transition-[filter] hover:brightness-95', s.cls, c.overridden && 'ring-1 ring-inset ring-ink/35')}>{label}</span>
                        )}
                    </td>
                  )
                })}
                <td className="num border-b border-l-2 border-line px-2 text-right">{r.t.days || ''}</td>
                <td className="num border-b border-l border-line px-2 text-right">{r.t.hours || ''}</td>
                <td className="num border-b border-l border-line px-2 text-right">{r.t.late || ''}</td>
                <td className="num border-b border-l border-line px-2 text-right">{r.t.absent || ''}</td>
                <td className="num border-b border-l border-line px-2 text-right">{r.t.leave || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-ink-soft" aria-label="Legend">
        {LEGEND.map(l => <li key={l.code} className="flex items-center gap-2"><span className={cn('inline-flex h-6 min-w-[28px] items-center justify-center rounded-sm px-1 text-[12px] font-medium', l.cls)}>{l.code}</span>{l.label}</li>)}
        <li className="flex items-center gap-2"><span className="inline-flex h-6 w-7 items-center justify-center rounded-sm bg-present-wash text-[12px] font-medium text-present ring-1 ring-inset ring-ink/35">P</span>Corrected by HR</li>
      </ul>
    </>
  )
}
