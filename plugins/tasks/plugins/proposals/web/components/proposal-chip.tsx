import type { ReactNode } from "react";
import { Badge } from "@plugins/primitives/plugins/css/plugins/badge/web";
import { PROPOSAL_STATE_META, type ProposalRow } from "../../core";

/**
 * The chip an owner's row wears while one of its records has a proposal the
 * user may answer: "Proposed" (v2+: "Proposed · v2"), or "Changes requested".
 */
export function ProposalChip({
  proposal,
}: {
  proposal: Pick<ProposalRow, "state" | "revision">;
}): ReactNode {
  const meta = PROPOSAL_STATE_META[proposal.state];
  return (
    <Badge variant={meta.variant}>
      {proposal.revision > 1 && proposal.state === "open"
        ? `${meta.label} · v${proposal.revision}`
        : meta.label}
    </Badge>
  );
}
