import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleApi } from "../server/api";
import { issueSession, COOKIE } from "../server/auth";
import {
  academicYear,
  calendarDays,
  todayTokyo,
  addDays,
  dayStartTokyo,
  periodsFor,
  restrictionCutoff,
} from "../server/calendar";
import {
  calendarOverview,
  intervals,
  mergeIntervals,
  overlaps,
  occurrences,
} from "../server/phase2-domain";
import type { Env } from "../server/types";

let sqlite: DatabaseSync;
let env: Env;
let token: string;
const origin = "https://example.test";
const future = addDays(todayTokyo(), 7);
const after = addDays(future, 7);
function database(): D1Database {
  return {
    prepare(sql: string) {
      const prepared = sqlite.prepare(sql);
      const statement = (values: unknown[] = []): D1PreparedStatement =>
        ({
          bind: (...args: unknown[]) => statement(args),
          first: async <T>() =>
            (prepared.get(...(values as [])) ?? null) as T | null,
          all: async <T>() => ({
            results: prepared.all(...(values as [])) as T[],
          }),
          run: async () => {
            prepared.run(...(values as []));
            return { success: true };
          },
        }) as D1PreparedStatement;
      return statement();
    },
    async batch(statements: D1PreparedStatement[]) {
      sqlite.exec("BEGIN");
      try {
        const values = [];
        for (const statement of statements) values.push(await statement.run());
        sqlite.exec("COMMIT");
        return values;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as D1Database;
}
async function setup(
  permissions = [
    "SCHEDULE_VIEW",
    "SCHEDULE_CREATE_SELF",
    "SCHEDULE_EDIT_SELF",
    "SCHEDULE_DELETE_SELF",
    "LOCATION_MANAGE",
    "CALENDAR_MANAGE",
    "RESTRICTION_MANAGE",
  ],
) {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(
    readFileSync(
      new URL("../migrations/0001_phase1.sql", import.meta.url),
      "utf8",
    ),
  );
  sqlite.exec(
    readFileSync(
      new URL("../migrations/0002_phase2.sql", import.meta.url),
      "utf8",
    ),
  );
  sqlite.exec(
    readFileSync(
      new URL("../migrations/0003_display_preferences.sql", import.meta.url),
      "utf8",
    ),
  );
  sqlite.exec(
    readFileSync(
      new URL("../migrations/0004_schedule_memos.sql", import.meta.url),
      "utf8",
    ),
  );
  const now = new Date().toISOString();
  sqlite
    .prepare(
      "INSERT INTO users (id,display_name,password_hash,grade,registration_year,primary_campus_id,terms_version_accepted,terms_accepted_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    )
    .run("owner", "Owner", "test-only", 2, 2026, "omiya", "v1", now, now, now);
  sqlite
    .prepare(
      "INSERT INTO users (id,display_name,password_hash,grade,registration_year,primary_campus_id,terms_version_accepted,terms_accepted_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "viewer",
      "Viewer",
      "test-only",
      1,
      2026,
      "hirakata",
      "v1",
      now,
      now,
      now,
    );
  sqlite
    .prepare("INSERT INTO terms_versions VALUES ('v1','Test terms',1,1,?)")
    .run(now);
  sqlite
    .prepare("INSERT INTO roles VALUES ('test-role','Test role',?,?)")
    .run(now, now);
  sqlite.prepare("INSERT INTO user_roles VALUES ('owner','test-role')").run();
  for (const permission of permissions)
    sqlite
      .prepare("INSERT INTO role_permissions VALUES ('test-role',?)")
      .run(permission);
  sqlite
    .prepare("INSERT INTO locations VALUES ('o-room','omiya','部室',1,?,?)")
    .run(now, now);
  sqlite
    .prepare(
      "INSERT INTO locations VALUES ('h-range','hirakata','アーチェリー場',1,?,?)",
    )
    .run(now, now);
  env = { DB: database() };
  token = await issueSession(env.DB, "owner", env);
}
function request(
  path: string,
  method = "GET",
  body?: object,
  session = token,
  requestOrigin = origin,
) {
  return new Request(`${origin}${path}`, {
    method,
    headers: {
      Cookie: `${COOKIE}=${session}`,
      ...(method !== "GET"
        ? { Origin: requestOrigin, "Content-Type": "application/json" }
        : {}),
    },
    body: method !== "GET" ? JSON.stringify(body ?? {}) : undefined,
  });
}
async function call(
  path: string,
  method = "GET",
  body?: object,
  session = token,
  requestOrigin = origin,
) {
  const response = await handleApi(
    request(path, method, body, session, requestOrigin),
    env,
  );
  return {
    status: response.status,
    json: (await response.json()) as {
      data?: {
        id: string;
        schedules: {
          private_memo?: string | null;
          shared_memo: string | null;
          valid?: boolean;
          invalid_reasons?: string[];
          periods?: { campus_id: string; period_number: number }[];
        }[];
        restrictions?: { id: string; reason: string }[];
      };
      error?: {
        code: string;
        details?: { conflicts: { provisional: boolean }[] };
      };
    },
  };
}
function payload(date = future, scope = "common") {
  return {
    date,
    scope,
    location_ids: ["o-room", "h-range"],
    periods: [
      { campus_id: "omiya", period_number: 6 },
      { campus_id: "hirakata", period_number: 5 },
    ],
    clock_start: "14:00",
    clock_end: "17:00",
    private_memo: "owner only",
    shared_memo: "shared note",
  };
}
function periodPayload(
  numbers: number[],
  clockStart: string | null = null,
  clockEnd: string | null = null,
) {
  return {
    ...payload(future, "omiya"),
    location_ids: ["o-room"],
    periods: numbers.map((period_number) => ({
      campus_id: "omiya",
      period_number,
    })),
    clock_start: clockStart,
    clock_end: clockEnd,
  };
}
async function restrictedSchedule() {
  await setup();
  const created = await call("/api/schedules", "POST", periodPayload([1]));
  expect(created.status).toBe(201);
  const restricted = await call("/api/restrictions", "POST", {
    campus_id: "omiya",
    start_date: future,
    end_date: future,
    reason: "1限の利用制限",
    location_ids: ["o-room"],
    period_numbers: [1],
    clock_start: null,
    clock_end: null,
    confirm_impact: true,
  });
  expect(restricted.status).toBe(201);
  const id = created.json.data!.id;
  expect((await occurrences(env.DB, future, future, "owner"))[0].valid).toBe(
    false,
  );
  return { id, restrictionId: restricted.json.data!.id };
}
async function movedOccurrence(destinationOffset: number) {
  await setup();
  const original = addDays(todayTokyo(), 14);
  const moved = addDays(original, destinationOffset);
  const weekday = new Date(`${original}T00:00:00Z`).getUTCDay();
  const series = {
    ...periodPayload([1]),
    date: original,
    recurrence: { weekdays: [weekday], end_date: addDays(original, 14) },
  };
  const created = await call("/api/schedules", "POST", series);
  expect(created.status).toBe(201);
  const id = created.json.data!.id;
  const replacement = { ...series, recurrence: null, date: moved };
  expect(
    (
      await call(`/api/schedules/${id}`, "PATCH", {
        occurrence_date: original,
        occurrence_scope: "this",
        schedule: replacement,
      })
    ).status,
  ).toBe(200);
  return { id, original, moved, replacement };
}
afterEach(() => {
  vi.useRealTimers();
  sqlite?.close();
});

describe("Phase 2 on migrated SQLite", () => {
  it("edits an invalid future schedule to an unrestricted location", async () => {
    const { id } = await restrictedSchedule();
    const now = new Date().toISOString();
    sqlite
      .prepare("INSERT INTO locations VALUES ('o-other','omiya','別室',1,?,?)")
      .run(now, now);
    const next = { ...periodPayload([1]), location_ids: ["o-other"] };
    expect(
      (
        await call(`/api/schedules/${id}`, "PATCH", {
          occurrence_date: future,
          schedule: next,
        })
      ).status,
    ).toBe(200);
    expect((await occurrences(env.DB, future, future, "owner"))[0].valid).toBe(
      true,
    );
  });
  it("edits an invalid future schedule to an unrestricted period or clock time", async () => {
    const { id } = await restrictedSchedule();
    expect(
      (
        await call(`/api/schedules/${id}`, "PATCH", {
          occurrence_date: future,
          schedule: periodPayload([2]),
        })
      ).status,
    ).toBe(200);
    expect((await occurrences(env.DB, future, future, "owner"))[0].valid).toBe(
      true,
    );
    expect(
      (
        await call(`/api/schedules/${id}`, "PATCH", {
          occurrence_date: future,
          schedule: periodPayload([], "11:00", "12:00"),
        })
      ).status,
    ).toBe(200);
    expect((await occurrences(env.DB, future, future, "owner"))[0].valid).toBe(
      true,
    );
  });
  it("keeps an edited schedule invalid when the new content still meets the restriction", async () => {
    const { id } = await restrictedSchedule();
    const next = { ...periodPayload([1]), shared_memo: "updated" };
    expect(
      (
        await call(`/api/schedules/${id}`, "PATCH", {
          occurrence_date: future,
          schedule: next,
        })
      ).status,
    ).toBe(200);
    expect(
      (await occurrences(env.DB, future, future, "owner"))[0],
    ).toMatchObject({
      valid: false,
      invalid_reasons: ["1限の利用制限"],
      shared_memo: "updated",
    });
  });
  it("continues rejecting a newly restricted change to a previously valid schedule", async () => {
    const { id } = await restrictedSchedule();
    expect(
      (
        await call(`/api/schedules/${id}`, "PATCH", {
          occurrence_date: future,
          schedule: periodPayload([2]),
        })
      ).status,
    ).toBe(200);
    const result = await call(`/api/schedules/${id}`, "PATCH", {
      occurrence_date: future,
      schedule: periodPayload([1]),
    });
    expect(result.status).toBe(409);
    expect(result.json.error?.code).toBe("RESTRICTED");
  });
  it("deletes an invalid future schedule", async () => {
    const { id } = await restrictedSchedule();
    sqlite
      .prepare(
        "DELETE FROM role_permissions WHERE role_id='test-role' AND permission_key='SCHEDULE_EDIT_SELF'",
      )
      .run();
    expect(
      (
        await call(`/api/schedules/${id}`, "DELETE", {
          occurrence_date: future,
        })
      ).status,
    ).toBe(200);
    expect(await occurrences(env.DB, future, future, "owner")).toHaveLength(0);
    expect(
      (await call(`/api/calendar/day?campus_id=omiya&date=${future}`)).json.data
        ?.schedules,
    ).toHaveLength(0);
  });
  it("deletes a valid future single schedule and removes it from calendar and day", async () => {
    await setup();
    const created = await call("/api/schedules", "POST", periodPayload([1]));
    const id = created.json.data!.id;
    expect(
      (
        await call(`/api/schedules/${id}`, "DELETE", {
          occurrence_date: future,
        })
      ).status,
    ).toBe(200);
    expect(
      sqlite.prepare("SELECT count(*) AS n FROM schedules WHERE id=?").get(id),
    ).toEqual({ n: 0 });
    expect(
      sqlite
        .prepare(
          "SELECT count(*) AS n FROM schedule_periods WHERE schedule_id=?",
        )
        .get(id),
    ).toEqual({ n: 0 });
    expect(
      (await call(`/api/calendar/day?campus_id=omiya&date=${future}`)).json.data
        ?.schedules,
    ).toHaveLength(0);
    const calendar = await call(
      `/api/calendar?campus_id=omiya&from=${future}&to=${future}`,
    );
    expect(calendar.status).toBe(200);
    expect(calendar.json.data).toMatchObject([{ schedule_count: 0 }]);
  });
  it("rejects deletion without DELETE_SELF or DELETE_OTHERS", async () => {
    await setup();
    const created = await call("/api/schedules", "POST", periodPayload([1]));
    const id = created.json.data!.id;
    sqlite
      .prepare(
        "DELETE FROM role_permissions WHERE role_id='test-role' AND permission_key='SCHEDULE_DELETE_SELF'",
      )
      .run();
    expect(
      (
        await call(`/api/schedules/${id}`, "DELETE", {
          occurrence_date: future,
        })
      ).status,
    ).toBe(403);
    const viewerToken = await issueSession(env.DB, "viewer", env);
    expect(
      (
        await call(
          `/api/schedules/${id}`,
          "DELETE",
          { occurrence_date: future },
          viewerToken,
        )
      ).status,
    ).toBe(403);
    expect(
      sqlite.prepare("SELECT count(*) AS n FROM schedules WHERE id=?").get(id),
    ).toEqual({ n: 1 });
  });
  it("deletes only one recurrence occurrence, then this and following", async () => {
    await setup();
    const weekday = new Date(`${future}T00:00:00Z`).getUTCDay();
    const created = await call("/api/schedules", "POST", {
      ...periodPayload([3]),
      recurrence: { weekdays: [weekday], end_date: addDays(future, 14) },
    });
    const id = created.json.data!.id;
    expect(
      (
        await call(`/api/schedules/${id}`, "DELETE", {
          occurrence_date: future,
          occurrence_scope: "this",
        })
      ).status,
    ).toBe(200);
    expect(
      (await call(`/api/calendar/day?campus_id=omiya&date=${future}`)).json.data
        ?.schedules,
    ).toHaveLength(0);
    expect(
      (
        await call(
          `/api/calendar/day?campus_id=omiya&date=${addDays(future, 7)}`,
        )
      ).json.data?.schedules,
    ).toHaveLength(1);
    expect(
      (
        await call(`/api/schedules/${id}`, "DELETE", {
          occurrence_date: addDays(future, 7),
          occurrence_scope: "following",
        })
      ).status,
    ).toBe(200);
    for (const date of [addDays(future, 7), addDays(future, 14)])
      expect(
        (await call(`/api/calendar/day?campus_id=omiya&date=${date}`)).json.data
          ?.schedules,
      ).toHaveLength(0);
  });
  it("still denies unauthorized edits/deletes of another user's invalid schedule", async () => {
    const { id } = await restrictedSchedule();
    const viewerToken = await issueSession(env.DB, "viewer", env);
    expect(
      (
        await call(
          `/api/schedules/${id}`,
          "PATCH",
          { occurrence_date: future, schedule: periodPayload([2]) },
          viewerToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          `/api/schedules/${id}`,
          "DELETE",
          { occurrence_date: future },
          viewerToken,
        )
      ).status,
    ).toBe(403);
  });
  it("still denies edits/deletes when an invalid schedule's date is past", async () => {
    const { id, restrictionId } = await restrictedSchedule();
    const past = addDays(todayTokyo(), -2),
      before = addDays(past, -1);
    sqlite
      .prepare("UPDATE schedules SET date=?,created_at=? WHERE id=?")
      .run(past, `${before}T00:00:00.000Z`, id);
    sqlite
      .prepare(
        "UPDATE restrictions SET start_date=?,end_date=?,created_at=? WHERE id=?",
      )
      .run(past, past, `${before}T00:00:00.000Z`, restrictionId);
    expect((await occurrences(env.DB, past, past, "owner"))[0].valid).toBe(
      false,
    );
    expect(
      (
        await call(`/api/schedules/${id}`, "PATCH", {
          occurrence_date: past,
          schedule: periodPayload([2]),
        })
      ).status,
    ).toBe(400);
    expect(
      (await call(`/api/schedules/${id}`, "DELETE", { occurrence_date: past }))
        .status,
    ).toBe(400);
  });
  it.each([
    {
      name: "same period",
      old: periodPayload([1]),
      next: periodPayload([1]),
      status: 409,
    },
    {
      name: "one of multiple new periods",
      old: periodPayload([1]),
      next: periodPayload([1, 3]),
      status: 409,
    },
    {
      name: "one of multiple existing periods",
      old: periodPayload([1, 3]),
      next: periodPayload([3]),
      status: 409,
    },
    {
      name: "disjoint period",
      old: periodPayload([1, 3]),
      next: periodPayload([2]),
      status: 201,
    },
    {
      name: "period against clock",
      old: periodPayload([1]),
      next: periodPayload([], "09:45", "10:15"),
      status: 409,
    },
    {
      name: "clock against clock",
      old: periodPayload([], "09:20", "10:00"),
      next: periodPayload([], "09:45", "10:15"),
      status: 409,
    },
    {
      name: "one clock interval among multiple periods",
      old: periodPayload([1]),
      next: periodPayload([3], "09:45", "10:15"),
      status: 409,
    },
    {
      name: "mixed existing periods and clock",
      old: periodPayload([3], "09:20", "10:00"),
      next: periodPayload([2], "09:45", "10:15"),
      status: 409,
    },
    {
      name: "unknown end provisional hour",
      old: periodPayload([], "09:30", null),
      next: periodPayload([1]),
      status: 409,
      provisional: true,
    },
  ])(
    "detects $name from any intersecting interval",
    async ({ old, next, status, provisional }) => {
      await setup();
      expect((await call("/api/schedules", "POST", old)).status).toBe(201);
      const result = await call("/api/schedules", "POST", next);
      expect(result.status).toBe(status);
      if (status === 409) {
        expect(result.json.error?.code).toBe("SCHEDULE_CONFLICT");
        if (provisional)
          expect(result.json.error?.details?.conflicts[0].provisional).toBe(
            true,
          );
        expect(
          sqlite.prepare("SELECT count(*) AS n FROM schedules").get(),
        ).toEqual({ n: 1 });
        expect(
          (
            await call("/api/schedules", "POST", {
              ...next,
              continue_conflict: true,
            })
          ).status,
        ).toBe(201);
      }
    },
  );
  it.each(
    [
      { existing: [1], next: [1], conflict: true },
      { existing: [1, 2], next: [1], conflict: true },
      { existing: [1, 4], next: [1], conflict: true },
      { existing: [1, 2], next: [2], conflict: true },
      { existing: [1, 2], next: [3], conflict: false },
      { existing: [1, 2], next: [1, 3], conflict: true },
      { existing: [1, 2], next: [3, 4], conflict: false },
      { existing: [1, 2, 3], next: [2, 4], conflict: true },
    ].flatMap((caseData) => [
      { ...caseData, reversed: false },
      { ...caseData, reversed: true },
    ]),
  )(
    "uses persisted periods and all normalized intervals for $existing vs $next (reversed=$reversed)",
    async ({ existing, next, conflict, reversed }) => {
      await setup();
      const oldOrder = reversed ? [...existing].reverse() : existing;
      const nextOrder = reversed ? [...next].reverse() : next;
      const created = await call(
        "/api/schedules",
        "POST",
        periodPayload(oldOrder),
      );
      expect(created.status).toBe(201);
      const id = created.json.data!.id;
      const stored = sqlite
        .prepare(
          "SELECT campus_id,period_number FROM schedule_periods WHERE schedule_id=? ORDER BY period_number",
        )
        .all(id);
      expect(stored).toEqual(
        [...existing]
          .sort((a, b) => a - b)
          .map((period_number) => ({
            campus_id: "omiya",
            period_number,
          })),
      );
      const [loaded] = await occurrences(env.DB, future, future, "owner");
      expect(loaded.periods).toEqual(stored);
      const master = await periodsFor(env.DB, "omiya", future);
      const expected = [...existing]
        .sort((a, b) => a - b)
        .map((number) => {
          const period = master.find((row) => row.period_number === number)!;
          const minute = (time: string) =>
            Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
          return {
            start: minute(period.start_time),
            end: minute(period.end_time),
            provisional: false,
          };
        });
      expect(await intervals(env.DB, loaded)).toEqual(expected);
      const result = await call(
        "/api/schedules",
        "POST",
        periodPayload(nextOrder),
      );
      expect(result.status).toBe(conflict ? 409 : 201);
      if (conflict) expect(result.json.error?.code).toBe("SCHEDULE_CONFLICT");
      expect(
        sqlite.prepare("SELECT count(*) AS n FROM schedules").get(),
      ).toEqual({
        n: conflict ? 1 : 2,
      });
    },
  );
  it("migrates both legacy memo visibility types without losing text", () => {
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec(
      readFileSync(
        new URL("../migrations/0001_phase1.sql", import.meta.url),
        "utf8",
      ),
    );
    sqlite.exec(
      readFileSync(
        new URL("../migrations/0002_phase2.sql", import.meta.url),
        "utf8",
      ),
    );
    sqlite
      .prepare(
        "INSERT INTO users (id,display_name,password_hash,grade,registration_year,primary_campus_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run("legacy", "Legacy", "test-only", 1, 2026, "omiya", "now", "now");
    for (const [id, memo, visibility] of [
      ["private", "old private", "private"],
      ["shared", "old shared", "everyone"],
    ])
      sqlite
        .prepare(
          "INSERT INTO schedules (id,user_id,date,scope,memo,memo_visibility,kind,created_at,updated_at) VALUES (?,?,?,?,?,?,'single',?,?)",
        )
        .run(id, "legacy", future, "omiya", memo, visibility, "now", "now");
    sqlite.exec(
      readFileSync(
        new URL("../migrations/0004_schedule_memos.sql", import.meta.url),
        "utf8",
      ),
    );
    expect(
      sqlite
        .prepare(
          "SELECT private_memo,shared_memo FROM schedules WHERE id='private'",
        )
        .get(),
    ).toEqual({ private_memo: "old private", shared_memo: null });
    expect(
      sqlite
        .prepare(
          "SELECT private_memo,shared_memo FROM schedules WHERE id='shared'",
        )
        .get(),
    ).toEqual({ private_memo: null, shared_memo: "old shared" });
    expect(
      sqlite
        .prepare("SELECT count(*) AS n FROM schedules WHERE memo IS NOT NULL")
        .get(),
    ).toEqual({ n: 0 });
  });
  it("marks a restricted calendar day even when nobody has a schedule", async () => {
    await setup();
    expect(
      (
        await call("/api/restrictions", "POST", {
          campus_id: "omiya",
          start_date: future,
          end_date: future,
          reason: "利用停止",
          location_ids: [],
          period_numbers: [],
          clock_start: null,
          clock_end: null,
          confirm_impact: true,
        })
      ).status,
    ).toBe(201);
    expect(
      (await calendarOverview(env.DB, "omiya", future, future, "owner"))[0],
    ).toMatchObject({
      has_restriction: true,
      has_invalid_schedule: false,
      schedule_count: 0,
    });
  });
  it("defaults each user's week start to Sunday and persists a validated per-user choice", async () => {
    await setup();
    const endpoint = "/api/me/display-preferences";
    expect((await call(endpoint)).json.data).toEqual({ week_start: "sunday" });
    expect(
      (await call(endpoint, "PATCH", { week_start: "tuesday" })).status,
    ).toBe(400);
    expect(
      (
        await call(
          endpoint,
          "PATCH",
          { week_start: "monday" },
          token,
          "https://other.test",
        )
      ).status,
    ).toBe(403);
    expect(
      (await call(endpoint, "PATCH", { week_start: "monday" })).status,
    ).toBe(200);
    expect((await call(endpoint)).json.data).toEqual({ week_start: "monday" });
    expect(
      sqlite
        .prepare(
          "SELECT week_start FROM user_display_preferences WHERE user_id = 'viewer'",
        )
        .get(),
    ).toBeUndefined();
  });
  it("migrates masters and classifies calendar with precedence, JST and academic year", async () => {
    await setup();
    expect(
      sqlite.prepare("SELECT count(*) AS n FROM class_periods").get(),
    ).toEqual({ n: 11 });
    expect(academicYear("2027-03-31")).toBe(2026);
    expect(academicYear("2027-04-01")).toBe(2027);
    expect(todayTokyo(new Date("2026-01-01T14:59:00Z"))).toBe("2026-01-01");
    expect(todayTokyo(new Date("2026-01-01T15:00:00Z"))).toBe("2026-01-02");
    const now = new Date().toISOString();
    sqlite
      .prepare("INSERT INTO japanese_holidays VALUES (?,?,?,?)")
      .run(future, "試験祝日", "official", now);
    sqlite
      .prepare("INSERT INTO holiday_import_years VALUES (?,?,?,?)")
      .run(Number(future.slice(0, 4)), now, "official", 1);
    sqlite
      .prepare("INSERT INTO university_closure_periods VALUES (?,?,?,?,?,?,?)")
      .run("c1", "omiya", future, future, "休業", now, now);
    sqlite
      .prepare(
        "INSERT INTO university_calendar_overrides VALUES (?,?,?,?,?,?,?)",
      )
      .run("v1", "omiya", future, "teaching", "特別授業", now, now);
    expect(
      (await calendarDays(env.DB, "omiya", future, future))[0],
    ).toMatchObject({ kind: "teaching", source: "override" });
    sqlite.prepare("DELETE FROM university_calendar_overrides").run();
    expect(
      (await calendarDays(env.DB, "omiya", future, future))[0],
    ).toMatchObject({ kind: "no_school", source: "closure" });
    sqlite.prepare("DELETE FROM university_closure_periods").run();
    expect(
      (await calendarDays(env.DB, "omiya", future, future))[0],
    ).toMatchObject({ kind: "holiday", source: "national_holiday" });
    sqlite.prepare("DELETE FROM holiday_import_years").run();
    sqlite.prepare("DELETE FROM japanese_holidays").run();
    expect(
      (await calendarDays(env.DB, "omiya", future, future))[0],
    ).toMatchObject({
      source: "holiday_data_missing",
      entry_default: "clock",
    });
  });

  it("enforces auth, Terms, permissions, and origin on Phase 2 API", async () => {
    await setup([]);
    expect(
      (await call(`/api/calendar?campus_id=omiya&from=${future}&to=${future}`))
        .status,
    ).toBe(403);
    expect((await call("/api/schedules", "POST", payload())).status).toBe(403);
    expect(
      (
        await call(
          "/api/locations",
          "POST",
          { campus_id: "omiya", name: "X" },
          token,
          "https://other.test",
        )
      ).status,
    ).toBe(403);
    const noSession = await handleApi(
      new Request(
        `${origin}/api/calendar?campus_id=omiya&from=${future}&to=${future}`,
      ),
      env,
    );
    expect(noSession.status).toBe(401);
    sqlite
      .prepare(
        "UPDATE users SET terms_version_accepted=NULL,terms_accepted_at=NULL WHERE id='owner'",
      )
      .run();
    expect(
      (await call(`/api/calendar?campus_id=omiya&from=${future}&to=${future}`))
        .json.error?.code,
    ).toBe("TERMS_REQUIRED");
  });

  it("saves cross-campus common locations and periods with a global clock, and redacts private memo", async () => {
    await setup();
    const created = await call("/api/schedules", "POST", payload());
    expect(created.status).toBe(201);
    const id = created.json.data!.id;
    expect(
      sqlite
        .prepare("SELECT clock_start,clock_end FROM schedules WHERE id=?")
        .get(id),
    ).toEqual({ clock_start: "14:00", clock_end: "17:00" });
    expect(
      sqlite
        .prepare(
          "SELECT private_memo,shared_memo,memo FROM schedules WHERE id=?",
        )
        .get(id),
    ).toEqual({
      private_memo: "owner only",
      shared_memo: "shared note",
      memo: null,
    });
    expect(
      sqlite
        .prepare(
          "SELECT count(*) AS n FROM schedule_locations WHERE schedule_id=?",
        )
        .get(id),
    ).toEqual({ n: 2 });
    expect(
      sqlite
        .prepare(
          "SELECT count(*) AS n FROM schedule_periods WHERE schedule_id=?",
        )
        .get(id),
    ).toEqual({ n: 2 });
    const ownerView = (
      await call(`/api/calendar/day?campus_id=omiya&date=${future}`)
    ).json.data!.schedules[0];
    expect(ownerView.private_memo).toBe("owner only");
    expect(ownerView.shared_memo).toBe("shared note");
    const viewerRows = await occurrences(env.DB, future, future, "viewer");
    expect(viewerRows[0]).not.toHaveProperty("private_memo");
    expect(viewerRows[0].shared_memo).toBe("shared note");
    sqlite
      .prepare(
        "INSERT INTO roles VALUES ('viewer-role','Viewer role','now','now')",
      )
      .run();
    sqlite
      .prepare(
        "INSERT INTO role_permissions VALUES ('viewer-role','SCHEDULE_VIEW')",
      )
      .run();
    sqlite
      .prepare("INSERT INTO user_roles VALUES ('viewer','viewer-role')")
      .run();
    const viewerToken = await issueSession(env.DB, "viewer", env);
    const viewerResponse = await call(
      `/api/calendar/day?campus_id=omiya&date=${future}`,
      "GET",
      undefined,
      viewerToken,
    );
    expect(viewerResponse.json.data!.schedules[0].shared_memo).toBe(
      "shared note",
    );
    expect(viewerResponse.json.data!.schedules[0]).not.toHaveProperty(
      "private_memo",
    );
    expect(viewerResponse.json.data!.schedules[0]).not.toHaveProperty("memo");
    expect(viewerResponse.json.data!.schedules[0]).not.toHaveProperty(
      "memo_visibility",
    );
    expect(JSON.stringify(viewerResponse.json)).not.toContain("owner only");
    expect(
      (await call(`/api/calendar/day?campus_id=hirakata&date=${future}`)).json
        .data!.schedules,
    ).toHaveLength(1);
  });

  it("rejects invalid locations, periods, inactive selection and overnight time", async () => {
    await setup();
    expect(
      (await call("/api/schedules", "POST", { ...payload(), scope: "omiya" }))
        .status,
    ).toBe(400);
    expect(
      (
        await call("/api/schedules", "POST", {
          ...payload(),
          periods: [{ campus_id: "hirakata", period_number: 6 }],
        })
      ).status,
    ).toBe(400);
    sqlite.prepare("UPDATE locations SET active=0 WHERE id='h-range'").run();
    expect((await call("/api/schedules", "POST", payload())).status).toBe(400);
    expect(
      (
        await call("/api/schedules", "POST", {
          ...payload(),
          location_ids: ["o-room"],
          clock_start: "23:00",
          clock_end: "01:00",
        })
      ).status,
    ).toBe(400);
  });

  it("requires explicit conflict continuation and marks unknown-end conflicts provisional", async () => {
    await setup();
    const first = {
      ...payload(),
      location_ids: ["o-room"],
      periods: [],
      clock_start: "14:00",
      clock_end: null,
    };
    expect((await call("/api/schedules", "POST", first)).status).toBe(201);
    const conflict = await call("/api/schedules", "POST", {
      ...first,
      clock_start: "14:30",
      clock_end: "15:30",
    });
    expect(conflict.status).toBe(409);
    expect(conflict.json.error?.code).toBe("SCHEDULE_CONFLICT");
    expect(conflict.json.error?.details?.conflicts[0].provisional).toBe(true);
    expect(
      (
        await call("/api/schedules", "POST", {
          ...first,
          clock_start: "14:30",
          clock_end: "15:30",
          continue_conflict: true,
        })
      ).status,
    ).toBe(201);
    expect(sqlite.prepare("SELECT count(*) AS n FROM schedules").get()).toEqual(
      { n: 2 },
    );
    expect(
      mergeIntervals([
        { start: 840, end: 900, provisional: false },
        { start: 870, end: 930, provisional: true },
      ]),
    ).toEqual([{ start: 840, end: 930, provisional: true }]);
    expect(
      overlaps(
        [{ start: 840, end: 900, provisional: false }],
        [{ start: 900, end: 960, provisional: false }],
      ),
    ).toBe(false);
  });

  it("supports this-day exceptions, moved occurrences and following split with transferred exceptions", async () => {
    await setup();
    const weekday = new Date(`${future}T00:00:00Z`).getUTCDay();
    const basic = {
      ...payload(),
      location_ids: ["o-room"],
      periods: [],
      recurrence: { weekdays: [weekday], end_date: addDays(future, 28) },
    };
    const created = await call("/api/schedules", "POST", basic);
    expect(created.status).toBe(201);
    const id = created.json.data!.id;
    const moved = addDays(after, 1);
    expect(
      (
        await call(`/api/schedules/${id}`, "PATCH", {
          occurrence_date: after,
          occurrence_scope: "this",
          schedule: { ...basic, recurrence: null, date: moved },
        })
      ).status,
    ).toBe(200);
    expect(await occurrences(env.DB, after, after, "owner")).toHaveLength(0);
    expect((await occurrences(env.DB, moved, moved, "owner"))[0]).toMatchObject(
      { date: moved, original_date: after },
    );
    expect(
      (await call(`/api/calendar/day?campus_id=omiya&date=${after}`)).json.data
        ?.schedules,
    ).toHaveLength(0);
    expect(
      (await call(`/api/calendar/day?campus_id=omiya&date=${moved}`)).json.data
        ?.schedules[0],
    ).toMatchObject({ date: moved, original_date: after });
    const later = addDays(after, 7);
    expect(
      (
        await call(`/api/schedules/${id}`, "PATCH", {
          occurrence_date: later,
          occurrence_scope: "this",
          schedule: {
            ...basic,
            recurrence: null,
            date: later,
            clock_start: "18:00",
            clock_end: "20:00",
          },
        })
      ).status,
    ).toBe(200);
    const split = await call(`/api/schedules/${id}`, "PATCH", {
      occurrence_date: future,
      occurrence_scope: "following",
      schedule: {
        ...basic,
        recurrence: null,
        date: future,
        clock_start: "15:00",
        clock_end: "18:00",
        continue_conflict: true,
      },
    });
    expect(split.status).toBe(200);
    expect(
      sqlite.prepare("SELECT count(*) AS n FROM recurrence_series").get(),
    ).toEqual({ n: 2 });
    expect(
      (await occurrences(env.DB, moved, moved, "owner"))[0].original_date,
    ).toBe(after);
    const transferred = sqlite
      .prepare(
        "SELECT series_id FROM recurrence_exceptions WHERE occurrence_date=?",
      )
      .get(after) as { series_id: string };
    expect((await occurrences(env.DB, moved, moved, "owner"))[0]).toMatchObject(
      { original_date: after, series_id: transferred.series_id },
    );
    expect((await occurrences(env.DB, later, later, "owner"))[0]).toMatchObject(
      { date: later, original_date: later, series_id: transferred.series_id },
    );
    expect(
      (await call(`/api/calendar/day?campus_id=omiya&date=${later}`)).json.data
        ?.schedules[0],
    ).toMatchObject({ date: later, original_date: later });
    const oldMovedId = (await occurrences(env.DB, moved, moved, "owner"))[0].id;
    const newTemplateId = (
      sqlite
        .prepare("SELECT id FROM schedules WHERE kind='template' AND id<>?")
        .get(id) as { id: string }
    ).id;
    expect(
      (
        await call(`/api/schedules/${newTemplateId}`, "PATCH", {
          occurrence_date: after,
          occurrence_scope: "this",
          schedule: {
            ...basic,
            recurrence: null,
            date: moved,
            clock_start: "16:00",
            clock_end: "17:00",
          },
        })
      ).status,
    ).toBe(200);
    expect(
      sqlite.prepare("SELECT id FROM schedules WHERE id=?").get(oldMovedId),
    ).toBeUndefined();
    expect((await occurrences(env.DB, moved, moved, "owner"))[0]).toMatchObject(
      { date: moved, original_date: after, series_id: transferred.series_id },
    );
  });

  it("rejects deleting a moved occurrence whose replacement date is past even when the original date is future", async () => {
    const { id, original, moved, replacement } = await movedOccurrence(-6);
    vi.useFakeTimers();
    vi.setSystemTime(
      new Date(Date.parse(dayStartTokyo(addDays(moved, 1))) + 60_000),
    );
    const edit = await call(`/api/schedules/${id}`, "PATCH", {
      occurrence_date: original,
      occurrence_scope: "this",
      schedule: { ...replacement, date: original },
    });
    expect(edit.status).toBe(400);
    const deletion = await call(`/api/schedules/${id}`, "DELETE", {
      occurrence_date: original,
      occurrence_scope: "this",
    });
    expect(deletion.status).toBe(400);
    expect((await occurrences(env.DB, moved, moved, "owner"))[0]).toMatchObject(
      {
        date: moved,
        original_date: original,
      },
    );
  });

  it("permits future moved replacement edits and deletion, including at JST midnight", async () => {
    const { id, original, moved, replacement } = await movedOccurrence(-6);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.parse(dayStartTokyo(moved))));
    expect(todayTokyo()).toBe(moved);
    expect(
      (
        await call(`/api/schedules/${id}`, "PATCH", {
          occurrence_date: original,
          occurrence_scope: "this",
          schedule: {
            ...replacement,
            periods: [{ campus_id: "omiya", period_number: 2 }],
          },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(`/api/schedules/${id}`, "DELETE", {
          occurrence_date: original,
          occurrence_scope: "this",
        })
      ).status,
    ).toBe(200);
    expect(await occurrences(env.DB, moved, moved, "owner")).toHaveLength(0);
  });

  it("rejects operations on an original past occurrence even if its replacement is future", async () => {
    const { id, original, moved, replacement } = await movedOccurrence(6);
    const replacementId = (await occurrences(env.DB, moved, moved, "owner"))[0]
      .id;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.parse(dayStartTokyo(addDays(original, 1)))));
    expect(todayTokyo()).toBe(addDays(original, 1));
    expect(
      (
        await call(`/api/schedules/${id}`, "PATCH", {
          occurrence_date: original,
          occurrence_scope: "this",
          schedule: replacement,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(`/api/schedules/${id}`, "DELETE", {
          occurrence_date: original,
          occurrence_scope: "this",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(`/api/schedules/${replacementId}`, "DELETE", {
          occurrence_date: moved,
        })
      ).status,
    ).toBe(400);
  });

  it("keeps past single and unmoved recurring occurrences immutable", async () => {
    await setup();
    const single = await call("/api/schedules", "POST", periodPayload([1]));
    expect(single.status).toBe(201);
    const weekday = new Date(`${future}T00:00:00Z`).getUTCDay();
    const series = await call("/api/schedules", "POST", {
      ...periodPayload([2]),
      recurrence: { weekdays: [weekday], end_date: addDays(future, 14) },
    });
    expect(series.status).toBe(201);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.parse(dayStartTokyo(addDays(future, 1)))));
    expect(
      (
        await call(`/api/schedules/${single.json.data!.id}`, "DELETE", {
          occurrence_date: future,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(`/api/schedules/${series.json.data!.id}`, "DELETE", {
          occurrence_date: future,
          occurrence_scope: "this",
        })
      ).status,
    ).toBe(400);
  });

  it("removes the previous replacement and its dependent data when the same occurrence is edited twice", async () => {
    await setup();
    const weekday = new Date(`${future}T00:00:00Z`).getUTCDay();
    const series = {
      ...periodPayload([1]),
      recurrence: { weekdays: [weekday], end_date: addDays(future, 28) },
    };
    const created = await call("/api/schedules", "POST", series);
    expect(created.status).toBe(201);
    const templateId = created.json.data!.id;
    const edit = (date: string, period: number, label: string) =>
      call(`/api/schedules/${templateId}`, "PATCH", {
        occurrence_date: date,
        occurrence_scope: "this",
        schedule: {
          ...periodPayload([period]),
          date,
          private_memo: `${label} private`,
          shared_memo: `${label} shared`,
        },
      });

    const otherDate = addDays(after, 7);
    expect((await edit(otherDate, 4, "other")).status).toBe(200);
    const otherId = (
      sqlite
        .prepare(
          "SELECT replacement_schedule_id FROM recurrence_exceptions WHERE occurrence_date=?",
        )
        .get(otherDate) as { replacement_schedule_id: string }
    ).replacement_schedule_id;

    expect((await edit(after, 2, "old")).status).toBe(200);
    const oldId = (
      sqlite
        .prepare(
          "SELECT replacement_schedule_id FROM recurrence_exceptions WHERE occurrence_date=?",
        )
        .get(after) as { replacement_schedule_id: string }
    ).replacement_schedule_id;
    expect((await edit(after, 3, "new")).status).toBe(200);
    const newId = (
      sqlite
        .prepare(
          "SELECT replacement_schedule_id FROM recurrence_exceptions WHERE occurrence_date=?",
        )
        .get(after) as { replacement_schedule_id: string }
    ).replacement_schedule_id;
    expect(newId).not.toBe(oldId);
    expect(
      sqlite.prepare("SELECT id FROM schedules WHERE id=?").get(oldId),
    ).toBeUndefined();
    expect(
      sqlite
        .prepare(
          "SELECT count(*) AS n FROM schedule_periods WHERE schedule_id=?",
        )
        .get(oldId),
    ).toEqual({ n: 0 });
    expect(
      sqlite
        .prepare(
          "SELECT count(*) AS n FROM schedule_locations WHERE schedule_id=?",
        )
        .get(oldId),
    ).toEqual({ n: 0 });
    expect(
      sqlite
        .prepare("SELECT private_memo,shared_memo FROM schedules WHERE id=?")
        .get(newId),
    ).toEqual({ private_memo: "new private", shared_memo: "new shared" });
    expect(
      sqlite.prepare("SELECT id FROM schedules WHERE id=?").get(otherId),
    ).toEqual({ id: otherId });
    expect(
      (await occurrences(env.DB, otherDate, otherDate, "owner"))[0].id,
    ).toBe(otherId);
  });

  it("removes the replacement and its dependent data when an edited occurrence is cancelled", async () => {
    await setup();
    const weekday = new Date(`${future}T00:00:00Z`).getUTCDay();
    const series = {
      ...periodPayload([1]),
      recurrence: { weekdays: [weekday], end_date: addDays(future, 28) },
    };
    const created = await call("/api/schedules", "POST", series);
    expect(created.status).toBe(201);
    const templateId = created.json.data!.id;
    expect(
      (
        await call(`/api/schedules/${templateId}`, "PATCH", {
          occurrence_date: after,
          occurrence_scope: "this",
          schedule: {
            ...periodPayload([2]),
            date: after,
            private_memo: "cancelled private",
            shared_memo: "cancelled shared",
          },
        })
      ).status,
    ).toBe(200);
    const replacementId = (
      sqlite
        .prepare(
          "SELECT replacement_schedule_id FROM recurrence_exceptions WHERE occurrence_date=?",
        )
        .get(after) as { replacement_schedule_id: string }
    ).replacement_schedule_id;
    expect(
      (
        await call(`/api/schedules/${templateId}`, "DELETE", {
          occurrence_date: after,
          occurrence_scope: "this",
        })
      ).status,
    ).toBe(200);
    expect(
      sqlite
        .prepare(
          "SELECT action,replacement_schedule_id FROM recurrence_exceptions WHERE occurrence_date=?",
        )
        .get(after),
    ).toEqual({ action: "cancel", replacement_schedule_id: null });
    expect(
      sqlite.prepare("SELECT id FROM schedules WHERE id=?").get(replacementId),
    ).toBeUndefined();
    expect(
      sqlite
        .prepare(
          "SELECT count(*) AS n FROM schedule_periods WHERE schedule_id=?",
        )
        .get(replacementId),
    ).toEqual({ n: 0 });
    expect(
      sqlite
        .prepare(
          "SELECT count(*) AS n FROM schedule_locations WHERE schedule_id=?",
        )
        .get(replacementId),
    ).toEqual({ n: 0 });
    expect(await occurrences(env.DB, after, after, "owner")).toHaveLength(0);
  });

  it("rolls back the exception and replacement changes when old replacement cleanup fails", async () => {
    await setup();
    const weekday = new Date(`${future}T00:00:00Z`).getUTCDay();
    const series = {
      ...periodPayload([1]),
      recurrence: { weekdays: [weekday], end_date: addDays(future, 28) },
    };
    const created = await call("/api/schedules", "POST", series);
    expect(created.status).toBe(201);
    const templateId = created.json.data!.id;
    const edit = (label: string) =>
      call(`/api/schedules/${templateId}`, "PATCH", {
        occurrence_date: after,
        occurrence_scope: "this",
        schedule: {
          ...periodPayload([2]),
          date: after,
          private_memo: `${label} private`,
          shared_memo: `${label} shared`,
        },
      });
    expect((await edit("old")).status).toBe(200);
    const oldId = (
      sqlite
        .prepare(
          "SELECT replacement_schedule_id FROM recurrence_exceptions WHERE occurrence_date=?",
        )
        .get(after) as { replacement_schedule_id: string }
    ).replacement_schedule_id;
    sqlite.exec(`CREATE TEMP TRIGGER block_replacement_cleanup
      BEFORE DELETE ON schedules WHEN OLD.id='${oldId}'
      BEGIN SELECT RAISE(ABORT, 'blocked cleanup'); END`);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await edit("new")).status).toBe(500);
      expect(
        sqlite
          .prepare(
            "SELECT replacement_schedule_id FROM recurrence_exceptions WHERE occurrence_date=?",
          )
          .get(after),
      ).toEqual({ replacement_schedule_id: oldId });
      expect(
        sqlite
          .prepare("SELECT count(*) AS n FROM schedules WHERE kind='exception'")
          .get(),
      ).toEqual({ n: 1 });
      expect(
        sqlite
          .prepare("SELECT private_memo,shared_memo FROM schedules WHERE id=?")
          .get(oldId),
      ).toEqual({ private_memo: "old private", shared_memo: "old shared" });

      expect(
        (
          await call(`/api/schedules/${templateId}`, "DELETE", {
            occurrence_date: after,
            occurrence_scope: "this",
          })
        ).status,
      ).toBe(500);
      expect(
        sqlite
          .prepare(
            "SELECT action,replacement_schedule_id FROM recurrence_exceptions WHERE occurrence_date=?",
          )
          .get(after),
      ).toEqual({ action: "replace", replacement_schedule_id: oldId });
      expect(
        sqlite.prepare("SELECT id FROM schedules WHERE id=?").get(oldId),
      ).toEqual({ id: oldId });
    } finally {
      errorLog.mockRestore();
      sqlite.exec("DROP TRIGGER block_replacement_cleanup");
    }
  });

  it("invalidates existing schedules and revives only for a pre-midnight removal", async () => {
    const date = "2026-10-21";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T11:00:00.000Z"));
    await setup();
    const created = await call("/api/schedules", "POST", {
      ...payload(date),
      location_ids: ["o-room"],
      periods: [],
    });
    expect(created.status).toBe(201);
    vi.setSystemTime(new Date("2026-10-20T13:00:00.000Z"));
    const restriction = await call("/api/restrictions", "POST", {
      campus_id: "omiya",
      start_date: date,
      end_date: date,
      reason: "施設閉鎖",
      location_ids: ["o-room"],
      period_numbers: [],
      clock_start: null,
      clock_end: null,
      confirm_impact: true,
    });
    expect(restriction.status).toBe(201);
    const id = restriction.json.data!.id;
    expect((await occurrences(env.DB, date, date, "owner"))[0]).toMatchObject({
      valid: false,
      invalid_reasons: ["施設閉鎖"],
    });
    vi.setSystemTime(new Date("2026-10-20T14:00:00.000Z"));
    expect((await call(`/api/restrictions/${id}`, "DELETE", {})).status).toBe(
      200,
    );
    expect((await occurrences(env.DB, date, date, "owner"))[0].valid).toBe(
      true,
    );
    const revived = await call(
      `/api/calendar/day?campus_id=omiya&date=${date}`,
    );
    expect(revived.json.data?.schedules[0].valid).toBe(true);
    expect(revived.json.data?.restrictions).toHaveLength(0);
    expect(
      (await call(`/api/calendar?campus_id=omiya&from=${date}&to=${date}`)).json
        .data,
    ).toMatchObject([{ has_restriction: false, has_invalid_schedule: false }]);
    sqlite
      .prepare("UPDATE restrictions SET removed_at=? WHERE id=?")
      .run("2026-10-20T15:00:00.001Z", id);
    expect((await occurrences(env.DB, date, date, "owner"))[0].valid).toBe(
      false,
    );
  });
  it("immediately revives a future schedule when release and read share the same millisecond", async () => {
    const date = "2026-10-21";
    const createdAt = "2026-10-20T11:00:00.000Z";
    const restrictedAt = "2026-10-20T13:00:00.000Z";
    const releasedAt = "2026-10-20T14:00:00.000Z";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(createdAt));
    await setup();
    expect(
      (await call("/api/schedules", "POST", { ...periodPayload([1]), date }))
        .status,
    ).toBe(201);
    vi.setSystemTime(new Date(restrictedAt));
    const restriction = await call("/api/restrictions", "POST", {
      campus_id: "omiya",
      start_date: date,
      end_date: date,
      reason: "同時刻の解除",
      location_ids: ["o-room"],
      period_numbers: [1],
      clock_start: null,
      clock_end: null,
      confirm_impact: true,
    });
    expect(restriction.status).toBe(201);
    const id = restriction.json.data!.id;
    expect(
      sqlite.prepare("SELECT created_at FROM restrictions WHERE id=?").get(id),
    ).toEqual({ created_at: restrictedAt });
    expect((await occurrences(env.DB, date, date, "owner"))[0].valid).toBe(
      false,
    );
    vi.setSystemTime(new Date(releasedAt));
    expect((await call(`/api/restrictions/${id}`, "DELETE", {})).status).toBe(
      200,
    );
    expect(
      sqlite.prepare("SELECT removed_at FROM restrictions WHERE id=?").get(id),
    ).toEqual({ removed_at: releasedAt });
    expect(todayTokyo()).toBe("2026-10-20");
    expect(dayStartTokyo(date)).toBe("2026-10-20T15:00:00.000Z");
    expect(new Date(releasedAt).getTime()).toBe(Date.parse(releasedAt));
    expect((await occurrences(env.DB, date, date, "owner"))[0].valid).toBe(
      true,
    );
    expect(restrictionCutoff(date)).toBe(dayStartTokyo(date));
    const day = await call(`/api/calendar/day?campus_id=omiya&date=${date}`);
    expect(day.json.data?.schedules[0].valid).toBe(true);
    expect(day.json.data?.restrictions).toHaveLength(0);
    expect(
      (await call(`/api/calendar?campus_id=omiya&from=${date}&to=${date}`)).json
        .data,
    ).toMatchObject([{ has_restriction: false, has_invalid_schedule: false }]);
    for (let repeat = 0; repeat < 3; repeat++) {
      expect((await occurrences(env.DB, date, date, "owner"))[0].valid).toBe(
        true,
      );
      expect(
        (await call(`/api/calendar/day?campus_id=omiya&date=${date}`)).json.data
          ?.restrictions,
      ).toHaveLength(0);
    }
  });
  it.each([
    {
      name: "one millisecond before JST day start",
      releasedAt: "2026-10-20T14:59:59.999Z",
      valid: true,
    },
    {
      name: "exactly at JST day start",
      releasedAt: "2026-10-20T15:00:00.000Z",
      valid: true,
    },
    {
      name: "one millisecond after JST day start",
      releasedAt: "2026-10-20T15:00:00.001Z",
      valid: false,
    },
    { name: "without release", releasedAt: null, valid: false },
  ])(
    "uses the fixed restriction boundary: $name",
    async ({ releasedAt, valid }) => {
      const date = "2026-10-21";
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-20T11:00:00.000Z"));
      await setup();
      expect(
        (await call("/api/schedules", "POST", { ...periodPayload([1]), date }))
          .status,
      ).toBe(201);
      vi.setSystemTime(new Date("2026-10-20T13:00:00.000Z"));
      const restriction = await call("/api/restrictions", "POST", {
        campus_id: "omiya",
        start_date: date,
        end_date: date,
        reason: "境界制限",
        location_ids: ["o-room"],
        period_numbers: [1],
        clock_start: null,
        clock_end: null,
        confirm_impact: true,
      });
      expect(restriction.status).toBe(201);
      const id = restriction.json.data!.id;
      if (releasedAt) {
        vi.setSystemTime(new Date(releasedAt));
        expect(
          (await call(`/api/restrictions/${id}`, "DELETE", {})).status,
        ).toBe(200);
        expect(
          sqlite
            .prepare("SELECT removed_at FROM restrictions WHERE id=?")
            .get(id),
        ).toEqual({ removed_at: releasedAt });
      } else vi.setSystemTime(new Date("2026-10-20T14:00:00.000Z"));
      expect(restrictionCutoff(date)).toBe("2026-10-20T15:00:00.000Z");
      expect((await occurrences(env.DB, date, date, "owner"))[0].valid).toBe(
        valid,
      );
      const day = await call(`/api/calendar/day?campus_id=omiya&date=${date}`);
      expect(day.json.data?.schedules[0].valid).toBe(valid);
      expect(day.json.data?.restrictions).toHaveLength(valid ? 0 : 1);
      expect(
        (await call(`/api/calendar?campus_id=omiya&from=${date}&to=${date}`))
          .json.data,
      ).toMatchObject([
        { has_restriction: !valid, has_invalid_schedule: !valid },
      ]);
    },
  );
  it("keeps invalid until every applicable future restriction is released", async () => {
    const date = "2026-10-21";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T11:00:00.000Z"));
    await setup();
    expect(
      (await call("/api/schedules", "POST", { ...periodPayload([1]), date }))
        .status,
    ).toBe(201);
    const ids: string[] = [];
    for (const [index, reason] of ["制限A", "制限B"].entries()) {
      vi.setSystemTime(new Date(`2026-10-20T13:00:00.00${index}Z`));
      const result = await call("/api/restrictions", "POST", {
        campus_id: "omiya",
        start_date: date,
        end_date: date,
        reason,
        location_ids: ["o-room"],
        period_numbers: [1],
        clock_start: null,
        clock_end: null,
        confirm_impact: true,
      });
      expect(result.status).toBe(201);
      ids.push(result.json.data!.id);
    }
    const day = () => call(`/api/calendar/day?campus_id=omiya&date=${date}`);
    expect((await day()).json.data?.schedules[0]).toMatchObject({
      valid: false,
      invalid_reasons: ["制限A", "制限B"],
    });
    vi.setSystemTime(new Date("2026-10-20T14:00:00.000Z"));
    expect(
      (await call(`/api/restrictions/${ids[0]}`, "DELETE", {})).status,
    ).toBe(200);
    expect((await day()).json.data?.schedules[0]).toMatchObject({
      valid: false,
      invalid_reasons: ["制限B"],
    });
    expect((await day()).json.data?.restrictions).toHaveLength(1);
    expect(
      (await call(`/api/restrictions/${ids[1]}`, "DELETE", {})).status,
    ).toBe(200);
    expect((await day()).json.data?.schedules[0]).toMatchObject({
      valid: true,
      invalid_reasons: [],
    });
    expect((await day()).json.data?.restrictions).toHaveLength(0);
  });
  it("keeps the same-day schedule invalid when release occurs after JST midnight", async () => {
    const { restrictionId } = await restrictedSchedule();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.parse(dayStartTokyo(future)) + 60_000));
    expect(
      (await call(`/api/restrictions/${restrictionId}`, "DELETE", {})).status,
    ).toBe(200);
    const day = await call(`/api/calendar/day?campus_id=omiya&date=${future}`);
    expect(day.json.data?.schedules[0].valid).toBe(false);
    expect(day.json.data?.restrictions).toHaveLength(1);
  });

  it("cancels this and following occurrences including prior replacements", async () => {
    await setup();
    const weekday = new Date(`${future}T00:00:00Z`).getUTCDay();
    const basic = {
      ...payload(),
      location_ids: ["o-room"],
      periods: [],
      recurrence: { weekdays: [weekday], end_date: addDays(future, 28) },
    };
    const created = await call("/api/schedules", "POST", basic);
    const id = created.json.data!.id;
    expect(
      (
        await call(`/api/schedules/${id}`, "PATCH", {
          occurrence_date: after,
          occurrence_scope: "this",
          schedule: {
            ...basic,
            recurrence: null,
            date: after,
            clock_start: "18:00",
            clock_end: "20:00",
          },
        })
      ).status,
    ).toBe(200);
    expect(await occurrences(env.DB, after, after, "owner")).toHaveLength(1);
    expect(
      (
        await call(`/api/schedules/${id}`, "DELETE", {
          occurrence_date: future,
          occurrence_scope: "following",
        })
      ).status,
    ).toBe(200);
    expect(await occurrences(env.DB, after, after, "owner")).toHaveLength(0);
  });

  it("rejects past schedule changes, past restrictions, and unconfirmed restriction impact", async () => {
    await setup();
    const past = addDays(todayTokyo(), -1);
    expect(
      (
        await call("/api/schedules", "POST", {
          ...payload(past),
          location_ids: ["o-room"],
          periods: [],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("/api/restrictions", "POST", {
          campus_id: "omiya",
          start_date: future,
          end_date: future,
          reason: "制限",
          location_ids: [],
          period_numbers: [],
          clock_start: null,
          clock_end: null,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("/api/restrictions", "POST", {
          campus_id: "omiya",
          start_date: past,
          end_date: future,
          reason: "制限",
          location_ids: [],
          period_numbers: [],
          clock_start: null,
          clock_end: null,
          confirm_impact: true,
        })
      ).status,
    ).toBe(400);
  });

  it("matches time-limited restrictions against the relevant campus periods", async () => {
    await setup();
    const created = await call("/api/schedules", "POST", {
      ...payload(),
      clock_start: null,
      clock_end: null,
      periods: [{ campus_id: "hirakata", period_number: 5 }],
    });
    expect(created.status).toBe(201);
    expect(
      (
        await call("/api/restrictions", "POST", {
          campus_id: "omiya",
          start_date: future,
          end_date: future,
          reason: "大宮5限制限",
          location_ids: [],
          period_numbers: [5],
          clock_start: null,
          clock_end: null,
          confirm_impact: true,
        })
      ).status,
    ).toBe(201);
    expect((await occurrences(env.DB, future, future, "owner"))[0].valid).toBe(
      true,
    );
  });

  it("allows releasing future dates from a restriction that started earlier", async () => {
    await setup();
    const restriction = await call("/api/restrictions", "POST", {
      campus_id: "omiya",
      start_date: future,
      end_date: after,
      reason: "継続制限",
      location_ids: [],
      period_numbers: [],
      clock_start: null,
      clock_end: null,
      confirm_impact: true,
    });
    const id = restriction.json.data!.id;
    sqlite
      .prepare("UPDATE restrictions SET start_date=? WHERE id=?")
      .run(addDays(todayTokyo(), -1), id);
    expect((await call(`/api/restrictions/${id}`, "DELETE", {})).status).toBe(
      200,
    );
    expect(
      sqlite.prepare("SELECT removed_at FROM restrictions WHERE id=?").get(id),
    ).toMatchObject({ removed_at: expect.any(String) });
  });
});
