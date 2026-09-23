import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  holidaySql,
  parseHolidayCsv,
  SOURCE,
} from "../scripts/holiday-csv.mjs";

describe("Cabinet Office holiday import", () => {
  it("rejects unexpected CSV formats and invalid Shift_JIS", () => {
    expect(() =>
      parseHolidayCsv(new TextEncoder().encode("date,name\n2026/1/1,New Year")),
    ).toThrow();
    expect(() => parseHolidayCsv(new Uint8Array([0x82]))).toThrow();
  });

  it("replaces only validated coverage years in a transaction", () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(
        "CREATE TABLE japanese_holidays (date TEXT PRIMARY KEY,name TEXT,source_url TEXT,imported_at TEXT); CREATE TABLE holiday_import_years (year INTEGER PRIMARY KEY,imported_at TEXT,source_url TEXT,row_count INTEGER);",
      );
      sqlite.exec(
        "INSERT INTO japanese_holidays VALUES ('2025-01-01','old','old','old'),('2026-01-01','stale','old','old'); INSERT INTO holiday_import_years VALUES (2025,'old','old',1),(2026,'old','old',1);",
      );
      const data = {
        holidays: [{ date: "2026-01-01", name: "元日" }],
        years: new Map([[2026, 1]]),
      };
      sqlite.exec(holidaySql(data, "2026-09-19T00:00:00.000Z"));
      expect(
        sqlite
          .prepare("SELECT name FROM japanese_holidays WHERE date='2025-01-01'")
          .get(),
      ).toEqual({ name: "old" });
      expect(
        sqlite
          .prepare(
            "SELECT name,source_url FROM japanese_holidays WHERE date='2026-01-01'",
          )
          .get(),
      ).toEqual({ name: "元日", source_url: SOURCE });
      expect(
        sqlite
          .prepare("SELECT row_count FROM holiday_import_years WHERE year=2026")
          .get(),
      ).toEqual({ row_count: 1 });
    } finally {
      sqlite.close();
    }
  });
});
