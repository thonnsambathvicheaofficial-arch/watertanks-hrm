// ZKTeco push (ADMS / "iclock") protocol, the parts this app needs. Pure functions, tested without a reader or a database.
// A reader that has a server address set sends each scan to it the moment it happens (when told Realtime=1), and keeps
// re-sending anything we have not acknowledged with "OK", so a failed save is never lost.
//
//   GET  /iclock/cdata?SN=..&options=all   handshake: we answer with options (push each scan now, here is the time)
//   POST /iclock/cdata?SN=..&table=ATTLOG  the scans, one line each: PIN <tab> YYYY-MM-DD HH:MM:SS <tab> status <tab> verify ...
//   GET  /iclock/getrequest?SN=..          heartbeat: "anything for me?"; we answer OK
//   POST /iclock/devicecmd                 results of commands we never send; we answer OK

const DATETIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/
// A real moment, not just the right shape (month 13, hour 99 and 30 February are refused).
function validTime(t) {
  const m = DATETIME.exec(t)
  if (!m) return false
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number)
  const u = new Date(Date.UTC(y, mo - 1, d, h, mi, se))
  return u.getUTCFullYear() === y && u.getUTCMonth() === mo - 1 && u.getUTCDate() === d && h < 24 && mi < 60 && se < 60
}

// Scan lines from a POST body. Firmwares differ: some prefix the line with "ATTLOG", some do not. Anything whose second
// field is not a date-time (operation-log rows, blank lines, junk) is ignored rather than guessed at.
function parseAttLog(body) {
  const out = []
  for (const raw of String(body || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    let parts = line.split('\t')
    if (parts[0] === 'ATTLOG') parts = parts.slice(1)
    if (parts.length < 2) continue
    const pin = (parts[0] || '').trim()
    const time = (parts[1] || '').trim()
    if (!pin || !/^\d+$/.test(pin) || !validTime(time)) continue
    const status = Number(parts[2]); const verify = Number(parts[3])
    out.push({ pin, time, status: Number.isFinite(status) ? status : 0, verify: Number.isFinite(verify) ? verify : 0 })
  }
  return out
}

// The handshake answer. Realtime=1 and TransInterval=1 make the reader push each scan immediately; TimeZone (minutes
// from UTC) tells it which clock to keep; Date is our current local time.
function optionsReply({ host = 'server', tzMinutes = 420, now = '' } = {}) {
  return [
    `GET OPTION FROM: ${host}`, 'ATT2000Ver=1.2', 'Timeout=30', 'TransTimes=00:00;14:05', 'TransInterval=1',
    'TransFlag=TransData AttLog', 'Realtime=1', 'Encrypt=None', `TimeZone=${tzMinutes}`, `Date=${now}`, '',
  ].join('\r\n')
}

// Serial number from the query string (the reader names itself SN=...).
const serialOf = (url) => { try { return new URL(url, 'http://x').searchParams.get('SN') || '' } catch { return '' } }

// The last path segment: "cdata", "getrequest", "devicecmd"...
const actionOf = (pathname) => String(pathname || '').split('?')[0].split('/').filter(Boolean).pop() || ''

// "YYYY-MM-DD HH:MM:SS" as a Date in the process's local zone (the app pins that to Phnom Penh), the way the TCP reader
// path builds record times, so a pushed scan and a polled scan of the same moment are the same row.
function localDate(time) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(time)
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null
}

// Turn pushed lines into the record shape the TCP path produces, so one classifier (impossible years, midnight
// artifacts) and one save routine serve both.
function toRecords(lines) {
  const out = []
  for (const l of lines) { const d = localDate(l.time); if (d) out.push({ deviceUserId: l.pin, recordTime: d, verifyType: l.verify, state: l.status }) }
  return out
}

module.exports = { parseAttLog, optionsReply, serialOf, actionOf, localDate, toRecords }
