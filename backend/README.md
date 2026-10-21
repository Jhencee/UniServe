# UniServe

Laravel API and static portals for visitors, Admin and Super Admin. Portal entry points are Landing/landing.html, User/user.html, Admin/admin.html and Super Admin/superadmin.html in the parent directory.

## Setup and services

Keep runtime settings in .env; use .env.example as the configuration reference. Preserve the original APP_KEY: encrypted records, backups, tokens and email indexes depend on it. Never commit credentials or regenerate an existing key.

Install PHP dependencies with composer install. Apply migrations using the authorized schema account; installations with separate migration credentials use php artisan migrate --env=migrations. Keep database recovery files and migration history.

Serve the frontend over HTTP/HTTPS. shared/api-config.js selects the API address; window.UNISERVE_API_BASE can override it before that script loads. Configure FRONTEND_ORIGINS and REVERB_ALLOWED_ORIGINS for the deployment. Use HTTPS and supervised services in production.

For local development, run these commands from backend in separate terminals:

    php artisan serve --host=127.0.0.1 --port=8000
    php artisan queue:work --queue=mail-verification,realtime,default --sleep=1 --tries=3 --timeout=60
    php artisan reverb:start --host=127.0.0.1 --port=8080
    php artisan schedule:work

The worker delivers queued mail and broadcasts. The scheduler handles reminders, no-shows, permission expiry, cutoff notices and previous-day queue closure. Configure SMTP and Turnstile in .env. Browser alerts require an open portal and notification permission.

On Windows, scripts/install-startup.ps1 installs a current-user logon task for scripts/run-services.ps1. That supervisor starts the worker, Reverb and scheduler; start the database and API separately. Its default PHP path is C:/tools/php85/php.exe.

After configuration changes, clear/rebuild the deployment config cache as appropriate. After template changes, run php artisan view:clear. Restart workers using php artisan queue:restart and confirm the supervisor starts replacements. Existing delivered emails do not change.

## Data and access

The backend is the source of truth for shared records. Visitor access requires verified Gmail or an applicable visit-scoped token; a Visit ID alone does not grant access. Staff permissions and confidential access are enforced server-side. Head Admin is an Admin with confidential-approver permission; Super Admin manages system/accounts and receives restricted operational data.

Private payloads and uploads are encrypted. Browser caches retain sanitized metadata; private records stay in tab memory. Keep shared privacy/cache/realtime scripts and their HTML loading order. API/UI helpers load before page scripts, and synchronization wrappers load after them. Asset changes require a query-string version update.

Appointment requests await staff scheduling. Staff check visitors in at the counter, then call, start and complete service. Document reviews, optional earlier-slot waitlists and dated follow-up tasks use the same encrypted appointment record. Waitlist changes require staff confirmation. Old active visits become Unfinished, not Completed.

## Backups and recovery

Use Super Admin's encrypted backup tools and keep the matching APP_KEY separately. UI restore requires a preview and typing RESTORE, replaces listed table records transactionally, merges audit history, and creates a recovery copy under storage/app/private/activity-backups. Restored pending notifications are paused to prevent duplicate delivery.

To verify a backup without replacement:

    php artisan backup:restore PATH --verify

Command-line restoration without --verify does not create the UI recovery copy, pause restored notifications, or clear browser caches. Stop traffic/workers and save a current backup before an intentional restore. Rehearse only against a separate migrated database with the matching key. Schema snapshots under storage/app/private/schema-backups require DBA-assisted recovery; they are not ordinary restore files.

## Checks and tests

Read-only diagnostics:

    php scripts/check-runtime.php
    php scripts/check-connection.php

Inspect storage/logs and php artisan queue:failed when delivery stops. Do not clear jobs as a repair shortcut. Actual SMTP inbox delivery needs a separately authorized delivery check.

Backend tests use an isolated in-memory SQLite database and array mail. Never redirect them to live data. Enable PDO SQLite and SQLite3, then run:

    php vendor/bin/pest

For the local Windows PHP installation:

    php -d extension=pdo_sqlite -d extension=sqlite3 vendor/bin/pest

Frontend tests are tests/ui/*.test.cjs; run each with Node. Browser checks in tests/browser require a static server on port 8765 and isolated Chrome CDP on port 9224; the system smoke also uses the API on port 8000 and live Reverb. Browser mutation checks use API fixtures. scripts/smoke-flow.php is a separate rollback-only MySQL diagnostic that verifies InnoDB before exercising flows.

## Railway deployment

The repository-root Dockerfile serves the portals and API from one HTTPS domain. Supervisor runs Apache, the mail worker, scheduler and Reverb. Use one app replica and a separate MySQL service. railway.json defines the Docker build and /up health check.

Set APP_KEY, APP_URL, DB_CONNECTION=mysql, DB_HOST, DB_PORT, DB_DATABASE, DB_USERNAME, DB_PASSWORD, CACHE_STORE=database, SESSION_DRIVER=database, QUEUE_CONNECTION=database, BROADCAST_CONNECTION=reverb, REVERB_APP_ID, REVERB_APP_KEY and REVERB_APP_SECRET. Reference the MySQL service variables for connection details. Set REVERB_ALLOWED_ORIGINS and FRONTEND_ORIGINS to the public deployment host/origin. Reverb runs internally behind Apache; clients use HTTPS/WSS port 443.

INITIAL_ADMIN_PASSWORD must be a unique strong password of at least 16 characters; INITIAL_ADMIN_EMAIL sets the initial administrator email. Startup replaces the fresh database default password before opening the server. Changed existing passwords are preserved. Preserve APP_KEY and the initial-password variable across redeployments. Configure SMTP and Turnstile through environment variables. Local .env files and database backups are excluded from the image. Fresh deployment does not copy local visitor records.

Docker image validation requires Docker or a Railway build. Persistent application backups require a mounted volume or external storage; container-local files are ephemeral.
