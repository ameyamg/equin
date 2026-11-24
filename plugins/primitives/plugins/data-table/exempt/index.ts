import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "react-compiler:no-silent-skips",
    paths: ["web/internal/data-table.tsx"],
    kind: "debt",
    task: "task-1795087496-4w8ni5",
    reason:
      "Left uncompiled by the React Compiler — DataTable (passes a hook around as a value), DataTableRow (calls a hook carried as a value).",
  },
  {
    rule: "line/no-raw-single-line-provider",
    paths: ["web/internal/data-table.tsx"],
    kind: "sanctioned",
    reason:
      "DataTable's cells are line containers it implements: the row provides the single-line contract to every cell (the trailing actions keep their flow layout).",
  },
] satisfies Exemptions;
