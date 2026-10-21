-- ============================================================================
-- Scan notifications within seconds: a Supabase pg_cron ticker for /api/cron/fast
-- ============================================================================
-- Run in the Supabase SQL editor (Dashboard > SQL Editor > New query), AFTER migration 008.
--
-- Every 10 seconds during working hours it calls the new site's fast poll, which asks each device "how many records
-- do you hold?", reads only the newest scans if that grew, saves them and sends the Telegram notification.
-- Re-running cron.schedule with the same job name updates the job in place.
--
-- 1. Replace <CRON_SECRET> below with the CRON_SECRET value you set in the Vercel project.
--    (It is stored in the job text, which only database admins can read.)
-- 2. Hours are Phnom Penh time: 05:00 to 20:59, every day. The scan count check is cheap, so a quiet device costs
--    almost nothing. Narrow the hours or slow the interval to use fewer Vercel invocations.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'songfa-fast-poll',
  '10 seconds',
  $$
  select net.http_get(
    url     := 'https://watertanks-hrm.vercel.app/api/cron/fast',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
    timeout_milliseconds := 25000
  )
  where extract(hour from (now() at time zone 'Asia/Phnom_Penh')) between 5 and 20;
  $$
);

-- Check: the job exists.
select jobid, jobname, schedule, active from cron.job where jobname = 'songfa-fast-poll';

-- ── To stop it ──────────────────────────────────────────────────────────────
--   select cron.unschedule('songfa-fast-poll');
-- ── To see recent calls and their answers ───────────────────────────────────
--   select id, status_code, created, left(content::text, 200) from net._http_response order by id desc limit 10;
