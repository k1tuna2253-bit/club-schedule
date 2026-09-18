# Analytics Specification

## Separation

Normal attendance analytics and Event analytics are separate.

Users: - may view their own individual analytics.

Authorized users with `ANALYTICS_VIEW`: - may view anonymized aggregate
analytics, - must not gain access to other members' individual analytics
merely from this permission.

## Normal attendance

A registered schedule becomes actual participation once its date is
past, provided it remained valid.

Same-day multiple schedules: - count as one participation day, - count
all non-overlapping participation time, - overlapping time is counted
only once.

Period schedules: - calculate duration using the class-period master
valid for that campus/date.

Unknown-end clock schedule: - provisionally count 1 hour, - mark that
duration as estimated, - show estimated hours separately/clearly.

Restricted/invalidated schedules: - do not count.

## Annual participation-day rate

Use an explicit label equivalent to "annual participation-day rate"
rather than implying a generic attendance rate.

Denominator: - academic-year calendar days - exclude registered
university no-school/closure periods - weekends are NOT automatically
excluded solely because they are weekends

Restriction effects on denominator must follow the product rule that
days made unavailable by applicable restrictions are not counted;
partial-day restriction denominator treatment remains an
implementation/product edge case and must be flagged rather than
guessed.

## Grade

Grade-based analytics use the user's grade at the time of participation,
not current grade. Store or derive a historical-grade snapshot robustly
enough that later grade changes do not rewrite historical aggregation.

## Views

Support academic-year and month views.

Candidate normal analytics: - participation days - annual
participation-day rate - participation hours - estimated hours - common
participation weekdays - high-participation weekdays/times -
period/time-slot distribution - location distribution - campus
breakdown - grade breakdown - monthly trend - average headcount - total
participation time

Time/headcount grouping should favor class-period grouping when a clock
interval overlaps the campus period boundaries; otherwise use clock-time
grouping. Whole-day clock aggregation can use approximately one-hour
buckets.

## Event analytics

Separate views may include: - event participation count - event
response/participation rate - category breakdown - month/year trend

Do not mix Event hours/days into normal attendance totals.

## Refresh

Analytics aggregation job: daily at 03:00 Asia/Tokyo. Past schedules
cannot be edited even before that job runs, so the job is aggregation,
not the moment at which history becomes immutable.

## Deleted/retired users

Deleted: - remove individual analytics - retain only anonymous aggregate
contribution

Retired/left club: - retain dedicated statistics including grade,
participation days and participation time as specified by retention
policy.
