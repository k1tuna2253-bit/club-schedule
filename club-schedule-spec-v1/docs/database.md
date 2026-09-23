# D1 Data Model - Logical Specification

This is a logical model, not final SQL. Codex should propose migrations
and indexes for review before implementation.

## Core identity

### users

-   id
-   display_name (login identifier; uniqueness policy required)
-   password_hash
-   grade
-   registration_year
-   primary_campus_id
-   status
-   terms_version_accepted
-   terms_accepted_at
-   created_at
-   updated_at

### campuses

Two seeded rows: Omiya, Hirakata.

### locations

-   id
-   campus_id
-   name
-   active
-   timestamps

### club_positions

### user_club_positions

## Permissions

### roles

### permissions

### role_permissions

### user_roles

Permission values are allow/on capabilities. Effective permission is
union of allowed capabilities across user Roles.

## Calendar

### class_periods

-   campus_id
-   period_number
-   start_time
-   end_time
-   active/effective metadata if required

### university_calendar_overrides

Special teaching day/no-school/public-holiday override metadata.

### university_closure_periods

Long breaks/no-school periods.

## Normal schedules

### schedules

-   id
-   user_id
-   date
-   campus_scope / common indicator
-   clock_start nullable
-   clock_end nullable
-   private_memo nullable; visible only to the owner
-   shared_memo nullable; visible to users who may view the schedule
-   memo and memo_visibility are legacy migration columns; they do not
    store new memo content and are not part of the current API contract
-   kind: single, template, or exception
-   recurrence_series_id nullable
-   validity and invalid reasons are derived from applicable restrictions,
    rather than fixed columns on schedules
-   created_at
-   updated_at

### schedule_periods

Selected canonical periods.

### schedule_locations

Many-to-many schedule/location relation where required.

### recurrence_series

Rule, weekdays, end date and metadata needed to materialize/manage
occurrences. This-and-following edits split the series; future
exceptions are transferred to the new series where applicable.

### recurrence_exceptions

Keyed by series_id and occurrence_date. An exception either cancels the
original occurrence or references a replacement schedule. The
occurrence_date remains the original date even when the replacement
schedule's date is moved. The API exposes this original date as
`original_date`, separately from the replacement's displayed `date`.
Replacing or cancelling an existing replacement removes its former
schedule row in the same D1 batch; its schedule_periods and
schedule_locations rows are removed by foreign-key cascade.

## Restrictions

### restrictions

-   id
-   campus/location scope
-   date/range
-   clock/period range
-   reason
-   creator
-   timestamps

### restriction_locations

if multi-location.

Schedule validity may be derived and/or recorded; design must support
invalidation and automatic revival without deleting the schedule.

## Events

### event_categories

### events

### event_locations

### event_targets

Target rules for campus, grade, Role and combinable conditions. \###
event_responses - event_id - user_id - response - comment -
eligibility/validity state - timestamps \### event_attachments R2 object
metadata, original safe filename, content type, size, uploader,
timestamps. \### event_urls

## Notifications

### notifications

### push_subscriptions

### notification_preferences

## Sessions/auth

### sessions

Store hashed/opaque session identifiers and revocation/expiry metadata
as appropriate. \### login_lock_state or equivalent Could be user fields
or dedicated records.

## Analytics

Prefer derived/materialized aggregate tables rather than duplicating
canonical schedules unnecessarily. Historical grade must be stable for
aggregation.

Possible: - participation_daily_facts - analytics_monthly_aggregates -
event_analytics_aggregates

Exact design should prioritize correctness and simple recomputation.

## Audit

### audit_logs

Store actor, action, target type/id, safe structured metadata,
timestamp. Do not log private memo contents or passwords. Retention: 5
years.

## Deletion/anonymization

### deletion_registry

Track immutable user ID and deletion/anonymization state needed to
reapply privacy rules after backup restore. Do not retain unnecessary
identifying information in this registry.

## Indexing expectations

At minimum review indexes for: - schedules(date, user_id) -
schedules(user_id, date) - event date/deadline - event
responses(event_id, user_id) - notifications(recipient, read state,
created_at) - audit timestamp/action - role/user joins - restriction
date/location lookups - search fields allowed by policy
