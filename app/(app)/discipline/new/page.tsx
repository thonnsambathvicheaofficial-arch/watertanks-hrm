import type { Metadata } from 'next'
import Link from 'next/link'
import { TextArea } from '@/components/DisciplineBits'
import { Button, Field, Flash, Input, MigrationNotice, PageHeader, Select } from '@/components/ui'
import { decodeEcho, echoOne } from '@/lib/echo'
import { createRecord } from '../actions'
import { guard } from '@/lib/guard'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { records } = require('@/lib/discipline-store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const D = require('@/lib/discipline')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { todayStr } = require('@/lib/report-data')

export const metadata: Metadata = { title: 'Record warning' }
export const dynamic = 'force-dynamic'

export default async function NewRecordPage({ searchParams }: { searchParams: { error?: string; v?: string; pin?: string } }) {
  await guard()
  if (!(await records.ready())) return <><PageHeader title="Record warning" /><MigrationNotice file="009_discipline.sql" /></>
  const staff = (await hr.staff.list()) as { pin: string; name: string; staffCode?: string; resignedDate: string }[]
  const people = staff.filter(s => !s.resignedDate).sort((a, b) => (a.name || a.pin).localeCompare(b.name || b.pin))
  const echo = decodeEcho(searchParams.v)
  const v = (k: string, fb = '') => echoOne(echo, k) ?? fb
  return (
    <>
      <PageHeader title="Record warning" note="It is saved as a draft first. Nothing reaches payroll until you confirm it.">
        <Link href="/discipline" className="text-[14px] text-ink-soft underline decoration-line-strong hover:text-ink">All records</Link>
      </PageHeader>
      <Flash error={searchParams.error} />
      <form action={createRecord} className="max-w-[620px] space-y-5">
        <Field label="Staff member">
          <Select name="pin" required defaultValue={v('pin', searchParams.pin || '')}>
            <option value="" disabled>Choose a person</option>
            {people.map(p => <option key={p.pin} value={p.pin}>{p.name || 'Unnamed'} · {p.staffCode ? `${p.staffCode} · ` : ''}PIN {p.pin}</option>)}
          </Select>
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Occurrence date"><Input type="date" name="date" defaultValue={v('date', todayStr())} max={todayStr()} required /></Field>
          <Field label="Type (ការណែនាំ / ការព្រមាន)">
            <Select name="kind" required defaultValue={v('kind', 'verbal_guidance')}>
              {D.KIND_KEYS.map((k: string) => <option key={k} value={k}>{D.KINDS[k].label} · {D.KINDS[k].kh}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Reason"><TextArea name="reason" defaultValue={v('reason')} required maxLength={2000} placeholder="What happened. Khmer is fine." /></Field>
        <fieldset className="rounded-md border border-line bg-raised p-4">
          <legend className="px-1 text-[13px] font-medium">Salary deduction (optional)</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount (USD)"><Input name="deduction" defaultValue={v('deduction')} inputMode="decimal" placeholder="Leave empty if none" /></Field>
            <Field label="Payroll month" hint="Empty means the month it happened."><Input type="month" name="payrollMonth" defaultValue={v('payrollMonth')} /></Field>
          </div>
        </fieldset>
        <Button type="submit" variant="primary">Save as draft</Button>
      </form>
    </>
  )
}
