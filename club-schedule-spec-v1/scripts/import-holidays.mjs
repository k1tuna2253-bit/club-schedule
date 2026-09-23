import { mkdir, writeFile } from "node:fs/promises";
import { SOURCE, parseHolidayCsv, holidaySql } from "./holiday-csv.mjs";

const response = await fetch(SOURCE, { signal: AbortSignal.timeout(15_000) });
if (!response.ok)
  throw new Error(`Cabinet Office fetch failed: ${response.status}`);
const bytes = new Uint8Array(await response.arrayBuffer());
if (bytes.length > 1_000_000)
  throw new Error("Holiday CSV is unexpectedly large");
const parsed = parseHolidayCsv(bytes);
const path = ".wrangler/holiday-import.sql";
await mkdir(".wrangler", { recursive: true });
await writeFile(path, holidaySql(parsed, new Date().toISOString()), {
  flag: "w",
});
console.log(
  `Validated ${parsed.holidays.length} official holiday rows; wrote ${path}.`,
);
console.log(
  "Review the source and apply only to the intended D1 database with Wrangler.",
);
