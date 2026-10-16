# Song Fa HR revamp

Revamp of the Reportpuller into an HRM Hub style system for Song Fa Water Tanks. Same repo, same Supabase project, same Vercel project. Built on the `revamp` branch; `main` keeps serving the live site until cutover.

## Ground rules
1. Nothing already working may break and no data may be lost.
2. The HRM Hub project is a read-only reference. Never modify it.
3. Database changes are additive only (new tables, new nullable columns). Jea runs each migration file; Claude never runs DDL against the Song Fa database.
4. Devices are read-only. No feature may write to or clear a fingerprint reader.
5. Nothing is pushed or deployed from `revamp` without Jea's approval. Cutover (merging to `main`) is a separate decision.

## Architecture
- Next.js 14 (App Router), React 18, Tailwind 3, TypeScript for UI and routes.
- The punch engine stays CommonJS and is reused unchanged: `lib/attendance.js`, `lib/zkpull.js`, `lib/zk-readfix.js`, `lib/pinremap.js`, `lib/store.js`.
- Pages are server components reading through `lib/report-data.js`; filters are URL parameters.
- Auth keeps the existing `rp_session` cookie and `login_users` table, so current sessions and the four admin accounts carry over.
- `legacy-public/` holds the old UI for reference; the Express server (`npm start`) still runs it. It is deleted at cutover.
- `public/sw.js` retires the old service worker so browsers drop the cached legacy app.

## Done (phase 1, no database changes)
Next.js foundation, design system, sign-in, app shell, Live, Reports (daily and summary, URL filters, Excel export), Staff (read-only list), Devices (read-only), cron pull route.

## Done (phase 2, needs migrations/001 run by Jea)
- migrations/001_shifts_departments_staff_profile.sql: departments, shifts, shift_assignments (no-overlap constraint), staff profile columns, starter shifts from existing staff times. Additive and idempotent; validated against a copy of the real schema in an in-memory Postgres.
- Engine: date-aware rule per staff (rotating shifts). With no assignment the output is byte-identical to the old engine (checked on 201k staff-day rows, summaries and a monthly timesheet).
- Pages: Shifts, Departments, Staff add/edit (profile, shift, own hours, off days, aliases), per-person rotation, bulk Rotation. All show a setup notice until the migration is run.
- Design rule: a shift's START and END are copied onto employees.time_in/time_out, so the engine and the legacy app read the same columns. A person's weekly days off stay their own (employees.off_days): on the real data 14 staff on the 07:00-17:00 shift have a different day off, so a shift's off days are only the default for new staff and for rotation periods. Editing a shift never changes anyone's days off.
- Verified against the live database (migration run 2026-10-16): 33 write checks plus the forms exercised in the browser; the database was left byte-identical (content hashes) after the throwaway test records were removed.

## Done (phase 3; migration 002 run by Jea 2026-10-16 and verified live)
- migrations/002_leave_holidays_roster.sql: leave_types (5 standard types, no default days), leave_entitlements, leave_requests (no-overlap for full days), public_holidays, day_overrides.original_status. Additive; validated in an in-memory Postgres copy of the schema (idempotent, existing overrides untouched, overlap rules, PIN-rename cascade).
- Engine: public holidays and approved leave as lower layers (manual override > approved leave > shift > holiday > day off > absent); half-day leave counts 0.5 and keeps worked hours. With no holidays or leave the output is byte-identical to the previous engine (1.22M staff-day rows on the local August copy; 11 synthetic precedence checks).
- Employment window: no rows before joining_date or after resigned_date.
- Pages: Roster (month grid, status/hours, corrections), Correct a day (scans, current correction, original status audit), Leave (queue, record, approve, reject, cancel), Leave types, Entitlements, Holidays, timesheet Excel export. Stable ordering added to override and punch queries.
- Entitlements are set by HR per person and year. HRM Hub's auto-calc rules encode LPT job titles and were deliberately not copied.
- Verified live: 56 scripted write checks + every form driven in the browser (staff, holiday, leave record/approve/reject/cancel, correction save/remove, entitlements, leave types); reports 0 of 201,021 rows differ from the previous engine; all tables byte-identical after the throwaway ZZ records were removed. Bugs found and fixed during verification: timesheet export ignored its month (regex mangled in a shell patch), combined half-day code order depended on row order (now AL/UP by type order), the pending queue and other leave views hid requests outside the current year (now all years), and future days on the roster counted as absent (now blank).
- Known limitation for the payroll phase: a half-day leave row has status leave, so its worked hours are not in PRESENT_FAMILY totals.

## Still to do on the legacy parity list
Users admin, staff PIN rename, per-device pull action, raw punches view, corrupted-punch view. (Timesheet and day overrides are now the Roster.)

## Next phases (each needs migrations Jea runs)
2. (done, pending migration) Shifts incl. night and rotating, driver trips across midnight, staff profile fields, departments.
3. (built, pending migration 002 and live verification) Roster grid with overrides, leave types, entitlements, requests and review queue, holidays.
4. Payroll: structure, OT tiers (weekday, Sunday, public holiday), allowances, tax, NSSF, bank and cash lists.
5. Roles and permissions, audit trail, batch import.
6. Parallel run against the live site for a full month, then cutover.

## Cutover checklist
- Parity list above complete and diffed against the legacy output for a full month.
- Vercel project framework set to Next.js (already in `vercel.json` on this branch) and env vars confirmed (`SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `CRON_SECRET`).
- Scheduler still calls `/api/cron/pull` with the same bearer secret.
- Remove `legacy-public/`, `server.js`, `api/index.js`.
