# AGENTS.md - Codex implementation rules

## Source of truth

Before changing application behavior, read the relevant files in
`/docs`. These specifications are authoritative. If implementation and
specification conflict, stop and report the conflict rather than
silently changing requirements.

Do not invent missing product requirements. Mark unresolved decisions as
TODO/TBD and ask for a decision.

## General engineering rules

-   Mobile-first responsive web application.
-   No emoji anywhere in the product UI, source-provided user-facing
    labels, empty states, notifications, or documentation intended for
    UI copy.
-   Use a consistent open-source SVG icon library instead of emoji.
-   Keep visual design simple. Color must communicate meaning, not
    decoration.
-   Short purposeful animation is allowed; avoid continuous/decorative
    motion.
-   Respect `prefers-reduced-motion`.
-   All date/time business logic uses `Asia/Tokyo`.
-   Academic year is April 1-March 31.
-   Use immutable internal IDs. Never use display names as foreign keys.
-   Frontend must never connect directly to D1 or R2 privileged APIs.
-   All authorization is enforced server-side in Workers.
-   Never commit secrets, user data, attendance data, production DB
    exports, password hashes, API keys, Web Push private keys, or backup
    files to Git.
-   Validate all API inputs server-side.
-   Use parameterized D1 queries.
-   Add indexes deliberately for calendar/date/user/target lookups.

## Security

-   Passwords are never stored in plaintext.
-   Use a current, Worker-compatible password hashing approach; verify
    the implementation against current official Cloudflare runtime
    documentation before finalizing.
-   Authentication uses secure server-managed sessions.
-   Session cookie: HttpOnly, Secure, appropriate SameSite.
-   Password changes invalidate all active sessions for that user.
-   Repeated failed logins lock the account. Threshold/duration remain
    configurable/TBD.
-   Unauthenticated schedule/data APIs return 401 and reveal no member
    names or schedules.
-   Authorization failures return 403 where appropriate.
-   Sensitive operations require explicit confirmation in the UI and
    server-side authorization.
-   The last holder of `ROLE_MANAGE` must not be able to lose/remove
    that effective permission.
-   Private normal-schedule memos are readable only by their author.
-   Event response comments are restricted to users with the
    corresponding management permission.

## Quality gates

For every implementation phase: 1. Add/update migrations and types. 2.
Add server-side validation. 3. Add authorization tests. 4. Add
business-rule tests. 5. Add responsive UI. 6. Test keyboard access and
screen-reader labels. 7. Test loading/empty/error/offline states where
relevant. 8. Run formatter/linter/type-check/tests before presenting
work. 9. Summarize files changed, migrations added, tests run, and
remaining TODOs.

Do not perform destructive production operations automatically.
