import type { Metadata } from 'next'
import Link from 'next/link'
import { ConfirmButton } from '@/components/ConfirmButton'
import { MonthNav } from '@/components/MonthNav'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { Button, EmptyState, Field, Flash, Input, MigrationNotice, PageHeader } from '@/components/ui'
import { decodeEcho, echoOne } from '@/lib/echo'
import { cn } from '@/lib/utils'
import { guard } from '@/lib/guard'
import { addHoliday, removeHoliday, saveHoliday } from './actions'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lv = require('@/lib/leave-store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildMonth, isDate, isMonth, monthOf, monthLabel, shiftMonth, longDate, WEEKDAYS } = require('@/lib/calendar')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { todayStr } = require('@/lib/report-data')

export const metadata: Metadata = { title: 'Holidays' }
export const dynamic = 'force-dynamic'

type H = { date: string; name: string; nameKh: string }
type Cell = { date: string; day: number; inMonth: boolean; sunday: boolean; today: boolean; holiday: { name: string; nameKh: string } | null }
type SP = { month?: string; date?: string; year?: string; error?: string; saved?: string; v?: string }

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default async function HolidaysPage({ searchParams }: { searchParams: SP }) {
  const me = await guard()
  if (!(await lv.ready())) return <><PageHeader title="Holidays" /><MigrationNotice file="002_leave_holidays_roster.sql" /></>
  const canEdit = me.perms.includes('setup.edit')
  const today = todayStr()

  // Which month: ?month=, else the old ?year= link (this month if it is the current year, else January), else this month.
  const month: string = isMonth(searchParams.month) ? searchParams.month! : /^\d{4}$/.test(searchParams.year || '') ? (searchParams.year === today.slice(0, 4) ? today.slice(0, 7) : `${searchParams.year}-01`) : today.slice(0, 7)
  const selected: string = isDate(searchParams.date) && monthOf(searchParams.date) === month ? searchParams.date! : ''
  const year = month.slice(0, 4)

  const list: H[] = await lv.holidays.list(Number(year))
  const byDate = new Map<string, { name: string; nameKh: string }>(list.map(h => [h.date, { name: h.name, nameKh: h.nameKh }]))
  const { weeks }: { weeks: Cell[][] } = buildMonth(month, byDate, today)
  const perMonth = Array.from({ length: 12 }, (_, i) => list.filter(h => h.date.slice(5, 7) === String(i + 1).padStart(2, '0')).length)
  const echo = decodeEcho(searchParams.v)
  const sel = selected ? byDate.get(selected) || null : null

  const href = (m: string, date = '') => `/holidays?month=${m}${date ? `&date=${date}` : ''}`
  const currentMonth = today.slice(0, 7)

  return (
    <>
      <PageHeader title="Holidays" note="Public holidays are not counted as absences, and are skipped when leave days are counted. Staff who scan on a holiday still show as present.">
        <MonthNav label={monthLabel(month)} prev={href(shiftMonth(month, -1))} next={href(shiftMonth(month, 1))} />
        {month !== currentMonth && <Link href={href(currentMonth)} className="touch-target text-[13px] text-brand underline-offset-2 hover:text-brand-deep hover:underline">This month</Link>}
      </PageHeader>
      <Flash error={searchParams.error} saved={searchParams.saved} />
      {!canEdit && <ReadOnlyNotice />}

      <nav aria-label={`Months of ${year}`} className="mb-5 flex flex-wrap gap-1.5">
        {SHORT_MONTHS.map((label, i) => {
          const m = `${year}-${String(i + 1).padStart(2, '0')}`
          const here = m === month
          return (
            <Link key={m} href={href(m)} aria-current={here ? 'page' : undefined} aria-label={`${label} ${year}${perMonth[i] ? `, ${perMonth[i]} ${perMonth[i] === 1 ? 'holiday' : 'holidays'}` : ''}`}
              className={cn('touch-target inline-flex h-9 items-center gap-1.5 rounded border px-3 text-[13px] transition-colors', here ? 'border-brand bg-brand-wash font-semibold text-brand-deep' : 'border-line-strong bg-raised text-ink-soft hover:bg-brand-wash')}>
              {label}
              {perMonth[i] > 0 && <span className="num rounded-sm bg-holiday-wash px-1 text-[12px] font-medium text-holiday">{perMonth[i]}</span>}
            </Link>
          )
        })}
      </nav>

      <div className="flex flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
        <section aria-label={`${monthLabel(month)} calendar`} className="order-2 xl:order-1">
          <div className="overflow-hidden rounded-md border border-line bg-raised">
            <table className="w-full table-fixed border-collapse">
              <caption className="sr-only">{monthLabel(month)}. Select a day to {canEdit ? 'add or change a holiday' : 'see its holiday'}.</caption>
              <thead>
                <tr>
                  {WEEKDAYS.map((w: string, i: number) => (
                    <th key={w} scope="col" className={cn('border-b border-line bg-paper px-1 py-2 text-center text-[12px] font-medium', i === 6 ? 'text-ink-faint' : 'text-ink-soft')}>
                      <span className="sm:hidden" aria-hidden>{w.slice(0, 1)}</span><span className="sr-only sm:not-sr-only">{w.slice(0, 3)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((week, wi) => (
                  <tr key={wi}>
                    {week.map(c => {
                      const isSel = c.date === selected
                      const base = 'border-b border-r border-line last-of-type:border-r-0'
                      if (!c.inMonth) return <td key={c.date} className={cn(base, 'h-14 bg-paper p-0 align-top sm:h-24')} aria-hidden><span className="num block p-1.5 text-[12px] text-ink-faint/70 sm:p-2">{c.day}</span></td>
                      const label = `${longDate(c.date)}${c.holiday ? `, ${c.holiday.name}` : ''}${c.today ? ', today' : ''}`
                      return (
                        <td key={c.date} className={cn(base, 'h-14 p-0 align-top sm:h-24', c.sunday && 'bg-dayoff-wash/40')}>
                          <Link href={href(month, c.date)} aria-label={label} aria-current={c.today ? 'date' : undefined}
                            className={cn('flex h-full min-h-[3.5rem] w-full flex-col gap-1 p-1 text-left transition-colors hover:bg-brand-wash sm:min-h-[6rem] sm:p-2', isSel && 'bg-brand-wash ring-2 ring-inset ring-brand')}>
                            <span className={cn('num inline-flex h-6 min-w-[1.5rem] items-center justify-center self-start rounded-full px-1 text-[13px]', c.today ? 'bg-brand font-semibold text-white' : c.sunday ? 'text-ink-faint' : 'font-medium text-ink')}>{c.day}</span>
                            {c.holiday && (
                              <>
                                <span className="hidden w-full truncate rounded-sm bg-holiday-wash px-1.5 py-0.5 text-[12px] font-medium text-holiday sm:block">{c.holiday.name}</span>
                                <span className="h-1.5 w-1.5 self-start rounded-full bg-holiday sm:hidden" aria-hidden />
                              </>
                            )}
                          </Link>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-ink-soft">
            <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-holiday" aria-hidden />Public holiday</span>
            <span className="flex items-center gap-2"><span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-brand px-1 text-[12px] font-semibold text-white" aria-hidden>{Number(today.slice(8))}</span>Today</span>
            <span>Sundays are shaded.</span>
          </p>
        </section>

        <div className="contents xl:order-2 xl:flex xl:flex-col xl:gap-6">
          {selected ? (
            <section aria-labelledby="day-h" className="order-1 rounded-md border border-line bg-raised p-4">
              <h2 id="day-h" className="text-[15px] font-semibold">{longDate(selected)}</h2>
              {sel ? (
                <>
                  <p className="mt-1 inline-flex items-center gap-1.5 rounded-sm bg-holiday-wash px-2 py-0.5 text-[12px] font-medium text-holiday"><span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />Public holiday</p>
                  {canEdit ? (
                    <>
                      <form action={saveHoliday} className="mt-4 grid gap-3">
                        <input type="hidden" name="date" value={selected} />
                        <Field label="Name"><Input name="name" defaultValue={echoOne(echo, 'name') ?? sel.name} required /></Field>
                        <Field label="Name in Khmer"><Input name="nameKh" defaultValue={echoOne(echo, 'nameKh') ?? sel.nameKh} placeholder="Optional" /></Field>
                        <div><Button type="submit" variant="primary">Save changes</Button></div>
                      </form>
                      <form action={removeHoliday} className="mt-3 border-t border-line pt-3">
                        <input type="hidden" name="date" value={selected} />
                        <ConfirmButton variant="danger" message={`Remove ${sel.name} (${selected})? Staff who did not scan that day will count as absent again.`}>Remove holiday</ConfirmButton>
                      </form>
                    </>
                  ) : (
                    <p className="mt-3 text-[15px] font-medium">{sel.name}{sel.nameKh && <span className="mt-0.5 block font-normal text-ink-soft">{sel.nameKh}</span>}</p>
                  )}
                </>
              ) : canEdit ? (
                <form action={addHoliday} className="mt-3 grid gap-3">
                  <p className="text-[13px] text-ink-soft">Not a holiday yet.</p>
                  <input type="hidden" name="date" value={selected} />
                  <Field label="Holiday name"><Input name="name" defaultValue={echoOne(echo, 'name')} placeholder="Khmer New Year" required /></Field>
                  <Field label="Name in Khmer"><Input name="nameKh" defaultValue={echoOne(echo, 'nameKh')} placeholder="Optional" /></Field>
                  <Field label="Days in a row"><Input type="number" name="days" min={1} max={10} defaultValue={echoOne(echo, 'days') ?? '1'} inputMode="numeric" /></Field>
                  <div><Button type="submit" variant="primary">Add holiday</Button></div>
                </form>
              ) : (
                <p className="mt-2 text-[14px] text-ink-soft">Not a public holiday.</p>
              )}
            </section>
          ) : (
            <section aria-label="Selected day" className="order-1 hidden rounded-md border border-dashed border-line-strong px-4 py-5 text-[14px] text-ink-soft xl:block">
              {canEdit ? 'Select a day on the calendar to make it a holiday, or to rename or remove one.' : 'Select a day on the calendar to see its holiday.'}
            </section>
          )}

          <section aria-labelledby="year-h" className="order-3">
            <h2 id="year-h" className="mb-2 text-[15px] font-semibold">Holidays in {year} <span className="num font-normal text-ink-soft">({list.length})</span></h2>
            <TableWrap>
              <Table wide={false}>
                <thead><tr><Th>Date</Th><Th>Holiday</Th></tr></thead>
                <tbody>
                  {list.length === 0 && <tr><td colSpan={2}><EmptyState title={`No holidays entered for ${year}`}>Add each public holiday as the Labour Ministry announces it. Nothing is added automatically. Select a day on the calendar to start.</EmptyState></td></tr>}
                  {list.map(h => (
                    <tr key={h.date} className={cn(h.date === selected && 'bg-brand-wash/60')}>
                      <Td className="num whitespace-nowrap"><Link href={href(monthOf(h.date), h.date)} className="font-medium text-brand-deep underline underline-offset-2 hover:text-brand">{h.date.slice(8)} {SHORT_MONTHS[Number(h.date.slice(5, 7)) - 1]}</Link></Td>
                      <Td>{h.name}{h.nameKh && <span className="ml-2 text-ink-soft">{h.nameKh}</span>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </section>
        </div>
      </div>
    </>
  )
}
