import {
  addDays,
  calendarDays,
  campus,
  dateOnly,
  dayStartTokyo,
  periodsFor,
  restrictionCutoff,
  timeOnly,
  todayTokyo,
  type Campus,
} from "./calendar";
import {
  ApiProblem,
  calendarOverview,
  intervals,
  occurrences,
  overlaps,
  parseScheduleInput,
  recurrenceDates,
  requireValid,
  restrictionReasons,
  validateScheduleReferences,
  type Occurrence,
  type ScheduleInput,
  type ScheduleRow,
} from "./phase2-domain";
import {
  effectivePermissions,
  hasPermission,
  type Permission,
} from "./permissions";
import type { Env, UserRow } from "./types";

function reply(data: unknown, status = 200): Response {
  return Response.json(
    { data },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
function fail(problem: ApiProblem): Response {
  return Response.json(
    {
      error: {
        code: problem.code,
        message: problem.message,
        details: problem.details,
      },
    },
    { status: problem.status, headers: { "Cache-Control": "no-store" } },
  );
}
async function inputBody(request: Request): Promise<Record<string, unknown>> {
  requireValid(
    request.headers
      .get("Content-Type")
      ?.toLowerCase()
      .startsWith("application/json"),
  );
  const text = await request.text();
  requireValid(text.length <= 16_384);
  try {
    const value: unknown = JSON.parse(text);
    requireValid(value && typeof value === "object" && !Array.isArray(value));
    return value as Record<string, unknown>;
  } catch {
    throw new ApiProblem(400, "VALIDATION", "JSONを確認してください。");
  }
}
function allowed(permissions: ReadonlySet<Permission>, key: Permission): void {
  if (!hasPermission(permissions, key))
    throw new ApiProblem(403, "FORBIDDEN", "この操作を行う権限がありません。");
}
function allowedAny(
  permissions: ReadonlySet<Permission>,
  keys: Permission[],
): void {
  if (!keys.some((key) => hasPermission(permissions, key)))
    throw new ApiProblem(403, "FORBIDDEN", "この操作を行う権限がありません。");
}
function requiredDate(value: unknown): string {
  requireValid(dateOnly(value));
  return value;
}
function requiredCampus(value: unknown): Campus {
  requireValid(campus(value));
  return value;
}
function name(value: unknown): string {
  requireValid(
    typeof value === "string" &&
      value.trim().length > 0 &&
      value.trim().length <= 100,
  );
  return value.trim();
}
function dateRange(url: URL): { from: string; to: string } {
  const from = requiredDate(url.searchParams.get("from"));
  const to = requiredDate(url.searchParams.get("to"));
  requireValid(
    from <= to && to <= addDays(from, 41),
    "表示期間を確認してください。",
  );
  return { from, to };
}

function scheduleStatements(
  db: D1Database,
  id: string,
  ownerId: string,
  input: ScheduleInput,
  kind: ScheduleRow["kind"],
  seriesId: string | null,
): D1PreparedStatement[] {
  const now = new Date().toISOString();
  const statements = [
    db
      .prepare(
        `INSERT INTO schedules (id,user_id,date,scope,clock_start,clock_end,private_memo,shared_memo,kind,recurrence_series_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id,
        ownerId,
        input.date,
        input.scope,
        input.clock_start,
        input.clock_end,
        input.private_memo,
        input.shared_memo,
        kind,
        seriesId,
        now,
        now,
      ),
  ];
  for (const period of input.periods)
    statements.push(
      db
        .prepare("INSERT INTO schedule_periods VALUES (?,?,?)")
        .bind(id, period.campus_id, period.period_number),
    );
  for (const locationId of input.location_ids)
    statements.push(
      db
        .prepare("INSERT INTO schedule_locations VALUES (?,?)")
        .bind(id, locationId),
    );
  return statements;
}
async function candidate(
  db: D1Database,
  ownerId: string,
  input: ScheduleInput,
): Promise<Occurrence> {
  const locations = [];
  for (const id of input.location_ids) {
    const location = await db
      .prepare("SELECT id, campus_id, name, active FROM locations WHERE id = ?")
      .bind(id)
      .first<Occurrence["locations"][number]>();
    if (location) locations.push(location);
  }
  return {
    id: "candidate",
    occurrence_id: "candidate",
    user_id: ownerId,
    date: input.date,
    original_date: input.date,
    scope: input.scope,
    clock_start: input.clock_start,
    clock_end: input.clock_end,
    private_memo: input.private_memo,
    shared_memo: input.shared_memo,
    kind: "single",
    recurrence_series_id: null,
    series_id: null,
    template_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    periods: input.periods,
    locations,
    owner: { display_name: "", grade: 0, roles: [], positions: [] },
    valid: true,
    invalid_reasons: [],
  };
}
async function ensureCanSave(
  db: D1Database,
  ownerId: string,
  input: ScheduleInput,
  ignoreOccurrenceId?: string,
  previousOccurrence?: Occurrence,
): Promise<void> {
  const proposed = await candidate(db, ownerId, input);
  if (previousOccurrence) proposed.created_at = previousOccurrence.created_at;
  const restrictions = await restrictionReasons(db, proposed);
  if (restrictions.length && previousOccurrence?.valid !== false)
    throw new ApiProblem(409, "RESTRICTED", "施設利用制限に該当します。", {
      reasons: restrictions,
    });
  const existing = (
    await occurrences(db, input.date, input.date, ownerId)
  ).filter(
    (row) =>
      row.user_id === ownerId && row.occurrence_id !== ignoreOccurrenceId,
  );
  const proposedIntervals = await intervals(db, proposed);
  const conflicts = [];
  for (const row of existing) {
    const existingIntervals = await intervals(db, row);
    if (overlaps(proposedIntervals, existingIntervals))
      conflicts.push({
        occurrence_id: row.occurrence_id,
        provisional:
          proposedIntervals.some((x) => x.provisional) ||
          existingIntervals.some((x) => x.provisional),
      });
  }
  if (conflicts.length && input.continue_conflict !== true)
    throw new ApiProblem(
      409,
      "SCHEDULE_CONFLICT",
      "同じ日の予定と時間が重なります。",
      { conflicts, requires_continue: true },
    );
}

async function createSchedule(
  db: D1Database,
  ownerId: string,
  input: ScheduleInput,
): Promise<{ id: string; series_id?: string }> {
  await validateScheduleReferences(db, input);
  requireValid(input.date >= todayTokyo(), "過去日の予定は登録できません。");
  if (input.recurrence) {
    requireValid(
      input.recurrence.weekdays.includes(
        new Date(`${input.date}T00:00:00Z`).getUTCDay(),
      ),
      "開始日は選択曜日に含めてください。",
    );
    const days = recurrenceDates(
      input.date,
      input.recurrence.end_date,
      input.recurrence.weekdays,
    );
    for (const date of days) {
      await validateScheduleReferences(db, { ...input, date });
      await ensureCanSave(db, ownerId, { ...input, date });
    }
    const id = crypto.randomUUID();
    const seriesId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          "INSERT INTO recurrence_series (id,lineage_id,user_id,start_date,end_date,weekdays,created_at) VALUES (?,?,?,?,?,?,?)",
        )
        .bind(
          seriesId,
          seriesId,
          ownerId,
          input.date,
          input.recurrence.end_date,
          JSON.stringify(input.recurrence.weekdays),
          now,
        ),
      ...scheduleStatements(db, id, ownerId, input, "template", seriesId),
    ]);
    return { id, series_id: seriesId };
  }
  await ensureCanSave(db, ownerId, input);
  const id = crypto.randomUUID();
  await db.batch(scheduleStatements(db, id, ownerId, input, "single", null));
  return { id };
}

type ExistingException = {
  action: "cancel" | "replace";
  replacement_schedule_id: string | null;
};

async function existingException(
  db: D1Database,
  seriesId: string,
  occurrenceDate: string,
): Promise<ExistingException | null> {
  return db
    .prepare(
      "SELECT action,replacement_schedule_id FROM recurrence_exceptions WHERE series_id=? AND occurrence_date=?",
    )
    .bind(seriesId, occurrenceDate)
    .first<ExistingException>();
}

function requireMutableScheduleDate(date: string): void {
  requireValid(date >= todayTokyo(), "過去日の予定は変更できません。");
}

function exceptionChangeStatements(
  db: D1Database,
  seriesId: string,
  occurrenceDate: string,
  action: ExistingException["action"],
  replacementId: string | null,
  previous: ExistingException | null,
): D1PreparedStatement[] {
  const statements = [
    db
      .prepare(
        `INSERT INTO recurrence_exceptions (series_id,occurrence_date,action,replacement_schedule_id)
        VALUES (?,?,?,?) ON CONFLICT(series_id,occurrence_date) DO UPDATE SET
        action=excluded.action,replacement_schedule_id=excluded.replacement_schedule_id
        WHERE recurrence_exceptions.action IS ? AND recurrence_exceptions.replacement_schedule_id IS ?`,
      )
      .bind(
        seriesId,
        occurrenceDate,
        action,
        replacementId,
        previous?.action ?? null,
        previous?.replacement_schedule_id ?? null,
      ),
    db
      .prepare(
        `SELECT CASE WHEN EXISTS (
          SELECT 1 FROM recurrence_exceptions
          WHERE series_id=? AND occurrence_date=? AND action=? AND replacement_schedule_id IS ?
        ) THEN 1 ELSE json_extract('invalid', '$') END`,
      )
      .bind(seriesId, occurrenceDate, action, replacementId),
  ];
  if (previous?.replacement_schedule_id) {
    const oldId = previous.replacement_schedule_id;
    statements.push(
      db
        .prepare(
          `DELETE FROM schedules WHERE id=? AND kind='exception' AND NOT EXISTS (
            SELECT 1 FROM recurrence_exceptions WHERE replacement_schedule_id=?
          )`,
        )
        .bind(oldId, oldId),
    );
  }
  return statements;
}

async function mutateSchedule(
  db: D1Database,
  id: string,
  method: string,
  body: Record<string, unknown>,
  user: UserRow,
  permissions: ReadonlySet<Permission>,
): Promise<Response> {
  const row = await db
    .prepare("SELECT * FROM schedules WHERE id = ?")
    .bind(id)
    .first<ScheduleRow>();
  if (!row) throw new ApiProblem(404, "NOT_FOUND", "予定が見つかりません。");
  allowed(
    permissions,
    row.user_id === user.id
      ? method === "DELETE"
        ? "SCHEDULE_DELETE_SELF"
        : "SCHEDULE_EDIT_SELF"
      : method === "DELETE"
        ? "SCHEDULE_DELETE_OTHERS"
        : "SCHEDULE_EDIT_OTHERS",
  );
  const originalDate = requiredDate(body.occurrence_date ?? row.date);
  requireMutableScheduleDate(originalDate);
  const scope = body.occurrence_scope;
  requireValid(
    row.kind !== "template" || scope === "this" || scope === "following",
    "変更範囲を選択してください。",
  );
  if (row.kind !== "template") requireValid(originalDate === row.date);
  if (row.kind === "exception") {
    const exception = await db
      .prepare(
        "SELECT occurrence_date FROM recurrence_exceptions WHERE replacement_schedule_id=?",
      )
      .bind(id)
      .first<{ occurrence_date: string }>();
    requireValid(exception !== null);
    requireMutableScheduleDate(exception.occurrence_date);
  }
  type SeriesRow = {
    id: string;
    lineage_id: string;
    start_date: string;
    end_date: string;
    weekdays: string;
  };
  let series: SeriesRow | null = null;
  if (row.kind === "template") {
    series = await db
      .prepare(
        "SELECT id,lineage_id,start_date,end_date,weekdays FROM recurrence_series WHERE id = ?",
      )
      .bind(row.recurrence_series_id)
      .first<SeriesRow>();
    if (
      !series ||
      originalDate < series.start_date ||
      originalDate > series.end_date ||
      !JSON.parse(series.weekdays).includes(
        new Date(`${originalDate}T00:00:00Z`).getUTCDay(),
      )
    )
      throw new ApiProblem(404, "NOT_FOUND", "発生回が見つかりません。");
  }
  const previousException = series
    ? await existingException(db, series.id, originalDate)
    : null;
  if (previousException?.replacement_schedule_id) {
    const replacement = await db
      .prepare("SELECT date FROM schedules WHERE id=?")
      .bind(previousException.replacement_schedule_id)
      .first<{ date: string }>();
    requireValid(replacement !== null);
    requireMutableScheduleDate(replacement.date);
  }
  if (method === "DELETE") {
    if (!series) {
      await db.prepare("DELETE FROM schedules WHERE id = ?").bind(id).run();
    } else if (scope === "this") {
      await db.batch(
        exceptionChangeStatements(
          db,
          series.id,
          originalDate,
          "cancel",
          null,
          previousException,
        ),
      );
    } else {
      await db
        .prepare("UPDATE recurrence_series SET cancelled_from = ? WHERE id = ?")
        .bind(originalDate, series.id)
        .run();
    }
    return reply({ ok: true });
  }
  const input = parseScheduleInput(body.schedule);
  requireMutableScheduleDate(input.date);
  requireValid(input.user_id === undefined || input.user_id === row.user_id);
  const oldLocations = await db
    .prepare("SELECT location_id FROM schedule_locations WHERE schedule_id = ?")
    .bind(id)
    .all<{ location_id: string }>();
  await validateScheduleReferences(
    db,
    input,
    oldLocations.results.map((x) => x.location_id),
  );
  const originalOccurrenceId = series
    ? `series:${series.lineage_id}:${originalDate}`
    : id;
  const previousOccurrence = (
    await occurrences(db, originalDate, originalDate, row.user_id)
  ).find((item) => item.occurrence_id === originalOccurrenceId);
  await ensureCanSave(
    db,
    row.user_id,
    input,
    originalOccurrenceId,
    previousOccurrence,
  );
  const now = new Date().toISOString();
  if (!series) {
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          `UPDATE schedules SET date=?,scope=?,clock_start=?,clock_end=?,private_memo=?,shared_memo=?,memo=NULL,memo_visibility='everyone',updated_at=? WHERE id=?`,
        )
        .bind(
          input.date,
          input.scope,
          input.clock_start,
          input.clock_end,
          input.private_memo,
          input.shared_memo,
          now,
          id,
        ),
      db.prepare("DELETE FROM schedule_periods WHERE schedule_id=?").bind(id),
      db.prepare("DELETE FROM schedule_locations WHERE schedule_id=?").bind(id),
    ];
    for (const p of input.periods)
      statements.push(
        db
          .prepare("INSERT INTO schedule_periods VALUES (?,?,?)")
          .bind(id, p.campus_id, p.period_number),
      );
    for (const locationId of input.location_ids)
      statements.push(
        db
          .prepare("INSERT INTO schedule_locations VALUES (?,?)")
          .bind(id, locationId),
      );
    await db.batch(statements);
  } else if (scope === "this") {
    const replacementId = crypto.randomUUID();
    await db.batch([
      ...scheduleStatements(
        db,
        replacementId,
        row.user_id,
        input,
        "exception",
        series.id,
      ),
      ...exceptionChangeStatements(
        db,
        series.id,
        originalDate,
        "replace",
        replacementId,
        previousException,
      ),
    ]);
  } else {
    requireValid(
      input.date === originalDate,
      "この日以降の変更では開始日を移動できません。",
    );
    const replacementId = crypto.randomUUID();
    const nextSeriesId = crypto.randomUUID();
    const weekdays =
      input.recurrence?.weekdays ?? (JSON.parse(series.weekdays) as number[]);
    const endDate = input.recurrence?.end_date ?? series.end_date;
    requireValid(endDate >= originalDate);
    requireValid(
      weekdays.includes(new Date(`${originalDate}T00:00:00Z`).getUTCDay()),
      "開始日は選択曜日に含めてください。",
    );
    for (const date of recurrenceDates(originalDate, endDate, weekdays)) {
      await validateScheduleReferences(
        db,
        { ...input, date },
        oldLocations.results.map((item) => item.location_id),
      );
      await ensureCanSave(
        db,
        row.user_id,
        { ...input, date },
        `series:${series.lineage_id}:${date}`,
        (await occurrences(db, date, date, row.user_id)).find(
          (item) =>
            item.occurrence_id === `series:${series.lineage_id}:${date}`,
        ),
      );
    }
    const split =
      originalDate === series.start_date
        ? db
            .prepare("UPDATE recurrence_series SET cancelled_from=? WHERE id=?")
            .bind(originalDate, series.id)
        : db
            .prepare("UPDATE recurrence_series SET end_date=? WHERE id=?")
            .bind(addDays(originalDate, -1), series.id);
    await db.batch([
      split,
      db
        .prepare(
          `INSERT INTO recurrence_series (id,lineage_id,user_id,start_date,end_date,weekdays,predecessor_id,created_at)
        VALUES (?,?,?,?,?,?,?,?)`,
        )
        .bind(
          nextSeriesId,
          series.lineage_id,
          row.user_id,
          originalDate,
          endDate,
          JSON.stringify(weekdays),
          series.id,
          now,
        ),
      ...scheduleStatements(
        db,
        replacementId,
        row.user_id,
        input,
        "template",
        nextSeriesId,
      ),
      db
        .prepare(
          "UPDATE recurrence_exceptions SET series_id=? WHERE series_id=? AND occurrence_date>=?",
        )
        .bind(nextSeriesId, series.id, originalDate),
    ]);
  }
  return reply({ ok: true });
}

async function management(
  request: Request,
  env: Env,
  user: UserRow,
  permissions: ReadonlySet<Permission>,
  path: string,
  url: URL,
): Promise<Response | null> {
  const db = env.DB;
  const method = request.method;
  if (path === "/api/locations" && method === "GET") {
    allowedAny(permissions, [
      "SCHEDULE_VIEW",
      "LOCATION_MANAGE",
      "RESTRICTION_MANAGE",
    ]);
    const campusId = requiredCampus(url.searchParams.get("campus_id"));
    const rows = await db
      .prepare(
        `SELECT id,campus_id,name,active FROM locations WHERE campus_id=?
      AND (active=1 OR ?=1) ORDER BY name`,
      )
      .bind(campusId, permissions.has("LOCATION_MANAGE") ? 1 : 0)
      .all();
    return reply(rows.results);
  }
  if (path === "/api/locations" && method === "POST") {
    allowed(permissions, "LOCATION_MANAGE");
    const v = await inputBody(request);
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    await db
      .prepare("INSERT INTO locations VALUES (?,?,?,1,?,?)")
      .bind(id, requiredCampus(v.campus_id), name(v.name), now, now)
      .run();
    return reply({ id }, 201);
  }
  const locationId = /^\/api\/locations\/([^/]+)$/.exec(path)?.[1];
  if (locationId && method === "PATCH") {
    allowed(permissions, "LOCATION_MANAGE");
    const v = await inputBody(request);
    requireValid(typeof v.active === "boolean" && typeof v.name === "string");
    const exists = await db
      .prepare("SELECT id FROM locations WHERE id=?")
      .bind(locationId)
      .first();
    if (!exists)
      throw new ApiProblem(404, "NOT_FOUND", "Locationが見つかりません。");
    await db
      .prepare("UPDATE locations SET name=?,active=?,updated_at=? WHERE id=?")
      .bind(
        name(v.name),
        v.active ? 1 : 0,
        new Date().toISOString(),
        locationId,
      )
      .run();
    return reply({ ok: true });
  }
  if (path === "/api/class-periods" && method === "GET") {
    allowedAny(permissions, [
      "SCHEDULE_VIEW",
      "CALENDAR_MANAGE",
      "RESTRICTION_MANAGE",
    ]);
    const campusId = requiredCampus(url.searchParams.get("campus_id"));
    const date = requiredDate(url.searchParams.get("date"));
    return reply(await periodsFor(db, campusId, date));
  }
  if (path === "/api/class-periods" && method === "POST") {
    allowed(permissions, "CALENDAR_MANAGE");
    const v = await inputBody(request);
    const campusId = requiredCampus(v.campus_id);
    const from = requiredDate(v.effective_from);
    requireValid(
      from >= todayTokyo() &&
        Number.isInteger(v.period_number) &&
        Number(v.period_number) > 0,
    );
    requireValid(
      timeOnly(v.start_time) &&
        timeOnly(v.end_time) &&
        v.start_time < v.end_time,
    );
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO class_periods (id,campus_id,period_number,start_time,end_time,effective_from,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id,
        campusId,
        v.period_number,
        v.start_time,
        v.end_time,
        from,
        now,
        now,
      )
      .run();
    return reply({ id }, 201);
  }
  const periodId = /^\/api\/class-periods\/([^/]+)$/.exec(path)?.[1];
  if (periodId && method === "PATCH") {
    allowed(permissions, "CALENDAR_MANAGE");
    const v = await inputBody(request);
    const old = await db
      .prepare("SELECT * FROM class_periods WHERE id=?")
      .bind(periodId)
      .first<{
        campus_id: Campus;
        period_number: number;
        effective_from: string;
        effective_to: string | null;
      }>();
    if (!old) throw new ApiProblem(404, "NOT_FOUND", "時限が見つかりません。");
    const from = requiredDate(v.effective_from);
    requireValid(
      from >= todayTokyo() &&
        from >= old.effective_from &&
        (!old.effective_to || from <= old.effective_to),
    );
    requireValid(
      timeOnly(v.start_time) &&
        timeOnly(v.end_time) &&
        v.start_time < v.end_time,
    );
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    if (from === old.effective_from) {
      await db
        .prepare(
          "UPDATE class_periods SET start_time=?,end_time=?,updated_at=? WHERE id=?",
        )
        .bind(v.start_time, v.end_time, now, periodId)
        .run();
      return reply({ id: periodId });
    }
    await db.batch([
      db
        .prepare(
          "UPDATE class_periods SET effective_to=?,updated_at=? WHERE id=?",
        )
        .bind(addDays(from, -1), now, periodId),
      db
        .prepare(
          `INSERT INTO class_periods (id,campus_id,period_number,start_time,end_time,effective_from,effective_to,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          id,
          old.campus_id,
          old.period_number,
          v.start_time,
          v.end_time,
          from,
          old.effective_to,
          now,
          now,
        ),
    ]);
    return reply({ id });
  }
  if (path === "/api/closures" && method === "GET") {
    allowedAny(permissions, ["SCHEDULE_VIEW", "CALENDAR_MANAGE"]);
    const campusId = requiredCampus(url.searchParams.get("campus_id"));
    const rows = await db
      .prepare(
        "SELECT * FROM university_closure_periods WHERE campus_id=? ORDER BY start_date",
      )
      .bind(campusId)
      .all();
    return reply(rows.results);
  }
  if (path === "/api/closures" && method === "POST") {
    allowed(permissions, "CALENDAR_MANAGE");
    const v = await inputBody(request);
    const start = requiredDate(v.start_date),
      end = requiredDate(v.end_date);
    requireValid(start <= end);
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    await db
      .prepare("INSERT INTO university_closure_periods VALUES (?,?,?,?,?,?,?)")
      .bind(
        id,
        requiredCampus(v.campus_id),
        start,
        end,
        name(v.reason),
        now,
        now,
      )
      .run();
    return reply({ id }, 201);
  }
  const closureId = /^\/api\/closures\/([^/]+)$/.exec(path)?.[1];
  if (closureId && method === "PATCH") {
    allowed(permissions, "CALENDAR_MANAGE");
    const v = await inputBody(request);
    const start = requiredDate(v.start_date),
      end = requiredDate(v.end_date);
    requireValid(start <= end);
    const old = await db
      .prepare("SELECT id FROM university_closure_periods WHERE id=?")
      .bind(closureId)
      .first();
    if (!old)
      throw new ApiProblem(404, "NOT_FOUND", "休業期間が見つかりません。");
    await db
      .prepare(
        "UPDATE university_closure_periods SET start_date=?,end_date=?,reason=?,updated_at=? WHERE id=?",
      )
      .bind(start, end, name(v.reason), new Date().toISOString(), closureId)
      .run();
    return reply({ ok: true });
  }
  if (closureId && method === "DELETE") {
    allowed(permissions, "CALENDAR_MANAGE");
    await db
      .prepare("DELETE FROM university_closure_periods WHERE id=?")
      .bind(closureId)
      .run();
    return reply({ ok: true });
  }
  if (path === "/api/overrides" && method === "GET") {
    allowedAny(permissions, ["SCHEDULE_VIEW", "CALENDAR_MANAGE"]);
    const campusId = requiredCampus(url.searchParams.get("campus_id"));
    const rows = await db
      .prepare(
        "SELECT * FROM university_calendar_overrides WHERE campus_id=? ORDER BY date",
      )
      .bind(campusId)
      .all();
    return reply(rows.results);
  }
  if (path === "/api/overrides" && method === "POST") {
    allowed(permissions, "CALENDAR_MANAGE");
    const v = await inputBody(request);
    requireValid(v.kind === "teaching" || v.kind === "no_school");
    const now = new Date().toISOString(),
      id = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO university_calendar_overrides VALUES (?,?,?,?,?,?,?)",
      )
      .bind(
        id,
        requiredCampus(v.campus_id),
        requiredDate(v.date),
        v.kind,
        name(v.reason),
        now,
        now,
      )
      .run();
    return reply({ id }, 201);
  }
  const overrideId = /^\/api\/overrides\/([^/]+)$/.exec(path)?.[1];
  if (overrideId && method === "PATCH") {
    allowed(permissions, "CALENDAR_MANAGE");
    const v = await inputBody(request);
    requireValid(v.kind === "teaching" || v.kind === "no_school");
    const old = await db
      .prepare("SELECT id FROM university_calendar_overrides WHERE id=?")
      .bind(overrideId)
      .first();
    if (!old)
      throw new ApiProblem(404, "NOT_FOUND", "個別日設定が見つかりません。");
    await db
      .prepare(
        "UPDATE university_calendar_overrides SET date=?,kind=?,reason=?,updated_at=? WHERE id=?",
      )
      .bind(
        requiredDate(v.date),
        v.kind,
        name(v.reason),
        new Date().toISOString(),
        overrideId,
      )
      .run();
    return reply({ ok: true });
  }
  if (overrideId && method === "DELETE") {
    allowed(permissions, "CALENDAR_MANAGE");
    await db
      .prepare("DELETE FROM university_calendar_overrides WHERE id=?")
      .bind(overrideId)
      .run();
    return reply({ ok: true });
  }
  if (path === "/api/restrictions" && method === "GET") {
    allowedAny(permissions, ["SCHEDULE_VIEW", "RESTRICTION_MANAGE"]);
    const campusId = requiredCampus(url.searchParams.get("campus_id"));
    const rows = await db
      .prepare(
        "SELECT * FROM restrictions WHERE campus_id=? AND removed_at IS NULL ORDER BY start_date",
      )
      .bind(campusId)
      .all<{ id: string }>();
    const enriched = [];
    for (const row of rows.results) {
      const [locations, periods] = await Promise.all([
        db
          .prepare(
            "SELECT location_id FROM restriction_locations WHERE restriction_id=?",
          )
          .bind(row.id)
          .all<{ location_id: string }>(),
        db
          .prepare(
            "SELECT period_number FROM restriction_periods WHERE restriction_id=?",
          )
          .bind(row.id)
          .all<{ period_number: number }>(),
      ]);
      enriched.push({
        ...row,
        location_ids: locations.results.map((item) => item.location_id),
        period_numbers: periods.results.map((item) => item.period_number),
      });
    }
    return reply(enriched);
  }
  if (path === "/api/restrictions" && method === "POST") {
    allowed(permissions, "RESTRICTION_MANAGE");
    const v = await inputBody(request);
    const result = await saveRestriction(db, v, user.id);
    return reply(result, 201);
  }
  const restrictionId = /^\/api\/restrictions\/([^/]+)$/.exec(path)?.[1];
  if (restrictionId && (method === "PATCH" || method === "DELETE")) {
    allowed(permissions, "RESTRICTION_MANAGE");
    const existing = await db
      .prepare("SELECT * FROM restrictions WHERE id=? AND removed_at IS NULL")
      .bind(restrictionId)
      .first<{ id: string; lineage_id: string; end_date: string }>();
    if (!existing)
      throw new ApiProblem(404, "NOT_FOUND", "制限が見つかりません。");
    requireValid(
      existing.end_date >= todayTokyo(),
      "過去日のみを対象とする制限は変更できません。",
    );
    const now = new Date().toISOString();
    if (method === "DELETE") {
      await db
        .prepare("UPDATE restrictions SET removed_at=? WHERE id=?")
        .bind(now, restrictionId)
        .run();
      return reply({ ok: true });
    }
    const v = await inputBody(request);
    const previousLocations = await db
      .prepare(
        "SELECT location_id FROM restriction_locations WHERE restriction_id=?",
      )
      .bind(restrictionId)
      .all<{ location_id: string }>();
    const prepared = await restrictionStatements(
      db,
      v,
      user.id,
      existing.lineage_id,
      previousLocations.results.map((item) => item.location_id),
    );
    await db.batch([
      db
        .prepare("UPDATE restrictions SET removed_at=? WHERE id=?")
        .bind(now, restrictionId),
      ...prepared.statements,
    ]);
    return reply({ id: prepared.id });
  }
  return null;
}

async function restrictionStatements(
  db: D1Database,
  v: Record<string, unknown>,
  actorId: string,
  lineage?: string,
  existingLocations: string[] = [],
) {
  const campusId = requiredCampus(v.campus_id),
    start = requiredDate(v.start_date),
    end = requiredDate(v.end_date);
  requireValid(
    start >= todayTokyo() && start <= end,
    "過去日を対象にした制限は変更できません。",
  );
  requireValid(
    (v.clock_start === null && v.clock_end === null) ||
      (timeOnly(v.clock_start) &&
        timeOnly(v.clock_end) &&
        v.clock_start < v.clock_end),
  );
  requireValid(
    Array.isArray(v.location_ids) &&
      v.location_ids.length <= 30 &&
      v.location_ids.every((id) => typeof id === "string"),
  );
  requireValid(
    Array.isArray(v.period_numbers) &&
      v.period_numbers.length <= 12 &&
      v.period_numbers.every(
        (number) => Number.isInteger(number) && number > 0,
      ),
  );
  const locationIds = v.location_ids as string[],
    numbers = v.period_numbers as number[];
  requireValid(
    v.confirm_impact === true,
    "既存予定への影響を確認してください。",
  );
  requireValid(
    new Set(locationIds).size === locationIds.length &&
      new Set(numbers).size === numbers.length,
  );
  for (const locationId of locationIds) {
    const location = await db
      .prepare("SELECT campus_id,active FROM locations WHERE id=?")
      .bind(locationId)
      .first<{ campus_id: string; active: number }>();
    requireValid(
      location &&
        location.campus_id === campusId &&
        (location.active === 1 || existingLocations.includes(locationId)),
    );
  }
  const available = await periodsFor(db, campusId, start);
  for (const number of numbers)
    requireValid(available.some((p) => p.period_number === number));
  const id = crypto.randomUUID(),
    now = new Date().toISOString();
  const statements = [
    db
      .prepare(
        `INSERT INTO restrictions (id,lineage_id,campus_id,start_date,end_date,clock_start,clock_end,reason,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id,
        lineage ?? id,
        campusId,
        start,
        end,
        v.clock_start,
        v.clock_end,
        name(v.reason),
        actorId,
        now,
      ),
  ];
  for (const locationId of locationIds)
    statements.push(
      db
        .prepare("INSERT INTO restriction_locations VALUES (?,?)")
        .bind(id, locationId),
    );
  for (const number of numbers)
    statements.push(
      db
        .prepare("INSERT INTO restriction_periods VALUES (?,?)")
        .bind(id, number),
    );
  return { id, statements };
}
async function saveRestriction(
  db: D1Database,
  v: Record<string, unknown>,
  actorId: string,
) {
  const prepared = await restrictionStatements(db, v, actorId);
  await db.batch(prepared.statements);
  return { id: prepared.id };
}

export async function handlePhase2(
  request: Request,
  env: Env,
  user: UserRow,
): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname,
    method = request.method;
  try {
    const permissions = await effectivePermissions(env.DB, user.id);
    if (path === "/api/calendar" && method === "GET") {
      allowed(permissions, "SCHEDULE_VIEW");
      const campusId = requiredCampus(url.searchParams.get("campus_id"));
      const { from, to } = dateRange(url);
      return reply(await calendarOverview(env.DB, campusId, from, to, user.id));
    }
    if (path === "/api/calendar/day" && method === "GET") {
      allowed(permissions, "SCHEDULE_VIEW");
      const campusId = requiredCampus(url.searchParams.get("campus_id"));
      const date = requiredDate(url.searchParams.get("date"));
      const [day] = await calendarDays(env.DB, campusId, date, date);
      const schedules = (await occurrences(env.DB, date, date, user.id)).filter(
        (row) => row.scope === "common" || row.scope === campusId,
      );
      const starts = new Map<string, number>();
      for (const row of schedules)
        starts.set(
          row.occurrence_id,
          Math.min(...(await intervals(env.DB, row)).map((item) => item.start)),
        );
      schedules.sort(
        (a, b) =>
          (starts.get(a.occurrence_id) ?? 1440) -
            (starts.get(b.occurrence_id) ?? 1440) ||
          a.owner.grade - b.owner.grade ||
          a.owner.display_name.localeCompare(b.owner.display_name, "ja"),
      );
      const restrictions = await env.DB.prepare(
        `SELECT id,reason,start_date,end_date FROM restrictions
        WHERE campus_id=? AND start_date<=? AND end_date>=? AND (removed_at IS NULL OR removed_at>?) AND created_at<?`,
      )
        .bind(
          campusId,
          date,
          date,
          restrictionCutoff(date),
          dayStartTokyo(addDays(date, 1)),
        )
        .all();
      return reply({ day, schedules, restrictions: restrictions.results });
    }
    if (path === "/api/schedules" && method === "POST") {
      const body = await inputBody(request),
        input = parseScheduleInput(body);
      const ownerId = input.user_id ?? user.id;
      allowed(
        permissions,
        ownerId === user.id ? "SCHEDULE_CREATE_SELF" : "SCHEDULE_CREATE_OTHERS",
      );
      if (ownerId !== user.id) {
        const target = await env.DB.prepare(
          "SELECT id FROM users WHERE id=? AND status='active'",
        )
          .bind(ownerId)
          .first();
        requireValid(target, "対象ユーザーを確認してください。");
      }
      return reply(await createSchedule(env.DB, ownerId, input), 201);
    }
    if (path === "/api/schedules/previous" && method === "GET") {
      allowed(permissions, "SCHEDULE_VIEW");
      const before = requiredDate(url.searchParams.get("before"));
      const row = await env.DB.prepare(
        "SELECT * FROM schedules WHERE user_id=? AND kind='single' AND date<? ORDER BY date DESC LIMIT 1",
      )
        .bind(user.id, before)
        .first<ScheduleRow>();
      if (!row) return reply(null);
      const schedule = (
        await occurrences(env.DB, row.date, row.date, user.id)
      ).find((item) => item.id === row.id);
      return reply(schedule ?? null);
    }
    const scheduleId = /^\/api\/schedules\/([^/]+)$/.exec(path)?.[1];
    if (scheduleId && (method === "PATCH" || method === "DELETE"))
      return await mutateSchedule(
        env.DB,
        scheduleId,
        method,
        await inputBody(request),
        user,
        permissions,
      );
    const managed = await management(
      request,
      env,
      user,
      permissions,
      path,
      url,
    );
    if (managed) return managed;
    throw new ApiProblem(404, "NOT_FOUND", "見つかりません。");
  } catch (cause) {
    if (cause instanceof ApiProblem) return fail(cause);
    console.error("Phase 2 API failure", cause);
    return fail(new ApiProblem(500, "INTERNAL", "処理できませんでした。"));
  }
}
