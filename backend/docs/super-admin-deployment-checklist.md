# Super Admin release checklist

## Implemented in this release

- API-enforced idle timeout with interaction-based activity updates; polling cannot extend it.
- One-hour absolute staff-token expiry and fail-closed shared session state.
- Five-minute, token-bound password confirmation for sensitive account actions and web restore.
- Optional Super Admin authenticator setup, verified enrollment, replay protection and one-use recovery codes.
- My Profile session listing and revocation of other sessions belonging to the same account.
- Backend validation that the no-show threshold is later than the grace period.
- Rate-limited test email to the signed-in Super Admin's profile email only.
- Explicit 20-record backup/restore history limits and scheduled-backup status.
- A server readiness command and an audited emergency MFA recovery command.

## Deployment order

1. Preserve an encrypted pre-upgrade backup, the original APP_KEY, and the matching old source release. Do not regenerate the key.
2. Deploy the matching backend source. In the Laravel application directory, run `php artisan migrate --force` and `php artisan config:clear`.
3. Use persistent shared database or Redis cache. Staff sessions and confirmations must be shared between API instances. Existing staff must sign in again after this update.
4. Ensure private Laravel storage is mounted on persistent hosting storage. Check that a saved test backup survives a redeploy.
5. Configure the declared `scheduler` and `worker` hosting jobs to run every minute. Command declarations in Anybuild do not activate hosting jobs.
6. After storage is verified, enable `BACKUP_SCHEDULE_ENABLED=true` if daily backups are wanted. The configured backup schedule is 2:00 AM Asia/Manila. Configure a separate secure off-server copy process.
7. Run `php artisan system:readiness`. Resolve every CHECK result. A passing result does not prove off-server copies, inbox delivery or restore recovery.
8. Deploy the frontend with `UNISERVE_API_BASE=https://uniserve.wasmer.app/api`. The API must allow exactly the real frontend origin `https://oss.uniserve.vercel.app`.
9. Sign in again. Test settings save, Admin account actions, reports, audit history, backup download and System Health. Set up MFA in My Profile and securely save its recovery codes.
10. Send a test email from System Health and match its reference in the real inbox. Rehearse restoration using an isolated database with outbound email and jobs disabled; verify documents, records, permissions and sign-in.

## Backup compatibility

MFA adds nullable staff columns. The restore path requires matching table columns. A pre-upgrade backup must be restored using its matching release/schema in an isolated environment before migration. Keep that old release alongside the backup. Do not bypass validation to force an old backup into a new schema.

## Checks that cannot be completed from the local repository

- Configuring the correct Wasmer app's persistent volumes and hosting jobs.
- Proving storage survives an actual redeploy.
- Confirming a real mailbox received the test email.
- Saving an off-server backup and rehearsing the actual deployment's recovery.

See [the recovery runbook](super-admin-recovery.md) for commands, scope and emergency MFA recovery.
