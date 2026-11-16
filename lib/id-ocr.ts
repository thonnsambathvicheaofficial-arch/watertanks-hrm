// Reads a Cambodian national ID card from a photo or a scanned PDF ON THE USER'S COMPUTER (browser only). The file is never
// sent anywhere to be read: the OCR engine (Tesseract compiled to WebAssembly), the PDF renderer (pdf.js) and the English and
// Khmer language files are all served from this site's own /ocr folder and run in the browser. Nothing here costs the server
// any work.
//
// HR's cards usually arrive as an A4 scan in a PDF, the card about the size of a credit card in a corner with its back beside
// it. So the order is: render the page, find the card-shaped regions, cut each out and enlarge it, and look for the number strip
// (the one with the "KHM" lines marks the front). The photo of a card that fills the frame skips the finding and is read whole.
import { bestMrz, cardFields, parseFront, printedNames, snapMrz, type CardFields, type Front, type Mrz } from '@/lib/id-card'
import { findCards, type Rect } from '@/lib/card-find'
import { looksHeic, toJpegIfHeic } from '@/lib/heic'

export type ReadResult = {
  fields: CardFields; mrz: Mrz | null; front: Front | null
  card: Blob            // the card, upright, at most 1600 px wide, ready to be stored with the staff record
  mrzFound: boolean
}
type Step = (message: string, fraction: number) => void

const PAGE_WIDTH = 2000   // a page or photo is loaded at most this wide: enough for a small card to stay readable once cut out
const CARD_WIDTH = 1600   // a cut-out card is brought to about this width before it is read and stored
const MAX_PDF_PAGES = 4
const ASSETS = { workerPath: '/ocr/worker.min.js', corePath: '/ocr/core', langPath: '/ocr/lang', gzip: false }

export const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)

// ── image helpers (canvas) ──────────────────────────────────────────────────
function canvasOf(w: number, h: number) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c }

async function loadImage(file: File): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, PAGE_WIDTH / bmp.width)
  const c = canvasOf(bmp.width * k, bmp.height * k)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close?.()
  return c
}

// Each page of a PDF drawn to a canvas. Scanned PDFs hold a picture of the page, so this is that picture at a size that suits.
async function loadPdf(file: File, step: Step): Promise<HTMLCanvasElement[]> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = '/ocr/pdf.worker.min.js'
  let doc
  try { doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise } catch (e) {
    const name = (e as { name?: string })?.name
    throw new Error(name === 'PasswordException' ? 'That PDF is password protected. Save an unlocked copy and try again.' : 'That PDF could not be opened.')
  }
  const pages: HTMLCanvasElement[] = []
  for (let i = 1; i <= Math.min(doc.numPages, MAX_PDF_PAGES); i++) {
    step(`Opening page ${i} of the PDF`, 0.02 + 0.04 * (i / Math.min(doc.numPages, MAX_PDF_PAGES)))
    const page = await doc.getPage(i)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: Math.min(4, PAGE_WIDTH / base.width) })
    const c = canvasOf(viewport.width, viewport.height)
    await page.render({ canvasContext: c.getContext('2d')!, viewport }).promise
    pages.push(c)
  }
  await doc.destroy()
  return pages
}

function rotate(src: HTMLCanvasElement, quarter: number): HTMLCanvasElement {
  if (!quarter) return src
  const swap = quarter % 2 === 1
  const c = canvasOf(swap ? src.height : src.width, swap ? src.width : src.height)
  const x = c.getContext('2d')!
  x.translate(c.width / 2, c.height / 2); x.rotate((quarter * Math.PI) / 2); x.drawImage(src, -src.width / 2, -src.height / 2)
  return c
}

function crop2(src: HTMLCanvasElement, top: number, bottom: number, left: number, right: number): HTMLCanvasElement {
  const w = Math.max(8, Math.round(right - left)), h = Math.max(8, Math.round(bottom - top))
  const c = canvasOf(w, h)
  c.getContext('2d')!.drawImage(src, Math.round(left), Math.round(top), w, h, 0, 0, w, h)
  return c
}

function crop(src: HTMLCanvasElement, top: number, bottom: number): HTMLCanvasElement { return crop2(src, top, bottom, 0, src.width) }

// Greyscale, stretch the contrast to the 1st-99th percentile, optionally scale up and optionally cut to pure black and white.
function treat(src: HTMLCanvasElement, opts: { scale?: number; threshold?: number } = {}): HTMLCanvasElement {
  const k = opts.scale ?? 1
  const c = canvasOf(src.width * k, src.height * k)
  const x = c.getContext('2d')!
  x.imageSmoothingQuality = 'high'
  x.drawImage(src, 0, 0, c.width, c.height)
  const img = x.getImageData(0, 0, c.width, c.height), d = img.data
  const hist = new Array<number>(256).fill(0)
  for (let i = 0; i < d.length; i += 4) { const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; d[i] = g; hist[g]++ }
  const total = d.length / 4
  let lo = 0, hi = 255, acc = 0
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.01) { lo = v; break } }
  acc = 0
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.01) { hi = v; break } }
  const span = Math.max(1, hi - lo)
  for (let i = 0; i < d.length; i += 4) {
    let g = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / span))
    if (opts.threshold !== undefined) g = g < opts.threshold ? 0 : 255
    d[i] = d[i + 1] = d[i + 2] = g; d[i + 3] = 255
  }
  x.putImageData(img, 0, 0)
  return c
}

const toBlob = (c: HTMLCanvasElement, q = 0.85) => new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('no image'))), 'image/jpeg', q))

// ── finding the card on the page ────────────────────────────────────────────
// Card-shaped regions of a page, found on a small copy of it (cheap), in the page's own pixels.
function analyse(page: HTMLCanvasElement): { plain: boolean; rects: Rect[] } {
  const k = Math.min(1, 500 / page.width)
  const small = canvasOf(page.width * k, page.height * k)
  const x = small.getContext('2d', { willReadFrequently: true })!
  x.drawImage(page, 0, 0, small.width, small.height)
  const r = findCards(x.getImageData(0, 0, small.width, small.height))
  return { plain: r.plain, rects: r.cards.map(c => ({ ...c, x: c.x / k, y: c.y / k, w: c.w / k, h: c.h / k })) }
}

// One card cut out of the page with a little margin, turned upright if it lay sideways, and enlarged to a size the reader can use.
function cut(page: HTMLCanvasElement, r: Rect): HTMLCanvasElement {
  const padX = r.w * 0.03, padY = r.h * 0.03
  const left = Math.max(0, r.x - padX), top = Math.max(0, r.y - padY)
  const raw = crop2(page, top, Math.min(page.height, r.y + r.h + padY), left, Math.min(page.width, r.x + r.w + padX))
  const turned = r.turned ? rotate(raw, 1) : raw
  const k = Math.min(4, CARD_WIDTH / turned.width)
  if (Math.abs(k - 1) < 0.05) return turned
  const out = canvasOf(turned.width * k, turned.height * k)
  const x = out.getContext('2d')!
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'
  x.drawImage(turned, 0, 0, out.width, out.height)
  return out
}

// ── OCR ─────────────────────────────────────────────────────────────────────
type Worker = { recognize: (img: HTMLCanvasElement) => Promise<{ data: { text: string; confidence: number; lines?: { text: string; bbox: { x0: number; y0: number; x1: number; y1: number }; words: { symbols: { text: string; confidence: number; bbox: { x0: number; x1: number } }[] }[] }[] } }>; setParameters: (p: Record<string, string>) => Promise<unknown>; terminate: () => Promise<unknown> }

async function worker(lang: string, onProgress?: (p: number) => void): Promise<Worker> {
  const { createWorker } = await import('tesseract.js')
  const w = await createWorker(lang, 1, { ...ASSETS, logger: (m: { status?: string; progress?: number }) => { if (m.status === 'recognizing text' && onProgress) onProgress(m.progress || 0) } })
  return w as unknown as Worker
}

const MRZ_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<'

// Where the three MRZ lines are: the card is read once, and the line holding "KHM" followed by digits is the first one.
type Band = { top: number; bottom: number; left: number; right: number }
async function locateMrz(w: Worker, img: HTMLCanvasElement): Promise<Band | null> {
  await w.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '6' })
  const r = await w.recognize(treat(img))
  const lines = r.data.lines || []
  const i = lines.findIndex(l => /KHM[0-9OIBSZ]{6}/.test(l.text.toUpperCase().replace(/[^A-Z0-9<]/g, '')))
  if (i < 0) return null
  const first = lines[i], last = lines[Math.min(lines.length - 1, i + 2)]
  const lh = Math.max(10, first.bbox.y1 - first.bbox.y0)
  const mrzLines = lines.slice(i, i + 3)
  return {
    top: Math.max(0, first.bbox.y0 - lh * 0.6), bottom: Math.min(img.height, last.bbox.y1 + lh * 0.8),
    // The zone runs along the card's whole width, so its ends tell where the card is inside the picture.
    left: Math.min(...mrzLines.map(l => l.bbox.x0)), right: Math.max(...mrzLines.map(l => l.bbox.x1)),
  }
}

/** Read an ID card from a photo or a PDF. Throws a plain-language Error when the file cannot be opened or holds no card. */
export async function readCard(input: File, step: Step): Promise<ReadResult> {
  // A HEIC picture (iPhone) becomes a JPEG first; everything below only sees pictures the browser can open.
  if (looksHeic(input)) step('Converting the HEIC picture', 0.01)
  const file = await toJpegIfHeic(input)
  step(isPdf(file) ? 'Opening the PDF' : 'Opening the picture', 0.02)
  let pages: HTMLCanvasElement[]
  try { pages = isPdf(file) ? await loadPdf(file, step) : [await loadImage(file)] } catch (e) {
    throw e instanceof Error && /PDF/.test(e.message) ? e : new Error('That file could not be opened as a picture.')
  }

  step('Loading the reader (first time only)', 0.08)
  const eng = await worker('eng')
  let card: HTMLCanvasElement | null = null, band: Band | null = null, firstCandidate: HTMLCanvasElement | null = null
  try {
    search: for (let pi = 0; pi < pages.length; pi++) {
      const { plain, rects } = analyse(pages[pi])
      // Card shapes on a plain page; or, for a photo where the card fills the frame, the whole picture. A plain page with no
      // card on it has nothing to read.
      const candidates = rects.length ? rects.map(r => cut(pages[pi], r)) : plain ? [] : [pages[pi]]
      for (let ci = 0; ci < candidates.length; ci++) {
        firstCandidate ??= candidates[ci]
        // A card may lie sideways or upside down in the scan: look for the number strip in each orientation until it is found.
        for (const quarter of [0, 1, 3, 2]) {
          step(pages.length > 1 || candidates.length > 1 ? `Looking for the front of the card (${pi + 1}.${ci + 1})` : quarter ? 'Trying the picture turned' : 'Finding the number strip', 0.12 + quarter * 0.02)
          const turned = rotate(candidates[ci], quarter)
          const b = await locateMrz(eng, turned)
          if (b) { card = turned; band = b; break search }
        }
      }
    }
    if (!card && !firstCandidate) throw new Error('No ID card was found in that file. Use a scan or photo that shows the front of the card.')
    card ??= firstCandidate!

    let mrz: Mrz | null = null
    let printed: string[] = []
    // The face photo fills the left fifth of the card and confuses the reader, so it is cut off, using the width of the number
    // strip to find the card's edges.
    const cardLeft = band ? band.left : 0, cardW = band ? band.right - band.left : card.width
    const above = band ? band.top : card.height * 0.66
    const regionAt = (cut: number) => crop2(card!, 0, above, Math.max(0, Math.min(card!.width - 50, Math.round(cardLeft + cardW * cut))), card!.width)

    if (band) {
      const strip = crop(card, band.top, band.bottom)
      await eng.setParameters({ tessedit_char_whitelist: MRZ_CHARS, tessedit_pageseg_mode: '6' })
      const texts: string[] = []
      // Several treatments of the same strip: a hard black-and-white cut usually reads cleanest, so it goes first.
      const plans = [{ threshold: 120 }, { threshold: 105 }, { threshold: 135 }, { threshold: 150 }, { scale: 1.3, threshold: 120 }, { scale: 0.8, threshold: 120 }, {}]
      for (let i = 0; i < plans.length; i++) {
        step('Reading the number strip', 0.3 + (i / plans.length) * 0.22)
        const read = (await eng.recognize(treat(strip, plans[i]))).data
        texts.push(read.text)
        // The same read with every character put in its cell: removes letters the reader invented beside the fillers.
        const snapped = read.lines ? snapMrz(read.lines) : null
        if (snapped) texts.push(snapped)
        mrz = bestMrz(texts)
        // The numbers passed their check digits and several reads agree on the name (the vote is what makes the name trustworthy,
        // so one clean-looking read is not enough to stop): no need to try more.
        if (mrz && mrz.checks.doc && mrz.checks.dob && mrz.checks.expiry && mrz.nameClean && (mrz.nameVotes ?? 0) >= 4) break
      }
      // The Latin name is also printed above the strip: a second, independent reading of it, used to clean stray letters.
      step('Reading the printed name', 0.55)
      await eng.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '6' })
      printed = printedNames((await eng.recognize(treat(regionAt(0.2)))).data.text)
    }
    await eng.terminate()

    step('Reading the Khmer text', 0.6)
    let front: Front | null = null
    const khm = await worker('khm', p => step('Reading the Khmer text', 0.6 + p * 0.35))
    try {
      await khm.setParameters({ tessedit_pageseg_mode: '6' })
      // A second, slightly different cut is tried if the first finds little.
      let bestCount = -1
      for (const cutAt of [0.2, 0.27]) {
        const f = parseFront((await khm.recognize(treat(regionAt(cutAt)))).data.text)
        const n = [f.nameKh, f.birthplace, f.address, f.validTo, f.dob].filter(Boolean).length
        if (n > bestCount) { front = f; bestCount = n }
        if (f.birthplace && f.address && f.validTo) break
      }
    } finally { await khm.terminate() }

    step('Done', 1)
    return { fields: cardFields(mrz, front, printed), mrz, front, card: await toBlob(card), mrzFound: !!band }
  } catch (e) {
    try { await eng.terminate() } catch { /* already closed */ }
    throw e
  }
}
