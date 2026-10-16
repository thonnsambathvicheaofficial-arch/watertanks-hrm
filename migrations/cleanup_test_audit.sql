-- ============================================================================
-- One-off cleanup: remove audit entries and accounts created while testing
-- ============================================================================
-- The audit log refuses edits and deletes on purpose, so the app cannot remove test
-- entries. This deletes ONLY entries made by, or about, the throwaway test accounts and
-- test records (names or PINs starting with ZZ), plus those test accounts and roles.
-- Real entries are never touched.
--
-- Run it once in the Supabase SQL editor, after testing is finished. It lifts the
-- append-only guard for this transaction only.
-- ============================================================================
begin;
set local app.allow_audit_edit = 'on';

delete from audit_log
where actor ilike 'ZZ%'
   or entity_key ilike 'ZZ%'
   or summary ilike '%ZZ-TEST%';

delete from login_users where username ilike 'ZZ%';
delete from roles where name ilike 'ZZ%';

commit;

-- Check: all three should be 0.
select
  (select count(*) from audit_log where actor ilike 'ZZ%' or entity_key ilike 'ZZ%') as test_audit_left,
  (select count(*) from login_users where username ilike 'ZZ%')                       as test_accounts_left,
  (select count(*) from roles where name ilike 'ZZ%')                                  as test_roles_left;
