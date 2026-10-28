// audit_offline_gap.js — Checks for missing punch data after a device offline period.
process.env.TZ = 'Asia/Phnom_Penh'
require('dotenv').config()

const sb = require('../lib/supabase')
const pad = n => String(n).padStart(2, '0')
const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`

;(async () => {
  // ── 1. Device health ────────────────────────────────────────────────────
  console.log('\n=== 1. DEVICE SYNC STATUS ===\n')
  const { data: devices, error: devErr } = await sb.from('devices').select('*').order('name')
  if (devErr) throw new Error(devErr.message)

  const now = new Date()
  for (const d of devices) {
    const lastAt = d.last_pull_at ? new Date(d.last_pull_at) : null
    const agoMin = lastAt ? Math.round((now - lastAt) / 60000) : null
    const agoStr = agoMin == null ? 'never' : agoMin < 90 ? `${agoMin}m ago` : `${Math.round(agoMin/60)}h ago`
    const status = d.last_pull_ok === false ? 'LAST PULL FAILED' : d.last_pull_ok === true ? 'ok' : 'unknown'
    console.log(`  ${d.name.padEnd(12)} [${status}]  last_sync=${agoStr}  log_count=${d.last_log_count ?? 'n/a'}  type=${d.type}`)
    if (d.last_pull_error) console.log(`               error: ${d.last_pull_error}`)
  }

  // ── 2. Punch counts by date x device (last 21 days) ─────────────────────
  console.log('\n=== 2. PUNCH COUNTS BY DATE x DEVICE (last 21 days) ===\n')
  const since = new Date(now); since.setDate(since.getDate() - 20)
  const sinceStr = `${fmtDate(since)} 00:00:00`

  const { data: punches, error: pErr } = await sb
    .from('punches')
    .select('ts, device_id, pin')
    .gte('ts', sinceStr)
    .order('ts', { ascending: true })
  if (pErr) throw new Error(pErr.message)
  console.log(`  Total punches fetched (last 21 days): ${punches.length}`)

  const devNameById = {}
  for (const d of devices) devNameById[d.id] = d.name

  const grid = {}
  for (const p of punches) {
    const date = p.ts.slice(0, 10)
    const devName = devNameById[p.device_id] || p.device_id
    if (!grid[date]) grid[date] = {}
    if (!grid[date][devName]) grid[date][devName] = new Set()
    grid[date][devName].add(p.pin)
  }

  const allDates = Object.keys(grid).sort()
  const allDevNames = [...new Set(devices.map(d => d.name))].sort()

  console.log('  Date        Day  ' + allDevNames.map(n => n.padEnd(8)).join('  '))
  console.log('  ' + '-'.repeat(60))

  const countGrid = {}
  for (const date of allDates) {
    countGrid[date] = {}
    for (const devName of allDevNames) {
      countGrid[date][devName] = grid[date]?.[devName]?.size ?? 0
    }
  }

  const SUSPECT_THRESHOLD = 5
  const flagged = []

  for (const devName of allDevNames) {
    const countsByDate = allDates.map(d => ({ date: d, n: countGrid[d][devName] }))
    for (let i = 0; i < countsByDate.length; i++) {
      const { date, n } = countsByDate[i]
      const neighbors = [...countsByDate.slice(Math.max(0, i-3), i), ...countsByDate.slice(i+1, i+4)]
        .map(x => x.n).filter(x => x > 0)
      const avg = neighbors.length ? Math.round(neighbors.reduce((a,b) => a+b, 0) / neighbors.length) : 0
      if (n === 0 && avg >= SUSPECT_THRESHOLD) {
        const dow = new Date(date + 'T00:00:00').getDay()
        const weekend = dow === 0 || dow === 6
        flagged.push({ date, device: devName, normalAvg: avg, weekend })
      }
    }
  }

  for (const date of allDates) {
    const dow = new Date(date + 'T00:00:00').getDay()
    const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow]
    const isWeekend = dow === 0 || dow === 6
    const cols = allDevNames.map(n => {
      const cnt = countGrid[date][n]
      const isFlagged = flagged.find(f => f.date === date && f.device === n && !f.weekend)
      return (cnt === 0 ? (isFlagged ? '!ZERO! ' : '-      ') : String(cnt).padEnd(8))
    })
    const wknd = isWeekend ? ' [weekend]' : ''
    console.log(`  ${date}  ${dayName}  ${cols.join('  ')}${wknd}`)
  }

  // ── 3. Flagged gaps ─────────────────────────────────────────────────────
  const realFlags = flagged.filter(f => !f.weekend)
  console.log('\n=== 3. GAPS AUDIT ===\n')
  if (realFlags.length === 0) {
    console.log('  OK - No suspicious gaps found. All weekdays have punch activity on every device.\n')
  } else {
    console.log('  WARNING - Suspicious zero-punch weekdays:\n')
    for (const f of realFlags) {
      console.log(`  WARN  ${f.date}  device=${f.device}  (nearby days avg ${f.normalAvg} punches)`)
    }

    console.log('\n  Checking if the same PINs punched on OTHER devices those days...\n')
    for (const f of realFlags) {
      const { data: others, error: oErr } = await sb
        .from('punches')
        .select('pin, device_id, ts')
        .gte('ts', f.date + ' 00:00:00')
        .lte('ts', f.date + ' 23:59:59')
      if (oErr) continue
      const otherDevices = [...new Set(others.map(p => devNameById[p.device_id] || p.device_id))]
      const uniquePins = [...new Set(others.map(p => p.pin))].length
      if (others.length === 0) {
        console.log(`  !! ${f.date}: NO punches at all on ANY device — likely fully offline day`)
      } else {
        console.log(`  INFO  ${f.date}: ${f.device} has 0, but ${uniquePins} unique PINs found via [${otherDevices.join(', ')}]`)
      }
    }
  }

  // ── 4. Quarantined records ───────────────────────────────────────────────
  console.log('\n=== 4. QUARANTINED RECORDS (corrupted_punches) ===\n')
  try {
    const { data: bad, error: bErr } = await sb.from('corrupted_punches').select('device_name, reason, detected_at').order('detected_at', { ascending: false })
    if (bErr) throw new Error(bErr.message)
    const byReason = {}
    for (const b of (bad || [])) {
      const key = `${b.device_name} / ${b.reason}`
      byReason[key] = (byReason[key] || 0) + 1
    }
    if (Object.keys(byReason).length === 0) {
      console.log('  (none)\n')
    } else {
      for (const [key, cnt] of Object.entries(byReason)) {
        console.log(`  ${String(cnt).padStart(4)}x  ${key}`)
      }
      console.log('')
    }
  } catch { console.log('  (corrupted_punches table not accessible)\n') }

  process.exit(0)
})().catch(e => { console.error('\nFatal:', e.message); process.exit(1) })
