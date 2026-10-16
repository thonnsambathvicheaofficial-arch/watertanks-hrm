-- ============================================================================
-- Migration 004: roles and permissions, audit log, login accounts
-- ============================================================================
-- Run once in the Supabase SQL editor, AFTER migrations 001 to 003.
--
-- ADDITIVE ONLY. Existing logins keep working exactly as they do now: an account
-- whose role is 'admin' is an administrator with full access, and stays one.
-- Safe to run twice.
-- ============================================================================

-- ── 1. Roles ────────────────────────────────────────────────────────────────
-- A role is a named set of permissions for accounts that are NOT administrators.
-- Roles start empty. The permission names live in the app (lib/permissions.js).
create table if not exists roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  description text,
  created_at  timestamptz not null default now()
);
create unique index if not exists roles_name_key on roles (lower(name));

create table if not exists role_permissions (
  role_id    uuid not null references roles(id) on delete cascade,
  permission text not null check (length(trim(permission)) > 0),
  primary key (role_id, permission)
);

-- ── 2. Login accounts: a role, and a way to switch an account off ───────────
alter table login_users add column if not exists role_id  uuid references roles(id) on delete set null;
alter table login_users add column if not exists disabled boolean not null default false;

-- ── 3. Audit log ────────────────────────────────────────────────────────────
-- Who did what, and when. Append-only: rows can be added but never changed or
-- removed through the app or the API. (A deliberate clean-up is a DBA action:
-- set app.allow_audit_edit = 'on' for the session.)
create table if not exists audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      text,                      -- the signed-in username; null for system events
  action     text not null,             -- e.g. 'override.set', 'payroll.finalize', 'login.failed'
  entity     text,                      -- the kind of thing changed, e.g. 'staff', 'payroll'
  entity_key text,                      -- which one, e.g. a PIN or '2026-09'
  summary    text not null,             -- one readable sentence
  details    jsonb                      -- before/after values and other specifics
);
create index if not exists audit_log_at_idx     on audit_log (at desc);
create index if not exists audit_log_actor_idx  on audit_log (actor, at desc);
create index if not exists audit_log_entity_idx on audit_log (entity, entity_key, at desc);

create or replace function audit_log_guard() returns trigger language plpgsql as $$
begin
  if current_setting('app.allow_audit_edit', true) = 'on' then
    return coalesce(new, old);
  end if;
  raise exception 'The audit log is append-only: entries cannot be changed or deleted.';
end $$;

drop trigger if exists audit_log_no_change on audit_log;
create trigger audit_log_no_change before update or delete on audit_log
  for each row execute function audit_log_guard();

-- Same lock-down as every other table (the app uses the service key).
alter table roles            enable row level security;
alter table role_permissions enable row level security;
alter table audit_log        enable row level security;

-- ── 4. Check: read this result ──────────────────────────────────────────────
select
  (select count(*) from roles)                                     as roles,
  (select count(*) from login_users)                               as login_accounts,
  (select count(*) from login_users where role = 'admin')          as administrators,
  (select count(*) from login_users where disabled)                as disabled_accounts,
  (select count(*) from audit_log)                                 as audit_entries;
