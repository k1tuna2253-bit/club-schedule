// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { CalendarApp } from "../src/CalendarApp";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("schedule form conflict flow", () => {
  it("sends both rapidly selected periods and requires an explicit continue action", async () => {
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        const url = String(path);
        const day = {
          date: "2099-01-03",
          kind: "weekday",
          reason: null,
          entry_default: "period",
          participant_count: 0,
          schedule_count: 0,
          has_restriction: false,
          source: "weekday",
        };
        if (url === "/api/schedules" && init?.method === "POST") {
          sent.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return {
            ok: false,
            status: 409,
            json: async () => ({
              error: {
                code: "SCHEDULE_CONFLICT",
                message: "時間が重なります。",
                details: { conflicts: [{ provisional: false }] },
              },
            }),
          };
        }
        const data = url.startsWith("/api/calendar/day")
          ? { day, schedules: [], restrictions: [] }
          : url.startsWith("/api/calendar?")
            ? [day]
            : url.startsWith("/api/locations")
              ? []
              : url.startsWith("/api/class-periods")
                ? url.includes("campus_id=omiya")
                  ? [1, 2, 3, 4, 5, 6].map((number) => ({
                      id: String(number),
                      campus_id: "omiya",
                      period_number: number,
                      start_time: "09:10",
                      end_time: "10:50",
                      effective_from: "2020-01-01",
                    }))
                  : []
                : url.includes("display-preferences")
                  ? { week_start: "sunday" }
                  : { permissions: ["SCHEDULE_CREATE_SELF"] };
        return { ok: true, status: 200, json: async () => ({ data }) };
      }),
    );
    render(
      <CalendarApp
        user={{
          id: "owner",
          display_name: "Owner",
          primary_campus_id: "omiya",
        }}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "予定を登録" }));
    fireEvent.click(
      await screen.findByRole("button", { name: /参加する時限未選択/ }),
    );
    await screen.findByRole("menuitemcheckbox", { name: /1限/ });
    const options = screen.getAllByRole("menuitemcheckbox");
    act(() => {
      fireEvent.click(options[0]);
      fireEvent.click(options[2]);
    });
    expect(
      screen.getByRole("button", { name: /参加する時限1限、3限/ }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].periods).toEqual([
      { campus_id: "omiya", period_number: 1 },
      { campus_id: "omiya", period_number: 3 },
    ]);
    expect(sent[0].continue_conflict).toBe(false);
    expect(
      await screen.findByRole("button", { name: "戻って修正" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "このまま登録" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].continue_conflict).toBe(true);
  });
});
