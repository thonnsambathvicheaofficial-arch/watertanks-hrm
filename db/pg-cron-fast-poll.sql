-- ============================================================================
-- Scan notifications within seconds: Supabase pg_cron tickers for /api/cron/fast
-- ============================================================================
-- Run this whole file in the Supabase SQL editor (Dashboard > SQL Editor > New query), AFTER migration 008.
-- Nothing to paste or edit. Re-running it updates the jobs in place and keeps the existing secret.
--
-- The fast poll asks each reader "how many records do you hold?", reads only the newest scans if that grew, saves them
-- and sends the Telegram message (about 2 s from save to Telegram, with the site running in Tokyo next to the database).
--
-- Two jobs, Phnom Penh time:
--   songfa-fast-poll        every 5 s, Monday to Saturday, 06:00 to 18:59   (the working day: a scan is announced in
--                           about 5 to 7 s: up to 5 s waiting for the next tick, then read, save and send)
--   songfa-fast-poll-quiet  every 30 s, 05:00 to 19:59 at every other time (early and late hours, Sundays)
--
-- The password the call carries lives in the table public.cron_secrets (made here, with a random value). The job reads
-- it from there on every call, and the site reads the same row to check it, so no secret is copied into Vercel or into
-- this file and the two can never differ. The table is locked: only the database owner and the site's service key can read it.
--
-- Sized for the Vercel Hobby (free) plan. Hobby includes, per month: 1,000,000 function invocations, 4 hours of
-- Active CPU and 360 GB-hours of provisioned memory (vercel.com/docs/plans/hobby, checked 2026-10). Going over
-- pauses the whole project for up to 30 days, the sign-in pages included, so keep an eye on it:
--
--   busy job:   13 hours x 720 ticks x 26 days  = about 243,000 a month
--   quiet job:  about 13,000 a month             -> roughly 256,000 calls, 26% of the invocation allowance
--   CPU:        an idle tick measured about 20 ms of CPU locally; Vercel's own overhead is unknown. 256,000 x 20 ms is
--               1.4 hours; if overhead brings it to 50 ms it is 3.6 hours of the 4. The budget is about 9 minutes of
--               Active CPU per working day: after the first full day, check Vercel > Usage > Active CPU, and if the
--               day is above that, change '5 seconds' to '10 seconds' below and re-run this file.
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

-- The working day: every 5 seconds, Monday to Saturday, 06:00 to 18:59.
select cron.schedule(
  'songfa-fast-poll',
  '5 seconds',
  $$
  select net.http_get(
    url     := 'https://watertanks-hrm.vercel.app/api/cron/fast',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select value from public.cron_secrets where name = 'scheduler')),
    timeout_milliseconds := 25000
  )
  where extract(isodow from (now() at time zone 'Asia/Phnom_Penh')) between 1 and 6
    and extract(hour from (now() at time zone 'Asia/Phnom_Penh')) between 6 and 18;
  $$
);

-- Everything else inside 05:00 to 19:59 (the first and last hour, and Sundays): every 30 seconds.
select cron.schedule(
  'songfa-fast-poll-quiet',
  '30 seconds',
  $$
  select net.http_get(
    url     := 'https://watertanks-hrm.vercel.app/api/cron/fast',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select value from public.cron_secrets where name = 'scheduler')),
    timeout_milliseconds := 25000
  )
  where extract(hour from (now() at time zone 'Asia/Phnom_Penh')) between 5 and 19
    and not (extract(isodow from (now() at time zone 'Asia/Phnom_Penh')) between 1 and 6
             and extract(hour from (now() at time zone 'Asia/Phnom_Penh')) between 6 and 18);
  $$
);

-- Check: both jobs exist and the secret is set (shows only its length, never the value).
select j.jobid, j.jobname, j.schedule, j.active, (select length(value) from public.cron_secrets where name = 'scheduler') as secret_length
from cron.job j where j.jobname like 'songfa-fast-poll%' order by j.jobname;

-- ── To stop them ────────────────────────────────────────────────────────────
--   select cron.unschedule('songfa-fast-poll'); select cron.unschedule('songfa-fast-poll-quiet');
-- ── To see recent calls and their answers ───────────────────────────────────
--   select id, status_code, created, left(content::text, 200) from net._http_response order by id desc limit 10;
