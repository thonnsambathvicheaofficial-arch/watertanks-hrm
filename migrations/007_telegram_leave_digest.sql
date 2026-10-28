-- ============================================================================
-- Migration 007: daily "on leave today" message to the Telegram group
-- ============================================================================
-- Run once in the Supabase SQL editor (project nwbmxdtwebhrqzccozoc), after 006.
--
-- ADDITIVE ONLY. Three optional columns on the existing notification_settings row.
-- The daily message starts OFF. Nothing else changes. Safe to run twice.
-- ============================================================================

alter table notification_settings add column if not exists leave_digest_enabled boolean not null default false;
alter table notification_settings add column if not exists leave_digest_time    text    not null default '07:30';
alter table notification_settings add column if not exists leave_digest_last    date;   -- the day it was last sent, so it goes out once a day

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'notification_settings_digest_time_check') then
    alter table notification_settings add constraint notification_settings_digest_time_check check (leave_digest_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  end if;
end $$;

-- Check: the three columns exist and the daily message is off.
select
  (select count(*) from information_schema.columns where table_name = 'notification_settings'
     and column_name in ('leave_digest_enabled', 'leave_digest_time', 'leave_digest_last')) as new_columns_present,
  (select leave_digest_enabled from notification_settings where id = 1) as daily_message_on,
  (select leave_digest_time from notification_settings where id = 1)    as send_at;
