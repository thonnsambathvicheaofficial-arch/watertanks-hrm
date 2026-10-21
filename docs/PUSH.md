# Scans in seconds: readers push, nothing polls

A reader that has a server address set sends each scan to it the moment it happens. The path is:

```
reader (plain HTTP)  ->  relay (Cloudflare Worker, free)  ->  app (/api/iclock, Vercel Tokyo)  ->  Telegram
      ~1 s                       ~0.1 s                          save + announce ~2 s
```

Expect about 3 to 5 seconds from scan to Telegram message. A reader keeps and re-sends any scan the app has not
answered "OK" to, so a failure never loses a scan. The polling ticker stays on as a backup and fills any gap.

Both Song Fa readers report a push setting (`ICLOCKSVRURL`, currently `0.0.0.0`, meaning unset): K40 serial
`A8N5211760100`, B3-C serial `CEZF212160528`. Both serials are already registered in the `devices` table.

## 1. Create the relay (once, about 5 minutes)

1. dash.cloudflare.com > Workers & Pages > Create > Create Worker. Name it `watertanks-relay`, then Deploy.
2. Edit code: replace everything with the contents of `relay/cloudflare-worker.mjs`, then Deploy.
3. Settings > Variables and Secrets, add:
   - `TARGET_URL` (Text) = `https://watertanks-hrm.vercel.app`
   - `RELAY_SECRET` (Secret) = the one line in `relay/RELAY_SECRET.txt` (this file is not in git)
4. Note the Worker's address, like `watertanks-relay.<your-account>.workers.dev`.
5. Check that it answers over plain HTTP (readers cannot use HTTPS):
   ```
   curl.exe -i http://watertanks-relay.<your-account>.workers.dev/iclock/getrequest?SN=test
   ```
   You want `HTTP/1.1 200 OK` and a body of `OK`. If it answers with a redirect (301 or 308) to https, plain
   HTTP is blocked on that address and a custom domain on Cloudflare is needed instead.

## 2. Point each reader at the relay

On the reader's own menu (names vary slightly by firmware): Menu > Comm. > Cloud Server Setting (also called ADMS):
- Server Address: the Worker host name, without `http://` (for example `watertanks-relay.<account>.workers.dev`)
- Server Port: `80`
- HTTPS / Enable Proxy: off

Save. Within a minute the reader asks the relay for its options and the app answers `Realtime=1`, which makes it push
every scan immediately.

## 3. Check it

1. Scan once. The Telegram message should arrive in a few seconds.
2. The Live page's Readers panel shows the reader as just checked.
3. If nothing arrives: in the reader's Cloud Server screen look for a connected / error status; confirm step 1.5 returns
   `OK`; and ask Claude to run the latency watcher.

## Turning it off

Set the reader's Server Address back to empty (or `0.0.0.0`). Polling carries on exactly as before.

## Notes

- The receiver refuses any request without the relay's secret header, and refuses scans from a serial that is not in
  the `devices` table (it answers 404, so the reader keeps the scans until the device is registered).
- Pushed scans are stored with `source = 'push'` and go through the same checks as polled scans (impossible dates and
  B3-C's midnight artifacts are held aside).
- The same scan arriving by push and by the poll is saved once: scans are unique per PIN and time.
