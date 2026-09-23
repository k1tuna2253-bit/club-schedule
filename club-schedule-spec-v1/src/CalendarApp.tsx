import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type TouchEvent,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  CaretDown,
  Check,
  PencilSimple,
  Plus,
  X,
} from "@phosphor-icons/react";
import { ChoiceGroup } from "./ChoiceGroup";
import { DialogLayer } from "./DialogLayer";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { PeriodPopover } from "./PeriodPopover";
import {
  addCalendarDays as addDays,
  startOfWeek,
  weekdayLabels,
  weekdayValues,
  type WeekStart,
} from "./week-start";

type Campus = "omiya" | "hirakata";
type Permission = string;
type User = { id: string; display_name: string; primary_campus_id: string };
type Day = {
  date: string;
  kind: string;
  reason: string | null;
  entry_default: "period" | "clock";
  participant_count: number;
  schedule_count: number;
  has_restriction: boolean;
  has_invalid_schedule?: boolean;
  source: string;
};
type Location = { id: string; campus_id: Campus; name: string; active: number };
type Period = {
  id: string;
  campus_id: Campus;
  period_number: number;
  start_time: string;
  end_time: string;
  effective_from: string;
};
type Restriction = {
  id: string;
  start_date: string;
  end_date: string;
  reason: string;
  location_ids: string[];
  period_numbers: number[];
  clock_start: string | null;
  clock_end: string | null;
};
type Occurrence = {
  id: string;
  template_id: string | null;
  occurrence_id: string;
  original_date: string;
  date: string;
  user_id: string;
  scope: Campus | "common";
  clock_start: string | null;
  clock_end: string | null;
  private_memo?: string | null;
  shared_memo: string | null;
  periods: { campus_id: Campus; period_number: number }[];
  locations: Location[];
  owner: {
    display_name: string;
    grade: number;
    roles: string[];
    positions: string[];
  };
  valid: boolean;
  invalid_reasons: string[];
};
type Detail = {
  day: Day;
  schedules: Occurrence[];
  restrictions: { id: string; reason: string }[];
};
type ApiError = Error & {
  code?: string;
  details?: { conflicts?: { provisional: boolean }[] };
};
const labels: Record<Campus, string> = { omiya: "大宮", hirakata: "枚方" };
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
const nextMonth = (date: string, delta: number) => {
  const day = new Date(`${monthStart(date)}T00:00:00Z`);
  day.setUTCMonth(day.getUTCMonth() + delta);
  return day.toISOString().slice(0, 10);
};
const monthEnd = (date: string) => addDays(nextMonth(date, 1), -1);
const query = (path: string, values: Record<string, string>) =>
  `${path}?${new URLSearchParams(values)}`;
function useDialogKeyboard(onClose: () => void) {
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current
      ?.querySelector<HTMLElement>("button, input, select, textarea")
      ?.focus();
    const keydown = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (ref.current !== dialogs[dialogs.length - 1]) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      }
      if (event.key !== "Tab" || !ref.current) return;
      const focusable = [
        ...ref.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex='-1'])",
        ),
      ];
      if (!focusable.length) return;
      const first = focusable[0],
        last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, []);
  return ref;
}
async function api<T>(path: string, method = "GET", body?: object): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(
      "ネットワークに接続できません。接続を確認して再試行してください。",
    );
  }
  const json = (await response.json()) as {
    data?: T;
    error?: { code: string; message: string; details?: ApiError["details"] };
  };
  if (!response.ok) {
    const error = new Error(
      json.error?.message ?? "処理できませんでした。",
    ) as ApiError;
    error.code = json.error?.code;
    error.details = json.error?.details;
    throw error;
  }
  return json.data as T;
}
function dateLabel(date: string) {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
}
function dayKind(day: Day) {
  return (
    (
      {
        teaching: "特別授業日",
        no_school: "休業日",
        holiday: "祝日",
        weekend: "週末",
        weekday: "平日",
        unknown_holidays: "祝日データ未取得",
      } as Record<string, string>
    )[day.kind] ?? day.kind
  );
}
function timeLabel(row: Occurrence) {
  const parts = row.periods.map(
    (p) => `${labels[p.campus_id]}${p.period_number}限`,
  );
  if (row.clock_start)
    parts.push(
      `${row.clock_start}〜${row.clock_end ?? "終了未定（競合判定は暫定1時間）"}`,
    );
  return parts.join("・");
}

export function CalendarApp({ user }: { user: User }) {
  const [campus, setCampus] = useState<Campus>(
    user.primary_campus_id === "hirakata" ? "hirakata" : "omiya",
  );
  const [mode, setMode] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState(today());
  const [days, setDays] = useState<Day[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [form, setForm] = useState<Occurrence | "new" | null>(null);
  const [manage, setManage] = useState(false);
  const [permissions, setPermissions] = useState<Set<Permission>>(new Set());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const readSerial = useRef(0);
  const [weekStart, setWeekStart] = useState<WeekStart>("sunday");
  const [shield, setShield] = useState(false);
  const shieldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (shieldTimer.current) clearTimeout(shieldTimer.current);
    },
    [],
  );
  const dismiss = (close: () => void) => {
    close();
    setShield(true);
    if (shieldTimer.current) clearTimeout(shieldTimer.current);
    shieldTimer.current = setTimeout(() => setShield(false), 350);
  };
  const start =
    mode === "week"
      ? startOfWeek(anchor, weekStart)
      : startOfWeek(monthStart(anchor), weekStart);
  const end =
    mode === "week"
      ? addDays(start, 6)
      : addDays(startOfWeek(monthEnd(anchor), weekStart), 6);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const read = () => {
    const serial = ++readSerial.current;
    setLoading(true);
    setError("");
    return api<Day[]>(
      query("/api/calendar", { campus_id: campus, from: start, to: end }),
    )
      .then((result) => {
        if (serial === readSerial.current) setDays(result);
      })
      .catch((e: ApiError) => {
        if (serial === readSerial.current) setError(e.message);
      })
      .finally(() => {
        if (serial === readSerial.current) setLoading(false);
      });
  };
  useEffect(() => {
    void read();
  }, [campus, start, end]);
  useEffect(() => {
    api<{ permissions: Permission[] }>("/api/me")
      .then((data) => setPermissions(new Set(data.permissions)))
      .catch((e: ApiError) => setError(e.message));
  }, []);
  useEffect(() => {
    api<{ week_start: WeekStart }>("/api/me/display-preferences")
      .then((data) => setWeekStart(data.week_start))
      .catch((e: ApiError) => setError(e.message));
  }, []);
  const openDay = async (date: string) => {
    setSelectedDate(date);
    setError("");
    try {
      setDetail(
        await api<Detail>(
          query("/api/calendar/day", { campus_id: campus, date }),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const refresh = async () => {
    await Promise.all([
      read(),
      selectedDate ? openDay(selectedDate) : Promise.resolve(),
    ]);
  };
  const navigate = (delta: number) => {
    setAnchor(
      mode === "week" ? addDays(anchor, delta * 7) : nextMonth(anchor, delta),
    );
    setDetail(null);
    setSelectedDate(null);
  };
  const onTouchStart = (event: TouchEvent) => {
    touch.current = {
      x: event.touches[0].clientX,
      y: event.touches[0].clientY,
    };
  };
  const onTouchEnd = (event: TouchEvent, action: "campus" | "period") => {
    if (!touch.current) return;
    const dx = event.changedTouches[0].clientX - touch.current.x,
      dy = event.changedTouches[0].clientY - touch.current.y;
    touch.current = null;
    if (Math.abs(dx) < 75 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    if (action === "campus") setCampus(dx < 0 ? "hirakata" : "omiya");
    else navigate(dx < 0 ? 1 : -1);
  };
  const canCreate = permissions.has("SCHEDULE_CREATE_SELF");
  const canManage = [
    "LOCATION_MANAGE",
    "CALENDAR_MANAGE",
    "RESTRICTION_MANAGE",
  ].some((key) => permissions.has(key));
  return (
    <div className={detail ? "calendar-app detail-open" : "calendar-app"}>
      <div className="page-heading calendar-heading">
        <div>
          <p className="eyebrow">大学カレンダー</p>
          <h1>予定表</h1>
        </div>
        {canCreate && (
          <button
            className="primary"
            onClick={() => {
              setSelectedDate(selectedDate ?? today());
              setForm("new");
            }}
          >
            <Plus size={18} aria-hidden="true" />
            予定を登録
          </button>
        )}
      </div>
      <div
        className="campus-tabs"
        role="tablist"
        aria-label="キャンパス"
        onTouchStart={onTouchStart}
        onTouchEnd={(e) => onTouchEnd(e, "campus")}
      >
        {(["omiya", "hirakata"] as Campus[]).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={campus === item}
            onClick={() => {
              setCampus(item);
              setDetail(null);
              setSelectedDate(null);
            }}
          >
            {labels[item]}
          </button>
        ))}
      </div>
      <div className="view-switch" role="group" aria-label="表示方式">
        <button aria-pressed={mode === "week"} onClick={() => setMode("week")}>
          週
        </button>
        <button
          aria-pressed={mode === "month"}
          onClick={() => setMode("month")}
        >
          月
        </button>
      </div>
      <div className="calendar-controls">
        <button
          aria-label={mode === "week" ? "前の週" : "前の月"}
          onClick={() => navigate(-1)}
        >
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
        <strong>
          {mode === "week"
            ? `${dateLabel(start)}〜${dateLabel(end)}`
            : `${anchor.slice(0, 4)}年${Number(anchor.slice(5, 7))}月`}
        </strong>
        <button
          onClick={() => {
            setAnchor(today());
            setDetail(null);
          }}
        >
          今日
        </button>
        <button
          aria-label={mode === "week" ? "次の週" : "次の月"}
          onClick={() => navigate(1)}
        >
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      </div>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">カレンダーを読み込み中…</p>
      ) : (
        <section
          className="card calendar-card"
          aria-label={`${labels[campus]}の${mode === "week" ? "週間" : "月間"}予定`}
          onTouchStart={onTouchStart}
          onTouchEnd={(e) => onTouchEnd(e, "period")}
        >
          <div className="calendar-grid">
            {weekdayLabels(weekStart).map((label) => (
              <span key={label} className="calendar-weekday">
                {label}
              </span>
            ))}
            {days.map((day) => (
              <button
                type="button"
                key={day.date}
                className="calendar-day"
                data-outside={
                  mode === "month" &&
                  day.date.slice(0, 7) !== anchor.slice(0, 7)
                }
                data-today={day.date === today()}
                data-selected={day.date === selectedDate}
                aria-pressed={day.date === selectedDate}
                aria-label={`${day.date} ${dayKind(day)}、${day.date === today() ? "今日、" : ""}${day.date === selectedDate ? "選択中、" : ""}参加予定${day.participant_count}人、予定${day.schedule_count}件${day.has_restriction ? "、利用制限あり" : ""}${day.has_invalid_schedule ? "、無効な予定あり" : ""}`}
                onClick={() => openDay(day.date)}
              >
                <span className="calendar-date">
                  {Number(day.date.slice(8))}
                </span>
                <span className="calendar-count">
                  {day.participant_count}人
                </span>
                {day.date === today() && (
                  <span className="calendar-marker">今日</span>
                )}
                {day.date === selectedDate && (
                  <span className="calendar-marker">選択</span>
                )}
                {day.schedule_count > 0 && (
                  <span className="calendar-marker">予定</span>
                )}
                {day.has_restriction && (
                  <span className="calendar-restricted">制限</span>
                )}
                {day.has_invalid_schedule && (
                  <span className="calendar-restricted">無効</span>
                )}
              </button>
            ))}
          </div>
        </section>
      )}
      {canManage && (
        <button className="management-link" onClick={() => setManage(true)}>
          予定表の管理 <ArrowRight size={16} aria-hidden="true" />
        </button>
      )}
      {detail && selectedDate && (
        <DayPanel
          detail={detail}
          user={user}
          permissions={permissions}
          onClose={() =>
            dismiss(() => {
              setDetail(null);
              setSelectedDate(null);
            })
          }
          onCreate={() => setForm("new")}
          onEdit={setForm}
          onChange={refresh}
        />
      )}
      {form && (
        <ScheduleForm
          key={`${form === "new" ? "new" : form.occurrence_id}:${selectedDate}`}
          date={selectedDate ?? today()}
          campus={campus}
          weekStart={weekStart}
          initial={form === "new" ? null : form}
          onClose={() => dismiss(() => setForm(null))}
          onSaved={async () => {
            setForm(null);
            await refresh();
          }}
        />
      )}
      {manage && (
        <ManagementPanel
          campus={campus}
          permissions={permissions}
          onChanged={refresh}
          onClose={() =>
            dismiss(() => {
              setManage(false);
              void refresh();
            })
          }
        />
      )}
      {shield && (
        <div
          className="dismiss-shield"
          aria-hidden="true"
          onPointerDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        />
      )}
    </div>
  );
}

function DayPanel({
  detail,
  user,
  permissions,
  onClose,
  onCreate,
  onEdit,
  onChange,
}: {
  detail: Detail;
  user: User;
  permissions: Set<Permission>;
  onClose: () => void;
  onCreate: () => void;
  onEdit: (row: Occurrence) => void;
  onChange: () => void;
}) {
  const dialogRef = useDialogKeyboard(onClose);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<Occurrence | null>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const dragY = useRef<number | null>(null);
  useEffect(() => {
    if (!deleting) return;
    confirmationRef.current?.scrollIntoView?.({ block: "nearest" });
    confirmationRef.current?.querySelector("button")?.focus();
  }, [deleting]);
  const grouped = new Map<
    string,
    {
      location: { id: string; name: string; campus_id?: Campus };
      rows: Occurrence[];
    }
  >();
  for (const row of detail.schedules) {
    const locations = row.locations.length
      ? row.locations
      : [{ id: "none", name: "場所未指定" }];
    for (const location of locations) {
      if (!grouped.has(location.id))
        grouped.set(location.id, { location, rows: [] });
      const rows = grouped.get(location.id)!.rows;
      if (!rows.some((item) => item.occurrence_id === row.occurrence_id))
        rows.push(row);
    }
  }
  const nameCounts = new Map<string, number>();
  for (const { location } of grouped.values())
    nameCounts.set(location.name, (nameCounts.get(location.name) ?? 0) + 1);
  const remove = async (scope?: "this" | "following") => {
    if (!deleting) return;
    try {
      await api(
        `/api/schedules/${deleting.template_id ?? deleting.id}`,
        "DELETE",
        { occurrence_date: deleting.original_date, occurrence_scope: scope },
      );
      await onChange();
      setDeleting(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <DialogLayer className="detail-backdrop" onClose={onClose}>
      <aside
        ref={dialogRef}
        className={`day-panel ${expanded ? "expanded" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${detail.day.date}の詳細`}
      >
        <button
          className="sheet-handle"
          aria-label={expanded ? "詳細を縮小" : "詳細を拡大"}
          onTouchStart={(e) => {
            dragY.current = e.touches[0].clientY;
          }}
          onTouchEnd={(e) => {
            if (dragY.current === null) return;
            const delta = e.changedTouches[0].clientY - dragY.current;
            dragY.current = null;
            if (delta < -50) setExpanded(true);
            else if (delta > 90) {
              if (expanded) setExpanded(false);
              else onClose();
            }
          }}
          onClick={() => setExpanded(!expanded)}
        >
          <span />
        </button>
        <div className="panel-top">
          <div>
            <p className="eyebrow">{dayKind(detail.day)}</p>
            <h2>{dateLabel(detail.day.date)}の詳細</h2>
          </div>
          <button
            className="icon-button"
            aria-label="詳細を閉じる"
            onClick={onClose}
          >
            <X size={22} />
          </button>
        </div>
        {detail.day.reason && <p className="muted">{detail.day.reason}</p>}
        {detail.day.source === "holiday_data_missing" && (
          <p className="alert">
            この年の祝日データは未取得です。祝日なしとは判定しません。
          </p>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <section>
          <h3>施設利用制限</h3>
          {detail.restrictions.length ? (
            detail.restrictions.map((r) => (
              <p key={r.id} className="restriction-note">
                {r.reason}
              </p>
            ))
          ) : (
            <p className="muted">登録された制限はありません。</p>
          )}
        </section>
        <section>
          <h3>
            通常参加予定{" "}
            <span className="muted">{detail.schedules.length}件</span>
          </h3>
          {!detail.schedules.length && (
            <p className="muted">この日の予定はありません。</p>
          )}
          {[...grouped.entries()].map(([locationId, { location, rows }]) => (
            <div key={locationId} className="schedule-group">
              <h4>
                {(nameCounts.get(location.name) ?? 0) > 1 && location.campus_id
                  ? `${labels[location.campus_id]} / ${location.name}`
                  : location.name}
              </h4>
              {rows.map((row) => (
                <article key={row.occurrence_id} className="schedule-item">
                  <strong>
                    {row.owner.display_name} <small>{row.owner.grade}年</small>
                  </strong>
                  {(row.owner.positions.length > 0 ||
                    row.owner.roles.length > 0) && (
                    <p className="muted">
                      {[...row.owner.positions, ...row.owner.roles].join("・")}
                    </p>
                  )}
                  <p>{timeLabel(row)}</p>
                  <p>
                    {row.scope === "common" ? "共通予定" : labels[row.scope]}
                  </p>
                  {row.private_memo && (
                    <p>
                      <strong>メモ（自分用）</strong>
                      <br />
                      {row.private_memo}
                    </p>
                  )}
                  {row.shared_memo && (
                    <p>
                      <strong>メモ（共有）</strong>
                      <br />
                      {row.shared_memo}
                    </p>
                  )}
                  {!row.valid && (
                    <p className="restriction-note">
                      無効: {row.invalid_reasons.join("、")}
                    </p>
                  )}
                  {row.date >= today() &&
                    row.original_date >= today() &&
                    ((row.user_id === user.id
                      ? permissions.has("SCHEDULE_EDIT_SELF")
                      : permissions.has("SCHEDULE_EDIT_OTHERS")) ||
                      (row.user_id === user.id
                        ? permissions.has("SCHEDULE_DELETE_SELF")
                        : permissions.has("SCHEDULE_DELETE_OTHERS"))) && (
                      <div className="button-row">
                        {(row.user_id === user.id
                          ? permissions.has("SCHEDULE_EDIT_SELF")
                          : permissions.has("SCHEDULE_EDIT_OTHERS")) && (
                          <button onClick={() => onEdit(row)}>
                            <PencilSimple size={16} aria-hidden="true" />
                            編集
                          </button>
                        )}
                        {(row.user_id === user.id
                          ? permissions.has("SCHEDULE_DELETE_SELF")
                          : permissions.has("SCHEDULE_DELETE_OTHERS")) && (
                          <button onClick={() => setDeleting(row)}>削除</button>
                        )}
                      </div>
                    )}
                  {deleting?.occurrence_id === row.occurrence_id && (
                    <div
                      ref={confirmationRef}
                      className="conflict-warning"
                      role="group"
                      aria-label="予定の削除確認"
                    >
                      <p>
                        予定を削除しますか？
                        {deleting.template_id &&
                          "削除する範囲を選んでください。"}
                      </p>
                      <div className="button-row">
                        {deleting.template_id ? (
                          <>
                            <button onClick={() => remove("this")}>
                              この日のみ削除
                            </button>
                            <button onClick={() => remove("following")}>
                              この日以降削除
                            </button>
                          </>
                        ) : (
                          <button onClick={() => remove()}>削除する</button>
                        )}
                        <button onClick={() => setDeleting(null)}>
                          やめる
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </div>
          ))}
        </section>
        {permissions.has("SCHEDULE_CREATE_SELF") &&
          detail.day.date >= today() && (
            <button className="primary" onClick={onCreate}>
              <Plus size={18} aria-hidden="true" />
              この日に登録
            </button>
          )}
      </aside>
    </DialogLayer>
  );
}

function ScheduleForm({
  date,
  campus,
  weekStart,
  initial,
  onClose,
  onSaved,
}: {
  date: string;
  campus: Campus;
  weekStart: WeekStart;
  initial: Occurrence | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialogRef = useDialogKeyboard(onClose);
  const [scheduleDate, setScheduleDate] = useState(initial?.date ?? date);
  const [scope, setScope] = useState<Campus | "common">(
    initial?.scope ?? campus,
  );
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<string[]>(
    initial?.locations.map((l) => l.id) ?? [],
  );
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedPeriods, setSelectedPeriods] = useState<string[]>(
    initial?.periods.map((p) => `${p.campus_id}:${p.period_number}`) ?? [],
  );
  const [clockStart, setClockStart] = useState(initial?.clock_start ?? "");
  const [clockEnd, setClockEnd] = useState(initial?.clock_end ?? "");
  const [privateMemo, setPrivateMemo] = useState(initial?.private_memo ?? "");
  const [sharedMemo, setSharedMemo] = useState(initial?.shared_memo ?? "");
  const [recurring, setRecurring] = useState(false);
  const [weekdays, setWeekdays] = useState<number[]>([
    new Date(`${scheduleDate}T00:00:00Z`).getUTCDay(),
  ]);
  const [endDate, setEndDate] = useState(scheduleDate);
  const [editScope, setEditScope] = useState<"this" | "following">("this");
  const [showClock, setShowClock] = useState(!!initial?.clock_start);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<ApiError["details"] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setConflict(null);
  }, [
    scheduleDate,
    scope,
    selectedLocations,
    selectedPeriods,
    clockStart,
    clockEnd,
    showClock,
    recurring,
    weekdays,
    endDate,
    editScope,
  ]);
  useEffect(() => {
    Promise.all([
      api<Location[]>(query("/api/locations", { campus_id: "omiya" })),
      api<Location[]>(query("/api/locations", { campus_id: "hirakata" })),
      api<Period[]>(
        query("/api/class-periods", { campus_id: "omiya", date: scheduleDate }),
      ),
      api<Period[]>(
        query("/api/class-periods", {
          campus_id: "hirakata",
          date: scheduleDate,
        }),
      ),
      api<{ day: Day }>(
        query("/api/calendar/day", { campus_id: campus, date: scheduleDate }),
      ),
    ])
      .then(([a, b, c, d, detail]) => {
        const available = [...a, ...b];
        setLocations([
          ...available,
          ...(initial?.locations ?? []).filter(
            (location) => !available.some((item) => item.id === location.id),
          ),
        ]);
        setPeriods([...c, ...d]);
        if (!initial) {
          setShowClock(detail.day.entry_default === "clock");
        }
      })
      .catch((e: ApiError) => setError(e.message));
  }, [scheduleDate, campus]);
  const visibleLocations = locations.filter(
    (l) => scope === "common" || l.campus_id === scope,
  );
  const visiblePeriods = periods.filter(
    (p) => scope === "common" || p.campus_id === scope,
  );
  const copyPrevious = async () => {
    try {
      const previous = await api<Occurrence | null>(
        query("/api/schedules/previous", { before: scheduleDate }),
      );
      if (!previous) {
        setError("前回の単発予定はありません。");
        return;
      }
      setScope(previous.scope);
      setSelectedLocations(previous.locations.map((l) => l.id));
      setSelectedPeriods(
        previous.periods.map((p) => `${p.campus_id}:${p.period_number}`),
      );
      setClockStart(previous.clock_start ?? "");
      setClockEnd(previous.clock_end ?? "");
      setPrivateMemo(previous.private_memo ?? "");
      setSharedMemo(previous.shared_memo ?? "");
      setShowClock(!!previous.clock_start);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const save = async (continueConflict: boolean) => {
    setBusy(true);
    setError("");
    const body = {
      date: scheduleDate,
      scope,
      location_ids: selectedLocations.filter((id) =>
        visibleLocations.some((l) => l.id === id),
      ),
      periods: selectedPeriods
        .filter((key) =>
          visiblePeriods.some(
            (p) => key === `${p.campus_id}:${p.period_number}`,
          ),
        )
        .map((key) => {
          const [campus_id, period_number] = key.split(":");
          return { campus_id, period_number: Number(period_number) };
        }),
      clock_start: showClock ? clockStart || null : null,
      clock_end: showClock ? clockEnd || null : null,
      private_memo: privateMemo || null,
      shared_memo: sharedMemo || null,
      recurrence:
        !initial && recurring ? { weekdays, end_date: endDate } : null,
      continue_conflict: continueConflict,
    };
    try {
      if (initial)
        await api(
          `/api/schedules/${initial.template_id ?? initial.id}`,
          "PATCH",
          {
            occurrence_date: initial.original_date,
            occurrence_scope: initial.template_id ? editScope : undefined,
            schedule: body,
          },
        );
      else await api("/api/schedules", "POST", body);
      onSaved();
    } catch (e) {
      const issue = e as ApiError;
      if (issue.code === "SCHEDULE_CONFLICT") setConflict(issue.details ?? {});
      else setError(issue.message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (
    values: string[],
    value: string,
    setter: (value: string[]) => void,
  ) =>
    setter(
      values.includes(value)
        ? values.filter((v) => v !== value)
        : [...values, value],
    );
  return (
    <DialogLayer className="modal-backdrop" onClose={onClose}>
      <section
        ref={dialogRef}
        className="card modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={initial ? "予定を編集" : "予定を登録"}
      >
        <div className="panel-top">
          <h2>{initial ? "予定を編集" : "予定を登録"}</h2>
          <button className="icon-button" onClick={onClose} aria-label="閉じる">
            <X size={22} />
          </button>
        </div>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            save(false);
          }}
        >
          <label>
            日付
            <input
              type="date"
              min={today()}
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              required
            />
          </label>
          <ChoiceGroup
            label="参加するキャンパス"
            value={scope}
            onChange={setScope}
            options={[
              { value: "omiya", label: "大宮" },
              { value: "hirakata", label: "枚方" },
              { value: "common", label: "共通" },
            ]}
          />
          {!initial && (
            <button type="button" onClick={copyPrevious}>
              前回と同じ内容を入力
            </button>
          )}
          <fieldset>
            <legend>活動場所を選ぶ</legend>
            {visibleLocations.length ? (
              visibleLocations.map((loc) => (
                <label key={loc.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={selectedLocations.includes(loc.id)}
                    disabled={
                      !loc.active && !selectedLocations.includes(loc.id)
                    }
                    onChange={() =>
                      toggle(selectedLocations, loc.id, setSelectedLocations)
                    }
                  />
                  {labels[loc.campus_id]} {loc.name}
                  {!loc.active && "（無効）"}
                </label>
              ))
            ) : (
              <p className="muted">選べる活動場所はありません。</p>
            )}
          </fieldset>
          <PeriodPopover
            periods={visiblePeriods}
            selected={selectedPeriods}
            onChange={setSelectedPeriods}
            common={scope === "common"}
          />
          <button
            type="button"
            className="section-toggle"
            aria-expanded={showClock}
            onClick={() => setShowClock(!showClock)}
          >
            時間を追加 <CaretDown size={16} aria-hidden="true" />
          </button>
          {showClock && (
            <div className="time-pair">
              <label>
                開始時刻
                <input
                  type="time"
                  value={clockStart}
                  onChange={(e) => setClockStart(e.target.value)}
                />
              </label>
              <label>
                終了時刻（未定なら空欄）
                <input
                  type="time"
                  value={clockEnd}
                  onChange={(e) => setClockEnd(e.target.value)}
                />
              </label>
            </div>
          )}
          <label>
            メモ（自分にだけ表示）
            <AutoGrowTextarea value={privateMemo} onChange={setPrivateMemo} />
          </label>
          <label>
            メモ（共有）
            <AutoGrowTextarea value={sharedMemo} onChange={setSharedMemo} />
          </label>
          {!initial && (
            <>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={recurring}
                  onChange={(e) => setRecurring(e.target.checked)}
                />
                毎週繰り返す
              </label>
              {recurring && (
                <fieldset>
                  <legend>繰り返す曜日</legend>
                  {weekdayValues(weekStart).map((value) => {
                    const label = ["日", "月", "火", "水", "木", "金", "土"][
                      value
                    ];
                    return (
                      <label className="check-row" key={value}>
                        <input
                          type="checkbox"
                          checked={weekdays.includes(value)}
                          onChange={() =>
                            setWeekdays(
                              weekdays.includes(value)
                                ? weekdays.filter((d) => d !== value)
                                : [...weekdays, value],
                            )
                          }
                        />
                        {label}
                      </label>
                    );
                  })}
                  <label>
                    終了日
                    <input
                      type="date"
                      min={scheduleDate}
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </label>
                </fieldset>
              )}
            </>
          )}
          {initial?.template_id && (
            <ChoiceGroup
              label="変更する範囲"
              value={editScope}
              onChange={setEditScope}
              options={[
                { value: "this", label: "この日のみ" },
                { value: "following", label: "この日以降" },
              ]}
            />
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          {conflict && (
            <div className="conflict-warning" role="alert">
              <p>
                同じ日の予定と時間が重なります。
                {conflict.conflicts?.some((c) => c.provisional) &&
                  "終了未定の予定は開始から1時間で暫定判定しました。"}
              </p>
              <div className="button-row">
                <button type="button" onClick={() => setConflict(null)}>
                  戻って修正
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    setConflict(null);
                    save(true);
                  }}
                >
                  このまま登録
                </button>
              </div>
            </div>
          )}
          {!conflict && (
            <button type="submit" className="primary" disabled={busy}>
              <Check size={18} aria-hidden="true" />
              {busy ? "保存中…" : "保存する"}
            </button>
          )}
        </form>
      </section>
    </DialogLayer>
  );
}

function ManagementPanel({
  campus,
  permissions,
  onClose,
  onChanged,
}: {
  campus: Campus;
  permissions: Set<Permission>;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const dialogRef = useDialogKeyboard(onClose);
  const [locations, setLocations] = useState<Location[]>([]),
    [periods, setPeriods] = useState<Period[]>([]);
  const [closures, setClosures] = useState<
      { id: string; start_date: string; end_date: string; reason: string }[]
    >([]),
    [overrides, setOverrides] = useState<
      { id: string; date: string; kind: string; reason: string }[]
    >([]),
    [restrictions, setRestrictions] = useState<Restriction[]>([]);
  const [periodEditing, setPeriodEditing] = useState<string | null>(null),
    [closureEditing, setClosureEditing] = useState<string | null>(null),
    [overrideEditing, setOverrideEditing] = useState<string | null>(null),
    [restrictionEditing, setRestrictionEditing] = useState<string | null>(null);
  const [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [name, setName] = useState(""),
    [periodNumber, setPeriodNumber] = useState(""),
    [periodStart, setPeriodStart] = useState(""),
    [periodEnd, setPeriodEnd] = useState("");
  const [startDate, setStartDate] = useState(today()),
    [endDate, setEndDate] = useState(today()),
    [reason, setReason] = useState(""),
    [kind, setKind] = useState("teaching");
  const [restrictLocations, setRestrictLocations] = useState<string[]>([]),
    [restrictPeriods, setRestrictPeriods] = useState<number[]>([]),
    [restrictStart, setRestrictStart] = useState(""),
    [restrictEnd, setRestrictEnd] = useState("");
  type Section =
    | "menu"
    | "locations"
    | "periods"
    | "closures"
    | "overrides"
    | "restrictions";
  const [section, setSection] = useState<Section>("menu");
  const [restrictCoverage, setRestrictCoverage] = useState<
    "campus" | "locations"
  >("campus");
  const [restrictTime, setRestrictTime] = useState<
    "all_day" | "periods" | "clock" | "mixed"
  >("all_day");
  const load = () =>
    Promise.all([
      api<Location[]>(query("/api/locations", { campus_id: campus })),
      api<Period[]>(
        query("/api/class-periods", { campus_id: campus, date: today() }),
      ),
      permissions.has("CALENDAR_MANAGE") || permissions.has("SCHEDULE_VIEW")
        ? api<typeof closures>(query("/api/closures", { campus_id: campus }))
        : Promise.resolve([]),
      permissions.has("CALENDAR_MANAGE") || permissions.has("SCHEDULE_VIEW")
        ? api<typeof overrides>(query("/api/overrides", { campus_id: campus }))
        : Promise.resolve([]),
      permissions.has("RESTRICTION_MANAGE") || permissions.has("SCHEDULE_VIEW")
        ? api<typeof restrictions>(
            query("/api/restrictions", { campus_id: campus }),
          )
        : Promise.resolve([]),
    ])
      .then(([a, b, c, d, e]) => {
        setLocations(a);
        setPeriods(b);
        setClosures(c);
        setOverrides(d);
        setRestrictions(e);
      })
      .catch((e: ApiError) => setError(e.message));
  useEffect(() => {
    load();
  }, [campus]);
  const submit = async (
    path: string,
    method: string,
    body: object,
    confirmation?: string,
  ) => {
    if (confirmation && !window.confirm(confirmation)) return;
    setError("");
    setMessage("");
    try {
      await api(path, method, body);
      setMessage("保存しました。");
      await Promise.all([load(), onChanged()]);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <DialogLayer className="modal-backdrop" onClose={onClose}>
      <section
        ref={dialogRef}
        className="card modal-card management-panel"
        role="dialog"
        aria-modal="true"
        aria-label="予定表の管理"
      >
        <div className="panel-top">
          <div className="management-heading">
            {section !== "menu" && (
              <button
                type="button"
                onClick={() => {
                  setSection("menu");
                  setError("");
                  setMessage("");
                }}
              >
                <ArrowLeft size={18} aria-hidden="true" /> 戻る
              </button>
            )}
            <h2>
              {section === "menu"
                ? `${labels[campus]}の管理`
                : (
                    {
                      locations: "活動場所",
                      periods: "授業時限",
                      closures: "大学休業期間",
                      overrides: "特別授業日・休講日",
                      restrictions: "施設利用制限",
                    } as Record<Exclude<Section, "menu">, string>
                  )[section]}
            </h2>
          </div>
          <button
            className="icon-button"
            aria-label="管理画面を閉じる"
            onClick={onClose}
          >
            <X size={22} />
          </button>
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="success">
            {message}
          </p>
        )}
        {section === "menu" && (
          <nav className="management-menu" aria-label="管理項目">
            {(
              [
                ["locations", "活動場所", "LOCATION_MANAGE"],
                ["periods", "授業時限", "CALENDAR_MANAGE"],
                ["closures", "大学休業期間", "CALENDAR_MANAGE"],
                ["overrides", "特別授業日・休講日", "CALENDAR_MANAGE"],
                ["restrictions", "施設利用制限", "RESTRICTION_MANAGE"],
              ] as const
            )
              .filter((item) => permissions.has(item[2]))
              .map(([key, label]) => (
                <button type="button" key={key} onClick={() => setSection(key)}>
                  {label}
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
              ))}
          </nav>
        )}
        {section === "locations" && permissions.has("LOCATION_MANAGE") && (
          <section>
            <h3>活動場所</h3>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit("/api/locations", "POST", { campus_id: campus, name });
                setName("");
              }}
            >
              <label>
                名称
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </label>
              <button type="submit">追加</button>
            </form>
            <ul className="management-list">
              {locations.map((loc) => (
                <li key={loc.id}>
                  <span>
                    {loc.name}
                    {!loc.active && "（無効）"}
                  </span>
                  <button
                    onClick={() => {
                      const next = window.prompt("活動場所の名前", loc.name);
                      if (next !== null && next.trim())
                        submit(`/api/locations/${loc.id}`, "PATCH", {
                          name: next,
                          active: !!loc.active,
                        });
                    }}
                  >
                    名称変更
                  </button>
                  <button
                    onClick={() =>
                      submit(
                        `/api/locations/${loc.id}`,
                        "PATCH",
                        { name: loc.name, active: !loc.active },
                        loc.active
                          ? "活動場所を無効にしますか？既存予定には名前が残ります。"
                          : undefined,
                      )
                    }
                  >
                    {loc.active ? "無効化" : "有効化"}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {permissions.has("CALENDAR_MANAGE") && (
          <>
            {section === "periods" && (
              <section>
                <h3>授業時限</h3>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit(
                      periodEditing
                        ? `/api/class-periods/${periodEditing}`
                        : "/api/class-periods",
                      periodEditing ? "PATCH" : "POST",
                      {
                        campus_id: campus,
                        period_number: Number(periodNumber),
                        start_time: periodStart,
                        end_time: periodEnd,
                        effective_from: startDate,
                      },
                    );
                  }}
                >
                  <div className="time-pair">
                    <label>
                      時限番号
                      <input
                        type="number"
                        min="1"
                        value={periodNumber}
                        onChange={(e) => setPeriodNumber(e.target.value)}
                        required
                      />
                    </label>
                    <label>
                      適用開始日
                      <input
                        type="date"
                        min={today()}
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        required
                      />
                    </label>
                    <label>
                      開始
                      <input
                        type="time"
                        value={periodStart}
                        onChange={(e) => setPeriodStart(e.target.value)}
                        required
                      />
                    </label>
                    <label>
                      終了
                      <input
                        type="time"
                        value={periodEnd}
                        onChange={(e) => setPeriodEnd(e.target.value)}
                        required
                      />
                    </label>
                  </div>
                  <button type="submit">
                    {periodEditing ? "時限を修正" : "時限を追加"}
                  </button>
                  {periodEditing && (
                    <button
                      type="button"
                      onClick={() => setPeriodEditing(null)}
                    >
                      修正をやめる
                    </button>
                  )}
                </form>
                <ul className="management-list">
                  {periods.map((p) => (
                    <li key={`${p.period_number}:${p.start_time}`}>
                      {p.period_number}限 {p.start_time}〜{p.end_time}
                      <button
                        type="button"
                        onClick={() => {
                          setPeriodEditing(p.id);
                          setPeriodNumber(String(p.period_number));
                          setPeriodStart(p.start_time);
                          setPeriodEnd(p.end_time);
                          setStartDate(today());
                        }}
                      >
                        修正
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {section === "closures" && (
              <section>
                <h3>大学休業期間</h3>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit(
                      closureEditing
                        ? `/api/closures/${closureEditing}`
                        : "/api/closures",
                      closureEditing ? "PATCH" : "POST",
                      {
                        campus_id: campus,
                        start_date: startDate,
                        end_date: endDate,
                        reason,
                      },
                    );
                  }}
                >
                  <DateReason
                    start={startDate}
                    end={endDate}
                    reason={reason}
                    setStart={setStartDate}
                    setEnd={setEndDate}
                    setReason={setReason}
                  />
                  <button type="submit">
                    {closureEditing ? "休業期間を修正" : "休業期間を追加"}
                  </button>
                  {closureEditing && (
                    <button
                      type="button"
                      onClick={() => setClosureEditing(null)}
                    >
                      修正をやめる
                    </button>
                  )}
                </form>
                <ul className="management-list">
                  {closures.map((item) => (
                    <li key={item.id}>
                      {item.start_date}〜{item.end_date} {item.reason}
                      <button
                        type="button"
                        onClick={() => {
                          setClosureEditing(item.id);
                          setStartDate(item.start_date);
                          setEndDate(item.end_date);
                          setReason(item.reason);
                        }}
                      >
                        修正
                      </button>
                      <button
                        onClick={() =>
                          submit(
                            `/api/closures/${item.id}`,
                            "DELETE",
                            {},
                            "休業期間を削除しますか？",
                          )
                        }
                      >
                        削除
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {section === "overrides" && (
              <section>
                <h3>特別授業日・休講日</h3>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit(
                      overrideEditing
                        ? `/api/overrides/${overrideEditing}`
                        : "/api/overrides",
                      overrideEditing ? "PATCH" : "POST",
                      {
                        campus_id: campus,
                        date: startDate,
                        kind,
                        reason,
                      },
                    );
                  }}
                >
                  <label>
                    日付
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      required
                    />
                  </label>
                  <ChoiceGroup
                    label="区分"
                    value={kind}
                    onChange={setKind}
                    options={[
                      { value: "teaching", label: "特別授業日" },
                      { value: "no_school", label: "休講日" },
                    ]}
                  />
                  <label>
                    理由
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      required
                    />
                  </label>
                  <button type="submit">
                    {overrideEditing ? "修正" : "登録"}
                  </button>
                  {overrideEditing && (
                    <button
                      type="button"
                      onClick={() => setOverrideEditing(null)}
                    >
                      修正をやめる
                    </button>
                  )}
                </form>
                <ul className="management-list">
                  {overrides.map((item) => (
                    <li key={item.id}>
                      {item.date} {item.kind === "teaching" ? "授業" : "休講"}{" "}
                      {item.reason}
                      <button
                        type="button"
                        onClick={() => {
                          setOverrideEditing(item.id);
                          setStartDate(item.date);
                          setKind(item.kind);
                          setReason(item.reason);
                        }}
                      >
                        修正
                      </button>
                      <button
                        onClick={() =>
                          submit(
                            `/api/overrides/${item.id}`,
                            "DELETE",
                            {},
                            "個別日設定を削除しますか？",
                          )
                        }
                      >
                        削除
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
        {section === "restrictions" &&
          permissions.has("RESTRICTION_MANAGE") && (
            <section>
              <h3>施設利用制限</h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (
                    restrictCoverage === "locations" &&
                    !restrictLocations.length
                  ) {
                    setError("制限する活動場所を選んでください。");
                    return;
                  }
                  if (
                    (restrictTime === "periods" || restrictTime === "mixed") &&
                    !restrictPeriods.length
                  ) {
                    setError("制限する時限を選んでください。");
                    return;
                  }
                  if (
                    (restrictTime === "clock" || restrictTime === "mixed") &&
                    (!restrictStart || !restrictEnd)
                  ) {
                    setError("制限する時間を入力してください。");
                    return;
                  }
                  submit(
                    restrictionEditing
                      ? `/api/restrictions/${restrictionEditing}`
                      : "/api/restrictions",
                    restrictionEditing ? "PATCH" : "POST",
                    {
                      campus_id: campus,
                      start_date: startDate,
                      end_date: endDate,
                      reason,
                      location_ids:
                        restrictCoverage === "locations"
                          ? restrictLocations
                          : [],
                      period_numbers:
                        restrictTime === "periods" || restrictTime === "mixed"
                          ? restrictPeriods
                          : [],
                      clock_start:
                        restrictTime === "clock" || restrictTime === "mixed"
                          ? restrictStart
                          : null,
                      clock_end:
                        restrictTime === "clock" || restrictTime === "mixed"
                          ? restrictEnd
                          : null,
                      confirm_impact: true,
                    },
                    restrictCoverage === "campus" && restrictTime === "all_day"
                      ? "キャンパス全体への制限です。影響する予定が無効になる場合があります。登録しますか？"
                      : "制限に該当する既存予定が無効になる場合があります。登録しますか？",
                  );
                }}
              >
                <DateReason
                  start={startDate}
                  end={endDate}
                  reason={reason}
                  setStart={setStartDate}
                  setEnd={setEndDate}
                  setReason={setReason}
                />
                <ChoiceGroup
                  label="制限する範囲"
                  value={restrictCoverage}
                  onChange={setRestrictCoverage}
                  options={[
                    { value: "campus", label: "キャンパス全体" },
                    { value: "locations", label: "場所を指定" },
                  ]}
                />
                {restrictCoverage === "locations" && (
                  <fieldset>
                    <legend>制限する活動場所</legend>
                    {locations
                      .filter(
                        (l) => l.active || restrictLocations.includes(l.id),
                      )
                      .map((l) => (
                        <label className="check-row" key={l.id}>
                          <input
                            type="checkbox"
                            checked={restrictLocations.includes(l.id)}
                            onChange={() =>
                              setRestrictLocations(
                                restrictLocations.includes(l.id)
                                  ? restrictLocations.filter(
                                      (id) => id !== l.id,
                                    )
                                  : [...restrictLocations, l.id],
                              )
                            }
                          />
                          {l.name}
                        </label>
                      ))}
                  </fieldset>
                )}
                <ChoiceGroup
                  label="制限する時間"
                  value={restrictTime}
                  onChange={setRestrictTime}
                  options={[
                    { value: "all_day", label: "終日" },
                    { value: "periods", label: "時限" },
                    { value: "clock", label: "時間" },
                    { value: "mixed", label: "時限＋時間" },
                  ]}
                />
                {(restrictTime === "periods" || restrictTime === "mixed") && (
                  <fieldset>
                    <legend>制限する時限</legend>
                    {periods.map((p) => (
                      <label className="check-row" key={p.id}>
                        <input
                          type="checkbox"
                          checked={restrictPeriods.includes(p.period_number)}
                          onChange={() =>
                            setRestrictPeriods(
                              restrictPeriods.includes(p.period_number)
                                ? restrictPeriods.filter(
                                    (n) => n !== p.period_number,
                                  )
                                : [...restrictPeriods, p.period_number],
                            )
                          }
                        />
                        {p.period_number}限
                      </label>
                    ))}
                  </fieldset>
                )}
                {(restrictTime === "clock" || restrictTime === "mixed") && (
                  <div className="time-pair">
                    <label>
                      制限開始時刻
                      <input
                        type="time"
                        value={restrictStart}
                        onChange={(e) => setRestrictStart(e.target.value)}
                      />
                    </label>
                    <label>
                      制限終了時刻
                      <input
                        type="time"
                        value={restrictEnd}
                        onChange={(e) => setRestrictEnd(e.target.value)}
                      />
                    </label>
                  </div>
                )}
                <button type="submit">
                  {restrictionEditing ? "制限を修正" : "制限を登録"}
                </button>
                {restrictionEditing && (
                  <button
                    type="button"
                    onClick={() => setRestrictionEditing(null)}
                  >
                    修正をやめる
                  </button>
                )}
              </form>
              <ul className="management-list">
                {restrictions.map((item) => (
                  <li key={item.id}>
                    {item.start_date}〜{item.end_date} {item.reason}
                    <button
                      type="button"
                      onClick={() => {
                        setRestrictionEditing(item.id);
                        setStartDate(
                          item.start_date < today() ? today() : item.start_date,
                        );
                        setEndDate(item.end_date);
                        setReason(item.reason);
                        setRestrictLocations(item.location_ids);
                        setRestrictCoverage(
                          item.location_ids.length ? "locations" : "campus",
                        );
                        setRestrictPeriods(item.period_numbers);
                        setRestrictStart(item.clock_start ?? "");
                        setRestrictEnd(item.clock_end ?? "");
                        setRestrictTime(
                          item.period_numbers.length
                            ? item.clock_start
                              ? "mixed"
                              : "periods"
                            : item.clock_start
                              ? "clock"
                              : "all_day",
                        );
                      }}
                    >
                      修正
                    </button>
                    <button
                      onClick={() =>
                        submit(
                          `/api/restrictions/${item.id}`,
                          "DELETE",
                          {},
                          "制限を解除しますか？対象日開始後の解除では、その日の予定は自動復活しません。",
                        )
                      }
                    >
                      解除
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
      </section>
    </DialogLayer>
  );
}
function DateReason({
  start,
  end,
  reason,
  setStart,
  setEnd,
  setReason,
}: {
  start: string;
  end: string;
  reason: string;
  setStart: (v: string) => void;
  setEnd: (v: string) => void;
  setReason: (v: string) => void;
}) {
  return (
    <>
      <div className="time-pair">
        <label>
          開始日
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            required
          />
        </label>
        <label>
          終了日
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            required
          />
        </label>
      </div>
      <label>
        理由
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
        />
      </label>
    </>
  );
}
