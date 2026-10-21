import type { Metadata } from 'next'
import Link from 'next/link'
import { LogIn, LogOut } from 'lucide-react'
import type { ReactNode } from 'react'
import { AutoRefresh } from '@/components/AutoRefresh'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { Button, EmptyState, PageHeader } from '@/components/ui'
import { DepartmentSelect, GroupSelect, cleanDepartment, cleanGroup, filterNote, type Dept } from '@/components/StaffFilters'
import { cn, dayName, to12h } from '@/lib/utils'
import { guard } from '@/lib/guard'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { reportData, todayStr } = require('@/lib/report-data')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const store = require('@/lib/store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { summarize, ago } = require('@/lib/live-summary')

export const metadata: Metadata = { title: 'Live' }
export const dynamic = 'force-dynamic'

const REFRESH_SECONDS = 30
const LATEST = 15   // a glance, not the log: the full list is one click away in Reports

type Counts = { expected: number; in: number; onTime: number; late: number; notYet: number; leave: number; dayOff: number; pctIn: number; lateMinutes: number }
type NotIn = { pin: string; name: string; dept: string; start: string | null; overdueMin: number | null }
type LateRow = { pin: string; name: string; dept: string; in: string; minutesLate: number }
type LeaveRow = { pin: string; name: string; dept: string; code: string; days: number | null; note: string }
type DeptRow = { id: string; name: string; onTime: number; late: number; notYet: number; leave: number; total: number; in: number }
type Scan = { id: string; pin: string; time: string; deviceId: string; direction: 'in' | 'out' | 'repeat'; lateMin: number }
type Reader = { id: string; name: string; ageMin: number | null; scansToday: number; state: 'ok' | 'stale' | 'failed'; error: string }
type Unknown = { pin: string; scans: number; last: string }
type Summary = { counts: Counts; notIn: NotIn[]; late: LateRow[]; leave: LeaveRow[]; byDepartment: DeptRow[]; unknown: Unknown[]; recent: Scan[]; readers: Reader[]; lastScan: Scan | null; scansToday: number }

// The clock in Phnom Penh, as minutes since midnight and as a label for "Updated".
function clockNow(now: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Phnom_Penh', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(now).map(x => [x.type, x.value]))
  const h = Number(p.hour) % 24, m = Number(p.minute)
  return { min: h * 60 + m, label: `${h % 12 || 12}:${p.minute}:${p.second} ${h < 12 ? 'AM' : 'PM'}` }
}

export default async function LivePage({ searchParams }: { searchParams: { group?: string; department?: string } }) {
  const me = await guard()
  const today = todayStr()
  const group = cleanGroup(searchParams.group)
  const ready = await hr.available()
  const depts: Dept[] = ready ? await hr.departments.list() : []
  const department = cleanDepartment(searchParams.department, depts)
  const filtered = !!(group || department)

  const [{ daily, punches, employees }, devices] = await Promise.all([reportData({ from: today, to: today, group, department }), store.devices.list()])
  const now = new Date(), clock = clockNow(now)
  const deviceName: Record<string, string> = Object.fromEntries(devices.map((d: { id: string; name: string }) => [d.id, d.name]))
  const s: Summary = summarize({ rows: daily, employees, departments: depts, punches, devices, nowMin: clock.min, nowMs: now.getTime(), latest: LATEST })
  const c = s.counts
  const deptName: Record<string, string> = Object.fromEntries(depts.map(d => [d.id, d.name]))
  const deptOf = (pin: string) => deptName[employees[pin]?.departmentId] || ''
  const scope = filterNote(group, department, depts)
  const lastScanAgo = s.lastScan ? ago(Math.max(0, Math.round((now.getTime() - Date.parse(`${s.lastScan.time.replace(' ', 'T')}+07:00`)) / 60000))) : ''
  const canFixPins = me.perms.includes('staff.edit')

  const segments = [
    { key: 'onTime', label: 'On time', n: c.onTime, bar: 'bg-present', dot: 'bg-present' },
    { key: 'late', label: 'Late', n: c.late, bar: 'bg-late', dot: 'bg-late' },
    { key: 'notYet', label: 'Not scanned yet', n: c.notYet, bar: 'bg-absent', dot: 'bg-absent' },
    { key: 'leave', label: 'On leave', n: c.leave, bar: 'bg-leave', dot: 'bg-leave' },
  ]
  const barTotal = segments.reduce((n, x) => n + x.n, 0)

  return (
    <>
      <AutoRefresh seconds={REFRESH_SECONDS} />
      <PageHeader title="Live" note={`${dayName(today)}, ${today}${scope ? ` · ${scope}` : ''}`} />

      <form method="get" className="mb-5 flex flex-wrap items-end gap-3">
        <div className="w-[160px]"><GroupSelect value={group} /></div>
        <div className="w-[190px]"><DepartmentSelect value={department} departments={depts} /></div>
        <Button type="submit">Filter</Button>
        {filtered && <Link href="/" className="touch-target text-[13px] text-ink-soft underline-offset-2 hover:text-ink hover:underline">Clear</Link>}
      </form>

      {/* Today at a glance: one sentence, one bar, one legend. The bar is the data, not a decoration. */}
      <section aria-labelledby="today-h" className="mb-6 rounded-md border border-line bg-raised px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 id="today-h" className="text-[15px] font-semibold">
            <span className="num">{c.in}</span> of <span className="num">{c.expected}</span> expected have <span className="whitespace-nowrap">scanned in
            {c.expected > 0 && <span className="num ml-2 font-normal text-ink-soft">{c.pctIn}%</span>}</span>
          </h2>
          <p className="text-[13px] text-ink-soft">
            {s.lastScan ? <>Last scan <span className="num text-ink">{to12h(s.lastScan.time.slice(11, 16))}</span>{lastScanAgo && ` · ${lastScanAgo}`}</> : 'No scans yet today'}
          </p>
        </div>

        <div role="img" aria-label={`${segments.map(x => `${x.n} ${x.label.toLowerCase()}`).join(', ')}`} className="mt-3 flex h-3 gap-px overflow-hidden rounded-sm bg-line">
          {barTotal === 0 ? <div className="flex-1 bg-dayoff-wash" /> : segments.filter(x => x.n > 0).map(x => <div key={x.key} className={x.bar} style={{ flex: `${x.n} 1 0%` }} title={`${x.label}: ${x.n}`} />)}
        </div>

        <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-[13px]">
          {segments.filter(x => x.n > 0 || x.key !== 'leave').map(x => (
            <li key={x.key} className="flex items-center gap-2"><span className={cn('h-2 w-2 rounded-full', x.dot)} aria-hidden /><span className="text-ink-soft">{x.label}</span><span className="num font-medium text-ink">{x.n}</span></li>
          ))}
          {c.lateMinutes > 0 && <li className="text-ink-soft"><span className="num">{c.lateMinutes}</span> min late in total</li>}
          {c.dayOff > 0 && <li className="text-ink-soft"><span className="num">{c.dayOff}</span> on their day off</li>}
        </ul>
      </section>

      <div className="flex flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
        {/* Right column on wide screens (first on small ones): the people who need a look. */}
        <div className="contents xl:order-2 xl:flex xl:flex-col xl:gap-6">
          <section aria-labelledby="notin-h" className="order-1">
            <SectionTitle id="notin-h" count={s.notIn.length}>Not scanned yet</SectionTitle>
            <TableWrap className="max-h-[26rem] overflow-y-auto">
              <Table wide={false}>
                <thead><tr><Th>Name</Th><Th align="right">Shift starts</Th></tr></thead>
                <tbody>
                  {s.notIn.length === 0 && <tr><td colSpan={2}><EmptyState title={filtered ? 'Everyone in this view has scanned' : 'Everyone expected has scanned'} /></td></tr>}
                  {s.notIn.map(r => (
                    <tr key={r.pin}>
                      <Td><span className="font-medium">{r.name}</span><span className="num ml-2 text-[12px] text-ink-faint">{r.pin}</span>{r.dept && <div className="text-[12px] text-ink-soft">{r.dept}</div>}</Td>
                      <Td align="right" className="whitespace-nowrap">{r.start ? to12h(r.start) : ''}{r.overdueMin ? <div className="text-[12px] text-ink-soft">{ago(r.overdueMin)}</div> : null}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </section>

          {s.late.length > 0 && (
            <section aria-labelledby="late-h" className="order-2">
              <SectionTitle id="late-h" count={s.late.length}>Late today</SectionTitle>
              <TableWrap>
                <Table wide={false}>
                  <thead><tr><Th>Name</Th><Th align="right">In</Th><Th align="right">Late by</Th></tr></thead>
                  <tbody>
                    {s.late.map(r => (
                      <tr key={r.pin}>
                        <Td><span className="font-medium">{r.name}</span>{r.dept && <div className="text-[12px] text-ink-soft">{r.dept}</div>}</Td>
                        <Td align="right" className="whitespace-nowrap">{to12h(r.in)}</Td>
                        <Td align="right" className="whitespace-nowrap font-medium text-late">{r.minutesLate} min</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            </section>
          )}

          {s.leave.length > 0 && (
            <section aria-labelledby="leave-h" className="order-2">
              <SectionTitle id="leave-h" count={s.leave.length}>On leave today</SectionTitle>
              <TableWrap>
                <Table wide={false}>
                  <thead><tr><Th>Name</Th><Th>Leave</Th></tr></thead>
                  <tbody>
                    {s.leave.map(r => (
                      <tr key={r.pin}>
                        <Td><span className="font-medium">{r.name}</span>{r.dept && <div className="text-[12px] text-ink-soft">{r.dept}</div>}</Td>
                        <Td className="text-ink-soft">{r.code}{r.days && r.days < 1 ? ' (half day)' : ''}{r.note ? <div className="text-[12px]">{r.note}</div> : null}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            </section>
          )}

          {s.unknown.length > 0 && !filtered && (
            <section aria-labelledby="unk-h" className="order-2">
              <SectionTitle id="unk-h" count={s.unknown.length}>PINs not on the staff list</SectionTitle>
              <div className="rounded-md border border-line bg-raised px-3.5 py-3 text-[14px]">
                {s.unknown.map(u => <p key={u.pin}><span className="num font-medium">PIN {u.pin}</span> scanned {u.scans === 1 ? 'once' : `${u.scans} times`}, last at <span className="num">{to12h(u.last.slice(11, 16))}</span>.</p>)}
                {canFixPins && <p className="mt-2"><Link href="/staff/suggestions" className="text-brand underline underline-offset-2 hover:text-brand-deep">Add or link these PINs</Link></p>}
              </div>
            </section>
          )}

          <section aria-labelledby="readers-h" className="order-4">
            <SectionTitle id="readers-h">Readers</SectionTitle>
            <TableWrap>
              <Table wide={false}>
                <thead><tr><Th>Reader</Th><Th>Last checked</Th><Th align="right">Scans today</Th></tr></thead>
                <tbody>
                  {s.readers.length === 0 && <tr><td colSpan={3}><EmptyState title="No readers set up" /></td></tr>}
                  {s.readers.map(r => (
                    <tr key={r.id}>
                      <Td className="font-medium">{r.name}</Td>
                      <Td className="whitespace-nowrap">
                        <span className={cn('inline-flex items-center gap-1.5', r.state === 'ok' ? 'text-ink-soft' : r.state === 'stale' ? 'text-late' : 'text-absent')}>
                          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                          {r.state === 'failed' ? `Failed${r.error ? `: ${r.error}` : ''}` : r.ageMin == null ? 'Not checked yet' : ago(r.ageMin)}
                        </span>
                        {r.state === 'stale' && <div className="text-[12px] text-late">Not checked for a while</div>}
                      </Td>
                      <Td align="right">{r.scansToday}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </section>
        </div>

        <div className="contents xl:order-1 xl:flex xl:flex-col xl:gap-6">
          <section aria-labelledby="scans-h" className="order-3">
            <SectionTitle id="scans-h" note={s.scansToday > s.recent.length ? `newest ${s.recent.length} of ${s.scansToday}` : undefined} aside={s.scansToday > 0 ? <Link href={`/reports?view=punches&from=${today}&to=${today}${group ? `&group=${group}` : ''}${department ? `&department=${department}` : ''}`} className="touch-target text-[13px] text-brand underline-offset-2 hover:text-brand-deep hover:underline">All scans today</Link> : undefined}>Latest scans</SectionTitle>
            <TableWrap>
              <Table wide={false}>
                <thead><tr><Th>Time</Th><Th>Name</Th><Th className="hidden md:table-cell">Department</Th><Th>Scan</Th><Th className="hidden sm:table-cell">Reader</Th></tr></thead>
                <tbody>
                  {s.recent.length === 0 && <tr><td colSpan={5}><EmptyState title={filtered ? 'No scans yet today for this filter' : 'No scans yet today'}>{filtered ? 'Clear the filter to see every scan.' : 'Scans appear here within a minute of a staff member using a reader.'}</EmptyState></td></tr>}
                  {s.recent.map(p => (
                    <tr key={p.id}>
                      <Td className="num whitespace-nowrap font-medium">{to12h(p.time.slice(11, 16))}</Td>
                      <Td>
                        {employees[p.pin]?.name ? <span className="font-medium">{employees[p.pin].name}</span> : <span className="text-ink-faint">Not in staff list</span>}
                        <span className="num ml-2 text-[12px] text-ink-faint">{p.pin}</span>
                        {p.lateMin > 0 && <span className="num ml-2 text-[12px] font-medium text-late">{p.lateMin} min late</span>}
                      </Td>
                      <Td className="hidden text-ink-soft md:table-cell">{deptOf(p.pin)}</Td>
                      <Td className="whitespace-nowrap"><Direction d={p.direction} /></Td>
                      <Td className="hidden text-ink-soft sm:table-cell">{deviceName[p.deviceId] || ''}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </section>

          {s.byDepartment.length > 1 && (
            <section aria-labelledby="dept-h" className="order-3">
              <SectionTitle id="dept-h">By department</SectionTitle>
              <TableWrap>
                <Table wide={false}>
                  <thead><tr><Th>Department</Th><Th align="right">Scanned in</Th><Th align="right">Late</Th><Th align="right">Not yet</Th><Th align="right" className="hidden sm:table-cell">Leave</Th><Th className="hidden w-[150px] md:table-cell"><span className="sr-only">Share of the department</span></Th></tr></thead>
                  <tbody>
                    {s.byDepartment.map(d => (
                      <tr key={d.id || 'none'}>
                        <Td className="font-medium">{d.name}</Td>
                        <Td align="right" className="whitespace-nowrap">{d.in} <span className="text-ink-faint">of</span> {d.total}</Td>
                        <Td align="right" className={d.late ? 'font-medium text-late' : 'text-ink-faint'}>{d.late || ''}</Td>
                        <Td align="right" className={d.notYet ? 'font-medium text-absent' : 'text-ink-faint'}>{d.notYet || ''}</Td>
                        <Td align="right" className="hidden text-ink-soft sm:table-cell">{d.leave || ''}</Td>
                        <Td className="hidden md:table-cell">
                          <div role="img" aria-label={`${d.in} of ${d.total} scanned in`} className="flex h-2 gap-px overflow-hidden rounded-sm bg-line">
                            {d.onTime > 0 && <div className="bg-present" style={{ flex: `${d.onTime} 1 0%` }} />}
                            {d.late > 0 && <div className="bg-late" style={{ flex: `${d.late} 1 0%` }} />}
                            {d.notYet > 0 && <div className="bg-absent" style={{ flex: `${d.notYet} 1 0%` }} />}
                            {d.leave > 0 && <div className="bg-leave" style={{ flex: `${d.leave} 1 0%` }} />}
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            </section>
          )}
        </div>
      </div>

      <p className="mt-6 text-[12px] text-ink-faint">Updated {clock.label}. Refreshes every {REFRESH_SECONDS} seconds while this tab is open.</p>
    </>
  )
}

function SectionTitle({ id, count, note, aside, children }: { id: string; count?: number; note?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h2 id={id} className="text-[15px] font-semibold">
        {children}
        {count !== undefined && <span className="num ml-2 font-normal text-ink-soft">({count})</span>}
        {note && <span className="ml-2 text-[13px] font-normal text-ink-soft">{note}</span>}
      </h2>
      {aside}
    </div>
  )
}

function Direction({ d }: { d: 'in' | 'out' | 'repeat' }) {
  if (d === 'repeat') return <span className="text-[13px] text-ink-faint">Repeat scan</span>
  const Icon = d === 'in' ? LogIn : LogOut
  return <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-soft"><Icon size={14} strokeWidth={1.75} aria-hidden />{d === 'in' ? 'In' : 'Out'}</span>
}
