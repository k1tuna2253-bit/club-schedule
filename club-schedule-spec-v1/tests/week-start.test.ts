import { describe, expect, it } from "vitest";
import { addCalendarDays, startOfWeek, weekdayLabels } from "../src/week-start";

describe("personal week start", () => {
  it("aligns a week and month grid to the same setting across year boundaries", () => {
    expect(startOfWeek("2027-01-01", "sunday")).toBe("2026-12-27");
    expect(startOfWeek("2027-01-01", "monday")).toBe("2026-12-28");
    expect(startOfWeek("2027-01-31", "sunday")).toBe("2027-01-31");
    expect(startOfWeek("2027-01-31", "monday")).toBe("2027-01-25");
    expect(addCalendarDays(startOfWeek("2027-01-01", "sunday"), 7)).toBe(
      "2027-01-03",
    );
    expect(weekdayLabels("sunday")[0]).toBe("日");
    expect(weekdayLabels("monday")[0]).toBe("月");
  });
});
