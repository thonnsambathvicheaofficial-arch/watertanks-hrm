-- ============================================================================
-- Migration 010: staff profile photo
-- ============================================================================
-- Run once in the Supabase SQL editor (project nwbmxdtwebhrqzccozoc), after 001-009.
--
-- ADDITIVE ONLY. One new optional column on employees, and one private storage bucket.
-- Nothing existing changes: staff, scans, corrections, leave and payroll are untouched,
-- and the live site keeps working before, during and after this runs. Safe to run twice.
--
-- The photo itself is NOT stored in the employees table (that table is read by every
-- report, so a picture in it would slow all of them). The file lives in the private
-- bucket "staff-photos"; employees.photo_path only holds the file's name there.
-- The bucket is private: the site shows a photo through a short-lived link it creates
-- for the signed-in person, so a photo address cannot be shared or guessed.
-- ============================================================================

alter table employees add column if not exists photo_path text;   -- file name inside the staff-photos bucket; empty = no photo

-- Private bucket, 2 MB per file, pictures only. (The site shrinks each photo to about 400 px before it is uploaded.)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-photos', 'staff-photos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- Check: the column exists and the bucket is private.
select
  (select count(*) from information_schema.columns where table_name = 'employees' and column_name = 'photo_path') as photo_column_present,
  (select count(*) from storage.buckets where id = 'staff-photos' and public = false) as private_bucket_present;
