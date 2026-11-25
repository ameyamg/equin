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
  DECISION_HISTORY_SOURCE,
  DECISION_OPTIONS_MAX,
  DECISION_STATES,
  decisionIdKind,
  OPEN_DECISION_STATES,
} from "../../core";
import { readDecisionInFull } from "./full-read";
import { decisionLines } from "./full-render";
import { renderDecisionList } from "./render";
import {
  BODY_MAX,
  countClosed,
  decisionIdByLabel,
  listTaskDecisions,
  OPTION_TEXT_MAX,
  QUESTION_MAX,
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
    .max(OPTION_TEXT_MAX)
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
  .max(QUESTION_MAX)
  .describe("The question, in one line — what the user must settle.");
const bodySchema = z
  .string()
  .max(BODY_MAX)
  .describe(
    "Context in markdown: why it matters, what you found, your take. No fixed sections.",
  );
const stateLabelSchema = z
  .string()
  .min(1)
  .max(40)
  .describe('Your word for an `other` state ("Watching"); only with `other`.');
const TextEditSchema = z.object({
  field: z
    .enum(["question", "body", "option"])
    .describe("Which text: the question, the body, or one option's text."),
  option: z
    .string()
    .min(1)
    .optional()
    .describe('The option\'s key ("A"), with `field: "option"` only.'),
  old_string: z
    .string()
    .min(1)
    .describe(
      "The exact text to replace, as it stands now — unique in the field unless `replace_all`.",
    ),
  new_string: z
    .string()
    .max(BODY_MAX)
    .describe("The text to put in its place."),
  replace_all: z
    .boolean()
    .optional()
    .describe("Replace every occurrence of `old_string` in the field."),
});

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
  description: `Open a decision: something only the user can settle, recorded where they answer it. The decision belongs to your task; the user sees every decision that needs them in the Decisions inbox, and their answer comes back to you as an event turn naming it. Keep its text current with \`update_decision\` as your understanding changes, and close it with its outcome once acted on.

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
  description: `Edit one of your task's decisions: keep its question, body and options saying what is true now. A patch: what you leave out stays as it is.

**Edit its text** the way \`Edit\` edits a file — read it first with \`read_decision\` (its body is shown as \`> \`-quoted lines; match the text without the \`> \`), then pass \`edits\`: each replaces \`old_string\` with \`new_string\` in one field (\`question\`, \`body\`, or one option's text with \`option: "<key>"\`). \`old_string\` must occur exactly once in that field unless \`replace_all\`. Edits apply in order, all or none.
- Rewrite a field whole: \`question\`, \`body\`, \`options\` (the whole list — how you add, remove or reorder options, or move \`recommended\`). A field is either rewritten or edited in one call, not both.
- Change where it stands: \`state\` (\`stateLabel\` with \`other\`), \`label\`.
- Close it once acted on: \`state: "closed"\` with \`outcome\` (what was decided). A closed decision keeps its text; set a non-closed \`state\` in the same call to reopen and edit it.
- Answer the user's question on it: \`reply\` (fills their oldest unanswered one).
- Add a note to its thread: \`update\` ("pushed a1b2c3") — for events, not for changing what it says. Accepted on a closed decision too.

Any update counts as acting on the answers the user sent it.`,
  inputSchema: {
    decision: z
      .string()
      .min(1)
      .describe('Its id, or its label within your task ("D22").'),
    edits: z
      .array(TextEditSchema)
      .min(1)
      .max(50)
      .optional()
      .describe("Targeted edits of its text, applied in order."),
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
      (input.edits?.length ?? 0) > 0 ||
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
    "List your task's decisions: one line each — label, id, where it stands, the question, and what the user last sent on it. Open ones only unless `all: true`. `read_decision` shows one in full. Read-only.",
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
    "Read one decision in full — any task's: its question, where it stands, its whole body (as `> `-quoted lines), its options and its thread, as `<decision>` lines. Read a decision of yours before editing it with `update_decision`; a page's `<task-decisions>` block shows each decision as an excerpt naming its id. Read-only.",
  inputSchema: {
    decision: z
      .string()
      .min(1)
      .describe(
        'The decision\'s id ("dec-…"), or its label within your task ("D22").',
      ),
  },
  async handler({ decision }, { conversationId }) {
    const ref = decision.trim();
    let id = decisionIdKind.is(ref) ? ref : null;
    if (id === null) {
      const caller = await callerOf(conversationId);
      if (typeof caller === "string")
        return text(
          `${ref} is not a decision id, and a label names a decision of your own task — but: ${caller} Pass the \`dec-…\` id a \`<decision id="…">\` line shows.`,
        );
      id = await decisionIdByLabel(db, caller.taskId, ref);
      if (id === null)
        return text(
          `${ref} names no decision of your task: pass one of its labels, or a decision's \`dec-…\` id.`,
        );
    }
    const read = await readDecisionInFull(decisionIdKind.key(id));
    if (read === null)
      return text(
        `${ref} names no decision: pass the id a \`<decision id="dec-…">\` line shows.`,
      );
    return text(decisionLines(read).join("\n"));
  },
});
