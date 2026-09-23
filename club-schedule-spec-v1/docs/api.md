# Worker API Specification - Resource Outline

Final routes may use REST-style naming. All protected endpoints require
authentication and capability checks.

## Auth

-   POST `/api/auth/login`
-   POST `/api/auth/logout`
-   POST `/api/auth/password`
-   GET `/api/auth/session`

Login must be rate-limited and participate in account lock logic.
Password change revokes all sessions, then establishes/requires a fresh
session according to final UX.

## Terms

-   GET `/api/terms/current`
-   POST `/api/terms/accept`

Protected app resources reject/redirect appropriately when current Terms
are not accepted.

## Profile/users

-   GET/PATCH `/api/me`
-   GET `/api/me/analytics`
-   user management endpoints gated by `USER_MANAGE`
-   password reset gated by `USER_PASSWORD_RESET`

## Calendar

-   GET calendar range by campus
-   GET day detail
-   class-period/calendar override management endpoints with permission
    checks

Calendar response should aggregate restrictions, events and normal
schedules without leaking private memos. Calendar cells contain no memo
body; day detail may include readable non-empty memo fields.

## Schedules

-   create
-   read
-   update future schedule
-   delete future schedule
-   recurrence operations
-   previous-same helper if implemented server-side

Past schedule mutation: reject, including a moved recurrence when either
its original occurrence date or its current replacement date is past in
Asia/Tokyo. Restriction conflict: validate
server-side. Create and update payloads include independent
`private_memo` and `shared_memo` fields, each a string or null. Their
contents are optional, and both may be empty or null.
The legacy `memo` and `memo_visibility` columns are not part of the new
API contract. Omit `private_memo` entirely from every non-owner response;
return `shared_memo` to users who may view the schedule.

For a recurring this-occurrence mutation, `occurrence_date` identifies
the original series occurrence while `schedule.date` may identify a new
destination date. The original date remains the exception key. A moved
replacement is absent from the original day and appears on the
destination day with `original_date` and its series association. Editing
or cancelling that exception removes any prior replacement atomically.
This-and-following edits split the series and transfer applicable future
exceptions.

## Restrictions

CRUD gated by `RESTRICTION_MANAGE`. Creating/removing a restriction must
update/derive affected schedule validity and trigger notifications as
required.
For a schedule on date D, a restriction removed at or before D 00:00:00.000
Asia/Tokyo no longer applies to D. A later removal leaves D's existing
invalid state in effect.

## Events

CRUD with event permissions. Response endpoint enforces: - target
eligibility - deadline - capacity - response state - comment visibility

Attachment upload should use a controlled Worker/R2 flow; validate
content type and size. External URLs must be validated/safely rendered.

## Search

Permission-controlled endpoint with: - query - type filters - date/range
filters - pagination

Must honor retention and privacy rules.

## Notifications

-   list/paginate
-   mark read
-   preferences
-   Web Push subscription management

## Analytics

-   own analytics
-   aggregate analytics with `ANALYTICS_VIEW`

Never expose other users' individual analytics through aggregate routes.

## Admin/audit/backup

-   Roles/permissions
-   locations/calendar masters
-   audit log
-   backup restore control

Backup restore must require `BACKUP_RESTORE` plus explicit confirmation
protocol.

## API conventions

Use consistent: - JSON envelope/error shape - ISO timestamps -
Asia/Tokyo business-date interpretation - pagination - validation
errors - 401 unauthenticated - 403 unauthorized - 404
inaccessible/nonexistent resources as appropriate to avoid information
leaks - 409 for relevant state conflicts - idempotency where retries can
create duplicates

Do not return password hashes, session secrets, Web Push private keys or
internal backup credentials.
