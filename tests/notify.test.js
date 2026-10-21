// Tests the parts of the Telegram notifier that decide and format, without a database or Telegram.
const N = require('../lib/notify.js')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }

const people = new Map([
  ['1', { pin: '1', name: 'Chay Cheng', nameKh: 'ចាយ ចេង', group: 'worker', departmentId: 'd1' }],
  ['2', { pin: '2', name: 'Sok <Dara> & Co', nameKh: '', group: 'office', departmentId: 'd2' }],
  ['3', { pin: '3', name: 'No Dept', nameKh: '', group: '', departmentId: '' }],
])
const deptNames = new Map([['d1', 'Delivery'], ['d2', 'HR & Admin']])
const base = { scope_group: 'all', department_ids: [], ignore_repeat_seconds: 120, max_age_minutes: 30, digest_threshold: 12 }
const NOW = '2026-10-20 07:55:30'
const P = (id, pin, ts) => ({ id, pin, ts })
const go = (punches, over = {}, lastSent) => N.decide(punches, { people, deptNames, settings: { ...base, ...over }, now: NOW, lastSent })

console.log('formatting')
const one = N.formatOne('2026-10-20 07:55:02', people.get('1'), 'Delivery', 'in')
ok(one === ['🕗 <b>7:55 AM</b> · 🟢 <b>Punch in</b>', '<b>Chay Cheng</b>', '<i>Delivery · Worker · 20 Oct 2026</i>'].join('\n'), 'one scan: clock, time, punch in remark, name, Khmer name, department, group, date\n' + one)
ok(N.formatOne('2026-10-20 13:05:00', people.get('2'), 'HR & Admin').includes('&lt;Dara&gt; &amp; Co') && N.formatOne('2026-10-20 13:05:00', people.get('2'), 'HR & Admin').includes('HR &amp; Admin · Office staff'), 'names and departments are escaped for Telegram HTML')
const noDir = N.formatOne('2026-10-20 00:03:00', people.get('3'), '')
ok(noDir.includes('12:03 AM') && noDir.includes('<i>No department · 20 Oct 2026</i>') && !noDir.includes('Punch'), 'a person with no department or group, and a scan whose direction is unknown, still reads cleanly; midnight is 12:03 AM')
ok(N.formatOne('2026-10-20 17:05:00', people.get('1'), 'Delivery', 'out').includes('🔴 <b>Punch out</b>') && N.formatOne('2026-10-20 07:56:00', people.get('1'), 'Delivery', 'repeat').includes('⚪ <b>Repeat scan</b>'), 'punch out and repeat scan remarks')
ok(N.clockFor('2026-10-20 04:24:00') === '🕟' && N.clockFor('2026-10-20 04:10:00') === '🕓' && N.clockFor('2026-10-20 04:50:00') === '🕔' && N.clockFor('2026-10-20 12:05:00') === '🕛' && N.clockFor('2026-10-20 00:40:00') === '🕧' && N.clockFor('2026-10-20 23:50:00') === '🕛', 'the clock face shows the nearest half hour (4:24 shows half past four, 23:50 shows twelve)')
ok(N.timeLabel('2026-10-20 12:00:00') === '12:00 PM' && N.timeLabel('2026-10-20 23:59:00') === '11:59 PM', 'noon and 11:59 PM')

console.log('who is announced')
let d = go([P('a', '1', '2026-10-20 07:55:02')])
ok(d.send.length === 1 && d.send[0].deptName === 'Delivery', 'a fresh scan is announced')
d = go([P('a', '1', '2026-10-20 07:10:00')])
ok(d.skip.length === 1 && d.skip[0].reason === 'too old to announce', 'a scan older than the limit is never announced (history stays silent)')
d = go([P('a', '1', '2026-10-20 07:10:00')], { max_age_minutes: 60 })
ok(d.send.length === 1, 'the limit is a setting')
d = go([P('a', '1', '2026-10-20 09:00:00')])
ok(d.skip[0].reason === 'time is in the future', 'a scan stamped in the future (a wrong device clock) is not announced')
d = go([P('a', '99', '2026-10-20 07:55:00')])
ok(d.skip[0].reason === 'not on the staff list', 'a PIN that is not on the staff list is not announced')
d = go([P('a', '1', '2026-10-20 07:55:00'), P('b', '2', '2026-10-20 07:55:01')], { scope_group: 'office' })
ok(d.send.length === 1 && d.send[0].punch.pin === '2' && d.skip[0].reason === 'outside the chosen group', 'office-only announces office staff only')
d = go([P('a', '1', '2026-10-20 07:55:00'), P('b', '2', '2026-10-20 07:55:01')], { department_ids: ['d1'] })
ok(d.send.length === 1 && d.send[0].punch.pin === '1' && d.skip[0].reason === 'outside the chosen departments', 'a department filter announces only that department')
d = go([P('a', '1', '2026-10-20 07:54:00'), P('b', '1', '2026-10-20 07:54:40'), P('c', '1', '2026-10-20 07:56:10')])
ok(d.send.length === 2 && d.skip.length === 1 && d.skip[0].punch.id === 'b' && d.skip[0].reason === 'repeat scan', 'a repeat scan within 2 minutes is ignored, the next real one is not (2 of 3 announced)')
d = go([P('a', '1', '2026-10-20 07:55:00')], {}, new Map([['1', '2026-10-20 07:54:30']]))
ok(d.skip[0].reason === 'repeat scan', 'a scan right after one announced in an earlier run is also a repeat')
d = go([P('a', '1', '2026-10-20 07:54:00'), P('b', '1', '2026-10-20 07:54:40')], { ignore_repeat_seconds: 0 })
ok(d.send.length === 2, 'repeat suppression can be switched off')

console.log('punch in and out')
const L = (t) => N.labelScans(t.map(x => '2026-10-20 ' + x))
ok(L(['07:00:00']).join() === 'in', 'the first scan of the day is a punch in')
ok(L(['07:00:00', '17:05:00']).join() === 'in,out', 'in the morning, out in the evening')
ok(L(['05:03:00', '05:08:00', '17:06:00']).join() === 'in,repeat,out', 'a second scan 5 minutes after punching in is a repeat, not a punch out')
ok(L(['06:54:00', '17:17:00', '17:37:00']).join() === 'in,out,repeat', 'a scan 20 minutes after punching out is a repeat')
ok(L(['07:00:00', '12:00:00', '13:00:00', '17:00:00']).join() === 'in,out,in,out', 'a lunch break scanned out and back in reads out then in')
ok(L(['07:00:00', '17:00:00', '19:00:00']).join() === 'in,out,in', 'coming back for overtime two hours later is a new punch in')
ok(N.labelScans(['2026-10-20 19:00:00', '2026-10-21 04:00:00']).join() === 'in,out', 'a night shift (19:00 in, 04:00 next morning out) is in then out')
ok(N.labelScans(['2026-10-19 07:00:00', '2026-10-20 07:00:00']).join() === 'in,in', 'a forgotten punch-out: 24 hours later the next scan is a punch in, not an out')
ok(L(['07:00:00', '07:30:00']).join() === 'in,out', 'a scan exactly 30 minutes later counts as a punch out')

console.log('late minutes')
ok(N.lateLabel(2) === 'Late 2 min' && N.lateLabel(59) === 'Late 59 min' && N.lateLabel(60) === 'Late 1 h 00 min' && N.lateLabel(65) === 'Late 1 h 05 min' && N.lateLabel(0) === '', 'late wording: minutes under an hour, hours and minutes from an hour, nothing when on time')
const lateMsg = N.formatOne('2026-10-20 08:07:10', people.get('1'), 'Delivery', 'in', 2)
const firstLine = lateMsg.split('\n')[0]
ok(firstLine === '🕗 <b>8:07 AM</b> · 🟢 <b>Punch in</b> · 🟠 <b>Late 2 min</b>', 'a late punch in carries the late minutes on the first line: ' + firstLine)
ok(!N.formatOne('2026-10-20 07:50:00', people.get('1'), 'Delivery', 'in', 0).includes('Late') && !N.formatOne('2026-10-20 07:50:00', people.get('1'), 'Delivery', 'in').includes('Late'), 'an on-time punch in has no late remark')
ok(!N.formatOne('2026-10-20 17:20:00', people.get('1'), 'Delivery', 'out', 12).includes('Late') && !N.formatOne('2026-10-20 08:10:00', people.get('1'), 'Delivery', 'repeat', 12).includes('Late'), 'a punch out or a repeat scan never shows late')
const dl = N.formatDigests([{ ts: '2026-10-20 08:07:00', person: people.get('1'), deptName: 'Delivery', direction: 'in', lateMin: 7 }, { ts: '2026-10-20 07:50:00', person: people.get('2'), deptName: 'HR & Admin', direction: 'in', lateMin: 0 }])[0]
ok(dl.includes('8:07 AM Punch in · Chay Cheng') && dl.includes('🟠 Late 7 min') && dl.split('\n').filter(l => l.includes('Late')).length === 1, 'digest lines carry the late minutes only for late punch ins')

console.log('leave')
const rowOf = (o) => ({ status: 'leave', ...o })
const AM = rowOf({ leaveDays: 0.5, leaveParts: [{ period: 'morning', typeName: 'Annual leave', code: 'AL' }] })
const PM = rowOf({ leaveDays: 0.5, leaveParts: [{ period: 'afternoon', typeName: 'Annual leave', code: 'AL' }] })
const FULL = rowOf({ leaveDays: 1, leaveParts: [{ period: null, typeName: 'Sick leave', code: 'SL' }] })
const TWO = rowOf({ leaveDays: 1, leaveParts: [{ period: 'morning', typeName: 'Annual leave' }, { period: 'afternoon', typeName: 'Unpaid leave' }] })
ok(JSON.stringify(N.leaveContext(AM, 'in')) === '{"tag":"back","type":"Annual leave"}', 'morning half-day: the first scan is "back from morning leave"')
ok(N.leaveContext(AM, 'out') === null && N.leaveContext(AM, 'repeat') === null, 'morning half-day: a later punch out or repeat scan carries no leave remark')
ok(JSON.stringify(N.leaveContext(PM, 'out')) === '{"tag":"afternoon","type":"Annual leave"}' && N.leaveContext(PM, 'in') === null, 'afternoon half-day: the punch out is "afternoon leave"; the morning punch in is normal')
ok(N.leaveContext(FULL, 'in').tag === 'full' && N.leaveContext(FULL, 'out').tag === 'full' && N.leaveContext(TWO, 'in').tag === 'full', 'full-day leave (or two halves) flags any scan; the types are joined')
ok(N.leaveContext(rowOf({}), 'in').tag === 'full' && N.leaveContext({ status: 'late' }, 'in') === null && N.leaveContext(null, 'in') === null, 'a manual roster leave day covers the day; a normal or missing row has no leave')
const back = N.formatOne('2026-10-20 12:05:00', people.get('2'), 'HR & Admin', 'in', 245, { tag: 'back', type: 'Annual leave' }).split('\n')
ok(back[0] === '🕛 <b>12:05 PM</b> · 🟢 <b>Punch in</b> · 🟣 <b>Back from morning leave</b>' && !back[0].includes('Late') && back[2] === '<i>HR &amp; Admin · Office staff · 20 Oct 2026 · Annual leave</i>', 'a morning-leave return shows the leave and the type, never a late remark even if the engine said late')
ok(N.formatOne('2026-10-20 11:58:00', people.get('1'), 'Delivery', 'out', 0, { tag: 'afternoon', type: 'Annual leave' }).split('\n')[0] === '🕛 <b>11:58 AM</b> · 🔴 <b>Punch out</b> · 🟣 <b>Afternoon leave</b>', 'an afternoon-leave punch out')
ok(N.formatOne('2026-10-20 07:58:00', people.get('1'), 'Delivery', 'in', 0, { tag: 'full', type: 'Sick leave' }).split('\n')[0].endsWith('⚠️ <b>On approved leave today</b>'), 'a scan on full-day leave is flagged for HR')
const dig = N.formatLeaveDigest('2026-10-20', [
  { name: 'Bunh Pech', deptName: 'Delivery', type: 'Annual leave', bucket: 'full' }, { name: 'Ath Sreysor', deptName: 'HR & Admin', type: 'Sick leave', bucket: 'full' },
  { name: 'Chhorn Rotha', deptName: 'Sale', type: 'Annual leave', bucket: 'morning' }, { name: 'Chan Vy', deptName: '', type: '', bucket: 'afternoon' }])
const dl2 = dig[0].split('\n')
ok(dig.length === 1 && dl2[0] === '🟣 <b>On leave today</b> · Tue 20 Oct 2026' && dl2[1] === '<b>Full day (2)</b>' && dl2[2] === 'Ath Sreysor · HR &amp; Admin · Sick leave' && dl2[3].startsWith('Bunh Pech') && dl2.includes('<b>Morning (1)</b>') && dl2.includes('<b>Afternoon (1)</b>') && dl2[dl2.length - 1] === 'Chan Vy · No department', 'the daily list: date, then full day, morning and afternoon sections, names sorted, escaped')
const manyLeave = Array.from({ length: 300 }, (_, i) => ({ name: 'Staff member number ' + i, deptName: 'Delivery', type: 'Annual leave', bucket: 'full' }))
const parts2 = N.formatLeaveDigest('2026-10-20', manyLeave)
ok(parts2.length > 1 && parts2.every(t => t.length <= 4096) && parts2.join('\n').split('\n').filter(l => l.startsWith('Staff member')).length === 300, 'a very long leave list splits under the Telegram limit without losing anyone')

console.log('digests')
const many = Array.from({ length: 30 }, (_, i) => ({ ts: `2026-10-20 07:${String(30 + (i % 25)).padStart(2, '0')}:00`, person: people.get('1'), deptName: 'Delivery' }))
const texts = N.formatDigests(many)
ok(texts.length === 1 && texts[0].startsWith('<b>30 scans · 20 Oct 2026</b>') && texts[0].split('\n').length === 31, 'thirty waiting scans become one digest with a heading and a line each')
const huge = Array.from({ length: 400 }, (_, i) => ({ ts: '2026-10-20 07:55:00', person: { ...people.get('1'), name: 'A very long staff member name ' + i }, deptName: 'Delivery' }))
const parts = N.formatDigests(huge)
ok(parts.length > 1 && parts.every(t => t.length <= 4096), `a huge backlog is split under Telegram's 4096-character limit (${parts.length} messages)`)
ok(parts.join('\n').split('\n').filter(l => l.includes('AM')).length === 400, 'and no scan is lost in the split')

console.log('time')
ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(N.nowPP()), 'the Phnom Penh clock is formatted as a timestamp')
ok(N.nowPP(new Date('2026-10-20T00:30:00Z')) === '2026-10-20 07:30:00', 'UTC 00:30 is 07:30 in Phnom Penh')
ok(N.nowPP(new Date('2026-10-20T17:30:00Z')) === '2026-10-21 00:30:00', 'the date rolls over at Phnom Penh midnight, not UTC midnight')

console.log('in or out follows the report engine, so one missing scan cannot flip the labels')
const dayRow = (pin, date, o) => [pin + '|' + date, { pin, date, in: null, out: null, outNextDay: false, ...o }]
const eng = new Map([
  dayRow('215', '2026-10-19', { in: '04:38' }),                  // no evening scan that day
  dayRow('215', '2026-10-20', { out: '17:03' }),                 // no morning scan that day
  dayRow('215', '2026-10-21', { in: '06:52', out: '17:03' }),
  dayRow('9', '2026-10-20', { in: '19:00', out: '06:00', outNextDay: true }),   // night shift
])
ok(N.engineDirection('215', '2026-10-21 17:03:11', eng) === 'out', 'the 17:03 scan is a punch OUT (it was announced as "Punch in" after two earlier days were each missing a scan)')
ok(N.engineDirection('215', '2026-10-21 06:52:00', eng) === 'in', 'the morning scan is a punch in')
ok(N.engineDirection('215', '2026-10-20 17:03:11', eng) === 'out', 'a lone afternoon scan is a departure, as the reports treat it')
ok(N.engineDirection('215', '2026-10-19 04:38:54', eng) === 'in', 'a day with only an arrival scan still reads in')
ok(N.engineDirection('9', '2026-10-20 19:00:30', eng) === 'in' && N.engineDirection('9', '2026-10-21 06:00:12', eng) === 'out', 'a night shift: in this evening, out next morning')
ok(N.engineDirection('215', '2026-10-21 12:30:00', eng) === null && N.engineDirection('777', '2026-10-21 06:52:00', eng) === null && N.engineDirection('215', '2026-10-21 06:52:00', null) === null, 'a scan the engine does not single out, an unknown person, or no engine rows give null (the caller falls back to ordering)')

console.log('retrying scans a run did not finish')
const nowMs = Date.parse('2026-10-21T10:05:00Z')
const rowAt = (status, secsAgo) => ({ status, created_at: new Date(nowMs - secsAgo * 1000).toISOString() })
ok(N.PENDING_RETRY_MS === 25000, 'a claimed scan is retried after 25 seconds, not a minute and a half')
ok(!N.needsRetry(rowAt('pending', 5), nowMs) && !N.needsRetry(rowAt('pending', 20), nowMs), 'a scan another run is still sending is left alone (no double message)')
ok(N.needsRetry(rowAt('pending', 30), nowMs) && N.needsRetry(rowAt('pending', 96), nowMs), 'a scan left pending past that is picked up by the next run')
ok(N.needsRetry(rowAt('failed', 1), nowMs), 'a failed send is retried straight away')
ok(!N.needsRetry(rowAt('sent', 600), nowMs) && !N.needsRetry(rowAt('skipped', 600), nowMs), 'sent and skipped scans are never retried')

console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
