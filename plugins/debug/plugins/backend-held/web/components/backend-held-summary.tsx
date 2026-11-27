import type { Report } from "@plugins/reports/core";
import { Inline } from "@plugins/primitives/plugins/css/plugins/inline/web";
import { Badge } from "@plugins/primitives/plugins/css/plugins/badge/web";
import { BackendHeldPayloadSchema, formatHeldDuration } from "../../core";

// One-line summary for Debug → Reports, e.g. "silent websocket GET
// /ws/notifications promo-film.x · held 5.0 h".
export function BackendHeldSummary({ report }: { report: Report }) {
  const parsed = BackendHeldPayloadSchema.safeParse(report.data);
  if (!parsed.success) return <>{report.message}</>;
  const d = parsed.data;
  const c = d.connection;
  return (
    <Inline gap="xs">
      <Badge variant="warning" mono>
        {d.reason}
      </Badge>
      <span className="text-muted-foreground">{c.kind}</span>
      <span>
        {c.method} {c.path}
      </span>
      <span className="text-muted-foreground">
        {d.worktree} · held{" "}
        {formatHeldDuration(d.detectedAt - d.lastActivityAt)}
      </span>
    </Inline>
  );
}
