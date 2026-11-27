import type { Report } from "@plugins/reports/core";
import { Badge } from "@plugins/primitives/plugins/css/plugins/badge/web";
import { Cluster } from "@plugins/primitives/plugins/css/plugins/cluster/web";
import {
  WebsiteVisitorErrorSchema,
  visitorLateDeliveryLabel,
  websiteVisitorErrorSummary,
  websiteVisitorSplitSummary,
} from "../../core";

/**
 * One-line summary for Debug → Reports: a "Website visitors" badge, then the
 * site, page and error as plain text — and, when its last sighting reached
 * this computer hours or days after it happened, how late (history, not a
 * live incident). Every value is a React text node —
 * never markup, never a link: the content was written by strangers' browsers.
 */
export function WebsiteVisitorSummary({ report }: { report: Report }) {
  const parsed = WebsiteVisitorErrorSchema.safeParse(report.data);
  const late = parsed.success ? visitorLateDeliveryLabel(parsed.data) : null;
  return (
    <Cluster gap="sm">
      <Badge variant="warning">Website visitors</Badge>
      {parsed.success && parsed.data.codeOrigin === "foreign" && (
        <Badge variant="muted">Not our code</Badge>
      )}
      {late !== null && <Badge variant="muted">{late}</Badge>}
      <span>
        {parsed.success
          ? [
              websiteVisitorErrorSummary(parsed.data),
              `${parsed.data.siteCount.toLocaleString("en-US")}× on the site`,
              websiteVisitorSplitSummary(parsed.data),
            ]
              .filter((part) => part !== null)
              .join(" · ")
          : report.message}
      </span>
    </Cluster>
  );
}
