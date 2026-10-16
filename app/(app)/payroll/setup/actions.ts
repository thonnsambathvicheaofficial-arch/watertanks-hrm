'use server'

import { act } from '@/lib/act'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pr = require('@/lib/payroll-store')

type Row = { pin: string; salary: string; dependents: string; paymentMethod: string; bankName: string; bankAccount: string; taxResident: boolean; taxExempt: boolean; nssfExempt: boolean }

// Fields are named "s|<pin>|<field>". Checkboxes only appear when ticked, so a hidden
// "present" marker per row tells us the row was on the page. Only rows that differ from
// what is stored are written.
export async function savePaySetup(f: FormData) {
  await act('/payroll/setup', async (s) => {
    const current = await pr.structure.list()
    const rows = new Map<string, Row>()
    for (const [k, raw] of f.entries()) {
      if (!k.startsWith('s|')) continue
      const [, pin, field] = k.split('|')
      if (!rows.has(pin)) rows.set(pin, { pin, salary: '', dependents: '0', paymentMethod: '', bankName: '', bankAccount: '', taxResident: false, taxExempt: false, nssfExempt: false })
      const r = rows.get(pin)!
      const v = String(raw)
      if (field === 'salary') r.salary = v.trim()
      else if (field === 'dependents') r.dependents = v.trim() || '0'
      else if (field === 'paymentMethod') r.paymentMethod = v
      else if (field === 'bankName') r.bankName = v.trim()
      else if (field === 'bankAccount') r.bankAccount = v.trim()
      else if (field === 'taxResident') r.taxResident = true
      else if (field === 'taxExempt') r.taxExempt = true
      else if (field === 'nssfExempt') r.nssfExempt = true
    }
    const changed = [...rows.values()].filter(r => {
      const c = current[r.pin]
      if (!c) return !!(r.salary || r.paymentMethod || r.bankName || r.bankAccount || Number(r.dependents) || r.taxExempt || r.nssfExempt || !r.taxResident)
      return String(c.salary ?? '') !== (r.salary === '' ? '' : String(Number(r.salary))) || c.dependents !== Number(r.dependents) || c.paymentMethod !== r.paymentMethod || c.bankName !== r.bankName || c.bankAccount !== r.bankAccount || c.taxResident !== r.taxResident || c.taxExempt !== r.taxExempt || c.nssfExempt !== r.nssfExempt
    })
    if (!changed.length) return 'No changes to save.'
    const n = await pr.structure.saveMany(changed, s.username)
    return `Saved pay setup for ${n} ${n === 1 ? 'person' : 'people'}.`
  })
}
