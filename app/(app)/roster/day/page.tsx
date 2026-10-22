import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { Button, EmptyState, Field, Flash, Input, PageHeader, Select, StatusBadge } from '@/components/ui'
import { decodeEcho, echoOne } from '@/lib/echo'
import { dayName, to12h } from '@/lib/utils'
import { removeOverride, saveOverride } from './actions'
import { guard } from '@/lib/guard'
import { safeReturn } from '@/lib/return-to'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { reportData } = require('@/lib/report-data')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const store = require('@/lib/store')

export const metadata: Metadata = { title: 'Correct a day' }
export const dynamic = 'force-dynamic'

type Row = { pin: string; name: string; date: string; status: string; in: string | null; out: string | null; hours: number; punches: number; note?: string | null; overridden: boolean; holiday?: string; leaveCode?: string }
type Ov = { status: string; note: string; timeIn: string | null; timeOut: string | null; setBy: string | null; setAt: string | null; originalStatus: string | null }

const STATUS_OPTIONS = [
  { v: 'present', t: 'Present', hint: 'Worked this day. Add in and out times if a scan is missing.' },
  { v: 'excused', t: 'Excused', hint: 'Counts as worked: a forgiven late, missed scan or approved absence with pay.' },
  { v: 'leave', t: 'Leave', hint: 'On leave. For a recorded request use Leave instead, so balances stay right.' },
  { v: 'day_off', t: 'Day off', hint: 'Not expected to work.' },
]

export default async function DayPage({ searchParams }: { searchParams: { pin?: string; date?: string; month?: string; return?: string; error?: string; saved?: string; v?: string } }) {
  await guard()
  const pin = searchParams.pin || '', date = searchParams.date || ''
  if (!pin || !/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound()
  const month = searchParams.month || date.slice(0, 7)

  const [computed, current, devices, ovs] = await Promise.all([
    reportData({ from: date, to: date, pin, skipOverrides: true }),
    reportData({ from: date, to: date, pin }),
    store.devices.list(),
    store.overrides.query({ from: date, to: date, pin }),
  ])
  const base: Row | undefined = computed.daily[0]
  const now: Row | undefined = current.daily[0]
  if (!base || !now) notFound()
  const ov: Ov | undefined = ovs[0]
  const deviceName: Record<string, string> = Object.fromEntries(devices.map((d: { id: string; name: string }) => [d.id, d.name]))
  const punches: { id: string; time: string; deviceId: string }[] = [...computed.punches].sort((a, b) => (a.time < b.time ? -1 : 1))
  const ret = safeReturn(searchParams.return)
  const echo = decodeEcho(searchParams.v)
  const val = (k: string, fb: string | null | undefined) => echoOne(echo, k) ?? fb ?? ''

  return (
    <>
      <PageHeader title={now.name || `PIN ${pin}`} note={<>{dayName(date)}, <span className="num">{date}</span> · PIN <span className="num">{pin}</span></>}>
        <Link href={`${ret || `/roster?month=${month}`}#c-${pin}-${date}`} className="touch-target text-[14px] text-ink-soft underline decoration-line-strong hover:text-ink">Back to roster</Link>
      </PageHeader>
      <Flash error={searchParams.error} saved={searchParams.saved} />

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-8">
          <section aria-labelledby="sys-h">
            <h2 id="sys-h" className="mb-2 text-[15px] font-semibold">What the scans say</h2>
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px]">
              <StatusBadge status={base.status} />
              <span className="num">{base.in ? `${to12h(base.in)} to ${base.out ? to12h(base.out) : 'no out scan'}` : 'No scans'}</span>
              {base.hours > 0 && <span className="num text-ink-soft">{base.hours} h</span>}
              {base.holiday && <span className="text-holiday">Public holiday: {base.holiday}</span>}
              {base.leaveCode && <span className="text-leave">Approved leave ({base.leaveCode}){base.note ? `: ${base.note}` : ''}</span>}
            </div>
            <TableWrap>
              <Table wide={false}>
                <thead><tr><Th>Scan time</Th><Th>Device</Th></tr></thead>
                <tbody>
                  {punches.length === 0 && <tr><td colSpan={2}><EmptyState title="No scans on this day" /></td></tr>}
                  {punches.map(p => <tr key={p.id}><Td className="num font-medium">{to12h(p.time.slice(11, 16))}<span className="ml-2 text-[12px] font-normal text-ink-faint">{p.time.slice(11, 19)}</span></Td><Td className="text-ink-soft">{deviceName[p.deviceId] || ''}</Td></tr>)}
                </tbody>
              </Table>
            </TableWrap>
          </section>

          {ov && (
            <section aria-labelledby="cur-h">
              <h2 id="cur-h" className="mb-2 text-[15px] font-semibold">Current correction</h2>
              <div className="rounded-md border border-line bg-raised p-4 text-[14px]">
                <div className="mb-2 flex flex-wrap items-center gap-3"><StatusBadge status={ov.status} /><span className="num text-ink-soft">{ov.timeIn && ov.timeOut ? `${to12h(ov.timeIn)} to ${to12h(ov.timeOut)}` : 'Times from scans'}</span></div>
                <p className="mb-2 whitespace-pre-wrap">{ov.note}</p>
                <p className="text-[12px] text-ink-soft">Set by {ov.setBy || 'unknown'}{ov.setAt ? ` on ${ov.setAt.slice(0, 10)}` : ''}{ov.originalStatus ? `. The scans had it as ${ov.originalStatus.replace('_', ' ')}.` : ''}</p>
              </div>
            </section>
          )}
        </div>

        <section aria-labelledby="fix-h" className="xl:border-l xl:border-line xl:pl-8">
          <h2 id="fix-h" className="mb-1 text-[15px] font-semibold">{ov ? 'Change the correction' : 'Correct this day'}</h2>
          <p className="mb-4 text-[13px] text-ink-soft">A correction replaces what the scans show for this day in every report. The scans themselves are never changed.</p>
          <form action={saveOverride} className="space-y-4">
            <input type="hidden" name="pin" value={pin} /><input type="hidden" name="date" value={date} /><input type="hidden" name="month" value={month} /><input type="hidden" name="return" value={ret} />
            <input type="hidden" name="originalStatus" value={base.status} />
            <Field label="Status">
              <Select name="status" defaultValue={val('status', ov?.status || (base.status === 'absent' ? 'excused' : 'present'))}>
                {STATUS_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.t}</option>)}
              </Select>
            </Field>
            <ul className="-mt-2 space-y-0.5 text-[12px] text-ink-soft">{STATUS_OPTIONS.map(o => <li key={o.v}><span className="font-medium text-ink">{o.t}.</span> {o.hint}</li>)}</ul>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="In time"><Input type="time" name="timeIn" defaultValue={val('timeIn', ov?.timeIn)} /></Field>
              <Field label="Out time" hint="Out earlier than in means the next morning."><Input type="time" name="timeOut" defaultValue={val('timeOut', ov?.timeOut)} /></Field>
            </div>
            <Field label="Note" hint="Required. Say what happened. Khmer is fine.">
              <textarea name="note" required rows={3} defaultValue={val('note', ov?.note)} className="w-full rounded border border-line-strong bg-raised px-3 py-2 text-[14px] text-ink transition-colors hover:border-ink-faint focus-visible:border-brand" />
            </Field>
            <Button type="submit" variant="primary">{ov ? 'Save change' : 'Save correction'}</Button>
          </form>
          {ov && (
            <form action={removeOverride} className="mt-6 border-t border-line pt-4">
              <input type="hidden" name="pin" value={pin} /><input type="hidden" name="date" value={date} /><input type="hidden" name="month" value={month} /><input type="hidden" name="return" value={ret} />
              <ConfirmButton variant="danger" message="Remove this correction? The day will follow the scans again.">Remove correction</ConfirmButton>
            </form>
          )}
        </section>
      </div>
    </>
  )
}
