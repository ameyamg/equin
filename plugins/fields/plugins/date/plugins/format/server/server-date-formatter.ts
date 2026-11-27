import { getConfig } from "@plugins/config_v2/server";
import { dateFormatConfig, formatterFor, type DateFormatter } from "../core";

/** The user's date formatter on the server, read from the current config. */
export function serverDateFormatter(): DateFormatter {
  return formatterFor(getConfig(dateFormatConfig));
}
