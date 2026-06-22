export type MarketSession =
  | "premarket"
  | "regular"
  | "after_hours"
  | "overnight"
  | "weekend"
  | "holiday";

/** NYSE full-day closures (America/New_York calendar dates). */
const NYSE_HOLIDAYS = new Set([
  "2025-01-01",
  "2025-01-20",
  "2025-02-17",
  "2025-04-18",
  "2025-05-26",
  "2025-06-19",
  "2025-07-04",
  "2025-09-01",
  "2025-11-27",
  "2025-12-25",
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
]);

interface EasternParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
  dateKey: string;
}

function easternParts(date: Date): EasternParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });

  const parts = formatter.formatToParts(date);
  const lookup = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const year = Number(lookup.year);
  const month = Number(lookup.month);
  const day = Number(lookup.day);
  const hour = Number(lookup.hour);
  const minute = Number(lookup.minute);
  const weekday = weekdayMap[lookup.weekday ?? "Mon"] ?? 1;

  return {
    year,
    month,
    day,
    weekday,
    hour,
    minute,
    dateKey: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

export function getEasternDateKey(date: Date): string {
  return easternParts(date).dateKey;
}

export function isNyseHoliday(date: Date): boolean {
  return NYSE_HOLIDAYS.has(getEasternDateKey(date));
}

export function detectMarketSession(now = new Date()): MarketSession {
  const et = easternParts(now);

  if (et.weekday === 0 || et.weekday === 6) {
    return "weekend";
  }
  if (NYSE_HOLIDAYS.has(et.dateKey)) {
    return "holiday";
  }

  const minutes = et.hour * 60 + et.minute;

  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) {
    return "premarket";
  }
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) {
    return "regular";
  }
  if (minutes >= 16 * 60 && minutes < 20 * 60) {
    return "after_hours";
  }

  return "overnight";
}

export function previousTradingDateKey(fromDateKey: string): string {
  let cursor = new Date(`${fromDateKey}T12:00:00Z`);
  for (let attempts = 0; attempts < 10; attempts += 1) {
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
    const key = getEasternDateKey(cursor);
    const et = easternParts(cursor);
    if (et.weekday === 0 || et.weekday === 6) {
      continue;
    }
    if (NYSE_HOLIDAYS.has(key)) {
      continue;
    }
    return key;
  }
  return fromDateKey;
}

export function isSameEasternDay(a: Date, b: Date): boolean {
  return getEasternDateKey(a) === getEasternDateKey(b);
}

/** Convert a wall-clock time in America/New_York on dateKey to UTC. */
export function easternWallTimeToUtc(
  dateKey: string,
  hour: number,
  minute: number,
): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  for (const offsetHours of [4, 5]) {
    const utc = new Date(Date.UTC(year, month - 1, day, hour + offsetHours, minute));
    const et = easternParts(utc);
    if (et.dateKey === dateKey && et.hour === hour && et.minute === minute) {
      return utc;
    }
  }
  return new Date(Date.UTC(year, month - 1, day, hour + 5, minute));
}

export function sessionAtTimestamp(timestamp: Date): MarketSession {
  return detectMarketSession(timestamp);
}
