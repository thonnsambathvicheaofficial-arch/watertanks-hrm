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

## Done (phase 4: payroll; migration 003 run by Jea 2026-10-16 and verified live)
Decisions confirmed by Jea: monthly salary with pro-rata deduction; overtime suggested from scans and approved by HR; overtime multipliers left empty for Jea to set; salaries in USD with tax and NSSF computed in KHR.
- migrations/003_payroll.sql: settings (one row, everything empty), tax brackets, pay setup per person, company allowances, monthly items, overtime entries, payroll runs and slips. A finalized run and its slips are immutable via a database trigger (validated in an in-memory Postgres). Additive and idempotent.
- Nothing is assumed: overtime multipliers, work days and hours per month, exchange rate, brackets and NSSF rates start empty. A run can be generated but not finalized until what its slips need is set; each slip lists what is missing. A button copies HRM Hub's current statutory values into empty boxes only, never overwriting.
- lib/payroll-calc.js: same chain as HRM Hub (cross-checked on 5,000 random inputs, 0 differences, apart from showing no relief for tax-exempt people) with configurable rates.
- Overtime: scans suggest (holiday or day off: all hours; normal day: time past shift end, 8 h cap, optional threshold); HR approves, edits or rejects; approve-all for a month. On real September data a 0-minute threshold suggests 2,038 entries (89% of worked days) because people scan out at 17:00 to 17:14; 30 minutes gives 408.
- Pages: Payroll (months), month view with finalize and exports (register, bank, cash, NSSF), printable payslip, Overtime, Monthly items, Pay setup, Payroll settings.
- Verified live: 60 scripted write checks (hand-calculated slips to the cent, all four exports, finalize, and the database trigger refusing edits, deletes, inserts and reopening when the app is bypassed) plus every form in the browser (settings, fill from HRM values, brackets, pay setup, monthly items, overtime incl. suggest and bulk reject, generate, discard, finalize, payslip, exports). The live settings row was restored to empty afterwards. Two locked test runs (2030-12, 2031-01, test people only) remain until migrations/cleanup_test_payroll.sql is run by Jea. Found and fixed while testing: absence deduction now capped at the salary; negative net pay is flagged on the slip; slow actions show progress and block double clicks; the brackets form keeps typed values after an error.
- Known limits: mid-month joiners and leavers are not prorated (the slip says so; use an adjustment); a hand-made leave correction counts as paid; employer NSSF label order (health 0.8 / risk 2.6) follows HRM Hub and should be checked against the regulation.

## Done (phase 5: roles, audit trail, import; migration 004 run by Jea 2026-10-16 and verified live)
- migrations/004_roles_audit.sql: roles and their permissions, an append-only audit log (database trigger refuses updates and deletes), and two columns on login accounts (role, switched off). Additive and idempotent; existing accounts keep working and are treated as administrators until given a role.
- Access model: administrators can do everything and manage accounts and roles. Every other account can do exactly what its role allows (14 permissions across attendance, staff, leave, setup, payroll, audit, import; an edit permission includes the matching view permission). No role means no access. A page or action not in the table in lib/permissions.js needs an administrator, so anything new is private by default. Before migration 004 is run, non-administrators are read-only.
- Enforced in four places: every page calls guard() (Next.js does not re-run layouts on navigation); every action goes through act(), which checks the permission and logs denials; every export and template route calls denyUnless(); the sidebar only shows what the account can open. tests/permissions.test.js reads the source tree and fails if a page, action or route is unguarded.
- Pages: Accounts (create, change role, reset password, switch off, delete; the last active administrator and your own account are protected), Roles (templates, permission matrix, delete), Audit log (filter by who, area, dates and text; Phnom Penh time; expandable before and after values; Excel download), Import.
- Audit trail: who, when and what for staff, shifts, departments, rotation, leave, holidays, corrections, payroll (generate, items, overtime, settings, finalize), pay setup (bank account masked), accounts, roles, sign-ins (success and failure), denied attempts and imports. Anything an action changes without a detailed entry still gets a one-line entry.
- Import (staff details, pay setup, holidays, leave entitlements, day corrections): download a template with current data, edit, upload. The file is checked and compared with what is saved (new, changed, unchanged, error per row, with reasons) before anything is written; blank cells never erase anything; applying goes through the same store functions as the pages, in small batches, so validation and the audit log are identical to a single edit. Needs import.run plus the permission to change that kind of data.
- Verified live (real database, ZZ accounts and roles only, all removed afterwards): 100+ scripted checks over real HTTP. A view-only account opens exactly its pages and is sent to no-access for the rest; a payroll-only account likewise; an account with no role opens nothing; exports and templates answer 403 (401 when signed out); a role change takes effect; a switched-off account cannot sign in and an existing cookie stops working; you cannot switch off, demote or delete your own account; deleting a role leaves its accounts with no access; the database refuses to edit or delete an audit entry, singly or in bulk; no password or hash ever appears in an entry. In the browser: a forced submit from a view-only account was refused with a message and logged as a denied attempt; roles (template, edit, delete) and accounts (switch off, delete) driven through the forms. One bug found and fixed: the Correct-a-day form was reachable by view-only accounts. View-only accounts now see a notice and switched-off saving forms (courtesy only; the server still refuses).
- Run migrations/cleanup_test_audit.sql once to remove the test audit entries (names starting ZZ). Entries made by the real account "Test Account" while driving the Roles page (a Viewer role created, edited and deleted) are genuine records and stay.

## Done (phase 6a: legacy parity; no migration needed; uncommitted)
- Devices: add, edit and remove devices (removal refused while the device has scans stored, so nothing is detached), "Read now" per device with an optional full read (read-only toward the device, same read as the scheduled sync; tried live on K40: worked), a page of scans held aside (kept, never deleted), public host and port shown. Device wipe is deliberately NOT ported.
- Staff: Change PIN (scans, corrections, rotation, leave, entitlements and pay setup move together; refused when the new PIN already has scans or belongs to someone; the old PIN is kept under Other PINs by default; finalized payslips keep the PIN they were issued under) and Unlisted PINs (active fingerprint IDs not on the staff list, one click to add as staff).
- Default work hours page (start, end, grace for staff with no shift or own times, with how many people it affects).
- Reports: Raw scans view (newest 1,000, Excel export has all).
- All of it audited (device add/edit/remove/read, PIN change, work hours); permissions: devices and work hours need setup.edit, Unlisted PINs staff.edit.
- Verified live with ZZ records: 28 checks (rename incl. refusals and cascade, device add/edit/read-unreachable/remove-with-scans refused, held list), every table's hash identical afterwards; pages 200; Read now on K40.

## Done (phase 7a: fuller staff profile; migration 005 written, NOT yet run by Jea)
- migrations/005_staff_profile_extended.sql (validated in an in-memory Postgres: additive, idempotent, unique staff ID, gender M/F, line manager follows PIN renames): Staff ID, Khmer name, gender, date of birth, marital status, ID card number, NSSF number, address, personal email, emergency contact and phone, contract type, probation end, line manager, reason for leaving. Bank details stay in Pay setup.
- Staff form in sections (Identity, Employment, Contact, Working pattern) and the staff list shows Staff ID, Khmer name and position and searches them. Before migration 005 the new fields are simply hidden and every page works as before.
- Import (Staff details) matches a row to a person by PIN, then Staff ID, then exact name (spelling and spacing ignored); a row that matches nobody is an error (a new person needs a PIN). It finds the heading row even under a title, reads a blank-headed Khmer name column, keeps Excel line numbers, and creates departments the file introduces (the preview says which).
- data/staff-profile-import.xlsx (git-ignored) is the company staff list with PINs added: 110 of 112 people matched (105 exact, 5 with spelling differences listed on its "Check these" sheet). Two people in the file have no PIN on the system, and two system staff are not in the file.

## Done (phase 8, step 1: Telegram scan notifications; migration 006 written, NOT yet run by Jea)
- migrations/006_telegram_notifications.sql (validated in an in-memory Postgres): a settings row (off by default) and a delivery log with one row per scan (unique, so a scan is announced exactly once). The bot token is never stored: it is the TELEGRAM_BOT_TOKEN server setting.
- lib/notify.js: after each device sync saves scans, announces new ones in the Telegram group (name, Khmer name, department, group, date, time). Only scans saved after notifications are switched on, never older than 30 minutes, ignores a repeat scan within 2 minutes, scans are remapped like the reports, one message each up to 12 waiting then digests (Telegram allows ~20 a minute), failed sends retried up to 5 times, never blocks or breaks the sync.
- Settings page /settings/notifications (administrators only): on/off, group ID, who to announce (everyone/office/workers, departments), the three thresholds, "Send test message" (reports which bot and group it reached), delivery log. Audited. Hooked into /api/cron/pull and the Devices "Read now".
- Speed: step 1 announces within a sync (up to 5 minutes). Step 2 (not built): a 55-second loop each minute polling every ~10 s with a tail read, for about 10-15 s delay. Needs the scheduler and Vercel plan details from Jea.

## Done (phase 8, step 1b: leave in the Telegram messages; migration 007 written, NOT yet run by Jea)
- Telegram message now: clock + time, Punch in/out/Repeat scan, late minutes (from the report engine), and leave context: morning half-day first scan = "Back from morning leave" (never late), afternoon half-day punch out = "Afternoon leave", any scan on full-day approved leave = "On approved leave today" flag; the leave type shows on the third line. The Khmer name is not in the message. Pending requests are not shown; no afternoon-start lateness rule (reports unchanged).
- migrations/007_telegram_leave_digest.sql: optional daily "On leave today" list (full day, morning, afternoon sections), sent once per working day at a chosen time (default 07:30, up to 3 hours later), skipped on days off, holidays and when nobody is on leave; claimed before sending so it is sent once. Settings page has the checkbox and time once 007 is run.
- Leave period (morning/afternoon) and leave type name now travel with each leave day (lib/leave-calc.js, lib/leave-store.js); no schema change.

## Done (phase 9: live updates; migration 008 written)
- lib/zk-tail.js reads only the newest scans from a device (checked read-only against the K40 and B3-C: identical to the last records of a full read; K40 0.2 s vs 0.6 s, B3-C 0.65 s vs 2.3 s).
- lib/zkfast.js + /api/cron/fast: asks each device for its record count (about 50 ms), reads the newest records only when it grew, saves them, then runs the Telegram notifier. One check per device at a time (lease), baseline in devices.fast_count (migration 008). The full sync remains the completeness safety net.
- db/pg-cron-fast-poll.sql: Supabase pg_cron tickers: every 5 s Mon-Sat 06:00-18:59 and every 30 s at other times (about 256,000 calls a month, sized for the Vercel Hobby limits: 1M invocations, 4 h Active CPU; check Usage after the first full day). scripts/live-poll.js (npm run live): the same ticker from any computer.

## Still to do on the legacy parity list
None known beyond the cutover checklist below.

## Next phases (each needs migrations Jea runs)
2. (done, pending migration) Shifts incl. night and rotating, driver trips across midnight, staff profile fields, departments.
3. (built, pending migration 002 and live verification) Roster grid with overrides, leave types, entitlements, requests and review queue, holidays.
4. (built, pending migration 003 and live verification) Payroll: structure, OT tiers (weekday, day off, public holiday), allowances, tax, NSSF, bank and cash lists.
5. (done, verified live) Roles and permissions, audit trail, batch import.
6. (a: parity done) Parallel run against the live site for a full month, then cutover (Jea's decision and deploy).

## Cutover checklist
- Parity list above complete and diffed against the legacy output for a full month.
- Vercel project framework set to Next.js (already in `vercel.json` on this branch) and env vars confirmed (`SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `CRON_SECRET`).
- Scheduler still calls `/api/cron/pull` with the same bearer secret.
- Remove `legacy-public/`, `server.js`, `api/index.js`.
