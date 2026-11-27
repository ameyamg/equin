import { defineConfig } from "@plugins/config_v2/core";
import { enumField } from "@plugins/fields/plugins/enum/plugins/config/core";
import { z } from "zod";

/**
 * The three settings every displayed date and time follows. Separate on
 * purpose: the clock (12 / 24 hour), the order of a date spelled with a month
 * name ("Nov 27, 2026" / "27 Nov 2026") and the form of an all-digit date
 * (2026-11-27 / 11/27/2026 / 27/11/2026) are independent conventions — a
 * person can want US month-first dates and a 24-hour clock.
 */
export const dateFormatConfig = defineConfig({
  name: "date-format",
  fields: {
    clock: enumField({
      default: "browser",
      options: [
        { value: "browser", label: "Browser default" },
        { value: "h12", label: "12-hour (11:17 PM)" },
        { value: "h23", label: "24-hour (23:17)" },
      ],
      label: "Clock",
      description: "How every time in the app is written.",
    }),
    dateOrder: enumField({
      default: "browser",
      options: [
        { value: "browser", label: "Browser default" },
        { value: "mdy", label: "Month first (Nov 27, 2026)" },
        { value: "dmy", label: "Day first (27 Nov 2026)" },
      ],
      label: "Date order",
      description: "The order of a date written with a month name.",
    }),
    numericDate: enumField({
      default: "ymd",
      options: [
        { value: "ymd", label: "Year first (2026-11-27)" },
        { value: "browser", label: "Browser default" },
        { value: "mdy", label: "Month first (11/27/2026)" },
        { value: "dmy", label: "Day first (27/11/2026)" },
      ],
      label: "Numeric dates",
      description: "How a date written all in digits looks.",
    }),
  },
});

const prefsSchema = z.object({
  clock: z.enum(["browser", "h12", "h23"]),
  dateOrder: z.enum(["browser", "mdy", "dmy"]),
  numericDate: z.enum(["ymd", "browser", "mdy", "dmy"]),
});

/** The three settings, narrowed to their closed unions. */
export type DateFormatPrefs = z.infer<typeof prefsSchema>;

/** The defaults, for a formatter no setting reached (tests, a pure tool). */
export const DEFAULT_DATE_FORMAT_PREFS: DateFormatPrefs = {
  clock: "browser",
  dateOrder: "browser",
  numericDate: "ymd",
};

/**
 * The stored values as prefs. An enum field reads back as a plain string; its
 * schema admits only the declared options, so anything else is a broken
 * invariant and throws rather than format with a guess.
 */
export function prefsOf(values: {
  clock: string;
  dateOrder: string;
  numericDate: string;
}): DateFormatPrefs {
  return prefsSchema.parse(values);
}
