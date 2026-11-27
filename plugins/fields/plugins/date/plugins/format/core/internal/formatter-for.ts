import { createDateFormatter, type DateFormatter } from "./formatter";
import { prefsOf } from "./config";

const byPrefs = new Map<string, DateFormatter>();

/**
 * The formatter for these stored values — one per distinct prefs, so a caller
 * re-reading the same settings gets the same object (a stable identity for
 * memoized rows) and its built Intl formatters.
 */
export function formatterFor(values: {
  clock: string;
  dateOrder: string;
  numericDate: string;
}): DateFormatter {
  const prefs = prefsOf(values);
  const key = `${prefs.clock}|${prefs.dateOrder}|${prefs.numericDate}`;
  let f = byPrefs.get(key);
  if (f === undefined) {
    f = createDateFormatter(prefs);
    byPrefs.set(key, f);
  }
  return f;
}
