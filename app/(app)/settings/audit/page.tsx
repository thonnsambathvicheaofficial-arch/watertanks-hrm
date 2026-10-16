import type { Metadata } from 'next'
import Link from 'next/link'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { Button, EmptyState, Field, Input, MigrationNotice, PageHeader, Select } from '@/components/ui'
import { guard } from '@/lib/guard'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const audit = require('@/lib/audit')

export const metadata: Metadata = { title: 'Audit log' }
export const dynamic = 'force-dynamic'

type Row = { id: number; at: string; actor: string | null; action: string; entity: string | null; entity_key: string | null; summary: string; details: unknown }
type Sp = { actor?: string; area?: string; from?: string; to?: string; q?: string; page?: string }

const when = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Phnom_Penh', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
const fmt = (iso: string) => when.format(new Date(iso)).replace(',', '')

const show = (v: unknown) => (v === null || v === undefined || v === '' ? 'empty' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const isChange = (v: unknown): v is { from: unknown; to: unknown } => !!v && typeof v === 'object' && 'from' in (v as object) && 'to' in (v as object)

function Details({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return null
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return null
  return (
    <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[13px]">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-soft">{k}</dt>
          <dd className="min-w-0 break-words">
            {isChange(v) ? <><span className="text-ink-soft">{show(v.from)}</span> <span aria-hidden>→</span><span className="sr-only"> changed to </span> {show(v.to)}</> : show(v)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export default async function AuditPage({ searchParams }: { searchParams: Sp }) {
  await guard()
  if (!(await audit.ready())) return <><PageHeader title="Audit log" /><MigrationNotice file="004_roles_audit.sql" /></>
  const [{ rows, total, page, pageSize }, actors]: [{ rows: Row[]; total: number; page: number; pageSize: number }, string[]] = await Promise.all([audit.list(searchParams), audit.actors()])
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const areas = Object.entries(audit.AREAS as Record<string, { label: string }>)

  const keep = { actor: searchParams.actor, area: searchParams.area, from: searchParams.from, to: searchParams.to, q: searchParams.q }
  const qs = (extra: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...keep, ...extra })) if (v !== undefined && v !== '') p.set(k, String(v))
    return p.toString()
  }
  const filtered = Object.values(keep).some(Boolean)

  return (
    <>
      <PageHeader title="Audit log" note="Every change made in this system, newest first. Entries cannot be edited or deleted. Times are Phnom Penh.">
        {total > 0 && <a href={`/api/export/audit?${qs({})}`} className="text-[14px] text-brand-deep underline decoration-line-strong hover:decoration-brand">Download as Excel</a>}
      </PageHeader>

      <form method="get" className="mb-6 grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1.2fr_150px_150px_1.4fr_auto]">
        <Field label="Who">
          <Select name="actor" defaultValue={searchParams.actor || ''}><option value="">Everyone</option>{actors.map(a => <option key={a} value={a}>{a}</option>)}</Select>
        </Field>
        <Field label="Area">
          <Select name="area" defaultValue={searchParams.area || ''}><option value="">All areas</option>{areas.map(([k, a]) => <option key={k} value={k}>{a.label}</option>)}</Select>
        </Field>
        <Field label="From"><Input type="date" name="from" defaultValue={searchParams.from || ''} /></Field>
        <Field label="To"><Input type="date" name="to" defaultValue={searchParams.to || ''} /></Field>
        <Field label="Search"><Input name="q" defaultValue={searchParams.q || ''} placeholder="Person, PIN, shift, period" /></Field>
        <div className="flex gap-2">
          <Button type="submit" variant="primary">Filter</Button>
          {filtered && <Link href="/settings/audit" className="inline-flex h-10 items-center px-2 text-[14px] text-ink-soft underline decoration-line-strong hover:text-ink">Clear</Link>}
        </div>
      </form>

      <TableWrap>
        <Table wide={false}>
          <thead><tr><Th>When</Th><Th>Who</Th><Th>What happened</Th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={3}><EmptyState title={filtered ? 'No entries match' : 'Nothing recorded yet'}>{filtered ? 'Try a wider date range or fewer filters.' : 'Changes made from now on will appear here.'}</EmptyState></td></tr>}
            {rows.map(r => {
              const has = r.details && typeof r.details === 'object' && Object.keys(r.details as object).length > 0
              return (
                <tr key={r.id} className="align-top">
                  <Td className="whitespace-nowrap tabular-nums text-ink-soft">{fmt(r.at)}</Td>
                  <Td className="whitespace-nowrap">{r.actor || <span className="text-ink-soft">System</span>}</Td>
                  <Td className="max-w-[640px]">
                    {has ? (
                      <details>
                        <summary className="cursor-pointer marker:text-ink-soft">{r.summary}</summary>
                        <Details value={r.details} />
                      </details>
                    ) : r.summary}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </TableWrap>

      <nav className="mt-4 flex items-center justify-between text-[14px]" aria-label="Pages">
        <span className="text-ink-soft">{total === 0 ? '' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}</span>
        <span className="flex gap-4">
          {page > 1 && <Link className="text-brand-deep underline decoration-line-strong hover:decoration-brand" href={`/settings/audit?${qs({ page: page - 1 })}`}>Newer</Link>}
          {page < pages && <Link className="text-brand-deep underline decoration-line-strong hover:decoration-brand" href={`/settings/audit?${qs({ page: page + 1 })}`}>Older</Link>}
        </span>
      </nav>
    </>
  )
}
