// Tests the decisions of the fast poll and the sorting of device records, without a device or a database.
// (lib/zkfast.js and lib/zkpull.js read the database settings only when they are used, so requiring them is safe here.)
const { plan, MAX_TAIL, MARGIN } = require('../lib/zkfast.js')
const { classifyRecords } = require('../lib/zkpull.js')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }

console.log('what a fast check does with the record count')
ok(plan(2027, null).action === 'baseline', 'the first look only remembers the count; it reads nothing and announces nothing')
ok(plan(2027, 2027).action === 'idle', 'an unchanged count means nothing is new (the cheap, common case)')
let p = plan(2030, 2027)
ok(p.action === 'read' && p.count === 3 + MARGIN, `three more records: read those three plus a margin of ${MARGIN}`)
ok(plan(2028, 2027).count === 1 + MARGIN, 'one new scan reads only a handful of records')
ok(plan(2027 + MAX_TAIL, 2027).action === 'read' && plan(2027 + MAX_TAIL + 1, 2027).action === 'baseline', `up to ${MAX_TAIL} new records are read here; a bigger jump is left to the full sync`)
p = plan(1500, 2027)
ok(p.action === 'baseline' && /cleared|reset/.test(p.why), 'a count that went DOWN (device cleared or reset) resets the baseline instead of reading')
ok(plan(undefined, 5).action === 'skip' && plan(null, 5).action === 'skip', 'a device that does not report its count is skipped')

console.log('sorting records like the full sync')
const dev = { id: 'dev-1', name: 'K40', serial: 'S1' }
const b3c = { id: '705f0b5d-a00c-4137-bfa7-bae3ef024e49', name: 'B3-C', serial: null }
const rec = (pin, d, extra = {}) => ({ deviceUserId: String(pin), recordTime: d, verifyType: 1, state: 0, ...extra })
const day = new Date(2026, 9, 21, 7, 55, 2)
let r = classifyRecords(dev, [rec(428, day)])
ok(r.rows.length === 1 && r.rows[0].pin === '428' && r.rows[0].ts === '2026-10-21 07:55:02' && r.rows[0].device_id === 'dev-1' && r.rows[0].source === 'fast', 'a normal scan keeps its wall-clock time, device and PIN, and is marked as a fast-path scan')
r = classifyRecords(dev, [rec(3, new Date('1999-12-31T17:00:00Z')), rec(5, new Date('2111-09-16T13:18:08Z'))])
ok(r.rows.length === 0 && r.badRows.length === 2 && r.badRows.every(x => x.reason === 'out_of_range_timestamp'), 'a record with an impossible time (year 1999 or 2111) is quarantined, never saved as a scan')
r = classifyRecords(b3c, [rec(7, new Date(2026, 9, 21, 0, 1, 10))])
ok(r.rows.length === 0 && r.badRows[0].reason === 'midnight_artifact', "B3-C's recurring phantom scans just after midnight are quarantined")
r = classifyRecords(dev, [rec(7, new Date(2026, 9, 21, 0, 1, 10))])
ok(r.rows.length === 1, 'the same time on another device is a real scan (a night shift can start at midnight)')
r = classifyRecords(dev, [rec(1, new Date('not a date')), rec(2, day)])
ok(r.rows.length === 1 && r.rows[0].pin === '2', 'an unreadable record is dropped without breaking the rest')

console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
