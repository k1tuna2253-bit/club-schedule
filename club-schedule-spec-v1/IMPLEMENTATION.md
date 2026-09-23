# Development notes

The application is a Vite/React static site on Cloudflare Pages. `functions/api/[[path]].ts` is a Pages Function running on the Workers runtime. Only this server code has a D1 binding. The browser calls same-origin `/api/*` endpoints.

## Local setup

1. Run `npm install`.
2. Run `npm run db:local` to apply D1 migrations to the local Wrangler database.
3. Run `npm run bootstrap` interactively. It writes `bootstrap-local.sql` (ignored by Git), containing a password hash and initial manager assignment. Apply it only to the intended local database with `npx wrangler d1 execute club-schedule-dev --local --file bootstrap-local.sql`, then delete the file.
4. Add approved Terms text and version in D1 before login can enter the app. Example shape: `INSERT INTO terms_versions (version,body,requires_reconsent,is_current,created_at) VALUES (?,?,?,?,?)`. The actual text, version, and re-consent policy require a human decision. Do not check them into source without review.
5. Run `npm run build`, then `npx wrangler pages dev dist` to serve the site and API together. The D1 binding is configured in `wrangler.toml`.

The D1 ID in `wrangler.toml` is a non-production placeholder. Configure separate development and production D1 bindings before deployment. No production deployment has been attempted.

## Phase 2 local calendar setup

`npm run db:local` also applies `0002_phase2.sql`. The migration seeds the two campus-specific class-period masters. It does not create Locations, schedules, holidays, or real user data. Grant the required Phase 2 capabilities to an existing local test Role if the local account only has Phase 1 administrative permissions.

The primary holiday source is the [Cabinet Office CSV](https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html). As checked in September 2026, the CSV is Shift_JIS encoded and contains published dates through 2027. The [Cabinet Office content-use terms](https://www.cao.go.jp/notice/rule.html) apply. Import is an explicit operator action; calendar requests never fetch the external site.

1. Run `npm run holidays:prepare`. It fetches and validates the CSV, then writes `.wrangler/holiday-import.sql` under a Git-ignored directory. Review the source, covered years, and generated SQL before applying it.
2. For local review only, run `npx wrangler d1 execute club-schedule-dev --local --file=.wrangler/holiday-import.sql`.
3. Inspect `SELECT year,row_count FROM holiday_import_years ORDER BY year DESC` in the intended local D1 database. If fetching or validation fails, the script creates no new SQL and existing D1 rows remain intact. A year without validated imported coverage is reported as unknown, not as having no holidays.

No automatic refresh interval is configured. Decide an operational import cadence and production deployment procedure before production use. Never apply these local commands to production D1. `npm run build` and `npx wrangler pages dev dist` serve the Phase 2 UI and API together locally.

## Current API

- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session`, `POST /api/auth/password`
- `GET /api/terms/current`, `POST /api/terms/accept`
- `GET /api/me`, `PATCH /api/me`
- `GET /api/calendar`, `GET /api/calendar/day`
- `GET/POST /api/locations`, `PATCH /api/locations/:id`
- `GET/POST /api/class-periods`, `PATCH /api/class-periods/:id`
- `GET/POST /api/closures`, `PATCH/DELETE /api/closures/:id`
- `GET/POST /api/overrides`, `PATCH/DELETE /api/overrides/:id`
- `GET/POST /api/restrictions`, `PATCH/DELETE /api/restrictions/:id`
- `POST /api/schedules`, `GET /api/schedules/previous`, `PATCH/DELETE /api/schedules/:id`

All responses use `{data: ...}` or `{error: {code, message}}`. Mutations require a matching Origin. Protected API responses are not cached.

## Policy settings and pending decisions

- `LOGIN_MAX_FAILURES` defaults to a provisional 5; `LOGIN_LOCK_MINUTES` defaults to a provisional 15. Both are configurable Worker environment variables and need production policy approval.
- `SESSION_DAYS` defaults to a provisional 30, configurable from 1 to 90. Confirm retention and session lifecycle policy.
- The final Terms text, version, and re-consent policy are not set by the migration. Without them the app displays a setup state and protected resources remain inaccessible.
- The final product name and brand identity are TBD. The UI uses a neutral working title and Phosphor icons (MIT licensed).
- Grade rollover at April 1 needs the rule that defines which grade is beyond graduation. The schema retains grade and registration year; do not enable rollover until that policy is specified.
- User/Role administration screens and endpoints are Phase 6. The schema, permission lookup, and a transactional final `ROLE_MANAGE` holder guard are available for their implementation.
- Cloudflare Workers Free CPU limits must be checked with the selected password work factor in the actual plan before production. Do not weaken hashing simply to fit a plan.
