import { ReportKind } from "@plugins/reports/server";
import type { ReportRow } from "@plugins/reports/server";
import {
  PublicPathReportSchema,
  describePublicPathReport,
  renderPublicPathReportBody,
  type PublicPathReport,
} from "../../shared/public-path-report";

// The `site-public-path` report kind: one row per deployment (the fingerprint
// names it — the row's own `worktree` is always main, where the probe runs),
// filed once per outage by the public-path probe, so `count` is the number
// of outages. An error: visitors cannot reach the site.
export const publicPathReportKind = ReportKind({
  kind: "site-public-path",
  schema: PublicPathReportSchema,
  fingerprint: (d: PublicPathReport) => `site-public-path:${d.deploymentId}`,
  meta: {
    tag: "[site-down]",
    notif: "A deployed site is unreachable from the internet",
    variant: "error",
    category: "error",
  },
  renderTask: (row: ReportRow) => {
    const d = PublicPathReportSchema.parse(row.data);
    return {
      title: `[site-down] ${describePublicPathReport(d)}`,
      description: renderPublicPathReportBody(d, row),
    };
  },
});
