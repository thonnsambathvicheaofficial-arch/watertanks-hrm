# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
HR and admin office staff at Song Fa Water Tanks, a water-tank factory in Cambodia. They sit at a desktop most of the day and need to know, for ~110 factory and office staff, who was in, who was late, who forgot to scan, and what the month's hours and pay come to. Confirmed: HR / admin office is the only user group for this revamp. Factory managers, workers (self-service) and an owner dashboard are not in scope now.

## Product Purpose
Song Fa's attendance, roster, leave and payroll system, fed automatically by the ZKTeco fingerprint readers on site (K40, B3-C) over WAN port-forwarding. It replaces a bare-bones report puller with an HRM Hub style product (staff records, shifts, roster with overrides, leave, reports, payroll) built for a factory rather than an office. Success: HR closes the month from the roster without hand-patching spreadsheets, and the numbers hold up when a worker disputes them.

## Positioning
Built directly on the live punch data (77k+ scans since 2021-11) and a punch engine that already handles factory realities an office HRM does not: drivers whose in and out straddle midnight, night shifts, devices that log one person under two IDs, and corrupted or phantom timestamps held aside instead of polluting reports.

## Operating Context
- Two fingerprint devices pulled by a Vercel cron every 5 minutes. The devices are only ever read, never written or wiped from the app.
- Timezone Asia/Phnom_Penh. Working week Mon to Sat; Sunday is the usual off day.
- Staff: 111 on record, 83 workers (shift 07:00-17:00) and 28 office staff on 07:00-08:00 starts.
- HR corrects the record through day overrides with a required free-text note, often written in Khmer.
- Exports (Excel, PDF) are how results leave the system, so they must stay correct and Khmer-safe.
- Today's logins are 4 admin accounts in the app's own login table.

## Capabilities and Constraints
- Confirmed scope: attendance (live feed, daily, summary, timesheet, raw punches, roster with overrides), staff profiles and movement, shifts, leave with entitlements, reports, and payroll (Cambodian tax, NSSF, overtime, allowances, bank and cash salary lists), modelled on HRM Hub.
- Confirmed factory needs: night and rotating shifts, drivers and delivery trips paired across midnight, overtime tiers (weekday, Sunday, public holiday).
- Not requested: production lines and teams as a feature, worker self-service, owner dashboard.
- Interface language is English. Khmer names and notes must render correctly in every view, Excel and PDF.
- This is a revamp of the existing Reportpuller, not a new project: same repository, same Supabase project, same Vercel project and URL. Nothing already working may break and no data may be lost. The HRM Hub project is a read-only reference and must never be modified.
- Work happens on the `revamp` branch; `main` keeps serving the live site until Jea approves the cutover. Database changes are additive only and are run by Jea, as migration files provided by Claude.
- Stack decision: move the front end to Next.js, React and Tailwind (the HRM Hub stack) so HRM pages can be copied rather than rewritten. The existing server-side engine (punch pairing, ZK pull, PIN remap) is kept and reused.
- Punch device IDs are fixed by the hardware. PINs overlap with other businesses' ID ranges, so this system is isolated from HRM Hub's data.

## Brand Commitments
Name: Song Fa Water Tanks. A logo exists at `Logo.png`. The sign-in page already carries the Song Fa name and logo.

## Evidence on Hand
- Live data in Supabase: employees, punches, corrupted_punches, day_overrides, device_users, devices, login_users, settings.
- `Logo.png`, `Employee list.xlsx`, `Raw_punches_logs.xlsx` in the project root.
- Absent: any written brand guidelines, colour palette, or user research. Do not invent them.

## Product Principles
1. The raw punch is evidence; never overwrite it. Corrections are overrides and remaps that can be traced and undone.
2. One resolver for in, out and hours, used by every screen and export, so no two views disagree.
3. HR must be able to explain any number on screen back to the scans behind it.
4. Dense, scannable, calm: this is a daily working tool for people reviewing ~110 rows, not a showcase.
5. Existing data and URLs outlive the redesign.

## Accessibility & Inclusion
Khmer script must display correctly in the UI and in exports. Usable on a desktop browser first, readable on a phone for quick checks.
