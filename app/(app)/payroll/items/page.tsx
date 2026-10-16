import type { Metadata } from 'next'
import { ConfirmButton } from '@/components/ConfirmButton'
import { MonthNav } from '@/components/MonthNav'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { Button, EmptyState, Field, Flash, Input, MigrationNotice, PageHeader, Select } from '@/components/ui'
import { decodeEcho, echoOne } from '@/lib/echo'
import { MONTH_NAMES, usd } from '@/lib/utils'
import { addItem, removeItem } from './actions'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pr = require('@/lib/payroll-store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')

export const metadata: Metadata = { title: 'Monthly items' }
export const dynamic = 'force-dynamic'

type E = { id: string; pin: string; kind: string; label: string; amount: number; remarks: string; createdBy: string }
type P = { pin: string; name: string; resignedDate: string }

const shift = (y: number, m: number, n: number) => { const d = new Date(y, m - 1 + n, 1); return { y: d.getFullYear(), m: d.getMonth() + 1 } }

export default async function ItemsPage({ searchParams }: { searchParams: { year?: string; month?: string; error?: string; saved?: string; v?: string } }) {
  if (!(await pr.ready())) return <><PageHeader title="Monthly items" /><MigrationNotice file="003_payroll.sql" /></>
  const now = new Date()
  const year = Number(searchParams.year) || now.getFullYear(), month = Number(searchParams.month) || now.getMonth() + 1
  const [list, staff, run]: [E[], P[], { status: string } | null] = await Promise.all([pr.entries.list(year, month), hr.staff.list(), pr.runs.get(year, month)])
  const name = Object.fromEntries(staff.map(p => [p.pin, p.name]))
  const people = staff.filter(p => !p.resignedDate).sort((a, b) => (a.name || a.pin).localeCompare(b.name || b.pin))
  const locked = run?.status === 'finalized'
  const prev = shift(year, month, -1), next = shift(year, month, 1)
  const echo = decodeEcho(searchParams.v)
  const kinds: Record<string, string> = pr.KINDS
  const totals = Object.keys(kinds).map(k => ({ k, n: list.filter(e => e.kind === k).reduce((a, e) => a + e.amount, 0) })).filter(t => t.n !== 0)

  return (
    <>
      <PageHeader title="Monthly items" note="One-off amounts for a single person and month: bonuses, allowances, advances to repay, and corrections.">
        <MonthNav label={`${MONTH_NAMES[month - 1]} ${year}`} prev={`/payroll/items?year=${prev.y}&month=${prev.m}`} next={`/payroll/items?year=${next.y}&month=${next.m}`} />
      </PageHeader>
      <Flash error={searchParams.error} saved={searchParams.saved} />
      {locked && <p className="mb-5 rounded border border-line bg-raised px-3.5 py-2.5 text-[14px] text-ink-soft">Payroll for this month is finalized, so items cannot be added or removed. Record a correction as an adjustment next month.</p>}

      {!locked && (
        <form action={addItem} className="mb-6 grid gap-3 rounded-md border border-line bg-raised p-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1.4fr_1fr_1fr_1.2fr_auto] lg:items-end">
          <input type="hidden" name="year" value={year} /><input type="hidden" name="month" value={month} />
          <Field label="Staff member"><Select name="pin" required defaultValue={echoOne(echo, 'pin') ?? ''}><option value="" disabled>Choose a person</option>{people.map(p => <option key={p.pin} value={p.pin}>{p.name || 'Unnamed'} · {p.pin}</option>)}</Select></Field>
          <Field label="Kind"><Select name="kind" required defaultValue={echoOne(echo, 'kind') ?? 'bonus'}>{Object.entries(kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <Field label="Amount (USD)" hint="Minus for a reduction, on adjustments and withholdings."><Input type="number" step="0.01" name="amount" defaultValue={echoOne(echo, 'amount')} required /></Field>
          <Field label="Label"><Input name="label" defaultValue={echoOne(echo, 'label')} placeholder="Optional" /></Field>
          <Field label="Remarks"><Input name="remarks" defaultValue={echoOne(echo, 'remarks')} placeholder="Optional" /></Field>
          <Button type="submit" variant="primary">Add</Button>
        </form>
      )}

      <TableWrap>
        <Table wide={false}>
          <thead><tr><Th>Staff</Th><Th>Kind</Th><Th>Label</Th><Th align="right">Amount</Th><Th>Remarks</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={6}><EmptyState title="No items for this month" /></td></tr>}
            {list.map(e => (
              <tr key={e.id}>
                <Td className="font-medium">{name[e.pin] || e.pin}<span className="num ml-2 text-[12px] font-normal text-ink-soft">{e.pin}</span></Td>
                <Td>{kinds[e.kind] || e.kind}</Td>
                <Td className="text-ink-soft">{e.label}</Td>
                <Td align="right">{usd(e.amount)}</Td>
                <Td className="text-ink-soft">{e.remarks}</Td>
                <Td className="text-right">
                  {!locked && <form action={removeItem}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="year" value={year} /><input type="hidden" name="month" value={month} /><ConfirmButton variant="danger" message="Remove this item?">Remove</ConfirmButton></form>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
      {totals.length > 0 && <p className="mt-3 text-[13px] text-ink-soft">{totals.map(t => `${kinds[t.k]}: ${usd(t.n)}`).join(' · ')}</p>}
    </>
  )
}
