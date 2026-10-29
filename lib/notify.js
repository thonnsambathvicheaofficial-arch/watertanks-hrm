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
const { parseLeaveNote } = require('./leave-note')

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
// A scan announced one way and later found to be another, for example because the person's shift was changed afterwards.
// The scan's own message, written correctly, under a line that says what it was announced as.
function formatCorrection(ts, person, deptName, announced, direction, lateMin, leave, why) {
  const was = DIRECTION[announced] ? `${DIRECTION[announced].icon} ${DIRECTION[announced].text}` : 'something else'
  return `✏️ <b>Correction</b> · announced as ${was}${why ? ` (${esc(why)})` : ''}\n${formatOne(ts, person, deptName, direction, lateMin, leave)}`
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
  const r = await sendMessage(chatId, `<b>Water Tanks HRM</b>\nTest message${by ? ` from ${esc(by)}` : ''}. Scan notifications will appear here when they are switched on.`)
  return r.ok ? { ...c, sent: true } : { ...c, ok: false, error: `The test message was not delivered: ${r.error}` }
}

// A scan a run claimed but did not finish (its time budget ran out in a rush, or the run was cut short) is picked up by
// the next run once it is clearly nobody's any more. A run holds its scans for at most its budget (12 s) plus the last
// send, so 25 s is safe from double sending, and a stuck scan waits seconds, not the minute and a half it once did.
const PENDING_RETRY_MS = 25000
const needsRetry = (row, nowMs) => row.status === 'failed' || (row.status === 'pending' && nowMs - new Date(row.created_at).getTime() > PENDING_RETRY_MS)

// ── the run after each sync ─────────────────────────────────────────────────
async function run({ budgetMs = 15000, dryRun = false } = {}) {
  const started = Date.now()
  const stats = { enabled: false, considered: 0, sent: 0, skipped: 0, failed: 0, left: 0 }
  try {
    const s = await getSettings()
    if (!s.ready || !s.enabled) return { ...stats, note: 'off' }
    stats.enabled = true
    // A failed write to the log or the cursor must show in the run's result and the server log, not vanish.
    const note = (what, res) => { if (res && res.error) { console.error(`[notify] ${what}: ${res.error.message}`); stats.writeErrors = (stats.writeErrors || 0) + 1 } return res }
    if (!token() || !s.chat_id) return { ...stats, note: 'not configured' }
    if (!s.cursor_at) { note('cursor', await sb.from('notification_settings').update({ cursor_at: new Date().toISOString() }).eq('id', 1)); return { ...stats, note: 'started now' } }
    if (!dryRun) stats.leaveListed = await maybeLeaveDigest(s)
    // A shift HR changed after a scan was announced, so the scan now reads the other way: one correction. A failure never blocks the new scans.
    try { stats.shiftCorrections = await sendShiftCorrections(s, { dryRun, note }) } catch (e) { console.error('[notify] shift corrections failed:', e.message); stats.shiftCorrections = { error: true } }
    // Leave HR recorded after a scan was announced (so the scan went out as Late): say it once. A failure here never blocks the new scans.
    try { stats.updates = await sendLeaveUpdates(s, { dryRun, note }) } catch (e) { console.error('[notify] leave follow-ups failed:', e.message); stats.updates = { error: true } }

    // 1. Scans saved since the cursor that have no log row yet, plus earlier sends that failed or were left pending.
    const [fresh, retry] = await Promise.all([
      sb.from('punches').select('id,pin,ts,created_at,device_id').gte('created_at', s.cursor_at).order('created_at', { ascending: true }).order('id', { ascending: true }).limit(400),
      sb.from('notification_log').select('punch_id,attempts,status,created_at').in('status', ['failed', 'pending']).lt('attempts', MAX_ATTEMPTS).gte('created_at', new Date(Date.now() - 6 * 3600000).toISOString()).limit(100),
    ])
    if (fresh.error) throw new Error(fresh.error.message)
    const stale = (retry.data || []).filter(r => needsRetry(r, Date.now()))
    let candidates = fresh.data || []
    stats.waiting = { sinceCursor: candidates.length, cursor: s.cursor_at }   // what the run saw, so a quiet run can be explained from its own answer
    const cursorNext = candidates.length ? candidates[candidates.length - 1].created_at : null
    if (stale.length) {
      const { data: again } = await sb.from('punches').select('id,pin,ts,created_at,device_id').in('id', stale.map(r => r.punch_id))
      candidates = candidates.concat((again || []).filter(p => !candidates.some(c => c.id === p.id)))
    }
    // 2. Claim them. A scan that already has a log row is left alone unless it is a retry.
    const retryIds = new Set(stale.map(r => r.punch_id))
    const { data: known } = await sb.from('notification_log').select('punch_id').in('punch_id', candidates.map(p => p.id))
    const logged = new Set((known || []).map(r => r.punch_id))
    stats.waiting.alreadyLogged = logged.size
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
      stats.waiting.claimed = mine.size
      candidates = candidates.filter(p => mine.has(p.id) || retryIds.has(p.id))
    }
    stats.considered = candidates.length
    if (!candidates.length) { if (!dryRun && cursorNext) note('cursor', await sb.from('notification_settings').update({ cursor_at: cursorNext }).eq('id', 1)); return stats }

    // 3. Who they are, then who to announce.
    const [people, depts, recent] = await Promise.all([store.employees.get(), hr.departments.list(), recentlySent(candidates.map(p => p.pin))])
    const { canonPunches } = require('./report-data')
    const mapped = canonPunches(candidates.map(p => ({ ...p, deviceId: p.device_id, time: String(p.ts).replace('T', ' ').slice(0, 19) })), people)
      .map(p => ({ id: p.id, pin: p.pin, ts: String(p.ts).replace('T', ' ').slice(0, 19) }))
    mapped.sort((x, y) => (x.ts < y.ts ? -1 : x.ts > y.ts ? 1 : 0))     // announce in the order people scanned, whatever order they were saved
    const full = await hr.staff.list()
    const byPin = new Map(full.map(x => [x.pin, x]))
    const dec = decide(mapped, { people: byPin, deptNames: new Map(depts.map(d => [d.id, d.name])), settings: s, now: nowPP(), lastSent: recent })
    stats.skipped = dec.skip.length
    if (dec.send.length) {
      let dayRows = null
      try { dayRows = await loadDayRows(dec.send) } catch (e) { console.error('[notify] day rows unavailable:', e.message) }
      await addDirections(dec.send, people, dayRows)
      await addLateness(dec.send, dayRows)
    }
    if (dryRun) return { ...stats, wouldSend: dec.send.map(x => ({ pin: x.punch.pin, ts: x.ts, text: formatOne(x.ts, x.person, x.deptName, x.direction, x.lateMin, x.leave) })), skipped: dec.skip.map(x => `${x.punch.pin} ${x.punch.ts} ${x.reason}`) }
    for (const g of groupBy(dec.skip, x => x.reason)) note('skipped', await sb.from('notification_log').update({ status: 'skipped', reason: g.key }).in('punch_id', g.items.map(x => x.punch.id)))

    // 4. Send.
    const pending = dec.send
    const markSent = async (ids) => note('sent but not marked (it may be sent again)', await sb.from('notification_log').update({ status: 'sent', sent_at: new Date().toISOString(), reason: null }).in('punch_id', ids))
    const markFailed = async (ids, why) => { for (const id of ids) { const { data } = await sb.from('notification_log').select('attempts').eq('punch_id', id).maybeSingle(); note('failed mark', await sb.from('notification_log').update({ status: 'failed', reason: String(why).slice(0, 200), attempts: ((data && data.attempts) || 0) + 1 }).eq('punch_id', id)) } }
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
    if (cursorNext) note('cursor', await sb.from('notification_settings').update({ cursor_at: cursorNext }).eq('id', 1))
    return stats
  } catch (e) {
    console.error('[notify]', e.message)
    return { ...stats, error: 'notification run failed' }
  }
}

const prevDay = (d) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - 86400000).toISOString().slice(0, 10)

// The report engine's day rows (pin|date -> row) for the days these scans fall on, plus the day before for night shifts.
// One load serves both the in/out label and the lateness and leave remarks.
async function loadDayRows(items, options = {}) {
  if (!items.length) return new Map()
  const days = items.map(x => x.ts.slice(0, 10)).sort()
  const { reportData } = require('./report-data')
  // options: { skipOverrides, skipLeave } read the days as the scans alone show them (what an announcement made BEFORE any leave was recorded saw)
  const { daily } = await reportData({ from: prevDay(days[0]), to: days[days.length - 1], ...options })
  return new Map(daily.map(d => [d.pin + '|' + d.date, d]))
}

// In or out as the report engine sees the day (shift-aware), or null when the engine does not single this scan out as the
// day's arrival or departure (a scan in the middle of the day). rows: Map of pin|date -> day row.
// This is what the reports use, so the message agrees with them even when a scan is missing: alternating in, out, in, out
// through the last scans (the fallback below) flips every label after one missing scan and stays wrong until a day off.
function engineDirection(pin, ts, rows) {
  if (!rows) return null
  const day = ts.slice(0, 10), hm = ts.slice(11, 16)
  const d = rows.get(pin + '|' + day), p = rows.get(pin + '|' + prevDay(day))
  if (d && d.in === hm) return 'in'
  if (d && d.out === hm && !d.outNextDay) return 'out'
  if (p && p.outNextDay && p.out === hm) return 'out'    // a night shift's departure lands on the next calendar day
  return null
}

// Works out in / out for the scans about to be announced: from the report engine's day when it can, otherwise from each
// person's last 36 hours of scans in order.
async function addDirections(items, people, dayRows = null) {
  for (const x of items) x.direction = engineDirection(x.punch.pin, x.ts, dayRows)
  if (items.every(x => x.direction)) return
  const since = nowPP(new Date(Date.now() - 36 * 3600000))
  const rows = await require('./select-all')('punches', q => q.select('id,pin,ts,device_id').gte('ts', since).order('ts', { ascending: true }).order('id', { ascending: true }))
  const { canonPunches } = require('./report-data')
  const hist = canonPunches(rows.map(p => ({ ...p, deviceId: p.device_id, time: String(p.ts).replace('T', ' ').slice(0, 19) })), people)
  const byPin = new Map()
  for (const p of hist) { const t = String(p.ts).replace('T', ' ').slice(0, 19); (byPin.get(p.pin) || byPin.set(p.pin, new Set()).get(p.pin)).add(t) }
  const labels = new Map()
  for (const [pin, set] of byPin) { const times = [...set].sort(); const l = labelScans(times); times.forEach((t, i) => labels.set(pin + '|' + t, l[i])) }
  for (const x of items) if (!x.direction) x.direction = labels.get(x.punch.pin + '|' + x.ts) || null
}

// Minutes late for a punch in, taken from the same engine as the reports so the group and the reports always agree.
// Only the person's first scan of that day (the one the report counts as their arrival) can be late.
// The same day row also says whether the person is on approved leave (a whole day, or a half day by period), so
// the message can explain a noon arrival or a noon departure.
async function addLateness(items, dayRows = null) {
  if (!items.length) return
  const dayOf = (ts) => ts.slice(0, 10)
  const prev = prevDay
  try {
    const row = dayRows || await loadDayRows(items)
    for (const x of items) {
      const d = row.get(x.punch.pin + '|' + dayOf(x.ts))
      if (x.direction === 'in' && d && d.status === 'late' && d.minutesLate > 0 && d.in === x.ts.slice(11, 16)) x.lateMin = d.minutesLate
      // A night shift's punch out lands on the next calendar day, so for a punch out also look at the shift that began the day before.
      let ld = d
      if (!(d && d.status === 'leave') && x.direction === 'out') { const p = row.get(x.punch.pin + '|' + prev(dayOf(x.ts))); if (p && p.status === 'leave' && p.outNextDay) ld = p }
      const scan = { hm: x.ts.slice(11, 16), startMin: toMin(x.person && x.person.timeIn) ?? 420, endMin: toMin(x.person && x.person.timeOut) ?? 1020 }
      const leave = leaveContext(ld, x.direction, scan)
      if (leave) x.leave = leave
    }
  } catch (e) { console.error('[notify] lateness and leave unavailable:', e.message) }   // a message without these remarks is better than none
}

// ── leave recorded AFTER the scan was announced ─────────────────────────────
// HR may record leave before the person scans (the scan's message then carries the leave remark) or after (the scan already went
// out, perhaps as "Late 5 h 49 min"). In the second case one short follow-up says the Late remark no longer applies. The sent
// row's `reason` remembers that it was handled, so it is said once; nothing here needs a migration.
const UPDATE_SENT = 'Follow-up sent: leave recorded after this scan'
const UPDATE_CHECKED = 'Checked after leave was recorded: nothing to correct'
const UPDATE_WINDOW_MS = 24 * 3600000

// Which sent scans have a leave record made AFTER they were announced. Pure.
//   sent         [{ id, pin, ts, sent_at }]
//   leaveEdits   approved leave requests: [{ pin, from, to, at }]  (at = when it was recorded or approved, in ms)
//   rosterEdits  roster corrections: [{ pin, date, status, note, at }]
function pickUpdateCandidates(sent, leaveEdits, rosterEdits) {
  return sent.filter(r => {
    const date = String(r.ts).slice(0, 10), at = Date.parse(r.sent_at)
    return leaveEdits.some(e => e.pin === r.pin && e.from <= date && date <= e.to && e.at > at)
      || rosterEdits.some(e => e.pin === r.pin && e.date === date && e.at > at && (e.status === 'leave' || ((e.status === 'excused' || e.status === 'present') && parseLeaveNote(e.note))))
  })
}

function formatUpdate(ts, person, deptName, leave, lateMin) {
  const gone = lateMin > 0 ? `, so the earlier <b>${lateLabel(lateMin)}</b> no longer applies` : ''
  return `ℹ️ <b>Update</b> · ${clockFor(ts)} ${timeLabel(ts)} scan
<b>${esc(person.name || `PIN ${person.pin}`)}</b>
<i>${esc(describe(person, deptName))} · ${dateLabel(ts)}${leave && leave.type ? ` · ${esc(leave.type)}` : ''}</i>
${leaveRemark(leave)} · recorded after this scan${gone}.`
}

// Looks at the scans announced in the last 24 h that now have leave recorded after them, and for each one that was announced as Late
// (and is now explained by leave) sends the follow-up. `note` records a failed write (see run()). dryRun sends and writes nothing.
async function sendLeaveUpdates(s, { dryRun = false, max = 8, note = () => {} } = {}) {
  const since = new Date(Date.now() - UPDATE_WINDOW_MS).toISOString()
  const { data: sent, error } = await sb.from('notification_log').select('id,punch_id,pin,ts,sent_at').eq('status', 'sent').or(`reason.is.null,reason.eq.${SHIFT_CHECKED}`).gte('sent_at', since).order('id', { ascending: true }).limit(1000)
  if (error) throw new Error(error.message)
  const out = { candidates: 0, sent: 0, checked: 0, wouldSend: [] }
  if (!sent || !sent.length) return out
  const [lr, ov] = await Promise.all([
    sb.from('leave_requests').select('pin,from_date,to_date,decided_at,created_at').eq('status', 'approved').or(`decided_at.gte.${since},created_at.gte.${since}`),
    sb.from('day_overrides').select('pin,date,status,note,set_at').gte('set_at', since),
  ])
  if (lr.error || ov.error) { console.error('[notify] leave changes unavailable:', (lr.error || ov.error).message); return out }   // e.g. leave tables not set up
  const leaveEdits = (lr.data || []).map(r => ({ pin: r.pin, from: String(r.from_date).slice(0, 10), to: String(r.to_date).slice(0, 10), at: Date.parse(r.decided_at || r.created_at) }))
  const rosterEdits = (ov.data || []).map(r => ({ pin: r.pin, date: String(r.date).slice(0, 10), status: r.status, note: r.note, at: Date.parse(r.set_at) }))
  const picked = pickUpdateCandidates(sent, leaveEdits, rosterEdits).slice(0, max)
  out.candidates = picked.length
  if (!picked.length) return out

  const [people, depts, staffList] = await Promise.all([store.employees.get(), hr.departments.list(), hr.staff.list()])
  const staff = new Map(staffList.map(x => [x.pin, x])), deptNames = new Map(depts.map(d => [d.id, d.name]))
  const items = picked.map(r => ({ row: r, ts: String(r.ts).replace('T', ' ').slice(0, 19), person: staff.get(r.pin) })).filter(x => x.person).map(x => ({ ...x, punch: { id: x.row.punch_id, pin: x.row.pin, ts: x.ts }, deptName: deptNames.get(x.person.departmentId) || '' }))
  const nowRows = await loadDayRows(items)                                              // the days as they read now, with the leave
  const rawRows = await loadDayRows(items, { skipOverrides: true, skipLeave: true })    // and as the scans alone read: what the announcement said
  await addDirections(items, people, nowRows)
  await addLateness(items, nowRows)                                                     // sets x.leave from the days as they read now
  for (const x of items) {
    const raw = rawRows.get(x.punch.pin + '|' + x.ts.slice(0, 10))
    const wasLate = x.direction === 'in' && raw && raw.status === 'late' && raw.minutesLate > 0 && raw.in === x.ts.slice(11, 16) ? raw.minutesLate : 0
    const needs = wasLate > 0 && x.leave && (x.leave.tag === 'back' || x.leave.tag === 'full')
    if (!needs) {
      // Nothing to correct (it was not announced as late, or this leave does not explain it): settle it so it is not looked at again.
      if (!dryRun) { note('settling', await sb.from('notification_log').update({ reason: UPDATE_CHECKED }).eq('id', x.row.id).or(`reason.is.null,reason.eq.${SHIFT_CHECKED}`)); out.checked++ }
      continue
    }
    const text = formatUpdate(x.ts, x.person, x.deptName, x.leave, wasLate)
    if (dryRun) { out.wouldSend.push({ pin: x.punch.pin, ts: x.ts, text }); continue }
    // Claim it first, so two overlapping runs cannot both send it; give the claim back if Telegram does not take the message.
    const { data: claimed, error: ce } = await sb.from('notification_log').update({ reason: UPDATE_SENT }).eq('id', x.row.id).or(`reason.is.null,reason.eq.${SHIFT_CHECKED}`).select('id')
    if (ce || !claimed || !claimed.length) continue
    const r = await sendMessage(s.chat_id, text)
    if (r.ok) { out.sent++; await sleep(350); continue }
    console.error('[notify] follow-up not sent:', r.error)
    note('follow-up not sent', await sb.from('notification_log').update({ reason: null }).eq('id', x.row.id))
    break
  }
  return out
}

// ── a shift changed AFTER a scan was announced ──────────────────────────────
// A scan is announced as in or out by the person's shift at that moment. If HR then changes the shift (a day worker moved to nights),
// the same scan reads the other way and the group has been told the wrong thing. The audit log records what changed and when, so the
// shift as it was at the announcement can be rebuilt, the scan read both ways, and when the two differ ONE correction goes out.
// The sent row's `reason` remembers it, so it is said once. Nothing here needs a migration.
const CORRECTION_SENT = 'Correction sent: '
const SHIFT_CHECKED = 'Checked after a shift change: direction unchanged'
const SHIFT_WINDOW_MS = 12 * 3600000
const SHIFT_KEYS = ['timeIn', 'timeOut', 'offDays']     // what decides in or out; changing the named shift changes these too

// Which sent scans were announced BEFORE a change to their person's times. Pure.
//   sent     [{ id, pin, ts, sent_at }]      changes  [{ pin, at (ms), details }] from the audit log
const pickShiftCandidates = (sent, changes) => sent.filter(r => changes.some(c => c.pin === r.pin && c.at > Date.parse(r.sent_at)))

// The times the person had when a scan was announced: undo every change made after it, newest first. Pure.
function timesAt(current, changes, pin, sentAtMs) {
  const t = { timeIn: current.timeIn, timeOut: current.timeOut, offDays: current.offDays }
  for (const c of changes.filter(x => x.pin === pin && x.at > sentAtMs).sort((a, b) => b.at - a.at)) {
    for (const k of SHIFT_KEYS) {
      const d = c.details[k]
      if (d && typeof d === 'object' && 'from' in d) t[k] = Array.isArray(d.from) ? d.from.map(Number) : d.from
    }
  }
  return t
}

async function sendShiftCorrections(s, { dryRun = false, max = 8, note = () => {} } = {}) {
  const out = { candidates: 0, sent: 0, checked: 0, wouldSend: [] }
  const since = new Date(Date.now() - SHIFT_WINDOW_MS).toISOString()
  const { data: au, error: ae } = await sb.from('audit_log').select('at,entity_key,details').eq('action', 'staff.update').gte('at', since).order('id', { ascending: true })
  if (ae) { console.error('[notify] audit log unavailable:', ae.message); return out }
  const changes = (au || []).filter(a => a.details && SHIFT_KEYS.some(k => a.details[k] && typeof a.details[k] === 'object' && 'from' in a.details[k])).map(a => ({ pin: String(a.entity_key), at: Date.parse(a.at), details: a.details }))
  if (!changes.length) return out
  const { data: sent, error } = await sb.from('notification_log').select('id,punch_id,pin,ts,sent_at').eq('status', 'sent').is('reason', null).gte('sent_at', since).in('pin', [...new Set(changes.map(c => c.pin))]).order('id', { ascending: true }).limit(500)
  if (error) throw new Error(error.message)
  const picked = pickShiftCandidates(sent || [], changes).slice(0, max)
  out.candidates = picked.length
  if (!picked.length) return out

  const [people, depts, staffList, shiftList, settings] = await Promise.all([store.employees.get(), hr.departments.list(), hr.staff.list(), hr.shifts.list(), store.settings.get()])
  const staff = new Map(staffList.map(x => [x.pin, x])), deptNames = new Map(depts.map(d => [d.id, d.name])), shiftNames = new Map(shiftList.map(x => [x.id, x.name]))
  const items = picked.map(r => ({ row: r, ts: String(r.ts).replace('T', ' ').slice(0, 19), person: staff.get(r.pin) })).filter(x => x.person).map(x => ({ ...x, punch: { id: x.row.punch_id, pin: x.row.pin, ts: x.ts }, deptName: deptNames.get(x.person.departmentId) || '' }))
  const nowRows = await loadDayRows(items)
  await addDirections(items, people, nowRows)      // each scan as the shift reads it NOW
  await addLateness(items, nowRows)                // and its lateness / leave remarks for the corrected message
  const { dailyRows } = require('./attendance')
  const { canonPunches } = require('./report-data')
  for (const x of items) {
    const pin = x.punch.pin, day = x.ts.slice(0, 10), cur = people[pin]
    let oldDir = null
    if (cur) {
      const t = timesAt(cur, changes, pin, Date.parse(x.row.sent_at))
      const from = prevDay(day), next = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
      const { data: pu } = await sb.from('punches').select('id,pin,ts,device_id').in('pin', [pin, ...(cur.aliases || [])]).gte('ts', `${from}T00:00:00`).lt('ts', `${next}T00:00:00`)
      const scans = canonPunches((pu || []).map(p => ({ ...p, deviceId: p.device_id, time: String(p.ts).replace('T', ' ').slice(0, 19) })), people)
      const oldRows = dailyRows(scans, { [pin]: { ...cur, timeIn: t.timeIn, timeOut: t.timeOut, offDays: t.offDays, plan: undefined } }, settings, [], from, day)
      oldDir = engineDirection(pin, x.ts, new Map(oldRows.map(d => [d.pin + '|' + d.date, d])))
    }
    const needs = !!oldDir && !!x.direction && oldDir !== x.direction
    if (!needs) {
      // The scan reads the same either way (or cannot be read under the old times): settle it so it is not looked at again.
      if (!dryRun) { note('settling', await sb.from('notification_log').update({ reason: SHIFT_CHECKED }).eq('id', x.row.id).is('reason', null)); out.checked++ }
      continue
    }
    const why = `shift changed${x.person.shiftId && shiftNames.get(x.person.shiftId) ? ` to ${shiftNames.get(x.person.shiftId)}` : ''}`
    const text = formatCorrection(x.ts, x.person, x.deptName, oldDir, x.direction, x.lateMin || 0, x.leave || null, why)
    if (dryRun) { out.wouldSend.push({ pin, ts: x.ts, text }); continue }
    const { data: claimed, error: ce } = await sb.from('notification_log').update({ reason: `${CORRECTION_SENT}announced as ${DIRECTION[oldDir].text}, ${why}` }).eq('id', x.row.id).is('reason', null).select('id')
    if (ce || !claimed || !claimed.length) continue
    const r = await sendMessage(s.chat_id, text)
    if (r.ok) { out.sent++; await sleep(350); continue }
    console.error('[notify] shift correction not sent:', r.error)
    note('shift correction not sent', await sb.from('notification_log').update({ reason: null }).eq('id', x.row.id))
    break
  }
  return out
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
    const entries = daily.filter(d => d.status === 'leave' || rosterLeave(d)).map(d => {
      const person = people.get(d.pin) || {}
      const rl = d.status === 'leave' ? null : rosterLeave(d)   // leave HR wrote on the roster instead of recording a request
      if (rl) return { name: d.name || person.name || `PIN ${d.pin}`, deptName: deptNames.get(person.departmentId) || '', type: 'Roster note', bucket: rl.days === null || rl.days >= 1 ? 'full' : (rl.period || 'part') }
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

// A roster correction (Excused or Present) whose note records leave, HR's usual way of writing leave on the roster
// ("ច្បាប់ 0,5 ថ្ងៃ"): { days, period } or null. See lib/leave-note.js.
const rosterLeave = (d) => (d && d.overridden && (d.status === 'excused' || d.status === 'present') ? parseLeaveNote(d.rosterNote != null ? d.rosterNote : d.note) : null)

// A half day has no stated half unless the note says so, so it is placed by when the person scanned: a first scan 4 h or more after
// their shift starts is them coming back from morning leave; a last scan 2 h or more before it ends is them leaving for afternoon leave.
const HALF_DAY_ARRIVAL_MIN = 240, HALF_DAY_DEPARTURE_MIN = 120
const toMin = (hhmm) => (/^\d{1,2}:\d{2}/.test(String(hhmm || '')) ? Number(hhmm.split(':')[0]) * 60 + Number(hhmm.split(':')[1]) : null)

// What the leave on a day row means for this scan, or null. Leave comes from an approved request or from a roster correction.
// scan (optional): { hm: 'HH:MM', startMin, endMin } = when they scanned and their shift, to place a roster half day.
function leaveContext(d, direction, scan = {}) {
  const note = rosterLeave(d)
  if (note) {
    if (note.days === null || note.days >= 1) return { tag: 'full', type: 'Roster note' }
    const at = toMin(scan.hm)
    const morning = note.period === 'morning' || (!note.period && at != null && scan.startMin != null && at - scan.startMin >= HALF_DAY_ARRIVAL_MIN)
    const afternoon = note.period === 'afternoon' || (!note.period && at != null && scan.endMin != null && scan.endMin - at >= HALF_DAY_DEPARTURE_MIN)
    if (direction === 'in' && morning) return { tag: 'back', type: 'Roster note' }
    if (direction === 'out' && afternoon) return { tag: 'afternoon', type: 'Roster note' }
    return null
  }
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

module.exports = { engineDirection, needsRetry, PENDING_RETRY_MS, run, getSettings, saveSettings, check, sendTest, recentLog, ready, token, decide, formatOne, formatCorrection, sendMessage, formatDigests, labelScans, clockFor, lateLabel, leaveContext, rosterLeave, pickUpdateCandidates, formatUpdate, sendLeaveUpdates, sendShiftCorrections, pickShiftCandidates, timesAt, formatLeaveDigest, maybeLeaveDigest, dayLabel, dateLabel, timeLabel, nowPP, esc }
