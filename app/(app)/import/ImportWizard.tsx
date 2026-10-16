'use client'

import { useRef, useState, useTransition } from 'react'
import { Button, Field, Select } from '@/components/ui'
import { Table, TableWrap, Td, Th } from '@/components/Table'
import { cn } from '@/lib/utils'
import { applyChunk, finishImport, previewImport, type ChunkResult, type Preview } from './actions'

export interface KindInfo { key: string; label: string; blurb: string; chunk: number }
type Totals = { added: number; changed: number; same: number; skipped: number; failed: ChunkResult['failed'] }

const STATUS: Record<string, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'text-present' },
  changed: { label: 'Changed', cls: 'text-brand-deep' },
  same: { label: 'No change', cls: 'text-ink-soft' },
  error: { label: 'Error', cls: 'text-absent' },
}
const show = (v: unknown) => (v === '' || v === null || v === undefined ? 'empty' : String(v))

export function ImportWizard({ kinds }: { kinds: KindInfo[] }) {
  const [kind, setKind] = useState(kinds[0]?.key ?? '')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState('')
  const [skip, setSkip] = useState(false)
  const [showSame, setShowSame] = useState(false)
  const [done, setDone] = useState<Totals | null>(null)
  const [progress, setProgress] = useState('')
  const [pending, start] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)
  const info = kinds.find(k => k.key === kind)

  const reset = () => { setPreview(null); setDone(null); setError(''); setSkip(false); setShowSame(false); if (fileRef.current) fileRef.current.value = '' }

  const onPreview = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setError(''); setDone(null); setPreview(null)
    start(async () => {
      const r = await previewImport(fd)
      if ('error' in r) setError(r.error); else setPreview(r)
    })
  }

  const onApply = () => {
    if (!preview || !info) return
    const rows = preview.rows
    start(async () => {
      const t: Totals = { added: 0, changed: 0, same: 0, skipped: 0, failed: [] }
      for (let i = 0; i < rows.length; i += info.chunk) {
        setProgress(`Importing ${Math.min(i + info.chunk, rows.length)} of ${rows.length}`)
        const r = await applyChunk(preview.kind, rows.slice(i, i + info.chunk))
        if ('error' in r) { setError(`${r.error} ${t.added + t.changed} row${t.added + t.changed === 1 ? ' was' : 's were'} saved before this stopped.`); break }
        t.added += r.added; t.changed += r.changed; t.same += r.same; t.skipped += r.skipped; t.failed.push(...r.failed)
      }
      await finishImport(preview.kind, preview.filename, t)
      setProgress(''); setPreview(null); setDone(t)
      if (fileRef.current) fileRef.current.value = ''
    })
  }

  const c = preview?.counts
  const writes = c ? c.new + c.changed : 0
  const blocked = !!c && c.error > 0 && !skip
  const rowsShown = preview ? preview.plan.filter(p => showSame || p.status !== 'same') : []

  return (
    <div className="space-y-6">
      <form onSubmit={onPreview} className="grid max-w-[820px] items-end gap-3 sm:grid-cols-[1fr_1.4fr_auto]">
        <Field label="What to import">
          <Select name="kind" value={kind} onChange={e => { setKind(e.target.value); reset() }} disabled={pending}>
            {kinds.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
          </Select>
        </Field>
        <Field label="Excel file (.xlsx)">
          <input ref={fileRef} type="file" name="file" accept=".xlsx,.xls" required disabled={pending} onChange={() => { setPreview(null); setDone(null); setError('') }}
            className="block h-9 w-full rounded border border-line-strong bg-raised text-[13px] text-ink file:mr-3 file:h-full file:cursor-pointer file:border-0 file:border-r file:border-line-strong file:bg-paper file:px-3 file:text-[13px] file:font-medium" />
        </Field>
        <Button type="submit" variant="primary" disabled={pending}>{pending && !progress ? 'Checking' : 'Check file'}</Button>
      </form>
      {info && <p className="-mt-3 max-w-[70ch] text-[13px] text-ink-soft">{info.blurb} Nothing is saved until you confirm below.</p>}

      {error && <div role="alert" className="max-w-[820px] rounded border border-absent/35 bg-absent-wash px-3.5 py-2.5 text-[14px] text-absent">{error}</div>}
      {progress && <div role="status" className="max-w-[820px] rounded border border-line bg-paper px-3.5 py-2.5 text-[14px]">{progress}. Keep this page open.</div>}

      {done && (
        <section role="status" aria-labelledby="done-h" className="max-w-[820px] rounded-md border border-present/35 bg-present-wash p-4">
          <h2 id="done-h" className="text-[15px] font-semibold text-present">Import finished</h2>
          <p className="mt-1 text-[14px]">
            {[done.added && `${done.added} added`, done.changed && `${done.changed} changed`, done.same && `${done.same} already up to date`, done.skipped && `${done.skipped} skipped for errors`].filter(Boolean).join(', ') || 'Nothing needed to change'}.
            {' '}Each change is in the <a className="underline" href="/settings/audit">audit log</a>.
          </p>
          {done.failed.length > 0 && (
            <div className="mt-3">
              <p className="text-[14px] font-medium text-absent">{done.failed.length} row{done.failed.length === 1 ? '' : 's'} could not be saved:</p>
              <ul className="mt-1 space-y-0.5 text-[13px]">{done.failed.map(f => <li key={f.line}>Line {f.line}, {f.label}: {f.message}</li>)}</ul>
            </div>
          )}
        </section>
      )}

      {preview && c && (
        <section aria-labelledby="prev-h" className="space-y-4">
          <div>
            <h2 id="prev-h" className="text-[15px] font-semibold">{preview.filename}</h2>
            <p className="mt-1 text-[14px] text-ink-soft">
              {preview.plan.length} row{preview.plan.length === 1 ? '' : 's'} read: <b className="font-medium text-present">{c.new} new</b>, <b className="font-medium text-brand-deep">{c.changed} changed</b>, {c.same} unchanged, <b className={cn('font-medium', c.error && 'text-absent')}>{c.error} with errors</b>.
            </p>
            {preview.ignored.length > 0 && <p className="mt-1 text-[13px] text-ink-soft">Columns not recognised and left out: {preview.ignored.join(', ')}.</p>}
          </div>

          <TableWrap>
            <Table wide={false}>
              <thead><tr><Th>Line</Th><Th>Row</Th><Th>Result</Th><Th>What will change</Th></tr></thead>
              <tbody>
                {rowsShown.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-[14px] text-ink-soft">Every row already matches what is saved.</td></tr>}
                {rowsShown.map(p => (
                  <tr key={p.line}>
                    <Td className="num text-ink-soft">{p.line}</Td>
                    <Td className="font-medium">{p.label}</Td>
                    <Td><span className={cn('font-medium', STATUS[p.status].cls)}>{STATUS[p.status].label}</span></Td>
                    <Td className="text-[13px]">
                      {p.status === 'error' ? <span className="text-absent">{p.message}</span>
                        : p.status === 'new' ? <span className="text-ink-soft">{p.changes && p.changes.length ? p.changes.map(x => `${x.field}: ${show(x.to)}`).join('; ') : 'Will be added'}</span>
                        : p.changes && p.changes.length ? p.changes.map(x => <span key={x.field} className="mr-3 inline-block"><span className="text-ink-soft">{x.field}:</span> {show(x.from)} <span aria-hidden>→</span><span className="sr-only"> to </span> {show(x.to)}</span>) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <label className="flex cursor-pointer items-center gap-2 text-[14px]"><input type="checkbox" checked={showSame} onChange={e => setShowSame(e.target.checked)} className="h-4 w-4 accent-[oklch(0.46_0.15_258)]" />Show unchanged rows</label>
            {c.error > 0 && <label className="flex cursor-pointer items-center gap-2 text-[14px]"><input type="checkbox" checked={skip} onChange={e => setSkip(e.target.checked)} className="h-4 w-4 accent-[oklch(0.46_0.15_258)]" />Skip the {c.error} row{c.error === 1 ? '' : 's'} with errors and import the rest</label>}
          </div>

          <div className="flex items-center gap-3">
            <Button type="button" variant="primary" onClick={onApply} disabled={pending || blocked || writes === 0}>
              {writes === 0 ? 'Nothing to import' : `Import ${writes} row${writes === 1 ? '' : 's'}`}
            </Button>
            <Button type="button" onClick={reset} disabled={pending}>Start over</Button>
            {blocked && <span className="text-[13px] text-absent">Fix the errors in the file and check it again, or choose to skip those rows.</span>}
          </div>
        </section>
      )}
    </div>
  )
}
