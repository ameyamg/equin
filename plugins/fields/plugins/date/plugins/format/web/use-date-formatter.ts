import { useConfig } from "@plugins/config_v2/web";
import { dateFormatConfig, formatterFor, type DateFormatter } from "../core";

/**
 * The user's date formatter, live: a change to Clock, Date order or Numeric
 * dates re-renders every reader. The settings ride the boot snapshot, so the
 * first paint already formats with them; `useConfig`'s defaults stand in only
 * in the unreachable not-yet-known window — a date's spelling claims nothing
 * about the user's data.
 */
export function useDateFormatter(): DateFormatter {
  return formatterFor(useConfig(dateFormatConfig));
}
