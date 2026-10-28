import { NextResponse } from 'next/server'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const store = require('@/lib/store')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Called on a schedule with `Authorization: Bearer <CRON_SECRET>`. Same contract
// as the legacy Express route, so the existing scheduler needs no change.
export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { pullAll, refreshDeviceUsers } = require('@/lib/zkpull')
  const full = new URL(req.url).searchParams.get('full') === '1'
  const result = await pullAll({ full })
  // Keep the device-name cache fresh for the staff-suggestion tool: gated to
  // ~hourly, time-capped, and wrapped so it can never break the punch pull.
  try {
    if ((await store.deviceUsers.ageMinutes()) > 45) {
      await Promise.race([refreshDeviceUsers(), new Promise((_, rej) => setTimeout(() => rej(new Error('cap')), 25000))])
    }
  } catch { /* best-effort; cache stays as-is */ }
  // Announce the scans this sync just saved. After the scans are safely stored, time-capped, and never throws.
  let notified: unknown = null
  try { notified = await require('@/lib/notify').run({ budgetMs: 15000 }) } catch { notified = { error: 'notification run failed' } }
  return NextResponse.json({ ...result, notified })
}
