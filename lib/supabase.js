// Single Supabase client for the whole app. Uses the SERVICE key: this file is only ever required server-side
// (pages, server actions, API routes), never bundled to a browser. RLS is enabled with no policies on every table,
// so only the service key (which bypasses RLS) can read or write anything.
//
// The client is created on first use, not on import, so a build that has no database settings (a new Vercel project
// before its environment variables are added) still compiles. Using the database without them fails with a clear message.
require('dotenv').config({ quiet: true })
const { createClient } = require('@supabase/supabase-js')

let client = null
function get() {
  if (client) return client
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY. Set them in .env (local) or the Vercel project\'s Environment Variables.')
  }
  client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
  return client
}

module.exports = new Proxy({}, {
  get(_t, prop) {
    const c = get()
    const v = c[prop]
    return typeof v === 'function' ? v.bind(c) : v
  },
})
