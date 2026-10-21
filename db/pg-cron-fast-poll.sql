-- ============================================================================
-- Scan notifications within seconds: a Supabase pg_cron ticker for /api/cron/fast
-- ============================================================================
-- Run in the Supabase SQL editor (Dashboard > SQL Editor > New query), AFTER migration 008.
--
-- Every 20 seconds during working hours it calls the site's fast poll, which asks each device "how many records
-- do you hold?", reads only the newest scans if that grew, saves them and sends the Telegram notification.
-- A scan is announced about 5 to 25 seconds after it happens (20 s tick, plus about 5 s to read, save and send).
-- Re-running cron.schedule with the same job name updates the job in place.
--
-- 1. Replace <CRON_SECRET> below with the CRON_SECRET value you set in the Vercel project.
--    (It is stored in the job text, which only database admins can read.)
-- 2. Hours are Phnom Penh time: 05:00 to 19:59, every day.
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

select cron.schedule(
  'songfa-fast-poll',
  '20 seconds',
  $$
  select net.http_get(
    url     := 'https://watertanks-hrm.vercel.app/api/cron/fast',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
    timeout_milliseconds := 25000
  )
  where extract(hour from (now() at time zone 'Asia/Phnom_Penh')) between 5 and 19;
  $$
);

-- Check: the job exists.
select jobid, jobname, schedule, active from cron.job where jobname = 'songfa-fast-poll';

-- ── To stop it ──────────────────────────────────────────────────────────────
--   select cron.unschedule('songfa-fast-poll');
-- ── To see recent calls and their answers ───────────────────────────────────
--   select id, status_code, created, left(content::text, 200) from net._http_response order by id desc limit 10;
