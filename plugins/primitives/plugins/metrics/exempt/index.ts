import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "date-format/no-raw-date-format",
    paths: ["core/intervals.ts"],
    kind: "sanctioned",
    reason:
      "Bucket math: isTimeZone validates an IANA zone by constructing a formatter. The bucket labels (short / label) are display and still written in en-US here: they are computed on the server by resolveRange and served inside the metric result, so following the user's date settings means moving the labels to the web (from each bucket's start) rather than threading a formatter through the engine.",
  },
] satisfies Exemptions;
