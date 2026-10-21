// A ticker you can run on any computer: calls the fast poll every few seconds, working hours only.
//   npm run live                 (every 8 seconds)
//   node scripts/live-poll.js 5  (every 5 seconds)
// It uses the same code as the site's /api/cron/fast, with the .env settings, so notifications go out while it runs.
// Several tickers can run at once (and the site's own scheduler): each scan is saved once and announced once.
require('dotenv').config({ quiet: true })
const { fastPoll } = require('../lib/zkfast')

const every = Math.max(3, Number(process.argv[2]) || 8) * 1000
const hour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Phnom_Penh', hour: '2-digit', hour12: false }).format(new Date()))
const stamp = () => new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Phnom_Penh' })
let busy = false

async function tick() {
  if (busy) return
  const h = hour()
  if (h < 5 || h > 20) return
  busy = true
  try {
    const r = await fastPoll()
    const new_ = r.inserted ? `  +${r.inserted} new scan${r.inserted === 1 ? '' : 's'}${r.notified && r.notified.sent ? `, ${r.notified.sent} announced` : ''}` : ''
    if (r.inserted || !r.ok || r.note) console.log(stamp(), r.note || (r.ok ? 'ok' : 'a device failed'), new_, r.ok ? '' : JSON.stringify(r.results.filter(x => !x.ok).map(x => `${x.device}: ${x.error}`)))
  } catch (e) { console.log(stamp(), 'error:', e.message) }
  busy = false
}

console.log(`Live poll every ${every / 1000}s, 05:00 to 20:59 Phnom Penh time. Press Ctrl+C to stop.`)
tick()
setInterval(tick, every)
