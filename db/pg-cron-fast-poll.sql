-- ============================================================================
-- Scan notifications within seconds: Supabase pg_cron tickers for /api/cron/fast
-- ============================================================================
-- Run this whole file in the Supabase SQL editor (Dashboard > SQL Editor > New query), AFTER migration 008.
-- Nothing to paste or edit. Re-running it updates the jobs in place and keeps the existing secret.
--
-- The fast poll asks each reader "how many records do you hold?", reads only the newest scans if that grew, saves them
-- and sends the Telegram message (about 2 s from save to Telegram, with the site running in Tokyo next to the database).
--
-- Three jobs, Phnom Penh time (the factory also works on Sunday):
--   songfa-fast-poll         every 30 s, Monday to Saturday, 06:00 to 18:59   (a scan is announced in about 30 to 32 s)
--   songfa-fast-poll-sunday  every minute, Sunday, 06:00 to 18:59             (fewer people work Sunday)
--   songfa-fast-poll-quiet   every minute, the 05:00 and 19:00 hours, every day (early start and late finish)
--
-- The password the call carries lives in the table public.cron_secrets (made here, with a random value). The job reads
-- it from there on every call, and the site reads the same row to check it, so no secret is copied into Vercel or into
-- this file and the two can never differ. The table is locked: only the database owner and the site's service key can read it.
--
-- Sized for the Vercel Hobby (free) plan. Hobby includes, per month: 1,000,000 function invocations, 4 hours of
-- Active CPU and 360 GB-hours of provisioned memory (vercel.com/docs/plans/hobby, checked 2026-10). Going over
-- pauses the whole project (every page answers 402 DEPLOYMENT_DISABLED, the sign-in pages included).
-- The first schedule here (every 5 s) did exactly that on 1 November 2026: Active CPU reached 4 h 12 m of 4 h
-- (memory 175 of 360 GB-hrs and invocations 473K of 1M were fine). CPU is the limit that matters.
--
-- Measured from Vercel's Active CPU chart (Oct 21 - Nov 1): a working day at 5 s cost about 20 minutes, a Sunday at 10 s about
-- 6.5 minutes, i.e. roughly 80 ms of CPU per tick plus the pages people open.
--
--   Mon-Sat:    13 hours x 120 ticks x 26 days  = about 41,000 a month   (about 2.2 minutes of CPU a day)
--   Sunday:     13 hours x 60 ticks x 4.3 days  = about 3,400
--   early/late: 2 hours x 60 ticks x 30 days    = about 3,600    -> roughly 48,000 calls, 5% of the invocation allowance
--   CPU:        about 2.4 hours a month with the pages included, against 4. After the first week, check Vercel > Usage:
--               a working day above about 6 minutes means something else is spending CPU.
-- The way to go lower and get instant announcements again is push: the readers send each scan to the site themselves
-- (see docs/PUSH.md), and this ticker then stays as a once-a-minute backup.
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

-- Monday to Saturday, 06:00 to 18:59: every 30 seconds.
select cron.schedule(
  'songfa-fast-poll',
  '30 seconds',
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

-- Sunday, 06:00 to 18:59: every minute.
select cron.schedule(
  'songfa-fast-poll-sunday',
  '* * * * *',
  $$
  select net.http_get(
    url     := 'https://watertanks-hrm.vercel.app/api/cron/fast',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select value from public.cron_secrets where name = 'scheduler')),
    timeout_milliseconds := 25000
  )
  where extract(isodow from (now() at time zone 'Asia/Phnom_Penh')) = 7
    and extract(hour from (now() at time zone 'Asia/Phnom_Penh')) between 6 and 18;
  $$
);

-- The 05:00 and 19:00 hours, every day: every minute.
select cron.schedule(
  'songfa-fast-poll-quiet',
  '* * * * *',
  $$
  select net.http_get(
    url     := 'https://watertanks-hrm.vercel.app/api/cron/fast',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select value from public.cron_secrets where name = 'scheduler')),
    timeout_milliseconds := 25000
  )
  where extract(hour from (now() at time zone 'Asia/Phnom_Penh')) in (5, 19);
  $$
);

-- Check: the three jobs exist and the secret is set (shows only its length, never the value).
select j.jobid, j.jobname, j.schedule, j.active, (select length(value) from public.cron_secrets where name = 'scheduler') as secret_length
from cron.job j where j.jobname like 'songfa-fast-poll%' order by j.jobname;

-- ── To stop them ────────────────────────────────────────────────────────────
--   select cron.unschedule('songfa-fast-poll'); select cron.unschedule('songfa-fast-poll-sunday'); select cron.unschedule('songfa-fast-poll-quiet');
-- ── To see recent calls and their answers ───────────────────────────────────
--   select id, status_code, created, left(content::text, 200) from net._http_response order by id desc limit 10;
