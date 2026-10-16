'use server'

import { act } from '@/lib/act'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lv = require('@/lib/leave-store')

export async function createLeave(f: FormData) {
  await act('/leave/new', async (s) => {
    const r = await lv.requests.create({
      pin: f.get('pin'), typeId: f.get('typeId'), from: f.get('from'), to: f.get('to'), halfDay: f.get('halfDay') === 'on',
      period: f.get('period'), reason: f.get('reason'), status: f.get('status'), by: s.username,
    })
    return `Leave recorded: ${r.days} day${r.days === 1 ? '' : 's'}.${r.warning ? ' ' + r.warning : ''}`
  }, '/leave', f)
}

// One action for the three row buttons; which one is in the hidden "decision" field.
export async function decideLeave(f: FormData) {
  const id = String(f.get('id')), decision = String(f.get('decision'))
  const status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'cancelled'
  await act('/leave', async (s) => {
    const warn = await lv.requests.decide(id, { status, by: s.username, note: f.get('note') })
    return warn || (status === 'approved' ? 'Approved.' : status === 'rejected' ? 'Rejected.' : 'Cancelled. The days count as worked again.')
  })
}
