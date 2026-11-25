import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { Mcp } from "@plugins/infra/plugins/mcp/server";
import { granted } from "@plugins/tasks/plugins/orchestration/plugins/mandate/server";
import { reportRequired } from "@plugins/tasks/plugins/outcome-report/plugins/capability/core";
import { TURN_ADDRESSEES } from "../../core";
import { _turnAddressees } from "../../server/internal/tables";
import { TURN_FOR_TOOL } from "./report-line";

const NEXT = {
  user: "Noted: this turn is for the user. End it with your reply to them; nobody else is told.",
  supervisor:
    "Noted: this turn is handed back. Your last message of it is your report to whoever started you — what you did, what is left, what they must know. End your turn with it.",
} as const;

export const turnForTool = Mcp.tool({
  name: TURN_FOR_TOOL,
  // Only a mandate whose runs are handed back (an automation's, a
  // supervisor's worker's).
  when: granted(reportRequired),
  description: `Say whom the turn you are about to end is for. Needed only once the user has talked to you in this run (the stop gate asks for it then); call it before your final message.

- \`user\` — you are talking with the user: your reply is theirs, nobody else is told.
- \`supervisor\` — you are handing the work back to whoever started you (your supervisor, or the automation): your last message of this turn becomes your report, and they are told.`,
  inputSchema: {
    to: z.enum(TURN_ADDRESSEES).describe("Whom this turn is for."),
  },
  async handler({ to }, { conversationId }) {
    await db
      .insert(_turnAddressees)
      .values({ conversationId, to })
      .onConflictDoUpdate({
        target: _turnAddressees.conversationId,
        set: { to, declaredAt: sql`now()` },
      });
    return { content: [{ type: "text", text: NEXT[to] }] };
  },
});
