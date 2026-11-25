/**
 * An answer reaches a LIVE agent: the part `answer-batch.ts` cannot show (its
 * agents are `starting`, so their turns are held). Costs one short Haiku
 * session.
 *
 *  1. starts a scratch agent (`scratch.hello`, Haiku) told to reply READY and
 *     stop, and waits until it is idle;
 *  2. seeds an open decision on its task;
 *  3. picks A on it in the inbox (`1`), adds a note and presses Submit;
 *  4. the agent's ledger shows ONE event turn naming the decision, and it is
 *     typed into the agent — the agent takes it (`accepted`, then `returned`
 *     once its turn ends);
 *  5. closes the agent and deletes its task.
 *
 * Manual only:
 *   ./equin run plugins/tasks/plugins/decisions/plugins/inbox/e2e/answer-live-agent.ts [--headed]
 */
import {
  agentFetch,
  boot,
  onBeforeFinish,
  openDeployDb,
  pathUrl,
  report,
  withBrowser,
} from "@plugins/framework/plugins/tooling/plugins/e2e-harness/e2e";
import { waitFor } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/plugins/page-ready/core";
import type { E2eScript } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/core";
import { decisionIdKind } from "@plugins/tasks/plugins/decisions/core";

export const e2e = {
  kind: "test",
  target: "build",
  writes: true,
  run: {
    manual: ["external-effects", "heavy"],
    why: "starts a real Claude Code agent (a short Haiku session) to type an answer into",
  },
} satisfies E2eScript;

const db = openDeployDb();
let conversationId: string | null = null;
let taskId: string | null = null;

let cleaned = false;
async function cleanup(): Promise<void> {
  if (cleaned) return;
  cleaned = true;
  if (conversationId !== null)
    await agentFetch(`/api/conversations/${conversationId}/close`, {
      method: "POST",
    });
  if (taskId !== null)
    await db.query("DELETE FROM tasks WHERE id = $1", [taskId]);
  await db.close();
}
onBeforeFinish(cleanup);

const statusOf = async (id: string): Promise<string | undefined> =>
  (
    await db.query<{ status: string }>(
      "SELECT status FROM conversations WHERE id = $1",
      [id],
    )
  )[0]?.status;

try {
  const res = await agentFetch("/api/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: "Reply with the single word READY, then stop.",
      model: "haiku",
      workspace: { kind: "scratch", profile: "scratch.hello", input: {} },
      launchedFrom: "tasks.decisions.inbox",
    }),
  });
  if (!res.ok) throw new Error(`launch: ${res.status} ${await res.text()}`);
  const conversation = (await res.json()) as { id: string; taskId: string };
  conversationId = conversation.id;
  taskId = conversation.taskId;
  const idle = await waitFor(
    () => statusOf(conversation.id),
    (s) => s === "waiting",
    { timeoutMs: 180_000 },
  );
  if (!idle.ok) throw new Error(`the agent never went idle (${idle.value})`);

  const decisionId = decisionIdKind.mint();
  const question = `Live answer ${Date.now().toString(36)}?`;
  await db.query(
    `INSERT INTO decisions (id, task_id, opened_by_conversation_id, label, state, question, body, options)
     VALUES ($1, $2, $3, 'D1', 'decision', $4, '', $5::jsonb)`,
    [
      decisionId,
      taskId,
      conversation.id,
      question,
      JSON.stringify([
        { key: "A", text: "Yes.", recommended: true },
        { key: "B", text: "No.", recommended: false },
      ]),
    ],
  );

  await withBrowser(async (h) => {
    const r = report("decisions — an answer typed into a live agent");
    const { page } = await h.session({
      viewport: { width: 1400, height: 1000 },
    });
    await boot(page, pathUrl("/agents/decisions"), { settleMs: 1500 });
    await page.getByText(question, { exact: true }).first().click();
    await page.getByRole("heading", { name: question }).waitFor();
    await page.locator("body").press("1");
    await page.getByLabel("Your note").last().fill("Thanks, go ahead.");
    await page.getByTestId("decisions-submit").click();

    const turn = await waitFor(
      () =>
        db.query<{ state: string; text: string }>(
          "SELECT state, text FROM conversation_turns WHERE conversation_id = $1 AND kind = 'event'",
          [conversation.id],
        ),
      (rows) =>
        rows.length === 1 &&
        (rows[0]!.state === "accepted" || rows[0]!.state === "returned"),
      { timeoutMs: 120_000 },
    );
    r.ok(
      "one event turn, taken by the agent",
      turn.ok,
      JSON.stringify(turn.value.map((t) => t.state)),
    );
    r.ok(
      "it names the decision and the pick",
      turn.value[0]?.text.includes(`decision="${decisionId}"`) === true &&
        turn.value[0].text.includes('pick="A"'),
      turn.value[0]?.text ?? "(none)",
    );
    const sent = await db.query<{ kind: string; turn_id: string | null }>(
      "SELECT kind, turn_id FROM decision_exchanges WHERE decision_id = $1",
      [decisionId],
    );
    r.eq(
      "an answer exchange, linked to the turn",
      sent.map((e) => [e.kind, e.turn_id !== null]),
      [["answer", true]],
    );
    await page.close();
    await r.finish();
  });
} finally {
  await cleanup();
}
