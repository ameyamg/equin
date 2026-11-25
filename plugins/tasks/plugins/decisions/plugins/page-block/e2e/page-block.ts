/**
 * Two agents' decisions on one page, end to end:
 *
 *  1. seeds two tasks (A, B), each with a `starting` agent conversation and one
 *     open decision, and a blank page holding a `<task-decisions>` block per
 *     task (through the write boundary);
 *  2. the page draws both panels, each listing only its own task's decision;
 *  3. a pick in each panel drafts both; ⌘↵ after a click in panel A sends only
 *     A's answer — A's decision leaves Needs you, B's draft stays (the
 *     shortcut is the panel's region's, not the tab's);
 *  4. the sidebar row of B's conversation carries its decisions chip
 *     ("1 decision needs you");
 *  5. screenshots (`<out>-page.png`, `<out>-sidebar.png`).
 *
 * The seed is deleted at the end (also on failure); the page is trashed.
 *
 *   ./equin run plugins/tasks/plugins/decisions/plugins/page-block/e2e/page-block.ts [--out /tmp/decisions-page-block] [--headed]
 */
import type { Locator, Page } from "playwright";
import {
  arg,
  onBeforeFinish,
  openDeployDb,
  pageFetch,
  pathUrl,
  report,
  snap,
  withBrowser,
} from "@plugins/framework/plugins/tooling/plugins/e2e-harness/e2e";
import { waitFor } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/plugins/page-ready/core";
import type { E2eScript } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/core";
import { openBlankPage } from "@plugins/page/plugins/editor/e2e";
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

const OUT = arg("out") ?? "/tmp/decisions-page-block";
const db = openDeployDb();
const tag = Date.now().toString(36);

interface Agent {
  taskId: string;
  conversationId: string;
  title: string;
  question: string;
}
const agent = (name: string): Agent => ({
  taskId: taskIdKind.mint(),
  conversationId: conversationIdKind.mint(),
  title: `E2E page-block ${name} ${tag}`,
  question: `Ship ${name} ${tag}?`,
});
const A = agent("alpha");
const B = agent("bravo");

let cleaned = false;
async function cleanup(): Promise<void> {
  if (cleaned) return;
  cleaned = true;
  await db.query("DELETE FROM tasks WHERE id = ANY($1)", [
    [A.taskId, B.taskId],
  ]);
  await db.close();
}
onBeforeFinish(cleanup);

async function seed(a: Agent, status: string): Promise<void> {
  const attemptId = attemptIdKind.mint();
  await db.query(
    `INSERT INTO tasks (id, cluster_id, title, title_auto, rank, mandate_ref, author_kind) VALUES ($1, $1, $2, false, $3, 'interactive', 'human')`,
    [a.taskId, a.title, `zz${a.taskId}`],
  );
  await db.query(
    `INSERT INTO attempts (id, task_id, worktree_path) VALUES ($1, $2, $3)`,
    [attemptId, a.taskId, `/tmp/${attemptId}`],
  );
  await db.query(
    `INSERT INTO conversations (id, attempt_id, title, status, model, launch_cause) VALUES ($1, $2, $3, $4, 'haiku', 'direct')`,
    [a.conversationId, attemptId, a.title, status],
  );
  await db.query(
    `INSERT INTO decisions (id, task_id, opened_by_conversation_id, label, state, question, body, options)
     VALUES ($1, $2, $3, 'D1', 'decision', $4, 'Context.', $5::jsonb)`,
    [
      decisionIdKind.mint(),
      a.taskId,
      a.conversationId,
      a.question,
      JSON.stringify([
        { key: "A", text: "Ship it.", recommended: true },
        { key: "B", text: "Wait.", recommended: false },
      ]),
    ],
  );
}

async function post(page: Page, url: string, body: unknown): Promise<void> {
  const res = await pageFetch(page, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(`POST ${url} ${res.status}: ${await res.text()}`);
}

const panelOf = (page: Page, a: Agent): Locator =>
  page
    .getByTestId("decisions-panel")
    .filter({ has: page.getByText(a.question) });

/** A panel's text once it is drawn; `""` while it is not (yet). */
async function shownText(panel: Locator): Promise<string> {
  return (await panel.count()) > 0 ? panel.innerText() : "";
}

try {
  await seed(A, "starting");
  await seed(B, "starting");
  await withBrowser(async (h) => {
    const r = report("decisions — the <task-decisions> page block");
    const { page } = await h.session({
      viewport: { width: 1400, height: 1000 },
    });
    const blank = await openBlankPage(page, { settleMs: 1000 });
    const pageId = blank.pageId;
    for (const a of [A, B])
      await post(page, "/api/blocks", {
        parentId: pageId,
        type: "task-decisions",
        data: { taskId: a.taskId },
      });

    const both = await waitFor(
      async () => page.getByTestId("decisions-panel").count(),
      (n) => n === 2,
      { timeoutMs: 60_000 },
    );
    r.ok("the page draws one panel per block", both.ok, String(both.value));
    const own = await waitFor(
      async () => [
        await shownText(panelOf(page, A)),
        await shownText(panelOf(page, B)),
      ],
      ([a = "", b = ""]) =>
        a.includes(A.question) &&
        !a.includes(B.question) &&
        b.includes(B.question) &&
        !b.includes(A.question),
      { timeoutMs: 30_000 },
    );
    r.ok("each panel lists only its own task's decisions", own.ok, "");
    await snap(page, OUT, "page-rest");

    for (const a of [A, B]) {
      const panel = panelOf(page, a);
      await panel.getByText(a.question).first().click();
      await panel.getByRole("button", { name: /^Pick A/ }).click();
    }
    const drafted = await waitFor(
      async () => [
        await panelOf(page, A).innerText(),
        await panelOf(page, B).innerText(),
      ],
      ([a = "", b = ""]) => a.includes("Submit 1") && b.includes("Submit 1"),
      { timeoutMs: 10_000 },
    );
    r.ok("a pick in each panel drafts both", drafted.ok, "");
    await snap(page, OUT, "page");

    // A click on panel A's text (unfocusable: focus lands on the block's
    // caret host, AROUND the panel), then ⌘↵ — the press says which panel.
    await panelOf(page, A).getByText("1 of 1 answered").click();
    await page.keyboard.press("ControlOrMeta+Enter");
    const sent = await waitFor(
      async () => {
        const rows = await db.query<{ task_id: string; n: number }>(
          `SELECT d.task_id, count(x.id)::int AS n FROM decisions d
             LEFT JOIN decision_exchanges x ON x.decision_id = d.id AND x.kind = 'answer'
            WHERE d.task_id = ANY($1) GROUP BY d.task_id`,
          [[A.taskId, B.taskId]],
        );
        return new Map(rows.map((row) => [row.task_id, row.n]));
      },
      (m) => m.get(A.taskId) === 1,
      { timeoutMs: 30_000 },
    );
    r.ok("⌘↵ in panel A sends A's answer", sent.ok, "");
    r.ok(
      "…and not B's: B's decision has no answer",
      (sent.value.get(B.taskId) ?? 0) === 0,
      String(sent.value.get(B.taskId)),
    );
    const bStill = await panelOf(page, B).innerText();
    r.ok("B's draft stays drafted", bStill.includes("Submit 1"), "");

    // The sidebar: B's conversation row counts its Needs you decision.
    await page.goto(pathUrl(`/agents/c/${B.conversationId}`), {
      waitUntil: "domcontentloaded",
    });
    // B's own row (keyed by its task or its conversation), never the tray's
    // header, which speaks the same words.
    const row = page
      .locator(
        `[data-row-key="${B.conversationId}"], [data-row-key="${B.taskId}"]`,
      )
      .first();
    await row.waitFor({ state: "attached", timeout: 30_000 });
    await row.scrollIntoViewIfNeeded();
    const chip = row.getByLabel("1 decision needs you").first();
    const chipShown = await chip
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(() => true)
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "TimeoutError") return false;
        throw err;
      });
    r.ok("B's sidebar row carries the decisions chip", chipShown, "");
    await snap(page, OUT, "sidebar");

    // The page goes to the trash through the write boundary.
    const del = await pageFetch(page, `/api/blocks/${pageId}`, {
      method: "DELETE",
    });
    r.ok("cleanup trashes the page", del.ok, String(del.status));
    await page.close();
    await r.finish();
  });
} finally {
  await cleanup();
}
