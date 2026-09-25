# Beta Bridges Operations — Production Go-Live Checklist

## Security and QA
- QA workflow fixtures removed from production data: test job, test vehicle, test completion, and test tasks.
- QA audit history retained.
- All operational/public application tables verified with Row Level Security enabled.
- Google OAuth refresh token is stored encrypted server-side; the application does not expose it to clients.

## Roles and access
Initial roles are:
- Super Admin
- Operations
- TSS Officer
- Field Technician
- Finance
- Viewer

Role-driven users use NULL module_access. Viewer is the only role permitted to use a module-access override.

Current active production profiles:
- Super Admin: tracking.betabridges@gmail.com
- TSS Officer: tss.betabridges@gmail.com
- Field Technician: techie.betabridges.com@gmail.com

The Super Admin account has the connected Google OAuth token required for scheduled synchronization. Other application users do not need Google OAuth access for the scheduled server-side sync.

## Google Sheets
Six configured legacy modules:
1. Client Data
2. Daily Job Listing
3. Daily Job Done
4. Used Stock
5. Miscellaneous Charges
6. Techie Weekly Activity

All six connections are active and set to bidirectional.

The synchronization engine:
- imports changes from legacy sheets into Supabase;
- exports platform changes back to the legacy sheets;
- keeps stable UUID-based BB SYNC ID values in five row-oriented sheets;
- detects simultaneous platform/sheet changes and blocks unsafe automatic overwrite;
- creates missing date tabs for date-oriented modules when needed;
- records synchronization state and conflict counts in google_sync_states.

## Automatic synchronization
Production cron route:
GET /api/cron/google-sync

Schedule configured in vercel.json:
*/5 * * * *

The route requires a production CRON_SECRET bearer token.

## Final Vercel activation
Before declaring automatic synchronization fully active in production:
1. Add a strong CRON_SECRET environment variable to the Vercel Production environment.
2. Ensure the latest main deployment containing the bidirectional sync engine is READY.
3. Verify the cron appears under Vercel project Settings → Cron Jobs.
4. Run one manual sync from Administration → Google Sheets and confirm all six modules report success.
5. Make one controlled edit in a legacy sheet and verify it reaches the platform on the next scheduled run.
6. Make one controlled platform edit and verify it reaches the corresponding legacy sheet.

## Important sync behavior
Automatic add/edit synchronization is implemented. A simultaneous change on both sides is treated as a conflict rather than silently overwriting one side.

Deletion propagation is intentionally not automatic yet: deleting a legacy-sheet row does not currently delete the corresponding platform record. Until explicit deletion semantics are added and tested, platform records remain protected from accidental deletion by sheet edits.
