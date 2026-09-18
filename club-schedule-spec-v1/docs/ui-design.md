# UI / UX Specification

## Audience and usage

-   Primary age range: 18-25
-   Approximate gender ratio: 8:2
-   About 40 users
-   Smartphone-first
-   Two campuses
-   Typical daily participation: 3-10 per campus
-   Calendar viewing is expected to be more frequent than schedule
    registration

Optimize first for quick reading, then for low-friction registration.

## Visual language

-   Simple, highly legible, low visual noise.
-   Neutral base colors plus a restrained accent color.
-   Every non-neutral color must communicate a state or action.
-   Never rely on color alone; pair with icon, text, shape or pattern.
-   No emoji anywhere in product UI.
-   Use a consistent open-source SVG icon set.
-   Support system/light/dark appearance.
-   Respect reduced-motion settings.

Semantic color roles: - accent: selected/primary action - success:
available/completed - warning: caution/deadline - danger:
unavailable/destructive/error - neutral: normal information

Do not hard-code arbitrary colors in feature components; use design
tokens.

## Motion

Purposeful short motion only, typically about 150-250 ms: - campus/tab
indicator movement - bottom sheet open/close - button press feedback -
short completion feedback - notification entrance

No decorative continuous animation.

## Main calendar

Default home: weekly calendar. Allow switching weekly/monthly.

View-mode switch and previous/today/next period navigation must be
vertically separated rather than crowded into one control row.

Gestures: - weekly horizontal swipe: previous/next week - monthly
horizontal swipe: previous/next month - campus horizontal swipe: other
campus - every swipe action must also have visible controls/tabs

Calendar cells should communicate: - participant count - event
presence/content summary where space permits - restriction/unavailable
state - relevant time information

Monthly view uses a more compact version of the same semantics.

## Campus switching

Two visible tabs: - Omiya - Hirakata

Initial tab = user's primary campus. Horizontal swipe may switch
campuses. Common content appears on both.

## Day detail

Tapping a date does not navigate to a separate mobile page. Open a
draggable bottom sheet: - initial height around 50-60% - expandable
close to full screen - dismiss by downward swipe, background tap, or
explicit close/handle behavior

Desktop equivalent: right-side detail panel.

Content order: 1. restrictions 2. events 3. normal attendance

Normal attendance is grouped by location.

Participant sorting: 1. participation start/period 2. grade 3. name

Roles/club positions are shown in detail views, not constantly in dense
lists.

## Schedule entry

Weekday: - period selector is primary - clock-time controls collapsed by
default

Weekend/holiday/no-school: - clock-time controls primary - period
controls collapsed by default

Support: - multiple/non-contiguous periods - mixed periods and clock
time - optional end time - campus/common - location selection - memo -
memo visibility - recurrence - previous-same shortcut

Registration should remain reachable from appropriate app contexts
without dominating the home screen.

## Terms flow

Authentication -\> current Terms check -\> Terms screen if required -\>
Home.

Terms screen must clearly show: - current version - Terms content -
agree action - decline action

Declining means the protected application cannot be used.

## Accessibility baseline

-   adequate target sizes
-   visible keyboard focus
-   semantic labels for all controls
-   no icon-only ambiguous controls without accessible names
-   errors described in text
-   color is never the sole signal
-   swipe has a button/tab alternative
-   logical heading structure
-   appropriate contrast
-   reduced motion support
