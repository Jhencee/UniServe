# UniServe

Laravel API and static portals for visitors, Admin and Super Admin. Portal entry points are Landing/landing.html, User/user.html, Admin/admin.html and Super Admin/superadmin.html in the parent directory.

New installations create their first account with `php artisan portal:create-super-admin`; migrations do not install default credentials.

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

Confidential appointment intake before service uses the staff confidential-access permission. Once linked to a completed case, appointment details and notification actions require the same case permission and active unlock as queue and transaction records. Restricted queue responses use a safe-field list. Super Admin feedback is aggregate-only, including rating distribution and comment counts; visitor identities and comment text are excluded.

Private payloads and uploads are encrypted. Browser caches retain sanitized metadata; private records stay in tab memory. Keep shared privacy/cache/realtime scripts and their HTML loading order. API/UI helpers load before page scripts, and synchronization wrappers load after them. Asset changes require a query-string version update.

Visitors choose a service (purpose), preferred office, date and an available 30-minute slot before submitting. Requested slots reserve capacity immediately; staff approve the chosen schedule or reschedule through live availability. Requested, Booked and Checked-in appointments count toward per-office capacity. Submission and staff scheduling share the office calendar lock to prevent concurrent double-booking. Cancellations and rescheduling release the previous slot. Super Admin settings manage office names and slot capacity; all offices use the shared calendar. Existing requests without a slot can still be scheduled by staff. Staff check visitors in at the counter, then call, start and complete service. Document reviews, optional earlier-slot waitlists and dated follow-up tasks use the same encrypted appointment record. Waitlist changes require staff confirmation. Old active visits become Unfinished, not Completed.

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

## Visit process checks

Open the portals through your existing local HTTP server. Refresh the Admin and Visitor tabs after updating assets.

| Change | Where to check | What to try |
| --- | --- | --- |
| Corrected documents | Admin → Appointments → review uploaded requirements; Visitor → My Visit → Uploaded requirements | Mark a file **Needs correction** with a reason. The verified visitor can choose a corrected PDF/PNG/JPEG and **Submit replacement**. It becomes **Pending review**. Staff can open **Previous document versions**; earlier files remain encrypted on the server. |
| Pending request deadline | Visitor → My Visit; Admin → Notifications | A request shows its staff review deadline: 24 hours after submission or the requested slot, whichever comes first. Overdue review appears in staff notifications. When an unconfirmed slot passes, the scheduler releases it and marks the request **Needs rescheduling** without recording a no-show. Staff can confirm a new slot using the existing request. |
| Arrival window | Admin → Appointments → Check in | Normal check-in opens 30 minutes before the appointment and ends at the configured no-show threshold. Outside that window, staff must enter an override reason, which is audited. Early check-in does not permit calling a scheduled visitor before their appointment. A booking already marked No-show must be rescheduled. |
| Case ownership and resolution | Admin → Transactions → incident/concern detail | Set **Responsible Admin**, **Next action due**, **Next action**, and escalation. Resolving or reopening requires notes. **Case activity** retains changes; concurrent stale saves are rejected. The completed visit and the open/resolved case retain separate statuses. Confidential ownership must also be authorized through the existing Head Admin assignment/access process. |
| Other email providers | Visitor → appointment, walk-in, chat, or Visit History | Use a valid institutional, Outlook, Yahoo, or other email address. Inbox verification remains required. |
| Assisted intake | Admin → Queue → **Assisted walk-in** | Leave email blank, enter visitor details and an identity-check note, then **Issue ticket**. Use **Print ticket**. Existing opening hours, capacity, and priority rules still apply. Explain that updates and recovery are handled at the OSS counter after checking identity. A Visit ID alone does not grant online record access. |
| Multiple follow-ups | Admin → Appointments → detail → **Follow-up tasks** | Add two tasks, assign responsible Admins, and set due dates. Edit one without overwriting the other. Completing requires notes. Staff can expand task history. Visitors see their actions in My Visit. Overdue tasks appear in Notifications; tasks more than two days overdue also appear for the Head Admin when access permits. |

### Services and verification

The scheduler must be running for automatic request expiry, no-shows, and email delivery. The existing worker and SMTP setup are still required for verification emails and other queued mail. No database migration is needed for these changes.

From `backend`, run `php artisan schedule:work` for the local scheduler. To process elapsed unconfirmed slots immediately, run `php artisan appointments:review-pending`. This updates real records; use only when you intend to apply the expiry rule.

Automated checks use SQLite in memory and mocked browser API responses, without changing live records:

```powershell
cd backend
php -d extension=pdo_sqlite -d extension=sqlite3 vendor/bin/pest
node --test tests/ui/*.test.cjs
node tests/browser/run-process-preview.cjs
```

The browser runner needs Chrome at its existing Windows install location and free localhost ports 8765/9224. It saves mobile screenshots under `backend/storage/app/private/flow-checks`.

SMTP inbox receipt and physical printing need a manual check in the configured deployment; the automated browser check verifies the ticket and print action without opening a print dialog.
