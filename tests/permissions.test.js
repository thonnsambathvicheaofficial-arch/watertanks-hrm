// Access control checks that read the source tree, so a new page, action or API route cannot ship unguarded.
const fs = require('fs')
const path = require('path')
const P = require('../lib/permissions.js')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }
const root = path.join(__dirname, '..')
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out); else out.push(p)
  }
  return out
}
const rel = (f) => path.relative(root, f).split(path.sep).join('/')
const read = (f) => fs.readFileSync(f, 'utf8')
// app/(app)/settings/roles/[id]/page.tsx -> /settings/roles/[id]
const routeOf = (f) => '/' + rel(f).replace(/^app\//, '').replace(/\/(page|actions|route)\.tsx?$/, '').split('/').filter(s => !/^\(.*\)$/.test(s)).join('/')
const ADMIN_PAGES = /^\/settings\/(users|roles|notifications)/

// ── the permission table itself ──
console.log('permission table')
ok(P.KEYS.length === new Set(P.KEYS).size, 'permission keys are unique')
ok(Object.entries(P.IMPLIES).every(([k, v]) => P.KEYS.includes(k) && v.every(x => P.KEYS.includes(x))), 'every IMPLIES entry names real permissions')
ok([...P.ROUTE_VIEW, ...P.ROUTE_EDIT].every(([, p]) => P.KEYS.includes(p) || p === P.ADMIN_ONLY), 'every route maps to a real permission')
ok(P.ROLE_TEMPLATES.every(t => t.perms.every(x => P.KEYS.includes(x))), 'every role template uses real permissions')
ok(!P.KEYS.includes(P.ADMIN_ONLY) && P.ROLE_TEMPLATES.every(t => !t.perms.includes(P.ADMIN_ONLY)), 'account management can never be given to a role')
const ex = P.expand(['payroll.finalize'])
ok(ex.has('payroll.edit') && ex.has('payroll.view') && ex.has('payroll.finalize'), 'finalize implies edit and view')
ok(!P.expand(['staff.view']).has('staff.edit'), 'view does not imply edit')
ok(P.expand([P.ADMIN_ONLY, 'nonsense']).size === 0, 'unknown and admin-only keys are dropped from a role')
ok(P.viewPermFor('/some/new/page') === P.ADMIN_ONLY && P.editPermFor('/some/new/page') === P.ADMIN_ONLY, 'a page or action not in the table needs an administrator')
ok(P.viewPermFor('/') === 'attendance.view' && P.viewPermFor('/reports') === 'attendance.view', 'the home page is matched exactly, not as a prefix of everything')
ok(P.viewPermFor('/settings/roles/abc') === P.ADMIN_ONLY, 'a dynamic child of an admin page needs an administrator')
ok(P.viewPermFor('/payroll/2026-10') === 'payroll.view' && P.editPermFor('/payroll/slip/9') === 'payroll.edit', 'payroll children inherit payroll permissions')
ok(P.viewPermFor('/leave/new') === 'leave.edit' && P.editPermFor('/leave/new') === 'leave.edit' && P.editPermFor('/leave') === 'leave.approve', 'leave: the entry form needs edit, decisions need approve')
ok(P.viewPermFor('/staff/new') === 'staff.edit', 'the add-staff form needs staff.edit')
ok(P.viewPermFor('/roster/day') === 'attendance.edit' && P.viewPermFor('/roster') === 'attendance.view', 'the correct-a-day form needs attendance.edit; the roster itself only view')
ok(P.viewPermFor('/staffing') === P.ADMIN_ONLY, 'a prefix match respects path segments (/staffing is not /staff)')

// ── pages ──
console.log('pages')
const pages = walk(path.join(root, 'app/(app)')).filter(f => f.endsWith('/page.tsx') || f.endsWith('\\page.tsx'))
ok(pages.length > 20, `found ${pages.length} pages`)
for (const f of pages) {
  const r = routeOf(f)
  ok(/await guard\(\)/.test(read(f)), `${r} calls guard()`)
  const need = P.viewPermFor(r.replace(/\[[^\]]+\]/g, 'x'))
  ok(need !== P.ADMIN_ONLY || ADMIN_PAGES.test(r), `${r} has a view permission in the table (${need === P.ADMIN_ONLY ? 'admin only' : need})`)
}

// ── actions ──
console.log('actions')
for (const f of walk(path.join(root, 'app/(app)')).filter(f => /actions\.ts$/.test(f))) {
  const r = routeOf(f), src = read(f)
  if (/import\/actions/.test(rel(f))) {
    ok(/authorize\(/.test(src) && /import\.run/.test(src), `${r} checks import.run and the kind's own permission itself`)
    continue
  }
  ok(/\bact\(/.test(src), `${r} writes through act()`)
  ok(!/\bsb\.from\(|supabase/.test(src), `${r} does not talk to the database directly`)
  const need = P.editPermFor(r)
  ok(need !== P.ADMIN_ONLY || ADMIN_PAGES.test(r), `${r} has an edit permission in the table (${need === P.ADMIN_ONLY ? 'admin only' : need})`)
}

// ── API routes ──
console.log('api routes')
const OPEN = new Set(['app/api/login/route.ts', 'app/api/logout/route.ts', 'app/api/cron/pull/route.ts', 'app/api/cron/fast/route.ts', 'app/(app)/payroll/open/route.ts'])
for (const f of walk(path.join(root, 'app')).filter(f => /route\.ts$/.test(f))) {
  const name = rel(f)
  if (OPEN.has(name)) continue
  ok(/denyUnless\(req, '[a-z]+\.[a-z]+'\)/.test(read(f)), `${name} checks a permission`)
}
const auth = read(path.join(root, 'lib/cron-auth.ts'))
ok(/cronRefusal\(req\)/.test(read(path.join(root, 'app/api/cron/pull/route.ts'))), 'the cron route is protected by its own secret')
ok(/cronRefusal\(req\)/.test(read(path.join(root, 'app/api/cron/fast/route.ts'))), 'the fast-poll route is protected by its own secret')
ok(/if \(!secret\)/.test(auth) && /Bearer \$\{secret\}/.test(auth), 'with no CRON_SECRET set the routes refuse everything, so "Bearer undefined" cannot get in')
// Every secret-protected scheduler route must also be open in the middleware, or the session check answers 401
// "Not authenticated" before the route ever sees the secret (this hid the fast poll behind the login wall).
const mw = read(path.join(root, 'middleware.ts'))
for (const route of ['/api/cron/pull', '/api/cron/fast']) ok(mw.includes(`'${route}'`), `the middleware lets the scheduler reach ${route} without a session`)

console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
