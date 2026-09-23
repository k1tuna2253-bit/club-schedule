export type Campus = "omiya" | "hirakata";
export const CAMPUSES: Campus[] = ["omiya", "hirakata"];
export function campus(value: unknown): value is Campus {
  return value === "omiya" || value === "hirakata";
}
export function dateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function timeOnly(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
export function minute(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}
export function todayTokyo(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function addDays(date: string, count: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + count);
  return day.toISOString().slice(0, 10);
}
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}
export function academicYear(date: string): number {
  const year = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 4 ? year : year - 1;
}
export function dayStartTokyo(date: string): string {
  return `${addDays(date, -1)}T15:00:00.000Z`;
}

export function restrictionCutoff(date: string): string {
  return dayStartTokyo(date);
}

export interface PeriodRow {
  id: string;
  campus_id: Campus;
  period_number: number;
  start_time: string;
  end_time: string;
  effective_from: string;
}
export async function periodsFor(
  db: D1Database,
  campusId: Campus,
  date: string,
): Promise<PeriodRow[]> {
  const rows = await db
    .prepare(
      `SELECT id, campus_id, period_number, start_time, end_time, effective_from FROM class_periods
    WHERE campus_id = ? AND active = 1 AND effective_from <= ?
      AND (effective_to IS NULL OR effective_to >= ?)
    ORDER BY period_number, effective_from DESC`,
    )
    .bind(campusId, date, date)
    .all<PeriodRow>();
  const found = new Set<number>();
  return rows.results.filter((row) => {
    if (found.has(row.period_number)) return false;
    found.add(row.period_number);
    return true;
  });
}

export type DayKind =
  | "teaching"
  | "no_school"
  | "holiday"
  | "weekend"
  | "weekday"
  | "unknown_holidays";
export interface CalendarDay {
  date: string;
  kind: DayKind;
  source:
    | "override"
    | "closure"
    | "national_holiday"
    | "weekday"
    | "holiday_data_missing";
  reason: string | null;
  entry_default: "period" | "clock";
  academic_year: number;
}

export async function calendarDays(
  db: D1Database,
  campusId: Campus,
  from: string,
  to: string,
): Promise<CalendarDay[]> {
  const [overrides, closures, holidays, years] = await Promise.all([
    db
      .prepare(
        "SELECT date, kind, reason FROM university_calendar_overrides WHERE campus_id = ? AND date BETWEEN ? AND ?",
      )
      .bind(campusId, from, to)
      .all<{ date: string; kind: "teaching" | "no_school"; reason: string }>(),
    db
      .prepare(
        "SELECT start_date, end_date, reason FROM university_closure_periods WHERE campus_id = ? AND start_date <= ? AND end_date >= ?",
      )
      .bind(campusId, to, from)
      .all<{ start_date: string; end_date: string; reason: string }>(),
    db
      .prepare(
        "SELECT date, name FROM japanese_holidays WHERE date BETWEEN ? AND ?",
      )
      .bind(from, to)
      .all<{ date: string; name: string }>(),
    db
      .prepare(
        "SELECT year FROM holiday_import_years WHERE year BETWEEN ? AND ?",
      )
      .bind(Number(from.slice(0, 4)), Number(to.slice(0, 4)))
      .all<{ year: number }>(),
  ]);
  const overrideMap = new Map(overrides.results.map((row) => [row.date, row]));
  const holidayMap = new Map(
    holidays.results.map((row) => [row.date, row.name]),
  );
  const coveredYears = new Set(years.results.map((row) => row.year));
  const result: CalendarDay[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const override = overrideMap.get(date);
    const closure = closures.results.find(
      (row) => row.start_date <= date && row.end_date >= date,
    );
    const holiday = holidayMap.get(date);
    const weekend = [0, 6].includes(weekday(date));
    let kind: DayKind;
    let source: CalendarDay["source"];
    let reason: string | null = null;
    if (override) {
      kind = override.kind;
      source = "override";
      reason = override.reason;
    } else if (closure) {
      kind = "no_school";
      source = "closure";
      reason = closure.reason;
    } else if (holiday) {
      kind = "holiday";
      source = "national_holiday";
      reason = holiday;
    } else if (!coveredYears.has(Number(date.slice(0, 4)))) {
      kind = weekend ? "weekend" : "unknown_holidays";
      source = "holiday_data_missing";
    } else {
      kind = weekend ? "weekend" : "weekday";
      source = "weekday";
    }
    result.push({
      date,
      kind,
      source,
      reason,
      entry_default:
        weekend ||
        kind === "no_school" ||
        kind === "holiday" ||
        kind === "unknown_holidays"
          ? "clock"
          : "period",
      academic_year: academicYear(date),
    });
  }
  return result;
}
