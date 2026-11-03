-- ============================================================================
-- Scan notifications within seconds: Supabase pg_cron tickers for /api/cron/fast
-- ============================================================================
-- Run this whole file in the Supabase SQL editor (Dashboard > SQL Editor > New query), AFTER migration 008.
-- Nothing to paste or edit. Re-running it updates the jobs in place and keeps the existing secret.
--
-- The fast poll asks each reader "how many records do you hold?", reads only the newest scans if that grew, saves them
-- and sends the Telegram message (about 2 s from save to Telegram, with the site running in Tokyo next to the database).
--
-- Two jobs, Phnom Penh time, every day (the factory also works on Sunday). Scans are not spread evenly: over 4,300 scans
-- (5 Oct to 2 Nov) about 85% fall in two windows, 06:15 to 08:00 and 17:00 to 17:45, and the rest of the day has 0 to 4
-- an hour, so the ticker follows them:
--   songfa-fast-poll         every 30 s in the shift windows 06:00-08:29 and 16:45-18:14   (a scan is announced in about 30 to 32 s)
--   songfa-fast-poll-steady  every 5 minutes for the rest of 05:00-19:59                   (a lone scan is announced within about 5 minutes)
-- Outside 05:00-19:59 the fast poll does nothing; the reader keeps its scans and the full sync collects them:
--   songfa-full-sync         /api/cron/pull every 10 minutes at night (20:00-04:59), every 30 minutes by day. It re-checks both readers
--                            (a full read only when a count changed), saves, announces and refreshes the device user list hourly.
--                            It replaces the old 'pull-devices-5min' job, which called the OLD site (songfawatertanks-attendance)
--                            every 5 minutes around the clock: about 8,600 calls a month, roughly 0.7 h of Active CPU.
--
-- The password the call carries lives in the table public.cron_secrets (made here, with a random value). The job reads
-- it from there on every call, and the site reads the same row to check it, so no secret is copied into Vercel or into
-- this file and the two can never differ. The table is locked: only the database owner and the site's service key can read it.
--
-- Sized for the Vercel Hobby (free) plan. Hobby includes, per month: 1,000,000 function invocations, 4 hours of
-- Active CPU and 360 GB-hours of provisioned memory (vercel.com/docs/plans/hobby, checked 2026-10). Going over
-- pauses the whole project (every page answers 402 DEPLOYMENT_DISABLED, the sign-in pages included), and Hobby judges the last
-- 30 days, so a bad stretch keeps counting for a month. The first schedule here (every 5 s all day) did exactly that on
-- 1 November 2026: Active CPU reached 4 h 12 m of 4 h (memory 175 of 360 GB-hrs and invocations 473K of 1M were fine).
-- CPU is the limit that matters, and a tick costs about the same however little it finds.
--
-- Measured: a full idle tick is about 37 ms of CPU and 11 database calls locally; Vercel's chart implies about 80 ms.
--
--   shift windows: 240 minutes x 2 ticks a minute = 480 ticks a day
--   steady:        (900 - 240) minutes / 5        = 132 ticks a day
--   full sync:     54 at night + 30 by day         = 84 a day
--   total about 700 a day, 21,000 a month (was 270,000 at 5 s, and 56,000 at a flat 30 s plus the old 5-minute full sync)
--   = about 0.5 hours of CPU a month for the ticker and the sync; pages come on top.
-- If the shift times change, move the two windows below (minute of day: 360 = 06:00, 509 = 08:29, 1005 = 16:45, 1094 = 18:14).
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

-- The earlier layouts had three jobs; remove the two that no longer apply (does nothing when they are not there).
select cron.unschedule(jobid) from cron.job where jobname in ('songfa-fast-poll-sunday', 'songfa-fast-poll-quiet');

-- Shift windows, every day: every 30 seconds.
select cron.schedule(
  'songfa-fast-poll',
  '30 seconds',
  $$
  select net.http_get(
    url     := 'https://watertanks-hrm.vercel.app/api/cron/fast',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select value from public.cron_secrets where name = 'scheduler')),
    timeout_milliseconds := 25000
  )
  from (select extract(hour from (now() at time zone 'Asia/Phnom_Penh')) * 60
             + extract(minute from (now() at time zone 'Asia/Phnom_Penh')) as m) t
  where t.m between 360 and 509 or t.m between 1005 and 1094;
  $$
);

-- The rest of 05:00 to 19:59, every day: every 5 minutes.
select cron.schedule(
  'songfa-fast-poll-steady',
  '*/5 * * * *',
  $$
  select net.http_get(
    url     := 'https://watertanks-hrm.vercel.app/api/cron/fast',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select value from public.cron_secrets where name = 'scheduler')),
    timeout_milliseconds := 25000
  )
  from (select extract(hour from (now() at time zone 'Asia/Phnom_Penh')) * 60
             + extract(minute from (now() at time zone 'Asia/Phnom_Penh')) as m) t
  where t.m between 300 and 1199
    and not (t.m between 360 and 509 or t.m between 1005 and 1094);
  $$
);

-- Full sync on THIS site (replaces 'pull-devices-5min'). Every 10 minutes; by day only on the :00 and :30 runs.
select cron.schedule(
  'songfa-full-sync',
  '*/10 * * * *',
  $$
  select net.http_get(
    url     := 'https://watertanks-hrm.vercel.app/api/cron/pull',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select value from public.cron_secrets where name = 'scheduler')),
    timeout_milliseconds := 55000
  )
  from (select extract(hour from (now() at time zone 'Asia/Phnom_Penh')) * 60
             + extract(minute from (now() at time zone 'Asia/Phnom_Penh')) as m,
               extract(minute from (now() at time zone 'Asia/Phnom_Penh')) as mi) t
  where t.m < 300 or t.m > 1199 or t.mi in (0, 30);
  $$
);

-- Only after the new job is in: retire the old 5-minute job that called the old site (does nothing when it is not there).
select cron.unschedule(jobid) from cron.job where jobname = 'pull-devices-5min';

-- Check: every scheduled job in the database (the two above plus anything else, for example the full-sync job that calls
-- /api/cron/pull), and the secret is set (shows only its length, never the value).
select j.jobid, j.jobname, j.schedule, j.active, left(j.command, 110) as command,
       (select length(value) from public.cron_secrets where name = 'scheduler') as secret_length
from cron.job j order by j.jobid;

-- ── To stop them ────────────────────────────────────────────────────────────
--   select cron.unschedule('songfa-fast-poll'); select cron.unschedule('songfa-fast-poll-steady'); select cron.unschedule('songfa-full-sync');
-- ── To see recent calls and their answers ───────────────────────────────────
--   select id, status_code, created, left(content::text, 200) from net._http_response order by id desc limit 10;
