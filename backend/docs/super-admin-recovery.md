# Super Admin oversight and recovery

## Deployment compatibility

The correct frontend origin is `https://oss.uniserve.vercel.app`, and its configured API is `https://uniserve.wasmer.app/api`. On November 13, 2026, a live preflight request from that exact origin returned 204 with `Access-Control-Allow-Origin: https://oss.uniserve.vercel.app`, allowing GET/POST/PUT/PATCH/DELETE/OPTIONS and authorization/content-type headers. CORS is working for the correct origin; no live environment change is required. An earlier check against the different, hyphenated hostname was not applicable and must not be used to diagnose this deployment. The local production fallback, examples and tests now use the confirmed dotted hostname. The new oversight/history API routes still require deploying the matching backend release.

The repository's `Anybuild` targets Wasmer PHP 8.4. Local Wasmer credentials belong to a namespace that did not list the UniServe app, so live volume, scheduler and worker configuration could not be verified or changed through that account. Confirm ownership in the Wasmer dashboard before deploying. Do not infer persistent backup storage merely because `/up` responds. Wasmer volume and scheduled-job setup are host-side prerequisites; none was provisioned by these changes.

Wasmer apps can scale down without traffic; do not rely on an unconfigured always-on `schedule:work` or `queue:work`. The `Anybuild` now declares bounded `scheduler` (`php artisan schedule:run`) and `worker` (stop when empty, maximum 45 seconds) commands. Configure the app's Wasmer scheduled jobs to execute these commands every minute, using shared database cache for Laravel overlap locks. Keep job retries at zero for the scheduler invocation; Laravel's own commands/locks control overlapping tasks. Check the resulting host job logs. These command declarations do not create or activate host jobs themselves. Preserve existing volume names/mounts when changing deployment settings.

The frontend is static (Vercel builds it with `node scripts/build-frontend.cjs`). The API, database, scheduler, mail worker and Reverb run on the separate Laravel host. A frontend deployment alone cannot install API routes or execute backups.

Deploy the matching backend release before the frontend. This update adds nullable MFA columns. Preserve a pre-upgrade encrypted backup and the matching old release, then run `php artisan migrate --force` before serving the new API. Backups from the previous schema require that matching release for restore; the new restore checks intentionally reject mismatched columns. Preserve the existing application key. Refresh cached configuration and restart supervised workers after deploying. Set Vercel `UNISERVE_API_BASE` to the HTTPS API base ending in `/api`, and allow the actual frontend origin through API CORS. Do not publish `.env` or copy an application key into frontend configuration.

The System Health and Access Review endpoints require a valid Super Admin bearer token. An older API returns a clear upgrade message; the frontend must not substitute local browser data for missing server evidence. Health responses and backup downloads are `no-store`.

Health checks mean:

- **API/database responding:** the authenticated request and queries succeeded at the shown timestamp.
- **Scheduler/worker observed:** a heartbeat was recorded within three minutes. This is not proof that every task succeeds. Use persistent shared cache (normally database or Redis), and run the scheduler/worker with the same configuration as the API. An unobserved heartbeat is **unverified**, not an assertion that a process is stopped.
- **SMTP configured:** required SMTP settings exist. This does not prove transport connectivity or inbox delivery. Confirm with a controlled test email and real inbox.
- **Live updates:** the browser's actual staff-channel subscription; backend Reverb configuration alone is not a healthy connection.
- **Account inactivity:** last retained server `Signed in` audit event, not `updated_at`. Missing history means unknown. Review begins after 90 days; accounts are never disabled automatically.
- **Security:** recent server failed/denied events and malformed audit structures. These are review cues, not a complete intrusion detector. Browser checksums and structural checks cannot establish a tamper-proof server audit log. Retain independent protected audit copies if that assurance is required.

## What the backup contains

The encrypted JSON is an **application database backup**: staff accounts, configured services, appointments, queues/counters, service records, visitor logs, chats, confidential access records, office settings/calendar, audit history and notification outbox. Documents/templates stored as data URLs inside encrypted database payloads are included.

It deliberately excludes deployment secrets, `APP_KEY`, application source, migration files, runtime cache, sessions and queued jobs. Keep the source release/schema and secrets separately. Never regenerate the original key: encrypted records and keyed email indexes depend on it. A server export alone is not complete disaster recovery.

Exports lock the selected rows in a fixed order in a transaction. Run production recovery exports during a quiet/paused period; for large installations or stronger point-in-time guarantees use the database host's consistent snapshot/PITR tools alongside this application export. Only transactional MySQL tables are accepted for restore. Test SQLite is used only for isolated automated checks; production MySQL and filesystem permissions still need a staging rehearsal.

## Creating and retaining backups

The UI creates an encrypted export, validates decryption, complete table coverage and current columns, writes a private server copy, verifies its checksum and records metadata. Download it to a separate secured location. Verify-and-download checks the stored checksum and schema again. History shows only the newest 20 indexed files, and does not assert a restore rehearsal has happened.

Private server copies and metadata are under `storage/app/private/activity-backups`. Mount this directory on persistent storage. Local disk on an ephemeral container will not survive redeployment. Server-local copies protect against an accidental restore, but not loss of the server.

The API host can create a backup with:

```text
php artisan backup:create
```

For daily 2:00 AM Asia/Manila exports, set `BACKUP_SCHEDULE_ENABLED=true` **on the API host**, rebuild cached configuration, and run the Laravel scheduler continuously. Keep it false until persistent storage and an off-server copy/retention process are ready. No backup is automatically deleted. Monitor available space; set an institution-approved retention period and regularly copy encrypted files and their metadata to separate secured storage. Keep the encryption key in a different protected store. Multi-node installations need shared private backup storage or a designated scheduler host; local-only files are not shared across nodes.

Large exports exceeding the browser's roughly 28 MiB export / 30 MiB upload limit require operator CLI recovery. Web server request-body, PHP memory and request timeout limits must also be sufficient. The UI permits up to two minutes, but host limits may be shorter.

## Verify versus restore

Verification never replaces application records. It checks the encryption and table/column compatibility. **It is not a restore test.** Partial older exports may be inspected with the CLI `--verify` option but are refused for replacement. Restore a historical schema only using the matching release in an isolated environment, then follow a reviewed migration procedure.

```text
php artisan backup:restore /secure/path/backup.json --verify
```

For a real recovery, use a planned outage: block API writes, stop scheduler and all queue workers, preserve the original key and current data, and prepare the matching migrated schema. The visitor portal's maintenance flag alone does not stop staff updates or background jobs. The command asks for explicit confirmation:

```text
php artisan backup:restore /secure/path/backup.json
```

The web preview also requires typing RESTORE. Preview payloads are staged in private storage and only a small, actor-bound, ten-minute token reference is cached, avoiding database-cache size limits. The scheduler removes temporary preview files older than one hour; this cleanup never deletes saved backups. Both paths validate complete tables, save a pre-restore private recovery file, replace within a transaction, pause restored pending/failed outbox emails, and invalidate earlier staff tokens. They share the same restore implementation. The cache-backed staff-token epoch requires persistent shared cache. Queue jobs are not restored or replayed; operators must drain/remove obsolete queued work as appropriate before restarting workers. Do not clear the shared cache immediately after restoration because it holds the new session epoch.

If a request times out, inspect backend results and history before retrying: a lost browser response is not proof of rollback. A committed restore must not be repeated blindly. If schema constraints reject insertion, the transaction rolls back application records; a pre-restore safety file can still remain in private history.

Rehearse in an **isolated database** with the original key, mail transport set to log/array, and outbound workers/Reverb stopped. Check counts, representative document payloads, staff sign-in, role permissions and calendar settings. Record that drill and its date in your operational recovery log. Only after these checks should production services resume.

## Validation performed by the codebase

Feature tests use only SQLite `:memory:` plus fake private storage. They cover Super Admin authorization, missing heartbeat evidence, inactivity review, encrypted export completeness, corrupted files, partial backup rejection, restore rollback, recovery history and staff-token invalidation. UI tests and mocked browser checks do not contact the production API. These checks do not substitute for a production-host restore rehearsal, SMTP receipt, persistent-volume verification or off-server retention verification.

## Security controls and deployment verification

Run `php artisan system:readiness` on the API host after migration and after configuring host jobs. It checks debug mode, the shared cache driver, schema, database, private storage read/write and recent scheduler/worker heartbeats without exposing secrets. A passing read/write probe does not prove volume persistence. Verify storage across a redeploy, then copy a backup off-server and rehearse restore on an isolated database with outbound delivery disabled. Never run a rehearsal against production.

Existing staff must sign in again after this release. API idle timeout uses token-bound shared-cache state; polling does not extend it. Genuine UI activity posts to `/api/session/activity`. Tokens also expire after one hour. Account creation, password resets, activation, permission changes, deletion, session revocation and web restore require a password confirmation bound to the current token for five minutes.

My Profile offers optional authenticator-based two-step sign-in and own active-session revocation. MFA setup is not enabled until a valid code is entered. Save the eight one-use recovery codes outside the system. Enrollment secrets are encrypted in the database; recovery codes are stored as hashes. MFA changes invalidate previously issued tokens. A trusted server console can recover a lost authenticator using `php artisan security:reset-mfa USERNAME`, with explicit confirmation and an audit event. Password reset does not remove MFA.

System Health can send a rate-limited test email to the signed-in Super Admin email only, after password confirmation. A successful transport send is not inbox delivery; match the displayed reference in the real inbox. No real email is sent by the automated tests.

Authenticator generation and validation are tested against the SHA1 test vectors in [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238). This does not replace a security review of the deployed application.
