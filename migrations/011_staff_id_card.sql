-- ============================================================================
-- Migration 011: national ID card photo kept with the staff record
-- ============================================================================
-- Run once in the Supabase SQL editor (project nwbmxdtwebhrqzccozoc), after 010.
--
-- ADDITIVE ONLY. One new optional column on employees and one new private storage bucket.
-- Nothing existing changes: staff, scans, corrections, leave and payroll are untouched, and the
-- live site keeps working before, during and after this runs. Safe to run twice.
--
-- A national ID card photo is personal data, so it is kept apart from the profile photos:
--   - the picture lives in its own PRIVATE bucket "staff-ids", never in the employees table
--     (that table is read by every report);
--   - employees.id_card_path only holds the file's name there;
--   - the site shows the card through a link that expires after 10 minutes, created only for
--     someone who is allowed to edit staff, so a card address cannot be shared or guessed.
-- ============================================================================

alter table employees add column if not exists id_card_path text;   -- file name inside the staff-ids bucket; empty = no card on file

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-ids', 'staff-ids', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- Check: the column exists and the bucket is private.
select
  (select count(*) from information_schema.columns where table_name = 'employees' and column_name = 'id_card_path') as id_card_column_present,
  (select count(*) from storage.buckets where id = 'staff-ids' and public = false) as private_bucket_present;
