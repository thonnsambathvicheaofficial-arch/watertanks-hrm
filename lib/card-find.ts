// Finding an ID card on a scanned page. HR's scans are A4 pages (often from PDF files) with the card, about the size of a
// credit card, in a corner: reading the whole page would be slow and the card's small text unreadable. This finds the card
// shapes on the page so only they are cut out, enlarged and read. Pure functions on pixel arrays, so they are tested in Node.

export type Rect = { x: number; y: number; w: number; h: number; turned?: boolean }   // turned: the card lies sideways (taller than wide)
export type Found = { plain: boolean; cards: Rect[] }

/** An ID-1 card (ISO/IEC 7810) is 85.6 x 54 mm. */
export const CARD_RATIO = 85.6 / 54

type Pixels = { data: ArrayLike<number>; width: number; height: number }   // RGBA, like a canvas ImageData

/**
 * Find card-shaped regions on a mostly plain page. `cards` are rectangles in the pixel units of the input, biggest first.
 * `plain` says whether the picture is a plain light page at all. A picture that is NOT plain (a photo where the card fills the
 * frame, or lies on a table) is read whole by the caller; a plain page with no card shape on it has nothing to read.
 */
export function findCards(img: Pixels, opts: { minAreaShare?: number } = {}): Found {
  const { width: W, height: H, data } = img
  const n = W * H
  const lum = new Float32Array(n), sat = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
    lum[i] = (r * 299 + g * 587 + b * 114) / 1000
    sat[i] = Math.max(r, g, b) - Math.min(r, g, b)
  }
  // The page colour is the commonest bright value, found from a histogram of the lightest half of the picture.
  const hist = new Uint32Array(256)
  for (let i = 0; i < n; i++) hist[Math.min(255, Math.round(lum[i]))]++
  let bg = 255, best = 0
  for (let v = 255; v >= 128; v--) if (hist[v] > best) { best = hist[v]; bg = v }
  // Not a plain page (no dominant light background): nothing to find.
  if (best < n * 0.3) return { plain: false, cards: [] }

  // "Ink": clearly darker or more colourful than the page. The threshold sits above scanner speckle.
  let mask: Uint8Array = new Uint8Array(n)
  for (let i = 0; i < n; i++) mask[i] = bg - lum[i] > 9 || sat[i] > 28 ? 1 : 0
  // Scanners leave dark streaks along the page edge; they must not join a card that sits near the corner.
  const mx = Math.ceil(W * 0.02), my = Math.ceil(H * 0.02)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < mx || x >= W - mx || y < my || y >= H - my) mask[y * W + x] = 0
  // Cut thin bridges between shapes (opening), then join each card's printing into one solid shape (closing).
  mask = dilate(erode(mask, W, H, 2), W, H, 2)
  mask = erode(dilate(mask, W, H, 3), W, H, 3)

  const label = new Int32Array(n)
  const out: Rect[] = []
  const minArea = n * (opts.minAreaShare ?? 0.02)
  const stack: number[] = []
  let id = 0
  for (let s = 0; s < n; s++) {
    if (!mask[s] || label[s]) continue
    id++
    let minX = W, maxX = 0, minY = H, maxY = 0, count = 0
    stack.push(s); label[s] = id
    while (stack.length) {
      const p = stack.pop()!
      const x = p % W, y = (p - x) / W
      count++
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y
      if (x > 0 && mask[p - 1] && !label[p - 1]) { label[p - 1] = id; stack.push(p - 1) }
      if (x < W - 1 && mask[p + 1] && !label[p + 1]) { label[p + 1] = id; stack.push(p + 1) }
      if (y > 0 && mask[p - W] && !label[p - W]) { label[p - W] = id; stack.push(p - W) }
      if (y < H - 1 && mask[p + W] && !label[p + W]) { label[p + W] = id; stack.push(p + W) }
    }
    const w = maxX - minX + 1, h = maxY - minY + 1
    const ratio = w / h, fill = count / (w * h)
    // Card-shaped: big enough, close to the card's proportions, and a solid shape rather than a scatter of marks.
    const upright = ratio > CARD_RATIO * 0.8 && ratio < CARD_RATIO * 1.2
    const turned = ratio > (1 / CARD_RATIO) * 0.8 && ratio < (1 / CARD_RATIO) * 1.2
    if (w * h >= minArea && (upright || turned) && fill > 0.6) out.push({ x: minX, y: minY, w, h, turned })
  }
  return { plain: true, cards: out.sort((a, b) => b.w * b.h - a.w * a.h) }
}

function dilate(m: Uint8Array, W: number, H: number, r: number): Uint8Array { return morph(m, W, H, r, true) }
function erode(m: Uint8Array, W: number, H: number, r: number): Uint8Array { return morph(m, W, H, r, false) }

// Separable box morphology: a pixel becomes set if any (dilate) or all (erode) pixels within r in each direction are set.
function morph(m: Uint8Array, W: number, H: number, r: number, grow: boolean): Uint8Array {
  const tmp = new Uint8Array(m.length), out = new Uint8Array(m.length)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = grow ? 0 : 1
      for (let k = -r; k <= r; k++) {
        const xx = x + k
        const s = xx < 0 || xx >= W ? (grow ? 0 : 1) : m[y * W + xx]
        if (grow ? s : !s) { v = grow ? 1 : 0; break }
      }
      tmp[y * W + x] = v
    }
  }
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let v = grow ? 0 : 1
      for (let k = -r; k <= r; k++) {
        const yy = y + k
        const s = yy < 0 || yy >= H ? (grow ? 0 : 1) : tmp[yy * W + x]
        if (grow ? s : !s) { v = grow ? 1 : 0; break }
      }
      out[y * W + x] = v
    }
  }
  return out
}
