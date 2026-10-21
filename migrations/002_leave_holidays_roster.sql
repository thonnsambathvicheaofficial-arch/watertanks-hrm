-- ============================================================================
-- Migration 002: leave, public holidays, roster override audit
-- ============================================================================
-- Run once in the Supabase SQL editor, AFTER migration 001.
--
-- ADDITIVE ONLY. No existing table is rewritten and no existing row changes:
-- day_overrides keeps all its rows and meaning; it only gains one nullable
-- column. Safe to run twice.
-- ============================================================================

-- ── 1. Leave types ──────────────────────────────────────────────────────────
-- default_days is the starting entitlement per year when you use "Fill from
-- defaults". It is left empty on purpose: set Song Fa's own policy in Leave
-- settings. Nothing is assumed.
create table if not exists leave_types (
  id           uuid primary key default gen_random_uuid(),
  code         text not null check (length(trim(code)) between 1 and 6),
  name         text not null check (length(trim(name)) > 0),
  is_paid      boolean not null default true,
  default_days numeric(5,1) check (default_days is null or default_days >= 0),
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);
create unique index if not exists leave_types_code_key on leave_types (upper(code));
create unique index if not exists leave_types_name_key on leave_types (lower(name));

insert into leave_types (code, name, is_paid, sort_order) values
  ('AL', 'Annual leave',    true,  1),
  ('SL', 'Sick leave',      true,  2),
  ('SP', 'Special leave',   true,  3),
  ('UP', 'Unpaid leave',    false, 4),
  ('ML', 'Maternity leave', true,  5)
on conflict do nothing;

-- ── 2. Entitlements: days a person may take per year and type ───────────────
create table if not exists leave_entitlements (
  pin           text not null references employees(pin) on update cascade on delete cascade,
  year          integer not null check (year between 2000 and 2100),
  leave_type_id uuid not null references leave_types(id) on delete cascade,
  days          numeric(5,1) not null check (days >= 0),
  updated_at    timestamptz not null default now(),
  primary key (pin, year, leave_type_id)
);

-- ── 3. Leave requests ───────────────────────────────────────────────────────
-- Entered and decided by HR. `days` is stored at save time (working days between
-- the dates, skipping that person's days off and public holidays; 0.5 for a
-- half day). A half day is one date with a period. Two full-day requests for the
-- same person can never overlap; half-day/full-day clashes are checked by the app.
create table if not exists leave_requests (
  id              uuid primary key default gen_random_uuid(),
  pin             text not null references employees(pin) on update cascade on delete cascade,
  leave_type_id   uuid not null references leave_types(id) on delete restrict,
  from_date       date not null,
  to_date         date not null,
  half_day_period text check (half_day_period in ('morning', 'afternoon')),
  days            numeric(5,1) not null check (days >= 0),
  reason          text,
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  created_by      text,
  created_at      timestamptz not null default now(),
  decided_by      text,
  decided_at      timestamptz,
  decision_note   text,
  check (to_date >= from_date),
  check (half_day_period is null or from_date = to_date),
  constraint leave_requests_no_full_day_overlap
    exclude using gist (pin with =, daterange(from_date, to_date, '[]') with &&)
    where (status in ('pending', 'approved') and half_day_period is null)
);
create index if not exists leave_requests_pin_idx    on leave_requests (pin, from_date);
create index if not exists leave_requests_status_idx on leave_requests (status, from_date);

-- ── 4. Public holidays ──────────────────────────────────────────────────────
create table if not exists public_holidays (
  date       date primary key,
  name       text not null check (length(trim(name)) > 0),
  name_kh    text,
  created_at timestamptz not null default now()
);

-- ── 5. Roster override audit ────────────────────────────────────────────────
-- What the system had worked out for the day BEFORE HR overrode it. Existing
-- rows stay empty; new overrides record it.
alter table day_overrides add column if not exists original_status text;

-- Same lock-down as every other table (the app uses the service key).
alter table leave_types        enable row level security;
alter table leave_entitlements enable row level security;
alter table leave_requests     enable row level security;
alter table public_holidays    enable row level security;

-- ── 6. Check: read this result ──────────────────────────────────────────────
select
  (select count(*) from leave_types)        as leave_types,
  (select count(*) from public_holidays)    as holidays,
  (select count(*) from leave_requests)     as leave_requests,
  (select count(*) from day_overrides)      as overrides_untouched;
