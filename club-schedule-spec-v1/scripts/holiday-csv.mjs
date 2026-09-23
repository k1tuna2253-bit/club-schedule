export const SOURCE = "https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv";

export function parseHolidayCsv(bytes) {
  // The Cabinet Office currently publishes this CSV as Shift_JIS.
  const csv = new TextDecoder("shift_jis", { fatal: true }).decode(bytes);
  const lines = csv.replace(/\r\n/g, "\n").trim().split("\n");
  if (lines.shift() !== "国民の祝日・休日月日,国民の祝日・休日名称")
    throw new Error("Unexpected Cabinet Office CSV header or encoding");
  const holidays = [];
  const seen = new Set();
  for (const line of lines) {
    const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2}),([^,\r\n]+)$/.exec(line);
    if (!match) throw new Error("Invalid holiday CSV row");
    const date = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date ||
      seen.has(date)
    )
      throw new Error("Invalid or duplicate holiday date");
    seen.add(date);
    holidays.push({ date, name: match[4] });
  }
  if (
    holidays.length < 100 ||
    holidays.some(
      (item, index) => index > 0 && holidays[index - 1].date >= item.date,
    )
  )
    throw new Error("Holiday CSV is incomplete or unordered");
  const years = new Map();
  for (const item of holidays)
    years.set(
      Number(item.date.slice(0, 4)),
      (years.get(Number(item.date.slice(0, 4))) ?? 0) + 1,
    );
  for (
    let year = Math.min(...years.keys());
    year <= Math.max(...years.keys());
    year++
  )
    if (!years.has(year)) throw new Error("Holiday CSV has a missing year");
  // Reject an apparently truncated current-era year before marking it covered.
  for (const [year, count] of years)
    if (year >= 2020 && count < 16)
      throw new Error(`Holiday CSV has too few rows for ${year}`);
  return { holidays, years };
}

export function holidaySql(data, importedAt) {
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const years = [...data.years.keys()];
  const statements = ["BEGIN TRANSACTION;"];
  for (const year of years) {
    statements.push(
      `DELETE FROM japanese_holidays WHERE date >= '${year}-01-01' AND date <= '${year}-12-31';`,
    );
    statements.push(`DELETE FROM holiday_import_years WHERE year = ${year};`);
  }
  for (const item of data.holidays)
    statements.push(
      `INSERT INTO japanese_holidays (date, name, source_url, imported_at) VALUES (${quote(item.date)}, ${quote(item.name)}, ${quote(SOURCE)}, ${quote(importedAt)});`,
    );
  for (const [year, count] of data.years)
    statements.push(
      `INSERT INTO holiday_import_years (year, imported_at, source_url, row_count) VALUES (${year}, ${quote(importedAt)}, ${quote(SOURCE)}, ${count});`,
    );
  statements.push("COMMIT;");
  return statements.join("\n") + "\n";
}
