# Role and Permission Model

## Principles

The system uses Discord-like capability permissions, not a fixed
administrator hierarchy.

-   Administrators can create arbitrary Roles.
-   Default Roles are also editable.
-   A user may have multiple Roles.
-   Effective permission merge rule: ALLOW/ON wins.
-   There is no Role hierarchy.
-   There is no Super Admin Role.
-   UI labels must not substitute for server-side authorization checks.

## Suggested permission keys

Final naming may be adjusted before migrations, but capability
boundaries must remain explicit.

-   `SCHEDULE_VIEW`
-   `SCHEDULE_CREATE_SELF`
-   `SCHEDULE_EDIT_SELF`
-   `SCHEDULE_DELETE_SELF`
-   `SCHEDULE_CREATE_OTHERS`
-   `SCHEDULE_EDIT_OTHERS`
-   `SCHEDULE_DELETE_OTHERS`
-   `EVENT_VIEW`
-   `EVENT_CREATE`
-   `EVENT_EDIT`
-   `EVENT_DELETE`
-   `EVENT_RESPONSE_MANAGE`
-   `EVENT_COMMENT_VIEW`
-   `USER_MANAGE`
-   `USER_PASSWORD_RESET`
-   `LOCATION_MANAGE`
-   `CALENDAR_MANAGE`
-   `RESTRICTION_MANAGE`
-   `ROLE_MANAGE`
-   `ANALYTICS_VIEW`
-   `SEARCH_USE`
-   `AUDIT_LOG_VIEW`
-   `NOTIFICATION_MANAGE`
-   `BACKUP_RESTORE`

## Protection rules

At least one active user must retain effective `ROLE_MANAGE`. Any
operation that would leave zero active holders must be rejected
transactionally by the server.

Deleting a Role automatically detaches it from all users.

Strong operations require extra confirmation, including at least: -
Role/Permission changes - backup restore - restrictions with broad
impact - bulk/destructive deletion - other operations designated
high-impact

Routine normal-user reads must not require unnecessary confirmation.

## Proxy operations

Proxy schedule/event operations are controlled by explicit permissions
rather than Role names. Where older product discussion conflicts about
proxy registration, do not infer broad access: implement only the
explicit permission that exists and require a product decision for any
missing capability.
