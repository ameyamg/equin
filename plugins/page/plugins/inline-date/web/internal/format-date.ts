import type { DateFormatter } from "@plugins/fields/plugins/date/plugins/format/core";

// Shared formatting for date/reminder mentions, in the user's date settings.
// The token stores a UTC ISO instant; these render it in the viewer's local
// time. Year is dropped when it matches the current year to keep inline chips
// compact.

/** Compact day label, e.g. "Wed, Jun 17" (current year) or "Thu, Jun 17, 2027". */
export function formatDay(date: Date, fmt: DateFormatter): string {
  return fmt.date(date, { weekday: "short" });
}

/** Time-of-day label, e.g. "9:00 AM" / "09:00". */
export function formatTime(date: Date, fmt: DateFormatter): string {
  return fmt.time(date);
}

/** Chip / option label: day for a date, day + time for a reminder. */
export function formatMention(
  date: Date,
  isReminder: boolean,
  fmt: DateFormatter,
): string {
  return isReminder
    ? `${formatDay(date, fmt)} · ${formatTime(date, fmt)}`
    : formatDay(date, fmt);
}
