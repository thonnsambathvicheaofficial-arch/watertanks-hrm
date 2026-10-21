import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Called every few seconds by the scheduler with `Authorization: Bearer <CRON_SECRET>` (see db/pg-cron-fast-poll.sql).
// Asks each device how many records it holds, reads only the newest ones when that grew, saves them and announces them.
// The scheduled /api/cron/pull stays as the safety net that proves nothing was missed.
export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { fastPoll } = require('@/lib/zkfast')
  try {
    return NextResponse.json(await fastPoll())
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
