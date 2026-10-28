-- ============================================================================
-- Migration 005: fuller staff profile (identity, contact, employment, exit)
-- ============================================================================
-- Run once in the Supabase SQL editor (project nwbmxdtwebhrqzccozoc), after 001-004.
--
-- ADDITIVE ONLY. Every new column is optional and empty until filled, so nothing
-- existing changes: staff, scans, corrections, leave and payroll are untouched,
-- and the live site keeps working before, during and after this runs. Safe to run twice.
--
-- After it runs, the final select prints how many staff exist and how many columns
-- were added, so you can see it took effect.
-- ============================================================================

-- Identity
alter table employees add column if not exists staff_code    text;   -- the company's own staff ID (e.g. SF0006); the PIN stays the fingerprint ID
alter table employees add column if not exists name_kh       text;   -- name in Khmer script
alter table employees add column if not exists gender        text;
alter table employees add column if not exists date_of_birth date;
alter table employees add column if not exists marital_status text;
alter table employees add column if not exists id_card_no    text;
alter table employees add column if not exists nssf_no       text;
alter table employees add column if not exists address       text;

-- Contact
alter table employees add column if not exists personal_email text;
alter table employees add column if not exists emergency_contact text;
alter table employees add column if not exists emergency_phone   text;

-- Employment
alter table employees add column if not exists employment_type text;   -- contract type, free text (HR decides the wording)
alter table employees add column if not exists probation_end   date;
alter table employees add column if not exists line_manager    text references employees(pin) on update cascade on delete set null;

-- Exit
alter table employees add column if not exists resign_reason text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'employees_gender_check') then
    alter table employees add constraint employees_gender_check check (gender is null or gender in ('M', 'F'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employees_line_manager_not_self') then
    alter table employees add constraint employees_line_manager_not_self check (line_manager is null or line_manager <> pin);
  end if;
end $$;

-- A staff ID identifies one person (letters in any case count as the same).
create unique index if not exists employees_staff_code_uniq on employees (lower(staff_code)) where staff_code is not null and staff_code <> '';
create index if not exists employees_line_manager_idx on employees (line_manager);

-- Check: staff count, and the 15 new columns present.
select
  (select count(*) from employees) as staff,
  (select count(*) from information_schema.columns where table_name = 'employees'
     and column_name in ('staff_code','name_kh','gender','date_of_birth','marital_status','id_card_no','nssf_no','address',
                         'personal_email','emergency_contact','emergency_phone','employment_type','probation_end','line_manager','resign_reason')) as new_columns_present;
