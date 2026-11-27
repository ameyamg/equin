import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "date-format/no-raw-date-format",
    paths: ["core/internal/formatter.ts"],
    kind: "sanctioned",
    reason:
      "The DateFormatter itself: the one place a date is handed to Intl, with the locale and hour cycle the user's settings resolve to.",
  },
] satisfies Exemptions;
