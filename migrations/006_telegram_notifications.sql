-- ============================================================================
-- Migration 006: Telegram scan notifications (settings and delivery log)
-- ============================================================================
-- Run once in the Supabase SQL editor (project nwbmxdtwebhrqzccozoc), after 001-005.
--
-- ADDITIVE ONLY. Two new tables. Nothing existing changes: scans, staff, reports and
-- payroll are untouched, and notifications start switched OFF. Safe to run twice.
-- The Telegram bot token is NOT stored here; it lives in the TELEGRAM_BOT_TOKEN setting
-- of the web app (Vercel and .env).
-- ============================================================================

-- One row of settings.
create table if not exists notification_settings (
  id                    integer primary key default 1 check (id = 1),
  enabled               boolean not null default false,
  chat_id               text,                                  -- the Telegram group, e.g. -1001234567890
  scope_group           text not null default 'all' check (scope_group in ('all', 'office', 'worker')),
  department_ids        uuid[] not null default '{}',          -- empty = every department
  ignore_repeat_seconds integer not null default 120 check (ignore_repeat_seconds between 0 and 3600),
  max_age_minutes       integer not null default 30  check (max_age_minutes between 1 and 1440),   -- never announce a scan older than this
  digest_threshold      integer not null default 12  check (digest_threshold between 1 and 100),   -- more waiting than this are sent as one digest
  cursor_at             timestamptz,                           -- scans saved before this are never announced (set when switched on)
  updated_at            timestamptz not null default now(),
  updated_by            text
);
insert into notification_settings (id) values (1) on conflict (id) do nothing;

-- One row per scan considered. The unique scan id is what makes sending exactly-once.
create table if not exists notification_log (
  id         bigint generated always as identity primary key,
  punch_id   uuid not null unique,
  pin        text not null,
  ts         timestamp not null,                               -- the scan time as the device recorded it
  status     text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  reason     text,                                             -- why it was skipped or failed
  attempts   integer not null default 0,
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
create index if not exists notification_log_status_idx  on notification_log (status) where status in ('pending', 'failed');
create index if not exists notification_log_created_idx on notification_log (created_at desc);

alter table notification_settings enable row level security;
alter table notification_log      enable row level security;

-- Check: settings row present (notifications off), log empty.
select
  (select count(*) from notification_settings)                 as settings_rows,
  (select enabled from notification_settings where id = 1)     as enabled,
  (select count(*) from notification_log)                      as log_rows;
