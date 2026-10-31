// The push protocol helpers (no reader, no database).
process.env.TZ = 'Asia/Phnom_Penh'
const { parseAttLog, optionsReply, serialOf, actionOf, localDate, toRecords } = require('../lib/iclock.js')
const { classifyRecords } = require('../lib/zkpull.js')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }

console.log('reading pushed scans')
let r = parseAttLog('249\t2026-10-21 15:25:52\t0\t1\t0\t0\t0\r\n')
ok(r.length === 1 && r[0].pin === '249' && r[0].time === '2026-10-21 15:25:52' && r[0].status === 0 && r[0].verify === 1, 'a standard line: PIN, time, status, verify')
r = parseAttLog('ATTLOG\t75\t2026-10-21 07:54:34\t0\t15\n')
ok(r.length === 1 && r[0].pin === '75' && r[0].verify === 15, 'the variant with an ATTLOG prefix')
r = parseAttLog('1\t2026-10-21 07:00:01\t0\t1\r\n2\t2026-10-21 07:00:09\t0\t1\r\n\r\n3\t2026-10-21 07:00:20\t0\t1')
ok(r.map(x => x.pin).join() === '1,2,3', 'several lines, blank lines skipped, with or without a final newline')
r = parseAttLog('OPLOG 3\t0\t2026-10-21 08:00:00\t0\t0\r\nUSER PIN=5\tName=Bo\r\n\tbad\r\nabc\t2026-10-21 08:00:00\r\n7\tnot a time\r\n8\t2026-13-45 99:99:99')
ok(r.length === 0, 'operation-log rows, junk and bad dates are ignored, never guessed at')
ok(parseAttLog('').length === 0 && parseAttLog(null).length === 0 && parseAttLog(undefined).length === 0, 'an empty body is fine')
r = parseAttLog('9\t2026-10-21 08:00:00')
ok(r.length === 1 && r[0].status === 0 && r[0].verify === 0, 'missing status and verify default to 0')

console.log('the handshake answer')
const o = optionsReply({ host: 'relay.example', tzMinutes: 420, now: '2026-10-21 15:30:00' })
ok(/Realtime=1/.test(o) && /TransInterval=1/.test(o), 'it tells the reader to push each scan immediately')
ok(/TimeZone=420/.test(o) && /Date=2026-10-21 15:30:00/.test(o) && /GET OPTION FROM: relay\.example/.test(o), 'it carries the time zone, the current time and who answered')
ok(o.split('\r\n').every(l => !/\n/.test(l)) && o.endsWith('\r\n'), 'lines are CRLF separated and the reply ends with a line break')

console.log('addressing')
ok(serialOf('/iclock/cdata?SN=A8N5211760100&options=all') === 'A8N5211760100' && serialOf('/iclock/cdata') === '' && serialOf('garbage??') === '', 'the serial comes from the query string')
ok(actionOf('/api/iclock/cdata') === 'cdata' && actionOf('/iclock/getrequest') === 'getrequest' && actionOf('/iclock/cdata?SN=1') === 'cdata' && actionOf('') === '', 'the action is the last path segment')

console.log('sharing the classifier with the TCP path')
const d = localDate('2026-10-21 15:25:52')
ok(d && d.getFullYear() === 2026 && d.getHours() === 15 && d.getMinutes() === 25 && localDate('nope') === null, 'a pushed time becomes a local Date')
const dev = { id: 'dev-1', name: 'K40', serial: 'S1' }
const rows = classifyRecords(dev, toRecords(parseAttLog('249\t2026-10-21 15:25:52\t0\t1')))
ok(rows.rows.length === 1 && rows.rows[0].pin === '249' && rows.rows[0].ts === '2026-10-21 15:25:52' && rows.rows[0].device_id === 'dev-1', 'it saves as the same row the polling path would')
const bad = classifyRecords(dev, toRecords(parseAttLog('3\t1999-12-31 17:00:00\t0\t1')))
ok(bad.rows.length === 0 && bad.badRows.length === 1, 'an impossible timestamp is quarantined, as on the polling path')
const b3c = { id: '705f0b5d-a00c-4137-bfa7-bae3ef024e49', name: 'B3-C' }
ok(classifyRecords(b3c, toRecords(parseAttLog('7\t2026-10-21 00:01:10\t0\t1'))).rows.length === 0, "B3-C's phantom scans just after midnight are quarantined here too")
ok(classifyRecords(b3c, toRecords(parseAttLog('7\t2026-10-21 00:01:10\t0\t1')), new Set(['7'])).rows.length === 1, "night shift pin is exempt from midnight quarantine")

console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
