'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { Avatar } from '@/components/Avatar'

const SIDE = 400            // the picture is saved about this wide; staff photos never need more
const LIMIT = 2 * 1024 * 1024
const TYPES = ['image/jpeg', 'image/png', 'image/webp']

// Cut the biggest square out of the picture (a little above the middle, where faces are in a portrait),
// shrink it to SIDE px and save it as JPEG. A phone photo of 4 MB becomes about 40 KB, so the upload is quick
// and the storage stays tiny. Throws if the browser cannot read the picture.
async function shrink(file: File): Promise<File> {
  const bmp = await createImageBitmap(file)
  const side = Math.min(bmp.width, bmp.height)
  const out = Math.min(SIDE, side)
  const canvas = document.createElement('canvas')
  canvas.width = out; canvas.height = out
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no canvas')
  const sx = (bmp.width - side) / 2
  const sy = bmp.height > bmp.width ? (bmp.height - side) * 0.25 : (bmp.height - side) / 2
  ctx.drawImage(bmp, sx, sy, side, side, 0, 0, out, out)
  bmp.close?.()
  const blob: Blob | null = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85))
  if (!blob) throw new Error('no blob')
  return new File([blob], 'photo.jpg', { type: 'image/jpeg' })
}

// The photo part of the staff form: shows the current picture (or initials), lets HR choose a new one with a live preview,
// and, for someone who already has a photo, remove it. The chosen file rides in the same form post as every other field.
export function PhotoField({ name, currentUrl }: { name: string; currentUrl?: string }) {
  const input = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [remove, setRemove] = useState(false)

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const clearInput = () => { if (input.current) input.current.value = '' }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    setNote('')
    if (!file) { setPreview(''); return }
    if (!TYPES.includes(file.type)) { clearInput(); setPreview(''); setNote('Choose a JPG, PNG or WebP picture.'); return }
    setBusy(true)
    let use: File = file
    if (typeof createImageBitmap === 'function') {
      // A file that claims to be a picture but cannot be opened as one is refused here, before it is sent.
      try { use = await shrink(file) } catch { setBusy(false); clearInput(); setPreview(''); setNote('That file could not be opened as a picture. Choose another.'); return }
    }
    // (A browser without createImageBitmap sends the original; the server still checks it and refuses anything over 2 MB.)
    setBusy(false)
    if (use.size > LIMIT) { clearInput(); setPreview(''); setNote(`That picture is ${(use.size / 1048576).toFixed(1)} MB and could not be made smaller. Choose another.`); return }
    if (input.current && use !== file) {
      const dt = new DataTransfer(); dt.items.add(use); input.current.files = dt.files
    }
    setRemove(false)
    setPreview(URL.createObjectURL(use))
    setNote(`${use.name === 'photo.jpg' ? 'Ready' : file.name}, ${Math.max(1, Math.round(use.size / 1024))} KB.`)
  }

  function discard() { clearInput(); setPreview(''); setNote('') }

  const shown = preview || (remove ? '' : currentUrl || '')

  return (
    <div className="flex flex-wrap items-center gap-5">
      <Avatar name={name} url={shown} size={96} />
      <div className="space-y-2">
        <span className="block text-[13px] font-medium text-ink">Photo</span>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded border border-line-strong bg-raised px-3.5 text-[13px] font-medium text-ink transition-colors focus-within:border-brand hover:bg-brand-wash">
            <Camera size={16} aria-hidden />
            {shown ? 'Change photo' : 'Choose photo'}
            <input ref={input} type="file" name="photo" accept={TYPES.join(',')} onChange={onPick} className="sr-only" />
          </label>
          {preview && <button type="button" onClick={discard} className="touch-target text-[13px] text-ink-soft underline decoration-line-strong hover:text-ink">Cancel</button>}
          {currentUrl && !preview && (
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-soft">
              <input type="checkbox" name="removePhoto" checked={remove} onChange={e => setRemove(e.target.checked)} className="h-4 w-4 accent-[oklch(0.46_0.15_258)]" />
              Remove photo
            </label>
          )}
        </div>
        <p className="text-[12px] text-ink-soft" role="status" aria-live="polite">
          {busy ? 'Preparing the picture…' : note || 'JPG, PNG or WebP. It is cropped square and shrunk on this computer before it is sent.'}
        </p>
      </div>
    </div>
  )
}
