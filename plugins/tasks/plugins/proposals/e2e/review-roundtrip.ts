/**
 * An agent's proposals reviewed end to end on this checkout's build, which
 * plays main: proposals arrive through the same `incoming` / attachment
 * routes a worktree's `./equin propose` posts to main, and the user answers
 * them in Deploy → Feeds through the UI only:
 *
 * 1. a draft tip exists; a proposal rewrites its title and text and adds a
 *    screenshot (the file imported first under its own id), another proposes
 *    a new tip;
 * 2. the Proposed tab counts both, the items list wears the Proposal chip;
 * 3. the opened tip shows the review — the tip now beside the tip after
 *    accepting, both drawn as the site draws them — and Accept writes the
 *    change through the editor's own save (the screenshot linked to the item);
 * 4. the new tip: Request changes → the note is kept, a v2 arrives and
 *    supersedes it, Edit then accept → the tip is created as a draft under its
 *    proposed id with the user's edited title;
 * 5. a third proposal is rejected, and re-sent as it was it is not proposed
 *    again (`decided`); a record that matches main is `unchanged`.
 *
 * The author is a FINISHED conversation of this database (a decision is told
 * to no running agent). What it made is removed at the end (also on failure).
 *
 *   ./equin run plugins/tasks/plugins/proposals/e2e/review-roundtrip.ts [--headed]
 */
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentFetch,
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
import { siteFeedEntryIdKind } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";

export const e2e = {
  kind: "test",
  target: "build",
  writes: true,
  run: "auto",
} satisfies E2eScript;

const OUT = arg("out") ?? join(tmpdir(), "proposals-review-roundtrip");
const PREFIX = "e2e-proposals-";
const tag = `${PREFIX}${randomBytes(3).toString("hex")}`;
const OLD_TITLE = `Split a pane (${tag})`;
const NEW_TITLE = `Split any pane in two (${tag})`;
const NEW_BODY = "Drag a tab to the edge of a pane: it splits in two.";
const FRESH_TITLE = `Find in a pane (${tag})`;
const EDITED_TITLE = `Find inside any pane (${tag})`;

const db = openDeployDb();

/** A JSON request's answer, or a throw naming it. */
async function call<T>(path: string, init: RequestInit): Promise<T> {
  const res = await agentFetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** A 1×1 PNG. */
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

const ownItems = () =>
  db.query<{ id: string }>(
    "SELECT id FROM site_feed_items WHERE values->>'title' LIKE $1",
    [`%(${PREFIX}%`],
  );

let cleaned = false;
onBeforeFinish(async () => {
  if (cleaned) return;
  cleaned = true;
  await db.query("DELETE FROM proposals WHERE note LIKE $1", [`%${PREFIX}%`]);
  for (const { id } of await ownItems()) {
    await call(`/api/deploy/site-feeds/items/${id}`, { method: "DELETE" });
  }
  await db.close();
});

// 0. A killed run's leftovers.
await db.query("DELETE FROM proposals WHERE note LIKE $1", [`%${PREFIX}%`]);
for (const { id } of await ownItems()) {
  await call(`/api/deploy/site-feeds/items/${id}`, { method: "DELETE" });
}

// 1. The author: a conversation of this database whose task's agents all finished.
const [author] = await db.query<{ id: string }>(
  `SELECT c.id FROM public.conversations c JOIN attempts a ON a.id = c.attempt_id
    WHERE c.status = 'done'
      AND NOT EXISTS (SELECT 1 FROM public.conversations c2 JOIN attempts a2 ON a2.id = c2.attempt_id
                       WHERE a2.task_id = a.task_id AND c2.status <> 'done')
    ORDER BY c.created_at DESC LIMIT 1`,
);
if (author === undefined)
  throw new Error("no finished agent conversation here");

// 2. A draft tip, as main holds it.
const created = await call<{ kind: string; id: string }>(
  "/api/deploy/site-feeds/items",
  { method: "POST", body: JSON.stringify({ feedId: "tips" }) },
);
const itemId = created.id;
await call(`/api/deploy/site-feeds/items/${itemId}`, {
  method: "PATCH",
  body: JSON.stringify({ set: { title: OLD_TITLE, body: "Drag a tab." } }),
});

// 3. What a worktree sends: its file first (under its own id), then the records.
const attachmentId = crypto.randomUUID();
const missing = await call<{ missing: string[] }>(
  "/api/proposals/attachments/missing",
  { method: "POST", body: JSON.stringify({ ids: [attachmentId] }) },
);
const imported = await agentFetch(
  `/api/proposals/attachments/${attachmentId}?filename=split.png&mime=image%2Fpng&size=${PNG.byteLength}`,
  { method: "PUT", body: PNG },
);
if (!imported.ok)
  throw new Error(`import: ${imported.status} ${await imported.text()}`);
const media = [
  {
    attachmentId,
    filename: "split.png",
    mime: "image/png",
    size: PNG.byteLength,
    width: 1,
    height: 1,
  },
];
const forkedAt = new Date(Date.now() - 3_600_000).toISOString();
const propose = (
  recordId: string,
  values: Record<string, unknown>,
  note: string,
) =>
  call<{ kind: string; id?: string; revision?: number; changed?: string[] }>(
    "/api/proposals/incoming",
    {
      method: "POST",
      body: JSON.stringify({
        type: "site-feed-item",
        scope: "tips",
        recordId,
        values,
        note: `${note} (${tag})`,
        conversationId: author.id,
        worktree: "e2e",
        forkedAt,
      }),
    },
  );
const edit = await propose(
  itemId,
  { title: NEW_TITLE, body: NEW_BODY, media },
  "Clearer title, one sentence, a screenshot.",
);
const freshId = siteFeedEntryIdKind.mint();
const fresh = await propose(
  freshId,
  { title: FRESH_TITLE, body: "Press Ctrl+F in a pane.", media: [] },
  "New tip: find in a pane.",
);
const same = await propose(
  itemId,
  { title: OLD_TITLE, body: "Drag a tab.", media: [] },
  "Nothing really.",
);

await withBrowser(async (h) => {
  const r = report(
    "Proposals · receive → review in Feeds → accept / request changes / edit then accept / reject",
  );
  r.ok(
    "main lacked the proposal's file",
    missing.missing.includes(attachmentId),
    JSON.stringify(missing),
  );
  r.ok(
    "an edit is stored as an open proposal of what it changes",
    edit.kind === "proposed" &&
      JSON.stringify(edit.changed) === '["title","body","media"]',
    JSON.stringify(edit),
  );
  r.ok(
    "a new tip is stored as a proposal",
    fresh.kind === "proposed",
    JSON.stringify(fresh),
  );
  r.ok(
    "a record matching main's is unchanged",
    same.kind === "unchanged",
    JSON.stringify(same),
  );

  const { page } = await h.session({ viewport: { width: 1440, height: 1100 } });
  await boot(page, pathUrl("/deploy/feeds"), {
    marker: "text=Tips of the day",
    timeoutMs: 120_000,
    settleMs: 500,
  });

  // The items list wears the chip; the tab counts both.
  const chip = await waitFor(
    () => page.locator(`[data-row-key="${itemId}"]`).first().innerText(),
    (t) => t.includes("Proposed"),
    { timeoutMs: 30_000 },
  );
  r.ok("the proposed tip's row wears the Proposed chip", chip.ok, chip.value);
  await page
    .getByRole("radio", { name: /Proposed/ })
    .or(page.getByRole("tab", { name: /Proposed/ }))
    .or(page.getByRole("button", { name: /^Proposed/ }))
    .first()
    .click();
  const listed = await waitFor(
    () => page.locator("body").innerText(),
    (t) => t.includes(NEW_TITLE) && t.includes(FRESH_TITLE),
    { timeoutMs: 30_000 },
  );
  r.ok("the Proposed tab lists the edit and the new tip", listed.ok);
  await snap(page, OUT, "proposed-tab");

  // Open the edit: the review, now beside after accepting.
  await page.getByText(NEW_TITLE).first().click();
  const review = await waitFor(
    () => page.locator("body").innerText(),
    (t) =>
      // The side labels are eyebrows (drawn in capitals).
      t.toLowerCase().includes("after accepting") &&
      t.toLowerCase().includes("now\n") &&
      t.includes("Clearer title, one sentence") &&
      t.includes(OLD_TITLE),
    { timeoutMs: 60_000 },
  );
  r.ok(
    "the opened tip shows the review: now and after accepting, drawn as the site draws them",
    review.ok,
  );
  const previewImg = await waitFor(
    () => page.locator('article img[alt="split.png"]').count(),
    (n) => n > 0,
    { timeoutMs: 30_000 },
  );
  r.ok(
    "the preview draws the proposed screenshot from this instance's attachments",
    previewImg.ok,
  );
  await snap(page, OUT, "review-edit");
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  const accepted = await waitFor(
    () =>
      db.query<{ title: string; media: number; state: string; links: number }>(
        `SELECT i.values->>'title' AS title, jsonb_array_length(i.values->'media') AS media,
                p.state, (SELECT count(*)::int FROM site_feed_items_attachments a WHERE a.owner_id = i.id) AS links
           FROM site_feed_items i, proposals p WHERE i.id = $1 AND p.id = $2`,
        [itemId, edit.id],
      ),
    (rows) => rows[0]?.state === "accepted",
    { timeoutMs: 30_000 },
  );
  const row = accepted.value?.[0];
  r.ok(
    "Accept writes the change through the editor's save, its screenshot linked to the item",
    accepted.ok &&
      row?.title === NEW_TITLE &&
      row.media === 1 &&
      row.links === 1,
    JSON.stringify(accepted.value),
  );

  // The new tip: request changes.
  await page.getByText(FRESH_TITLE).first().click();
  await page.getByRole("button", { name: "Request changes" }).click();
  await page
    .getByPlaceholder("What should change?")
    .fill("Say which key opens it.");
  await page.getByRole("button", { name: "Send to the agent" }).click();
  const requested = await waitFor(
    () =>
      db.query<{ state: string; decision_note: string }>(
        "SELECT state, decision_note FROM proposals WHERE id = $1",
        [fresh.id],
      ),
    (rows) => rows[0]?.state === "changes-requested",
    { timeoutMs: 30_000 },
  );
  r.ok(
    "Request changes keeps the note on the proposal",
    requested.ok &&
      requested.value?.[0]?.decision_note === "Say which key opens it.",
    JSON.stringify(requested.value),
  );
  const told = await page
    .getByText("The agent had already finished")
    .first()
    .waitFor({ timeout: 15_000 })
    .then(() => true)
    .catch((err: unknown) => {
      if (err instanceof Error && err.name === "TimeoutError") return false;
      throw err;
    });
  r.ok("the review says a finished agent was not told", told);

  // v2 arrives and replaces it.
  const v2 = await propose(
    freshId,
    {
      title: FRESH_TITLE,
      body: "Press Ctrl+F in a pane to find in it.",
      media: [],
    },
    "Said the key.",
  );
  const superseded = await db.query<{ state: string }>(
    "SELECT state FROM proposals WHERE id = $1",
    [fresh.id],
  );
  r.ok(
    "a v2 supersedes the proposal that came back",
    v2.kind === "proposed" &&
      v2.revision === 2 &&
      superseded[0]?.state === "superseded",
    JSON.stringify({ v2, superseded }),
  );

  // Edit then accept the v2.
  const v2Shown = await waitFor(
    () => page.locator("body").innerText(),
    (t) => t.includes("Said the key."),
    { timeoutMs: 30_000 },
  );
  if (!v2Shown.ok) await page.getByText(FRESH_TITLE).first().click();
  await page.getByRole("button", { name: "Edit then accept" }).click();
  const draftTitle = page
    .locator('[data-ui-owner^="ProposalReview@"] input:not([type="file"])')
    .first();
  await draftTitle.fill(EDITED_TITLE);
  await draftTitle.press("Tab");
  await snap(page, OUT, "edit-then-accept");
  await page.getByRole("button", { name: "Accept with my edits" }).click();
  const createdNew = await waitFor(
    () =>
      db.query<{ title: string; state: string }>(
        "SELECT values->>'title' AS title, state FROM site_feed_items WHERE id = $1",
        [freshId],
      ),
    // The create inserts the draft, then saves the values over it.
    (rows) => rows[0]?.title === EDITED_TITLE,
    { timeoutMs: 30_000 },
  );
  r.ok(
    "Edit then accept creates the new tip as a draft under its proposed id, with the user's title",
    createdNew.ok &&
      createdNew.value?.[0]?.title === EDITED_TITLE &&
      createdNew.value[0].state === "draft",
    JSON.stringify(createdNew.value),
  );

  // Reject.
  const third = await propose(
    itemId,
    { title: `Worse (${tag})`, body: NEW_BODY, media },
    "A worse title.",
  );
  const rejected = await call<{ kind: string; state?: string }>(
    `/api/proposals/${third.id}/decide`,
    { method: "POST", body: JSON.stringify({ decision: "reject" }) },
  );
  const after = await db.query<{ title: string }>(
    "SELECT values->>'title' AS title FROM site_feed_items WHERE id = $1",
    [itemId],
  );
  r.ok(
    "a rejected proposal changes nothing",
    rejected.kind === "decided" &&
      rejected.state === "rejected" &&
      after[0]?.title === NEW_TITLE,
    JSON.stringify({ rejected, after }),
  );
  // The next propose re-sends every record the worktree changed: the one the
  // user just rejected comes back unchanged and is not proposed again.
  const again = await propose(
    itemId,
    { title: `Worse (${tag})`, body: NEW_BODY, media },
    "A worse title, re-sent.",
  );
  r.ok(
    "a record re-sent as the user already decided it is not proposed again",
    again.kind === "decided",
    JSON.stringify(again),
  );
  await snap(page, OUT, "done");
});
