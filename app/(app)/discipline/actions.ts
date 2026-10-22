'use server'

import { act } from '@/lib/act'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { records } = require('@/lib/discipline-store')

const text = (f: FormData, k: string) => String(f.get(k) ?? '')

export async function createRecord(f: FormData) {
  await act('/discipline/new', async (s) => {
    await records.add({ pin: text(f, 'pin'), occurredOn: text(f, 'date'), kind: text(f, 'kind'), reason: text(f, 'reason'), deduction: text(f, 'deduction'), payrollMonth: text(f, 'payrollMonth'), by: s.username })
    return 'Saved as a draft. Open it to confirm: nothing reaches payroll until you do.'
  }, '/discipline', f)
}

export async function saveRecord(f: FormData) {
  const id = text(f, 'id')
  await act(`/discipline/${id}`, async () => {
    await records.update(id, { occurredOn: text(f, 'date'), kind: text(f, 'kind'), reason: text(f, 'reason'), deduction: text(f, 'deduction'), payrollMonth: text(f, 'payrollMonth') })
    return 'Draft saved.'
  }, undefined, f)
}

export async function confirmRecord(f: FormData) {
  const id = text(f, 'id')
  await act(`/discipline/${id}`, async (s) => {
    const r = await records.confirm(id, s.username)
    return r.entryId ? 'Confirmed. The salary deduction is now on Monthly items for payroll.' : 'Confirmed.'
  })
}

export async function discardRecord(f: FormData) {
  const id = text(f, 'id')
  await act(`/discipline/${id}`, async () => { await records.discard(id); return 'Draft discarded.' }, '/discipline')
}

export async function withdrawRecord(f: FormData) {
  const id = text(f, 'id')
  await act(`/discipline/${id}`, async (s) => { await records.withdraw(id, { reason: text(f, 'reason'), by: s.username }); return 'Withdrawn. Any payroll deduction for it was removed.' }, undefined, f)
}

export async function issueLetter(f: FormData) {
  const id = text(f, 'id')
  await act(`/discipline/${id}`, async (s) => { await records.issueLetter(id, s.username); return 'The warning letter is issued. Print it and have it signed.' }, `/discipline/${id}/letter`)
}

export async function markSigned(f: FormData) {
  const id = text(f, 'id')
  await act(`/discipline/${id}`, async () => { await records.acknowledge(id, text(f, 'signedOn')); return 'Marked as signed.' }, undefined, f)
}
