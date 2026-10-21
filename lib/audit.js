// Audit trail: who did what, and when, in the audit_log table (migration 004).
//
// The signed-in person is carried through a request with AsyncLocalStorage, so store
// functions can record what they changed without every caller passing a username.
// `act()` (lib/act.ts) opens that context. Anything an action changes but does not
// record itself still gets a one-line entry from act(), so nothing goes unlogged.
//
// Recording never blocks the work: if the table is missing (migration not run) the
// entry is skipped, and any other failure is logged to the server console.
const { AsyncLocalStorage } = require('async_hooks')
const sb = require('./supabase')

const als = new AsyncLocalStorage()
const runWith = (ctx, fn) => als.run(ctx, fn)
const context = () => als.getStore() || null

const isMissingTable = (e) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /could not find the table|does not exist/i.test(e.message || ''))
let probe = { at: 0, ok: false }
async function ready() {
  if (Date.now() - probe.at < 15000) return probe.ok
  const { error } = await sb.from('audit_log').select('id').limit(1)
  probe = { at: Date.now(), ok: !error }
  if (error && !isMissingTable(error)) console.error('[audit] check failed:', error.message)
  return probe.ok
}

// Keep entries readable: drop empty values and cap very long text.
const clean = (v) => JSON.parse(JSON.stringify(v ?? null, (_k, x) => (typeof x === 'string' && x.length > 400 ? x.slice(0, 400) + '…' : x)))

async function record({ action, entity = null, key = null, summary, details = null, actor }) {
  const ctx = context()
  if (ctx) ctx.recorded = true
  try {
    if (!(await ready())) return
    const { error } = await sb.from('audit_log').insert({
      actor: actor ?? (ctx && ctx.actor) ?? null, action, entity, entity_key: key == null ? null : String(key),
      summary: String(summary || action).slice(0, 500), details: details == null ? null : clean(details),
    })
    if (error) console.error('[audit] could not record', action, '-', error.message)
  } catch (e) { console.error('[audit] could not record', action, '-', e.message) }
}

// Fields that differ between two plain objects, as { field: { from, to } }.
function diff(before, after) {
  const out = {}
  for (const k of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    const a = before ? before[k] : undefined, b = after ? after[k] : undefined
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) out[k] = { from: a ?? null, to: b ?? null }
  }
  return out
}

// Reading the log. `area` groups actions by what they touch (the part of the action name before the dot).
const AREAS = {
  access: { label: 'Sign-ins and access', prefixes: ['login', 'permission', 'user', 'role'] },
  staff: { label: 'Staff and rotation', prefixes: ['staff', 'rotation', 'shift', 'department'] },
  attendance: { label: 'Attendance corrections', prefixes: ['correction'] },
  leave: { label: 'Leave and holidays', prefixes: ['leave', 'leavetype', 'entitlement', 'holiday'] },
  payroll: { label: 'Payroll', prefixes: ['payroll', 'pay', 'overtime', 'allowance'] },
  import: { label: 'Imports', prefixes: ['import'] },
}
const PAGE_SIZE = 100
const stripFilter = (s) => String(s || '').replace(/[,()*%\\]/g, ' ').trim()
const phnomPenhStart = (d) => `${d}T00:00:00+07:00`
const phnomPenhEnd = (d) => `${d}T23:59:59.999+07:00`

function applyFilters(qb, f = {}) {
  if (f.actor) qb = qb.eq('actor', f.actor)
  const area = AREAS[f.area]
  if (area) qb = qb.or(area.prefixes.map(p => `action.like.${p}.*,action.eq.${p}`).join(','))
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.from || '')) qb = qb.gte('at', phnomPenhStart(f.from))
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.to || '')) qb = qb.lte('at', phnomPenhEnd(f.to))
  const q = stripFilter(f.q)
  if (q) qb = qb.or(`summary.ilike.*${q}*,entity_key.ilike.*${q}*,actor.ilike.*${q}*`)
  return qb
}

async function list(f = {}) {
  const page = Math.max(1, Number(f.page) || 1)
  const { data, error, count } = await applyFilters(sb.from('audit_log').select('*', { count: 'exact' }), f)
    .order('at', { ascending: false }).order('id', { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
  if (error) throw new Error(error.message)
  return { rows: data || [], total: count || 0, page, pageSize: PAGE_SIZE }
}

// Up to `max` rows for an Excel export, newest first, paged on a unique key so none are dropped.
async function listAll(f = {}, max = 20000) {
  const out = []
  for (let from = 0; out.length < max; from += 1000) {
    const { data, error } = await applyFilters(sb.from('audit_log').select('*'), f)
      .order('at', { ascending: false }).order('id', { ascending: false }).range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

async function actors() {
  const seen = new Set()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('audit_log').select('actor').order('id').range(from, from + 999)
    if (error) throw new Error(error.message)
    for (const r of data || []) if (r.actor) seen.add(r.actor)
    if (!data || data.length < 1000) break
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}

module.exports = { runWith, context, record, diff, ready, AREAS, PAGE_SIZE, list, listAll, actors }
