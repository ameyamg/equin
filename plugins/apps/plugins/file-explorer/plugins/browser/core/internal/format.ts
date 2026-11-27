import type { DateFormatter } from "@plugins/fields/plugins/date/plugins/format/core";

/**
 * A byte count the way a file browser shows it: decimal units (1 KB = 1000 B,
 * as Finder counts), one decimal below ten of a unit.
 */
export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unit: (typeof units)[number] = "KB";
  for (const u of units) {
    value /= 1000;
    unit = u;
    if (value < 1000) break;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit}`;
}

/** "1 item" / "N items". */
export function formatCount(n: number, noun = "item"): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * A modification time, short: the time of day for today ("1:05 PM" — a bare
 * "Today" leaves a folder's recent files indistinguishable), "Yesterday",
 * "Sep 28", or "Sep 28, 2024" outside the current year — local calendar days,
 * not 24-hour spans.
 */
export function formatModified(
  ms: number,
  now: number,
  fmt: DateFormatter,
): string {
  const today = startOfDay(now);
  const day = startOfDay(ms);
  if (day === today) return fmt.time(ms);
  if (day === startOfDay(today - DAY_MS / 2)) return "Yesterday";
  return fmt.date(ms, { now: new Date(now) });
}

/** A modification time in full, for a tooltip or a header. */
export function formatModifiedFull(ms: number, fmt: DateFormatter): string {
  return fmt.dateTime(ms, { year: "always" });
}
