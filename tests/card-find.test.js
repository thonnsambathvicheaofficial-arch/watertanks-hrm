// Finding card-shaped regions on a scanned page (lib/card-find.ts). The pages here are drawn by the test.
const ts = require('typescript')
const fs = require('fs')
const path = require('path')
const src = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/card-find.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const mod = { exports: {} }
new Function('module', 'exports', src)(mod, mod.exports)
const { findCards, CARD_RATIO } = mod.exports

let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }

// A page of W x H pixels, white, that shapes can be drawn on.
function page(W, H, fill = [255, 255, 255]) {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let i = 0; i < W * H; i++) { data[i * 4] = fill[0]; data[i * 4 + 1] = fill[1]; data[i * 4 + 2] = fill[2]; data[i * 4 + 3] = 255 }
  const px = (x, y, c) => { const i = (y * W + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2] }
  const rect = (x0, y0, w, h, c) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) px(x, y, c) }
  // A card: a light grey body with a dark printed band and some coloured marks, like a real card.
  const card = (x0, y0, w, h) => { rect(x0, y0, w, h, [215, 220, 212]); rect(x0 + 6, y0 + Math.round(h * 0.7), w - 12, Math.round(h * 0.2), [60, 60, 60]); rect(x0 + 8, y0 + 8, 20, 24, [190, 120, 90]) }
  return { data, width: W, height: H, rect, card, px }
}
const near = (r, x, y, w, h, tol = 6) => r && Math.abs(r.x - x) <= tol && Math.abs(r.y - y) <= tol && Math.abs(r.w - w) <= tol && Math.abs(r.h - h) <= tol

// Two cards on a plain A4-shaped page, like the HR scans (front left, back right).
let p = page(400, 560)
p.card(20, 20, 160, Math.round(160 / CARD_RATIO)); p.card(220, 24, 160, Math.round(160 / CARD_RATIO))
let r = findCards(p)
ok(r.plain === true && r.cards.length === 2, `a plain page with two cards finds two cards (got ${r.cards.length})`)
ok(r.cards.some(c => near(c, 20, 20, 160, 101)) && r.cards.some(c => near(c, 220, 24, 160, 101)), 'each card is found at its place and size')

// A scanner streak along the page edge must not swallow a card that sits near the corner.
p = page(400, 560)
for (let y = 0; y < 560; y++) { p.px(0, y, [40, 40, 40]); p.px(1, y, [40, 40, 40]); p.px(2, y, [90, 90, 90]) }
for (let x = 0; x < 400; x++) { p.px(x, 0, [60, 60, 60]); p.px(x, 1, [60, 60, 60]) }
p.rect(3, 105, 14, 4, [70, 70, 70])    // a bridge of marks from the streak towards the card
p.card(18, 16, 160, 101)
r = findCards(p)
ok(r.cards.length === 1 && near(r.cards[0], 18, 16, 160, 101, 14), 'edge streaks do not join the card (still one card, right size)')

// A card lying on its side.
p = page(400, 560)
p.card(60, 100, 101, 160)
r = findCards(p)
ok(r.cards.length === 1 && r.cards[0].turned === true, 'a sideways card is found and marked as turned')

// Things that are not cards.
p = page(400, 560); p.rect(30, 30, 300, 40, [30, 30, 30])
ok(findCards(p).cards.length === 0, 'a long bar is not a card (wrong proportions)')
p = page(400, 560); p.rect(30, 30, 100, 100, [30, 30, 30])
ok(findCards(p).cards.length === 0, 'a square is not a card')
p = page(400, 560)
ok(findCards(p).plain === true && findCards(p).cards.length === 0, 'a blank page is plain and has no cards')
p = page(400, 252, [120, 118, 100])
p.rect(40, 60, 200, 20, [30, 30, 30])
const photo = findCards(p)
ok(photo.plain === false && photo.cards.length === 0, 'a picture with no plain light background (a photo of a card filling the frame) is not "plain": it is read whole')

// Small specks are not cards.
p = page(400, 560)
for (let i = 0; i < 60; i++) p.rect((i * 37) % 380 + 10, (i * 91) % 540 + 10, 3, 3, [30, 30, 30])
ok(findCards(p).cards.length === 0, 'scattered specks are not cards')

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
