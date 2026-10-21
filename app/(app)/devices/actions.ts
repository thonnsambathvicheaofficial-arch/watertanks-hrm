'use server'

import { act } from '@/lib/act'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { devices } = require('@/lib/device-admin')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { UserError } = require('@/lib/hr-store')

const BACK = '/devices'
const read = (f: FormData) => ({ name: f.get('name'), type: f.get('type'), ip: f.get('ip'), port: f.get('port'), serial: f.get('serial'), publicHost: f.get('publicHost'), publicPort: f.get('publicPort') })

export async function addDevice(f: FormData) {
  await act('/devices/new', async () => { await devices.add(read(f)); return 'Device added.' }, BACK, f)
}

export async function updateDevice(f: FormData) {
  const id = String(f.get('id'))
  await act(`/devices/edit/${id}`, async () => { await devices.update(id, read(f)); return 'Device saved.' }, BACK, f)
}

export async function removeDevice(f: FormData) {
  const id = String(f.get('id'))
  await act(`/devices/edit/${id}`, async () => { const d = await devices.remove(id); return `${d.name} removed.` }, BACK)
}

// Reads the device now. Read-only toward the device, exactly like the scheduled sync.
export async function pullNow(f: FormData) {
  const id = String(f.get('id'))
  await act(BACK, async () => {
    const r = await devices.pull(id, { full: f.get('full') === 'on' })
    if (!r.ok) throw new UserError(`${r.name}: the device could not be read. ${r.error || ''}`.trim())
    // A manual read also announces any new scans, exactly as the scheduled sync does.
    try { await require('@/lib/notify').run({ budgetMs: 10000 }) } catch { /* never affects the read */ }
    const note = r.truncated ? ' The read was cut short, so the next sync will try again.' : ''
    return `${r.name}: ${r.pushed} new scan${r.pushed === 1 ? '' : 's'} (${r.totalOnDevice} on the device).${note}`
  })
}
