// Reads every row of a query past PostgREST's 1,000-row cap, a few pages at a time.
//
// Pages are requested together instead of one after another: each request waits on a slow
// round trip to the database, so reading 3 pages used to cost 3 waits and now costs 1. If the
// first batch ends in a short page the table is exhausted and the extra requests were cheap
// empty ones. The caller's query must have a unique ordering (see feedback: unstable order
// silently drops and duplicates rows across pages); pages are concatenated in order.
const sb = require('./supabase')

const PAGE = 1000
const AHEAD = 5

async function selectAll(table, build) {
  const out = []
  for (let first = 0; ; first += PAGE * AHEAD) {
    const batch = await Promise.all(
      Array.from({ length: AHEAD }, (_, i) => build(sb.from(table)).range(first + i * PAGE, first + i * PAGE + PAGE - 1)),
    )
    for (const { data, error } of batch) {
      if (error) throw new Error(`${table}: ${error.message}`)
      out.push(...(data || []))
      if ((data || []).length < PAGE) return out
    }
  }
}

module.exports = selectAll
