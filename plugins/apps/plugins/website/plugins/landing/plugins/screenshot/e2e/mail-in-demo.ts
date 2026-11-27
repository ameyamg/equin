/**
 * Mail runs in the demo on the browser worker
 * (research/2026-11-27-global-mail-in-browser-demo.md, §6 and Verification).
 *
 * On the homepage's live demo (`/about`), it:
 *
 *  1. opens the launcher inside the embed and picks Mail: the embed switches
 *     to Mail, whose Inbox lists exactly the threads Demo's mailbox
 *     (`website/demos/workspace`'s `story/core/internal/mail.ts`, `DEMO_MAIL`)
 *     puts there — read from the local provider on the worker, never a
 *     connect surface;
 *  2. opens the concert hall's newsletter: its HTML body renders in the
 *     reader's frame, its inline (`cid:`) picture drawn from the worker;
 *  3. opens the Lisbon guesthouse thread: its PDF ticket is offered as a file
 *     (not "not available here");
 *  4. marks a thread Done: it leaves the Inbox, and the Done view holds it;
 *  5. composes and sends a message to a `.example` address: once the
 *     undo-send delay passes, the outbox says "Message sent" and Sent lists it;
 *  6. reloads the page: the Done thread is still out of the Inbox and the
 *     sent message still in Sent.
 *
 * And asserts, throughout, the demo's rule (`internal/page-origin.ts`): no
 * page-origin `/api/…` request issued from inside the demo — the mail frame's
 * images included — no page socket, no page or console error, and every
 * request to another origin goes to a host a scoped plugin declares.
 *
 * `--site` drives the standalone website's live demo (a build of the
 * `website` composition: `./equin build --composition website`, then
 * `--composition website`) instead of main's `/about`.
 *
 * Manual only — nothing runs this automatically.
 *   ./equin run plugins/apps/plugins/website/plugins/landing/plugins/screenshot/e2e/mail-in-demo.ts [--out /tmp/demo-mail] [--site --composition website] [--headed]
 */
import type { Locator, Page, WebSocket } from "playwright";
import { pickFromLauncher } from "@plugins/apps-core/plugins/app-launcher/e2e";
import { externalHosts } from "@plugins/apps/plugins/website/plugins/demos/plugins/workspace/core";
import { DEMO_MAIL } from "@plugins/apps/plugins/website/plugins/demos/plugins/workspace/plugins/story/core";
import {
  arg,
  flag,
  pathUrl,
  report,
  snap,
  tapSharedWorkerRequests,
  withBrowser,
} from "@plugins/framework/plugins/tooling/plugins/e2e-harness/e2e";
import {
  waitFor,
  waitForNetworkIdle,
  type Settled,
} from "@plugins/framework/plugins/tooling/plugins/e2e-harness/plugins/page-ready/core";
import {
  AGENT_MANAGER_LOCATION,
  bootDemo,
  demoPath,
  enterDemo,
  MARKER,
  onDemoPage,
} from "./internal/demo-pages";
import { watchPageOrigin } from "./internal/page-origin";
import type { E2eScript } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/core";

export const e2e = {
  kind: "test",
  target: "build",
  writes: false,
  run: "auto",
} satisfies E2eScript;

const OUT = arg("out") ?? "/tmp/demo-mail";
/** Drive the standalone website's live demo (the `website` composition) instead of main's `/about`. */
const SITE = flag("site");

type Thread = (typeof DEMO_MAIL.threads)[number];
type Message = Thread["messages"][number];

/** A message's mailboxes (absent: the Inbox, as the fixture reads it). */
const boxesOf = (m: Message): readonly string[] => m.mailboxes ?? ["inbox"];
/**
 * Whether the Inbox lists `t`: one of its messages is in the Inbox, and none
 * is in Spam or Trash (every view but those leaves them out).
 */
const inInbox = (t: Thread): boolean =>
  t.messages.some((m) => boxesOf(m).includes("inbox")) &&
  !t.messages.some(
    (m) => boxesOf(m).includes("spam") || boxesOf(m).includes("trash"),
  );
/** The Inbox's threads, by id (`DEMO_MAIL`). */
const INBOX = DEMO_MAIL.threads.filter(inInbox).map((t) => t.id);

/** The thread whose message has `filename` attached. */
function threadWith(pred: (m: Message) => boolean, what: string): Thread {
  const t = DEMO_MAIL.threads.find((th) => th.messages.some(pred));
  if (t === undefined) throw new Error(`DEMO_MAIL has no thread with ${what}`);
  return t;
}
/** An Inbox thread whose HTML body shows an inline (`cid:`) picture. */
const HTML_THREAD = threadWith(
  (m) =>
    m.html !== undefined &&
    (m.attachments ?? []).some((a) => a.contentId !== undefined),
  "an HTML body and an inline picture",
);
/** The Lisbon guesthouse's thread, its PDF ticket attached. */
const PDF = "Fado night ticket.pdf";
const PDF_THREAD = threadWith(
  (m) => (m.attachments ?? []).some((a) => a.filename === PDF),
  PDF,
);
/** The thread marked Done: the newest plain Inbox thread no other step opens. */
const DONE_THREAD = (() => {
  const id = INBOX.find(
    (tid) => tid !== HTML_THREAD.id && tid !== PDF_THREAD.id,
  );
  if (id === undefined)
    throw new Error("DEMO_MAIL's Inbox has no thread to mark Done");
  return id;
})();
/** The message sent: to a `.example` address, its subject unique to the run. */
const SEND_TO = "ana.ribeiro@correio.example";
const SEND_SUBJECT = `Fado night, Saturday ${Date.now().toString(36)}`;
const SEND_BODY = "Mariana booked us two seats at Tasca da Lua. See you there!";

/** How long an app swap, a worker read or a write gets. */
const RENDER_TIMEOUT_MS = 30_000;
/** How long a send gets: the undo-send delay (Settings → Config, 10 s) and the send job. */
const SEND_TIMEOUT_MS = 60_000;
/** What shows once Mail's Inbox has drawn its rows in the demo. */
const MAIL_MARKER = '[data-app-embed="mail"] [data-row-key]';

function embedRoot(page: Page): Locator {
  return page.locator("[data-app-embed]").first();
}
/** The rows the threads list draws, by thread id. */
async function rowIds(page: Page): Promise<string[]> {
  return await embedRoot(page)
    .locator("[data-row-key]")
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-row-key") ?? ""),
    );
}
/** A view in the Mail sidebar, by its name (the reader, which says Done too, closed). */
function sidebarView(page: Page, name: string): Locator {
  return embedRoot(page).getByText(name, { exact: true }).first();
}

await withBrowser(async (h) => {
  const r = report(
    `demo: Mail on the browser worker${SITE ? " (the website's live demo)" : ""}`,
  );
  const worker = await tapSharedWorkerRequests(h.browser);
  const { page, captured } = await h.session({
    viewport: { width: 1440, height: 900 },
  });

  await bootDemo(page, pathUrl(demoPath(AGENT_MANAGER_LOCATION)), {
    marker: MARKER,
  });
  await waitForNetworkIdle(page);
  const origin = new URL(page.url()).origin;
  const declared = new Set(externalHosts.map((x) => x.host));

  const pageRequests = watchPageOrigin(page, r);
  const openedSockets: string[] = [];
  const onSocket = (ws: WebSocket): void => {
    openedSockets.push(new URL(ws.url()).pathname);
  };
  page.on("websocket", onSocket);

  const renders = async <T>(
    name: string,
    read: () => Promise<T>,
    ok: (value: T) => boolean,
    timeoutMs = RENDER_TIMEOUT_MS,
  ): Promise<Settled<T>> => {
    const settled = await waitFor(read, ok, { timeoutMs });
    r.ok(
      name,
      settled.ok,
      `${JSON.stringify(settled.value)} (waited ${settled.waitedMs} ms)`,
    );
    return settled;
  };
  const sameSet = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((x) => b.includes(x));

  // ── 1. launcher → Mail: the Inbox DEMO_MAIL predicts ────────────────────
  r.ok(
    "the launcher offers Mail",
    await pickFromLauncher(embedRoot(page), /^\s*Mail\s*$/),
  );
  await renders(
    "the embed switches to Mail",
    () => embedRoot(page).getAttribute("data-app-embed"),
    (id) => id === "mail",
  );
  await renders(
    `the Inbox lists DEMO_MAIL's ${INBOX.length} Inbox threads`,
    () => rowIds(page),
    (ids) => sameSet(ids, INBOX),
  );
  r.eq(
    "no connect surface: the local mailbox answers",
    await embedRoot(page)
      .getByText(/No local mailbox|Connect/)
      .count(),
    0,
  );
  r.ok("the page stays on the demo", onDemoPage(page.url()), page.url());
  await snap(page, OUT, "1-inbox");

  // ── 2. an HTML body with its inline picture ─────────────────────────────
  await embedRoot(page).locator(`[data-row-key="${HTML_THREAD.id}"]`).click();
  const htmlFrame = embedRoot(page)
    .locator(`[data-mail-thread="${HTML_THREAD.id}"] iframe`)
    .first();
  await renders(
    `"${HTML_THREAD.messages[0]!.subject}" renders its HTML body in a frame`,
    () => htmlFrame.count(),
    (n) => n > 0,
  );
  await renders(
    "the body's inline picture is drawn (a data: image, loaded)",
    () =>
      htmlFrame
        .contentFrame()
        .locator("img")
        .evaluateAll((imgs) =>
          imgs.map((img) => {
            const el = img as HTMLImageElement;
            return {
              data: el.src.startsWith("data:image/"),
              loaded: el.complete && el.naturalWidth > 0,
            };
          }),
        ),
    (imgs) => imgs.length > 0 && imgs.every((i) => i.data && i.loaded),
  );
  await snap(page, OUT, "2-html-thread");

  // ── 3. the guesthouse's PDF ticket ──────────────────────────────────────
  await embedRoot(page).locator(`[data-row-key="${PDF_THREAD.id}"]`).click();
  const ticket = embedRoot(page)
    .locator(`[data-mail-thread="${PDF_THREAD.id}"]`)
    .getByRole("link", { name: new RegExp(PDF.replace(/\./g, "\\.")) })
    .first();
  await renders(
    `the guesthouse thread offers ${PDF}`,
    () => ticket.count(),
    (n) => n > 0,
  );
  r.ok(
    "the ticket opens from the worker's bytes (a blob: URL)",
    ((await ticket.getAttribute("href")) ?? "").startsWith("blob:"),
    (await ticket.getAttribute("href")) ?? "none",
  );
  await snap(page, OUT, "3-pdf-thread");

  // ── 4. Done: the thread leaves the Inbox ────────────────────────────────
  await embedRoot(page).getByRole("button", { name: "Close" }).first().click();
  const doneRow = embedRoot(page).locator(`[data-row-key="${DONE_THREAD}"]`);
  await doneRow.hover();
  await doneRow.getByRole("button", { name: "Done", exact: true }).click();
  await renders(
    `"${DONE_THREAD}" leaves the Inbox`,
    () => rowIds(page),
    (ids) =>
      sameSet(
        ids,
        INBOX.filter((id) => id !== DONE_THREAD),
      ),
  );
  await sidebarView(page, "Done").click();
  await renders(
    "the Done view holds it",
    () => rowIds(page),
    (ids) => ids.includes(DONE_THREAD),
  );

  // ── 5. compose and send ─────────────────────────────────────────────────
  await embedRoot(page)
    .getByRole("button", { name: "Compose" })
    .first()
    .click();
  await page.getByLabel("To", { exact: true }).last().fill(SEND_TO);
  await page.getByLabel("Subject", { exact: true }).last().fill(SEND_SUBJECT);
  await page.getByLabel("Message", { exact: true }).last().fill(SEND_BODY);
  await page.getByRole("button", { name: "Send", exact: true }).last().click();
  await renders(
    "the outbox says Sending…, then Message sent",
    () => page.getByText("Message sent").count(),
    (n) => n > 0,
    SEND_TIMEOUT_MS,
  );
  await sidebarView(page, "Sent").click();
  await renders(
    `Sent lists "${SEND_SUBJECT}"`,
    () => embedRoot(page).getByText(SEND_SUBJECT).count(),
    (n) => n > 0,
  );
  await snap(page, OUT, "4-sent");

  // ── 6. reload: both changes stay ────────────────────────────────────────
  page.off("websocket", onSocket);
  await page.goto(pathUrl(demoPath("/mail")));
  await enterDemo(page, { marker: MAIL_MARKER });
  page.on("websocket", onSocket);
  // The list reopens on the view last shown (Sent): back to the Inbox.
  await sidebarView(page, "Inbox").click();
  await renders(
    `after a reload, the Inbox still leaves "${DONE_THREAD}" out`,
    () => rowIds(page),
    (ids) =>
      sameSet(
        ids,
        INBOX.filter((id) => id !== DONE_THREAD),
      ),
  );
  await sidebarView(page, "Sent").click();
  await renders(
    `after a reload, Sent still lists "${SEND_SUBJECT}"`,
    () => embedRoot(page).getByText(SEND_SUBJECT).count(),
    (n) => n > 0,
  );
  await snap(page, OUT, "5-reloaded");
  r.ok("the page stays on the demo", onDemoPage(page.url()), page.url());
  page.off("websocket", onSocket);

  // ── assertions ──────────────────────────────────────────────────────────
  await pageRequests.finish();
  r.eq("the page opened no socket of its own", openedSockets, []);
  const workerHosts = worker.requests
    .map((req) => new URL(req.url))
    .filter((url) => url.origin !== origin && url.protocol.startsWith("http"))
    .map((url) => url.host);
  const reached = [
    ...new Set([...pageRequests.offOrigin.map((o) => o.host), ...workerHosts]),
  ].sort();
  r.note(`third-party hosts reached: ${reached.join(", ") || "none"}`);
  r.eq(
    "every third-party host reached is declared (ExternalHosts.Declare)",
    reached.filter((host) => !declared.has(host)),
    [],
  );
  r.eq("no page errors", captured.pageErrors, []);
  r.eq("no console errors", captured.consoleErrors, []);
  await worker.stop();
  await r.finish();
});
