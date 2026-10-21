// Relay between the fingerprint readers and the app (Cloudflare Worker, free plan).
//
// A reader's push client speaks plain HTTP and cannot follow Vercel's redirect to HTTPS, so it talks to this Worker.
// The Worker forwards the request to the app over HTTPS and adds the secret header the app checks, so only this relay
// can reach the receiver (app/api/iclock). It also answers the reader's once-a-minute "anything for me?" heartbeat itself,
// because forwarding those would cost a server call per reader per minute for nothing.
//
// Settings (Cloudflare dashboard > this Worker > Settings > Variables and Secrets):
//   TARGET_URL    the app, e.g. https://watertanks-hrm.vercel.app
//   RELAY_SECRET  the secret in relay/RELAY_SECRET.txt (the same value the app holds in cron_secrets as 'relay')

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/iclock/')) return new Response('Not found', { status: 404 })
    if (!env.TARGET_URL || !env.RELAY_SECRET) return new Response('ERROR: relay is not configured', { status: 500 })

    // The heartbeat is answered here, at the edge.
    if (request.method === 'GET' && url.pathname === '/iclock/getrequest') {
      return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain' } })
    }

    const target = new URL('/api' + url.pathname + url.search, env.TARGET_URL)
    const init = {
      method: request.method,
      headers: { 'x-relay-secret': env.RELAY_SECRET, 'content-type': request.headers.get('content-type') || 'text/plain' },
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.text()
    try {
      const upstream = await fetch(target.toString(), init)
      // The reader reads the status and the first line ("OK: 3"); anything else is passed through as plain text.
      return new Response(await upstream.text(), { status: upstream.status, headers: { 'Content-Type': 'text/plain' } })
    } catch {
      // A 5xx makes the reader keep its scans and retry, so nothing is lost while the app is unreachable.
      return new Response('ERROR: relay could not reach the server', { status: 502 })
    }
  },
}
