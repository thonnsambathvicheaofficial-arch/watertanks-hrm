// Reading a Cambodian national ID card from OCR text. Pure functions, no browser or server APIs, so they are tested
// directly (tests/id-card.test.js) and run in the browser where the card photo is read.
//
// The card carries two kinds of text. The machine-readable zone (MRZ) at the bottom is three lines of Latin capitals in the
// international ICAO 9303 "TD1" layout. It holds the ID number, date of birth, sex and expiry date, each protected by a
// CHECK DIGIT, so a read that passes the check is right, not merely likely. The Khmer text above it (name, birthplace,
// address) has no such protection: OCR reads the address well and the ornate Khmer name poorly, so those fields are only
// ever suggestions that a person confirms.

/** The largest original PDF that is kept with a card (the server checks the same limit: lib/staff-photo.js). */
export const ORIGINAL_MAX_BYTES = 3.5 * 1024 * 1024

export type Source = 'mrz' | 'ocr'
export type Field = { value: string; source: Source; verified: boolean; note?: string }

export type Mrz = {
  idNumber: string; surname: string; given: string; sex: 'M' | 'F' | ''; dob: string; expiry: string
  checks: { doc: boolean; dob: boolean; expiry: boolean; composite: boolean | null }
  nameClean: boolean       // the name line read without stray characters
  nameVotes?: number       // how strongly several reads agree on the name (set when reads are combined)
  score: number            // how much of the zone checked out; used to pick the best of several reads
}

export type Front = { nameKh: string; birthplace: string; address: string; dob: string; sex: 'M' | 'F' | ''; validFrom: string; validTo: string }

export type CardFields = {
  idCardNo?: Field; name?: Field; gender?: Field; dateOfBirth?: Field; nameKh?: Field; address?: Field; birthplace?: Field; expiry?: Field
}

// ── MRZ ─────────────────────────────────────────────────────────────────────
const WEIGHTS = [7, 3, 1]
const charValue = (c: string) => (c === '<' ? 0 : /[0-9]/.test(c) ? Number(c) : c.charCodeAt(0) - 55)

/** The ICAO 9303 check digit of a string: weights 7-3-1, letters A=10..Z=35, filler "<" = 0, sum modulo 10. */
export function checkDigit(s: string): string {
  let sum = 0
  Array.from(s).forEach((c, i) => { sum += charValue(c) * WEIGHTS[i % 3] })
  return String(sum % 10)
}

// OCR confuses look-alike characters in number fields; this puts them back (applied only where a digit is required).
const DIGIT_FIX: Record<string, string> = { O: '0', Q: '0', D: '0', I: '1', L: '1', Z: '2', S: '5', G: '6', B: '8' }
const toDigits = (s: string) => Array.from(s).map(c => DIGIT_FIX[c] ?? c).join('')
const DIGITLIKE = '[0-9OQDILZSGB]'

const yy2 = (n: number) => n % 100
function birthDate(yymmdd: string, now = new Date()): string {
  const yy = Number(yymmdd.slice(0, 2)), mm = yymmdd.slice(2, 4), dd = yymmdd.slice(4, 6)
  // Nobody is born in the future: a year that would be ahead of today belongs to the last century.
  const year = yy > yy2(now.getFullYear()) ? 1900 + yy : 2000 + yy
  return validDate(year, Number(mm), Number(dd)) ? `${year}-${mm}-${dd}` : ''
}
function expiryDate(yymmdd: string): string {
  const yy = Number(yymmdd.slice(0, 2)), mm = yymmdd.slice(2, 4), dd = yymmdd.slice(4, 6)
  const year = 2000 + yy
  return validDate(year, Number(mm), Number(dd)) ? `${year}-${mm}-${dd}` : ''
}
function validDate(y: number, m: number, d: number) {
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

// "THONN<<SAMBATH<TINEA<<<<<" -> surname THONN, given SAMBATH TINEA. Everything after the first run of fillers that ends
// the given names is background noise and is dropped.
function splitName(raw: string): { surname: string; given: string; clean: boolean } {
  const letters = raw.replace(/[^A-Z<]/g, '').replace(/^<+/, '')
  const parts = letters.split(/<{2,}/).filter(Boolean)
  // Filler that was misread comes out as runs of K and L: a name never ends in one, so anything from the first such run on is noise.
  // A word that is mostly K and L (and long enough that no name looks like it) is that noise: the name ends before it.
  const noisy = (w: string) => w.length >= 3 && (w.match(/[KL]/g) || []).length >= Math.ceil(w.length * 0.75)
  const cut = (t: string) => { const out: string[] = []; for (const w of t.replace(/</g, ' ').split(' ').filter(Boolean)) { if (noisy(w)) break; out.push(w) } return out.join(' ') }
  const surname = cut(parts[0] || '')
  const given = cut(parts[1] || '')
  const tokens = [...surname.split(' '), ...given.split(' ')].filter(Boolean)
  // A lone K or L between two fillers is a misread filler, not a name: that read is not clean.
  const clean = !!surname && !!given && tokens.every(t => t.length >= 2 || !/^[KLSI]$/.test(t)) && !/ [KL] /.test(` ${surname} ${given} `)
  return { surname, given, clean }
}

type Sym = { text: string; confidence: number; bbox: { x0: number; x1: number } }
type SymLine = { words: { symbols: Sym[] }[] }

/**
 * Rebuild the three zone lines from the position of every character the reader found. The zone is printed in exactly 30 equal
 * cells per line, so each character belongs to one cell. A character the reader invented (typically a stray K squeezed in
 * beside a filler) lands in a cell that already has an owner and loses to the more confident of the two; a cell nobody claims
 * is a filler. Returns null when the geometry does not look like a 30-cell zone, and the caller keeps the plain text.
 */
export function snapMrz(lines: SymLine[]): string | null {
  const rows = lines.slice(0, 3).map(l => l.words.flatMap(w => w.symbols).filter(c => c.text && c.text.length === 1))
  if (rows.length < 3 || rows.some(r => r.length < 8)) return null
  // Lines 1 and 2 run the full width of the zone (the ID number then fillers; the digits then the closing check digit).
  const x0 = Math.min(rows[0][0].bbox.x0, rows[1][0].bbox.x0)
  const x1 = Math.max(rows[0][rows[0].length - 1].bbox.x1, rows[1][rows[1].length - 1].bbox.x1)
  const pitch = (x1 - x0) / 30
  if (!(pitch > 4)) return null
  // Sanity: letters in this font are a little narrower than their cell. If they are not, this is not the 30-cell layout.
  const widths = rows[1].map(c => c.bbox.x1 - c.bbox.x0).sort((a, b) => a - b)
  const med = widths[Math.floor(widths.length / 2)]
  if (med < pitch * 0.4 || med > pitch * 1.05) return null
  return rows.map(r => {
    const cells: (Sym | null)[] = new Array(30).fill(null)
    for (const c of r) {
      const idx = Math.max(0, Math.min(29, Math.floor(((c.bbox.x0 + c.bbox.x1) / 2 - x0) / pitch)))
      const cur = cells[idx]
      if (!cur) { cells[idx] = c; continue }
      // K and L are what the reader makes of a filler it cannot make out, so a filler beats them unless the letter is clearly surer.
      const lookalike = (x: Sym) => x.text === 'K' || x.text === 'L'
      const margin = 12
      const wins = c.text === '<' && lookalike(cur) ? cur.confidence < c.confidence + margin
        : lookalike(c) && cur.text === '<' ? c.confidence >= cur.confidence + margin
        : c.confidence > cur.confidence
      if (wins) cells[idx] = c
    }
    return cells.map(c => (c ? c.text : '<')).join('')
  }).join('\n')
}

/** Parse the OCR text of the MRZ. Returns null when no ID-card zone can be found in it. */
export function parseMrz(text: string, now = new Date()): Mrz | null {
  const lines = String(text || '').toUpperCase().split(/\n+/).map(l => l.replace(/[^A-Z0-9<]/g, '')).filter(l => l.length >= 12)
  const i1 = lines.findIndex(l => new RegExp(`KHM${DIGITLIKE}{10}`).test(l))
  if (i1 < 0) return null
  const m1 = new RegExp(`KHM(${DIGITLIKE}{9})(${DIGITLIKE})`).exec(lines[i1])!
  const doc = toDigits(m1[1]), docChk = toDigits(m1[2])

  const re2 = new RegExp(`(${DIGITLIKE}{6})(${DIGITLIKE})([MF<])(${DIGITLIKE}{6})(${DIGITLIKE})`)
  let i2 = -1, m2: RegExpExecArray | null = null
  for (let i = i1 + 1; i < lines.length && i <= i1 + 2; i++) { const m = re2.exec(lines[i]); if (m) { i2 = i; m2 = m; break } }
  if (!m2) return null
  const dob = toDigits(m2[1]), dobChk = toDigits(m2[2]), sexRaw = m2[3], exp = toDigits(m2[4]), expChk = toDigits(m2[5])

  // The name is the next line; take the next one that is mostly letters.
  const nameLine = lines.slice(i2 + 1).find(l => (l.match(/[A-Z<]/g) || []).length >= l.length * 0.8 && l.length >= 6) || ''
  const nm = splitName(nameLine)

  const line2 = lines[i2]
  const finalChar = line2.slice(-1).replace(/[OQD]/, '0')
  // The last digit protects the whole zone (document number, birth date and expiry as printed, plus the filler between).
  const composite = /^[0-9]$/.test(finalChar)
    ? checkDigit(`${doc}${docChk}${'<'.repeat(15)}${dob}${dobChk}${exp}${expChk}${'<'.repeat(11)}`) === finalChar
    : null

  const checks = { doc: checkDigit(doc) === docChk, dob: checkDigit(dob) === dobChk, expiry: checkDigit(exp) === expChk, composite }
  const score = (checks.doc ? 4 : 0) + (checks.dob ? 3 : 0) + (checks.expiry ? 2 : 0) + (checks.composite ? 1 : 0) + (nm.clean ? 2 : 0)
  return {
    idNumber: doc, surname: nm.surname, given: nm.given, sex: sexRaw === 'M' || sexRaw === 'F' ? sexRaw : '',
    dob: birthDate(dob, now), expiry: expiryDate(exp), checks, nameClean: nm.clean, score,
  }
}

const numbersScore = (m: Mrz) => (m.checks.doc ? 4 : 0) + (m.checks.dob ? 3 : 0) + (m.checks.expiry ? 2 : 0) + (m.checks.composite ? 1 : 0)

/** Several reads of the same zone (different image treatments). The numbers come from the read whose check digits pass best,
 *  and the name from the read whose name line came out clean: one treatment is often best for the digits and another for the
 *  name, and the check digits make it safe to mix them (they only vouch for the numbers, never for the name). */
export function bestMrz(texts: string[], now = new Date()): Mrz | null {
  const all = texts.map(t => parseMrz(t, now)).filter((m): m is Mrz => !!m)
  if (!all.length) return null
  const byNumbers = [...all].sort((x, y) => numbersScore(y) - numbersScore(x))[0]
  // The name is chosen by VOTE. Every read of the name line has its own stray letters, and they differ from read to read, while
  // the real name comes out the same each time. So the spelling most reads agree on wins; reads whose numbers passed their
  // check digits count double, and a tie goes to the spelling with the fewest K and L (the letters misread fillers become).
  const key = (m: Mrz) => `${m.surname}|${m.given}`
  const votes = new Map<string, number>()
  for (const m of all) if (m.surname && m.given) votes.set(key(m), (votes.get(key(m)) || 0) + (m.nameClean ? 1 : 0.25) * (numbersScore(m) >= 9 ? 2 : 1))
  const noise = (m: Mrz) => (m.surname + m.given).replace(/[^KL]/g, '').length
  const byName = [...all].filter(m => m.surname && m.given).sort((x, y) => (votes.get(key(y)) || 0) - (votes.get(key(x)) || 0) || noise(x) - noise(y))[0] || byNumbers
  const merged: Mrz = { ...byNumbers, surname: byName.surname, given: byName.given, nameClean: byName.nameClean, nameVotes: votes.get(key(byName)) || 0 }
  merged.score = numbersScore(merged) + (merged.nameClean ? 2 : 0)
  return merged
}

// ── The Khmer text above the zone ───────────────────────────────────────────
const KHMER = /[ក-៿]/
const KH_DIGITS = '០១២៣៤៥៦៧៨៩'
export const khmerDigits = (s: string) => Array.from(s).map(c => { const i = KH_DIGITS.indexOf(c); return i >= 0 ? String(i) : c }).join('')

const LABELS = {
  name: 'គោត្តនាមនិងនាម',
  dob: 'ថ្ងៃខែឆ្នាំកំណើត',
  place: 'ទីកន្លែងកំណើត',
  address: 'អាសយដ្ឋាន',
  validity: 'សុពលភាព',
} as const
type LabelKey = keyof typeof LABELS

function distance(a: string[], b: string[]): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return row[b.length]
}
const similarity = (a: string, b: string) => {
  const x = Array.from(a), y = Array.from(b)
  const n = Math.max(x.length, y.length)
  return n ? 1 - distance(x, y) / n : 0
}

// Where the label ends and the value starts: the first ASCII colon, else the Khmer colon-like sign, else just past the label.
function splitLabel(line: string, labelLen: number): [string, string] {
  let i = line.indexOf(':')
  if (i < 0) i = line.indexOf('ៈ')
  if (i < 0 || i > labelLen + 6) return [line.slice(0, labelLen), line.slice(labelLen)]
  return [line.slice(0, i), line.slice(i + 1)]
}
const tidy = (s: string) => s.replace(/[*“”"'`|_=]/g, ' ').replace(/\s+/g, ' ').trim()
// Khmer letters, spaces and Khmer punctuation only: stray Latin letters and digits inside a Khmer name are OCR debris.
const khmerOnly = (s: string) => tidy(Array.from(s).filter(c => KHMER.test(c) || c === ' ').join(''))

/** Parse the OCR text of the Khmer part of the card. Lines are matched to the card's printed labels by similarity,
 *  so a label the OCR garbled slightly still finds its value. */
export function parseFront(text: string): Front {
  const lines = String(text || '').split(/\n+/).map(l => l.trim()).filter(l => KHMER.test(l) || /\d/.test(l))
  const found: Partial<Record<LabelKey, number>> = {}
  const taken = new Set<number>()
  // Best label-to-line pairs first, each line and label used once.
  const pairs: { key: LabelKey; i: number; s: number }[] = []
  lines.forEach((l, i) => {
    if (!KHMER.test(l)) return
    ;(Object.keys(LABELS) as LabelKey[]).forEach(key => {
      const label = LABELS[key]
      const [head] = splitLabel(l, Array.from(label).length)
      pairs.push({ key, i, s: similarity(label, tidy(head).replace(/[:ៈ]/g, '')) })
    })
  })
  pairs.sort((a, b) => b.s - a.s)
  for (const p of pairs) {
    if (p.s < 0.5 || found[p.key] !== undefined || taken.has(p.i)) continue
    found[p.key] = p.i; taken.add(p.i)
  }
  const untilIdx = lines.findIndex(l => /ដល់/.test(l) && /[0-9០-៩]/.test(l))
  if (untilIdx >= 0 && !(found.validity === untilIdx)) { found.validity = untilIdx; taken.add(untilIdx) }
  const valueOf = (key: LabelKey) => {
    const i = found[key]
    if (i === undefined) return ''
    // The validity line holds two dates; its label (when the reader garbled it) is not worth trimming off.
    return key === 'validity' ? lines[i] : splitLabel(lines[i], Array.from(LABELS[key]).length)[1]
  }

  // Address: its own line, then the lines after it up to the validity line (the card wraps it over two or three).
  let address = ''
  if (found.address !== undefined) {
    const stop = found.validity ?? found.address + 3
    const parts = [valueOf('address')]
    for (let i = found.address + 1; i < Math.min(stop, found.address + 4, lines.length); i++) if (!taken.has(i) && KHMER.test(lines[i])) parts.push(lines[i])
    address = khmerOnly(parts.join(' '))
  }

  const dobLine = khmerDigits(valueOf('dob'))
  const dm = /(\d{2})\D(\d{2})\D(\d{4})/.exec(dobLine)
  const dob = dm && validDate(Number(dm[3]), Number(dm[2]), Number(dm[1])) ? `${dm[3]}-${dm[2]}-${dm[1]}` : ''
  const sex: 'M' | 'F' | '' = /ប្រុស/.test(dobLine) ? 'M' : /ស្រី/.test(dobLine) ? 'F' : ''

  const vm = [...khmerDigits(valueOf('validity')).matchAll(/(\d{2})\D(\d{2})\D(\d{4})/g)].map(m => (validDate(Number(m[3]), Number(m[2]), Number(m[1])) ? `${m[3]}-${m[2]}-${m[1]}` : ''))

  return { nameKh: khmerOnly(valueOf('name')), birthplace: khmerOnly(valueOf('place')), address, dob, sex, validFrom: vm[0] || '', validTo: vm[1] || '' }
}

// ── Putting it together ─────────────────────────────────────────────────────
/** Lines of the card's printed text that could be the Latin name: capitals and spaces, two or more words. */
export function printedNames(text: string): string[] {
  return String(text || '').split(/\n+/).map(l => l.replace(/[^A-Za-z ]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(l => /^[A-Z]{2,}( [A-Z]{2,})+$/.test(l))
}
// Two names agree if they are the same letters once the letters the zone confuses for fillers (K and L) are left out.
const skeleton = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '').replace(/[KL]/g, '')
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase())

/** The fields the Add staff form takes, each with where it came from and whether a check digit proved it. */
export function cardFields(mrz: Mrz | null, front: Front | null, printed: string[] = []): CardFields {
  const out: CardFields = {}
  if (mrz) {
    if (mrz.idNumber) out.idCardNo = { value: mrz.idNumber, source: 'mrz', verified: mrz.checks.doc }
    let name = [mrz.surname, mrz.given].filter(Boolean).join(' ')
    // The zone's name line is where misread fillers show up as stray K and L. If the printed name on the card agrees with it
    // apart from those letters, the printed one is the cleaner reading.
    const same = name && printed.find(p => skeleton(p) === skeleton(name) && skeleton(p).length >= 4)
    if (same) name = same
    // The name is not covered by any check digit, so it is never marked proven.
    if (name) out.name = { value: titleCase(name), source: 'mrz', verified: false, note: mrz.nameClean || same ? undefined : 'The name line was hard to read.' }
    if (mrz.sex) out.gender = { value: mrz.sex, source: 'mrz', verified: mrz.checks.composite === true }
    if (mrz.dob) out.dateOfBirth = { value: mrz.dob, source: 'mrz', verified: mrz.checks.dob }
    if (mrz.expiry) out.expiry = { value: mrz.expiry, source: 'mrz', verified: mrz.checks.expiry }
  }
  if (front) {
    if (front.nameKh) out.nameKh = { value: front.nameKh, source: 'ocr', verified: false }
    if (front.address) out.address = { value: front.address, source: 'ocr', verified: false }
    if (front.birthplace) out.birthplace = { value: front.birthplace, source: 'ocr', verified: false }
    // Without a readable zone, fall back to what the Khmer text says (never proven).
    if (!out.dateOfBirth && front.dob) out.dateOfBirth = { value: front.dob, source: 'ocr', verified: false }
    if (!out.gender && front.sex) out.gender = { value: front.sex, source: 'ocr', verified: false }
    if (!out.expiry && front.validTo) out.expiry = { value: front.validTo, source: 'ocr', verified: false }
  }
  return out
}
