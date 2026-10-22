import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ConfirmButton } from '@/components/ConfirmButton'
import { DisciplineStatus, TextArea } from '@/components/DisciplineBits'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { Button, Field, Flash, Input, MigrationNotice, PageHeader, Select } from '@/components/ui'
import { decodeEcho, echoOne } from '@/lib/echo'
import { MONTH_NAMES, usd } from '@/lib/utils'
import { confirmRecord, discardRecord, issueLetter, markSigned, saveRecord, withdrawRecord } from '../actions'
import { guard } from '@/lib/guard'
import { safeReturn, withReturn } from '@/lib/return-to'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { records } = require('@/lib/discipline-store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const D = require('@/lib/discipline')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { todayStr } = require('@/lib/report-data')

export const metadata: Metadata = { title: 'Discipline record' }
export const dynamic = 'force-dynamic'

type Rec = { id: string; pin: string | null; staffCode: string; staffName: string; position: string; department: string; source: string; occurredOn: string; kind: string; reason: string; deduction: number | null; payrollYear: number | null; payrollMonth: number | null; status: string; payrollEntryId: string | null; letterIssuedOn: string | null; letterIssuedBy: string; acknowledgedOn: string | null; createdBy: string; createdAt: string; confirmedBy: string; confirmedAt: string | null; withdrawnBy: string; withdrawnAt: string | null; withdrawnReason: string }
type Person = { staffCode: string; name: string; nameKh: string; position: string; departmentName: string }

const day = (iso: string | null) => (iso ? String(iso).slice(0, 10) : '')

export default async function DisciplineRecordPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; saved?: string; v?: string; return?: string } }) {
  const me = await guard()
  if (!(await records.ready())) return <><PageHeader title="Discipline" /><MigrationNotice file="009_discipline.sql" /></>
  const r: Rec | null = await records.get(params.id)
  if (!r) notFound()
  const [people, others]: [Record<string, Person>, Rec[]] = await Promise.all([records.people(), r.pin ? records.list({ pin: r.pin }) : Promise.resolve([r])])
  const p: Person & { inStaffList: boolean } = D.who(r, people)
  const canEdit = me.perms.includes('discipline.edit')
  const echo = decodeEcho(searchParams.v)
  const v = (k: string, fb = '') => echoOne(echo, k) ?? fb
  const ladder = D.ladder(others)
  const payrollMonth = r.payrollYear && r.payrollMonth ? `${r.payrollYear}-${String(r.payrollMonth).padStart(2, '0')}` : ''
  const payrollLabel = r.payrollYear && r.payrollMonth ? `${MONTH_NAMES[r.payrollMonth - 1]} ${r.payrollYear}` : ''
  const hidden = <input type="hidden" name="id" value={r.id} />
  const row = (label: string, value: React.ReactNode) => <div className="flex justify-between gap-4 border-b border-line py-2 last:border-b-0"><dt className="text-ink-soft">{label}</dt><dd className="text-right font-medium">{value || <span className="font-normal text-ink-faint">None</span>}</dd></div>

  return (
    <>
      <PageHeader title={p.name} note={<>{D.KINDS[r.kind].label} · <span className="num">{r.occurredOn}</span></>}>
        <DisciplineStatus status={r.status} />
        <Link href={safeReturn(searchParams.return) || '/discipline'} className="text-[14px] text-ink-soft underline decoration-line-strong hover:text-ink">{safeReturn(searchParams.return) ? 'Back' : 'All records'}</Link>
      </PageHeader>
      <Flash error={searchParams.error} saved={searchParams.saved} />
      {!canEdit && <ReadOnlyNotice text="You can see this record but not change it." />}

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
        <div className="space-y-8">
          <section aria-labelledby="rec-h">
            <h2 id="rec-h" className="mb-2 text-[15px] font-semibold">The record</h2>
            <dl className="rounded-md border border-line bg-raised px-4 py-1 text-[14px]">
              {row('Staff', <>{p.name}{p.nameKh && <span className="ml-2 font-normal text-ink-soft">{p.nameKh}</span>}{r.pin && <span className="num ml-2 font-normal text-ink-faint">PIN {r.pin}</span>}{!p.inStaffList && <div className="text-[12px] font-normal text-ink-soft">Not in the staff list: the name, position and department are as written on the record.</div>}</>)}
              {row('Staff ID', <span className="num">{p.staffCode}</span>)}
              {row('Position', p.position)}
              {row('Department', p.departmentName)}
              {row('Occurrence date', <span className="num">{r.occurredOn}</span>)}
              {row('ការណែនាំ / ការព្រមាន', <>{D.KINDS[r.kind].label}<span className="ml-2 font-normal text-ink-soft">{D.KINDS[r.kind].kh}</span></>)}
              {row('Reason', <span className="whitespace-pre-wrap font-normal">{r.reason}</span>)}
              {row('Salary deduction', r.deduction ? <>{usd(r.deduction)}<span className="ml-2 font-normal text-ink-soft">{r.source === 'import' ? 'taken from pay before this system' : `from ${payrollLabel} payroll`}</span>{r.status === 'confirmed' && r.source !== 'import' && <div className="text-[12px] font-normal text-ink-soft">On Monthly items as a withholding</div>}</> : '')}
              {row(r.source === 'import' ? 'Imported from the factory register' : 'Recorded', <span className="font-normal">{r.createdBy ? `by ${r.createdBy}` : ''} <span className="num text-ink-soft">{day(r.createdAt)}</span></span>)}
              {r.status !== 'draft' && row(r.status === 'withdrawn' ? 'Was confirmed' : 'Confirmed', <span className="font-normal">{r.confirmedBy ? `by ${r.confirmedBy}` : ''} <span className="num text-ink-soft">{day(r.confirmedAt)}</span></span>)}
              {r.status === 'withdrawn' && row('Withdrawn', <span className="font-normal">{r.withdrawnBy ? `by ${r.withdrawnBy} ` : ''}<span className="num text-ink-soft">{day(r.withdrawnAt)}</span><div>{r.withdrawnReason}</div></span>)}
              {r.status === 'confirmed' && r.kind !== 'noted' && row('Warning letter', r.letterIssuedOn ? <span className="font-normal">Issued <span className="num">{r.letterIssuedOn}</span>{r.letterIssuedBy ? ` by ${r.letterIssuedBy}` : ''}</span> : 'Not issued yet')}
              {r.status === 'confirmed' && row('Signed by the staff member', r.acknowledgedOn ? <span className="num font-normal">{r.acknowledgedOn}</span> : 'Not yet')}
            </dl>
          </section>

          {others.length > 1 && (
            <section aria-labelledby="hist-h">
              <h2 id="hist-h" className="mb-2 text-[15px] font-semibold">This person&apos;s record</h2>
              <p className="mb-2 text-[13px] text-ink-soft">
                {ladder.warnings} confirmed warning{ladder.warnings === 1 ? '' : 's'}{ladder.top ? `, highest: ${D.KINDS[ladder.top].label}` : ''}.{ladder.next ? ` The next step on the ladder would be a ${D.KINDS[ladder.next].label.toLowerCase()}.` : ladder.top ? ' This is the end of the ladder.' : ''}
              </p>
              <TableWrap>
                <Table wide={false}>
                  <thead><tr><Th>Date</Th><Th>Type</Th><Th>Reason</Th><Th>Status</Th></tr></thead>
                  <tbody>
                    {others.map(o => (
                      <tr key={o.id} className={o.id === r.id ? 'bg-brand-wash/60' : undefined}>
                        <Td className="num whitespace-nowrap"><Link href={withReturn(`/discipline/${o.id}`, searchParams.return || '')} className="text-brand-deep underline underline-offset-2 hover:text-brand">{o.occurredOn}</Link></Td>
                        <Td className="whitespace-nowrap">{D.KINDS[o.kind].label}</Td>
                        <Td className="max-w-[260px] truncate text-ink-soft">{o.reason}</Td>
                        <Td><DisciplineStatus status={o.status} /></Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            </section>
          )}
        </div>

        {canEdit && r.status !== 'withdrawn' && (
          <aside className="space-y-6">
            {r.status === 'draft' && (
              <section aria-labelledby="edit-h" className="rounded-md border border-line bg-raised p-4">
                <h2 id="edit-h" className="mb-3 text-[15px] font-semibold">Draft</h2>
                <form action={saveRecord} className="grid gap-3">
                  {hidden}
                  <Field label="Occurrence date"><Input type="date" name="date" defaultValue={v('date', r.occurredOn)} max={todayStr()} required /></Field>
                  <Field label="Type (ការណែនាំ / ការព្រមាន)">
                    <Select name="kind" defaultValue={v('kind', r.kind)}>{D.KIND_KEYS.map((k: string) => <option key={k} value={k}>{D.KINDS[k].label} · {D.KINDS[k].kh}</option>)}</Select>
                  </Field>
                  <Field label="Reason"><TextArea name="reason" defaultValue={v('reason', r.reason)} required maxLength={2000} /></Field>
                  <Field label="Salary deduction (USD, optional)"><Input name="deduction" defaultValue={v('deduction', r.deduction ? String(r.deduction) : '')} inputMode="decimal" /></Field>
                  <Field label="Payroll month" hint="Empty means the month it happened."><Input type="month" name="payrollMonth" defaultValue={v('payrollMonth', payrollMonth)} /></Field>
                  <div><Button type="submit">Save changes</Button></div>
                </form>
                <form action={confirmRecord} className="mt-4 border-t border-line pt-4">
                  {hidden}
                  <ConfirmButton variant="primary" pendingLabel="Confirming" message={r.deduction ? `Confirm this ${D.KINDS[r.kind].label.toLowerCase()} for ${p.name}? USD ${r.deduction.toFixed(2)} will be added to the ${payrollLabel} payroll as a salary deduction.` : `Confirm this ${D.KINDS[r.kind].label.toLowerCase()} for ${p.name}?`}>Confirm{r.deduction ? ' and apply deduction' : ''}</ConfirmButton>
                </form>
                <form action={discardRecord} className="mt-2">
                  {hidden}
                  <ConfirmButton variant="danger" message="Discard this draft? It is deleted, and nothing was sent to payroll.">Discard draft</ConfirmButton>
                </form>
              </section>
            )}

            {r.status === 'confirmed' && (
              <>
                {r.kind !== 'noted' && <section aria-labelledby="letter-h" className="rounded-md border border-line bg-raised p-4">
                  <h2 id="letter-h" className="mb-1 text-[15px] font-semibold">Warning letter</h2>
                  <p className="mb-3 text-[13px] text-ink-soft">English and Khmer, ready to print and sign.</p>
                  {r.letterIssuedOn ? (
                    <Link href={withReturn(`/discipline/${r.id}/letter`, searchParams.return || '')} className="inline-flex h-9 items-center rounded border border-line-strong bg-raised px-3.5 text-[13px] font-medium text-ink transition-colors hover:bg-brand-wash">Open the letter to print</Link>
                  ) : (
                    <form action={issueLetter}>{hidden}<Button type="submit" variant="primary">Issue warning letter</Button></form>
                  )}
                  {r.letterIssuedOn && !r.acknowledgedOn && (
                    <form action={markSigned} className="mt-4 grid gap-3 border-t border-line pt-4">
                      {hidden}
                      <Field label="Date the staff member signed"><Input type="date" name="signedOn" defaultValue={v('signedOn', todayStr())} max={todayStr()} required /></Field>
                      <div><Button type="submit">Mark as signed</Button></div>
                    </form>
                  )}
                </section>}
                <section aria-labelledby="wd-h" className="rounded-md border border-line bg-raised p-4">
                  <h2 id="wd-h" className="mb-1 text-[15px] font-semibold">Withdraw</h2>
                  <p className="mb-3 text-[13px] text-ink-soft">If this was a mistake or is cancelled. The record stays for the history{r.deduction ? ', and its salary deduction is removed from payroll' : ''}.</p>
                  <form action={withdrawRecord} className="grid gap-3">
                    {hidden}
                    <Field label="Why is it withdrawn?"><Input name="reason" defaultValue={v('reason')} required /></Field>
                    <div><ConfirmButton variant="danger" message={`Withdraw this record${r.deduction ? ' and remove its salary deduction from payroll' : ''}?`}>Withdraw</ConfirmButton></div>
                  </form>
                </section>
              </>
            )}
          </aside>
        )}
      </div>
    </>
  )
}
