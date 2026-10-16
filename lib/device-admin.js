// Managing fingerprint devices from the web: add, edit, remove, pull now, and the list of
// scans a device clock produced that were held aside.
//
// Devices are only ever READ from. Nothing here writes to, clears or wipes a device.
// Removing a device is refused while it has scans stored, so history is never detached.
const sb = require('./supabase')
const store = require('./store')
const { UserError } = require('./hr-store')

const fail = (m) => { throw new UserError(m) }
const HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/

function clean(i, { partial = false } = {}) {
  const name = String(i.name || '').trim()
  if (!name) fail('Give the device a name.')
  if (name.length > 80) fail('The device name is too long.')
  const type = i.type === 'adms' ? 'adms' : 'pull'
  const ip = String(i.ip || '').trim(), publicHost = String(i.publicHost || '').trim()
  if (ip && !HOST.test(ip)) fail('The IP address is not valid.')
  if (publicHost && !HOST.test(publicHost)) fail('The public host is not valid. Use the router address (an IP or a name), without http:// or a port.')
  const port = Number(i.port || 4370), publicPort = i.publicPort === '' || i.publicPort == null ? null : Number(i.publicPort)
  for (const [label, v] of [['port', port], ['public port', publicPort]]) if (v !== null && !(Number.isInteger(v) && v >= 1 && v <= 65535)) fail(`The ${label} must be a number from 1 to 65535.`)
  if (type === 'pull' && !ip && !publicHost) fail('A device that is pulled needs an IP address or a public host.')
  return { name, type, ip: ip || null, port, serial: String(i.serial || '').trim() || null, public_host: publicHost || null, public_port: publicPort }
}

const devices = {
  add: async (input) => {
    const row = clean(input)
    const { data, error } = await sb.from('devices').insert(row).select('id').single()
    if (error) throw new Error(error.message)
    return data.id
  },
  get: async (id) => store.devices.get(id),
  update: async (id, input) => {
    const cur = await store.devices.get(id)
    if (!cur) fail('That device no longer exists.')
    const row = clean(input)
    const { error } = await sb.from('devices').update(row).eq('id', id)
    if (error) throw new Error(error.message)
    return { before: cur, row }
  },
  remove: async (id) => {
    const cur = await store.devices.get(id)
    if (!cur) fail('That device no longer exists.')
    const { count, error } = await sb.from('punches').select('id', { count: 'exact', head: true }).eq('device_id', id)
    if (error) throw new Error(error.message)
    if (count) fail(`${cur.name} has ${count.toLocaleString()} scans stored. Removing it would detach them from it, so it cannot be removed. Rename it instead.`)
    const { error: dErr } = await sb.from('devices').delete().eq('id', id)
    if (dErr) throw new Error(dErr.message)
    return cur
  },
  // Reads the device now, the same read the scheduled sync does. full = ignore the "nothing new" shortcut.
  pull: async (id, { full = false } = {}) => {
    const { data: raw, error } = await sb.from('devices').select('*').eq('id', id).maybeSingle()
    if (error) throw new Error(error.message)
    if (!raw) fail('That device no longer exists.')
    if (raw.type !== 'pull') fail('Only devices that are pulled over the network can be read from here.')
    if (!raw.public_host) fail('This device has no public host set, so it cannot be reached from the internet. Edit it and add the router address.')
    const { pullOne } = require('./zkpull')
    const ZKLib = require('node-zklib')
    return { name: raw.name, ...(await pullOne(ZKLib, raw, { full })) }
  },
  // Scans whose time the device clock got wrong. They are kept apart from attendance, never deleted.
  held: async ({ deviceId, limit = 500 } = {}) => {
    let q = sb.from('corrupted_punches').select('*', { count: 'exact' }).order('detected_at', { ascending: false }).order('id', { ascending: false }).limit(limit)
    if (deviceId) q = q.eq('device_id', deviceId)
    const { data, error, count } = await q
    if (error) throw new Error(error.message)
    return { rows: data || [], total: count || 0 }
  },
}

module.exports = { devices }
