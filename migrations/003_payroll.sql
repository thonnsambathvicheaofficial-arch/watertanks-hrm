-- ============================================================================
-- Migration 003: payroll
-- ============================================================================
-- Run once in the Supabase SQL editor, AFTER migrations 001 and 002.
--
-- ADDITIVE ONLY. Nothing existing is changed. Safe to run twice.
--
-- NOTHING POLICY-RELATED IS ASSUMED. Overtime multipliers, work days and hours
-- per month, the exchange rate, tax brackets and NSSF rates all start EMPTY and
-- are filled in on the Payroll settings page. A payroll run can be drafted
-- before they are set, but it cannot be finalized until the ones it needs exist.
-- ============================================================================

-- ── 1. Company payroll settings (one row) ───────────────────────────────────
create table if not exists payroll_settings (
  id                          integer primary key default 1 check (id = 1),
  exchange_rate               numeric(10,2) check (exchange_rate is null or exchange_rate > 0),   -- KHR per 1 USD
  dependent_relief_khr        numeric(12,2) check (dependent_relief_khr is null or dependent_relief_khr >= 0),
  non_resident_rate           numeric(5,2)  check (non_resident_rate is null or non_resident_rate between 0 and 100),
  nssf_employee_rate          numeric(5,2)  check (nssf_employee_rate is null or nssf_employee_rate between 0 and 100),
  nssf_employer_pension_rate  numeric(5,2)  check (nssf_employer_pension_rate is null or nssf_employer_pension_rate between 0 and 100),
  nssf_employer_health_rate   numeric(5,2)  check (nssf_employer_health_rate is null or nssf_employer_health_rate between 0 and 100),
  nssf_employer_risk_rate     numeric(5,2)  check (nssf_employer_risk_rate is null or nssf_employer_risk_rate between 0 and 100),
  nssf_ceiling_khr            numeric(12,0) check (nssf_ceiling_khr is null or nssf_ceiling_khr >= 0),
  nssf_floor_khr              numeric(12,0) check (nssf_floor_khr is null or nssf_floor_khr >= 0),
  work_days_per_month         numeric(4,1)  check (work_days_per_month is null or work_days_per_month between 1 and 31),
  hours_per_day               numeric(4,2)  check (hours_per_day is null or hours_per_day between 1 and 24),
  ot_rate_normal              numeric(5,2)  check (ot_rate_normal is null or ot_rate_normal >= 0),    -- multiplier, e.g. 1.5
  ot_rate_off                 numeric(5,2)  check (ot_rate_off is null or ot_rate_off >= 0),          -- weekly day off
  ot_rate_holiday             numeric(5,2)  check (ot_rate_holiday is null or ot_rate_holiday >= 0),  -- public holiday
  ot_suggest_threshold_min    integer not null default 0 check (ot_suggest_threshold_min >= 0),      -- scans past shift end shorter than this are not suggested
  late_mode                   text not null default 'none' check (late_mode in ('none', 'per_day', 'per_minute')),
  late_amount                 numeric(8,2) not null default 0 check (late_amount >= 0),               -- USD per late day, or per minute late
  updated_at                  timestamptz not null default now(),
  updated_by                  text
);
insert into payroll_settings (id) values (1) on conflict (id) do nothing;

-- ── 2. Tax on salary brackets (KHR per month) ───────────────────────────────
create table if not exists payroll_tax_brackets (
  id              uuid primary key default gen_random_uuid(),
  min_amount      numeric(14,0) not null default 0 check (min_amount >= 0),
  max_amount      numeric(14,0) check (max_amount is null or max_amount >= min_amount),   -- null = no upper limit
  rate            numeric(5,2) not null check (rate between 0 and 100),
  quick_deduction numeric(14,0) not null default 0 check (quick_deduction >= 0),
  sort_order      integer not null default 0
);

-- ── 3. Per-person pay setup ─────────────────────────────────────────────────
create table if not exists payroll_structure (
  pin            text primary key references employees(pin) on update cascade on delete cascade,
  salary         numeric(10,2) check (salary is null or salary >= 0),      -- monthly, USD
  tax_resident   boolean not null default true,
  tax_exempt     boolean not null default false,
  nssf_exempt    boolean not null default false,
  dependents     integer not null default 0 check (dependents >= 0),       -- spouse + children, for tax relief
  payment_method text check (payment_method in ('bank', 'cash')),
  bank_name      text,
  bank_account   text,
  updated_at     timestamptz not null default now(),
  updated_by     text
);

-- ── 4. Recurring company allowances (applied to everyone with a salary) ────
create table if not exists payroll_allowances (
  id        uuid primary key default gen_random_uuid(),
  name      text not null check (length(trim(name)) > 0),
  kind      text not null default 'fixed' check (kind in ('fixed', 'percent')),   -- fixed USD, or percent of salary
  amount    numeric(10,2) not null check (amount >= 0),
  is_active boolean not null default true
);
create unique index if not exists payroll_allowances_name_key on payroll_allowances (lower(name));

-- ── 5. Monthly items per person ─────────────────────────────────────────────
-- bonus / allowance add to pay; advance is deducted; adjustment and withholding
-- may be + or - (amount carries the sign).
create table if not exists payroll_entries (
  id         uuid primary key default gen_random_uuid(),
  pin        text not null references employees(pin) on update cascade on delete cascade,
  year       integer not null check (year between 2000 and 2100),
  month      integer not null check (month between 1 and 12),
  kind       text not null check (kind in ('bonus', 'allowance', 'advance', 'adjustment', 'withholding')),
  label      text,
  amount     numeric(10,2) not null,
  remarks    text,
  created_by text,
  created_at timestamptz not null default now(),
  check (kind in ('adjustment', 'withholding') or amount >= 0)
);
create index if not exists payroll_entries_period_idx on payroll_entries (year, month, pin);

-- ── 6. Overtime ─────────────────────────────────────────────────────────────
-- One entry per person per day. Scans SUGGEST (source 'scan', status 'pending');
-- HR approves, edits the hours, or rejects. Only approved hours are paid. The
-- rate tier (normal / day off / holiday) is worked out from the date when payroll
-- runs, so it always follows the current holidays and the person's days off.
create table if not exists overtime_entries (
  id          uuid primary key default gen_random_uuid(),
  pin         text not null references employees(pin) on update cascade on delete cascade,
  date        date not null,
  hours       numeric(5,2) not null check (hours > 0 and hours <= 24),
  scan_hours  numeric(5,2),
  source      text not null default 'manual' check (source in ('scan', 'manual')),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  note        text,
  created_by  text,
  created_at  timestamptz not null default now(),
  decided_by  text,
  decided_at  timestamptz,
  unique (pin, date)
);
create index if not exists overtime_entries_date_idx on overtime_entries (date, status);

-- ── 7. Payroll runs and slips ───────────────────────────────────────────────
create table if not exists payroll_runs (
  id           uuid primary key default gen_random_uuid(),
  year         integer not null check (year between 2000 and 2100),
  month        integer not null check (month between 1 and 12),
  status       text not null default 'draft' check (status in ('draft', 'finalized')),
  created_by   text,
  created_at   timestamptz not null default now(),
  finalized_by text,
  finalized_at timestamptz,
  settings     jsonb,                      -- the settings and brackets in force, frozen at finalize
  unique (year, month)
);

-- calc holds every input and every result for the slip, so a finalized slip can
-- always be explained. The numeric columns exist for totals and reports.
create table if not exists payroll_slips (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references payroll_runs(id) on delete cascade,
  pin            text not null,
  name           text,
  payment_method text,
  gross          numeric(10,2) not null default 0,
  tax            numeric(10,2) not null default 0,
  nssf_employee  numeric(10,2) not null default 0,
  nssf_employer  numeric(10,2) not null default 0,
  net            numeric(10,2) not null default 0,
  calc           jsonb not null,
  unique (run_id, pin)
);
create index if not exists payroll_slips_run_idx on payroll_slips (run_id);

-- A finalized run is immutable: its slips cannot be added to, changed or removed,
-- and the run itself cannot be edited or deleted. To correct a finalized month,
-- record an adjustment in the next month instead. (A deliberate re-open is a DBA
-- action: set app.reopen_payroll = 'on' for the session.)
create or replace function payroll_guard_finalized() returns trigger language plpgsql as $$
declare st text; rid uuid;
begin
  if current_setting('app.reopen_payroll', true) = 'on' then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'payroll_runs' then
    if tg_op = 'DELETE' then st := old.status; else st := old.status; end if;
    if st = 'finalized' then raise exception 'Payroll for %-% is finalized and cannot be changed.', old.year, old.month; end if;
    return coalesce(new, old);
  end if;
  rid := coalesce(new.run_id, old.run_id);
  select status into st from payroll_runs where id = rid;
  if st = 'finalized' then raise exception 'This payroll run is finalized; its slips cannot be changed.'; end if;
  return coalesce(new, old);
end $$;

drop trigger if exists payroll_runs_guard on payroll_runs;
create trigger payroll_runs_guard before update or delete on payroll_runs
  for each row execute function payroll_guard_finalized();
drop trigger if exists payroll_slips_guard on payroll_slips;
create trigger payroll_slips_guard before insert or update or delete on payroll_slips
  for each row execute function payroll_guard_finalized();

-- Same lock-down as every other table (the app uses the service key).
alter table payroll_settings      enable row level security;
alter table payroll_tax_brackets  enable row level security;
alter table payroll_structure     enable row level security;
alter table payroll_allowances    enable row level security;
alter table payroll_entries       enable row level security;
alter table overtime_entries      enable row level security;
alter table payroll_runs          enable row level security;
alter table payroll_slips         enable row level security;

-- ── 8. Check: read this result ──────────────────────────────────────────────
select
  (select count(*) from payroll_settings)                                   as settings_rows,
  (select count(*) from payroll_settings where exchange_rate is not null)   as settings_filled_in,
  (select count(*) from payroll_tax_brackets)                               as tax_brackets,
  (select count(*) from payroll_structure)                                  as people_with_pay_setup,
  (select count(*) from payroll_runs)                                       as payroll_runs;
