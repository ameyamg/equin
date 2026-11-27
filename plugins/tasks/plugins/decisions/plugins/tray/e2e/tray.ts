/**
 * An agent's decisions in its conversation, end to end:
 *
 *  1. seeds one task with a `starting` agent conversation, two open decisions
 *     (D1 with A/B options, D2 an FYI) and one closed (D3, with an outcome);
 *  2. opens the conversation: the tray at the transcript's end says "1 decision
 *     needs you", lists D1 and D2 (not D3) and a "1 closed" row;
 *  3. a click on D1 expands it inline into its card; picking A drafts it —
 *     the row says "Your answer: A" and the tray's Submit counts 1;
 *  4. a click on "1 closed" shows D3's outcome;
 *  5. a click on the tray's header folds it (the rows go), another unfolds it;
 *  6. Open in Decisions opens the inbox, where the same draft is on D1's row,
 *     and j opens the first decision beside it;
 *  7. screenshots (`<out>-tray.png`, `<out>-inbox.png`).
 *
 * The seed is deleted at the end (also on failure), and so is the draft.
 *
 *   ./equin run plugins/tasks/plugins/decisions/plugins/tray/e2e/tray.ts [--out /tmp/decisions-tray] [--headed]
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

const OUT = arg("out") ?? "/tmp/decisions-tray";
const db = openDeployDb();

const tag = Date.now().toString(36);
const taskId = taskIdKind.mint();
const conversationId = conversationIdKind.mint();
const title = `E2E tray agent ${tag}`;
const q1 = `Cache the homepage ${tag}?`;
const q2 = `Heads-up: the queue drained ${tag}`;
const q3 = `Rotate the keys ${tag}?`;
const outcome3 = `A: rotated on Tuesday ${tag}`;

let cleaned = false;
async function cleanup(): Promise<void> {
  if (cleaned) return;
  cleaned = true;
  await db.query("DELETE FROM tasks WHERE id = $1", [taskId]);
  await db.close();
}
onBeforeFinish(cleanup);

async function seed(): Promise<void> {
  const attemptId = attemptIdKind.mint();
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
  const options = JSON.stringify([
    { key: "A", text: "Cache it for ten seconds.", recommended: true },
    { key: "B", text: "Leave it.", recommended: false },
  ]);
  await db.query(
    `INSERT INTO decisions (id, task_id, opened_by_conversation_id, label, state, question, body, options)
     VALUES ($1, $2, $3, 'D1', 'decision', $4, 'Every request goes to the origin.', $5::jsonb)`,
    [decisionIdKind.mint(), taskId, conversationId, q1, options],
  );
  await db.query(
    `INSERT INTO decisions (id, task_id, opened_by_conversation_id, label, state, question, body, options)
     VALUES ($1, $2, $3, 'D2', 'fyi', $4, '', '[]'::jsonb)`,
    [decisionIdKind.mint(), taskId, conversationId, q2],
  );
  await db.query(
    `INSERT INTO decisions (id, task_id, opened_by_conversation_id, label, state, question, body, options, outcome, closed_at)
     VALUES ($1, $2, $3, 'D3', 'closed', $4, '', $5::jsonb, $6, now())`,
    [decisionIdKind.mint(), taskId, conversationId, q3, options, outcome3],
  );
}

const trayText = (page: Page) =>
  page.getByTestId("decisions-panel").innerText();

try {
  await seed();
  await withBrowser(async (h) => {
    const r = report("decisions — the conversation tray");
    const { page } = await h.session({
      viewport: { width: 1400, height: 1000 },
    });
    await boot(page, pathUrl(`/agents/c/${conversationId}`), {
      settleMs: 1500,
    });
    const header = page.getByTestId("decisions-panel-header");
    const shown = await waitFor(
      async () =>
        (await page.getByTestId("decisions-panel").count()) > 0
          ? await trayText(page)
          : "",
      (t) => t.includes(q1) && t.includes(q2),
      { timeoutMs: 60_000 },
    );
    r.ok("the tray lists the open decisions", shown.ok, shown.value);
    r.ok(
      'its header says "1 decision needs you"',
      shown.value.includes("1 decision needs you"),
      shown.value.split("\n")[0] ?? "",
    );
    r.ok(
      'a "1 closed" row, D3 folded behind it',
      shown.value.includes("1 closed") && !shown.value.includes(outcome3),
      "",
    );

    await snap(page, OUT, "tray-rest");
    // Expand D1 inline and pick A.
    const panel = page.getByTestId("decisions-panel");
    await panel.getByText(q1).first().click();
    await panel.getByRole("button", { name: /^Pick A/ }).click();
    const drafted = await waitFor(
      () => trayText(page),
      (t) => t.includes("Your answer: A") && t.includes("Submit 1"),
      { timeoutMs: 10_000 },
    );
    r.ok("a pick drafts it, the tray's Submit counts it", drafted.ok, "");

    await panel.getByText("1 closed", { exact: true }).click();
    const closedLine = panel.getByText(outcome3);
    const closed = await closedLine
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "TimeoutError") return false;
        throw err;
      });
    r.ok("the closed row shows D3's outcome", closed, "");
    await snap(page, OUT, "tray");

    await header.click();
    const folded = await waitFor(
      () => trayText(page),
      (t) => !t.includes(q1),
      { timeoutMs: 10_000 },
    );
    r.ok("a click on the header folds the tray", folded.ok, folded.value);
    await header.click();
    const unfolded = await waitFor(
      () => trayText(page),
      (t) => t.includes(q1),
      { timeoutMs: 10_000 },
    );
    r.ok("another unfolds it", unfolded.ok, "");

    await page.getByRole("button", { name: "Open in Decisions" }).click();
    const inbox = await waitFor(
      () => page.locator("body").innerText(),
      (t) => t.includes("Needs you") && t.includes(q1),
      { timeoutMs: 30_000 },
    );
    r.ok("Open in Decisions opens the inbox", inbox.ok, "");
    r.ok(
      "the inbox shows the same draft",
      inbox.value.includes("Your answer: A"),
      "",
    );
    // j steps to the first decision (none selected yet): its detail opens.
    await page.locator("body").press("j");
    const stepped = await page
      .getByRole("heading", { name: q1 })
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "TimeoutError") return false;
        throw err;
      });
    r.ok("j in the inbox opens the first decision", stepped, "");
    await snap(page, OUT, "inbox");

    // The draft is browser-only kept work: drop it with the seed.
    await page.getByText(q1, { exact: true }).first().click();
    await page
      .getByRole("button", { name: /^Pick A/ })
      .last()
      .click();
    await page.close();
    await r.finish();
  });
} finally {
  await cleanup();
}
