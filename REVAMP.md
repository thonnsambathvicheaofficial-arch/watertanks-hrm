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

## Still to do on the legacy parity list
Users admin, staff PIN rename, per-device pull action, raw punches view, corrupted-punch view. (Timesheet and day overrides are now the Roster.)

## Next phases (each needs migrations Jea runs)
2. (done, pending migration) Shifts incl. night and rotating, driver trips across midnight, staff profile fields, departments.
3. (built, pending migration 002 and live verification) Roster grid with overrides, leave types, entitlements, requests and review queue, holidays.
4. (built, pending migration 003 and live verification) Payroll: structure, OT tiers (weekday, day off, public holiday), allowances, tax, NSSF, bank and cash lists.
5. (done, verified live) Roles and permissions, audit trail, batch import.
6. Parallel run against the live site for a full month, then cutover.

## Cutover checklist
- Parity list above complete and diffed against the legacy output for a full month.
- Vercel project framework set to Next.js (already in `vercel.json` on this branch) and env vars confirmed (`SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `CRON_SECRET`).
- Scheduler still calls `/api/cron/pull` with the same bearer secret.
- Remove `legacy-public/`, `server.js`, `api/index.js`.
