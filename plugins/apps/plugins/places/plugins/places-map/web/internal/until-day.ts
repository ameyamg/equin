import type { DateFormatter } from "@plugins/fields/plugins/date/plugins/format/core";

/** "Ratings paused until Nov 1" — the date a budget downgrade lifts. */
export function untilDay(iso: string, fmt: DateFormatter): string {
  return fmt.date(new Date(iso), { year: "never" });
}
