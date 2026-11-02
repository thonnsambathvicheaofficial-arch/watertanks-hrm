// The shortcut around the follow-up checks (a shift changed, leave recorded after a scan): they run only when something new was recorded
// since they last finished cleanly. In-memory database, fake Telegram, whole notifier cycles (run).
const path = require('path')
process.env.TELEGRAM_BOT_TOKEN = 'test-token'
Date.now = () => Date.parse('2026-10-23T09:00:00Z')

class UserError extends Error {}
const T = { notification_settings: [], notification_log: [], audit_log: [], punches: [], leave_requests: [], day_overrides: [] }
const calls = {}                       // how many times each table was queried in the current cycle
const parseOr = (expr) => String(expr).split(',').map(p => { const [col, op, ...v] = p.split('.'); return { col, op, val: v.join('.') } })
function from(name) {
  calls[name] = (calls[name] || 0) + 1
  const rows = T[name] || []
  const f = [], sorts = []
  let op = 'select', payload = null, lim = Infinity
  const api = {
    select() { return api }, limit(n) { lim = n; return api },
    order(k, o) { sorts.push([k, !(o && o.ascending === false)]); return api },
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
    maybeSingle() { op = 'one'; return api }, single() { op = 'one'; return api },
    then(res, rej) {
      let hit = rows.filter(r => f.every(fn => fn(r)))
      for (const [k, asc] of [...sorts].reverse()) hit = hit.sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (asc ? 1 : -1))
      hit = hit.slice(0, lim)
      if (op === 'update') hit.forEach(r => Object.assign(r, payload))
      const data = op === 'one' ? (hit[0] ? { ...hit[0] } : null) : hit.map(r => ({ ...r }))
      return Promise.resolve({ data, error: null }).then(res, rej)
    },
  }
  return api
}

const stub = (rel, exports) => { const f = require.resolve(path.join('../lib', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports } }
const person = { pin: '431', name: 'Doerun Doun', group: 'worker', timeIn: '17:00', timeOut: '00:00', offDays: [0], aliases: [], departmentId: 'd1', shiftId: 's-night' }
stub('supabase.js', { from })
stub('hr-store.js', { UserError, available: async () => true, staff: { list: async () => [person] }, departments: { list: async () => [{ id: 'd1', name: 'Plastic' }] }, shifts: { list: async () => [{ id: 's-night', name: 'Night' }] } })
stub('store.js', { employees: { get: async () => ({ 431: person }) }, settings: { get: async () => ({ workStart: '08:00', workEnd: '17:30', graceMinutes: 5 }) } })
let NOW = []
stub('report-data.js', { reportData: async () => ({ daily: NOW }), canonPunches: (rows) => rows })
const N = require('../lib/notify.js')

const telegram = { sent: [], refuse: false }
globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body)
  if (telegram.refuse) return { status: 400, json: async () => ({ ok: false, description: 'chat not found' }) }
  telegram.sent.push(body.text)
  return { status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) }
}
console.error = () => {}

let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }
const cycle = async () => { for (const k of Object.keys(calls)) delete calls[k]; const r = await N.run({}); return { r, audit: calls.audit_log || 0 } }
const T0 = '2026-10-23T05:56:29.000Z', AFTER = '2026-10-23T06:30:00.000Z'

;(async () => {
  T.notification_settings = [{ id: 1, enabled: true, chat_id: 1, scope_group: 'all', department_ids: [], ignore_repeat_seconds: 120, max_age_minutes: 30, digest_threshold: 12, cursor_at: '2026-10-23T08:59:00.000Z' }]
  T.audit_log = [{ id: 10, action: 'login.success', at: '2026-10-23T01:00:00.000Z', details: {} }]

  console.log('a cycle with nothing new')
  let c = await cycle()
  ok(c.audit === 2, 'the first cycle of a server instance runs the follow-up checks once (the audit log is read twice: the change check and the shift check)')
  c = await cycle()
  ok(c.audit === 1 && c.r.followUps === 'nothing new', 'the next cycles only read the newest audit entry and skip both checks')
  c = await cycle()
  ok(c.audit === 1, 'and keep skipping while nothing is recorded')

  console.log('something is recorded')
  T.audit_log.push({ id: 11, action: 'correction.set', at: AFTER, details: {} })
  c = await cycle()
  ok(c.audit === 2, 'a new audit entry makes the next cycle run the checks again, once')
  c = await cycle()
  ok(c.audit === 1 && c.r.followUps === 'nothing new', 'then it goes quiet again')

  console.log('a follow-up that could not be sent keeps the checks running')
  T.notification_log = [{ id: 1, punch_id: 11, pin: '431', ts: '2026-10-23T16:04:00', status: 'sent', reason: null, sent_at: T0 }]
  T.punches = [{ id: 11, pin: '431', ts: '2026-10-23T16:04:00', device_id: 'd1', created_at: T0 }]
  T.audit_log.push({ id: 12, action: 'staff.update', entity_key: '431', at: AFTER, details: { timeIn: { from: '07:00', to: '17:00' }, timeOut: { from: '17:00', to: '00:00' } } })
  NOW = [{ pin: '431', date: '2026-10-23', status: 'present', in: '16:04', out: null, minutesLate: 0, overridden: false }]
  telegram.refuse = true
  c = await cycle()
  ok(c.audit === 2 && telegram.sent.length === 0 && T.notification_log[0].reason === null, 'Telegram refuses the correction: nothing is marked')
  c = await cycle()
  ok(c.audit === 2, 'so the next cycle runs the checks again instead of treating the change as done')
  telegram.refuse = false
  c = await cycle()
  ok(c.audit === 2 && telegram.sent.length === 1 && /^Correction sent/.test(T.notification_log[0].reason), 'when Telegram accepts, the correction goes out once')
  c = await cycle()
  ok(c.audit === 1 && telegram.sent.length === 1, 'and the checks go quiet again')

  console.log(fails ? `\n${fails} FAILED` : '\nall passed')
  process.exit(fails ? 1 : 0)
})().catch(e => { console.log('ERROR', e.stack); process.exit(1) })
