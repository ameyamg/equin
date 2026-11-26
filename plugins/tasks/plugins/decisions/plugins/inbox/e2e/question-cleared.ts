/**
 * A question the user sent leaves the note box, end to end through the inbox:
 *
 *  1. seeds two tasks, each with a finished agent conversation and one open
 *     decision (a note to a finished agent is kept on the record and the
 *     decision stays open, so its note box stays drawn);
 *  2. types a multi-line note on each, as a person does (Enter between the
 *     lines). The first is sent with the Submit button, and the user leaves
 *     for Tasks while the server's answer is held back — the bar that sent
 *     it unmounts before the answer lands, which must still clear the draft;
 *     the second is sent with ⌘↵ from inside its note;
 *  3. each records ONE exchange, the note as typed;
 *  4. each note box is empty again — the note is in the thread instead — and
 *     the Submit bar has nothing to send.
 *
 * The seeds are deleted at the end (also on failure). Refuses main.
 *
 *   ./equin run plugins/tasks/plugins/decisions/plugins/inbox/e2e/question-cleared.ts [--out /tmp/question-cleared] [--headed]
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
  stallRoute,
  withBrowser,
} from "@plugins/framework/plugins/tooling/plugins/e2e-harness/e2e";
import { waitFor } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/plugins/page-ready/core";
import type { E2eScript } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/core";
import {
  attemptIdKind,
  conversationIdKind,
  taskIdKind,
} from "@plugins/tasks/plugins/task-ids/core";
import {
  decisionExchangeIdKind,
  decisionIdKind,
} from "@plugins/tasks/plugins/decisions/core";

export const e2e = {
  kind: "test",
  target: "build",
  writes: true,
  run: "auto",
} satisfies E2eScript;

const OUT = arg("out") ?? "/tmp/question-cleared";
const db = openDeployDb();

interface Seeded {
  taskId: string;
  decisionId: string;
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
    `INSERT INTO conversations (id, attempt_id, title, status, model, launch_cause) VALUES ($1, $2, $3, 'done', 'haiku', 'direct')`,
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
  const s = { taskId, decisionId, question };
  seeded.push(s);
  return s;
}

async function openDecision(page: Page, s: Seeded): Promise<void> {
  await page.getByText(s.question, { exact: true }).first().click();
  await page.getByRole("heading", { name: s.question }).waitFor();
}

/** Types the lines into the open decision's note, Enter between them. */
async function typeNote(page: Page, lines: string[]): Promise<void> {
  const note = page.getByLabel("Your note").last();
  await note.click();
  for (const [i, line] of lines.entries()) {
    if (i > 0) await page.keyboard.press("Enter");
    await page.keyboard.type(line);
  }
}

const questionsOf = (decisionId: string) =>
  db.query<{ user_text: string | null }>(
    `SELECT user_text FROM decision_exchanges WHERE decision_id = $1`,
    [decisionId],
  );

const LINES = ["- Remove starred.", "- No counts in the groups."];

try {
  const tag = Date.now().toString(36);
  const one = await seed(`E2E agent one ${tag}`, `Name it Done ${tag}?`);
  const two = await seed(`E2E agent two ${tag}`, `Name it Archive ${tag}?`);
  const three = await seed(`E2E agent three ${tag}`, `Name it Later ${tag}?`);

  await withBrowser(async (h) => {
    const r = report("decisions — a sent question leaves the note box");
    const { page } = await h.session({
      viewport: { width: 1400, height: 1000 },
    });
    await boot(page, pathUrl("/agents/decisions"), { settleMs: 1500 });
    await page.getByText(two.question, { exact: true }).first().waitFor();

    // One: Submit, then away to Tasks before the server's answer lands.
    await openDecision(page, one);
    await typeNote(page, LINES);
    // The Submit request is held, so the answer lands after the bar is gone.
    await stallRoute(page, "**/api/decisions/answers", { ms: 3000 });
    const answerLanded = page.waitForResponse("**/api/decisions/answers");
    await page.getByTestId("decisions-submit").click();
    await page.getByText("Tasks", { exact: true }).first().click();
    await page.getByTestId("decisions-submit").waitFor({ state: "detached" });
    r.ok(
      "the answer lands after the bar is gone",
      (await answerLanded).ok(),
      "",
    );
    const q1 = await waitFor(
      () => questionsOf(one.decisionId),
      (rows) => rows.length >= 1,
      { timeoutMs: 30_000 },
    );
    r.eq("Submit records the note once", q1.value.length, 1);
    await page.getByText("Decisions", { exact: true }).first().click();
    await page.getByText(two.question, { exact: true }).first().waitFor();

    // Two: ⌘↵ from inside the note.
    await openDecision(page, two);
    await typeNote(page, LINES);
    await page
      .getByTestId("decisions-submit")
      .filter({ hasText: "Submit 1" })
      .waitFor();
    await page.keyboard.press("ControlOrMeta+Enter");
    const q2 = await waitFor(
      () => questionsOf(two.decisionId),
      (rows) => rows.length >= 1,
      { timeoutMs: 30_000 },
    );
    r.eq("⌘↵ records the note once", q2.value.length, 1);
    r.eq(
      "the question is the note as typed",
      q2.value[0]?.user_text ?? null,
      LINES.join("\n"),
    );

    // Three: as with a live agent, the decision turns Sent (its note box
    // unmounts) while Submit's answer is still on its way; the agent's reply
    // brings it back.
    await openDecision(page, three);
    await typeNote(page, LINES);
    await page
      .getByTestId("decisions-submit")
      .filter({ hasText: "Submit 1" })
      .waitFor();
    await stallRoute(page, "**/api/decisions/answers", { ms: 4000 });
    const threeLanded = page.waitForResponse("**/api/decisions/answers");
    await page.getByTestId("decisions-submit").click();
    const asked = decisionExchangeIdKind.mint();
    await db.query(
      `INSERT INTO decision_exchanges (id, decision_id, kind, user_text) VALUES ($1, $2, 'question', $3)`,
      [asked, three.decisionId, LINES.join("\n")],
    );
    await page
      .getByRole("heading", { name: three.question })
      .waitFor({ state: "detached" })
      .catch((err: unknown) => {
        if (!(err instanceof Error && err.name === "TimeoutError")) throw err;
      });
    const noteGone = await waitFor(
      () => page.getByLabel("Your note").count(),
      (n) => n === 0,
      { timeoutMs: 10_000 },
    );
    r.ok("Sent: the note box is gone before the answer lands", noteGone.ok, "");
    r.ok("three: the answer lands", (await threeLanded).ok(), "");
    await db.query(
      `UPDATE decision_exchanges SET agent_text = 'Noted.', agent_at = now() WHERE id = $1`,
      [asked],
    );

    // Every note box is drawn again (open decisions), and empty.
    for (const s of [one, two, three]) {
      await openDecision(page, s);
      const box = await waitFor(
        async () => {
          const note = page.getByLabel("Your note").last();
          return (await note.count()) === 0 ? null : await note.innerText();
        },
        (t) => t !== null,
        { timeoutMs: 30_000 },
      );
      r.eq(
        `${s.question}: the note box is empty once taken`,
        (box.value ?? "").trim(),
        "",
      );
    }
    const bar = await page.getByTestId("decisions-submit").innerText();
    r.ok("the Submit bar has nothing to send", !/Submit \d/.test(bar), bar);
    await snap(page, OUT, "after");
    await page.close();
    await r.finish();
  });
} finally {
  await cleanup();
}
