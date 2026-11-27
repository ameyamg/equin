import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "ids:pk-declared",
    paths: ["server/internal/tables.ts"],
    kind: "debt",
    task: "task-1791405297096-jyzsmk",
    reason:
      "Phase-1 baseline of the unified prefixed ids: this table's `id` primary key names no id kind yet. Declare the kind (`defineIdKind`) and key the table with `idColumn` / `idKindField` (or `externalIdColumn` for an id minted elsewhere) in its migration phase, then delete this entry.",
  },
  {
    rule: "date-format/no-raw-date-format",
    paths: ["core/progress.ts"],
    kind: "sanctioned",
    reason:
      "Not display: constructing an Intl.DateTimeFormat is how a time zone name is validated (it throws RangeError on an unknown zone); nothing is formatted.",
  },
] satisfies Exemptions;
