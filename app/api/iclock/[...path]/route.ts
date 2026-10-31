import { NextResponse } from 'next/server'
import { relayRefusal } from '@/lib/cron-auth'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sb = require('@/lib/supabase')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const iclock = require('@/lib/iclock')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const zkpull = require('@/lib/zkpull')   // also pins the time zone, as the polling path does

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// The receiver for readers that push each scan the moment it happens (ZKTeco ADMS / "iclock"). The reader talks plain
// HTTP, so it reaches us through the relay (relay/cloudflare-worker.js), which adds the secret header and forwards here
// over HTTPS. A reader repeats anything we do not answer "OK" to, so every failure below answers with an error and the
// scan is delivered again rather than lost.

const plain = (body: string, status = 200) => new NextResponse(body, { status, headers: { 'Content-Type': 'text/plain' } })
const nowPP = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Phnom_Penh', hour12: false }).replace('T', ' ')

type Device = { id: string; name: string; serial: string | null }

async function deviceBySerial(sn: string): Promise<Device | null> {
  if (!sn) return null
  const { data } = await sb.from('devices').select('*').eq('serial', sn).maybeSingle()
  return data || null
}
// Shows on the Live page's Readers panel as "last checked".
async function touch(dev: Device) {
  try { await sb.from('devices').update({ fast_at: new Date().toISOString(), fast_error: null }).eq('id', dev.id) } catch { /* a heartbeat is best effort */ }
}

export async function GET(req: Request) {
  const denied = await relayRefusal(req)
  if (denied) return denied
  const url = new URL(req.url)
  const action = iclock.actionOf(url.pathname)
  const dev = await deviceBySerial(iclock.serialOf(req.url))
  if (dev) await touch(dev)
  if (action === 'getrequest') return plain('OK')
  // Handshake: tell the reader to push every scan now, and what time and zone it should keep.
  return plain(iclock.optionsReply({ host: url.host, tzMinutes: 420, now: nowPP() }))
}

export async function POST(req: Request) {
  const denied = await relayRefusal(req)
  if (denied) return denied
  const url = new URL(req.url)
  const action = iclock.actionOf(url.pathname)
  const body = await req.text()
  if (action !== 'cdata') return plain('OK')
  const table = (url.searchParams.get('table') || '').toUpperCase()
  if (table && table !== 'ATTLOG') return plain('OK')   // operation logs, user data and the rest are not ours to store

  const lines = iclock.parseAttLog(body)
  if (!lines.length) return plain('OK: 0')

  // Records from a reader we do not know are NOT acknowledged: it keeps them and tries again once the reader is registered.
  const dev = await deviceBySerial(iclock.serialOf(req.url))
  if (!dev) return plain('ERROR: unknown device', 404)

  try {
    const exemptPins = await zkpull.nightShiftPins()
    const { rows, badRows } = zkpull.classifyRecords(dev, iclock.toRecords(lines), exemptPins)
    if (badRows.length) { try { const { error: qe } = await sb.from('corrupted_punches').upsert(badRows, { onConflict: 'pin,ts', ignoreDuplicates: true }); if (qe) console.error('[iclock] quarantine not saved:', qe.message) } catch (e) { console.error('[iclock] quarantine not saved:', (e as Error).message) } }
    if (rows.length) {
      const stamped = rows.map((r: Record<string, unknown>) => ({ ...r, source: 'push' }))
      const { error } = await sb.from('punches').upsert(stamped, { onConflict: 'pin,ts', ignoreDuplicates: true })
      if (error) throw new Error(error.message)
    }
    await touch(dev)
    // Announce right away: the scan is saved, so this is the moment.
    try { await require('@/lib/notify').run({ budgetMs: 10000 }) } catch { /* the next run picks anything left */ }
    return plain(`OK: ${lines.length}`)
  } catch (e) {
    console.error('[iclock]', (e as Error).message)
    return plain('ERROR: could not save', 500)
  }
}
