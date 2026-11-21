// Which scans belong on one day's page. A night worker's evening IN and the OUT after midnight are ONE shift, filed under the
// evening (attendance.js), so the scans of a day are the scans of the SHIFT that starts on it, not the ones stamped with its
// calendar date. Listing by calendar date put a 00:02 OUT that closed Thursday's shift under Friday, right above Friday's own
// 16:08 IN, while the status line said "no out scan" (PIN 391, 19-20 Nov 2026).
//
//   punches : raw scans around the day (a margin of at least a day each side), each { time: 'YYYY-MM-DD HH:MM:SS', ... }
//   rows    : the computed daily rows for the day before, the day and the day after (rows carry `allTimes`, every scan of the shift)
//   date    : 'YYYY-MM-DD'
//
// Returns { mine, elsewhere }:
//   mine      the scans of this day's shift (with any duplicate scans between its first and last), plus any scan stamped with this
//             date that belongs to no neighbouring shift. Each carries `onDate` (false = stamped with another date, e.g. the
//             dawn OUT, so the page can say "next day").
//   elsewhere scans stamped with this date that close or open a NEIGHBOURING day's shift, each with `belongsTo` (that date)
const span = row => {
  const t = row && row.allTimes && row.allTimes.length ? [...row.allTimes].sort() : null
  return t ? { from: t[0], to: t[t.length - 1] } : null
}
const inside = (time, w) => !!w && time >= w.from && time <= w.to

function dayScans(punches, rows, date) {
  const dayOf = d => { const x = new Date(date + 'T00:00:00'); x.setDate(x.getDate() + d); const p = n => String(n).padStart(2, '0'); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}` }
  const prev = dayOf(-1), next = dayOf(1)
  const wMine = span(rows.find(r => r.date === date)), wPrev = span(rows.find(r => r.date === prev)), wNext = span(rows.find(r => r.date === next))
  const mine = [], elsewhere = []
  for (const p of [...punches].sort((a, b) => (a.time < b.time ? -1 : 1))) {
    const onDate = p.time.slice(0, 10) === date
    if (inside(p.time, wMine)) mine.push({ ...p, onDate })
    else if (onDate && inside(p.time, wPrev)) elsewhere.push({ ...p, belongsTo: prev })
    else if (onDate && inside(p.time, wNext)) elsewhere.push({ ...p, belongsTo: next })
    else if (onDate) mine.push({ ...p, onDate })   // a scan no shift claims is never hidden
  }
  return { mine, elsewhere }
}

module.exports = { dayScans }
