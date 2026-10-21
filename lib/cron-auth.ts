import { NextResponse } from 'next/server'

// Shared check for the scheduler routes: `Authorization: Bearer <CRON_SECRET>`.
// Returns a response to send back when the call must be refused, or null when it may go ahead.
// A server with no CRON_SECRET refuses everything (it must never accept the header "Bearer undefined"),
// and says so, so a new deployment that is missing the variable is easy to spot.
export function cronRefusal(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not set on this server. Add it under the project\'s Environment Variables and redeploy.' }, { status: 503 })
  if (req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return null
}
