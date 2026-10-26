// A shift changed after a scan was announced: the correction, end to end. In-memory database, the REAL attendance engine (it reads the
// scan under the old and the new times), a fake Telegram. Checks what is sent, that it is sent once, retried if Telegram refuses, and that
// nothing is sent when the scan reads the same under both shifts.
const path = require('path')
process.env.TELEGRAM_BOT_TOKEN = 'test-token'
Date.now = () => Date.parse('2026-10-23T09:00:00Z')   // the code looks at the last 12 hours, so the test must not depend on the day it runs

class UserError extends Error {}
const T = { notification_log: [], audit_log: [], punches: [], leave_requests: [], day_overrides: [] }
const parseOr = (expr) => String(expr).split(',').map(p => { const [col, op, ...v] = p.split('.'); return { col, op, val: v.join('.') } })
function from(name) {
  const rows = T[name] || []
  const f = []
  let op = 'select', payload = null, lim = Infinity
  const api = {
    select() { return api }, order() { return api }, limit(n) { lim = n; return api },
    eq(k, v) { f.push(r => r[k] === v); return api },
    is(k, v) { f.push(r => (v === null ? r[k] == null : r[k] === v)); return api },
    gte(k, v) { f.push(r => r[k] != null && String(r[k]) >= String(v)); return api },
    lt(k, v) { f.push(r => r[k] != null && String(r[k]) < String(v)); return api },
    in(k, vs) { f.push(r => vs.includes(r[k])); return api },
    or(expr) {
      const alts = parseOr(expr)
      const holds = (r, a) => (a.op === 'is' ? (a.val === 'null' ? r[a.col] == null : r[a.col] === a.val) : a.op === 'eq' ? r[a.col] === a.val : a.op === 'like' ? r[a.col] != null && String(r[a.col]).startsWith(a.val.replace(/\*$/, '')) : r[a.col] != null && String(r[a.col]) >= a.val)
      f.push(r => alts.some(a => holds(r, a))); return api
    },
    update(p) { op = 'update'; payload = p; return api },
    then(res, rej) {
      const hit = rows.filter(r => f.every(fn => fn(r))).slice(0, lim)
      if (op === 'update') hit.forEach(r => Object.assign(r, payload))
      return Promise.resolve({ data: hit.map(r => ({ ...r })), error: null }).then(res, rej)
    },
  }
  return api
}

let NOW = [], RAW = []
let people = {}, staffList = []
const stub = (rel, exports) => { const f = require.resolve(path.join('../lib', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports } }
stub('supabase.js', { from })
stub('hr-store.js', { UserError, available: async () => true, staff: { list: async () => staffList }, departments: { list: async () => [{ id: 'd1', name: 'Plastic' }] }, shifts: { list: async () => [{ id: 's-night', name: 'Night' }] } })
stub('store.js', { employees: { get: async () => people }, settings: { get: async () => ({ workStart: '08:00', workEnd: '17:30', graceMinutes: 5 }) } })
stub('report-data.js', { reportData: async (q) => ({ daily: q.skipOverrides || q.skipLeave ? RAW : NOW }), canonPunches: (rows) => rows })
const N = require('../lib/notify.js')

const telegram = { sent: [], refuse: false }
globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body)
  if (telegram.refuse) return { status: 400, json: async () => ({ ok: false, description: 'Bad Request: chat not found' }) }
  telegram.sent.push(body.text)
  return { status: 200, json: async () => ({ ok: true, result: { message_id: telegram.sent.length } }) }
}
console.error = () => {}

let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }
const settings = { chat_id: 1 }
const T0 = '2026-10-23T05:56:29.000Z', AFTER = '2026-10-23T06:30:00.000Z', BEFORE = '2026-10-23T05:00:00.000Z'
const night = { pin: '431', name: 'Doerun Doun', group: 'worker', timeIn: '17:00', timeOut: '00:00', offDays: [0], aliases: [], departmentId: 'd1', shiftId: 's-night' }
const toNight = { timeIn: { from: '07:00', to: '17:00' }, timeOut: { from: '17:00', to: '00:00' }, shiftId: { from: 's-day', to: 's-night' } }
const row = () => T.notification_log[0]
function setup({ scan = '16:04', audit = toNight, auditAt = AFTER, person = night, nowRow } = {}) {
  people = { 431: person }; staffList = [{ ...person, pin: '431' }]
  const ts = `2026-10-23T${scan}:00`
  T.notification_log = [{ id: 1, punch_id: 11, pin: '431', ts, status: 'sent', reason: null, sent_at: T0 }]
  T.punches = [{ id: 11, pin: '431', ts, device_id: 'd1' }]
  T.audit_log = [{ id: 1, action: 'staff.update', entity_key: '431', at: auditAt, details: audit }]
  NOW = [nowRow || { pin: '431', date: '2026-10-23', status: 'present', in: scan, out: null, minutesLate: 0, overridden: false }]
  RAW = NOW
  telegram.sent = []; telegram.refuse = false
}

;(async () => {
  console.log('the real case: a day worker moved to the night shift after the 16:04 scan was announced as Punch out')
  setup()
  let r = await N.sendShiftCorrections(settings, {})
  ok(r.candidates === 1 && r.sent === 1 && telegram.sent.length === 1, 'one correction is sent')
  const lines = telegram.sent[0].split('\n')
  ok(lines[0] === '✏️ <b>Correction</b> · announced as 🔴 Punch out (shift changed to Night)' && lines[1].includes('Punch in') && !telegram.sent[0].includes('Late') && lines[2] === '<b>Doerun Doun</b>', 'it says it was announced as Punch out, and shows the scan as Punch in, with no Late remark')
  ok(row().reason === 'Correction sent: announced as Punch out, shift changed to Night', 'the scan is marked as corrected')
  r = await N.sendShiftCorrections(settings, {})
  ok(r.candidates === 0 && telegram.sent.length === 1, 'running again says nothing more (once only)')

  console.log('a late arrival under the new shift is stated correctly in the correction')
  setup({ scan: '17:20', nowRow: { pin: '431', date: '2026-10-23', status: 'late', in: '17:20', out: null, minutesLate: 15, overridden: false } })
  r = await N.sendShiftCorrections(settings, {})
  ok(r.sent === 1 && telegram.sent[0].includes('Punch in') && telegram.sent[0].includes('Late 15 min'), 'the corrected message carries Late 15 min against the new 17:00 start')

  console.log('nothing to correct')
  setup({ auditAt: BEFORE })
  r = await N.sendShiftCorrections(settings, {})
  ok(r.candidates === 0 && telegram.sent.length === 0 && row().reason === null, 'a shift changed BEFORE the scan was announced: the message was already right')
  setup({ audit: { maritalStatus: { from: '', to: 'Single' } } })
  r = await N.sendShiftCorrections(settings, {})
  ok(r.candidates === 0 && telegram.sent.length === 0, 'a change that is not about times (marital status) is ignored')
  setup({ scan: '07:05', person: { ...night, timeIn: '07:30', timeOut: '17:00' }, audit: { timeIn: { from: '07:00', to: '07:30' } } })
  r = await N.sendShiftCorrections(settings, {})
  ok(r.sent === 0 && r.checked === 1 && telegram.sent.length === 0 && row().reason === 'Checked after a shift change: direction unchanged', 'a start moved from 07:00 to 07:30 leaves a 07:05 arrival a Punch in either way: settled quietly, never looked at again')

  console.log('dry run, and a Telegram that refuses')
  setup()
  r = await N.sendShiftCorrections(settings, { dryRun: true })
  ok(r.wouldSend.length === 1 && r.sent === 0 && telegram.sent.length === 0 && row().reason === null, 'a dry run shows what would be sent and writes and sends nothing')
  telegram.refuse = true
  r = await N.sendShiftCorrections(settings, {})
  ok(r.sent === 0 && row().reason === null, 'if Telegram refuses, the scan is NOT marked, so the next run tries again')
  telegram.refuse = false
  r = await N.sendShiftCorrections(settings, {})
  ok(r.sent === 1 && row().reason.startsWith('Correction sent'), 'and the next run sends it')

  console.log('a scan only checked for a shift change can still get a leave follow-up')
  setup({ scan: '12:54', person: { ...night, timeIn: '07:00', timeOut: '17:00', shiftId: '' } })
  T.notification_log[0].reason = 'Checked after a shift change: direction unchanged'
  RAW = [{ pin: '431', date: '2026-10-23', status: 'late', in: '12:54', out: null, minutesLate: 349, overridden: false }]
  NOW = [{ pin: '431', date: '2026-10-23', status: 'excused', overridden: true, rosterNote: 'ច្បាប់ 0,5 ថ្ងៃ', in: '12:54', out: null, minutesLate: 0 }]
  T.day_overrides = [{ pin: '431', date: '2026-10-23', status: 'excused', note: 'ច្បាប់ 0,5 ថ្ងៃ', set_at: AFTER }]
  r = await N.sendLeaveUpdates(settings, {})
  ok(r.sent === 1 && telegram.sent[0].includes('Back from morning leave') && row().reason === 'Follow-up sent: leave recorded after this scan', 'the leave follow-up is not blocked by the shift check marker')

  console.log(fails ? `\n${fails} FAILED` : '\nall passed')
  process.exit(fails ? 1 : 0)
})().catch(e => { console.log('ERROR', e.stack); process.exit(1) })
