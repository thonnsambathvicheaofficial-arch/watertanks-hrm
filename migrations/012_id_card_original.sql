-- ============================================================================
-- Migration 012: keep the ORIGINAL ID card PDF as well as the cropped card picture
-- ============================================================================
-- Run once in the Supabase SQL editor (project nwbmxdtwebhrqzccozoc), after 011.
--
-- ADDITIVE ONLY. One new optional column on employees, and the private "staff-ids" bucket is
-- widened to accept PDF files (up to 4 MB). Nothing existing changes: staff, scans, corrections,
-- leave, payroll and the ID card pictures already saved are untouched, and the live site keeps
-- working before, during and after this runs. Safe to run twice.
--
-- HR uploads a scanned PDF of the ID card. The site shows the front of the card cut out as a picture,
-- and keeps the original PDF next to it so HR can refer back to the whole scan later. Both live in the
-- same PRIVATE bucket; employees.id_card_original_path only holds the PDF's file name.
-- ============================================================================

alter table employees add column if not exists id_card_original_path text;   -- file name of the original PDF in the staff-ids bucket; empty = none kept

update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
       file_size_limit    = 4194304,
       public             = false
 where id = 'staff-ids';

-- Check: the column exists, and the bucket is private, allows PDF and takes 4 MB files.
select
  (select count(*) from information_schema.columns where table_name = 'employees' and column_name = 'id_card_original_path') as original_column_present,
  (select count(*) from storage.buckets where id = 'staff-ids' and public = false and 'application/pdf' = any (allowed_mime_types) and file_size_limit = 4194304) as bucket_ready;
