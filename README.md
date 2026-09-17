# Beta Bridges Operations Management Platform

Internal operations management platform MVP for Beta Bridges.

## Current MVP scope
- Dashboard and role-aware navigation
- Daily Job Listing
- Daily Job Done
- Used Stock
- Techie Weekly Activity
- Miscellaneous Charges
- Client Data
- Tasks & Reminders
- Six-role permission model
- Supabase/PostgreSQL schema with RLS foundation
- Google Sheets integration mapping
- Audit log and Google connection schema

## Roles
1. Super Admin
2. Operations
3. TSS Officer
4. Field Technician
5. Finance
6. Viewer

## Business rules preserved
- `NUMBER OF JOBS` in the legacy Daily Job Listing represents the number of vehicles covered by one project/assignment. The application model uses `number_of_vehicles` while retaining the legacy mapping.
- `DEVICE ID` in Daily Job Done is the unique tracker/device identifier. It is separate from the internal operational `Job ID`.
- TSS Officer cannot edit `Techie Assigned` on Daily Job Listing.
- Operations cannot edit Device ID, SIM ID or Date Issued in Used Stock.
- Finance can edit Device ID, SIM ID and Date Issued in Used Stock.

## Environment
Copy `.env.example` to `.env.local` and provide the Supabase public project URL and anon key when a Supabase project is connected. Google OAuth values will be added when Google Sheets synchronization is enabled.

## Database
The initial schema is in `supabase/schema.sql`. Apply it to a new Supabase project before enabling production persistence/authentication.

## Google Sheets
The six supplied legacy spreadsheets are mapped in `lib/googleSheets.ts`. Initial synchronization direction is platform-to-sheet so the application can remain the operational source of truth while the legacy sheets remain available for reporting and continuity.

## Verification
A GitHub Actions workflow in `.github/workflows/ci.yml` runs dependency installation and `npm run build` on pushes and pull requests to `main`.

The current environment could not reach GitHub/npm directly, so local build verification has not been claimed; GitHub CI is the repository verification path.
