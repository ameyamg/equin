import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { Mcp } from "@plugins/infra/plugins/mcp/server";
import { granted } from "@plugins/tasks/plugins/orchestration/plugins/mandate/server";
import { reportRequired } from "@plugins/tasks/plugins/outcome-report/plugins/capability/core";
import { TURN_ADDRESSEES } from "../../core";
import { _turnAddressees } from "../../server/internal/tables";
import { TURN_FOR_TOOL } from "./report-line";

/**
 * The choice is defined by what is pending, not by whom the message answers:
 * an agent replying to the user's request reads its turn as "for the user"
 * even when nothing waits on them, and the conversation then sits open with
 * nobody told (conv-1795650215-x3qqxv, ~10 h). So `user` must name the reply
 * or decision it waits for (`awaiting`) — an agent with nothing pending has
 * nothing honest to write there — and every other turn is handed back.
 */
const NEXT = {
  user: "Noted: you are waiting on the user. End your turn with the question or decision you named; nobody else is told until the user answers. If nothing you do next needs their answer, call this again with `supervisor`.",
  supervisor:
    "Noted: this turn is handed back. Your last message of it is your report to whoever started you — what you did, what is left, what they must know — even when it also answers the user. End your turn with it.",
} as const;

export const turnForTool = Mcp.tool({
  name: TURN_FOR_TOOL,
  // Only a mandate whose runs are handed back (an automation's, a
  // supervisor's worker's).
  when: granted(reportRequired),
  description: `Say what happens after the turn you are about to end: are you waiting on the user's answer? Needed only once the user has talked to you in this run (the stop gate asks for it then); call it before your final message.

- \`supervisor\` — nothing is pending on the user: the work is done, or you are blocked on someone else. Your last message of this turn becomes your report to whoever started you (your supervisor, or the automation); they are told, and close or continue the conversation. Pick this even when your message answers the user's request.
- \`user\` — you cannot go on without the user's reply or decision. Name it in \`awaiting\`. Nobody else is told, so the conversation stays open on the user.`,
  inputSchema: {
    to: z
      .enum(TURN_ADDRESSEES)
      .describe(
        "`user` only while you need the user's reply or decision to go on; otherwise `supervisor`.",
      ),
    awaiting: z
      .string()
      .optional()
      .describe(
        "Required with `user`: the question or decision your final message puts to the user.",
      ),
  },
  async handler({ to, awaiting }, { conversationId }) {
    const recorded = to === "user" ? (awaiting ?? "").trim() : null;
    if (recorded === "")
      // Nothing is recorded: an earlier declaration of this turn stands, and
      // without one the stop gate asks again (it holds a stop once, so an
      // agent that stops anyway ends undeclared — not handed back).
      return {
        content: [
          {
            type: "text",
            text: "Not recorded: `user` means you are waiting on the user's reply or decision, so name it in `awaiting`. If nothing is pending on them (the work is done, or you are blocked on someone else), call this with `supervisor`. Any earlier choice you made this turn still stands.",
          },
        ],
      };
    await db
      .insert(_turnAddressees)
      .values({ conversationId, to, awaiting: recorded })
      .onConflictDoUpdate({
        target: _turnAddressees.conversationId,
        set: { to, awaiting: recorded, declaredAt: sql`now()`, usedAt: null },
      });
    return { content: [{ type: "text", text: NEXT[to] }] };
  },
});
