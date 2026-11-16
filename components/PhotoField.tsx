'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, Crop } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { looksHeic, toJpegIfHeic } from '@/lib/heic'

const SIDE = 400            // the picture is saved about this wide; staff photos never need more
const VIEW = 320            // the editing square, in its own drawing units (shown at up to 320 CSS px)
const LIMIT = 2 * 1024 * 1024
const TYPES = ['image/jpeg', 'image/png', 'image/webp']

type View = { s: number; ox: number; oy: number }   // picture scale (view px per picture px) and where its top-left sits in the square

const coverScale = (b: ImageBitmap) => VIEW / Math.min(b.width, b.height)
const fitScale = (b: ImageBitmap) => VIEW / Math.max(b.width, b.height)
const maxScale = (b: ImageBitmap) => Math.max(coverScale(b) * 3, fitScale(b) * 2)

// How far the picture may be pulled past the edge of the square (the gap shows white). A portrait that exactly fills the width
// would otherwise not move sideways at all, and a face that sits off-centre could never be centred in the circle.
const SLACK = VIEW * 0.3

// Keep the picture from being lost: it may leave the square by SLACK on any side, never further.
function clamp(b: ImageBitmap, v: View): View {
  const lim = (size: number, o: number) => { const d = VIEW - size; return Math.min(Math.max(o, Math.min(d, 0) - SLACK), Math.max(d, 0) + SLACK) }
  return { s: v.s, ox: lim(b.width * v.s, v.ox), oy: lim(b.height * v.s, v.oy) }
}

// Where the picture sits when the editor opens: the biggest square, a little above the middle on a portrait (faces sit high).
function start(b: ImageBitmap): View {
  const s = coverScale(b)
  return clamp(b, { s, ox: (VIEW - b.width * s) / 2, oy: b.height > b.width ? (VIEW - b.height * s) * 0.2 : (VIEW - b.height * s) / 2 })
}

// Draw the picture as it will be saved, onto a canvas of `out` px. Empty space (a picture zoomed out smaller than the square) is white.
function paint(ctx: CanvasRenderingContext2D, b: ImageBitmap, v: View, out: number) {
  const k = out / VIEW
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out, out)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(b, 0, 0, b.width, b.height, v.ox * k, v.oy * k, b.width * v.s * k, b.height * v.s * k)
}

async function render(b: ImageBitmap, v: View): Promise<File> {
  const canvas = document.createElement('canvas')
  canvas.width = SIDE; canvas.height = SIDE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no canvas')
  paint(ctx, b, v, SIDE)
  const blob: Blob | null = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85))
  if (!blob) throw new Error('no blob')
  return new File([blob], 'photo.jpg', { type: 'image/jpeg' })
}

// The photo part of the staff form: shows the current picture (or initials) and lets HR choose a new one. A chosen picture opens in a
// small editor: drag it to move, slide (or scroll) to zoom, then "Use this photo". The circle in the editor is what the staff list
// and profile show. The result is shrunk to a square JPEG on this computer (about 40 KB) and rides in the same form post as every other field.
export function PhotoField({ name, currentUrl }: { name: string; currentUrl?: string }) {
  const input = useRef<HTMLInputElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const source = useRef<ImageBitmap | null>(null)     // the picture as chosen, kept so it can be adjusted again
  const sourceName = useRef('')
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const [preview, setPreview] = useState<string>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [remove, setRemove] = useState(false)
  const [editing, setEditing] = useState(false)
  const [view, setView] = useState<View>({ s: 1, ox: 0, oy: 0 })

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  useEffect(() => () => { source.current?.close?.() }, [])
  // Whether this browser can open pictures for editing. Decided after the first paint so the server's HTML and the browser's agree.
  const [canEdit, setCanEdit] = useState(false)
  useEffect(() => { setCanEdit(typeof createImageBitmap === 'function') }, [])

  const clearInput = () => { if (input.current) input.current.value = '' }

  // Redraw the editing square: the picture, then a dimmed surround with a circle cut out (the part that will be shown round).
  useEffect(() => {
    const b = source.current, c = canvas.current
    if (!editing || !b || !c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    paint(ctx, b, view, VIEW)
    ctx.fillStyle = 'rgba(20,24,33,0.5)'
    ctx.beginPath(); ctx.rect(0, 0, VIEW, VIEW); ctx.arc(VIEW / 2, VIEW / 2, VIEW / 2 - 4, 0, Math.PI * 2, true); ctx.fill('evenodd')
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(VIEW / 2, VIEW / 2, VIEW / 2 - 4, 0, Math.PI * 2); ctx.stroke()
  }, [editing, view])

  // Zoom keeping the point (cx, cy) of the square where it is.
  function zoomTo(s: number, cx = VIEW / 2, cy = VIEW / 2) {
    const b = source.current
    if (!b) return
    setView(v => {
      const ns = Math.min(Math.max(s, fitScale(b)), maxScale(b))
      return clamp(b, { s: ns, ox: cx - (cx - v.ox) * (ns / v.s), oy: cy - (cy - v.oy) * (ns / v.s) })
    })
  }

  // Scrolling the wheel over the editor zooms; it has to be a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const c = canvas.current
    if (!editing || !c) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = c.getBoundingClientRect()
      const px = ((e.clientX - r.left) / r.width) * VIEW, py = ((e.clientY - r.top) / r.height) * VIEW
      setView(v => {
        const b = source.current
        if (!b) return v
        const ns = Math.min(Math.max(v.s * Math.exp(-e.deltaY * 0.0015), fitScale(b)), maxScale(b))
        return clamp(b, { s: ns, ox: px - (px - v.ox) * (ns / v.s), oy: py - (py - v.oy) * (ns / v.s) })
      })
    }
    c.addEventListener('wheel', onWheel, { passive: false })
    return () => c.removeEventListener('wheel', onWheel)
  }, [editing])

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = drag.current, b = source.current
    if (!d || d.id !== e.pointerId || !b) return
    const k = VIEW / e.currentTarget.getBoundingClientRect().width
    const dx = (e.clientX - d.x) * k, dy = (e.clientY - d.y) * k
    drag.current = { id: d.id, x: e.clientX, y: e.clientY }
    setView(v => clamp(b, { ...v, ox: v.ox + dx, oy: v.oy + dy }))
  }
  function up(e: React.PointerEvent<HTMLCanvasElement>) { if (drag.current?.id === e.pointerId) drag.current = null }
  function key(e: React.KeyboardEvent<HTMLCanvasElement>) {
    const b = source.current
    if (!b) return
    const step = 12
    const by: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (by[e.key]) { e.preventDefault(); const [dx, dy] = by[e.key]; setView(v => clamp(b, { ...v, ox: v.ox + dx, oy: v.oy + dy })) }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomTo(view.s * 1.1) }
    else if (e.key === '-') { e.preventDefault(); zoomTo(view.s / 1.1) }
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    setNote('')
    if (!file) return
    const heic = looksHeic(file)
    if (!heic && !TYPES.includes(file.type)) { clearInput(); setNote('Choose a JPG, PNG, WebP or HEIC picture.'); return }
    if (typeof createImageBitmap !== 'function') {
      if (heic) { clearInput(); setNote('This browser cannot open HEIC pictures. Choose a JPG instead.'); return }
      // A browser that cannot edit sends the original as it is; the server still checks it and refuses anything over 2 MB.
      setRemove(false); setPreview(URL.createObjectURL(file)); setNote(`${file.name}, ${Math.max(1, Math.round(file.size / 1024))} KB.`)
      return
    }
    setBusy(true)
    let bmp: ImageBitmap
    try {
      // An iPhone HEIC picture is turned into a JPEG first (on this computer); then it is edited like any other.
      const usable = heic ? await toJpegIfHeic(file) : file
      // A file that claims to be a picture but cannot be opened as one is refused here, before it is sent.
      bmp = await createImageBitmap(usable)
    } catch (err) { setBusy(false); clearInput(); setNote(heic && err instanceof Error && /HEIC/.test(err.message) ? err.message : 'That file could not be opened as a picture. Choose another.'); return }
    setBusy(false)
    // The file is held here, not in the form, until "Use this photo": a form sent while editing carries no half-chosen picture.
    clearInput()
    source.current?.close?.()
    source.current = bmp; sourceName.current = file.name
    setView(start(bmp)); setEditing(true)
  }

  // Re-frame the photo already saved on the record: fetch it (the signed link allows this), open it in the same editor, and
  // "Use this photo" uploads the new framing in place of the old one. Nothing changes until then.
  async function adjustSaved() {
    if (!currentUrl || busy) return
    setNote(''); setBusy(true)
    try {
      const res = await fetch(currentUrl)
      if (!res.ok) throw new Error(String(res.status))
      const bmp = await createImageBitmap(await res.blob())
      source.current?.close?.()
      source.current = bmp; sourceName.current = 'saved'
      setView(start(bmp)); setEditing(true)
    } catch { setNote('The saved photo could not be opened here. Use "Change photo" to choose it again.') }
    setBusy(false)
  }

  async function apply() {
    const b = source.current
    if (!b) return
    setBusy(true)
    let use: File
    try { use = await render(b, view) } catch { setBusy(false); setNote('The picture could not be prepared. Choose another.'); return }
    setBusy(false)
    if (use.size > LIMIT) { setNote(`That picture is ${(use.size / 1048576).toFixed(1)} MB and could not be made smaller. Choose another.`); return }
    if (input.current) { const dt = new DataTransfer(); dt.items.add(use); input.current.files = dt.files }
    setRemove(false)
    setPreview(URL.createObjectURL(use))
    setEditing(false)
    setNote(`Ready, ${Math.max(1, Math.round(use.size / 1024))} KB.`)
  }

  // Leave the editor. Nothing was applied yet, so the form is as it was; a photo already applied stays.
  function closeEditor() {
    setEditing(false)
    if (!preview) { source.current?.close?.(); source.current = null }
    setNote('')
  }

  function discard() { clearInput(); setPreview(''); setNote(''); source.current?.close?.(); source.current = null }

  const shown = preview || (remove ? '' : currentUrl || '')
  const b = source.current
  const savedShown = canEdit && !preview && !remove && !!currentUrl   // the saved photo can be re-framed
  const canAdjust = !editing && ((!!preview && !!b) || savedShown)
  const openAdjust = () => { if (preview) setEditing(true); else void adjustSaved() }
  const lo = b ? fitScale(b) : 1, hi = b ? maxScale(b) : 2
  const zoom = Math.max(0, Math.min(1, Math.log(view.s / lo) / Math.log(hi / lo)))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-6">
        {canAdjust
          ? <button type="button" onClick={openAdjust} title="Click to adjust the photo" aria-label="Adjust the photo" className="shrink-0 rounded-full transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"><Avatar name={name} url={shown} size={144} /></button>
          : <Avatar name={name} url={shown} size={144} />}
        <div className="space-y-2">
          <span className="block text-[13px] font-medium text-ink">Photo</span>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded border border-line-strong bg-raised px-3.5 text-[13px] font-medium text-ink transition-colors focus-within:border-brand hover:bg-brand-wash">
              <Camera size={16} aria-hidden />
              {shown ? 'Change photo' : 'Choose photo'}
              <input ref={input} type="file" name="photo" accept={[...TYPES, '.heic', '.heif', 'image/heic', 'image/heif'].join(',')} onChange={onPick} className="sr-only" />
            </label>
            {canAdjust && (
              <button type="button" onClick={openAdjust} disabled={busy} className="inline-flex h-9 items-center gap-2 rounded border border-line-strong bg-raised px-3.5 text-[13px] font-medium text-ink transition-colors hover:bg-brand-wash">
                <Crop size={16} aria-hidden />Adjust
              </button>
            )}
            {preview && !editing && <button type="button" onClick={discard} className="touch-target text-[13px] text-ink-soft underline decoration-line-strong hover:text-ink">Cancel</button>}
            {currentUrl && !preview && !editing && (
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-soft">
                <input type="checkbox" name="removePhoto" checked={remove} onChange={e => setRemove(e.target.checked)} className="h-4 w-4 accent-[oklch(0.46_0.15_258)]" />
                Remove photo
              </label>
            )}
          </div>
          <p className="max-w-[44ch] text-[12px] text-ink-soft" role="status" aria-live="polite">
            {busy ? 'Preparing the picture…' : note || 'JPG, PNG, WebP or iPhone HEIC. After choosing, drag and zoom it to frame the face before saving.'}
          </p>
        </div>
      </div>

      {editing && (
        <div className="w-full max-w-[340px] space-y-3 rounded-md border border-line bg-raised p-3">
          <canvas
            ref={canvas} width={VIEW} height={VIEW} tabIndex={0}
            role="img" aria-label="Photo editor. Drag to move the picture, use plus and minus to zoom."
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
            className="block aspect-square w-full cursor-grab touch-none rounded border border-line bg-white active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          />
          <label className="flex items-center gap-3 text-[12px] text-ink-soft">
            <span className="shrink-0">Zoom</span>
            <input
              type="range" min={0} max={1000} value={Math.round(zoom * 1000)}
              onChange={e => zoomTo(lo * Math.pow(hi / lo, Number(e.target.value) / 1000))}
              aria-label="Zoom" className="h-4 w-full accent-[oklch(0.46_0.15_258)]"
            />
          </label>
          <p className="text-[12px] text-ink-soft">Drag the picture in any direction to move it. The circle is what shows in the staff list and on the profile; zoom out to fit the whole picture.</p>
          <div className="flex items-center gap-3">
            <button type="button" onClick={apply} disabled={busy} className="inline-flex h-9 items-center rounded bg-brand px-4 text-[13px] font-medium text-white transition-colors hover:bg-brand-deep disabled:opacity-60">Use this photo</button>
            <button type="button" onClick={() => setView(start(source.current!))} className="touch-target text-[13px] text-ink-soft underline decoration-line-strong hover:text-ink">Reset</button>
            <button type="button" onClick={closeEditor} className="touch-target text-[13px] text-ink-soft underline decoration-line-strong hover:text-ink">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
