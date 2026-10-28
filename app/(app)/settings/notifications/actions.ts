'use server'

import { act } from '@/lib/act'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const notify = require('@/lib/notify')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { UserError } = require('@/lib/hr-store')

const BACK = '/settings/notifications'

export async function saveNotifications(f: FormData) {
  await act(BACK, async (s) => {
    const r = await notify.saveSettings({
      enabled: f.get('enabled') === 'on', chatId: f.get('chatId'), scopeGroup: f.get('scopeGroup'), departmentIds: f.getAll('departmentIds'),
      ignoreRepeatSeconds: f.get('ignoreRepeatSeconds'), maxAgeMinutes: f.get('maxAgeMinutes'), digestThreshold: f.get('digestThreshold'),
      leaveDigestEnabled: f.get('leaveDigestEnabled') === 'on', leaveDigestTime: f.has('leaveDigestTime') ? f.get('leaveDigestTime') : undefined,
    }, s.username)
    return r.after.enabled ? (r.before.enabled ? 'Settings saved.' : 'Settings saved. Notifications are on: scans saved from now on are announced.') : 'Settings saved. Notifications are off.'
  }, undefined, f)
}

export async function sendTestMessage() {
  await act(BACK, async (s) => {
    const cur = await notify.getSettings()
    if (!cur.chat_id) throw new UserError('Save the Telegram group ID first.')
    const r = await notify.sendTest(cur.chat_id, s.username)
    if (!r.ok) throw new UserError(r.error)
    return `Test message sent to ${r.chat || 'the group'} as @${r.bot}.`
  })
}
