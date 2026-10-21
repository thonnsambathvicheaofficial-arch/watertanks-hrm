// The relay Worker's behaviour, with a fake fetch (no network).
let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }

;(async () => {
  const worker = (await import('../relay/cloudflare-worker.mjs')).default
  const env = { TARGET_URL: 'https://app.example', RELAY_SECRET: 's3cret' }
  const calls = []
  const realFetch = global.fetch
  let reply = () => new Response('OK: 1', { status: 200 })
  global.fetch = async (u, init) => { calls.push({ u: String(u), init }); return reply() }

  console.log('forwarding')
  let r = await worker.fetch(new Request('http://relay.example/iclock/cdata?SN=A1&table=ATTLOG&Stamp=5', { method: 'POST', body: '249\t2026-10-21 15:25:52\t0\t1', headers: { 'content-type': 'text/plain' } }), env)
  ok(r.status === 200 && (await r.text()) === 'OK: 1', 'a scan push is forwarded and the answer passed back')
  ok(calls[0].u === 'https://app.example/api/iclock/cdata?SN=A1&table=ATTLOG&Stamp=5', 'it goes to /api/iclock with the query intact')
  ok(calls[0].init.headers['x-relay-secret'] === 's3cret' && calls[0].init.body === '249\t2026-10-21 15:25:52\t0\t1' && calls[0].init.method === 'POST', 'it carries the secret, the body and the method')

  console.log('answering at the edge')
  calls.length = 0
  r = await worker.fetch(new Request('http://relay.example/iclock/getrequest?SN=A1'), env)
  ok(r.status === 200 && (await r.text()) === 'OK' && calls.length === 0, 'the heartbeat is answered here and costs the app nothing')

  console.log('refusing and failing safely')
  r = await worker.fetch(new Request('http://relay.example/other'), env)
  ok(r.status === 404 && calls.length === 0, 'anything outside /iclock/ is refused')
  r = await worker.fetch(new Request('http://relay.example/iclock/cdata?SN=A1'), {})
  ok(r.status === 500 && calls.length === 0, 'without its settings it says so and forwards nothing')
  reply = () => { throw new Error('network down') }
  r = await worker.fetch(new Request('http://relay.example/iclock/cdata?SN=A1', { method: 'POST', body: 'x' }), env)
  ok(r.status === 502, 'when the app is unreachable it answers 502, so the reader keeps its scans and retries')
  reply = () => new Response('ERROR: unknown device', { status: 404 })
  r = await worker.fetch(new Request('http://relay.example/iclock/cdata?SN=NEW', { method: 'POST', body: 'x' }), env)
  ok(r.status === 404, 'an error from the app is passed through unchanged, so the reader does not drop its scans')

  global.fetch = realFetch
  console.log(fails ? `\n${fails} FAILED` : '\nall passed')
  process.exit(fails ? 1 : 0)
})()
