// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { CalendarApp } from "../src/CalendarApp";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("calendar dialog dismissal", () => {
  it("groups same-named campus locations by immutable ID without duplicate entries", async () => {
    const day = {
      date: "2099-01-03",
      kind: "weekday",
      reason: null,
      entry_default: "period",
      participant_count: 2,
      schedule_count: 2,
      has_restriction: false,
      source: "weekday",
    };
    const omiya = {
      id: "o-gym",
      campus_id: "omiya",
      name: "体育館",
      active: 1,
    };
    const hirakata = {
      id: "h-gym",
      campus_id: "hirakata",
      name: "体育館",
      active: 1,
    };
    const common = {
      id: "common",
      template_id: null,
      occurrence_id: "common",
      original_date: day.date,
      date: day.date,
      user_id: "test",
      scope: "common",
      clock_start: "14:00",
      clock_end: "16:00",
      private_memo: null,
      shared_memo: null,
      periods: [],
      locations: [omiya, hirakata, omiya],
      owner: { display_name: "共通担当", grade: 1, roles: [], positions: [] },
      valid: true,
      invalid_reasons: [],
    };
    const local = {
      ...common,
      id: "local",
      occurrence_id: "local",
      scope: "omiya",
      locations: [omiya],
      owner: { ...common.owner, display_name: "大宮担当" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        const url = String(path);
        const data = url.startsWith("/api/calendar/day")
          ? { day, schedules: [common, local], restrictions: [] }
          : url.startsWith("/api/calendar?")
            ? [day]
            : url.includes("display-preferences")
              ? { week_start: "sunday" }
              : { permissions: ["SCHEDULE_VIEW"] };
        return { ok: true, json: async () => ({ data }) };
      }),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(
      <CalendarApp
        user={{ id: "test", display_name: "Test", primary_campus_id: "omiya" }}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /2099-01-03/ }));
    await screen.findByRole("dialog", { name: /詳細/ });
    const groups = [...container.querySelectorAll(".schedule-group")];
    expect(groups).toHaveLength(2);
    const omiyaGroup = groups.find((group) =>
      within(group as HTMLElement).queryByRole("heading", {
        name: "大宮 / 体育館",
      }),
    ) as HTMLElement;
    const hirakataGroup = groups.find((group) =>
      within(group as HTMLElement).queryByRole("heading", {
        name: "枚方 / 体育館",
      }),
    ) as HTMLElement;
    expect(omiyaGroup).toBeTruthy();
    expect(hirakataGroup).toBeTruthy();
    expect(omiyaGroup.querySelectorAll(".schedule-item")).toHaveLength(2);
    expect(hirakataGroup.querySelectorAll(".schedule-item")).toHaveLength(1);
    expect(within(omiyaGroup).getAllByText("共通担当")).toHaveLength(1);
    expect(within(hirakataGroup).getAllByText("共通担当")).toHaveLength(1);
    expect(
      error.mock.calls.some(([message]) => String(message).includes("key")),
    ).toBe(false);
    error.mockRestore();
  });

  it("keeps a single-campus location heading unchanged", async () => {
    const day = {
      date: "2099-01-03",
      kind: "weekday",
      reason: null,
      entry_default: "period",
      participant_count: 1,
      schedule_count: 1,
      has_restriction: false,
      source: "weekday",
    };
    const row = {
      id: "local",
      template_id: null,
      occurrence_id: "local",
      original_date: day.date,
      date: day.date,
      user_id: "test",
      scope: "omiya",
      clock_start: null,
      clock_end: null,
      private_memo: null,
      shared_memo: null,
      periods: [{ campus_id: "omiya", period_number: 1 }],
      locations: [
        { id: "o-gym", campus_id: "omiya", name: "体育館", active: 1 },
      ],
      owner: { display_name: "担当", grade: 1, roles: [], positions: [] },
      valid: true,
      invalid_reasons: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        const url = String(path);
        const data = url.startsWith("/api/calendar/day")
          ? { day, schedules: [row], restrictions: [] }
          : url.startsWith("/api/calendar?")
            ? [day]
            : url.includes("display-preferences")
              ? { week_start: "sunday" }
              : { permissions: ["SCHEDULE_VIEW"] };
        return { ok: true, json: async () => ({ data }) };
      }),
    );
    render(
      <CalendarApp
        user={{ id: "test", display_name: "Test", primary_campus_id: "omiya" }}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /2099-01-03/ }));
    expect(await screen.findByRole("heading", { name: "体育館" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "大宮 / 体育館" })).toBeNull();
  });
  it("keeps delete confirmation beside the selected schedule and refreshes day and calendar", async () => {
    let deleted = false;
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      const url = String(path);
      if (url === "/api/schedules/schedule" && init?.method === "DELETE") {
        expect(JSON.parse(String(init.body))).toEqual({
          occurrence_date: "2099-01-03",
        });
        deleted = true;
        return { ok: true, json: async () => ({ data: { ok: true } }) };
      }
      const day = {
        date: "2099-01-03",
        kind: "weekday",
        reason: null,
        entry_default: "period",
        participant_count: deleted ? 0 : 1,
        schedule_count: deleted ? 0 : 1,
        has_restriction: false,
        has_invalid_schedule: false,
        source: "weekday",
      };
      const row = {
        id: "schedule",
        template_id: null,
        occurrence_id: "schedule",
        original_date: day.date,
        date: day.date,
        user_id: "test",
        scope: "omiya",
        clock_start: null,
        clock_end: null,
        private_memo: null,
        shared_memo: null,
        periods: [{ campus_id: "omiya", period_number: 1 }],
        locations: [],
        owner: { display_name: "Test", grade: 1, roles: [], positions: [] },
        valid: true,
        invalid_reasons: [],
      };
      const data = url.startsWith("/api/calendar/day")
        ? { day, schedules: deleted ? [] : [row], restrictions: [] }
        : url.startsWith("/api/calendar?")
          ? [day]
          : url.includes("display-preferences")
            ? { week_start: "sunday" }
            : { permissions: ["SCHEDULE_VIEW", "SCHEDULE_DELETE_SELF"] };
      return { ok: true, json: async () => ({ data }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CalendarApp
        user={{ id: "test", display_name: "Test", primary_campus_id: "omiya" }}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /2099-01-03/ }));
    const article = (
      await screen.findByRole("button", { name: "削除" })
    ).closest(".schedule-item")!;
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    const confirmation = screen.getByRole("group", { name: "予定の削除確認" });
    expect(article.contains(confirmation)).toBe(true);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "削除する" }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));
    await waitFor(() =>
      expect(screen.getByText("この日の予定はありません。")).toBeTruthy(),
    );
    expect(
      fetchMock.mock.calls.filter(([path]) =>
        String(path).startsWith("/api/calendar/day"),
      ),
    ).toHaveLength(2);
    expect(
      fetchMock.mock.calls.filter(([path]) =>
        String(path).startsWith("/api/calendar?"),
      ),
    ).toHaveLength(2);
  });
  it("refreshes visible calendar and day after a restriction is released in management", async () => {
    let active = true;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      const url = String(path);
      if (
        url === "/api/restrictions/restriction" &&
        init?.method === "DELETE"
      ) {
        active = false;
        return { ok: true, json: async () => ({ data: { ok: true } }) };
      }
      const day = {
        date: "2099-01-03",
        kind: "weekday",
        reason: null,
        entry_default: "period",
        participant_count: active ? 0 : 1,
        schedule_count: 1,
        has_restriction: active,
        has_invalid_schedule: active,
        source: "weekday",
      };
      const row = {
        id: "schedule",
        template_id: null,
        occurrence_id: "schedule",
        original_date: day.date,
        date: day.date,
        user_id: "test",
        scope: "omiya",
        clock_start: null,
        clock_end: null,
        private_memo: null,
        shared_memo: null,
        periods: [{ campus_id: "omiya", period_number: 1 }],
        locations: [],
        owner: { display_name: "Test", grade: 1, roles: [], positions: [] },
        valid: !active,
        invalid_reasons: active ? ["検証制限"] : [],
      };
      const data = url.startsWith("/api/calendar/day")
        ? {
            day,
            schedules: [row],
            restrictions: active
              ? [{ id: "restriction", reason: "検証制限" }]
              : [],
          }
        : url.startsWith("/api/calendar?")
          ? [day]
          : url.startsWith("/api/restrictions?")
            ? active
              ? [
                  {
                    id: "restriction",
                    start_date: day.date,
                    end_date: day.date,
                    reason: "検証制限",
                    location_ids: [],
                    period_numbers: [],
                    clock_start: null,
                    clock_end: null,
                  },
                ]
              : []
            : url.includes("display-preferences")
              ? { week_start: "sunday" }
              : url === "/api/me"
                ? { permissions: ["SCHEDULE_VIEW", "RESTRICTION_MANAGE"] }
                : [];
      return { ok: true, json: async () => ({ data }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CalendarApp
        user={{ id: "test", display_name: "Test", primary_campus_id: "omiya" }}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /2099-01-03/ }));
    await screen.findByText("無効: 検証制限");
    fireEvent.click(screen.getByRole("button", { name: /予定表の管理/ }));
    fireEvent.click(screen.getByRole("button", { name: "施設利用制限" }));
    fireEvent.click(await screen.findByRole("button", { name: "解除" }));
    await waitFor(() =>
      expect(screen.queryByText("無効: 検証制限")).toBeNull(),
    );
    expect(
      screen
        .getByRole("button", { name: /2099-01-03/ })
        .getAttribute("aria-label"),
    ).not.toContain("無効な予定あり");
    expect(
      fetchMock.mock.calls.filter(([path]) =>
        String(path).startsWith("/api/calendar/day"),
      ),
    ).toHaveLength(2);
  });
  it("shows delete for an invalid future schedule with delete permission alone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        const url = String(path);
        const day = {
          date: "2099-01-03",
          kind: "weekday",
          reason: null,
          entry_default: "period",
          participant_count: 0,
          schedule_count: 1,
          has_restriction: true,
          has_invalid_schedule: true,
          source: "weekday",
        };
        const row = {
          id: "schedule",
          template_id: null,
          occurrence_id: "schedule",
          original_date: day.date,
          date: day.date,
          user_id: "test",
          scope: "omiya",
          clock_start: null,
          clock_end: null,
          private_memo: null,
          shared_memo: null,
          periods: [{ campus_id: "omiya", period_number: 1 }],
          locations: [],
          owner: { display_name: "Test", grade: 1, roles: [], positions: [] },
          valid: false,
          invalid_reasons: ["施設利用制限"],
        };
        const data = url.startsWith("/api/calendar/day")
          ? {
              day,
              schedules: [row],
              restrictions: [{ id: "r", reason: "施設利用制限" }],
            }
          : url.startsWith("/api/calendar?")
            ? [day]
            : url.includes("display-preferences")
              ? { week_start: "sunday" }
              : { permissions: ["SCHEDULE_VIEW", "SCHEDULE_DELETE_SELF"] };
        return { ok: true, json: async () => ({ data }) };
      }),
    );
    render(
      <CalendarApp
        user={{ id: "test", display_name: "Test", primary_campus_id: "omiya" }}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /2099-01-03/ }));
    await screen.findByRole("dialog", { name: /詳細/ });
    expect(screen.getByRole("button", { name: "削除" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "編集" })).toBeNull();
  });
  it("absorbs backdrop pointer/click, keeps inner clicks open, and closes by X/Escape with focus return", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        const url = String(path);
        const day = {
          date: "2027-01-03",
          kind: "weekend",
          reason: null,
          entry_default: "clock",
          participant_count: 0,
          schedule_count: 0,
          has_restriction: false,
          source: "weekend",
        };
        const data = url.startsWith("/api/calendar/day")
          ? { day, schedules: [], restrictions: [] }
          : url.startsWith("/api/calendar?")
            ? [day]
            : url.includes("display-preferences")
              ? { week_start: "sunday" }
              : { permissions: [] };
        return { ok: true, json: async () => ({ data }) };
      }),
    );
    const { container } = render(
      <CalendarApp
        user={{ id: "test", display_name: "Test", primary_campus_id: "omiya" }}
      />,
    );
    const date = await screen.findByRole("button", { name: /2027-01-03/ });
    date.focus();
    fireEvent.click(date);
    const dialog = await screen.findByRole("dialog", { name: /詳細/ });
    fireEvent.click(dialog);
    expect(screen.getByRole("dialog", { name: /詳細/ })).toBeTruthy();
    const backdrop = container.querySelector(".detail-backdrop")!;
    const escapedClick = vi.fn();
    document.addEventListener("click", escapedClick);
    fireEvent.pointerDown(backdrop);
    fireEvent.pointerUp(backdrop);
    expect(screen.getByRole("dialog", { name: /詳細/ })).toBeTruthy();
    fireEvent.click(backdrop);
    expect(escapedClick).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: /詳細/ })).toBeNull();
    expect(document.activeElement).toBe(date);
    expect(container.querySelector(".dismiss-shield")).toBeTruthy();
    fireEvent.click(container.querySelector(".dismiss-shield")!);
    expect(escapedClick).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: /詳細/ })).toBeNull();
    await waitFor(() =>
      expect(container.querySelector(".dismiss-shield")).toBeNull(),
    );
    fireEvent.click(date);
    await screen.findByRole("dialog", { name: /詳細/ });
    fireEvent.click(screen.getByRole("button", { name: "詳細を閉じる" }));
    expect(screen.queryByRole("dialog", { name: /詳細/ })).toBeNull();
    expect(document.activeElement).toBe(date);
    document.removeEventListener("click", escapedClick);
    await waitFor(() =>
      expect(container.querySelector(".dismiss-shield")).toBeNull(),
    );
    fireEvent.click(date);
    await screen.findByRole("dialog", { name: /詳細/ });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /詳細/ })).toBeNull();
    expect(document.activeElement).toBe(date);
  });
});
