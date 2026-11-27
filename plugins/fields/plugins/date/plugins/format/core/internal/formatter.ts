import type { DateFormatPrefs } from "./config";

export interface TimeOptions {
  /** Show seconds ("23:17:05"). */
  readonly seconds?: boolean;
  /** Show this many fractional-second digits (implies seconds). */
  readonly fractionalSeconds?: 1 | 2 | 3;
  /** Append the zone's short name ("23:17 UTC"). */
  readonly zoneName?: boolean;
  /** Read the instant in this IANA zone (default: the viewer's). */
  readonly timeZone?: string;
}

export interface DateOptions {
  readonly weekday?: "short" | "long";
  /** How the month is spelled (default "short": "Nov"). */
  readonly month?: "short" | "long";
  /** Show the day of the month (default true). `false` names the month alone: "Nov 2026". */
  readonly day?: boolean;
  /**
   * When the year is written (default "auto": only when it is not the year of
   * `now` — the one case where it carries information).
   */
  readonly year?: "auto" | "always" | "never";
  /** The instant `year: "auto"` compares against (default: now). */
  readonly now?: Date;
  readonly timeZone?: string;
}

export interface NumericOptions {
  /** Append the time ("2026-11-27 23:17"). */
  readonly time?: boolean;
  readonly seconds?: boolean;
  readonly timeZone?: string;
}

/**
 * How the app writes a date or a time. Its options name WHAT to show, never
 * how: there is no locale, hour12 or hourCycle to pass, so no surface can
 * write a time in a clock the user did not choose.
 */
export interface DateFormatter {
  readonly prefs: DateFormatPrefs;
  /** "23:17" / "11:17 PM". */
  time(at: Date | number, opts?: TimeOptions): string;
  /** A date with a month name, in the user's date order: "Nov 27" / "27 Nov". */
  date(at: Date | number, opts?: DateOptions): string;
  /** Both: "Nov 27, 23:17" / "27 Nov, 23:17". */
  dateTime(at: Date | number, opts?: DateOptions & TimeOptions): string;
  /** The weekday alone: "Thu" / "Thursday". */
  weekday(
    at: Date | number,
    style?: "short" | "long",
    timeZone?: string,
  ): string;
  /** An all-digit date: "2026-11-27" / "11/27/2026" / "27/11/2026", optionally with the time. */
  numeric(at: Date | number, opts?: NumericOptions): string;
}

type Locale = string | undefined;

const ORDER_LOCALE: Record<"mdy" | "dmy", string> = {
  mdy: "en-US",
  dmy: "en-GB",
};

/** The browser's own hour cycle, so "Browser default" stays the browser's even under a chosen date order. */
function browserHourCycle(): "h11" | "h12" | "h23" | "h24" {
  const cycle = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
  }).resolvedOptions().hourCycle;
  // An engine that resolves no cycle formats as its locale does: say h23 only
  // when it really is a 24-hour locale (hour12 resolved false).
  if (cycle !== undefined) return cycle;
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
  }).resolvedOptions().hour12 === false
    ? "h23"
    : "h12";
}

function toDate(at: Date | number): Date {
  return typeof at === "number" ? new Date(at) : at;
}

function yearIn(d: Date, timeZone: string | undefined): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone }).format(d),
  );
}

/** A formatter bound to one set of prefs. Every Intl formatter it needs is built once. */
export function createDateFormatter(prefs: DateFormatPrefs): DateFormatter {
  const dateLocale: Locale =
    prefs.dateOrder === "browser" ? undefined : ORDER_LOCALE[prefs.dateOrder];
  const hourCycle =
    prefs.clock === "browser" ? browserHourCycle() : prefs.clock;
  const numericLocale: Locale =
    prefs.numericDate === "browser" || prefs.numericDate === "ymd"
      ? undefined
      : ORDER_LOCALE[prefs.numericDate];

  const cache = new Map<string, Intl.DateTimeFormat>();
  const fmt = (locale: Locale, o: Intl.DateTimeFormatOptions) => {
    const key = `${locale ?? ""}|${JSON.stringify(o)}`;
    let f = cache.get(key);
    if (f === undefined) {
      f = new Intl.DateTimeFormat(locale, o);
      cache.set(key, f);
    }
    return f;
  };

  const timeParts = (o: TimeOptions): Intl.DateTimeFormatOptions => ({
    hour: hourCycle === "h23" || hourCycle === "h24" ? "2-digit" : "numeric",
    minute: "2-digit",
    ...(o.seconds || o.fractionalSeconds ? { second: "2-digit" } : {}),
    ...(o.fractionalSeconds
      ? { fractionalSecondDigits: o.fractionalSeconds }
      : {}),
    ...(o.zoneName ? { timeZoneName: "short" } : {}),
    hourCycle,
    timeZone: o.timeZone,
  });

  const dateParts = (d: Date, o: DateOptions): Intl.DateTimeFormatOptions => {
    const year = o.year ?? "auto";
    const showYear =
      year === "always" ||
      (year === "auto" &&
        yearIn(d, o.timeZone) !== yearIn(o.now ?? new Date(), o.timeZone));
    return {
      ...(o.weekday ? { weekday: o.weekday } : {}),
      month: o.month ?? "short",
      ...(o.day === false ? {} : { day: "numeric" }),
      ...(showYear ? { year: "numeric" } : {}),
      timeZone: o.timeZone,
    };
  };

  const numericDate = (d: Date, timeZone: string | undefined): string => {
    if (prefs.numericDate !== "ymd") {
      return fmt(numericLocale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone,
      }).format(d);
    }
    const parts = fmt("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    }).formatToParts(d);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  };

  return {
    prefs,
    time: (at, o = {}) => fmt(dateLocale, timeParts(o)).format(toDate(at)),
    date: (at, o = {}) => {
      const d = toDate(at);
      return fmt(dateLocale, dateParts(d, o)).format(d);
    },
    dateTime: (at, o = {}) => {
      const d = toDate(at);
      return fmt(dateLocale, { ...dateParts(d, o), ...timeParts(o) }).format(d);
    },
    weekday: (at, style = "short", timeZone) =>
      fmt(dateLocale, { weekday: style, timeZone }).format(toDate(at)),
    numeric: (at, o = {}) => {
      const d = toDate(at);
      const date = numericDate(d, o.timeZone);
      if (!o.time) return date;
      const time = fmt(dateLocale, timeParts(o)).format(d);
      return `${date} ${time}`;
    },
  };
}
