import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { Button, EmptyState, Field, Flash, Input, MigrationNotice, PageHeader } from '@/components/ui'
import { decodeEcho, echoOne } from '@/lib/echo'
import { dayName } from '@/lib/utils'
import { addHoliday, removeHoliday } from './actions'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lv = require('@/lib/leave-store')

export const metadata: Metadata = { title: 'Holidays' }
export const dynamic = 'force-dynamic'

type H = { date: string; name: string; nameKh: string }

export default async function HolidaysPage({ searchParams }: { searchParams: { year?: string; error?: string; saved?: string; v?: string } }) {
  if (!(await lv.ready())) return <><PageHeader title="Holidays" /><MigrationNotice file="002_leave_holidays_roster.sql" /></>
  const year = Number(searchParams.year) || new Date().getFullYear()
  const list: H[] = await lv.holidays.list(year)
  const echo = decodeEcho(searchParams.v)
  return (
    <>
      <PageHeader title="Holidays" note="Public holidays are not counted as absences, and are skipped when leave days are counted. Staff who scan on a holiday still show as present.">
        <div className="flex items-center gap-1">
          <Link href={`/holidays?year=${year - 1}`} aria-label="Previous year" className="inline-flex h-9 w-9 items-center justify-center rounded border border-line-strong bg-raised text-ink-soft transition-colors hover:bg-brand-wash"><ChevronLeft size={18} /></Link>
          <span className="num min-w-[64px] text-center text-[15px] font-semibold">{year}</span>
          <Link href={`/holidays?year=${year + 1}`} aria-label="Next year" className="inline-flex h-9 w-9 items-center justify-center rounded border border-line-strong bg-raised text-ink-soft transition-colors hover:bg-brand-wash"><ChevronRight size={18} /></Link>
        </div>
      </PageHeader>
      <Flash error={searchParams.error} saved={searchParams.saved} />

      <form action={addHoliday} className="mb-6 grid max-w-[760px] items-end gap-3 sm:grid-cols-[160px_minmax(160px,1fr)_minmax(160px,1fr)_auto]">
        <Field label="Date"><Input type="date" name="date" defaultValue={echoOne(echo, 'date') ?? `${year}-01-01`} required /></Field>
        <Field label="Name"><Input name="name" defaultValue={echoOne(echo, 'name')} placeholder="Khmer New Year" required /></Field>
        <Field label="Name in Khmer"><Input name="nameKh" defaultValue={echoOne(echo, 'nameKh')} placeholder="Optional" /></Field>
        <Button type="submit" variant="primary">Add holiday</Button>
      </form>

      <TableWrap>
        <Table wide={false}>
          <thead><tr><Th>Date</Th><Th>Day</Th><Th>Holiday</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={4}><EmptyState title={`No holidays entered for ${year}`}>Add each public holiday as the Labour Ministry announces it. Nothing is added automatically.</EmptyState></td></tr>}
            {list.map(h => (
              <tr key={h.date}>
                <Td className="num whitespace-nowrap font-medium">{h.date}</Td>
                <Td className="text-ink-soft">{dayName(h.date)}</Td>
                <Td>{h.name}{h.nameKh && <span className="ml-3 text-ink-soft">{h.nameKh}</span>}</Td>
                <Td className="text-right"><form action={removeHoliday}><input type="hidden" name="date" value={h.date} /><ConfirmButton variant="danger" message={`Remove ${h.name} (${h.date})?`}>Remove</ConfirmButton></form></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </>
  )
}
