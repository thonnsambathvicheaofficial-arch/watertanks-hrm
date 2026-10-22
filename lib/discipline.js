// Discipline register: the ladder, the checks on a record, the register rows and the warning letter text.
// Pure (no database, no clock of its own), so it is tested directly; lib/discipline-store.js does the saving.

// The ladder, least to most serious. `kh` is the Khmer name shown beside the English one.
const KINDS = {
  guidance: { rank: 0, label: 'Guidance', kh: 'ការណែនាំ', letterTitle: 'Notice of guidance', letterTitleKh: 'លិខិតណែនាំ' },
  verbal: { rank: 1, label: 'Verbal warning', kh: 'ការព្រមានដោយផ្ទាល់មាត់', letterTitle: 'Record of verbal warning', letterTitleKh: 'កំណត់ត្រានៃការព្រមានដោយផ្ទាល់មាត់' },
  written1: { rank: 2, label: 'First written warning', kh: 'លិខិតព្រមានលើកទី១', letterTitle: 'First written warning', letterTitleKh: 'លិខិតព្រមានលើកទី១' },
  written2: { rank: 3, label: 'Second written warning', kh: 'លិខិតព្រមានលើកទី២', letterTitle: 'Second written warning', letterTitleKh: 'លិខិតព្រមានលើកទី២' },
  final: { rank: 4, label: 'Final warning', kh: 'លិខិតព្រមានចុងក្រោយ', letterTitle: 'Final written warning', letterTitleKh: 'លិខិតព្រមានចុងក្រោយ' },
}
const KIND_KEYS = Object.keys(KINDS)
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

// Checks and tidies the fields of a record. today is "YYYY-MM-DD". Returns { value } or { error } (a message for a person).
function check(input, today) {
  const pin = String(input.pin || '').trim()
  if (!pin) return { error: 'Choose a staff member.' }
  const occurredOn = String(input.occurredOn || '').trim()
  if (!validDate(occurredOn)) return { error: 'Enter the date it happened.' }
  if (today && occurredOn > today) return { error: 'The date it happened cannot be in the future.' }
  const kind = String(input.kind || '')
  if (!KINDS[kind]) return { error: 'Choose guidance or the kind of warning.' }
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

// What the person's confirmed (not withdrawn) records say about where they are on the ladder.
function ladder(records) {
  const live = records.filter(r => r.status === 'confirmed' && KINDS[r.kind] && KINDS[r.kind].rank >= 1)
  const top = live.reduce((best, r) => (!best || KINDS[r.kind].rank > KINDS[best.kind].rank ? r : best), null)
  const next = !top ? 'verbal' : top.kind === 'final' ? null : KIND_KEYS.find(k => KINDS[k].rank === KINDS[top.kind].rank + 1)
  return { warnings: live.length, top: top ? top.kind : null, next }
}

// The register in the factory's layout. staff: pin -> { staffCode, name, position, departmentName }.
const REGISTER_HEADER = ['No', 'Staff ID', 'Name', 'Position', 'Department', 'Amount of salary deduction', 'Occurrence date', 'ការណែនាំ/ការព្រមាន', 'Reason', 'Status']
function registerRows(records, staff) {
  return records.map((r, i) => {
    const s = staff[r.pin] || {}
    return [i + 1, s.staffCode || '', s.name || r.pin, s.position || '', s.departmentName || '', r.deduction == null ? '' : r.deduction, r.occurredOn, kindBoth(r.kind), r.reason, STATUSES[r.status] || r.status]
  })
}

// The warning letter, in English and Khmer. The Khmer wording is a draft for HR to confirm.
function letterModel(record, person) {
  const k = KINDS[record.kind]
  const month = record.payrollYear && record.payrollMonth ? `${record.payrollYear}-${String(record.payrollMonth).padStart(2, '0')}` : ''
  return {
    titleEn: k.letterTitle, titleKh: k.letterTitleKh,
    bodyEn: `This letter records that the employee named above was given ${record.kind === 'guidance' ? 'guidance' : 'a ' + k.label.toLowerCase()} on ${record.occurredOn}, for the reason stated below. Further breaches of company rules may lead to more serious disciplinary action, up to and including termination of employment.`,
    bodyKh: `លិខិតនេះបញ្ជាក់ថា បុគ្គលិកដែលមានឈ្មោះខាងលើ ត្រូវបានទទួល${k.kh} នៅថ្ងៃទី ${record.occurredOn} ដោយសារមូលហេតុដូចមានចែងខាងក្រោម។ ការរំលោភលើវិន័យក្រុមហ៊ុនបន្ថែមទៀត អាចនាំឱ្យមានវិធានការវិន័យធ្ងន់ធ្ងរជាងនេះ រហូតដល់ការបញ្ចប់កិច្ចសន្យាការងារ។`,
    deductionEn: record.deduction ? `Salary deduction: USD ${Number(record.deduction).toFixed(2)}, taken from the ${month} payroll.` : '',
    deductionKh: record.deduction ? `ការកាត់ប្រាក់ខែ៖ ${Number(record.deduction).toFixed(2)} ដុល្លារអាមេរិក កាត់ពីប្រាក់ខែ ${month}។` : '',
    person: person || {},
  }
}

module.exports = { KINDS, KIND_KEYS, STATUSES, kindLabel, kindBoth, validDate, check, ladder, REGISTER_HEADER, registerRows, letterModel }
