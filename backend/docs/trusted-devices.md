# Admin trusted devices

This adds an optional second-factor exemption for Admin logins. It does not replace the existing Microsoft Authenticator TOTP enrollment or change roles. Accounts without MFA retain their existing behavior. MFA-enabled Super Admins must still supply TOTP or an existing recovery code for every new login.

## Login flow

The existing login handler still checks Turnstile (when enabled), password, active status and failed-attempt limits first. It only issues the existing bearer session after either existing MFA verification or a valid Admin device cookie. The MFA challenge has no session token. Protected endpoints continue to ignore device cookies and require bearer authentication and their existing role checks.

Only an Admin who completes the existing TOTP/recovery-code check and selects **Trust this device for 30 days** receives device trust. The checkbox starts unchecked. Trust is never created from a password-only or failed login, and Super Admins cannot create or use it even by sending the flag directly.

## Proof and expiry

The API sets `__Host-uniserve_trusted_device`: 256 random bits in a Secure, HttpOnly, host-only, Path=/ cookie, with SameSite=None and Partitioned for the separate Vercel/Wasmer sites. Only a SHA-256 token hash is stored in `staff_trusted_devices`. The proof rotates after a trusted login; the original 30-day expiry is not extended. The token is never returned in JSON or stored in browser JavaScript storage.

Trust is bound to the account's password/MFA credentials, MFA version, restore epoch, user-agent and IP address. A browser or network change conservatively revokes it and asks for MFA again. These are risk signals, not hardware attestation. After five failed password/MFA attempts, any presented trust for that account is revoked; existing login rate limits remain in force. Logout ends the bearer session but leaves device trust intact.

## Revocation and compromise

Admins use **My Profile → Account security → Trusted devices** to revoke one or all of their own devices after password confirmation. This prevents future trusted logins but does not sign out existing sessions; Active sessions remains the separate control for that.

Password changes/resets, MFA disable/reset/re-enrollment, account deactivation/deletion, and the restore epoch invalidate trust. For confirmed compromise, a password-confirmed Super Admin can PATCH `/api/admins/{id}` with `{"revokeTrustedDevices":true}` to revoke all that Admin's device grants and existing sessions. This rotates only the internal MFA credential version, keeping the TOTP secret unchanged, so an in-flight login using old credentials cannot create a usable session. Existing account/permission role checks still apply. Change a compromised password as well. This action is audited.

Device grants are intentionally excluded from application backup exports, like sessions. Restoration changes the credential epoch, so any existing grants cannot authenticate against the restored release.

## Release and browser requirements

Apply the additive migration `2026_11_17_000001_create_staff_trusted_devices.php`. No existing staff rows, secrets or authenticator accounts are modified by this migration. The existing Wasmer deployment job backs up the database before running this specific migration. Missing migration safely leaves MFA required and hides trust enrollment.

Keep the original APP_KEY and existing MFA data. Keep the actual frontend in `FRONTEND_ORIGINS`; never use a wildcard with credentialed requests. Login uses `credentials: include` and CORS allows credentials for approved origins. Trust consumption/issuance additionally checks Origin server-side. Production no longer accepts development localhost origin patterns.

Use HTTPS. Browsers may still block cross-site/partitioned cookies according to policy. In that case login still works with MFA, but device trust cannot persist: do not introduce a localStorage fallback. A frontend/API on the same site avoids third-party cookie restrictions. Validate persistence in the target browsers after deployment.

The implementation has not enabled MFA for accounts that did not previously enroll, changed Super Admin policy, altered session lifetimes, or replaced Microsoft Authenticator.

## Files in this change

- Login and profile UI: `Landing/landing.js`, `Landing/landing.css`, `Admin/admin.js`, `shared/account-security.js`.
- Existing authentication integrations: `backend/app/Http/Controllers/StaffLoginController.php`, `StaffSecurityController.php`, `StaffPasswordResetController.php`, `AdminManagementController.php`; `backend/app/Support/StaffSessions.php`; `backend/app/Console/Commands/ResetStaffMfa.php`.
- New trust implementation: `backend/app/Support/TrustedDevices.php`, `backend/app/Http/Controllers/TrustedDeviceController.php`, `backend/database/migrations/2026_11_17_000001_create_staff_trusted_devices.php`.
- Routing/configuration/release: `backend/routes/api.php`, `backend/config/cors.php`, `Anybuild`.
- Tests: `backend/tests/Feature/TrustedDevicesTest.php`, `backend/tests/Feature/StaffLoginTest.php`, `backend/tests/ui/login-mfa-modal.test.cjs`.
- This document: `backend/docs/trusted-devices.md`.

`StaffMfa.php`, the MFA secrets, role values, bearer authentication middleware and existing MFA migration are unchanged. The existing Admin password-confirmation test was updated to match the Admin account-security support already present in the application; it still verifies that confirmation grants no Super Admin access.

## Validation

93 targeted backend tests / 725 assertions pass across trusted devices, staff security/login, password reset, system oversight/backup and role access. This includes all nine requested login scenarios, cookie flags/hashing/rotation, non-sliding expiry, revocation/ownership, suspicious signals, compromise/session invalidation, CORS, missing migration, and unchanged enrollment.

Seven login UI / Turnstile tests pass. Frontend build, JavaScript syntax checks, PHP lint on new classes and migration, and the existing RFC 6238 runtime verification pass locally. The local runtime is 64-bit; no production 32-bit deployment or browser-specific cross-site cookie persistence test was run for this change. The existing TOTP implementation was not modified.

No production records were changed. Apply the migration and validate cross-site cookie acceptance on the deployed HTTPS frontend/API before treating the feature as live.
