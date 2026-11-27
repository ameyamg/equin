import { eventDateZone } from "@plugins/apps/plugins/events/plugins/event-date/core";
import { canParseUrl } from "@plugins/packages/plugins/floor-compat/core";
import type { DateFormatter } from "@plugins/fields/plugins/date/plugins/format/core";
// Pure display formatters for an event row. Dates and times go through the
// user's DateFormatter, so a test pins its output by the prefs it builds the
// formatter with. A timed event reads in the viewer's zone; an all-day event
// reads its own calendar date (see `eventDateZone`).

/**
 * When an event happens, as a person reads it: `Thu 14 Aug`, `Thu 14 Aug ·
 * 21:00`, or `Sat, 2 Jan 2027` once the year differs from `now`'s (in the
 * user's date order and clock).
 *
 * Absolute, NOT relative ("in 3d"): an events list is mostly forward-looking and
 * the weekday is load-bearing information — "Thu" is what decides whether you go.
 */
export function formatEventWhen(
  startsAt: Date,
  allDay: boolean,
  fmt: DateFormatter,
  now: Date = new Date(),
): string {
  if (Number.isNaN(startsAt.getTime())) return "";
  const day = fmt.date(startsAt, {
    weekday: "short",
    now,
    timeZone: eventDateZone(allDay),
  });
  if (allDay) return day;
  return `${day} · ${fmt.time(startsAt)}`;
}

/** `Venue · City`, either alone, or `null` when the event says neither. */
export function formatPlace(
  venue: string | null,
  city: string | null,
): string | null {
  const parts = [venue, city].filter(
    (p): p is string => !!p && p.trim() !== "",
  );
  return parts.length === 0 ? null : parts.join(" · ");
}

/**
 * A URL's host, without `www.`, for a compact link chip. Returns `null` for a
 * value the URL parser rejects — the caller then renders no chip rather than a
 * broken link.
 */
export function urlHost(raw: string): string | null {
  if (!canParseUrl(raw)) return null;
  return new URL(raw).host.replace(/^www\./, "");
}
