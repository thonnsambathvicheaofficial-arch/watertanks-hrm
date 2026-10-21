// Login accounts, roles, and "what may this person do" (access).
//
// Access is read from the DATABASE on every request (cached for a few seconds), not
// from the session cookie, so changing or removing an account takes effect within
// seconds even though a cookie lasts 12 hours.
//
//   administrator  = login_users.role 'admin': every permission, can manage accounts and roles
//   everyone else  = the permissions of their role (migration 004). No role = no access.
//   before the roles table exists, non-administrators keep a read-only fallback.
const bcrypt = require('bcryptjs')
const sb = require('./supabase')
const audit = require('./audit')
const hr = require('./hr-store')
const P = require('./permissions')

const { UserError } = hr
const fail = (m) => { throw new UserError(m) }

const isMissingTable = (e) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /could not find the table|does not exist/i.test(e.message || ''))
let probe = { at: 0, ok: false }
async function rolesReady() {
  if (Date.now() - probe.at < 15000) return probe.ok
  const { error } = await sb.from('roles').select('id').limit(1)
  probe = { at: Date.now(), ok: !error }
  if (error && !isMissingTable(error)) throw new Error(error.message)
  return probe.ok
}

// ── access ──────────────────────────────────────────────────────────────────
const cache = new Map()
const TTL = 30000
const clearCache = () => cache.clear()

async function access(username) {
  const hit = cache.get(username)
  if (hit && Date.now() - hit.at < TTL) return hit.value
  const { data: u, error } = await sb.from('login_users').select('*').eq('username', username).maybeSingle()
  if (error) throw new Error(error.message)
  let value = null
  if (u && !u.disabled) {
    const isAdmin = u.role === 'admin'
    let perms = [], roleName = ''
    if (isAdmin) perms = [...P.KEYS, P.ADMIN_ONLY]
    else if (!(await rolesReady())) perms = [...P.LEGACY_FALLBACK]
    else if (u.role_id) {
      const [{ data: r }, { data: rp }] = await Promise.all([
        sb.from('roles').select('name').eq('id', u.role_id).maybeSingle(),
        sb.from('role_permissions').select('permission').eq('role_id', u.role_id),
      ])
      roleName = r ? r.name : ''
      perms = [...P.expand((rp || []).map(x => x.permission))]
    }
    value = { username: u.username, isAdmin, roleId: u.role_id || null, roleName, perms }
  }
  cache.set(username, { at: Date.now(), value })
  return value
}
const can = (acc, perm) => !!acc && acc.perms.includes(perm)

// ── accounts ────────────────────────────────────────────────────────────────
const toAccount = (r, roleNames) => ({ username: r.username, isAdmin: r.role === 'admin', roleId: r.role_id || '', roleName: r.role_id ? (roleNames[r.role_id] || '') : '', disabled: !!r.disabled, createdAt: r.created_at })

function cleanUsername(v) {
  const u = String(v || '').trim()
  if (u.length < 2 || u.length > 60) fail('The username must be 2 to 60 characters.')
  if (u.includes('|')) fail('The username cannot contain the | character.')
  return u
}
function cleanPassword(v) {
  const p = String(v || '')
  if (p.length < 8) fail('The password must be at least 8 characters.')
  if (p.length > 128) fail('The password is too long (128 characters at most).')
  return p
}

const accounts = {
  list: async () => {
    const [{ data, error }, roles] = await Promise.all([sb.from('login_users').select('*').order('username'), roleList()])
    if (error) throw new Error(error.message)
    const names = Object.fromEntries(roles.map(r => [r.id, r.name]))
    return data.map(r => toAccount(r, names))
  },

  // roleChoice: 'admin' or a role id.
  create: async ({ username, password, roleChoice }) => {
    username = cleanUsername(username); const pw = cleanPassword(password)
    const { data: taken } = await sb.from('login_users').select('username').eq('username', username).maybeSingle()
    if (taken) fail('That username already exists.')
    const row = { username, password_hash: await bcrypt.hash(pw, 10), role: roleChoice === 'admin' ? 'admin' : 'user' }
    if (roleChoice && roleChoice !== 'admin') {
      if (!(await rolesReady())) fail('Roles are not set up yet. Run migrations/004_roles_audit.sql first, or create an administrator.')
      const r = await roles.get(roleChoice); if (!r) fail('That role no longer exists.')
      row.role_id = r.id
    }
    const { error } = await sb.from('login_users').insert(row)
    if (error) throw new Error(error.message)
    clearCache()
    await audit.record({ action: 'user.create', entity: 'user', key: username, summary: `Created the account "${username}" (${roleChoice === 'admin' ? 'administrator' : 'role: ' + (row.role_id ? (await roles.get(row.role_id)).name : 'none')})` })
  },

  // patch: { newUsername, password, roleChoice, disabled }. actor = the signed-in username.
  update: async (username, patch, actor) => {
    const { data: u } = await sb.from('login_users').select('*').eq('username', username).maybeSingle()
    if (!u) fail('That account no longer exists.')
    const self = actor === username
    const row = {}; const changes = {}
    const nn = patch.newUsername != null ? String(patch.newUsername).trim() : ''
    if (nn && nn !== username) {
      if (self) fail('You cannot rename the account you are signed in with. Sign in with another account to rename this one.')
      cleanUsername(nn)
      const { data: taken } = await sb.from('login_users').select('username').eq('username', nn).maybeSingle()
      if (taken) fail('That username already exists.')
      row.username = nn; changes.username = { from: username, to: nn }
    }
    if (patch.password) { row.password_hash = await bcrypt.hash(cleanPassword(patch.password), 10); changes.password = 'reset' }
    if (patch.roleChoice !== undefined) {
      const toAdmin = patch.roleChoice === 'admin'
      if (u.role === 'admin' && !toAdmin && self) fail('You cannot take administrator access away from your own account.')
      if (toAdmin) { row.role = 'admin'; row.role_id = null }
      else {
        if (!(await rolesReady())) fail('Roles are not set up yet. Run migrations/004_roles_audit.sql first.')
        if (patch.roleChoice) { const r = await roles.get(patch.roleChoice); if (!r) fail('That role no longer exists.'); row.role = 'user'; row.role_id = r.id }
        else { row.role = 'user'; row.role_id = null }
      }
      const was = u.role === 'admin' ? 'administrator' : (u.role_id || 'none'), now = row.role === 'admin' ? 'administrator' : (row.role_id || 'none')
      if (was !== now) changes.role = { from: was, to: now }
    }
    if (patch.disabled !== undefined && !!patch.disabled !== !!u.disabled) {
      if (patch.disabled && self) fail('You cannot switch off the account you are signed in with.')
      row.disabled = !!patch.disabled; changes.disabled = { from: !!u.disabled, to: !!patch.disabled }
    }
    if (!Object.keys(row).length) return false
    // Never leave the system without an active administrator.
    const staysAdmin = (row.role ?? u.role) === 'admin' && !(row.disabled ?? u.disabled)
    if (u.role === 'admin' && !u.disabled && !staysAdmin && (await adminCount()) <= 1) fail('There must be at least one active administrator.')
    const { error } = await sb.from('login_users').update(row).eq('username', username)
    if (error) throw new Error(error.message)
    clearCache()
    await audit.record({ action: 'user.update', entity: 'user', key: row.username || username, summary: `Changed the account "${username}": ${Object.keys(changes).join(', ')}`, details: changes })
    return true
  },

  remove: async (username, actor) => {
    if (actor === username) fail('You cannot delete the account you are signed in with.')
    const { data: u } = await sb.from('login_users').select('*').eq('username', username).maybeSingle()
    if (!u) fail('That account no longer exists.')
    if (u.role === 'admin' && !u.disabled && (await adminCount()) <= 1) fail('There must be at least one active administrator.')
    const { error } = await sb.from('login_users').delete().eq('username', username)
    if (error) throw new Error(error.message)
    clearCache()
    await audit.record({ action: 'user.delete', entity: 'user', key: username, summary: `Deleted the account "${username}"` })
  },
}

async function adminCount() {
  const { data, error } = await sb.from('login_users').select('username,disabled').eq('role', 'admin')
  if (error) throw new Error(error.message)
  return data.filter(u => !u.disabled).length
}

// ── roles ───────────────────────────────────────────────────────────────────
async function roleList() {
  if (!(await rolesReady())) return []
  const [{ data: rs, error }, { data: rp }, { data: us }] = await Promise.all([
    sb.from('roles').select('*').order('name'), sb.from('role_permissions').select('role_id,permission'), sb.from('login_users').select('role_id'),
  ])
  if (error) throw new Error(error.message)
  const perms = {}; for (const p of rp || []) (perms[p.role_id] ||= []).push(p.permission)
  const counts = {}; for (const u of us || []) if (u.role_id) counts[u.role_id] = (counts[u.role_id] || 0) + 1
  return rs.map(r => ({ id: r.id, name: r.name, description: r.description || '', perms: (perms[r.id] || []).sort(), accounts: counts[r.id] || 0 }))
}

function cleanRole(input) {
  const name = String(input.name || '').trim()
  if (!name) fail('Give the role a name.')
  if (name.length > 60) fail('The role name is too long.')
  return { name, description: String(input.description || '').trim() || null }
}

const roles = {
  list: roleList,
  get: async (id) => (await roleList()).find(r => r.id === id) || null,
  create: async (input, perms = []) => {
    const row = cleanRole(input)
    const { data, error } = await sb.from('roles').insert(row).select('id').single()
    if (error) { if (error.code === '23505') fail('There is already a role with that name.'); throw new Error(error.message) }
    const granted = [...P.expand(perms)]
    if (granted.length) { const { error: e2 } = await sb.from('role_permissions').insert(granted.map(p => ({ role_id: data.id, permission: p }))); if (e2) throw new Error(e2.message) }
    clearCache()
    await audit.record({ action: 'role.create', entity: 'role', key: row.name, summary: `Created the role "${row.name}" with ${granted.length} permission${granted.length === 1 ? '' : 's'}`, details: { permissions: granted } })
    return data.id
  },
  save: async (id, input, perms) => {
    const cur = await roles.get(id); if (!cur) fail('That role no longer exists.')
    const row = cleanRole(input)
    const { error } = await sb.from('roles').update(row).eq('id', id)
    if (error) { if (error.code === '23505') fail('There is already a role with that name.'); throw new Error(error.message) }
    const next = [...P.expand(perms)].sort()
    const { error: d1 } = await sb.from('role_permissions').delete().eq('role_id', id); if (d1) throw new Error(d1.message)
    if (next.length) { const { error: e2 } = await sb.from('role_permissions').insert(next.map(p => ({ role_id: id, permission: p }))); if (e2) throw new Error(e2.message) }
    clearCache()
    const added = next.filter(p => !cur.perms.includes(p)), removed = cur.perms.filter(p => !next.includes(p))
    await audit.record({ action: 'role.update', entity: 'role', key: row.name, summary: `Changed the role "${row.name}"${added.length || removed.length ? `: +${added.length} -${removed.length} permissions` : ''}`, details: { added, removed, renamedFrom: cur.name !== row.name ? cur.name : undefined } })
  },
  remove: async (id) => {
    const cur = await roles.get(id); if (!cur) fail('That role no longer exists.')
    const { error } = await sb.from('roles').delete().eq('id', id)
    if (error) throw new Error(error.message)
    clearCache()
    await audit.record({ action: 'role.delete', entity: 'role', key: cur.name, summary: `Deleted the role "${cur.name}"${cur.accounts ? `; ${cur.accounts} account${cur.accounts === 1 ? ' now has' : 's now have'} no role` : ''}` })
  },
  fromTemplate: async (name) => {
    const t = P.ROLE_TEMPLATES.find(x => x.name === name); if (!t) fail('Unknown template.')
    return roles.create({ name: t.name, description: t.description }, t.perms)
  },
}

module.exports = { access, can, clearCache, rolesReady, accounts, roles, cleanUsername, cleanPassword }
