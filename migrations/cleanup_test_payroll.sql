-- ============================================================================
-- One-off cleanup: remove the finalized payroll runs created while testing
-- ============================================================================
-- Finalized payroll is locked by the database on purpose, so the app cannot delete
-- these test runs. This deletes ONLY runs whose slips all belong to the throwaway
-- test people (PINs starting with ZZ). A real payroll run is never touched.
--
-- Run it once in the Supabase SQL editor. It lifts the lock for this transaction only.
-- ============================================================================
begin;
set local app.reopen_payroll = 'on';

delete from payroll_runs r
where exists (select 1 from payroll_slips s where s.run_id = r.id)
  and not exists (select 1 from payroll_slips s where s.run_id = r.id and s.pin not like 'ZZ%');

commit;

-- Check: should show 0 slips for test people and no run named in the test months.
select
  (select count(*) from payroll_slips where pin like 'ZZ%') as test_slips_left,
  (select count(*) from payroll_runs)                        as payroll_runs_left;
