-- ============================================================================
-- Scan notifications within seconds: a Supabase pg_cron ticker for /api/cron/fast
-- ============================================================================
-- Run this whole file once in the Supabase SQL editor (Dashboard > SQL Editor > New query), AFTER migration 008.
-- Nothing to paste or edit.
--
-- Every 20 seconds during working hours it calls the site's fast poll, which asks each device "how many records
-- do you hold?", reads only the newest scans if that grew, saves them and sends the Telegram notification.
-- A scan is announced about 5 to 25 seconds after it happens (20 s tick, plus about 5 s to read, save and send).
--
-- The password the call carries lives in the table public.cron_secrets (made here, with a random value). The job reads
-- it from there on every call, and the site reads the same row to check it, so no secret is copied into Vercel or into
-- this file and the two can never differ. Re-running this file keeps the existing secret and updates the job in place.
-- The table is locked: only the database owner and the site's service key can read it.
--
-- Hours are Phnom Penh time: 05:00 to 19:59, every day.
--
-- Sized for the Vercel Hobby (free) plan. Hobby includes, per month: 1,000,000 function invocations, 4 hours of
-- Active CPU and 360 GB-hours of provisioned memory (vercel.com/docs/plans/hobby, checked 2026-10). Going over
-- pauses the whole project for up to 30 days, the sign-in pages included, so this stays well inside the limits:
--
--   ticks:      3 per minute x 60 x 15 hours x 30 days  = about 81,000 a month   (8% of the invocation allowance)
--   CPU:        an idle check measured at about 22 ms of CPU here; allow 100 ms on Vercel
--               = 81,000 x 0.1 s = about 2.3 hours of the 4 hours, in the worst case. The 5-minute full sync
--               uses a little more. If Vercel's Usage page shows Active CPU running above half of the allowance
--               by mid-month, make the interval '30 seconds' or narrow the hours below.
--
-- To use fewer calls: change '20 seconds' to '30 seconds', or the hour range (between 5 and 19) to e.g. 6 and 18.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The shared secret. Created once with a random value; never overwritten.
create table if not exists public.cron_secrets (
  name       text primary key,
  value      text not null,
  created_at timestamptz not null default now()
);
alter table public.cron_secrets enable row level security;     -- no policies: the public API keys see nothing
revoke all on public.cron_secrets from anon, authenticated;
insert into public.cron_secrets (name, value)
values ('scheduler', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;

select cron.schedule(
  'songfa-fast-poll',
  '20 seconds',
  $$
  select net.http_get(
    url     := 'https://watertanks-hrm.vercel.app/api/cron/fast',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select value from public.cron_secrets where name = 'scheduler')),
    timeout_milliseconds := 25000
  )
  where extract(hour from (now() at time zone 'Asia/Phnom_Penh')) between 5 and 19;
  $$
);

-- Check: the job exists and the secret is set (shows only its length, never the value).
select j.jobid, j.jobname, j.schedule, j.active, (select length(value) from public.cron_secrets where name = 'scheduler') as secret_length
from cron.job j where j.jobname = 'songfa-fast-poll';

-- ── To stop it ──────────────────────────────────────────────────────────────
--   select cron.unschedule('songfa-fast-poll');
-- ── To see recent calls and their answers ───────────────────────────────────
--   select id, status_code, created, left(content::text, 200) from net._http_response order by id desc limit 10;
