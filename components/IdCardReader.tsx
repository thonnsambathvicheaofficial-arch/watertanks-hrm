'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, ScanLine } from 'lucide-react'
import { findIdCardOwner } from '@/app/(app)/staff/actions'
import { ORIGINAL_MAX_BYTES, type CardFields, type Field } from '@/lib/id-card'

type State =
  | { kind: 'idle' }
  | { kind: 'reading'; message: string; fraction: number }
  | { kind: 'error'; message: string }
  | { kind: 'done'; fields: CardFields; mrzFound: boolean; url: string; originalNote: string }

// What goes into which form field, and what each is called on the review panel.
const TARGETS: { key: keyof CardFields; input: string; label: string }[] = [
  { key: 'name', input: 'name', label: 'Name' },
  { key: 'nameKh', input: 'nameKh', label: 'Name in Khmer' },
  { key: 'gender', input: 'gender', label: 'Gender' },
  { key: 'dateOfBirth', input: 'dateOfBirth', label: 'Date of birth' },
  { key: 'idCardNo', input: 'idCardNo', label: 'ID card number' },
  { key: 'address', input: 'address', label: 'Address' },
]
const INFO: { key: keyof CardFields; label: string }[] = [
  { key: 'birthplace', label: 'Place of birth' },
  { key: 'expiry', label: 'Card valid until' },
]
const SHOWN: Record<string, (v: string) => string> = { gender: v => (v === 'M' ? 'Male' : v === 'F' ? 'Female' : v) }

// Put a value into an uncontrolled form field the way typing would, and mark how far it can be trusted.
function fill(form: HTMLFormElement, name: string, value: string, status: 'ok' | 'check') {
  const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null
  if (!el || !('value' in el)) return
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }))
  el.setAttribute('data-id', status)
  // Once a person edits the field they have looked at it: the amber marking goes.
  const clear = () => { el.removeAttribute('data-id'); el.removeEventListener('input', onEdit) }
  const onEdit = (e: Event) => { if (e.isTrusted) clear() }
  el.addEventListener('input', onEdit)
}

// "Add staff from ID": the HR person chooses a photo of the front of the national ID card, the card is read in the browser,
// the form below is filled in, and the person reviews every field before pressing Add. The picture itself is posted with the
// form (field "idCard") so it is kept on the staff record.
export function IdCardReader({ keepOriginal = false }: { keepOriginal?: boolean }) {
  const root = useRef<HTMLDivElement>(null)
  const pick = useRef<HTMLInputElement>(null)
  const post = useRef<HTMLInputElement>(null)
  const postOriginal = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [owners, setOwners] = useState<{ pin: string; name: string }[]>([])

  useEffect(() => () => { if (state.kind === 'done') URL.revokeObjectURL(state.url) }, [state])

  async function onChoose(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setOwners([])
    if (post.current) post.current.value = ''
    if (postOriginal.current) postOriginal.current.value = ''
    setState({ kind: 'reading', message: 'Starting', fraction: 0 })
    try {
      const { readCard } = await import('@/lib/id-ocr')
      const r = await readCard(file, (message, fraction) => setState({ kind: 'reading', message, fraction }))
      const form = root.current!.closest('form') as HTMLFormElement
      const done: CardFields = r.fields
      for (const t of TARGETS) {
        const f = done[t.key] as Field | undefined
        if (f?.value) fill(form, t.input, f.value, f.verified ? 'ok' : 'check')
      }
      // The card picture rides along with the form, upright and shrunk, so it is stored with the person.
      if (post.current) {
        const dt = new DataTransfer(); dt.items.add(new File([r.card], 'id-card.jpg', { type: 'image/jpeg' })); post.current.files = dt.files
      }
      // A scanned PDF is kept as it is too, so HR can refer back to the whole scan; only its cut-out card is shown on the page.
      let originalNote = ''
      if (keepOriginal && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) {
        if (file.size <= ORIGINAL_MAX_BYTES) {
          if (postOriginal.current) { const dt = new DataTransfer(); dt.items.add(file); postOriginal.current.files = dt.files }
          originalNote = `The original PDF (${Math.max(1, Math.round(file.size / 1024))} KB) will be kept with the card.`
        } else originalNote = `The PDF is ${(file.size / 1048576).toFixed(1)} MB, over the ${(ORIGINAL_MAX_BYTES / 1048576).toFixed(1)} MB limit, so only the cut-out card will be saved.`
      }
      setState({ kind: 'done', fields: done, mrzFound: r.mrzFound, url: URL.createObjectURL(r.card), originalNote })
      if (done.idCardNo?.value) setOwners(await findIdCardOwner(done.idCardNo.value).catch(() => []))
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'The card could not be read.' })
    } finally {
      if (pick.current) pick.current.value = ''
    }
  }

  const reading = state.kind === 'reading'
  return (
    <div ref={root} className="max-w-[760px] space-y-4 rounded-md border border-line bg-raised p-5">
      <div className="flex flex-wrap items-center gap-4">
        <label className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded bg-brand px-4 text-[14px] font-medium text-white transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand hover:bg-brand-deep ${reading ? 'pointer-events-none opacity-60' : ''}`}>
          <ScanLine size={18} aria-hidden />
          {state.kind === 'done' ? 'Read another card' : 'Choose ID card photo or PDF'}
          <input ref={pick} type="file" accept="image/*,application/pdf,.pdf" onChange={onChoose} disabled={reading} className="sr-only" />
        </label>
        <p className="max-w-[46ch] text-[13px] text-ink-soft">
          A photo or a scanned PDF showing the <strong className="font-medium text-ink">front</strong> of the Cambodian national ID card, clear and flat, no glare. A scan with the back of the card beside it is fine. It is read on this computer and nothing is saved until you press Add staff member.
        </p>
      </div>
      <input ref={post} type="file" name="idCard" tabIndex={-1} aria-hidden className="sr-only" />
      <input ref={postOriginal} type="file" name="idCardOriginal" tabIndex={-1} aria-hidden className="sr-only" />

      {reading && (
        <div role="status" aria-live="polite">
          <div className="mb-1 text-[13px] text-ink-soft">{state.message}…</div>
          <div className="h-1.5 w-full max-w-[420px] overflow-hidden rounded bg-brand-wash" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.fraction * 100)}>
            <div className="h-full bg-brand transition-[width] duration-300" style={{ width: `${Math.max(4, Math.round(state.fraction * 100))}%` }} />
          </div>
        </div>
      )}

      {state.kind === 'error' && <p role="alert" className="text-[13px] text-absent">{state.message}</p>}

      {owners.length > 0 && (
        <div role="alert" className="flex gap-2 rounded border border-absent/40 bg-absent-wash px-3 py-2 text-[13px] text-absent">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>This ID number is already on record for {owners.map(o => `${o.name || 'unnamed'} (PIN ${o.pin})`).join(', ')}. Check you are not adding the same person twice.</span>
        </div>
      )}

      {state.kind === 'done' && (
        <div className="grid gap-5 sm:grid-cols-[minmax(0,260px)_1fr]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <a href={state.url} target="_blank" rel="noreferrer" title="Open the card picture full size"><img src={state.url} alt="The ID card photo that was read" className="w-full rounded border border-line" /></a>
          <div>
            {!state.mrzFound && (
              <p role="alert" className="mb-3 rounded border border-late/40 bg-late-wash px-3 py-2 text-[13px] text-late">
                The number strip at the bottom of the card could not be found, so the ID number, date of birth and gender could not be checked. Try a flatter, brighter photo with the whole card in view, or fill them in by hand.
              </p>
            )}
            {state.originalNote && <p className="mb-3 text-[13px] text-ink-soft">{state.originalNote}</p>}
            <ul className="space-y-1.5 text-[13px]">
              {TARGETS.map(t => {
                const f = state.fields[t.key] as Field | undefined
                return (
                  <li key={t.key} className="flex items-start gap-2">
                    {f?.value
                      ? f.verified
                        ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-present" aria-label="Matched the card's check digit" />
                        : <AlertTriangle size={15} className="mt-0.5 shrink-0 text-late" aria-label="Please check against the card" />
                      : <span className="mt-0.5 inline-block h-[15px] w-[15px] shrink-0 rounded-full border border-line-strong" aria-label="Not found" />}
                    <span className="w-[8.5rem] shrink-0 text-ink-soft">{t.label}</span>
                    <span lang={t.key === 'nameKh' || t.key === 'address' ? 'km' : undefined} className="min-w-0 break-words">{f?.value ? (SHOWN[t.key]?.(f.value) ?? f.value) : <span className="text-ink-faint">not found, type it in</span>}</span>
                  </li>
                )
              })}
              {INFO.map(t => {
                const f = state.fields[t.key] as Field | undefined
                return f?.value ? (
                  <li key={t.key} className="flex items-start gap-2 text-ink-soft">
                    <span className="mt-0.5 inline-block h-[15px] w-[15px] shrink-0" aria-hidden />
                    <span className="w-[8.5rem] shrink-0">{t.label}</span>
                    <span lang={t.key === 'birthplace' ? 'km' : undefined} className="min-w-0 break-words">{f.value}</span>
                  </li>
                ) : null
              })}
            </ul>
            <p className="mt-3 text-[12px] text-ink-soft">
              <CheckCircle2 size={12} className="mr-1 inline text-present" aria-hidden />Green: proven by the card&apos;s own check digit.{' '}
              <AlertTriangle size={12} className="mr-1 inline text-late" aria-hidden />Amber: read from the picture, so compare it with the card. Amber fields in the form turn plain once you edit them.
              The Khmer name is the hardest part for the reader: always compare it with the card.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
