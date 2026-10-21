import type { Metadata } from 'next'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { Button, EmptyState, Field, Flash, Input, MigrationNotice, PageHeader, Select } from '@/components/ui'
import { SubmitButton } from '@/components/SubmitButton'
import { decodeEcho, echoAll, echoOne } from '@/lib/echo'
import { guard } from '@/lib/guard'
import { saveNotifications, sendTestMessage } from './actions'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const notify = require('@/lib/notify')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hr = require('@/lib/hr-store')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const store = require('@/lib/store')

export const metadata: Metadata = { title: 'Telegram notifications' }
export const dynamic = 'force-dynamic'

type Log = { id: number; pin: string; ts: string; status: string; reason: string | null; attempts: number; sent_at: string | null; created_at: string }

const when = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Phnom_Penh', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
const STATUS: Record<string, { label: string; cls: string }> = {
  sent: { label: 'Sent', cls: 'text-present' }, failed: { label: 'Failed', cls: 'text-absent' },
  pending: { label: 'Waiting', cls: 'text-late' }, skipped: { label: 'Not announced', cls: 'text-ink-soft' },
}

export default async function NotificationsPage({ searchParams }: { searchParams: { error?: string; saved?: string; v?: string } }) {
  await guard()
  if (!(await notify.ready())) return <><PageHeader title="Telegram notifications" /><MigrationNotice file="006_telegram_notifications.sql" /></>
  const [s, depts, log, people] = await Promise.all([notify.getSettings(), hr.available().then((ok: boolean) => (ok ? hr.departments.list() : [])), notify.recentLog(50), store.employees.names()])
  const e = decodeEcho(searchParams.v)
  const tokenSet = !!notify.token()
  const chosen = new Set<string>(e ? echoAll(e, 'departmentIds') : s.department_ids)
  const v = (k: string, fb: unknown) => String(echoOne(e, k) ?? fb ?? '')

  return (
    <>
      <PageHeader title="Telegram notifications" note="A message in your Telegram group each time a staff member scans: name, department, group, date and time. Only scans saved after you switch this on are announced." />
      <Flash error={searchParams.error} saved={searchParams.saved} />

      <p role="status" className="mb-6 max-w-[70ch] text-[14px]">
        <span className={tokenSet ? 'font-medium text-present' : 'font-medium text-absent'}>{tokenSet ? 'Bot token is set on the server.' : 'Bot token is not set on the server.'}</span>{' '}
        <span className="text-ink-soft">{tokenSet ? 'It is read from the TELEGRAM_BOT_TOKEN setting and is never shown or stored here.' : 'Add TELEGRAM_BOT_TOKEN to the server settings (Vercel and the .env file), then restart. Notifications cannot be switched on until then.'}</span>
      </p>

      <form action={saveNotifications} className="max-w-[720px] space-y-8">
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" name="enabled" defaultChecked={e ? echoOne(e, 'enabled') === 'on' : s.enabled} className="mt-1 h-4 w-4 accent-[oklch(0.46_0.15_258)]" />
          <span><span className="block text-[15px] font-semibold">Send a message for each scan</span><span className="block text-[13px] text-ink-soft">When this is switched on, only scans saved from that moment are announced. Nothing from before is sent.</span></span>
        </label>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Telegram group ID" hint="A number like -1001234567890. Add the bot to the group first."><Input name="chatId" defaultValue={v('chatId', s.chat_id)} autoComplete="off" inputMode="text" /></Field>
          <Field label="Announce">
            <Select name="scopeGroup" defaultValue={v('scopeGroup', s.scope_group)}><option value="all">Everyone</option><option value="office">Office staff only</option><option value="worker">Workers only</option></Select>
          </Field>
        </div>

        <fieldset>
          <legend className="mb-2 text-[13px] font-medium">Departments</legend>
          <p className="mb-2 text-[13px] text-ink-soft">Tick some to announce only those. Tick none to announce every department.</p>
          <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {(depts as { id: string; name: string }[]).map(d => (
              <li key={d.id}><label className="flex min-h-9 cursor-pointer items-center gap-2 text-[14px]"><input type="checkbox" name="departmentIds" value={d.id} defaultChecked={chosen.has(d.id)} className="h-4 w-4 accent-[oklch(0.46_0.15_258)]" />{d.name}</label></li>
            ))}
          </ul>
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Ignore a repeat scan within (seconds)" hint="People often scan twice. 0 announces every scan."><Input type="number" name="ignoreRepeatSeconds" min={0} max={3600} defaultValue={v('ignoreRepeatSeconds', s.ignore_repeat_seconds)} /></Field>
          <Field label="Skip scans older than (minutes)" hint="If the sync was down, old scans are not announced late."><Input type="number" name="maxAgeMinutes" min={1} max={1440} defaultValue={v('maxAgeMinutes', s.max_age_minutes)} /></Field>
          <Field label="Group into one message above" hint="When more than this many scans are waiting, they go out together."><Input type="number" name="digestThreshold" min={1} max={100} defaultValue={v('digestThreshold', s.digest_threshold)} /></Field>
        </div>

        <fieldset className="space-y-3 border-t border-line pt-6">
          <legend className="text-[15px] font-semibold">Who is on leave today</legend>
          {s.digestReady ? (
            <>
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" name="leaveDigestEnabled" defaultChecked={e ? echoOne(e, 'leaveDigestEnabled') === 'on' : s.leave_digest_enabled} className="mt-1 h-4 w-4 accent-[oklch(0.46_0.15_258)]" />
                <span><span className="block text-[14px] font-medium">Send the list each working day</span><span className="block text-[13px] text-ink-soft">Full-day leave, then morning and afternoon half days, with their department and leave type. Nothing is sent on a day off, a public holiday, or when nobody is on leave.</span></span>
              </label>
              <div className="max-w-[200px]"><Field label="Send at" hint="A sync up to 3 hours later still sends it."><Input type="time" name="leaveDigestTime" defaultValue={v('leaveDigestTime', String(s.leave_digest_time).slice(0, 5))} /></Field></div>
            </>
          ) : <p className="max-w-[62ch] text-[13px] text-ink-soft">The daily leave list needs migration 007_telegram_leave_digest.sql. Run it in Supabase, then this option appears.</p>}
        </fieldset>
        <Button type="submit" variant="primary">Save settings</Button>
      </form>

      <form action={sendTestMessage} className="mt-8 max-w-[720px] border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold">Test the connection</h2>
        <p className="mb-3 mt-1 max-w-[62ch] text-[14px] text-ink-soft">Sends one test message to the saved group and tells you which bot and group it reached. Save the group ID first.</p>
        <SubmitButton pendingLabel="Sending" disabled={!tokenSet || !s.chat_id}>Send test message</SubmitButton>
      </form>

      <section aria-labelledby="log-h" className="mt-10">
        <h2 id="log-h" className="mb-3 text-[15px] font-semibold">Latest scans considered</h2>
        <TableWrap>
          <Table wide={false}>
            <thead><tr><Th>Scan</Th><Th>Name</Th><Th>Status</Th><Th>Note</Th></tr></thead>
            <tbody>
              {log.length === 0 && <tr><td colSpan={4}><EmptyState title="Nothing yet">Each scan that is announced, skipped or fails to send is listed here.</EmptyState></td></tr>}
              {(log as Log[]).map(l => {
                const st = STATUS[l.status] || { label: l.status, cls: '' }
                return (
                  <tr key={l.id}>
                    <Td className="num whitespace-nowrap">{String(l.ts).replace('T', ' ').slice(5, 16)}</Td>
                    <Td className="font-medium">{(people as Record<string, string>)[l.pin] || `PIN ${l.pin}`}</Td>
                    <Td><span className={`font-medium ${st.cls}`}>{st.label}</span>{l.sent_at && <span className="num ml-2 text-[12px] text-ink-soft">{when.format(new Date(l.sent_at)).replace(',', '')}</span>}</Td>
                    <Td className="text-[13px] text-ink-soft">{l.reason}{l.status === 'failed' ? ` (tried ${l.attempts}×)` : ''}</Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </TableWrap>
      </section>
    </>
  )
}
