# Functional Requirements

## 1. Users

A user has: - immutable internal ID - display name (also used as login
identifier) - password hash - grade - registration year - primary
campus - zero or more club positions - zero or more system Roles -
active/disabled/deleted state - created/updated timestamps

Display name and primary campus may be changed by the user and
authorized administrators. Club positions are administrator-managed.
Grade may be corrected by the user or administrator.

Grade automatically increments on April 1. Once the user is beyond
graduation, do not keep incrementing automatically; administration
handles retirement/deletion/correction.

Users can have multiple club positions and multiple Roles.

## 2. Account creation and deletion

Administrators pre-register users and issue a unique initial password.
First-login password change is not mandatory. Minimum password length: 8
characters. Administrators may reset passwords but can never view
existing passwords.

Account deletion is requested through an administrator, not
self-executed from Profile. On deletion: - remove identifying data from
the active database as required by the final schema, - replace visible
historical identity with `Deleted_User`, - preserve anonymous aggregate
statistics, - remove individual analytics.

For club leavers/retired members, retain dedicated non-identifying
statistics including historical grade, participation days and
participation time.

## 3. Terms of Use

After authentication, a user who has not accepted the current Terms
version must see the Terms acceptance flow before entering the app.
Store at least: - accepted terms version - accepted timestamp

If a new version requires re-consent, users with an older accepted
version must accept the new version. Terms text itself is TBD and
outside this specification.

## 4. Campus and locations

Two campuses are fixed: - Omiya - Hirakata

A user belongs to one primary campus but may view and participate at
both. Initial calendar campus is the user's primary campus. Campus
switching uses visible tabs and horizontal swipe; tabs must remain
available as a non-gesture alternative.

Administrators create locations under a campus: `campus 1:N locations`.
No deeper building/room hierarchy is required in v1.

Schedules/events may use multiple locations where their feature permits
it. "Common" schedules/events are shown on both campus calendars.

## 5. University calendar and class periods

No semester model.

Default class periods: - Period 1: 09:10-10:50 - Period 2: 11:00-12:40 -
Period 3: 13:30-15:10 - Period 4: 15:20-17:00 - Period 5: 17:10-18:00 -
Period 6: 19:00-20:40, Omiya only

Period masters are campus-aware and administrator-editable if future
correction is required.

Weekdays default to period-based participation entry. Optional
clock-time entry is collapsed until requested. Weekends, Japanese public
holidays and registered university no-school periods default to
clock-time entry; period entry may be revealed manually. Weekend always
defaults to clock-time.

Japanese public holidays use a managed import: a script obtains the
Cabinet Office's published data, validates it, and produces SQL for
review and application to D1 `japanese_holidays`. D1 records which
years were imported. Calendar views never fetch holidays from an external
service at request time,
and an unimported year is not treated as having no holidays. A failed
import preserves previously validated data. The cadence for future
automatic imports is undecided. Administrators register university long
breaks/no-school periods and can override individual dates, including
special teaching days.

## 6. Normal attendance schedules

Members freely register when and where they plan to participate.
Administrators do not normally pre-create activity days.

A normal schedule may contain: - owner/user - date - campus/common
scope - one or more locations as applicable - selected class periods,
including non-contiguous periods - optional clock start - optional clock
end - optional private memo - optional shared memo - recurrence metadata
- validity/restriction state - timestamps

The two memo fields are independent and may both be filled or left empty.
The private memo is visible only to the schedule owner and must be absent
from API responses to other users. The shared memo is visible to users
who may view the schedule. Calendar cells do not display memo bodies;
day detail displays only non-empty memo fields that the viewer may read.

Period data remains canonical period data; do not convert it into
clock-time storage merely for convenience. Mixed period + clock-time
entry is allowed. Clock end time is optional.

For `14:00-` with no end: - UI displays `14:00- (end undecided)` or
equivalent Japanese copy. - Analytics provisionally counts 1 hour and
clearly marks it as estimated.

Multiple schedules for the same user/day are allowed. Overlapping time
must not be double-counted in analytics. Non-overlapping portions are
counted.

"Previous same" copies location, time/period and both memo fields when
present.

Recurrence supports: - weekly - selected weekdays - end date

Recurring edit/delete must allow choosing the affected occurrence scope,
including this occurrence and this-and-following where applicable.

For a this-occurrence edit, preserve the original occurrence date as the
exception key. If the occurrence is moved to another date, suppress the
normal occurrence on its original date and display its replacement on the
destination date. The replacement retains its recurrence lineage; after
a series split, the exception belongs to the successor series with the
same lineage. It exposes `original_date` separately from its displayed
`date`.
Editing the same occurrence again replaces and removes the prior
replacement; cancelling it removes the replacement and marks the
exception as cancelled. This-and-following edits split the series at the
original occurrence date and transfer existing future exceptions to the
new series as needed.

When creating an overlapping/duplicate schedule, warn and let the user
choose "戻って修正" or "このまま登録". The latter explicitly adds the new
schedule while leaving existing schedules unchanged. The Worker must
require an explicit `continue_conflict` flag before saving a conflicting
schedule.

Once a schedule date is in the past, that schedule cannot be edited or
deleted, regardless of whether the nightly analytics job has run.
For a moved recurring occurrence, mutations are prohibited if either
the original occurrence date or the currently displayed replacement
date is past in Asia/Tokyo.

## 7. Facility restrictions

Authorized users can create restrictions for: - entire facility/campus
scope as supported - selected locations - selected periods/time ranges

Restrictions must be visually obvious. Server-side schedule validation
is mandatory.

If a restriction is added after schedules exist: - affected schedules
are invalidated, not deleted, - invalidated schedules remain visible
with reason/status, - invalidated schedules are excluded from
participation statistics, - if the restriction is removed by the
schedule date's 00:00:00.000 Asia/Tokyo boundary, affected schedules
automatically revive. A removal after that boundary does not revive
that day's invalid schedules. Notification behavior is defined in its
later phase.

If a restricted date passes while the schedule remains invalid, it is
not counted in statistics.

## 8. Events

Events are separate from normal attendance schedules and separate in
analytics.

Authorized users can create/edit/delete events. Event categories are
administrator/authorized-manager created and selected by event creators.

Event fields include: - title - category - date/time - campus/common
scope - one or more locations as applicable - description - response
deadline - optional capacity - target conditions - external URL(s) -
attachment(s) - creator/updater timestamps

No separate announcement feature is required.

Responses: - attending - not attending - undecided - optional comment

Response status is visible to all authenticated users with event-view
access. Response comments are management-only.

Deadline: - date + optional time - if time omitted, deadline is 23:59:59
on that date in Asia/Tokyo - after deadline, new responses and changes
are prohibited

When capacity is reached, further `attending` responses are prohibited.
If capacity is lowered below existing attendee count, warn the editor
and allow the over-capacity state; do not automatically remove
attendees.

Targeting may combine conditions such as campus AND grade AND Role. If a
target change makes an existing respondent ineligible: - invalidate that
response, - notify the affected user.

If date/time/location changes for a user already marked attending,
notify the user and identify changed fields. Event deletion does not
require a user notification. Event edit history is not retained as a
dedicated version history.

During an event, normal-schedule use for the affected event scope is
intended to be unavailable; exact enforcement scope should be
implemented conservatively and flagged if the data model cannot
determine it unambiguously.

## 9. Search

Search is permission-controlled. Authorized search can cover all
retained data and supports date/range filtering. Search targets include
users, events and retained past schedules, subject to permissions and
privacy rules.

## 10. Data retention

Normal schedule/history data: 5 years. Audit logs: 5 years. Deleted user
identifying information must not remain in the active database.
