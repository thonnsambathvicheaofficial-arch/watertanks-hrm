# Song Fa HR

Attendance, roster, leave, payroll and Telegram scan notifications for Song Fa Water Tanks.
Scans come from the ZKTeco fingerprint readers (K40 and B3-C) over WAN port-forwarding. The readers are only ever
read from, never written to or cleared.

Next.js 14 (App Router) on Vercel, Supabase (Postgres) for data. Product and design notes: [PRODUCT.md](PRODUCT.md),
[DESIGN.md](DESIGN.md). Build history: [docs/REVAMP.md](docs/REVAMP.md).

## What is here

| Area | Where |
|---|---|
| Pages, server actions, API routes | `app/` |
| Shared UI | `components/` |
| Punch engine, device sync, stores, payroll, notifier | `lib/` (CommonJS, shared by pages and the sync) |
| Database changes, run by hand in order | `migrations/` (001 to 007) on top of `db/base-schema.sql` |
| Tests | `tests/` (`npm test`) |

## Run it locally

```bash
npm install
cp .env.example .env     # then fill it in
npm run dev              # http://localhost:3100
```

`npm test` runs the unit tests (payroll maths, permission coverage of every page and route, import, Telegram messages).

## Set up a new environment

1. **Supabase:** create a project. In the SQL editor run `db/base-schema.sql`, then `migrations/001` to `007` in order.
   Each is additive and safe to run twice. `migrations/cleanup_test_*.sql` are one-off helpers, not part of setup.
2. **Environment variables** (see `.env.example`): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SESSION_SECRET`, `CRON_SECRET`,
   `TELEGRAM_BOT_TOKEN`.
3. **First administrator:** `node scripts/create-admin.js "Username" "password"` (needs `.env`), then sign in and
   create the rest on Settings > Accounts.
4. **Devices:** Devices > Add device, with each reader's router address (public host and port).
5. **Scheduler:** call `GET /api/cron/pull` with the header `Authorization: Bearer <CRON_SECRET>` every few minutes.
   It reads each device, saves new scans and sends Telegram notifications.

## Deploy on Vercel

Import this repository as a new project (framework Next.js is detected). Add the environment variables above, then deploy.
`vercel.json` sets the sync route's 60-second limit. Pushing to `main` redeploys.

## Rules the code follows

- Devices are read-only. There is no wipe, clear or write command anywhere.
- Every database change is an additive migration run by a person.
- Every page, action and export is permission-checked (`lib/permissions.js`), and `tests/permissions.test.js` fails the build
  if a new one is not.
- Every change to staff, leave, payroll, accounts and settings is written to the append-only audit log.
