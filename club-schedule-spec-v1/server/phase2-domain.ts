import {
  addDays,
  calendarDays,
  campus,
  dateOnly,
  dayStartTokyo,
  minute,
  periodsFor,
  restrictionCutoff,
  timeOnly,
  weekday,
  type Campus,
} from "./calendar";

export class ApiProblem extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function requireValid(
  condition: unknown,
  message = "入力内容を確認してください。",
): asserts condition {
  if (!condition) throw new ApiProblem(400, "VALIDATION", message);
}
export type PeriodChoice = { campus_id: Campus; period_number: number };
export type ScheduleInput = {
  date: string;
  scope: Campus | "common";
  location_ids: string[];
  periods: PeriodChoice[];
  clock_start: string | null;
  clock_end: string | null;
  private_memo: string | null;
  shared_memo: string | null;
  user_id?: string;
  recurrence?: { weekdays: number[]; end_date: string } | null;
  continue_conflict?: boolean;
};
export interface ScheduleRow {
  id: string;
  user_id: string;
  date: string;
  scope: Campus | "common";
  clock_start: string | null;
  clock_end: string | null;
  memo: string | null;
  memo_visibility: "everyone" | "private";
  private_memo: string | null;
  shared_memo: string | null;
  kind: "single" | "template" | "exception";
  recurrence_series_id: string | null;
  created_at: string;
  updated_at: string;
}
export interface Occurrence extends Omit<
  ScheduleRow,
  "memo" | "memo_visibility" | "private_memo"
> {
  private_memo?: string | null;
  occurrence_id: string;
  series_id: string | null;
  template_id: string | null;
  original_date: string;
  periods: PeriodChoice[];
  locations: { id: string; campus_id: Campus; name: string; active: number }[];
  owner: {
    display_name: string;
    grade: number;
    roles: string[];
    positions: string[];
  };
  valid: boolean;
  invalid_reasons: string[];
}

export function parseScheduleInput(value: unknown): ScheduleInput {
  requireValid(value && typeof value === "object" && !Array.isArray(value));
  const v = value as Record<string, unknown>;
  requireValid(dateOnly(v.date));
  requireValid(campus(v.scope) || v.scope === "common");
  requireValid(
    Array.isArray(v.location_ids) &&
      v.location_ids.length <= 30 &&
      v.location_ids.every(
        (id) => typeof id === "string" && id.length > 0 && id.length <= 100,
      ),
  );
  requireValid(new Set(v.location_ids).size === v.location_ids.length);
  requireValid(
    Array.isArray(v.periods) &&
      v.periods.length <= 24 &&
      v.periods.every(
        (p) =>
          p &&
          typeof p === "object" &&
          campus(p.campus_id) &&
          Number.isInteger(p.period_number) &&
          p.period_number > 0,
      ),
  );
  const periods = v.periods as PeriodChoice[];
  requireValid(
    new Set(periods.map((p) => `${p.campus_id}:${p.period_number}`)).size ===
      periods.length,
  );
  requireValid(v.clock_start === null || timeOnly(v.clock_start));
  requireValid(v.clock_end === null || timeOnly(v.clock_end));
  requireValid(
    v.clock_end === null ||
      (v.clock_start !== null &&
        minute(v.clock_end as string) > minute(v.clock_start as string)),
    "日をまたぐ時刻や終了が開始以前の時刻は指定できません。",
  );
  requireValid(
    periods.length > 0 || v.clock_start !== null,
    "時限または開始時刻を指定してください。",
  );
  requireValid(
    v.private_memo === null ||
      (typeof v.private_memo === "string" && v.private_memo.length <= 2000),
  );
  requireValid(
    v.shared_memo === null ||
      (typeof v.shared_memo === "string" && v.shared_memo.length <= 2000),
  );
  requireValid(v.memo === undefined && v.memo_visibility === undefined);
  requireValid(
    v.user_id === undefined ||
      (typeof v.user_id === "string" && v.user_id.length > 0),
  );
  requireValid(
    v.continue_conflict === undefined ||
      typeof v.continue_conflict === "boolean",
  );
  let recurrence: ScheduleInput["recurrence"];
  if (v.recurrence !== undefined && v.recurrence !== null) {
    requireValid(
      typeof v.recurrence === "object" && !Array.isArray(v.recurrence),
    );
    const r = v.recurrence as Record<string, unknown>;
    requireValid(dateOnly(r.end_date) && r.end_date >= v.date);
    requireValid(
      Array.isArray(r.weekdays) &&
        r.weekdays.length > 0 &&
        r.weekdays.length <= 7 &&
        r.weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6),
    );
    requireValid(new Set(r.weekdays).size === r.weekdays.length);
    recurrence = { end_date: r.end_date, weekdays: r.weekdays as number[] };
  }
  return {
    date: v.date,
    scope: v.scope as ScheduleInput["scope"],
    location_ids: v.location_ids as string[],
    periods,
    clock_start: v.clock_start as string | null,
    clock_end: v.clock_end as string | null,
    private_memo: v.private_memo as string | null,
    shared_memo: v.shared_memo as string | null,
    user_id: v.user_id as string | undefined,
    continue_conflict: v.continue_conflict as boolean | undefined,
    recurrence,
  };
}

export async function validateScheduleReferences(
  db: D1Database,
  input: ScheduleInput,
  existingLocations: string[] = [],
): Promise<void> {
  for (const id of input.location_ids) {
    const location = await db
      .prepare("SELECT campus_id, active FROM locations WHERE id = ?")
      .bind(id)
      .first<{ campus_id: Campus; active: number }>();
    requireValid(
      location && (location.active === 1 || existingLocations.includes(id)),
      "選択できないLocationがあります。",
    );
    requireValid(
      input.scope === "common" || location.campus_id === input.scope,
      "Locationのキャンパスが予定と一致しません。",
    );
  }
  for (const period of input.periods) {
    requireValid(
      input.scope === "common" || input.scope === period.campus_id,
      "時限のキャンパスが予定と一致しません。",
    );
    const available = await periodsFor(db, period.campus_id, input.date);
    requireValid(
      available.some((row) => row.period_number === period.period_number),
      "この日・キャンパスに存在しない時限です。",
    );
  }
}

export function recurrenceDates(
  from: string,
  to: string,
  weekdays: number[],
): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1))
    if (weekdays.includes(weekday(date))) dates.push(date);
  return dates;
}

async function decorate(
  db: D1Database,
  row: ScheduleRow,
  date: string,
  occurrenceId: string,
  seriesId: string | null,
  viewerId: string,
  originalDate = date,
  templateId: string | null = null,
): Promise<Occurrence> {
  const [periods, locations, owner, roles, positions] = await Promise.all([
    db
      .prepare(
        "SELECT campus_id, period_number FROM schedule_periods WHERE schedule_id = ? ORDER BY campus_id, period_number",
      )
      .bind(row.id)
      .all<PeriodChoice>(),
    db
      .prepare(
        `SELECT l.id, l.campus_id, l.name, l.active FROM schedule_locations sl
      JOIN locations l ON l.id = sl.location_id WHERE sl.schedule_id = ? ORDER BY l.campus_id, l.name`,
      )
      .bind(row.id)
      .all<Occurrence["locations"][number]>(),
    db
      .prepare("SELECT display_name, grade, status FROM users WHERE id = ?")
      .bind(row.user_id)
      .first<{ display_name: string; grade: number; status: string }>(),
    db
      .prepare(
        "SELECT r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=? ORDER BY r.name",
      )
      .bind(row.user_id)
      .all<{ name: string }>(),
    db
      .prepare(
        "SELECT p.name FROM user_club_positions up JOIN club_positions p ON p.id=up.position_id WHERE up.user_id=? ORDER BY p.name",
      )
      .bind(row.user_id)
      .all<{ name: string }>(),
  ]);
  const {
    memo: _legacyMemo,
    memo_visibility: _legacyVisibility,
    private_memo: _privateMemo,
    ...publicRow
  } = row;
  void _legacyMemo;
  void _legacyVisibility;
  void _privateMemo;
  const occurrence: Occurrence = {
    ...publicRow,
    date,
    occurrence_id: occurrenceId,
    original_date: originalDate,
    series_id: seriesId,
    template_id: templateId,
    periods: periods.results,
    locations: locations.results,
    ...(row.user_id === viewerId ? { private_memo: row.private_memo } : {}),
    owner:
      owner && owner.status !== "deleted"
        ? {
            display_name: owner.display_name,
            grade: owner.grade,
            roles: roles.results.map((r) => r.name),
            positions: positions.results.map((p) => p.name),
          }
        : { display_name: "Deleted_User", grade: 0, roles: [], positions: [] },
    valid: true,
    invalid_reasons: [],
  };
  occurrence.invalid_reasons = await restrictionReasons(db, occurrence);
  occurrence.valid = occurrence.invalid_reasons.length === 0;
  return occurrence;
}

export async function occurrences(
  db: D1Database,
  from: string,
  to: string,
  viewerId: string,
): Promise<Occurrence[]> {
  const singles = await db
    .prepare(
      `SELECT * FROM schedules WHERE kind = 'single' AND date BETWEEN ? AND ?`,
    )
    .bind(from, to)
    .all<ScheduleRow>();
  const templates = await db
    .prepare(
      `SELECT s.*, r.id AS series_id, r.lineage_id, r.start_date, r.end_date,
    r.cancelled_from, r.weekdays FROM recurrence_series r JOIN schedules s ON s.recurrence_series_id = r.id
    WHERE s.kind = 'template' AND r.start_date <= ? AND r.end_date >= ?`,
    )
    .bind(to, from)
    .all<
      ScheduleRow & {
        series_id: string;
        lineage_id: string;
        start_date: string;
        end_date: string;
        cancelled_from: string | null;
        weekdays: string;
      }
    >();
  const exceptions = await db
    .prepare(
      `SELECT e.series_id, e.occurrence_date, e.action, e.replacement_schedule_id,
      r.lineage_id, r.cancelled_from, s.date AS replacement_date, t.id AS template_id
    FROM recurrence_exceptions e JOIN recurrence_series r ON r.id = e.series_id
    LEFT JOIN schedules s ON s.id = e.replacement_schedule_id
    LEFT JOIN schedules t ON t.recurrence_series_id = r.id AND t.kind = 'template'
    WHERE e.occurrence_date BETWEEN ? AND ? OR s.date BETWEEN ? AND ?`,
    )
    .bind(from, to, from, to)
    .all<{
      series_id: string;
      occurrence_date: string;
      action: string;
      replacement_schedule_id: string | null;
      lineage_id: string;
      replacement_date: string | null;
      template_id: string | null;
      cancelled_from: string | null;
    }>();
  const byException = new Map(
    exceptions.results.map((row) => [
      `${row.series_id}:${row.occurrence_date}`,
      row,
    ]),
  );
  const result: Occurrence[] = [];
  for (const row of singles.results)
    result.push(await decorate(db, row, row.date, row.id, null, viewerId));
  for (const template of templates.results) {
    const start = template.start_date > from ? template.start_date : from;
    const end = template.end_date < to ? template.end_date : to;
    const days = recurrenceDates(
      start,
      end,
      JSON.parse(template.weekdays) as number[],
    );
    for (const date of days) {
      if (template.cancelled_from && date >= template.cancelled_from) continue;
      const exception = byException.get(`${template.series_id}:${date}`);
      if (exception?.action === "cancel") continue;
      if (!exception)
        result.push(
          await decorate(
            db,
            template,
            date,
            `series:${template.lineage_id}:${date}`,
            template.series_id,
            viewerId,
            date,
            template.id,
          ),
        );
    }
  }
  for (const exception of exceptions.results)
    if (
      exception.action === "replace" &&
      (!exception.cancelled_from ||
        exception.occurrence_date < exception.cancelled_from) &&
      exception.replacement_schedule_id &&
      exception.replacement_date &&
      exception.replacement_date >= from &&
      exception.replacement_date <= to
    ) {
      const replacement = await db
        .prepare("SELECT * FROM schedules WHERE id = ?")
        .bind(exception.replacement_schedule_id)
        .first<ScheduleRow>();
      if (replacement)
        result.push(
          await decorate(
            db,
            replacement,
            replacement.date,
            `series:${exception.lineage_id}:${exception.occurrence_date}`,
            exception.series_id,
            viewerId,
            exception.occurrence_date,
            exception.template_id,
          ),
        );
    }
  return result.filter((row) => row.date >= from && row.date <= to);
}

export type Interval = { start: number; end: number; provisional: boolean };
export async function intervals(
  db: D1Database,
  occurrence: Pick<
    Occurrence,
    "date" | "periods" | "clock_start" | "clock_end"
  >,
): Promise<Interval[]> {
  const result: Interval[] = [];
  if (occurrence.clock_start)
    result.push({
      start: minute(occurrence.clock_start),
      end: occurrence.clock_end
        ? minute(occurrence.clock_end)
        : Math.min(1440, minute(occurrence.clock_start) + 60),
      provisional: !occurrence.clock_end,
    });
  for (const choice of occurrence.periods) {
    const rows = await periodsFor(db, choice.campus_id, occurrence.date);
    const row = rows.find(
      (item) => item.period_number === choice.period_number,
    );
    if (row)
      result.push({
        start: minute(row.start_time),
        end: minute(row.end_time),
        provisional: false,
      });
  }
  return mergeIntervals(result);
}
export function mergeIntervals(items: Interval[]): Interval[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Interval[] = [];
  for (const item of sorted) {
    const previous = merged.at(-1);
    if (previous && item.start <= previous.end) {
      previous.end = Math.max(previous.end, item.end);
      previous.provisional ||= item.provisional;
    } else merged.push({ ...item });
  }
  return merged;
}
export function overlaps(a: Interval[], b: Interval[]): boolean {
  return a.some((left) =>
    b.some((right) => left.start < right.end && right.start < left.end),
  );
}

export async function restrictionReasons(
  db: D1Database,
  schedule: Occurrence,
): Promise<string[]> {
  const endOfDay = dayStartTokyo(addDays(schedule.date, 1));
  const rows = await db
    .prepare(
      `SELECT * FROM restrictions WHERE start_date <= ? AND end_date >= ?
    AND (removed_at IS NULL OR removed_at > ?) AND created_at < ?`,
    )
    .bind(
      schedule.date,
      schedule.date,
      restrictionCutoff(schedule.date),
      endOfDay,
    )
    .all<{
      id: string;
      campus_id: Campus;
      clock_start: string | null;
      clock_end: string | null;
      reason: string;
      removed_at: string | null;
    }>();
  const reasons: string[] = [];
  for (const row of rows.results) {
    if (schedule.scope !== "common" && schedule.scope !== row.campus_id)
      continue;
    if (row.removed_at && row.removed_at < schedule.created_at) continue;
    const [restrictedLocations, restrictedPeriods] = await Promise.all([
      db
        .prepare(
          "SELECT location_id FROM restriction_locations WHERE restriction_id = ?",
        )
        .bind(row.id)
        .all<{ location_id: string }>(),
      db
        .prepare(
          "SELECT period_number FROM restriction_periods WHERE restriction_id = ?",
        )
        .bind(row.id)
        .all<{ period_number: number }>(),
    ]);
    if (
      restrictedLocations.results.length &&
      !schedule.locations.some((loc) =>
        restrictedLocations.results.some(
          (match) => match.location_id === loc.id,
        ),
      )
    )
      continue;
    const restrictedIntervals: Interval[] = [];
    if (row.clock_start && row.clock_end)
      restrictedIntervals.push({
        start: minute(row.clock_start),
        end: minute(row.clock_end),
        provisional: false,
      });
    if (restrictedPeriods.results.length) {
      const master = await periodsFor(db, row.campus_id, schedule.date);
      for (const choice of restrictedPeriods.results) {
        const period = master.find(
          (candidate) => candidate.period_number === choice.period_number,
        );
        if (period)
          restrictedIntervals.push({
            start: minute(period.start_time),
            end: minute(period.end_time),
            provisional: false,
          });
      }
    }
    const scheduleIntervals = await intervals(db, {
      ...schedule,
      periods: schedule.periods.filter(
        (period) => period.campus_id === row.campus_id,
      ),
    });
    if (
      !restrictedIntervals.length ||
      overlaps(scheduleIntervals, restrictedIntervals)
    )
      reasons.push(row.reason);
  }
  return [...new Set(reasons)];
}

export async function calendarOverview(
  db: D1Database,
  campusId: Campus,
  from: string,
  to: string,
  viewerId: string,
) {
  const [days, rows, restrictions] = await Promise.all([
    calendarDays(db, campusId, from, to),
    occurrences(db, from, to, viewerId),
    db
      .prepare(
        "SELECT start_date, end_date, created_at, removed_at FROM restrictions WHERE campus_id = ? AND start_date <= ? AND end_date >= ?",
      )
      .bind(campusId, to, from)
      .all<{
        start_date: string;
        end_date: string;
        created_at: string;
        removed_at: string | null;
      }>(),
  ]);
  return days.map((day) => {
    const visible = rows.filter(
      (row) =>
        row.date === day.date &&
        (row.scope === "common" || row.scope === campusId),
    );
    return {
      ...day,
      participant_count: new Set(
        visible.filter((row) => row.valid).map((row) => row.user_id),
      ).size,
      has_restriction: restrictions.results.some(
        (item) =>
          item.start_date <= day.date &&
          item.end_date >= day.date &&
          item.created_at < dayStartTokyo(addDays(day.date, 1)) &&
          (!item.removed_at || item.removed_at > restrictionCutoff(day.date)),
      ),
      has_invalid_schedule: visible.some((row) => !row.valid),
      schedule_count: visible.length,
    };
  });
}
