import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "date-format/no-raw-date-format",
    paths: ["core/internal/wall-clock.ts"],
    kind: "sanctioned",
    reason:
      "Zone arithmetic: formatToParts in a fixed en-US locale reads an instant's wall-clock fields in an IANA zone to convert between wall time and UTC. It formats nothing for display.",
  },
] satisfies Exemptions;
