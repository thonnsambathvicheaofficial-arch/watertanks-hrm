import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sb = require('@/lib/supabase')

// Shared check for the scheduler routes: `Authorization: Bearer <secret>`.
// Returns a response to send back when the call must be refused, or null when it may go ahead.
//
// The secret is accepted from either place, so the scheduler never depends on two copies matching by hand:
//   - the cron_secrets table in the database (the pg_cron job reads the same row when it makes the call), or
//   - the CRON_SECRET environment variable (for any other scheduler).
// With neither set, everything is refused (never the header "Bearer undefined").
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

async function dbSecret(name: string): Promise<string | null> {
  try {
    const { data, error } = await sb.from('cron_secrets').select('value').eq('name', name).maybeSingle()
    if (error && !/relation|schema cache|does not exist|Could not find/i.test(error.message)) console.error('[cron-auth] could not read the secret:', error.message)
    return data && typeof data.value === 'string' && data.value ? data.value : null
  } catch (e) { console.error('[cron-auth] could not read the secret:', (e as Error).message); return null }   // table not created yet: fall back to the environment variable
}

// The push relay (see relay/) vouches for a reader's request with the header `x-relay-secret`. The secret is the row
// named 'relay' in cron_secrets (or RELAY_SECRET); with neither set, every push request is refused.
export async function relayRefusal(req: Request): Promise<NextResponse | null> {
  const given = req.headers.get('x-relay-secret') || ''
  const env = process.env.RELAY_SECRET
  if (given && env && same(given, env)) return null
  const stored = await dbSecret('relay')
  if (given && stored && same(given, stored)) return null
  if (!env && !stored) return new NextResponse('Push is not set up on this server.', { status: 503 })
  return new NextResponse('Forbidden', { status: 403 })
}

export async function cronRefusal(req: Request, name = 'scheduler'): Promise<NextResponse | null> {
  const given = req.headers.get('authorization') || ''
  const env = process.env.CRON_SECRET
  if (env && same(given, `Bearer ${env}`)) return null
  const stored = await dbSecret(name)
  if (stored && same(given, `Bearer ${stored}`)) return null
  if (!env && !stored) return NextResponse.json({ error: 'No scheduler secret is set up on this server (run db/pg-cron-fast-poll.sql, or set CRON_SECRET).' }, { status: 503 })
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
