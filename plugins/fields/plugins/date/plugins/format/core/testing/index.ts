// A formatter of chosen settings, for a test that pins a date's spelling.
// The app never builds one from defaults: the browser reads the user's settings
// (`useDateFormatter`) and the server its own (`serverDateFormatter`).
export { DEFAULT_DATE_FORMAT_PREFS } from "../internal/config";
export { createDateFormatter } from "../internal/formatter";
