// Telegram notifications for staff scans.
//
// After the device sync saves new scans, run() announces each one in the Telegram group:
// name, department, group, date and time. It never announces history, never announces a scan
// twice, and can never get in the way of attendance: it runs after the scans are safely saved,
// inside a time budget, and every failure is caught.
//
//  - Only scans saved since notifications were switched on (the cursor) are considered, and
//    never a scan older than max_age_minutes. A full re-read of the device is therefore silent.
//  - Each scan is claimed in notification_log (unique per scan) BEFORE it is sent, so two
//    overlapping runs cannot both send it, and a failed send is retried on a later run.
//  - Scans are remapped like the reports (device PIN remaps, other-PIN aliases), so the right
//    person is named.
//  - Telegram allows about 20 messages a minute to one group. Up to digest_threshold waiting scans
//    are sent one message each; more than that go out together as digests.
//
// The bot token is read from the TELEGRAM_BOT_TOKEN environment variable only. It is never stored,
// logged or returned.
const sb = require('./supabase')
const store = require('./store')
const hr = require('./hr-store')
const { UserError } = hr

const MAX_ATTEMPTS = 5
const TG = 'https://api.telegram.org'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const isMissingTable = (e) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /could not find the table|does not exist/i.test(e.message || ''))
const fail = (m) => { throw new UserError(m) }

// ── time ────────────────────────────────────────────────────────────────────
const PP = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
function nowPP(d = new Date()) {
  const p = Object.fromEntries(PP.formatToParts(d).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`
}
const asMs = (ts) => { const m = String(ts).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dateLabel = (ts) => `${Number(ts.slice(8, 10))} ${MONTHS[Number(ts.slice(5, 7)) - 1]} ${ts.slice(0, 4)}`
const timeLabel = (ts) => { const h = Number(ts.slice(11, 13)), m = ts.slice(14, 16); return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}` }

// ── message ─────────────────────────────────────────────────────────────────
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const GROUP = { office: 'Office staff', worker: 'Worker' }

function describe(person, deptName) {
  const bits = [deptName || 'No department']
  if (GROUP[person.group]) bits.push(GROUP[person.group])
  return bits.join(' · ')
}

// A clock face showing the nearest half hour.
const CLOCK_HOUR = ['🕛', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚']
const CLOCK_HALF = ['🕧', '🕜', '🕝', '🕞', '🕟', '🕠', '🕡', '🕢', '🕣', '🕤', '🕥', '🕦']
function clockFor(ts) {
  const h = Number(ts.slice(11, 13)), m = Number(ts.slice(14, 16))
  if (m < 15) return CLOCK_HOUR[h % 12]
  if (m < 45) return CLOCK_HALF[h % 12]
  return CLOCK_HOUR[(h + 1) % 12]
}
const DIRECTION = { in: { icon: '🟢', text: 'Punch in' }, out: { icon: '🔴', text: 'Punch out' }, repeat: { icon: '⚪', text: 'Repeat scan' } }
const remark = (direction) => (DIRECTION[direction] ? `${DIRECTION[direction].icon} <b>${DIRECTION[direction].text}</b>` : '')

// "Late 12 min", or "Late 1 h 05 min" from an hour up. Empty when the person is not late.
const lateLabel = (min) => (min > 0 ? (min >= 60 ? `Late ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min` : `Late ${min} min`) : '')
const lateRemark = (min) => (min > 0 ? `🟠 <b>${lateLabel(min)}</b>` : '')

// Leave context for a scan: { tag: 'back' | 'afternoon' | 'full', type: 'Annual leave' }.
//   back       a morning half-day: the first scan is them returning, not a late arrival
//   afternoon  an afternoon half-day: the punch out around noon is them leaving for the leave
//   full       approved leave for the whole day, yet they scanned: flagged for HR
const LEAVE_TAG = { back: '🟣 <b>Back from morning leave</b>', afternoon: '🟣 <b>Afternoon leave</b>', full: '⚠️ <b>On approved leave today</b>' }
const leaveRemark = (leave) => (leave && LEAVE_TAG[leave.tag]) || ''

function formatOne(ts, person, deptName, direction, lateMin, leave) {
  const lv = leaveRemark(leave)
  // Someone on leave is not announced as late: the leave explains the time.
  const r = [remark(direction), lv || (direction === 'in' ? lateRemark(lateMin) : '')].filter(Boolean).join(' · ')
  const who = `<b>${esc(person.name || `PIN ${person.pin}`)}</b>`
  return `${clockFor(ts)} <b>${timeLabel(ts)}</b>${r ? ` · ${r}` : ''}
${who}
<i>${esc(describe(person, deptName))} · ${dateLabel(ts)}${lv && leave.type ? ` · ${esc(leave.type)}` : ''}</i>`
}
// Several scans in one message, grouped under their date, split so each message stays under Telegram's limit.
function formatDigests(items, limit = 3800) {
  const lines = items.map(i => {
    const d = DIRECTION[i.direction]
    return { day: dateLabel(i.ts), text: `${d ? d.icon + ' ' : ''}${timeLabel(i.ts)}${d ? ` ${d.text}` : ''} · ${esc(i.person.name || `PIN ${i.person.pin}`)} · ${esc(describe(i.person, i.deptName))}${i.leave && LEAVE_TAG[i.leave.tag] ? ` · ${LEAVE_TAG[i.leave.tag].replace(/<[^>]+>/g, '')}${i.leave.type ? ` (${esc(i.leave.type)})` : ''}` : (i.direction === 'in' && i.lateMin > 0 ? ` · 🟠 ${lateLabel(i.lateMin)}` : '')}` }
  })
  const out = []
  let cur = [], size = 0
  const flush = () => { if (cur.length) out.push(cur.join('\n')); cur = []; size = 0 }
  for (const l of lines) {
    if (size + l.text.length + 60 > limit) flush()
    if (cur.length === 0) cur.push(`<b>${items.length} scans · ${l.day}</b>`)
    cur.push(l.text); size += l.text.length + 1
  }
  flush()
  return out
}

// Devices do not record in or out (every scan is state 0), so direction comes from the order of a person's scans:
// scans a long gap apart are separate sessions (16 hours or more apart start a new one, so night shifts and a forgotten
// punch-out both work). In a session the first scan is IN; the next scan at least 30 minutes later is OUT; a scan within
// 30 minutes of the previous one is a repeat; after an OUT the next real scan (an hour on, e.g. overtime) is IN again.
const REPEAT_MIN = 30, SESSION_GAP_H = 16
function labelScans(times) {
  const ms = times.map(asMs)
  const out = []
  let state = 'outside', last = null
  for (let i = 0; i < times.length; i++) {
    if (last !== null && ms[i] - last >= SESSION_GAP_H * 3600000) state = 'outside'
    if (last !== null && ms[i] - last < REPEAT_MIN * 60000) { out.push('repeat'); continue }
    if (state === 'outside') { out.push('in'); state = 'inside' } else { out.push('out'); state = 'outside' }
    last = ms[i]
  }
  return out
}

// ── deciding who is announced (pure; tested without a database) ─────────────
// punches: [{ id, pin, ts }] already remapped. people: Map pin -> staff profile. lastSent: Map pin -> ts of the last announced scan.
function decide(punches, { people, deptNames, settings, now, lastSent = new Map() }) {
  const send = [], skip = []
  const nowMs = asMs(now)
  const last = new Map(lastSent)
  for (const p of punches) {
    const person = people.get(p.pin)
    if (!person) { skip.push({ punch: p, reason: 'not on the staff list' }); continue }
    const ageMs = nowMs - asMs(p.ts)
    const createdAgeMs = p.created_at ? nowMs - asMs(/[Z+]/.test(String(p.created_at)) ? nowPP(new Date(p.created_at)) : p.created_at) : NaN
    const isRecent = ageMs <= settings.max_age_minutes * 60000 || (!isNaN(createdAgeMs) && createdAgeMs <= settings.max_age_minutes * 60000 && ageMs <= 12 * 3600000)
    if (!isRecent) { skip.push({ punch: p, reason: 'too old to announce' }); continue }
    if (asMs(p.ts) - nowMs > 5 * 60000) { skip.push({ punch: p, reason: 'time is in the future' }); continue }
    if (settings.scope_group !== 'all' && person.group !== settings.scope_group) { skip.push({ punch: p, reason: 'outside the chosen group' }); continue }
    if (settings.department_ids.length && !settings.department_ids.includes(person.departmentId)) { skip.push({ punch: p, reason: 'outside the chosen departments' }); continue }
    const prev = last.get(p.pin)
    if (prev && settings.ignore_repeat_seconds > 0 && Math.abs(asMs(p.ts) - asMs(prev)) < settings.ignore_repeat_seconds * 1000) { skip.push({ punch: p, reason: 'repeat scan' }); continue }
    last.set(p.pin, p.ts)
    send.push({ punch: p, ts: p.ts, person, deptName: deptNames.get(person.departmentId) || '' })
  }
  return { send, skip }
}

// ── Telegram ────────────────────────────────────────────────────────────────
const token = () => process.env.TELEGRAM_BOT_TOKEN || ''
async function call(method, body) {
  const t = token()
  if (!t) return { ok: false, error: 'The bot token is not set (TELEGRAM_BOT_TOKEN).' }
  try {
    const r = await fetch(`${TG}/bot${t}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(10000) })
    const j = await r.json().catch(() => ({}))
    if (j.ok) return { ok: true, result: j.result }
    return { ok: false, error: j.description || `Telegram answered ${r.status}`, retryAfter: j.parameters && j.parameters.retry_after, status: r.status }
  } catch (e) { return { ok: false, error: e.name === 'TimeoutError' ? 'Telegram did not answer in time.' : 'Could not reach Telegram.' } }
}
async function sendMessage(chatId, text) {
  let r = await call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true })
  if (!r.ok && r.retryAfter && r.retryAfter <= 5) { await sleep(r.retryAfter * 1000 + 200); r = await call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }) }
  return r
}

// ── settings ────────────────────────────────────────────────────────────────
const DEFAULTS = { id: 1, enabled: false, chat_id: null, scope_group: 'all', department_ids: [], ignore_repeat_seconds: 120, max_age_minutes: 30, digest_threshold: 12, cursor_at: null, leave_digest_enabled: false, leave_digest_time: '07:30', leave_digest_last: null }
let probe = { at: 0, ok: false }
async function ready() {
  if (Date.now() - probe.at < 15000) return probe.ok
  const { error } = await sb.from('notification_settings').select('id').limit(1)
  probe = { at: Date.now(), ok: !error }
  if (error && !isMissingTable(error)) throw new Error(error.message)
  return probe.ok
}
async function getSettings() {
  if (!(await ready())) return { ...DEFAULTS, ready: false }
  const { data, error } = await sb.from('notification_settings').select('*').eq('id', 1).maybeSingle()
  if (error) throw new Error(error.message)
  return { ...DEFAULTS, ...(data || {}), ready: true, digestReady: !!data && 'leave_digest_enabled' in data }   // digestReady: migration 007 has been run
}

const CHAT = /^(-?\d{5,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/
async function saveSettings(input, by) {
  if (!(await ready())) fail('Telegram notifications need migration 006. Run it first.')
  const cur = await getSettings()
  const chat = String(input.chatId == null ? '' : input.chatId).trim()
  if (chat && !CHAT.test(chat)) fail('The group ID looks like -1001234567890. Use the ID, not the group name.')
  const scope = ['all', 'office', 'worker'].includes(input.scopeGroup) ? input.scopeGroup : 'all'
  const num = (v, lo, hi, label) => { const n = Number(v); if (!Number.isInteger(n) || n < lo || n > hi) fail(`${label} must be a whole number from ${lo} to ${hi}.`); return n }
  const row = {
    chat_id: chat || null, scope_group: scope,
    ignore_repeat_seconds: num(input.ignoreRepeatSeconds, 0, 3600, 'Ignore repeat scans within'),
    max_age_minutes: num(input.maxAgeMinutes, 1, 1440, 'Skip scans older than'),
    digest_threshold: num(input.digestThreshold, 1, 100, 'Digest threshold'),
    updated_at: new Date().toISOString(), updated_by: by || null,
  }
  const wanted = (input.departmentIds || []).map(String)
  if (wanted.length) {
    const known = new Set((await hr.departments.list()).map(d => d.id))
    if (wanted.some(id => !known.has(id))) fail('One of the chosen departments no longer exists.')
  }
  row.department_ids = wanted
  if (cur.digestReady && input.leaveDigestTime !== undefined) {
    const t = String(input.leaveDigestTime || '').trim()
    if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(t)) fail('The daily leave message time must look like 07:30.')
    row.leave_digest_time = t
    row.leave_digest_enabled = !!input.leaveDigestEnabled
  }
  const enabled = !!input.enabled
  if (enabled && !chat) fail('Enter the Telegram group ID before switching notifications on.')
  if (enabled && !token()) fail('The bot token is not set on the server (TELEGRAM_BOT_TOKEN), so notifications cannot be switched on yet.')
  row.enabled = enabled
  // Switching on starts from now: scans already saved are never announced.
  if (enabled && !cur.enabled) row.cursor_at = new Date().toISOString()
  const { error } = await sb.from('notification_settings').upsert({ id: 1, ...row }, { onConflict: 'id' })
  if (error) throw new Error(error.message)
  return { before: cur, after: { ...cur, ...row } }
}

// "Is the bot token valid, and can it post in the group?" for the settings page.
async function check(chatId) {
  if (!token()) return { ok: false, error: 'The bot token is not set on the server (TELEGRAM_BOT_TOKEN).' }
  const me = await call('getMe')
  if (!me.ok) return { ok: false, error: `The bot token was refused: ${me.error}` }
  if (!chatId) return { ok: true, bot: me.result.username, chat: null }
  const chat = await call('getChat', { chat_id: chatId })
  if (!chat.ok) return { ok: false, bot: me.result.username, error: `The bot cannot see that group: ${chat.error}. Add the bot to the group and check the ID.` }
  return { ok: true, bot: me.result.username, chat: chat.result.title || chat.result.username || String(chat.result.id) }
}
async function sendTest(chatId, by) {
  const c = await check(chatId)
  if (!c.ok) return c
  const r = await sendMessage(chatId, `<b>Song Fa HR</b>\nTest message${by ? ` from ${esc(by)}` : ''}. Scan notifications will appear here when they are switched on.`)
  return r.ok ? { ...c, sent: true } : { ...c, ok: false, error: `The test message was not delivered: ${r.error}` }
}

// ── the run after each sync ─────────────────────────────────────────────────
async function run({ budgetMs = 15000, dryRun = false } = {}) {
  const started = Date.now()
  const stats = { enabled: false, considered: 0, sent: 0, skipped: 0, failed: 0, left: 0 }
  try {
    const s = await getSettings()
    if (!s.ready || !s.enabled) return { ...stats, note: 'off' }
    stats.enabled = true
    if (!token() || !s.chat_id) return { ...stats, note: 'not configured' }
    if (!s.cursor_at) { await sb.from('notification_settings').update({ cursor_at: new Date().toISOString() }).eq('id', 1); return { ...stats, note: 'started now' } }
    if (!dryRun) stats.leaveListed = await maybeLeaveDigest(s)

    // 1. Scans saved since the cursor that have no log row yet, plus earlier sends that failed or were left pending.
    const [fresh, retry] = await Promise.all([
      sb.from('punches').select('id,pin,ts,created_at,device_id').gte('created_at', s.cursor_at).order('created_at', { ascending: true }).order('id', { ascending: true }).limit(400),
      sb.from('notification_log').select('punch_id,attempts,status,created_at').in('status', ['failed', 'pending']).lt('attempts', MAX_ATTEMPTS).gte('created_at', new Date(Date.now() - 6 * 3600000).toISOString()).limit(100),
    ])
    if (fresh.error) throw new Error(fresh.error.message)
    const stale = (retry.data || []).filter(r => r.status === 'failed' || Date.now() - new Date(r.created_at).getTime() > 90000)
    let candidates = fresh.data || []
    const cursorNext = candidates.length ? candidates[candidates.length - 1].created_at : null
    if (stale.length) {
      const { data: again } = await sb.from('punches').select('id,pin,ts,created_at,device_id').in('id', stale.map(r => r.punch_id))
      candidates = candidates.concat((again || []).filter(p => !candidates.some(c => c.id === p.id)))
    }
    // 2. Claim them. A scan that already has a log row is left alone unless it is a retry.
    const retryIds = new Set(stale.map(r => r.punch_id))
    const { data: known } = await sb.from('notification_log').select('punch_id').in('punch_id', candidates.map(p => p.id))
    const logged = new Set((known || []).map(r => r.punch_id))
    const isNew = (p) => !logged.has(p.id)
    if (dryRun) {
      candidates = candidates.filter(p => isNew(p) || retryIds.has(p.id))     // nothing is written or sent
    } else {
      const fresh2 = candidates.filter(isNew)
      let mine = new Set()
      if (fresh2.length) {
        const { data: claimed, error: cErr } = await sb.from('notification_log').upsert(fresh2.map(p => ({ punch_id: p.id, pin: p.pin, ts: p.ts, status: 'pending' })), { onConflict: 'punch_id', ignoreDuplicates: true }).select('punch_id')
        if (cErr) throw new Error(cErr.message)
        mine = new Set((claimed || []).map(r => r.punch_id))   // only the rows this run really inserted: an overlapping run cannot send the same scan
      }
      candidates = candidates.filter(p => mine.has(p.id) || retryIds.has(p.id))
    }
    stats.considered = candidates.length
    if (!candidates.length) { if (!dryRun && cursorNext) await sb.from('notification_settings').update({ cursor_at: cursorNext }).eq('id', 1); return stats }

    // 3. Who they are, then who to announce.
    const [people, depts, recent] = await Promise.all([store.employees.get(), hr.departments.list(), recentlySent(candidates.map(p => p.pin))])
    const { canonPunches } = require('./report-data')
    const mapped = canonPunches(candidates.map(p => ({ ...p, deviceId: p.device_id, time: String(p.ts).replace('T', ' ').slice(0, 19) })), people)
      .map(p => ({ id: p.id, pin: p.pin, ts: String(p.ts).replace('T', ' ').slice(0, 19), created_at: p.created_at }))
    mapped.sort((x, y) => (x.ts < y.ts ? -1 : x.ts > y.ts ? 1 : 0))     // announce in the order people scanned, whatever order they were saved
    const full = await hr.staff.list()
    const byPin = new Map(full.map(x => [x.pin, x]))
    const dec = decide(mapped, { people: byPin, deptNames: new Map(depts.map(d => [d.id, d.name])), settings: s, now: nowPP(), lastSent: recent })
    stats.skipped = dec.skip.length
    if (dec.send.length) { await addDirections(dec.send, people); await addLateness(dec.send) }
    if (dryRun) return { ...stats, wouldSend: dec.send.map(x => ({ pin: x.punch.pin, ts: x.ts, text: formatOne(x.ts, x.person, x.deptName, x.direction, x.lateMin, x.leave) })), skipped: dec.skip.map(x => `${x.punch.pin} ${x.punch.ts} ${x.reason}`) }
    for (const g of groupBy(dec.skip, x => x.reason)) await sb.from('notification_log').update({ status: 'skipped', reason: g.key }).in('punch_id', g.items.map(x => x.punch.id))

    // 4. Send.
    const pending = dec.send
    const markSent = (ids) => sb.from('notification_log').update({ status: 'sent', sent_at: new Date().toISOString(), reason: null }).in('punch_id', ids)
    const markFailed = async (ids, why) => { for (const id of ids) { const { data } = await sb.from('notification_log').select('attempts').eq('punch_id', id).maybeSingle(); await sb.from('notification_log').update({ status: 'failed', reason: String(why).slice(0, 200), attempts: ((data && data.attempts) || 0) + 1 }).eq('punch_id', id) } }
    if (pending.length > s.digest_threshold) {
      const texts = formatDigests(pending)
      // One digest covers every waiting scan; if any message fails all of them are retried later.
      let okAll = true, why = ''
      for (const t of texts) { const r = await sendMessage(s.chat_id, t); if (!r.ok) { okAll = false; why = r.error; break } await sleep(400) }
      if (okAll) { await markSent(pending.map(x => x.punch.id)); stats.sent = pending.length } else { await markFailed(pending.map(x => x.punch.id), why); stats.failed = pending.length }
    } else {
      for (let i = 0; i < pending.length; i++) {
        if (Date.now() - started > budgetMs) { stats.left = pending.length - i; break }   // the rest stay pending and go out on the next run
        const x = pending[i]
        const r = await sendMessage(s.chat_id, formatOne(x.ts, x.person, x.deptName, x.direction, x.lateMin, x.leave))
        if (r.ok) { await markSent([x.punch.id]); stats.sent++ } else { await markFailed([x.punch.id], r.error); stats.failed++; if (r.status === 401 || r.status === 403 || r.status === 400) { stats.left = pending.length - i - 1; break } }
        await sleep(350)
      }
    }
    if (cursorNext) await sb.from('notification_settings').update({ cursor_at: cursorNext }).eq('id', 1)
    return stats
  } catch (e) {
    console.error('[notify]', e.message)
    return { ...stats, error: 'notification run failed' }
  }
}

// Works out in / out for the scans about to be announced from each person's last 36 hours of scans.
async function addDirections(items, people) {
  const since = nowPP(new Date(Date.now() - 36 * 3600000))
  const rows = await require('./select-all')('punches', q => q.select('id,pin,ts,device_id').gte('ts', since).order('ts', { ascending: true }).order('id', { ascending: true }))
  const { canonPunches } = require('./report-data')
  const hist = canonPunches(rows.map(p => ({ ...p, deviceId: p.device_id, time: String(p.ts).replace('T', ' ').slice(0, 19) })), people)
  const byPin = new Map()
  for (const p of hist) { const t = String(p.ts).replace('T', ' ').slice(0, 19); (byPin.get(p.pin) || byPin.set(p.pin, new Set()).get(p.pin)).add(t) }
  const labels = new Map()
  for (const [pin, set] of byPin) { const times = [...set].sort(); const l = labelScans(times); times.forEach((t, i) => labels.set(pin + '|' + t, l[i])) }
  for (const x of items) x.direction = labels.get(x.punch.pin + '|' + x.ts) || null
}

// Minutes late for a punch in, taken from the same engine as the reports so the group and the reports always agree.
// Only the person's first scan of that day (the one the report counts as their arrival) can be late.
// The same day row also says whether the person is on approved leave (a whole day, or a half day by period), so
// the message can explain a noon arrival or a noon departure.
async function addLateness(items) {
  if (!items.length) return
  const dayOf = (ts) => ts.slice(0, 10)
  const prev = (d) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - 86400000).toISOString().slice(0, 10)
  const days = items.map(x => dayOf(x.ts)).sort()
  try {
    const { reportData } = require('./report-data')
    const { daily } = await reportData({ from: prev(days[0]), to: days[days.length - 1] })
    const row = new Map(daily.map(d => [d.pin + '|' + d.date, d]))
    for (const x of items) {
      const d = row.get(x.punch.pin + '|' + dayOf(x.ts))
      if (x.direction === 'in' && d && d.status === 'late' && d.minutesLate > 0 && d.in === x.ts.slice(11, 16)) x.lateMin = d.minutesLate
      // A night shift's punch out lands on the next calendar day, so for a punch out also look at the shift that began the day before.
      let ld = d
      if (!(d && d.status === 'leave') && x.direction === 'out') { const p = row.get(x.punch.pin + '|' + prev(dayOf(x.ts))); if (p && p.status === 'leave' && p.outNextDay) ld = p }
      const leave = leaveContext(ld, x.direction)
      if (leave) x.leave = leave
    }
  } catch (e) { console.error('[notify] lateness and leave unavailable:', e.message) }   // a message without these remarks is better than none
}

// ── the daily "on leave today" message ──────────────────────────────────────
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const dayLabel = (d) => `${WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()]} ${dateLabel(`${d} 00:00:00`)}`

// entries: [{ name, deptName, type, bucket: 'full' | 'morning' | 'afternoon' | 'part' }]
function formatLeaveDigest(date, entries, limit = 3800) {
  const SECTIONS = [['full', 'Full day'], ['morning', 'Morning'], ['afternoon', 'Afternoon'], ['part', 'Part of the day']]
  const lines = []
  for (const [bucket, title] of SECTIONS) {
    const list = entries.filter(e => e.bucket === bucket).sort((a, b) => a.name.localeCompare(b.name))
    if (!list.length) continue
    lines.push(`<b>${title} (${list.length})</b>`)
    for (const e of list) lines.push(`${esc(e.name)} · ${esc(e.deptName || 'No department')}${e.type ? ` · ${esc(e.type)}` : ''}`)
  }
  const head = `🟣 <b>On leave today</b> · ${dayLabel(date)}`
  const out = []
  let cur = [head], size = head.length
  for (const l of lines) {
    if (size + l.length + 1 > limit) { out.push(cur.join('\n')); cur = [head + ' (continued)']; size = cur[0].length }
    cur.push(l); size += l.length + 1
  }
  out.push(cur.join('\n'))
  return out
}

// Sends the list once a working day, at the chosen time or up to 3 hours after it (a run that was down at 07:30 still sends it at
// 08:15, but never at 14:00 as if it were news). The day is claimed before sending, so two overlapping runs cannot both send it.
async function maybeLeaveDigest(s, now = nowPP()) {
  if (!s.digestReady || !s.leave_digest_enabled) return 0
  const today = now.slice(0, 10), minutes = Number(now.slice(11, 13)) * 60 + Number(now.slice(14, 16))
  const [h, m] = String(s.leave_digest_time || '07:30').split(':').map(Number)
  const due = h * 60 + m
  if (minutes < due || minutes > due + 180 || String(s.leave_digest_last || '').slice(0, 10) === today) return 0
  const { data: claimed, error } = await sb.from('notification_settings').update({ leave_digest_last: today }).eq('id', 1).or(`leave_digest_last.is.null,leave_digest_last.neq.${today}`).select('id')
  if (error || !claimed || !claimed.length) return 0
  const giveBack = () => sb.from('notification_settings').update({ leave_digest_last: s.leave_digest_last || null }).eq('id', 1)
  try {
    const { reportData } = require('./report-data')
    const [{ daily }, depts] = await Promise.all([reportData({ from: today, to: today }), hr.departments.list()])
    // Nothing to say on a day nobody is expected to work (a Sunday or a public holiday).
    if (!daily.some(d => d.status !== 'day_off' && d.status !== 'holiday')) return 0
    const people = new Map((await hr.staff.list()).map(x => [x.pin, x]))
    const deptNames = new Map(depts.map(d => [d.id, d.name]))
    const entries = daily.filter(d => d.status === 'leave').map(d => {
      const person = people.get(d.pin) || {}
      const parts = d.leaveParts || []
      const type = [...new Set(parts.map(p => p.typeName || p.code).filter(Boolean))].join(' + ') || d.note || ''
      let bucket = 'full'
      if (d.leaveDays > 0 && d.leaveDays < 1) bucket = parts.length === 1 && parts[0].period ? parts[0].period : 'part'
      return { name: d.name || person.name || `PIN ${d.pin}`, deptName: deptNames.get(person.departmentId) || '', type, bucket }
    })
    if (!entries.length) return 0
    for (const text of formatLeaveDigest(today, entries)) {
      const r = await sendMessage(s.chat_id, text)
      if (!r.ok) { await giveBack(); return 0 }
      await sleep(400)
    }
    return entries.length
  } catch (e) { console.error('[notify] leave message failed:', e.message); await giveBack(); return 0 }
}

// What the leave on a day row means for this scan, or null.
function leaveContext(d, direction) {
  if (!d || d.status !== 'leave') return null
  const parts = d.leaveParts || []
  const type = [...new Set(parts.map(p => p.typeName || p.code).filter(Boolean))].join(' + ') || (d.note || '')
  const full = !(d.leaveDays > 0) || d.leaveDays >= 1      // a manual roster "leave" day has no length: it covers the day
  if (full) return { tag: 'full', type }
  const period = parts.length === 1 ? parts[0].period : null
  if (period === 'morning' && direction === 'in') return { tag: 'back', type: parts[0].typeName || parts[0].code }
  if (period === 'afternoon' && direction === 'out') return { tag: 'afternoon', type: parts[0].typeName || parts[0].code }
  return null
}

const groupBy = (list, fn) => { const m = new Map(); for (const x of list) { const k = fn(x); (m.get(k) || m.set(k, []).get(k)).push(x) } return [...m].map(([key, items]) => ({ key, items })) }

// The last scan announced for each PIN in the past hour (to ignore a repeat scan right after).
async function recentlySent(pins) {
  const out = new Map()
  if (!pins.length) return out
  const { data } = await sb.from('notification_log').select('pin,ts').eq('status', 'sent').gte('sent_at', new Date(Date.now() - 3600000).toISOString()).in('pin', [...new Set(pins)]).order('ts', { ascending: true })
  for (const r of data || []) out.set(r.pin, String(r.ts).replace('T', ' ').slice(0, 19))
  return out
}

async function recentLog(limit = 50) {
  if (!(await ready())) return []
  const { data, error } = await sb.from('notification_log').select('*').order('id', { ascending: false }).limit(limit)
  if (error) throw new Error(error.message)
  return data || []
}

module.exports = { run, getSettings, saveSettings, check, sendTest, recentLog, ready, token, decide, formatOne, formatDigests, labelScans, clockFor, lateLabel, leaveContext, formatLeaveDigest, maybeLeaveDigest, dayLabel, dateLabel, timeLabel, nowPP, esc }
