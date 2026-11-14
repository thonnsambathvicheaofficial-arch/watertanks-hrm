// Staff profile photos (migration 010).
//
// The picture is kept in the private Storage bucket "staff-photos"; employees.photo_path holds only the file's name.
// Nothing here puts image bytes in the employees table, which every report reads.
//
// The browser shrinks each photo to about 400 px before upload (components/PhotoField.tsx), so a normal upload is
// 20 to 60 KB. This file is the server-side gate: whatever arrives is checked by its own bytes (never by the file
// name or the type the browser claims) and capped at 2 MB, the same limit the bucket enforces.
const crypto = require('crypto')
const sb = require('./supabase')

const BUCKET = 'staff-photos'
const ID_BUCKET = 'staff-ids'     // the national ID card photos (migration 011): a separate private bucket
const MAX_BYTES = 2 * 1024 * 1024
const SIGNED_SECONDS = 60 * 60
// The original ID card PDF kept beside the cropped picture. 3.5 MB keeps the whole upload (this plus the cropped picture)
// under the 4.5 MB a serverless request may carry. Mirrors ORIGINAL_MAX_BYTES in lib/id-card.ts, which the browser checks first.
const ORIGINAL_MAX_BYTES = 3.5 * 1024 * 1024

// What the bytes really are: JPEG, PNG or WebP (or a PDF, when allowed), or null.
function sniff(buf, allowPdf = false) {
  if (!buf || buf.length < 12) return null
  if (allowPdf && buf.toString('latin1', 0, 5) === '%PDF-') return { type: 'application/pdf', ext: 'pdf' }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' }
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG' && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return { type: 'image/png', ext: 'png' }
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return { type: 'image/webp', ext: 'webp' }
  return null
}

// A message for the person using the app, or null when the photo is acceptable.
function problem(buf) {
  if (!buf || !buf.length) return 'The photo file is empty.'
  if (buf.length > MAX_BYTES) return `The photo is ${(buf.length / 1048576).toFixed(1)} MB. The limit is 2 MB. Choose a smaller picture.`
  if (!sniff(buf)) return 'The photo must be a JPG, PNG or WebP picture.'
  return null
}

// A message for the person using the app, or null when the original PDF is acceptable.
function originalProblem(buf) {
  if (!buf || !buf.length) return 'The PDF file is empty.'
  if (buf.length > ORIGINAL_MAX_BYTES) return `The PDF is ${(buf.length / 1048576).toFixed(1)} MB. The limit is 3.5 MB.`
  const kind = sniff(buf, true)
  if (!kind || kind.type !== 'application/pdf') return 'The original must be a PDF file.'
  return null
}

// A new name for every upload, so a replaced photo is never served from an old cached copy. The PIN is not in it:
// a PIN can be changed and may contain characters that do not belong in a file name.
const newName = (ext) => `${crypto.randomUUID()}.${ext}`

// The same three operations for any private bucket: the staff photos and the ID card photos share this code.
function files(bucket, { label = 'Photo', seconds = SIGNED_SECONDS } = {}) {
  return {
    async put(buf, allowPdf = false) {
      const kind = sniff(buf, allowPdf)
      const name = newName(kind.ext)
      const { error } = await sb.storage.from(bucket).upload(name, buf, { contentType: kind.type, upsert: false, cacheControl: '3600' })
      if (error) throw new Error(`${label} upload failed: ${error.message}`)
      return name
    },
    // Best effort: an orphaned file costs a few KB, so a failed delete is never worth failing a save for.
    async drop(name) {
      if (!name) return
      try { await sb.storage.from(bucket).remove([name]) } catch { /* orphaned file, harmless */ }
    },
    // One call for the whole list. Returns { path: signedUrl } for every path that could be signed.
    async urls(paths) {
      const list = [...new Set((paths || []).filter(Boolean))]
      if (!list.length) return {}
      const { data, error } = await sb.storage.from(bucket).createSignedUrls(list, seconds)
      if (error || !data) return {}
      const out = {}
      for (const r of data) if (r && r.path && r.signedUrl && !r.error) out[r.path] = r.signedUrl
      return out
    },
  }
}

const photos = files(BUCKET)
// An ID card link is short-lived (10 minutes): it is only ever shown to someone allowed to edit staff, on the page they are looking at.
const idCards = files(ID_BUCKET, { label: 'ID card', seconds: 600 })

module.exports = { BUCKET, ID_BUCKET, MAX_BYTES, ORIGINAL_MAX_BYTES, sniff, problem, originalProblem, put: photos.put, drop: photos.drop, urls: photos.urls, idCards }
