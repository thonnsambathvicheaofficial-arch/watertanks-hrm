'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, CreditCard, FileText, ScanLine } from 'lucide-react'
import { removeIdCardAction, saveIdCard } from '@/app/(app)/staff/actions'
import { ConfirmButton } from '@/components/ConfirmButton'
import { SubmitButton } from '@/components/SubmitButton'
import { ORIGINAL_MAX_BYTES } from '@/lib/id-card'
import type { ReadResult } from '@/lib/id-ocr'

type State =
  | { kind: 'idle' }
  | { kind: 'reading'; message: string; fraction: number }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; url: string; kb: number; mrzFound: boolean; cardNo: string; originalNote: string }

// The digits of an ID number, without spaces or the "(01)" suffix some records carry.
const core = (v: string) => String(v || '').replace(/\([^)]*\)/g, '').replace(/\D/g, '')

// On an existing staff record: the national ID card kept with it so HR can open it later. The file is read by the SAME reader
// as "Add staff from ID" (a photo, or a scanned PDF where the card is a small part of the page): the front of the card is found,
// cut out and shown here, and "Save ID card" stores it on its own, without needing the rest of the form saved.
// Opening a saved card uses a link that expires after ten minutes.
export function IdCardField({ currentUrl, originalUrl, keepOriginal = false, knownIdNo = '' }: { currentUrl?: string; originalUrl?: string; keepOriginal?: boolean; knownIdNo?: string }) {
  const pick = useRef<HTMLInputElement>(null)
  const post = useRef<HTMLInputElement>(null)
  const postOriginal = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<State>({ kind: 'idle' })
  useEffect(() => () => { if (state.kind === 'ready') URL.revokeObjectURL(state.url) }, [state])
  // Once the saved card changes (just saved, replaced or removed) the page has new data: clear the chosen file and the review panel,
  // or "Save changes" would send the same card again. The address of the card file (not its changing access token) is the signal.
  const saved = (currentUrl || '').split('?')[0]
  useEffect(() => { if (post.current) post.current.value = ''; if (postOriginal.current) postOriginal.current.value = ''; setState({ kind: 'idle' }) }, [saved])

  async function onChoose(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (post.current) post.current.value = ''
    if (postOriginal.current) postOriginal.current.value = ''
    setState({ kind: 'reading', message: 'Starting', fraction: 0 })
    try {
      const { readCard } = await import('@/lib/id-ocr')
      const r: ReadResult = await readCard(file, (message, fraction) => setState({ kind: 'reading', message, fraction }))
      if (post.current) { const dt = new DataTransfer(); dt.items.add(new File([r.card], 'id-card.jpg', { type: 'image/jpeg' })); post.current.files = dt.files }
      // A scanned PDF is kept as it is too, beside the cut-out card.
      let originalNote = ''
      if (keepOriginal && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) {
        if (file.size <= ORIGINAL_MAX_BYTES) {
          if (postOriginal.current) { const dt = new DataTransfer(); dt.items.add(file); postOriginal.current.files = dt.files }
          originalNote = `The original PDF (${Math.max(1, Math.round(file.size / 1024))} KB) will be kept too, so HR can open the whole scan later.`
        } else originalNote = `The PDF is ${(file.size / 1048576).toFixed(1)} MB, over the ${(ORIGINAL_MAX_BYTES / 1048576).toFixed(1)} MB limit, so only the cut-out card will be saved.`
      }
      setState({ kind: 'ready', url: URL.createObjectURL(r.card), kb: Math.max(1, Math.round(r.card.size / 1024)), mrzFound: r.mrzFound, cardNo: r.fields.idCardNo?.value || '', originalNote })
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'That file could not be used.' })
    } finally { if (pick.current) pick.current.value = '' }
  }

  function cancel() { if (post.current) post.current.value = ''; if (postOriginal.current) postOriginal.current.value = ''; setState({ kind: 'idle' }) }

  const reading = state.kind === 'reading'
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {currentUrl
          ? <a href={currentUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded border border-line-strong bg-raised px-3.5 text-[13px] font-medium text-ink transition-colors hover:bg-brand-wash"><CreditCard size={16} aria-hidden />View ID card</a>
          : <span className="text-[13px] text-ink-soft">No ID card on file.</span>}
        {currentUrl && originalUrl && <a href={originalUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded border border-line-strong bg-raised px-3.5 text-[13px] font-medium text-ink transition-colors hover:bg-brand-wash"><FileText size={16} aria-hidden />Open original PDF</a>}
        <label className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded border border-line-strong bg-raised px-3.5 text-[13px] font-medium text-ink transition-colors focus-within:border-brand hover:bg-brand-wash ${reading ? 'pointer-events-none opacity-60' : ''}`}>
          <ScanLine size={16} aria-hidden />
          {currentUrl ? 'Replace ID card' : 'Upload ID card'}
          <input ref={pick} type="file" accept="image/*,application/pdf,.pdf,.heic,.heif" onChange={onChoose} disabled={reading} className="sr-only" />
        </label>
        {currentUrl && state.kind !== 'ready' && (
          <ConfirmButton variant="danger" formAction={removeIdCardAction} message="Remove this ID card from the staff record? The saved picture will be deleted." pendingLabel="Removing">Remove ID card</ConfirmButton>
        )}
      </div>
      <input ref={post} type="file" name="idCard" tabIndex={-1} aria-hidden className="sr-only" />
      <input ref={postOriginal} type="file" name="idCardOriginal" tabIndex={-1} aria-hidden className="sr-only" />

      {state.kind === 'idle' && <p className="text-[12px] text-ink-soft">A photo (JPG, PNG or iPhone HEIC) or a scanned PDF of the front of the ID card. A PDF is kept as it is too, next to the cut-out card. Kept privately: only people who can edit staff can open them.</p>}

      {reading && (
        <div role="status" aria-live="polite">
          <div className="mb-1 text-[13px] text-ink-soft">{state.message}…</div>
          <div className="h-1.5 w-full max-w-[420px] overflow-hidden rounded bg-brand-wash" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.fraction * 100)}>
            <div className="h-full bg-brand transition-[width] duration-300" style={{ width: `${Math.max(4, Math.round(state.fraction * 100))}%` }} />
          </div>
        </div>
      )}

      {state.kind === 'error' && <p role="alert" className="text-[13px] text-absent">{state.message}</p>}

      {state.kind === 'ready' && (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,260px)_1fr]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <a href={state.url} target="_blank" rel="noreferrer" title="Open the card picture full size"><img src={state.url} alt="The ID card that will be saved" className="w-full rounded border border-line" /></a>
          <div className="space-y-2 text-[13px]">
            {state.mrzFound
              ? <p className="flex items-start gap-2 text-ink"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-present" aria-hidden />The front of the card was found and cut out ({state.kb} KB).</p>
              : <p role="alert" className="flex items-start gap-2 rounded border border-late/40 bg-late-wash px-3 py-2 text-late"><AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />The number strip on the front of the card could not be found. Check the picture shows the front of the card before saving.</p>}
            {state.originalNote && <p className="text-ink-soft">{state.originalNote}</p>}
            {state.cardNo && (() => {
              const same = core(state.cardNo) === core(knownIdNo)
              if (!core(knownIdNo)) return <p className="text-ink-soft">The card shows ID number <span className="num font-medium text-ink">{state.cardNo}</span>. This record has no ID card number yet, so it was not compared.</p>
              return same
                ? <p className="flex items-start gap-2 text-ink"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-present" aria-hidden />The ID number on the card (<span className="num">{state.cardNo}</span>) matches this person&apos;s record.</p>
                : <p role="alert" className="flex items-start gap-2 rounded border border-absent/40 bg-absent-wash px-3 py-2 text-absent"><AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />The card shows ID number <span className="num font-medium">{state.cardNo}</span> but this record has <span className="num font-medium">{knownIdNo}</span>. Make sure this is the right person&apos;s card.</p>
            })()}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <SubmitButton variant="primary" formAction={saveIdCard} pendingLabel="Saving">Save ID card</SubmitButton>
              <button type="button" onClick={cancel} className="touch-target text-[13px] text-ink-soft underline decoration-line-strong hover:text-ink">Cancel</button>
            </div>
            <p className="text-[12px] text-ink-soft">This saves the ID card only. Other changes you have typed in this form are not saved by this button.</p>
          </div>
        </div>
      )}
    </div>
  )
}
