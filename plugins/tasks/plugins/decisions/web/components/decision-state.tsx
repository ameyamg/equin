import type { ReactElement } from "react";
import { StatusDot } from "@plugins/primitives/plugins/css/plugins/status-dot/web";

/** The "new since you last looked" dot. */
export function NewMark(): ReactElement {
  return (
    <span title="New since you last looked" aria-label="New">
      <StatusDot colorClass="bg-info" />
    </span>
  );
}
