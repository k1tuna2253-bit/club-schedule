# Club Schedule Web App - Implementation Specification v1

University club attendance/activity scheduling web application.

## Product goals

-   Make it possible to understand, at a glance, who plans to
    participate, when, and at which campus/location.
-   Mobile-first. Reading the calendar is expected to be more frequent
    than schedule registration.
-   Initial scale: about 40 users, two fixed campuses, typically 3-10
    participants per campus/day.
-   Protect personal names, schedules, and attendance data behind
    authentication.
-   Keep operating cost low using GitHub and Cloudflare services.

## Fixed campuses

-   Omiya Campus
-   Hirakata Campus
-   Users have exactly one primary campus, but may view and participate
    at either campus.
-   Common schedules/events appear in both campus calendars.

## Technology direction

-   Frontend: Cloudflare Pages
-   API/business logic: Cloudflare Workers
-   Database: Cloudflare D1
-   Object storage: Cloudflare R2
-   Source: private GitHub repository
-   PWA/Web Push/offline cache: supported; final production enablement
    may depend on implementation/operating cost.
-   Timezone: Asia/Tokyo
-   Academic year: April 1 through March 31

Read `AGENTS.md` first, then all files under `docs/` before
implementation.

## Implementation phases

1.  Project foundation, D1 migrations, authentication, sessions, Terms
    acceptance, Role/Permission foundation, base UI.
2.  University calendar, campus/location masters, weekly/monthly
    calendar, normal schedules and restrictions.
3.  Events, event targeting/responses/capacity, attachments and URLs.
4.  Notifications, Web Push and in-app notification history.
5.  Analytics and search.
6.  Administration, audit log, backup/restore.
7.  PWA/offline hardening, accessibility, security review, production
    deployment.

Do not implement later phases prematurely unless required as a
dependency.
