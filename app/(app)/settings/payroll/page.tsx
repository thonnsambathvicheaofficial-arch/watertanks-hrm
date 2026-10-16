import type { Metadata } from 'next'
import { Check, Circle } from 'lucide-react'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Button, Field, Flash, Input, MigrationNotice, PageHeader, Select } from '@/components/ui'
import { decodeEcho, echoAll, echoOne } from '@/lib/echo'
import { cn } from '@/lib/utils'
import { deleteAllowance, fillFromHrm, saveAllowance, saveBrackets, saveSettings } from './actions'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pr = require('@/lib/payroll-store')

export const metadata: Metadata = { title: 'Payroll settings' }
export const dynamic = 'force-dynamic'

type S = Record<string, number | string | null | { min_amount: number; max_amount: number | null; rate: number; quick_deduction: number }[]>
type A = { id: string; name: string; kind: string; amount: number; isActive: boolean }
const check = 'h-4 w-4 accent-[oklch(0.46_0.15_258)]'

export default async function PayrollSettingsPage({ searchParams }: { searchParams: { error?: string; saved?: string; v?: string } }) {
  if (!(await pr.ready())) return <><PageHeader title="Payroll settings" /><MigrationNotice file="003_payroll.sql" /></>
  const [s, allowances]: [S & { brackets: { min_amount: number; max_amount: number | null; rate: number; quick_deduction: number }[] }, A[]] = await Promise.all([pr.settings.get(), pr.allowances.list()])
  const items: { label: string; done: boolean }[] = pr.readiness(s)
  const echo = decodeEcho(searchParams.v)
  const v = (k: string) => echoOne(echo, k) ?? (s[k] ?? '')
  const blank = Array.from({ length: 3 }, () => ({ min_amount: '', max_amount: '', rate: '', quick_deduction: '' }))
  const saved = [...s.brackets.map(b => ({ min_amount: b.min_amount, max_amount: b.max_amount ?? '', rate: b.rate, quick_deduction: b.quick_deduction })), ...blank]
  // After a rejected bracket edit, show what was typed instead of the saved rows.
  const tMin = echoAll(echo, 'bMin'), tMax = echoAll(echo, 'bMax'), tRate = echoAll(echo, 'bRate'), tQd = echoAll(echo, 'bQd')
  const rows = tMin.length ? tMin.map((_, i) => ({ min_amount: tMin[i], max_amount: tMax[i] ?? '', rate: tRate[i] ?? '', quick_deduction: tQd[i] ?? '' })) : saved
  const missing = items.filter(i => !i.done).length

  return (
    <>
      <PageHeader title="Payroll settings" note="Nothing here is assumed. A payroll month can be generated at any time, but it can only be finalized once the items below are filled in." />
      <Flash error={searchParams.error} saved={searchParams.saved} />

      <section aria-labelledby="ready-h" className="mb-8 max-w-[760px] rounded-md border border-line bg-raised p-5">
        <h2 id="ready-h" className="text-[15px] font-semibold">{missing ? `${missing} of ${items.length} still to fill in` : 'Everything payroll needs is set'}</h2>
        <ul className="mt-3 grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
          {items.map(i => (
            <li key={i.label} className={cn('flex items-start gap-2 text-[14px]', i.done ? 'text-ink-soft' : 'text-ink')}>
              {i.done ? <Check size={16} className="mt-0.5 shrink-0 text-present" aria-label="Set" /> : <Circle size={16} className="mt-0.5 shrink-0 text-late" aria-label="Missing" />}
              {i.label}
            </li>
          ))}
        </ul>
        <form action={fillFromHrm} className="mt-4 border-t border-line pt-4">
          <p className="mb-2 max-w-[62ch] text-[13px] text-ink-soft">HRM Hub&apos;s payroll currently uses an exchange rate, dependent relief, non-resident rate, NSSF rates, ceiling and floor, and the five tax brackets. This copies them into any empty box here. It never overwrites a value you entered, and it does not touch overtime, work days or hours.</p>
          <Button type="submit">Fill empty fields from HRM Hub&apos;s values</Button>
        </form>
      </section>

      <form action={saveSettings} className="max-w-[820px] space-y-8">
        <fieldset className="space-y-5">
          <legend className="mb-1 text-[15px] font-semibold">Working time and overtime</legend>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Work days per month" hint="Salary is divided by this for the daily rate, and for each absent day."><Input type="number" step="0.5" name="workDaysPerMonth" defaultValue={v('workDaysPerMonth') as string} /></Field>
            <Field label="Paid hours per day" hint="With the work days, this gives the hourly rate used for overtime."><Input type="number" step="0.25" name="hoursPerDay" defaultValue={v('hoursPerDay') as string} /></Field>
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Normal day overtime" hint="Times the hourly rate."><Input type="number" step="0.05" name="otRateNormal" defaultValue={v('otRateNormal') as string} /></Field>
            <Field label="Weekly day off" hint="Times the hourly rate."><Input type="number" step="0.05" name="otRateOff" defaultValue={v('otRateOff') as string} /></Field>
            <Field label="Public holiday" hint="Times the hourly rate."><Input type="number" step="0.05" name="otRateHoliday" defaultValue={v('otRateHoliday') as string} /></Field>
          </div>
          <Field label="Smallest overtime to suggest (minutes)" hint="Scans past the shift end by less than this are not suggested. HR approves every suggestion anyway."><Input type="number" min={0} name="otSuggestThresholdMin" defaultValue={v('otSuggestThresholdMin') as string} className="max-w-[160px]" /></Field>
        </fieldset>

        <fieldset className="space-y-5">
          <legend className="mb-1 text-[15px] font-semibold">Late arrivals</legend>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Deduct for lateness"><Select name="lateMode" defaultValue={String(v('lateMode') || 'none')}><option value="none">Never</option><option value="per_day">A fixed amount per late day</option><option value="per_minute">An amount per minute late</option></Select></Field>
            <Field label="Amount (USD)"><Input type="number" step="0.01" min={0} name="lateAmount" defaultValue={v('lateAmount') as string} /></Field>
          </div>
        </fieldset>

        <fieldset className="space-y-5">
          <legend className="mb-1 text-[15px] font-semibold">Currency and tax</legend>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Exchange rate" hint="Riel per US dollar."><Input type="number" step="0.01" name="exchangeRate" defaultValue={v('exchangeRate') as string} /></Field>
            <Field label="Relief per dependent (KHR)" hint="Spouse and children."><Input type="number" name="dependentReliefKhr" defaultValue={v('dependentReliefKhr') as string} /></Field>
            <Field label="Non-resident tax rate (%)" hint="A flat rate, no brackets or relief."><Input type="number" step="0.01" name="nonResidentRate" defaultValue={v('nonResidentRate') as string} /></Field>
          </div>
        </fieldset>

        <fieldset className="space-y-5">
          <legend className="mb-1 text-[15px] font-semibold">NSSF</legend>
          <div className="grid gap-5 sm:grid-cols-4">
            <Field label="Employee (%)"><Input type="number" step="0.01" name="nssfEmployeeRate" defaultValue={v('nssfEmployeeRate') as string} /></Field>
            <Field label="Employer pension (%)"><Input type="number" step="0.01" name="nssfEmployerPensionRate" defaultValue={v('nssfEmployerPensionRate') as string} /></Field>
            <Field label="Employer health (%)"><Input type="number" step="0.01" name="nssfEmployerHealthRate" defaultValue={v('nssfEmployerHealthRate') as string} /></Field>
            <Field label="Employer risk (%)"><Input type="number" step="0.01" name="nssfEmployerRiskRate" defaultValue={v('nssfEmployerRiskRate') as string} /></Field>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Highest insurable wage (KHR)"><Input type="number" name="nssfCeilingKhr" defaultValue={v('nssfCeilingKhr') as string} /></Field>
            <Field label="Lowest insurable wage (KHR)"><Input type="number" name="nssfFloorKhr" defaultValue={v('nssfFloorKhr') as string} /></Field>
          </div>
        </fieldset>
        <Button type="submit" variant="primary">Save settings</Button>
      </form>

      <section aria-labelledby="br-h" className="mt-12 max-w-[760px] border-t border-line pt-6">
        <h2 id="br-h" className="text-[15px] font-semibold">Tax on salary brackets</h2>
        <p className="mb-4 mt-1 max-w-[62ch] text-[14px] text-ink-soft">Monthly taxable salary in riel. Tax is the rate times the amount, minus the quick deduction. Leave the upper limit empty on the top bracket. Empty rows are ignored.</p>
        <form action={saveBrackets}>
          <div className="overflow-x-auto rounded-md border border-line bg-raised">
            <div className="min-w-[560px]">
              <div className="grid grid-cols-[1fr_1fr_90px_1fr] gap-3 border-b border-line bg-paper px-3 py-2.5 text-[12px] font-medium text-ink-soft"><span>From (KHR)</span><span>Up to (KHR)</span><span>Rate %</span><span>Quick deduction</span></div>
              {rows.map((b, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_90px_1fr] gap-3 border-b border-line px-3 py-2 last:border-b-0">
                  <Input type="number" name="bMin" defaultValue={b.min_amount} aria-label={`Bracket ${i + 1} from`} />
                  <Input type="number" name="bMax" defaultValue={b.max_amount} aria-label={`Bracket ${i + 1} up to`} />
                  <Input type="number" step="0.01" name="bRate" defaultValue={b.rate} aria-label={`Bracket ${i + 1} rate`} />
                  <Input type="number" name="bQd" defaultValue={b.quick_deduction} aria-label={`Bracket ${i + 1} quick deduction`} />
                </div>
              ))}
            </div>
          </div>
          <div className="mt-4"><Button type="submit" variant="primary">Save brackets</Button></div>
        </form>
      </section>

      <section aria-labelledby="al-h" className="mt-12 max-w-[820px] border-t border-line pt-6">
        <h2 id="al-h" className="text-[15px] font-semibold">Allowances for everyone</h2>
        <p className="mb-4 mt-1 max-w-[62ch] text-[14px] text-ink-soft">Added to every salaried person each month, as a fixed amount or a percentage of their salary. For one person&apos;s allowance, add it as a monthly item instead.</p>
        <div className="mb-6 overflow-x-auto rounded-md border border-line bg-raised">
          <div className="min-w-[640px]">
            {allowances.length === 0 && <p className="px-4 py-6 text-center text-[14px] text-ink-soft">No allowances.</p>}
            {allowances.map(a => (
              <div key={a.id} className="grid grid-cols-[minmax(160px,1fr)_130px_100px_70px_auto_auto] items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
                <form id={`a-${a.id}`} action={saveAllowance}><input type="hidden" name="id" value={a.id} /></form>
                <Input form={`a-${a.id}`} name="name" defaultValue={a.name} aria-label="Allowance name" required />
                <Select form={`a-${a.id}`} name="kind" defaultValue={a.kind} aria-label={`Kind for ${a.name}`}><option value="fixed">Fixed USD</option><option value="percent">% of salary</option></Select>
                <Input form={`a-${a.id}`} name="amount" type="number" step="0.01" min={0} defaultValue={a.amount} aria-label={`Amount for ${a.name}`} required />
                <label className="flex items-center gap-2 text-[13px]"><input form={`a-${a.id}`} type="checkbox" name="isActive" defaultChecked={a.isActive} className={check} /> On</label>
                <Button form={`a-${a.id}`} type="submit">Save</Button>
                <form action={deleteAllowance}><input type="hidden" name="id" value={a.id} /><ConfirmButton variant="danger" message={`Delete the allowance "${a.name}"? Payroll months already finalized keep their figures.`}>Delete</ConfirmButton></form>
              </div>
            ))}
          </div>
        </div>
        <form action={saveAllowance} className="grid items-end gap-3 sm:grid-cols-[minmax(160px,1fr)_130px_110px_auto]">
          <label className="block"><span className="mb-1.5 block text-[13px] font-medium">New allowance</span><Input name="name" defaultValue={echoOne(echo, 'name')} placeholder="Transport" required /></label>
          <label className="block"><span className="mb-1.5 block text-[13px] font-medium">Kind</span><Select name="kind" defaultValue={echoOne(echo, 'kind') || 'fixed'}><option value="fixed">Fixed USD</option><option value="percent">% of salary</option></Select></label>
          <label className="block"><span className="mb-1.5 block text-[13px] font-medium">Amount</span><Input name="amount" type="number" step="0.01" min={0} defaultValue={echoOne(echo, 'amount')} required /></label>
          <input type="hidden" name="isActive" value="on" />
          <Button type="submit" variant="primary">Add</Button>
        </form>
      </section>
    </>
  )
}
