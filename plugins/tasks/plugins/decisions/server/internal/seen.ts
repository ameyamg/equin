import { eq, sql } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { HttpError, implement } from "@plugins/infra/plugins/endpoints/server";
import { decisionIdKind, markDecisionSeenEndpoint } from "../../core";
import { _decisions } from "./tables";

/**
 * The user opened a decision: `seen_at = now()`. Not a version (what the
 * decision says did not move) and not `updated_at` (derived, `seenAt: false`).
 */
export const handleMarkDecisionSeen = implement(
  markDecisionSeenEndpoint,
  async ({ params }) => {
    if (!decisionIdKind.is(params.decisionId)) {
      throw new HttpError(400, `"${params.decisionId}" is not a decision id.`);
    }
    const rows = await db
      .update(_decisions)
      .set({ seenAt: sql`now()` })
      .where(eq(_decisions.id, params.decisionId))
      .returning({ id: _decisions.id });
    if (rows.length === 0) {
      throw new HttpError(404, `No decision "${params.decisionId}".`);
    }
  },
);
