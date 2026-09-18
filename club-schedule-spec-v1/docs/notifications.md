# Notification Specification

## Channels

-   in-app notification history
-   Web Push/PWA where enabled

Track read/unread state.

New users default to all configurable notifications ON. Users may change
notification type/channel preferences.

Only security-related notifications are mandatory regardless of user
preferences. Backup restore is not automatically classified as mandatory
unless it is also a security notification.

## Notification cases

Include at least: - event created where applicable - unanswered event
approaching deadline - user's registered schedule becomes unavailable
due to restriction - restriction removed and previously invalid schedule
revives - event date/time/location changes for an attending user,
including changed fields - target change invalidates a user's event
response - relevant schedule changes - security/account events - backup
restore notification according to the non-mandatory/global notification
policy unless classified as security

Event deletion: no notification required.

Deadline reminder: 1 day before deadline.

If Push is disabled, in-app delivery follows the user's settings except
for mandatory security notifications.

## Data model

Notifications should support: - recipient - type - title/body or
structured payload - related entity type/id - created timestamp - read
timestamp/state - delivery attempts/status where needed -
mandatory/security flag where appropriate

Avoid placing sensitive private memo content into push payloads.
