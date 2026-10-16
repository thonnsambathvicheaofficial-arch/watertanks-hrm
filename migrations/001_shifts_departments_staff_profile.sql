-- ============================================================================
-- Migration 001: shifts, departments, shift assignments, staff profile fields
-- ============================================================================
-- Run once in the Supabase SQL editor (project nwbmxdtwebhrqzccozoc).
--
-- ADDITIVE ONLY. Nothing is dropped, renamed or rewritten. Existing columns
-- (employees.time_in / time_out / off_days / group / aliases), punches,
-- day_overrides and every other table are untouched, so the live site keeps
-- working before, during and after this runs. Safe to run twice.
--
-- After it runs, section 5 prints a check you can read: how many shifts were
-- created from your existing staff times and how many staff were linked.
-- ============================================================================

-- ── 1. Departments ──────────────────────────────────────────────────────────
create table if not exists departments (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);
create unique index if not exists departments_name_key on departments (lower(name));

-- ── 2. Shifts ───────────────────────────────────────────────────────────────
-- A named working pattern. end_time earlier than start_time means the shift
-- crosses midnight (a night shift). grace_minutes NULL = use the global grace
-- from the settings table. off_days uses JS weekday numbers: 0 = Sunday.
create table if not exists shifts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) > 0),
  start_time    text not null check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time      text not null check (end_time   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  grace_minutes integer check (grace_minutes between 0 and 120),
  off_days      integer[] not null default '{0}',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  check (start_time <> end_time)
);
create unique index if not exists shifts_name_key on shifts (lower(name));

-- ── 3. Staff profile fields (all optional) ──────────────────────────────────
alter table employees add column if not exists department_id uuid references departments(id) on delete set null;
alter table employees add column if not exists shift_id      uuid references shifts(id)      on delete set null;
alter table employees add column if not exists position      text;
alter table employees add column if not exists phone         text;
alter table employees add column if not exists joining_date  date;
alter table employees add column if not exists resigned_date date;

create index if not exists employees_shift_idx      on employees (shift_id);
create index if not exists employees_department_idx on employees (department_id);

-- ── 4. Shift assignments (rotating shifts) ──────────────────────────────────
-- A dated override of a person's normal shift: "Chhiv Thet works the Night
-- shift from 2026-11-02 to 2026-11-08". Outside every assignment a person
-- follows employees.shift_id (or their own Time In / Time Out). Two assignments
-- for the same person can never overlap; to_date NULL = open-ended.
create extension if not exists btree_gist;

create table if not exists shift_assignments (
  id         uuid primary key default gen_random_uuid(),
  pin        text not null references employees(pin) on update cascade on delete cascade,
  shift_id   uuid not null references shifts(id) on delete restrict,
  from_date  date not null,
  to_date    date,
  note       text,
  created_by text,
  created_at timestamptz not null default now(),
  check (to_date is null or to_date >= from_date),
  constraint shift_assignments_no_overlap
    exclude using gist (pin with =, daterange(from_date, coalesce(to_date, 'infinity'::date), '[]') with &&)
);
create index if not exists shift_assignments_pin_idx on shift_assignments (pin, from_date);

-- Same lock-down as every other table: the app uses the service key, which
-- bypasses RLS; the public/anon key can read and write nothing.
alter table departments       enable row level security;
alter table shifts            enable row level security;
alter table shift_assignments enable row level security;

-- ── 5. Starter shifts from your existing staff times ────────────────────────
-- Creates one shift for every Time In / Time Out pair that at least 2 staff
-- already use (e.g. "Day 07:00-17:00") and links those staff to it. It does
-- NOT change anyone's time_in / time_out, so attendance results are identical.
-- Off days come from the most common pattern among the staff on that pair.
-- A pair used by only one person (like a stray 19:23-17:00) is left alone so
-- you can look at it instead of it being turned into a shift silently.
insert into shifts (name, start_time, end_time, off_days)
select
  (case when e.time_in < e.time_out then 'Day ' else 'Night ' end) || e.time_in || '-' || e.time_out,
  e.time_in, e.time_out,
  coalesce(mode() within group (order by e.off_days), '{0}')   -- the off days most of those staff already have
from employees e
where e.time_in ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  and e.time_out ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  and e.time_in <> e.time_out
group by e.time_in, e.time_out
having count(*) >= 2
on conflict do nothing;

update employees e
set shift_id = s.id
from shifts s
where e.shift_id is null
  and s.start_time = e.time_in
  and s.end_time   = e.time_out;

-- ── 6. Check: read this result ──────────────────────────────────────────────
select
  (select count(*) from shifts)                                      as shifts_created,
  (select count(*) from employees where shift_id is not null)        as staff_linked_to_a_shift,
  (select count(*) from employees where shift_id is null
     and time_in is not null and time_out is not null)               as staff_with_unique_times_left_alone,
  (select count(*) from employees)                                   as staff_total;
