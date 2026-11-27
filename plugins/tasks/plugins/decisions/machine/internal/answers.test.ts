/**
 * The user's batch of answers against the REAL worktree DB, inside rolled-back
 * transactions, with a fake agent behind the delivery port: one turn per
 * agent carrying every answer and question of it, its exchanges written with
 * the turn; a retried Submit records nothing twice; partial refusals; the
 * finished agent's answers kept on the record (a pick closes the decision,
 * nothing typed); "Got it" on an FYI; and what an agent owes (the stop gate /
 * exit_clean reads).
 *
 * Run: `./equin test plugins/tasks/plugins/decisions`.
 */
import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import {
  worktreeDbScenario,
  type DbExecutor,
} from "@plugins/database/plugins/db-test-fixture/plugins/worktree-db/server/testing";
import {
  conversationIdKind,
  taskIdKind,
  type TaskId,
} from "@plugins/tasks/plugins/task-ids/core";
import type { EventTurn } from "@plugins/tasks/plugins/orchestration/plugins/message/server";
import {
  PromptMarkdownSchema,
  type PromptMarkdown,
} from "@plugins/primitives/plugins/text-editor/core";
import type { DecisionId } from "../../core";
import { answerTurnText, submitAnswers, type AnswerPorts } from "./answers";

/** A note as the prompt field hands it over. */
const md = (text: string): PromptMarkdown => PromptMarkdownSchema.parse(text);
import {
  decisionsAwaitingUser,
  owedDecisions,
  owedMessage,
} from "../../server/internal/owing";
import {
  openDecision,
  updateDecision,
  type DecisionCaller,
} from "../../server/internal/repo";
import { _decisionExchanges, _decisions } from "../../server/internal/tables";

async function caller(tx: DbExecutor, title: string): Promise<DecisionCaller> {
  const id: TaskId = taskIdKind.mint();
  await tx.execute(sql`
    INSERT INTO tasks (id, cluster_id, title, title_auto, rank, folder_id, created_at, updated_at, mandate_ref, author_kind)
    VALUES (${id}, ${id}, ${title}, false, ${id}, NULL, now(), now(), 'interactive', 'human')
  `);
  return { taskId: id, conversationId: conversationIdKind.mint() };
}

async function open(
  tx: DbExecutor,
  c: DecisionCaller,
  state: "decision" | "fyi" = "decision",
): Promise<DecisionId> {
  const out = await openDecision(tx, c, {
    state,
    question: "Cache the homepage?",
    options:
      state === "decision"
        ? [
            { key: "A", text: "Cache it." },
            { key: "B", text: "Do not." },
          ]
        : [],
  });
  if (!out.ok) throw new Error(out.message);
  return out.id;
}

/** A fake agent per task: live, or finished; records every turn it is handed. */
function fakeAgents(tx: DbExecutor, finished: ReadonlySet<string> = new Set()) {
  /** Each typed turn, with its text as the agent reads it. */
  const turns: { taskId: string; turn: EventTurn; text: string }[] = [];
  const recordedIds = new Set<string>();
  const versions: string[] = [];
  const notesTaken: string[] = [];
  const ports: AnswerPorts = {
    isFinished: async (taskId) => finished.has(taskId),
    async deliver(taskId, turn) {
      if (finished.has(taskId))
        return { kind: "finished", conversationId: "conv-x" };
      const id = turn.id!;
      // The ledger records an id once; a repeat types nothing more.
      if (!recordedIds.has(id)) {
        await tx.transaction(async (inner) => {
          await turn.onRecorded?.(inner as never);
        });
        recordedIds.add(id);
        // The agent's copy of a note: an attachment ref read as its disk path.
        const reads = Object.fromEntries(
          Object.entries(turn.userText).map(([k, note]) => [
            k,
            note.replaceAll(
              "![shot](/api/attachments/att-1)",
              "@/disk/att-1.png",
            ),
          ]),
        );
        turns.push({ taskId, turn, text: turn.text(reads) });
      }
      return {
        kind: "delivered",
        conversationId: `conv-of-${taskId}`,
        turnId: id,
        was: "running",
      };
    },
    recordVersion: async (id) => {
      versions.push(id);
    },
    keepNote: async (decisionId) => {
      notesTaken.push(decisionId);
    },
  };
  return { ports, turns, versions, notesTaken };
}

const SUBMISSION = "6f0d2a43-3c1b-4b8e-9c55-0d3f3a2b1c10";

async function exchangesOf(tx: DbExecutor, id: DecisionId) {
  return tx
    .select()
    .from(_decisionExchanges)
    .where(eq(_decisionExchanges.decisionId, id));
}

async function stateOf(tx: DbExecutor, id: DecisionId) {
  const [row] = await tx
    .select({ state: _decisions.state, outcome: _decisions.outcome })
    .from(_decisions)
    .where(eq(_decisions.id, id));
  return row;
}

describe("decisions: submitting answers", () => {
  test("one turn per agent, every answer and question of it, exchanges with the turn", async () => {
    await worktreeDbScenario(async (tx) => {
      const a = await caller(tx, "Agent A");
      const b = await caller(tx, "Agent B");
      const a1 = await open(tx, a);
      const a2 = await open(tx, a);
      const b1 = await open(tx, b);
      const agents = fakeAgents(tx);
      const out = await submitAnswers(
        tx,
        {
          submissionId: SUBMISSION,
          answers: [
            { decision: a1, pick: "A", note: md("keep it under 10 s") },
            { decision: a2, note: md("why not a rolling restart?") },
            { decision: b1, pick: "B" },
          ],
        },
        agents.ports,
      );
      expect(out.refused).toEqual([]);
      expect(out.recorded).toEqual([]);
      expect(out.delivered.map((d) => [d.taskId, d.decisions.length])).toEqual([
        [a.taskId, 2],
        [b.taskId, 1],
      ]);
      expect(agents.turns.length).toBe(2);
      const textA = agents.turns[0]!.text;
      expect(textA).toContain(
        `<decision-answer decision="${a1}" label="D1" pick="A">keep it under 10 s</decision-answer>`,
      );
      expect(textA).toContain(
        `<decision-question decision="${a2}" label="D2">why not a rolling restart?</decision-question>`,
      );
      const [answer] = await exchangesOf(tx, a1);
      expect([
        answer?.kind,
        answer?.pick,
        answer?.userText,
        answer?.turnId,
      ]).toEqual([
        "answer",
        "A",
        "keep it under 10 s",
        agents.turns[0]!.turn.id,
      ]);
      expect((await exchangesOf(tx, a2))[0]?.kind).toBe("question");
      // The pick is Sent until the agent acts on it; the question keeps the
      // decision the user's — and both are owed by the agent now.
      const owed = await owedDecisions(tx, a.taskId);
      expect(owed.map((o) => [o.label, o.owes]).sort()).toEqual([
        ["D1", "act"],
        ["D2", "reply"],
      ]);
      expect(owedMessage(owed)).toContain("D2");
      await updateDecision(tx, a, {
        decision: "D1",
        state: "closed",
        outcome: "A: 10 s",
      });
      await updateDecision(tx, a, {
        decision: "D2",
        reply: "Because of the lock.",
      });
      expect(await owedDecisions(tx, a.taskId)).toEqual([]);
    });
  });

  test("a retried Submit delivers and records nothing twice", async () => {
    await worktreeDbScenario(async (tx) => {
      const a = await caller(tx, "Agent A");
      const a1 = await open(tx, a);
      const agents = fakeAgents(tx);
      const body = {
        submissionId: SUBMISSION,
        answers: [{ decision: a1, pick: "A" }],
      };
      await submitAnswers(tx, body, agents.ports);
      const again = await submitAnswers(tx, body, agents.ports);
      expect(again.delivered[0]?.turnId).toBe(agents.turns[0]!.turn.id);
      expect(agents.turns.length).toBe(1);
      expect((await exchangesOf(tx, a1)).length).toBe(1);
    });
  });

  test("a second Submit (another tab) sends nothing twice", async () => {
    await worktreeDbScenario(async (tx) => {
      const a = await caller(tx, "Agent A");
      const picked = await open(tx, a);
      const asked = await open(tx, a);
      const agents = fakeAgents(tx);
      const answers = [
        { decision: picked, pick: "A" },
        { decision: asked, note: md("why?") },
      ];
      await submitAnswers(
        tx,
        { submissionId: SUBMISSION, answers },
        agents.ports,
      );
      const second = await submitAnswers(
        tx,
        { submissionId: "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d", answers },
        agents.ports,
      );
      expect(second.delivered).toEqual([]);
      expect(second.refused.map((r) => [r.decision, r.reason]).sort()).toEqual(
        [
          [picked, "already-sent"],
          [asked, "already-sent"],
        ].sort(),
      );
      expect(agents.turns.length).toBe(1);
      expect((await exchangesOf(tx, picked)).length).toBe(1);
      expect((await exchangesOf(tx, asked)).length).toBe(1);
    });
  });

  test("a failed delivery is that agent's: recorded-not-typed is said, unrecorded is refused", async () => {
    await worktreeDbScenario(async (tx) => {
      const a = await caller(tx, "Agent A");
      const b = await caller(tx, "Agent B");
      const c = await caller(tx, "Agent C");
      const a1 = await open(tx, a);
      const b1 = await open(tx, b);
      const c1 = await open(tx, c);
      const agents = fakeAgents(tx);
      const ports: AnswerPorts = {
        ...agents.ports,
        async deliver(taskId, turn) {
          if (taskId === a.taskId) {
            // Recorded, then typing failed.
            await tx.transaction(async (inner) => {
              await turn.onRecorded?.(inner as never);
            });
            throw new Error("the agent's socket closed");
          }
          if (taskId === b.taskId) throw new Error("runtime down");
          return agents.ports.deliver(taskId, turn);
        },
      };
      const out = await submitAnswers(
        tx,
        {
          submissionId: SUBMISSION,
          answers: [
            { decision: a1, pick: "A" },
            { decision: b1, pick: "A" },
            { decision: c1, pick: "A" },
          ],
        },
        ports,
      );
      expect(
        out.delivered.map((d) => [d.taskId, d.typingFailed]).sort(),
      ).toEqual(
        [
          [a.taskId, "the agent's socket closed"],
          [c.taskId, null],
        ].sort(),
      );
      expect(out.refused.map((r) => [r.decision, r.reason])).toEqual([
        [b1, "delivery-failed"],
      ]);
      expect((await exchangesOf(tx, b1)).length).toBe(0);
    });
  });

  test("refusals are per answer; the rest of the batch goes", async () => {
    await worktreeDbScenario(async (tx) => {
      const a = await caller(tx, "Agent A");
      const ok = await open(tx, a);
      const closed = await open(tx, a);
      const badPick = await open(tx, a);
      const notFyi = await open(tx, a);
      await updateDecision(tx, a, {
        decision: closed,
        state: "closed",
        outcome: "done",
      });
      const agents = fakeAgents(tx);
      const out = await submitAnswers(
        tx,
        {
          submissionId: SUBMISSION,
          answers: [
            { decision: ok, pick: "B" },
            { decision: closed, pick: "A" },
            { decision: badPick, pick: "Z" },
            { decision: notFyi, close: true },
            { decision: "dec-1795000000000-zzzzzz", pick: "A" },
            { decision: ok.replace(/.$/, "q"), note: md("   ") },
          ],
        },
        agents.ports,
      );
      expect(out.delivered.map((d) => d.decisions)).toEqual([[ok]]);
      expect(
        Object.fromEntries(out.refused.map((r) => [r.decision, r.reason])),
      ).toMatchObject({
        [closed]: "closed",
        [badPick]: "unknown-pick",
        [notFyi]: "close-not-allowed",
        "dec-1795000000000-zzzzzz": "unknown-decision",
      });
    });
  });

  test("a finished agent is not sent anything: a pick closes, a note is kept open", async () => {
    await worktreeDbScenario(async (tx) => {
      const a = await caller(tx, "Agent A");
      const picked = await open(tx, a);
      const noted = await open(tx, a);
      const agents = fakeAgents(tx, new Set([a.taskId]));
      const out = await submitAnswers(
        tx,
        {
          submissionId: SUBMISSION,
          answers: [
            { decision: picked, pick: "A", note: md("later") },
            { decision: noted, note: md("still relevant?") },
          ],
        },
        agents.ports,
      );
      expect(out.delivered).toEqual([]);
      expect(out.recorded.sort()).toEqual([picked, noted].sort());
      expect(agents.turns).toEqual([]);
      expect(await stateOf(tx, picked)).toEqual({
        state: "closed",
        outcome: "You chose A (not sent: the agent had finished)",
      });
      expect((await stateOf(tx, noted))?.state).toBe("decision");
      expect((await exchangesOf(tx, noted))[0]?.kind).toBe("recorded");
      expect(agents.versions).toEqual([picked]);
      // The note-only one waits on the user still, and a Close settles it.
      expect(await decisionsAwaitingUser(tx, a.taskId)).toEqual(["D2"]);
      await submitAnswers(
        tx,
        {
          submissionId: "0b4f8c6e-1d2a-4f3b-8a9c-7e6d5c4b3a21",
          answers: [{ decision: noted, close: true }],
        },
        agents.ports,
      );
      expect((await stateOf(tx, noted))?.state).toBe("closed");
    });
  });

  test("Got it closes an FYI without telling a live agent", async () => {
    await worktreeDbScenario(async (tx) => {
      const a = await caller(tx, "Agent A");
      const fyi = await open(tx, a, "fyi");
      const agents = fakeAgents(tx);
      const out = await submitAnswers(
        tx,
        { submissionId: SUBMISSION, answers: [{ decision: fyi, close: true }] },
        agents.ports,
      );
      expect(out.recorded).toEqual([fyi]);
      expect(agents.turns).toEqual([]);
      expect(await stateOf(tx, fyi)).toEqual({
        state: "closed",
        outcome: "Seen",
      });
    });
  });

  test("a note's attachments reach the agent as disk paths, and the record keeps the note as written", async () => {
    await worktreeDbScenario(async (tx) => {
      const a = await caller(tx, "Agent A");
      const live = await open(tx, a);
      const b = await caller(tx, "Agent B");
      const kept = await open(tx, b);
      const agents = fakeAgents(tx, new Set([b.taskId]));
      const note = md("like this ![shot](/api/attachments/att-1)");
      await submitAnswers(
        tx,
        {
          submissionId: SUBMISSION,
          answers: [
            { decision: live, pick: "A", note },
            { decision: kept, pick: "A", note },
          ],
        },
        agents.ports,
      );
      // Both notes taken — the kept one's attachments stay with its decision too.
      expect(agents.notesTaken.sort()).toEqual([live, kept].sort());
      const text = agents.turns[0]!.text;
      expect(text).toContain("like this @/disk/att-1.png");
      expect(text).not.toContain("/api/attachments/");
      expect((await exchangesOf(tx, live))[0]?.userText).toBe(note);
      expect((await exchangesOf(tx, kept))[0]?.userText).toBe(note);
    });
  });

  test("the turn text escapes what the user typed", () => {
    const text = answerTurnText(
      [
        {
          target: {
            id: "dec-1" as DecisionId,
            taskId: "task-1",
            label: "D1",
            state: "decision",
            optionKeys: ["A"],
          },
          pick: "A",
          note: md("a <b> & c"),
          close: false,
        },
      ],
      { "dec-1": "a <b> & c" },
    );
    expect(text).toContain("a &lt;b&gt; &amp; c");
    expect(text).toStartWith("The user answered 1 of your decisions:");
  });
});
