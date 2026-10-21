-- ============================================================================
-- Migration 008: fast scan polling (a per-device baseline and lock)
-- ============================================================================
-- Run once in the Supabase SQL editor (project nwbmxdtwebhrqzccozoc), after 007.
--
-- ADDITIVE ONLY. Four optional columns on the existing devices table. Nothing else changes, and the scheduled full
-- sync (which owns completeness) is unaffected. Safe to run twice.
--
--   fast_count       how many records the device held at the last fast check, so a check that sees more knows how many
--                    new scans to fetch. It is NOT the completeness baseline (last_log_count): only a full read proves
--                    the whole log was saved.
--   fast_at          when the last fast check finished
--   fast_lock_until  one fast check at a time per device (a short lease, so a crashed check frees itself)
--   fast_error       the last fast-check problem, for the Devices page; empty when healthy
-- ============================================================================

alter table devices add column if not exists fast_count      integer;
alter table devices add column if not exists fast_at         timestamptz;
alter table devices add column if not exists fast_lock_until timestamptz;
alter table devices add column if not exists fast_error      text;

-- Check: the four columns exist.
select count(*) as new_columns_present
from information_schema.columns
where table_name = 'devices' and column_name in ('fast_count', 'fast_at', 'fast_lock_until', 'fast_error');
