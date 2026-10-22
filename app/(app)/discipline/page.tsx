import type { Metadata } from 'next'
import Link from 'next/link'
import { Download, Plus } from 'lucide-react'
import { DisciplineStatus } from '@/components/DisciplineBits'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { Button, EmptyState, Flash, Input, MigrationNotice, PageHeader, Select } from '@/components/ui'
import { DepartmentSelect, cleanDepartment, type Dept } from '@/components/StaffFilters'
import { usd } from '@/lib/utils'
import { guard } from '@/lib/guard'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { records } = require('@/lib/discipline-store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const D = require('@/lib/discipline')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { todayStr } = require('@/lib/report-data')

export const metadata: Metadata = { title: 'Discipline' }
export const dynamic = 'force-dynamic'

type Rec = { id: string; pin: string | null; staffCode: string; staffName: string; position: string; department: string; source: string; occurredOn: string; kind: string; reason: string; deduction: number | null; status: string; letterIssuedOn: string | null; acknowledgedOn: string | null }
type Person = { staffCode: string; name: string; nameKh: string; position: string; departmentName: string }
type SP = { from?: string; to?: string; kind?: string; status?: string; department?: string; q?: string; error?: string; saved?: string }

export default async function DisciplinePage({ searchParams }: { searchParams: SP }) {
  const me = await guard()
  if (!(await records.ready())) return <><PageHeader title="Discipline" /><MigrationNotice file="009_discipline.sql" /></>
  const today = todayStr()
  const from = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.from || '') ? searchParams.from! : `${today.slice(0, 4)}-01-01`
  const to = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.to || '') ? searchParams.to! : today
  const kind = D.KINDS[searchParams.kind || ''] ? searchParams.kind! : ''
  const status = D.STATUSES[searchParams.status || ''] ? searchParams.status! : ''
  const q = (searchParams.q || '').trim()
  const ready = await hr.available()
  const depts: Dept[] = ready ? await hr.departments.list() : []
  const department = cleanDepartment(searchParams.department, depts)
  const canEdit = me.perms.includes('discipline.edit')

  const filters = { from, to, kind, status, departmentId: department, q }
  const [rows, people]: [Rec[], Record<string, Person>] = await Promise.all([records.list(filters), records.people()])
  const live = rows.filter(r => r.status !== 'withdrawn')
  const deducted = rows.filter(r => r.status === 'confirmed' && r.deduction).reduce((n, r) => n + (r.deduction || 0), 0)
  const qs = new URLSearchParams(Object.entries({ from, to, kind, status, department, q }).filter(([, v]) => v) as [string, string][]).toString()

  return (
    <>
      <PageHeader title="Discipline" note={`${from} to ${to} · ${rows.length} record${rows.length === 1 ? '' : 's'}${live.length !== rows.length ? ` (${live.length} not withdrawn)` : ''}${deducted ? ` · USD ${deducted.toFixed(2)} in confirmed salary deductions` : ''}`}>
        <a href={`/api/export/discipline?${qs}`}><Button><Download size={16} aria-hidden /> Export Excel</Button></a>
        {canEdit && <Link href="/discipline/new" className="inline-flex h-9 items-center gap-2 rounded bg-brand px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-brand-deep"><Plus size={16} aria-hidden /> Record warning</Link>}
      </PageHeader>
      <Flash error={searchParams.error} saved={searchParams.saved} />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-[150px]"><Input type="date" name="from" defaultValue={from} aria-label="From" /></div>
        <div className="w-[150px]"><Input type="date" name="to" defaultValue={to} aria-label="To" /></div>
        <div className="w-[190px]"><DepartmentSelect value={department} departments={depts} /></div>
        <div className="w-[210px]">
          <Select name="kind" defaultValue={kind} aria-label="Type"><option value="">All types</option>{D.KIND_KEYS.map((k: string) => <option key={k} value={k}>{D.KINDS[k].label}</option>)}</Select>
        </div>
        <div className="w-[150px]">
          <Select name="status" defaultValue={status} aria-label="Status"><option value="">All statuses</option>{Object.entries(D.STATUSES).map(([k, l]) => <option key={k} value={k}>{l as string}</option>)}</Select>
        </div>
        <div className="w-[200px]"><Input name="q" defaultValue={q} placeholder="Name, PIN or staff ID" aria-label="Search" /></div>
        <Button type="submit">Filter</Button>
        {(department || kind || status || q || searchParams.from || searchParams.to) && <Link href="/discipline" className="touch-target text-[13px] text-ink-soft underline-offset-2 hover:text-ink hover:underline">Clear</Link>}
      </form>

      <TableWrap>
        <Table>
          <thead>
            <tr>
              <Th align="right">No</Th><Th>Staff ID</Th><Th>Name</Th><Th>Position</Th><Th>Department</Th>
              <Th align="right">Salary deduction (USD)</Th><Th>Occurrence date</Th><Th>ការណែនាំ / ការព្រមាន</Th><Th>Reason</Th><Th>Status</Th><Th>Letter</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={11}><EmptyState title="No records for these filters">{canEdit ? 'Use Record warning to add one, or widen the dates.' : 'Widen the dates or clear the filters.'}</EmptyState></td></tr>}
            {rows.map((r, i) => {
              const p: Person = D.who(r, people)
              return (
                <tr key={r.id} className={r.status === 'withdrawn' ? 'text-ink-soft' : undefined}>
                  <Td align="right" className="text-ink-faint">{i + 1}</Td>
                  <Td className="num text-ink-soft">{p.staffCode}</Td>
                  <Td className="font-medium"><Link href={`/discipline/${r.id}`} className="text-brand-deep underline underline-offset-2 hover:text-brand">{p.name}</Link></Td>
                  <Td className="text-ink-soft">{p.position}</Td>
                  <Td className="text-ink-soft">{p.departmentName}</Td>
                  <Td align="right" className="whitespace-nowrap">{r.deduction ? usd(r.deduction) : ''}</Td>
                  <Td className="num whitespace-nowrap">{r.occurredOn}</Td>
                  <Td className="whitespace-nowrap"><span className="font-medium">{D.KINDS[r.kind].label}</span><div className="text-[12px] text-ink-soft">{D.KINDS[r.kind].kh}</div></Td>
                  <Td className="min-w-[220px] max-w-[360px]">{r.reason}</Td>
                  <Td><DisciplineStatus status={r.status} /></Td>
                  <Td className="whitespace-nowrap text-[13px] text-ink-soft">{r.status !== 'confirmed' ? '' : r.acknowledgedOn ? 'Signed' : r.letterIssuedOn ? 'Issued' : r.source === 'import' ? '' : 'Not issued'}</Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </TableWrap>
    </>
  )
}
