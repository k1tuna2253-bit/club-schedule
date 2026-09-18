# Security and Privacy Specification

## Threat model focus

Protected data includes: - member names - campus affiliation -
attendance schedules - event responses/comments - private memos -
credentials/session tokens - permissions - audit records - backup data

No protected schedule/name data is visible without authentication.

## Authentication

Login: display name + password. Minimum password length: 8. Initial
passwords are unique per user. First-login password change is optional.

Store password hashes only. Use a Worker-compatible modern password
hashing approach validated against current official runtime
capabilities.

Persistent login is desired. Multiple simultaneous devices are allowed.
Password change invalidates every active session for that user.

Repeated failed logins lock the account; administrators can unlock.
Exact threshold/lock duration: configurable/TBD.

## Sessions

Use server-managed sessions and secure cookies: - HttpOnly - Secure -
appropriate SameSite - rotate/revoke where appropriate

Do not store privileged authentication secrets in browser-readable
persistent storage.

## Authorization

All permissions enforced in Worker/API. Frontend hiding is convenience
only and never authorization. Unauthenticated protected API: 401.
Authenticated but unauthorized: 403 where appropriate.

Private schedule memo: author only. Event response comment: authorized
management only. Analytics permission does not grant individual
analytics access to other users.

## API and application security

-   server-side validation for every mutation
-   parameterized D1 queries
-   rate limiting/abuse controls for login and sensitive endpoints
-   CSRF protections appropriate to cookie-based authentication
-   safe output encoding
-   restrictive CORS; do not expose API broadly without reason
-   security headers/CSP suitable for the final frontend
-   attachment type/size validation
-   never trust client-provided user IDs/permissions
-   use transactions for multi-record invariants where
    supported/appropriate

## Secrets

Store secrets in Cloudflare secrets/environment configuration, never
GitHub source. Examples: - Web Push private keys - encryption keys -
production credentials - signing/session secrets

## Privacy/deletion

Use immutable internal IDs. Display names are not foreign keys.

Deleted users must be anonymized in active/history presentation as
`Deleted_User`. Do not expose deleted identity through search,
notifications, logs visible to ordinary users, attachments, or cached
UI.

Backups should not be rewritten destructively merely to remove a deleted
identity from every historical immutable backup. Maintain a
deletion/anonymization registry/process so that any restored backup is
re-anonymized before the restored system becomes available. Confirm
exact legal/privacy requirements before production.

## Offline cache

Offline caching must not accidentally make protected data available
after logout/account disable on a shared device. Use deliberate cache
partitioning/clearing and avoid caching sensitive endpoints
indiscriminately. Display last synchronization time when offline data is
shown.
