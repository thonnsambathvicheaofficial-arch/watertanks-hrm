// Discipline register: the steps, the checks on a record, the register rows, the Excel import and the warning letter text.
// Pure (no database, no clock of its own), so it is tested directly; lib/discipline-store.js does the saving.

// The steps, least to most serious. `kh` is the Khmer name shown beside the English one. `warning` separates a warning from
// guidance or a note. `phrase` is how the letter says it. The first four steps are the factory's own wording; verbal
// warning to final warning are the escalation ladder.
const KINDS = {
  verbal_guidance: { rank: 0, warning: false, label: 'Verbal guidance', kh: 'ណែនាំផ្ទាល់មាត់', phrase: 'verbal guidance', letterTitle: 'Record of verbal guidance', letterTitleKh: 'កំណត់ត្រានៃការណែនាំផ្ទាល់មាត់' },
  lead_guidance: { rank: 0, warning: false, label: 'Team leader verbal guidance', kh: 'ប្រធានក្រុមណែនាំផ្ទាល់មាត់', phrase: 'verbal guidance from the team leader', letterTitle: 'Record of team leader verbal guidance', letterTitleKh: 'កំណត់ត្រានៃការណែនាំផ្ទាល់មាត់ពីប្រធានក្រុម' },
  guidance_letter: { rank: 1, warning: false, label: 'Guidance letter', kh: 'លិខិតណែនាំ', phrase: 'a guidance letter', letterTitle: 'Guidance letter', letterTitleKh: 'លិខិតណែនាំ' },
  verbal: { rank: 2, warning: true, label: 'Verbal warning', kh: 'ការព្រមានដោយផ្ទាល់មាត់', phrase: 'a verbal warning', letterTitle: 'Record of verbal warning', letterTitleKh: 'កំណត់ត្រានៃការព្រមានដោយផ្ទាល់មាត់' },
  written1: { rank: 3, warning: true, label: 'First written warning', kh: 'លិខិតព្រមានលើកទី១', phrase: 'a first written warning', letterTitle: 'First written warning', letterTitleKh: 'លិខិតព្រមានលើកទី១' },
  written2: { rank: 4, warning: true, label: 'Second written warning', kh: 'លិខិតព្រមានលើកទី២', phrase: 'a second written warning', letterTitle: 'Second written warning', letterTitleKh: 'លិខិតព្រមានលើកទី២' },
  warning_letter: { rank: 3, warning: true, label: 'Warning letter', kh: 'លិខិតព្រមាន', phrase: 'a warning letter', letterTitle: 'Warning letter', letterTitleKh: 'លិខិតព្រមាន' },
  final: { rank: 5, warning: true, label: 'Final warning', kh: 'លិខិតព្រមានចុងក្រោយ', phrase: 'a final warning', letterTitle: 'Final written warning', letterTitleKh: 'លិខិតព្រមានចុងក្រោយ' },
  noted: { rank: -1, warning: false, label: 'Noted (no action)', kh: 'កំណត់ហេតុ', phrase: 'a note on file', letterTitle: 'Note on file', letterTitleKh: 'កំណត់ហេតុ' },
}
// The order they appear in menus.
const KIND_KEYS = ['verbal_guidance', 'lead_guidance', 'guidance_letter', 'verbal', 'written1', 'written2', 'warning_letter', 'final', 'noted']
const STATUSES = { draft: 'Draft', confirmed: 'Confirmed', withdrawn: 'Withdrawn' }

const kindLabel = (k) => (KINDS[k] ? KINDS[k].label : String(k || ''))
const kindBoth = (k) => (KINDS[k] ? `${KINDS[k].label} / ${KINDS[k].kh}` : String(k || ''))

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/
function validDate(s) {
  const m = YMD.exec(String(s || ''))
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}
const r2 = (n) => Math.round(n * 100) / 100

// Checks and tidies the fields of a record made in the app. today is "YYYY-MM-DD". Returns { value } or { error }.
function check(input, today) {
  const pin = String(input.pin || '').trim()
  if (!pin) return { error: 'Choose a staff member.' }
  const occurredOn = String(input.occurredOn || '').trim()
  if (!validDate(occurredOn)) return { error: 'Enter the date it happened.' }
  if (today && occurredOn > today) return { error: 'The date it happened cannot be in the future.' }
  const kind = String(input.kind || '')
  if (!KINDS[kind]) return { error: 'Choose the kind of guidance or warning.' }
  const reason = String(input.reason || '').trim()
  if (!reason) return { error: 'Write the reason. Khmer is fine.' }
  if (reason.length > 2000) return { error: 'The reason is too long (2000 characters at most).' }
  let deduction = null, payrollYear = null, payrollMonth = null
  const raw = String(input.deduction ?? '').trim().replace(/,/g, '')
  if (raw !== '') {
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) return { error: 'The salary deduction must be an amount above zero (US dollars), or left empty.' }
    if (n > 10000) return { error: 'That salary deduction looks too large. Check the amount.' }
    deduction = r2(n)
    // Which payroll month it comes out of: chosen, else the month it happened.
    const pm = String(input.payrollMonth || '').trim() || occurredOn.slice(0, 7)
    const mm = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(pm)
    if (!mm) return { error: 'Choose the payroll month the deduction comes out of.' }
    payrollYear = +mm[1]; payrollMonth = +mm[2]
    if (payrollYear < 2000 || payrollYear > 2100) return { error: 'Choose the payroll month the deduction comes out of.' }
  }
  return { value: { pin, occurredOn, kind, reason, deduction, payrollYear, payrollMonth } }
}

// What the person's confirmed (not withdrawn) records say about where they are on the escalation ladder.
const NEXT = { verbal: 'written1', written1: 'written2', warning_letter: 'written2', written2: 'final', final: null }
function ladder(records) {
  const live = records.filter(r => r.status === 'confirmed' && KINDS[r.kind] && KINDS[r.kind].warning)
  const top = live.reduce((best, r) => (!best || KINDS[r.kind].rank > KINDS[best.kind].rank ? r : best), null)
  return { warnings: live.length, top: top ? top.kind : null, next: top ? NEXT[top.kind] : 'verbal' }
}

// Who a record is about: the live staff record when the person is in the staff list, else what was written on the record.
// people: pin -> { staffCode, name, nameKh, position, departmentName }.
function who(record, people) {
  const live = record.pin && people ? people[record.pin] : null
  if (live) return { ...live, inStaffList: true }
  return { staffCode: record.staffCode || '', name: record.staffName || (record.pin ? `PIN ${record.pin}` : ''), nameKh: '', position: record.position || '', departmentName: record.department || '', inStaffList: false }
}

// The register in the factory's layout.
const REGISTER_HEADER = ['No', 'Staff ID', 'Name', 'Position', 'Department', 'Amount of salary deduction', 'Occurrence date', 'ការណែនាំ/ការព្រមាន', 'Reason', 'Status']
function registerRows(records, people) {
  return records.map((r, i) => {
    const s = who(r, people)
    return [i + 1, s.staffCode || '', s.name || '', s.position || '', s.departmentName || '', r.deduction == null ? '' : r.deduction, r.occurredOn, kindBoth(r.kind), r.reason, STATUSES[r.status] || r.status]
  })
}

// ── reading the factory's Excel register ────────────────────────────────────
const squash = (s) => String(s == null ? '' : s).replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim()

// The type column holds Khmer words (or N/A). English labels are accepted too, so an exported file imports again.
function kindFromText(text) {
  const t = squash(text)
  if (!t) return null
  const key = t.toLowerCase()
  if (key === 'n/a' || key === 'na' || key === 'none') return 'noted'
  for (const k of KIND_KEYS) {
    const e = KINDS[k]
    if (t === e.kh || key === e.label.toLowerCase() || key === `${e.label} / ${e.kh}`.toLowerCase()) return k
  }
  return null
}

// An amount cell: "$5.00", " $-   ", 5, "paid". Returns { amount } (a number or null for none) or { error }.
function readAmount(text) {
  const t = squash(text).replace(/[$,]/g, '').trim()
  if (t === '' || t === '-' || /^-+$/.test(t)) return { amount: null }
  if (/^paid$/i.test(t)) return { amount: null, note: 'The amount says "paid", so no deduction was recorded; the reason keeps the details.' }
  const n = Number(t)
  if (!Number.isFinite(n)) return { error: `The amount "${t}" is not a number.` }
  if (n < 0) return { error: 'The amount cannot be negative.' }
  if (n === 0) return { amount: null }
  if (n > 10000) return { error: 'That amount looks too large. Check it.' }
  return { amount: r2(n) }
}

// A short stable fingerprint of a register row, so importing the same file twice adds nothing.
function importKey(staffCode, date, kind, reason) {
  const s = [squash(staffCode).toLowerCase(), date, kind, squash(reason)].join('|')
  let h1 = 5381, h2 = 52711
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = ((h1 * 33) ^ c) >>> 0; h2 = ((h2 * 31) + c) >>> 0 }
  return `reg1-${h1.toString(36)}${h2.toString(36)}${s.length.toString(36)}`
}

// The warning letter, in English and Khmer. The Khmer wording is a draft for HR to confirm.
function letterModel(record, person) {
  const k = KINDS[record.kind]
  const month = record.payrollYear && record.payrollMonth ? `${record.payrollYear}-${String(record.payrollMonth).padStart(2, '0')}` : ''
  return {
    titleEn: k.letterTitle, titleKh: k.letterTitleKh,
    bodyEn: `This letter records that the employee named above was given ${k.phrase} on ${record.occurredOn}, for the reason stated below. Further breaches of company rules may lead to more serious disciplinary action, up to and including termination of employment.`,
    bodyKh: `លិខិតនេះបញ្ជាក់ថា បុគ្គលិកដែលមានឈ្មោះខាងលើ ត្រូវបានទទួល${k.kh} នៅថ្ងៃទី ${record.occurredOn} ដោយសារមូលហេតុដូចមានចែងខាងក្រោម។ ការរំលោភលើវិន័យក្រុមហ៊ុនបន្ថែមទៀត អាចនាំឱ្យមានវិធានការវិន័យធ្ងន់ធ្ងរជាងនេះ រហូតដល់ការបញ្ចប់កិច្ចសន្យាការងារ។`,
    deductionEn: record.deduction ? `Salary deduction: USD ${Number(record.deduction).toFixed(2)}, taken from the ${month} payroll.` : '',
    deductionKh: record.deduction ? `ការកាត់ប្រាក់ខែ៖ ${Number(record.deduction).toFixed(2)} ដុល្លារអាមេរិក កាត់ពីប្រាក់ខែ ${month}។` : '',
    person: person || {},
  }
}

module.exports = { KINDS, KIND_KEYS, STATUSES, kindLabel, kindBoth, validDate, check, ladder, who, REGISTER_HEADER, registerRows, squash, kindFromText, readAmount, importKey, letterModel }
