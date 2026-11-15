# Super Admin deployment audit — 2026-11-15

## Verdict

Local Super Admin automated checks pass. The current hosted deployment is not ready for the full Super Admin feature set: the required oversight, backup-history, session-management and MFA endpoints return HTTP 404. Do not treat a successful frontend build as a successful backend release.

## Verified locally

- Full backend suite: 223 passed, 1,553 assertions, isolated SQLite database and test mail/storage. Covers account management and authorization, staff authentication, settings, confidential access, audit/report data, MFA, session security, backups, schema compatibility, restore safeguards, and readiness checks.
- Targeted Super Admin UI suite: 48 passed. Covers account actions, reports and exports, settings state, audit pagination and filtering, notifications, health evidence, backup status and dashboard data.
- Shared session/notification checks: 10 passed after updating old test fixtures to reflect the combined audit search, dedicated Super Admin notification module, and activity timer. No production behavior was changed in this audit.
- Super Admin browser smoke: passed with isolated API fixtures. Checks dashboard, sidebar notifications and read/archive states, health table, account/access review, edit-account details, profile sessions, MFA setup/recovery-code display, backup view and mobile overflow. No runtime exceptions.
- 26 Super Admin/shared JavaScript files parsed successfully.
- Frontend build succeeded with UNISERVE_API_BASE=https://uniserve.wasmer.app/api. All 37 local Super Admin asset references exist in the build.

These checks do not prove real mailbox receipt, production database compatibility, persistence after redeployment, or a successful restore of the production database. Browser smoke checks cover representative flows, not every possible button/state.

## Live read-only observations

Frontend origin: https://oss.uniserve.vercel.app
API base: https://uniserve.wasmer.app/api

| Request | Result |
|---|---|
| Frontend home | HTTP 200 |
| API /up | HTTP 200 |
| API /api/settings | HTTP 200 |
| API /api/system/oversight | HTTP 404 |
| API /api/security/mfa | HTTP 404 |
| API /api/security/sessions | HTTP 404 |
| API /api/backup/history | HTTP 404 |
| OPTIONS preflight for oversight | HTTP 204, correct frontend origin and Authorization header allowed |

The correct CORS origin is already allowed. CORS success does not mean a route exists. In the local source the missing routes exist and are protected; anonymous callers should be rejected by authorization rather than receive a missing-route response. No production sign-in, account changes, test emails, backups, migrations, or restores were performed during this audit.

## Deployment gates

1. Preserve an encrypted pre-upgrade backup, original APP_KEY, and matching old source release.
2. Deploy the matching backend release; run migrations and clear configuration as documented in super-admin-deployment-checklist.md. Preserve the application key.
3. Configure persistent shared database/Redis cache and persistent private storage; verify backup files survive a redeploy.
4. Activate the actual host scheduler and worker jobs. Anybuild command declarations alone do not schedule jobs.
5. Run php artisan system:readiness on the host and resolve CHECK results.
6. Deploy the matching frontend with the production API build variable. Re-sign in and smoke-test protected routes and Super Admin actions against the real backend.
7. Confirm a test email in the real inbox; verify an off-server backup and rehearse restoration in isolation with outbound jobs/email disabled.

## Broader frontend checks

Full frontend suite: 221 tests; 215 passed and 6 failed. Remaining failures are visitor ticket/render/download/appointment tests, outside the Super Admin screens. Failures include test contexts missing current ticket helpers and ticket-output assertions. They have not been classified as harmless or repaired in this audit, so the overall application cannot be declared fully green.

Detailed local output: backend/storage/logs/full-ui-audit.txt and backend/storage/logs/super-admin-ui-audit.txt. These logs are not included in the frontend build.
