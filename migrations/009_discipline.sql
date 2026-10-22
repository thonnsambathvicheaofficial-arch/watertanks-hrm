-- ============================================================================
-- Migration 009: discipline register (guidance, warnings, salary deductions)
-- ============================================================================
-- Run once in the Supabase SQL editor (project nwbmxdtwebhrqzccozoc), after 001-008.
--
-- ADDITIVE ONLY. One new table. Nothing existing changes: scans, staff, reports, leave and payroll are untouched.
-- Safe to run twice. Records are never deleted by the app once confirmed: they are marked withdrawn.
--
--   kind     the ladder: guidance, verbal warning, first written, second written, final warning
--   status   draft (nothing happens to pay) -> confirmed (a salary deduction becomes a payroll withholding)
--            -> withdrawn (the payroll withholding is removed again)
--   deduction  USD, positive; when a record is confirmed it is added to Monthly items for payroll_year/payroll_month
--              as a negative "withholding", and payroll_entry_id points at that item so the two stay together
-- ============================================================================

create table if not exists discipline_records (
  id               uuid primary key default gen_random_uuid(),
  pin              text not null references employees(pin) on update cascade on delete restrict,
  occurred_on      date not null,
  kind             text not null check (kind in ('guidance', 'verbal', 'written1', 'written2', 'final')),
  reason           text not null,
  deduction        numeric(10,2) check (deduction is null or deduction > 0),
  payroll_year     integer check (payroll_year is null or payroll_year between 2000 and 2100),
  payroll_month    integer check (payroll_month is null or payroll_month between 1 and 12),
  status           text not null default 'draft' check (status in ('draft', 'confirmed', 'withdrawn')),
  payroll_entry_id uuid references payroll_entries(id) on delete set null,
  letter_issued_on date,
  letter_issued_by text,
  acknowledged_on  date,                      -- the staff member signed the letter
  created_by       text,
  created_at       timestamptz not null default now(),
  confirmed_by     text,
  confirmed_at     timestamptz,
  withdrawn_by     text,
  withdrawn_at     timestamptz,
  withdrawn_reason text,
  -- a deduction needs the payroll month it comes out of
  check (deduction is null or (payroll_year is not null and payroll_month is not null))
);
create index if not exists discipline_records_pin_idx  on discipline_records (pin, occurred_on desc);
create index if not exists discipline_records_date_idx on discipline_records (occurred_on desc);

alter table discipline_records enable row level security;   -- no policies: only the site's service key can read or write

-- Check: the table exists and is empty.
select (select count(*) from discipline_records) as records,
       (select count(*) from information_schema.columns where table_name = 'discipline_records') as columns_present;
