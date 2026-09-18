# Architecture Specification

## High-level architecture

Browser/PWA -\> Cloudflare Pages frontend -\> Cloudflare Worker API -\>
D1 database -\> R2 attachments/backups -\> Web Push -\> scheduled jobs

GitHub stores source only.

## Boundaries

Frontend: - rendering - local interaction state - safe offline cache -
API calls

Worker: - authentication - session handling - authorization -
validation - business rules - D1/R2 access - notification dispatch -
scheduled jobs

D1: - relational application data

R2: - event attachments - exported backup objects

## Scheduled jobs

-   Analytics: daily 03:00 Asia/Tokyo
-   Backup: every Monday 03:00 Asia/Tokyo

Scheduled execution must be idempotent or safely retryable.

## Deployment environments

At minimum: - local/development - production

Prefer a separate non-production D1/R2 environment before launch. Never
run automated tests against production data.

## PWA

PWA implementation itself has no separate platform subscription
requirement. Support: - installable manifest - service worker - offline
read behavior for selected recent calendar data - Web Push where
browser/platform support permits

Offline state must display that information may be stale and show last
sync time. Mutating protected data offline is not required unless
explicitly added later.

## Current-service verification

Before production deployment, verify current official Cloudflare
documentation for: - Workers runtime/password hashing capabilities - D1
limits and recovery - R2 pricing/limits - Cron Triggers - Pages/Workers
deployment model - Web Push/runtime compatibility

Do not encode historical pricing assumptions as application logic.
