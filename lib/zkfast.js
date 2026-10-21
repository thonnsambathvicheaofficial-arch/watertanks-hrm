// The fast path: notice a new scan within seconds and announce it.
//
// Every few seconds each pull device is asked one cheap question: "how many records do you hold?" (about 50 ms). Only
// when the answer has grown is the device asked for its NEWEST records (lib/zk-tail.js), the scans are saved, and the
// Telegram notifier runs. The scheduled full sync (lib/zkpull.js, every few minutes) stays as the safety net that proves
// nothing was missed, so this path can be quick without being trusted for completeness.
//
// Read-only toward the devices: it only ever asks for the record count and reads records, then frees the read buffer.
//
// Safety rules:
//  - one fast check per device at a time (a short lease in devices.fast_lock_until), so overlapping ticks do not pile up;
//  - a slow or unreachable device is given up on quickly (a few seconds) and left for the next tick;
//  - a count that went DOWN (the device was cleared or reset) just resets the baseline; the full sync handles history;
//  - a big jump (more than MAX_TAIL new records) is left to the full sync instead of read here;
//  - records are sorted exactly like the full sync does (impossible times are quarantined, never saved as scans).
const sb = require('./supabase')
const zkpull = require('./zkpull')                // also pins the timezone and loads the read fix, as the full sync does
const { readTail } = require('./zk-tail')
const ZKLib = require('node-zklib')

const MAX_TAIL = 300            // most new records read in one fast check
const MARGIN = 3                // read a few extra records so a miscounted scan cannot be skipped (re-reading is harmless)
const LEASE_SECONDS = 20        // how long a check may hold a device
const CONNECT_TIMEOUT_MS = 6000

const withTimeout = (p, ms, label) => {
  let t
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out after ${ms} ms`)), ms) })]).finally(() => clearTimeout(t))
}

// What to do given the device's record count and our last fast baseline. Pure, so it is unit tested.
function plan(logCount, fastCount) {
  if (typeof logCount !== 'number') return { action: 'skip', why: 'the device did not report its record count' }
  if (fastCount == null) return { action: 'baseline' }                                   // first look: remember the count, read nothing
  if (logCount === fastCount) return { action: 'idle' }
  if (logCount < fastCount) return { action: 'baseline', why: 'the device holds fewer records than before (cleared or reset)' }
  const delta = logCount - fastCount
  if (delta > MAX_TAIL) return { action: 'baseline', why: `${delta} new records is more than a fast check reads; the full sync takes them` }
  return { action: 'read', count: delta + MARGIN }
}

let probe = { at: 0, ok: false }
async function ready() {
  if (Date.now() - probe.at < 15000) return probe.ok
  const { error } = await sb.from('devices').select('fast_count').limit(1)
  probe = { at: Date.now(), ok: !error }
  return probe.ok
}

// Takes the device for LEASE_SECONDS, or returns false if another check holds it.
async function lease(id) {
  const now = new Date(), until = new Date(now.getTime() + LEASE_SECONDS * 1000).toISOString()
  const { data, error } = await sb.from('devices').update({ fast_lock_until: until }).eq('id', id)
    .or(`fast_lock_until.is.null,fast_lock_until.lt.${now.toISOString()}`).select('id')
  return !error && !!data && data.length > 0
}

async function fastOne(dev) {
  const out = { device: dev.name, ok: true, action: 'idle', inserted: 0 }
  const started = Date.now()
  if (!(await lease(dev.id))) return { ...out, action: 'busy' }
  const release = (patch = {}) => sb.from('devices').update({ fast_lock_until: null, fast_at: new Date().toISOString(), ...patch }).eq('id', dev.id)
  const zk = new ZKLib(dev.public_host, dev.public_port || 4370, CONNECT_TIMEOUT_MS, 4000)
  try {
    await withTimeout(zk.createSocket(), CONNECT_TIMEOUT_MS, 'connect')
    const info = (await withTimeout(zk.getInfo(), CONNECT_TIMEOUT_MS, 'getInfo')) || {}
    const logCount = typeof info.logCounts === 'number' ? info.logCounts : null
    const step = plan(logCount, dev.fast_count)
    out.action = step.action; out.totalOnDevice = logCount
    if (step.action === 'skip') { await release({ fast_error: step.why }); return { ...out, ms: Date.now() - started } }
    if (step.action === 'baseline') { await release({ fast_count: logCount, fast_error: null }); return { ...out, why: step.why, ms: Date.now() - started } }
    if (step.action === 'idle') { await release({ fast_error: null }); return { ...out, ms: Date.now() - started } }

    const tail = await readTail(zk, step.count, { timeoutMs: 8000 })
    const { rows, badRows } = zkpull.classifyRecords(dev, tail.records)
    if (badRows.length) { try { await sb.from('corrupted_punches').upsert(badRows, { onConflict: 'pin,ts', ignoreDuplicates: true }) } catch { /* the quarantine table is best effort */ } }
    let inserted = 0
    if (rows.length) {
      const { error, count } = await sb.from('punches').upsert(rows, { onConflict: 'pin,ts', ignoreDuplicates: true, count: 'exact' })
      if (error) throw new Error(error.message)
      inserted = count ?? 0
    }
    // The baseline moves only after the scans are saved, so a failure above is simply retried on the next tick.
    await release({ fast_count: tail.total, fast_error: null })
    return { ...out, read: tail.records.length, inserted, ms: Date.now() - started }
  } catch (e) {
    await release({ fast_error: String(e.message || e).slice(0, 200) })
    return { ...out, ok: false, error: String(e.message || e).slice(0, 200), ms: Date.now() - started }
  } finally {
    try { await zk.disconnect() } catch { /* a dead socket is fine */ }
  }
}

// One round over every reachable pull device, then the notifier if anything new was saved.
async function fastPoll({ notifyBudgetMs = 12000 } = {}) {
  if (!(await ready())) return { ok: false, note: 'Fast polling needs migration 008. Run it first.' }
  const devices = await zkpull.gatherTargets()
  const results = await Promise.all(devices.map(fastOne))
  const inserted = results.reduce((n, r) => n + (r.inserted || 0), 0)
  let notified = null
  if (inserted > 0) {
    try { notified = await require('./notify').run({ budgetMs: notifyBudgetMs }) } catch { notified = { error: 'notification run failed' } }
  }
  return { ok: results.every(r => r.ok), devices: results.length, inserted, results, notified }
}

module.exports = { fastPoll, fastOne, plan, MAX_TAIL, MARGIN }
