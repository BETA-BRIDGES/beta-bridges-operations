# Beta Bridges Operations Management Platform

Internal operations management platform for Beta Bridges.

## Current MVP scope
- Dashboard and role-aware navigation
- Supabase authentication entry point
- Profile-based role loading
- Daily Job Listing
- Daily Job Done
- Used Stock
- Techie Weekly Activity
- Miscellaneous Charges
- Client Data
- Tasks & Reminders
- Six-role permission model
- Supabase/PostgreSQL schema with RLS and server-side field restrictions
- Supabase persistence for Jobs and Tasks
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
- TSS Officer can create/edit Daily Job Listing information but cannot change `Techie Assigned`.
- Operations can view Daily Job Done and add a remark, but cannot change the underlying completion fields.
- Operations cannot edit Device ID, SIM ID or Date Issued in Used Stock.
- Finance can edit Device ID, SIM ID and Date Issued in Used Stock.
- Super Admin controls user permissions, task assignment, reminders, notifications, integrations and administration.

## Environment
Copy `.env.example` to `.env.local` and provide:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
```

Never commit `.env.local` or private credentials.

## Supabase setup
1. Create a Supabase project.
2. Apply `supabase/schema.sql` in the Supabase SQL editor.
3. Apply `supabase/001_bootstrap_security.sql` after the base schema.
4. Create the first user through Supabase Authentication.
5. Sign in through `/login`.
6. The first authenticated user can complete the one-time Super Admin bootstrap from the app. Subsequent users must be provisioned by Super Admin.
7. Add the Supabase public URL and anon key to the deployment environment.

## Google Sheets
The six supplied legacy spreadsheets are mapped in `lib/googleSheets.ts`. Initial synchronization direction is platform-to-sheet so the application remains the operational source of truth while the legacy sheets remain available for reporting and continuity.

## Verification
A GitHub Actions workflow in `.github/workflows/ci.yml` runs dependency installation and `npm run build` on pushes and pull requests to `main`.

The current environment cannot reliably reach GitHub/npm directly, so local build verification has not been claimed; GitHub CI remains the repository verification path.
