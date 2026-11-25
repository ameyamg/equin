import { z } from "zod";
import { db } from "@plugins/database/server";
import { Mcp } from "@plugins/infra/plugins/mcp/server";
import { recordVersion } from "@plugins/history/plugins/engine/server";
import { getConversation } from "@plugins/tasks/plugins/tasks-core/server";
import {
  conversationIdKind,
  taskIdKind,
} from "@plugins/tasks/plugins/task-ids/core";
import { granted } from "@plugins/tasks/plugins/orchestration/plugins/mandate/server";
import { decisionsOpen } from "@plugins/tasks/plugins/decisions/plugins/capability/core";
import {
  DECISION_OPTIONS_MAX,
  DECISION_STATES,
  decisionIdKind,
  OPEN_DECISION_STATES,
} from "../../core";
import { DECISION_HISTORY_SOURCE } from "./history";
import { readDecisionInFull } from "./full-read";
import { decisionLines } from "./full-render";
import { renderDecisionList } from "./render";
import {
  countClosed,
  listTaskDecisions,
  openDecision,
  updateDecision,
  type DecisionCaller,
  type DecisionRefusal,
} from "./repo";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

const OptionInputSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(8)
    .describe('What the user picks: "A", "2", "A+B".'),
  text: z
    .string()
    .min(1)
    .max(240)
    .describe("ONE sentence (no newline): put the detail in `body`."),
  recommended: z
    .boolean()
    .optional()
    .describe("Your recommendation — at most one option per decision."),
});

const optionsSchema = z
  .array(OptionInputSchema)
  .max(DECISION_OPTIONS_MAX)
  .describe(`At most ${DECISION_OPTIONS_MAX}, keys unique.`);

const questionSchema = z
  .string()
  .min(1)
  .max(300)
  .describe("The question, in one line — what the user must settle.");
const bodySchema = z
  .string()
  .max(20_000)
  .describe(
    "Context in markdown: why it matters, what you found, your take. No fixed sections.",
  );
const stateLabelSchema = z
  .string()
  .min(1)
  .max(40)
  .describe('Your word for an `other` state ("Watching"); only with `other`.');
const labelSchema = z
  .string()
  .min(1)
  .max(32)
  .describe('Unique within your task ("D22", "D17a").');

/** The caller's task, or the text explaining why there is none. */
async function callerOf(
  conversationId: string,
): Promise<DecisionCaller | string> {
  const self = await getConversation(conversationId);
  if (self === null)
    return `Conversation ${conversationId} has no task: decisions belong to a task.`;
  return {
    taskId: taskIdKind.key(self.taskId),
    conversationId: conversationIdKind.key(conversationId),
  };
}

const refusalText = (r: DecisionRefusal) =>
  `Not done (${r.reason}): ${r.message}`;

export const openDecisionTool = Mcp.tool({
  name: "open_decision",
  when: granted(decisionsOpen),
  description: `Ask the user for a decision — instead of writing "D<n>" items by hand into a page. The decision belongs to your task; the user sees every decision that needs them in the Decisions inbox, and their answer comes back to you as an event turn naming it. Keep it current with \`update_decision\` (close it with its outcome once acted on).

States: \`decision\` (pick an option or say what instead), \`action\` (something only the user can do), \`fyi\` (nothing to decide, they should know), \`other\` (your own word, \`stateLabel\`).`,
  inputSchema: {
    label: labelSchema
      .optional()
      .describe(
        'Unique within your task ("D22"). Leave it out for the next "D<n>".',
      ),
    state: z.enum(OPEN_DECISION_STATES),
    stateLabel: stateLabelSchema.optional(),
    question: questionSchema,
    body: bodySchema.optional(),
    options: optionsSchema.optional(),
    from: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The decision this one comes from — an id (any task) or a label of yours. Split a decision by opening its parts with `from` and closing it.",
      ),
  },
  async handler(input, { conversationId }) {
    const caller = await callerOf(conversationId);
    if (typeof caller === "string") return text(caller);
    const out = await db.transaction((tx) => openDecision(tx, caller, input));
    if (!out.ok) return text(refusalText(out));
    await recordVersion(DECISION_HISTORY_SOURCE, out.id);
    return text(`Opened ${out.label} (${out.id}).`);
  },
});

export const updateDecisionTool = Mcp.tool({
  name: "update_decision",
  when: granted(decisionsOpen),
  description: `Keep one of your task's decisions current. A patch: a field you leave out stays as it is.

- Close it once acted on: \`state: "closed"\` with \`outcome\` (what was decided).
- Answer the user's question on it: \`reply\` (fills their oldest unanswered one).
- Add a note to its thread: \`update\` ("being implemented: task-…", "pushed a1b2c3", "live since 14:10") — on an open or a closed decision.
- A closed decision stays a record: only \`update\` and \`reply\` are accepted on it, unless the same call sets a non-closed \`state\`, which reopens it.

Any update counts as acting on the answers the user sent it.`,
  inputSchema: {
    decision: z
      .string()
      .min(1)
      .describe('Its id, or its label within your task ("D22").'),
    question: questionSchema.optional(),
    body: bodySchema.optional(),
    options: optionsSchema.optional(),
    state: z.enum(DECISION_STATES).optional(),
    stateLabel: stateLabelSchema.optional(),
    label: labelSchema.optional(),
    outcome: z
      .string()
      .min(1)
      .max(500)
      .optional()
      .describe(
        'What was decided ("A: cache 10 s, purge on deploy"); only when closing.',
      ),
    reply: z
      .string()
      .min(1)
      .max(4_000)
      .optional()
      .describe("Your answer to the user's oldest unanswered question on it."),
    update: z
      .string()
      .min(1)
      .max(4_000)
      .optional()
      .describe("A note in its thread."),
  },
  async handler(input, { conversationId }) {
    const caller = await callerOf(conversationId);
    if (typeof caller === "string") return text(caller);
    // A reopen clears the outcome on the row: pin the closed version first,
    // so the history keeps it whatever the coalescing window does.
    // Checked first (no write), so a refused call pins nothing.
    const check = await db.transaction((tx) =>
      updateDecision(tx, caller, input, { dryRun: true }),
    );
    if (!check.ok) return text(refusalText(check));
    if (check.transition === "reopened")
      await recordVersion(DECISION_HISTORY_SOURCE, check.id, {
        pin: true,
        label: "Before reopening",
      });
    const out = await db.transaction((tx) => updateDecision(tx, caller, input));
    if (!out.ok) return text(refusalText(out));
    const edited =
      input.question !== undefined ||
      input.body !== undefined ||
      input.options !== undefined ||
      input.state !== undefined ||
      input.stateLabel !== undefined ||
      input.label !== undefined;
    if (edited) await recordVersion(DECISION_HISTORY_SOURCE, out.id);
    const done = [
      out.transition === "closed" ? "closed" : null,
      out.transition === "reopened" ? "reopened" : null,
      out.consumed.question ? "replied to the user's question" : null,
      input.update !== undefined ? "noted" : null,
      out.consumed.answers > 0
        ? `acted on ${out.consumed.answers === 1 ? "the user's answer" : `${out.consumed.answers} answers`}`
        : null,
    ].filter((x) => x !== null);
    return text(
      `Updated ${out.label} (${out.id}, ${out.state})${done.length > 0 ? `: ${done.join(", ")}` : ""}.`,
    );
  },
});

export const listDecisionsTool = Mcp.tool({
  name: "list_decisions",
  when: granted(decisionsOpen),
  description:
    "List your task's decisions: one line each — label, where it stands, the question, and what the user last sent on it. Open ones only unless `all: true`. Read-only.",
  inputSchema: {
    all: z
      .boolean()
      .optional()
      .describe("Closed decisions too, with their outcome."),
  },
  async handler({ all }, { conversationId }) {
    const caller = await callerOf(conversationId);
    if (typeof caller === "string") return text(caller);
    const [rows, closed] = await Promise.all([
      listTaskDecisions(db, caller.taskId, { all: all === true }),
      all === true ? Promise.resolve(0) : countClosed(db, caller.taskId),
    ]);
    return text(renderDecisionList(rows, { hiddenClosed: closed }));
  },
});

export const readDecisionTool = Mcp.tool({
  name: "read_decision",
  description:
    "Read one decision in full — any task's: its question, where it stands, its whole body, its options and its thread, as `<decision>` lines. A page's `<task-decisions>` block shows each decision as an excerpt naming its id; pass that id here. Read-only.",
  inputSchema: {
    decision: z.string().min(1).describe('The decision\'s id ("dec-…").'),
  },
  async handler({ decision }) {
    if (!decisionIdKind.is(decision))
      return text(
        `${decision} is not a decision id: pass the \`dec-…\` id a \`<decision id="…">\` line shows.`,
      );
    const read = await readDecisionInFull(decision);
    if (read === null)
      return text(
        `${decision} names no decision: pass the id a \`<decision id="dec-…">\` line shows.`,
      );
    return text(decisionLines(read).join("\n"));
  },
});
