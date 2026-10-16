'use server'

import { act } from '@/lib/act'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lv = require('@/lib/leave-store')

// Fields are named "e|<pin>|<leaveTypeId>". Only cells that differ from what is
// stored are written, so saving never touches an untouched row.
export async function saveEntitlements(f: FormData) {
  const year = Number(f.get('year'))
  await act(`/settings/entitlements?year=${year}`, async () => {
    const current = await lv.entitlements.forYear(year)
    const changes: { pin: string; typeId: string; days: string }[] = []
    for (const [k, raw] of f.entries()) {
      if (!k.startsWith('e|')) continue
      const [, pin, typeId] = k.split('|')
      const v = String(raw).trim()
      const had = current[pin] && current[pin][typeId] != null ? String(current[pin][typeId]) : ''
      if (v !== had && !(v !== '' && had !== '' && Number(v) === Number(had))) changes.push({ pin, typeId, days: v })
    }
    if (!changes.length) return 'No changes to save.'
    const r = await lv.entitlements.saveMany(year, changes)
    return `Saved ${r.saved} ${r.saved === 1 ? 'entitlement' : 'entitlements'}${r.cleared ? ` and cleared ${r.cleared}` : ''}.`
  })
}

export async function fillDefaults(f: FormData) {
  const year = Number(f.get('year'))
  await act(`/settings/entitlements?year=${year}`, async () => {
    const n = await lv.entitlements.fillDefaults(year)
    return n ? `Added ${n} entitlement${n === 1 ? '' : 's'} from the defaults. Existing ones were left alone.` : 'Nothing to add. Either everyone already has a value, or no leave type has default days set.'
  })
}
