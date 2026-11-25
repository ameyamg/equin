/**
 * Answering decisions in a batch, end to end through the inbox:
 *
 *  1. seeds two tasks, each with an agent conversation and one open decision
 *     (A/B options). Each conversation is `starting`, so the ledger records
 *     the turn a Submit types and HOLDS it (nothing is typed into a process
 *     that does not exist) — the turn and its exchanges commit together all
 *     the same;
 *  2. opens the Decisions inbox: both decisions are listed, each under its own
 *     agent;
 *  3. drafts both — picks A on the first with the `1` key, types a question on
 *     the second — and reloads: the drafts survive;
 *  4. the SubmitBar says "2 of N answered" and Submit sends them;
 *  5. one event turn per agent is recorded (two turns), the first decision
 *     carries an `answer` and moves to Sent, the second a `question` and
 *     stays in Needs you;
 *  6. screenshots the inbox (`<out>-before.png`, `<out>-after.png`).
 *
 * The seeds are deleted at the end (also on failure). Refuses main.
 *
 *   ./equin run plugins/tasks/plugins/decisions/plugins/inbox/e2e/answer-batch.ts [--out /tmp/answer-batch] [--headed]
 */
import type { Page } from "playwright";
import {
  arg,
  boot,
  onBeforeFinish,
  openDeployDb,
  pathUrl,
  report,
  snap,
  withBrowser,
} from "@plugins/framework/plugins/tooling/plugins/e2e-harness/e2e";
import { waitFor } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/plugins/page-ready/core";
import type { E2eScript } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/core";
import {
  attemptIdKind,
  conversationIdKind,
  taskIdKind,
} from "@plugins/tasks/plugins/task-ids/core";
import { decisionIdKind } from "@plugins/tasks/plugins/decisions/core";

export const e2e = {
  kind: "test",
  target: "build",
  writes: true,
  run: "auto",
} satisfies E2eScript;

const OUT = arg("out") ?? "/tmp/answer-batch";
const db = openDeployDb();

interface Seeded {
  taskId: string;
  conversationId: string;
  decisionId: string;
  title: string;
  question: string;
}
const seeded: Seeded[] = [];

let cleaned = false;
async function cleanup(): Promise<void> {
  if (cleaned) return;
  cleaned = true;
  for (const s of seeded)
    await db.query("DELETE FROM tasks WHERE id = $1", [s.taskId]);
  await db.close();
}
onBeforeFinish(cleanup);

/** One task with a `starting` agent conversation and one open decision. */
async function seed(title: string, question: string): Promise<Seeded> {
  const taskId = taskIdKind.mint();
  const attemptId = attemptIdKind.mint();
  const conversationId = conversationIdKind.mint();
  const decisionId = decisionIdKind.mint();
  await db.query(
    `INSERT INTO tasks (id, cluster_id, title, title_auto, rank, mandate_ref, author_kind) VALUES ($1, $1, $2, false, $3, 'interactive', 'human')`,
    [taskId, title, `zz${taskId}`],
  );
  await db.query(
    `INSERT INTO attempts (id, task_id, worktree_path) VALUES ($1, $2, $3)`,
    [attemptId, taskId, `/tmp/${attemptId}`],
  );
  await db.query(
    `INSERT INTO conversations (id, attempt_id, title, status, model, launch_cause) VALUES ($1, $2, $3, 'starting', 'haiku', 'direct')`,
    [conversationId, attemptId, title],
  );
  await db.query(
    `INSERT INTO decisions (id, task_id, opened_by_conversation_id, label, state, question, body, options)
     VALUES ($1, $2, $3, 'D1', 'decision', $4, '', $5::jsonb)`,
    [
      decisionId,
      taskId,
      conversationId,
      question,
      JSON.stringify([
        { key: "A", text: "Do it now.", recommended: true },
        { key: "B", text: "Wait a week.", recommended: false },
      ]),
    ],
  );
  const s = { taskId, conversationId, decisionId, title, question };
  seeded.push(s);
  return s;
}

const bodyText = (page: Page) => page.locator("body").innerText();

async function openDecision(page: Page, s: Seeded): Promise<void> {
  await page.getByText(s.question, { exact: true }).first().click();
  await page.getByRole("heading", { name: s.question }).waitFor();
}

try {
  const tag = Date.now().toString(36);
  const one = await seed(`E2E agent one ${tag}`, `Ship the cache ${tag}?`);
  const two = await seed(`E2E agent two ${tag}`, `Rotate the keys ${tag}?`);

  await withBrowser(async (h) => {
    const r = report("decisions — answer two agents in one Submit");
    const { page } = await h.session({
      viewport: { width: 1400, height: 1000 },
    });
    await boot(page, pathUrl("/agents/decisions"), { settleMs: 1500 });
    const listed = await waitFor(
      () => bodyText(page),
      (t) => t.includes(one.question) && t.includes(two.question),
      { timeoutMs: 60_000 },
    );
    r.ok("both decisions are listed", listed.ok, "");
    const text = listed.value;
    r.ok(
      "each under its own agent",
      text.includes(one.title) && text.includes(two.title),
      "",
    );

    // Draft: pick A on the first (key 1), a question on the second.
    await openDecision(page, one);
    await page.locator("body").press("1");
    await page.getByText("Your pick").waitFor();
    await openDecision(page, two);
    // The newest detail pane is the one just opened.
    await page.getByLabel("Your note").last().fill("Which keys exactly?");
    const drafted = await waitFor(
      () => page.getByTestId("decisions-submit").innerText(),
      (t) => t.includes("Submit 2"),
      { timeoutMs: 10_000 },
    );
    r.ok("the SubmitBar counts both drafts", drafted.ok, drafted.value);
    await snap(page, OUT, "before");

    // The drafts survive a reload (kept work, browser-only).
    await page.reload();
    const kept = await waitFor(
      () => page.getByTestId("decisions-submit").innerText(),
      (t) => t.includes("Submit 2"),
      { timeoutMs: 30_000 },
    );
    r.ok("the drafts survive a reload", kept.ok, kept.value);
    const hint = await bodyText(page);
    r.ok(
      'the bar says "2 of N answered"',
      /2 of \d+ answered/.test(hint),
      hint.match(/\d+( of \d+)? answered[^\n]*/)?.[0] ?? "(no hint)",
    );

    await page.getByTestId("decisions-submit").click();

    // One event turn per agent, recorded with its exchanges.
    const turns = await waitFor(
      () =>
        db.query<{ conversation_id: string; kind: string; text: string }>(
          `SELECT conversation_id, kind, text FROM conversation_turns WHERE conversation_id = ANY($1)`,
          [[one.conversationId, two.conversationId]],
        ),
      (rows) => rows.length >= 2,
      { timeoutMs: 30_000 },
    );
    r.eq(
      "two event turns, one per agent",
      turns.value.map((t) => [t.conversation_id, t.kind]).sort(),
      [
        [one.conversationId, "event"],
        [two.conversationId, "event"],
      ].sort(),
    );
    const turnOne = turns.value.find(
      (t) => t.conversation_id === one.conversationId,
    );
    r.ok(
      "the first agent's turn carries its pick",
      turnOne?.text.includes(`decision="${one.decisionId}"`) === true &&
        turnOne.text.includes('pick="A"'),
      turnOne?.text ?? "(none)",
    );
    const exchanges = await db.query<{ decision_id: string; kind: string }>(
      `SELECT decision_id, kind FROM decision_exchanges WHERE decision_id = ANY($1)`,
      [[one.decisionId, two.decisionId]],
    );
    r.eq(
      "an answer on the first, a question on the second",
      exchanges.map((e) => [e.decision_id, e.kind]).sort(),
      [
        [one.decisionId, "answer"],
        [two.decisionId, "question"],
      ].sort(),
    );

    // The first moves to Sent; the second stays in Needs you.
    const after = await waitFor(
      () => bodyText(page),
      (t) => !t.includes(one.question) && t.includes(two.question),
      { timeoutMs: 30_000 },
    );
    r.ok("Needs you keeps the question, not the pick", after.ok, "");
    const cleared = await page.getByTestId("decisions-submit").innerText();
    r.ok(
      "the drafts are cleared once taken",
      !cleared.includes("Submit 2"),
      cleared,
    );
    await page.getByRole("button", { name: /^Sent/ }).first().click();
    const sent = await waitFor(
      () => bodyText(page),
      (t) => t.includes(one.question),
      { timeoutMs: 30_000 },
    );
    r.ok("the pick is in Sent", sent.ok, "");
    await snap(page, OUT, "after");
    await page.close();
    await r.finish();
  });
} finally {
  await cleanup();
}
