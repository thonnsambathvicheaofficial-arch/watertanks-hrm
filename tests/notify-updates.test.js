// The follow-up for leave recorded AFTER a scan was announced, end to end: an in-memory database, a fake report engine and a fake Telegram.
// Checks what is sent, that it is sent once, that a failed send is retried, and that nothing is sent when nothing needs correcting.
const path = require('path')
process.env.TELEGRAM_BOT_TOKEN = 'test-token'
// The follow-up only looks at scans announced in the last 24 hours, so the clock is fixed: the test must not depend on the day it runs.
Date.now = () => Date.parse('2026-10-23T09:00:00Z')

class UserError extends Error {}
const T = { notification_log: [], leave_requests: [], day_overrides: [], punches: [] }
const parseOr = (expr) => String(expr).split(',').map(p => { const [col, op, ...v] = p.split('.'); return { col, op, val: v.join('.') } })

// A tiny chainable fake of the Supabase calls the notifier makes.
function from(name) {
  const rows = T[name] || []
  const f = []
  let op = 'select', payload = null, lim = Infinity
  const api = {
    select() { return api }, order() { return api }, limit(n) { lim = n; return api },
    eq(k, v) { f.push(r => r[k] === v); return api },
    is(k, v) { f.push(r => (v === null ? r[k] == null : r[k] === v)); return api },
    gte(k, v) { f.push(r => r[k] != null && String(r[k]) >= String(v)); return api },
    in(k, vs) { f.push(r => vs.includes(r[k])); return api },
    lt(k, v) { f.push(r => r[k] != null && String(r[k]) < String(v)); return api },
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

// What the report engine returns: the days as the scans alone read (raw) and as they read now, with the leave or correction.
let RAW = [], NOW = []
const stub = (rel, exports) => { const f = require.resolve(path.join('../lib', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports } }
const person = { pin: '456', name: 'Toem Piseth', group: 'office', timeIn: '07:00', timeOut: '17:00', departmentId: 'd1' }
stub('supabase.js', { from })
stub('hr-store.js', { UserError, available: async () => true, staff: { list: async () => [person] }, departments: { list: async () => [{ id: 'd1', name: 'Stock' }] } })
stub('store.js', { employees: { get: async () => ({ 456: { name: 'Toem Piseth', aliases: [] } }) } })
stub('report-data.js', { reportData: async (q) => ({ daily: q.skipOverrides || q.skipLeave ? RAW : NOW }), canonPunches: (p) => p })
const N = require('../lib/notify.js')

// A fake Telegram: records every message, and can be told to refuse.
const telegram = { sent: [], refuse: false }
globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body)
  if (telegram.refuse) return { status: 400, json: async () => ({ ok: false, description: 'Bad Request: chat not found' }) }
  telegram.sent.push(body.text)
  return { status: 200, json: async () => ({ ok: true, result: { message_id: telegram.sent.length } }) }
}
console.error = () => {}   // the failed-send case logs on purpose

let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }
const settings = { chat_id: 1 }
const T0 = '2026-10-23T05:56:29.000Z', AFTER = '2026-10-23T06:30:00.000Z', BEFORE = '2026-10-23T05:00:00.000Z'
const reset = () => { T.notification_log = [{ id: 1, punch_id: 11, pin: '456', ts: '2026-10-23T12:54:48', status: 'sent', reason: null, sent_at: T0 }]; T.leave_requests = []; T.day_overrides = []; telegram.sent = []; telegram.refuse = false }
const rawLate = { pin: '456', date: '2026-10-23', status: 'late', minutesLate: 349, in: '12:54', out: null, overridden: false }
const nowCorrected = { pin: '456', date: '2026-10-23', status: 'excused', overridden: true, rosterNote: 'ច្បាប់ 0,5 ថ្ងៃ 23/10/26', in: '12:54', out: null, minutesLate: 0 }
const row = () => T.notification_log[0]

;(async () => {
  console.log('the real case: a roster correction saying "leave 0.5 day", made after the Late announcement')
  reset(); RAW = [rawLate]; NOW = [nowCorrected]
  T.day_overrides = [{ pin: '456', date: '2026-10-23', status: 'excused', note: 'ច្បាប់ 0,5 ថ្ងៃ 23/10/26', set_at: AFTER }]
  let r = await N.sendLeaveUpdates(settings, {})
  ok(r.candidates === 1 && r.sent === 1 && telegram.sent.length === 1, 'one follow-up is sent')
  const lines = telegram.sent[0].split('\n')
  ok(lines[0].startsWith('ℹ️ <b>Update</b>') && lines[1] === '<b>Toem Piseth</b>' && lines[3].startsWith('🟣 <b>Back from morning leave</b>') && lines[3].includes('Late 5 h 49 min') && lines[3].includes('no longer applies'), 'it says back from morning leave and that Late 5 h 49 min no longer applies')
  ok(row().reason === 'Follow-up sent: leave recorded after this scan', 'the scan is marked as handled')
  r = await N.sendLeaveUpdates(settings, {})
  ok(r.candidates === 0 && telegram.sent.length === 1, 'running again says nothing more (once only)')

  console.log('an approved leave request recorded after the scan')
  reset(); RAW = [rawLate]; NOW = [{ pin: '456', date: '2026-10-23', status: 'leave', leaveDays: 0.5, leaveParts: [{ period: 'morning', typeName: 'Annual leave', code: 'AL' }], in: '12:54', overridden: false, minutesLate: 0 }]
  T.leave_requests = [{ status: 'approved', pin: '456', from_date: '2026-10-23', to_date: '2026-10-23', decided_at: AFTER, created_at: AFTER }]
  r = await N.sendLeaveUpdates(settings, {})
  ok(r.sent === 1 && telegram.sent[0].includes('Back from morning leave') && telegram.sent[0].includes('Annual leave'), 'a half-day request made after the scan produces the follow-up, naming the leave type')

  console.log('before the scan, or nothing to correct: nothing is sent')
  reset(); RAW = [rawLate]; NOW = [nowCorrected]
  T.day_overrides = [{ pin: '456', date: '2026-10-23', status: 'excused', note: 'ច្បាប់ 0,5 ថ្ងៃ', set_at: BEFORE }]
  r = await N.sendLeaveUpdates(settings, {})
  ok(r.candidates === 0 && telegram.sent.length === 0 && row().reason === null, 'leave recorded BEFORE the scan was announced needs no follow-up')
  reset(); RAW = [{ ...rawLate, status: 'present', minutesLate: 0 }]; NOW = [nowCorrected]
  T.day_overrides = [{ pin: '456', date: '2026-10-23', status: 'excused', note: 'ច្បាប់ 0,5 ថ្ងៃ', set_at: AFTER }]
  r = await N.sendLeaveUpdates(settings, {})
  ok(r.sent === 0 && r.checked === 1 && telegram.sent.length === 0 && row().reason === 'Checked after leave was recorded: nothing to correct', 'a scan that was not announced as late has nothing to withdraw: settled quietly, never looked at again')
  reset(); RAW = [rawLate]; NOW = [{ ...nowCorrected, rosterNote: 'ភ្លេចស្គេនចេញ' }]
  T.day_overrides = [{ pin: '456', date: '2026-10-23', status: 'excused', note: 'ភ្លេចស្គេនចេញ', set_at: AFTER }]
  r = await N.sendLeaveUpdates(settings, {})
  ok(r.candidates === 0 && telegram.sent.length === 0, 'a correction that is not about leave (forgot to scan out) is not a candidate')
  reset(); RAW = [rawLate]; NOW = [nowCorrected]
  T.day_overrides = [{ pin: '456', date: '2026-10-23', status: 'excused', note: 'ឈប់អត់ច្បាប់ 23/10/26', set_at: AFTER }]
  r = await N.sendLeaveUpdates(settings, {})
  ok(r.candidates === 0 && telegram.sent.length === 0, 'absent without leave never triggers a leave follow-up')

  console.log('dry run, and a Telegram that refuses')
  reset(); RAW = [rawLate]; NOW = [nowCorrected]
  T.day_overrides = [{ pin: '456', date: '2026-10-23', status: 'excused', note: 'ច្បាប់ 0,5 ថ្ងៃ', set_at: AFTER }]
  r = await N.sendLeaveUpdates(settings, { dryRun: true })
  ok(r.wouldSend.length === 1 && r.sent === 0 && telegram.sent.length === 0 && row().reason === null, 'a dry run shows what would be sent and writes and sends nothing')
  telegram.refuse = true
  r = await N.sendLeaveUpdates(settings, {})
  ok(r.sent === 0 && row().reason === null, 'if Telegram refuses, the scan is NOT marked, so the next run tries again')
  telegram.refuse = false
  r = await N.sendLeaveUpdates(settings, {})
  ok(r.sent === 1 && row().reason === 'Follow-up sent: leave recorded after this scan', 'and the next run sends it')

  console.log('nothing waiting')
  reset(); r = await N.sendLeaveUpdates(settings, {})
  ok(r.candidates === 0 && telegram.sent.length === 0, 'no leave changes: no work, no messages')
  T.notification_log = []; r = await N.sendLeaveUpdates(settings, {})
  ok(r.candidates === 0, 'no announced scans: no work')

  console.log(fails ? `\n${fails} FAILED` : '\nall passed')
  process.exit(fails ? 1 : 0)
})().catch(e => { console.log('ERROR', e.stack); process.exit(1) })
