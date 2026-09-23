export type WeekStart = "sunday" | "monday";

export const addCalendarDays = (date: string, delta: number) => {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + delta);
  return day.toISOString().slice(0, 10);
};

export const startOfWeek = (date: string, preference: WeekStart) => {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addCalendarDays(
    date,
    -(weekday - (preference === "monday" ? 1 : 0) + 7) % 7,
  );
};

export const weekdayValues = (preference: WeekStart) =>
  preference === "monday" ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];

export const weekdayLabels = (preference: WeekStart) =>
  weekdayValues(preference).map(
    (value) => ["日", "月", "火", "水", "木", "金", "土"][value],
  );
