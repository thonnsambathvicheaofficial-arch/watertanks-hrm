import type { Metadata } from 'next'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { Button, EmptyState, Flash, Input, MigrationNotice, PageHeader, Select } from '@/components/ui'
import { savePaySetup } from './actions'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pr = require('@/lib/payroll-store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')

export const metadata: Metadata = { title: 'Pay setup' }
export const dynamic = 'force-dynamic'

type S = { salary: number | null; taxResident: boolean; taxExempt: boolean; nssfExempt: boolean; dependents: number; paymentMethod: string; bankName: string; bankAccount: string }
type P = { pin: string; name: string; group: string; resignedDate: string }
const check = 'h-4 w-4 accent-[oklch(0.46_0.15_258)]'

export default async function PaySetupPage({ searchParams }: { searchParams: { q?: string; group?: string; show?: string; error?: string; saved?: string } }) {
  if (!(await pr.ready())) return <><PageHeader title="Pay setup" /><MigrationNotice file="003_payroll.sql" /></>
  const [staff, setup]: [P[], Record<string, S>] = await Promise.all([hr.staff.list(), pr.structure.list()])
  const active = staff.filter(p => !p.resignedDate)
  const noSalary = active.filter(p => setup[p.pin]?.salary == null)
  const q = (searchParams.q || '').trim().toLowerCase()
  const rows = active
    .filter(p => (!searchParams.group || p.group === searchParams.group) && (!q || p.pin.includes(q) || p.name.toLowerCase().includes(q)) && (searchParams.show !== 'missing' || setup[p.pin]?.salary == null))
    .sort((a, b) => (a.name || a.pin).localeCompare(b.name || b.pin))

  return (
    <>
      <PageHeader title="Pay setup" note={`${active.length - noSalary.length} of ${active.length} current staff have a salary. People without one are left out of payroll.`} />
      <Flash error={searchParams.error} saved={searchParams.saved} />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-[260px]"><Input name="q" defaultValue={searchParams.q} placeholder="Search name or PIN" aria-label="Search staff" /></div>
        <div className="w-[150px]"><Select name="group" defaultValue={searchParams.group || ''} aria-label="Group"><option value="">Everyone</option><option value="office">Office staff</option><option value="worker">Workers</option></Select></div>
        <div className="w-[190px]"><Select name="show" defaultValue={searchParams.show || ''} aria-label="Show"><option value="">All staff</option><option value="missing">Only without a salary ({noSalary.length})</option></Select></div>
        <Button type="submit">Filter</Button>
      </form>

      <form action={savePaySetup}>
        <TableWrap>
          <Table>
            <thead>
              <tr><Th>Staff</Th><Th align="right">Salary (USD / month)</Th><Th align="right">Dependents</Th><Th>Paid by</Th><Th>Bank</Th><Th>Account</Th><Th>Tax resident</Th><Th>Tax exempt</Th><Th>NSSF exempt</Th></tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={9}><EmptyState title="No staff match" /></td></tr>}
              {rows.map(p => {
                const s: S = setup[p.pin] ?? { salary: null, taxResident: true, taxExempt: false, nssfExempt: false, dependents: 0, paymentMethod: '', bankName: '', bankAccount: '' }
                const n = (f: string) => `s|${p.pin}|${f}`
                return (
                  <tr key={p.pin}>
                    <Td className="font-medium">{p.name || 'Unnamed'}<span className="num ml-2 text-[12px] font-normal text-ink-soft">{p.pin}</span><input type="hidden" name={n('seen')} value="1" /></Td>
                    <Td className="text-right"><Input type="number" step="0.01" min={0} name={n('salary')} defaultValue={s.salary ?? ''} aria-label={`Salary for ${p.name || p.pin}`} className="ml-auto w-[110px] text-right" /></Td>
                    <Td className="text-right"><Input type="number" min={0} step={1} name={n('dependents')} defaultValue={s.dependents} aria-label={`Dependents for ${p.name || p.pin}`} className="ml-auto w-[70px] text-right" /></Td>
                    <Td><Select name={n('paymentMethod')} defaultValue={s.paymentMethod} aria-label={`Payment method for ${p.name || p.pin}`} className="w-[100px]"><option value="">Not set</option><option value="bank">Bank</option><option value="cash">Cash</option></Select></Td>
                    <Td><Input name={n('bankName')} defaultValue={s.bankName} aria-label={`Bank for ${p.name || p.pin}`} className="w-[130px]" /></Td>
                    <Td><Input name={n('bankAccount')} defaultValue={s.bankAccount} aria-label={`Account for ${p.name || p.pin}`} className="w-[160px]" /></Td>
                    <Td><input type="checkbox" name={n('taxResident')} defaultChecked={s.taxResident} aria-label={`Tax resident: ${p.name || p.pin}`} className={check} /></Td>
                    <Td><input type="checkbox" name={n('taxExempt')} defaultChecked={s.taxExempt} aria-label={`Tax exempt: ${p.name || p.pin}`} className={check} /></Td>
                    <Td><input type="checkbox" name={n('nssfExempt')} defaultChecked={s.nssfExempt} aria-label={`NSSF exempt: ${p.name || p.pin}`} className={check} /></Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </TableWrap>
        <div className="sticky bottom-0 -mx-4 mt-4 flex flex-wrap items-center gap-4 border-t border-line bg-paper/95 px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <Button type="submit" variant="primary">Save pay setup</Button>
          <span className="text-[13px] text-ink-soft">Dependents are a spouse and children, for tax relief. Tick exempt only for people who are not under tax declaration or NSSF.</span>
        </div>
      </form>
    </>
  )
}
