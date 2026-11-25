/**
 * A site-feed item's whole life, end to end on this checkout's build, through
 * the UI: Deploy → a `website` site → Feeds → New item → title, text, a
 * screenshot and a short video → Publish → the tip is on the site's Tips page
 * (`/about/tips`) and its video seeks (the media route answers byte ranges,
 * 206) → edit the title → the page shows the new one → Unpublish → the tip is
 * gone and its media route answers 404.
 *
 * The site's box is THIS instance: the script registers a server and a
 * `website` deployment through the Deploy app's own endpoints, then marks the
 * server a stand-in box (`deploy_host_stand_ins`, the row
 * `markServerBoxIsThisInstance` writes — `deploy/host-query`), seeded through
 * the harness's deploy DB as any e2e seeds rows. The publish job then runs
 * its real flow (missing media → staged copy → import → upsert) against this
 * instance's own host-only routes, with no SSH.
 *
 * Everything it made is removed at the end (also on failure), and a killed
 * run's leftovers (servers named `e2e-site-feeds-…`) first.
 *
 *   ./equin run plugins/apps/plugins/deploy/plugins/site-feeds/plugins/editor/e2e/publish-roundtrip.ts [--headed]
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
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
import { resolveFfmpeg } from "@plugins/media/plugins/ffmpeg/deps";
import { spawnExpectOk } from "@plugins/infra/plugins/spawn/core";

export const e2e = {
  kind: "test",
  target: "build",
  writes: true,
  run: "auto",
} satisfies E2eScript;

const OUT = arg("out") ?? join(tmpdir(), "site-feeds-publish-roundtrip");
const PREFIX = "e2e-site-feeds-";
const tag = `${PREFIX}${randomBytes(3).toString("hex")}`;
const TITLE = `Split a pane (${tag})`;
const TITLE_EDITED = `Split any pane (${tag})`;
const BODY = "Drag a tab to the edge of a pane.\nIt splits in two.";

const db = openDeployDb();
const scratch = await mkdtemp(join(tmpdir(), "site-feeds-roundtrip-"));

/** Delete a server and every deployment on it, through the Deploy app's endpoints. */
async function removeServer(serverId: string): Promise<void> {
  const deps = await db.query<{ id: string }>(
    "SELECT id FROM deploy_deployments WHERE server_id = $1",
    [serverId],
  );
  for (const { id } of deps) {
    // Its items cascade with it; what a killed run left published on the box
    // (this instance) is unpublished first, as the editor would.
    const items = await db.query<{ id: string }>(
      "SELECT id FROM site_feed_items WHERE deployment_id = $1",
      [id],
    );
    for (const item of items) {
      const res = await agentFetch(
        `/api/deploy/site-feeds/items/${item.id}/unpublish`,
        { method: "POST" },
      );
      if (!res.ok)
        throw new Error(
          `unpublish ${item.id}: ${res.status} ${await res.text()}`,
        );
    }
    if (items.length > 0) {
      await waitFor(
        () =>
          db.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM site_feed_entries WHERE id = ANY($1)",
            [items.map((i) => i.id)],
          ),
        (rows) => rows[0]?.n === 0,
        { timeoutMs: 60_000 },
      );
    }
    const res = await agentFetch(`/api/deploy/deployments/${id}`, {
      method: "DELETE",
    });
    if (!res.ok)
      throw new Error(
        `delete deployment ${id}: ${res.status} ${await res.text()}`,
      );
  }
  const res = await agentFetch(`/api/deploy/servers/${serverId}`, {
    method: "DELETE",
  });
  if (!res.ok)
    throw new Error(
      `delete server ${serverId}: ${res.status} ${await res.text()}`,
    );
}

let serverId: string | null = null;
let cleaned = false;
onBeforeFinish(async () => {
  if (cleaned) return;
  cleaned = true;
  if (serverId !== null) await removeServer(serverId);
  await db.close();
  await rm(scratch, { recursive: true, force: true });
});

/** A request's answer, or a throw naming it. */
async function call<T>(path: string, init: RequestInit): Promise<T> {
  const res = await agentFetch(path, {
    ...init,
    headers: { "content-type": "application/json" },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/**
 * The opened item's editor, and its first text input (the feed's Title). The
 * form's fields carry no accessible name (FieldRenderer labels are not
 * associated with their inputs), so they are found by place.
 */
const EDITOR = '[data-ui-owner^="ItemForm@"]';
const titleBox = (page: Page) =>
  page.locator(`${EDITOR} input:not([type="file"])`).first();

/** The page's whole text. */
const pageText = (page: Page) => page.evaluate(() => document.body.innerText);

// 0. A killed run's leftovers.
for (const { id } of await db.query<{ id: string }>(
  "SELECT id FROM deploy_servers WHERE name LIKE $1",
  [`${PREFIX}%`],
))
  await removeServer(id);

// 1. Media: a screenshot and a 4 s video, made with ffmpeg.
const ff = await resolveFfmpeg();
const png = join(scratch, "split-pane.png");
const mp4 = join(scratch, "split-pane.mp4");
await spawnExpectOk(
  [
    ff.ffmpeg,
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=640x360:rate=1:duration=1",
    "-frames:v",
    "1",
    png,
  ],
  { timeoutMs: 60_000 },
);
await spawnExpectOk(
  [
    ff.ffmpeg,
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=640x360:rate=30:duration=4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    mp4,
  ],
  { timeoutMs: 60_000 },
);

// 2. The site: a `website` deployment on a server whose box is this instance.
const server = await call<{ id: string }>("/api/deploy/servers", {
  method: "POST",
  body: JSON.stringify({ name: tag, host: "127.0.0.1" }),
});
serverId = server.id;
const deployment = await call<{ id: string }>("/api/deploy/deployments", {
  method: "POST",
  body: JSON.stringify({ compositionId: "website", serverId: server.id }),
});
await db.query(
  "INSERT INTO deploy_host_stand_ins (server_id) VALUES ($1) ON CONFLICT DO NOTHING",
  [server.id],
);

await withBrowser(async (h) => {
  const r = report("Site feeds · publish → edit → unpublish, end to end");
  const { page } = await h.session({ viewport: { width: 1440, height: 1000 } });

  // 3. Deploy → the site → Feeds → New item.
  await boot(page, pathUrl(`/deploy/site/${deployment.id}/feeds`), {
    marker: "text=Tips of the day",
    timeoutMs: 120_000,
    settleMs: 500,
  });
  r.ok("the site's Feeds tab lists the tips feed", true);
  await page.getByRole("button", { name: "New item" }).click();
  const title = titleBox(page);
  await title.waitFor({ timeout: 30_000 });
  await title.fill(TITLE);
  await title.press("Tab");
  const body = page.locator(`${EDITOR} textarea`).first();
  await body.fill(BODY);
  await body.press("Tab");
  await page.locator('input[type="file"]').first().setInputFiles([png, mp4]);

  // The item holds both files once uploaded and saved.
  const saved = await waitFor(
    () =>
      db.query<{ values: { title: string; body: string; media: unknown[] } }>(
        "SELECT values FROM site_feed_items WHERE deployment_id = $1",
        [deployment.id],
      ),
    (rows) =>
      rows.length === 1 &&
      rows[0]?.values.title === TITLE &&
      rows[0]?.values.body === BODY &&
      rows[0]?.values.media.length === 2,
    { timeoutMs: 60_000 },
  );
  r.ok(
    "the draft saves its title, text and two files",
    saved.ok,
    JSON.stringify(saved.value),
  );
  const [item] = await db.query<{ id: string }>(
    "SELECT id FROM site_feed_items WHERE deployment_id = $1",
    [deployment.id],
  );
  if (item === undefined) throw new Error("no item was created");

  // The list's search matches the item's text (and nothing else).
  const search = page.getByRole("textbox", { name: "Search…" }).first();
  if ((await search.count()) > 0) {
    await search.fill("splits in two");
    const found = await waitFor(
      () => page.getByText(TITLE).count(),
      (n) => n > 0,
      { timeoutMs: 15_000 },
    );
    r.ok("the list's search finds the item by its text", found.ok);
    await search.fill(`${tag}-nothing-says-this`);
    const hidden = await waitFor(
      () => page.getByText(TITLE).count(),
      (n) => n === 0,
      { timeoutMs: 15_000 },
    );
    r.ok("the list's search leaves out an item that does not match", hidden.ok);
    await search.fill("");
  } else {
    r.ok("the list's search box is drawn", false, "no dv.search input");
  }
  await snap(page, OUT, "draft");

  // 4. Publish.
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const published = await waitFor(
    () =>
      db.query<{
        state: string;
        publish_state: string;
        publish_error: string | null;
      }>(
        "SELECT state, publish_state, publish_error FROM site_feed_items WHERE id = $1",
        [item.id],
      ),
    (rows) =>
      rows[0]?.publish_state === "failed" ||
      (rows[0]?.state === "published" && rows[0]?.publish_state === "idle"),
    { timeoutMs: 120_000 },
  );
  r.ok(
    "Publish lands the item on the box",
    published.ok && published.value?.[0]?.state === "published",
    JSON.stringify(published.value),
  );
  await snap(page, OUT, "published");

  // 5. The Tips page shows it; the video plays from byte ranges.
  const ranged: number[] = [];
  page.on("response", (res) => {
    if (
      res.url().includes("/api/site-feeds/media/") &&
      res.request().resourceType() === "media"
    )
      ranged.push(res.status());
  });
  await page.goto(pathUrl("/about/tips"));
  const shown = await waitFor(
    () => pageText(page),
    (t) => t.includes(TITLE) && t.includes("It splits in two."),
    { timeoutMs: 60_000 },
  );
  r.ok("the Tips page shows the published tip", shown.ok);
  const img = page.locator(`article img[alt="split-pane.png"]`);
  const imgOk = await waitFor(
    () => img.evaluate((el) => (el as HTMLImageElement).naturalWidth),
    (w) => w === 640,
    { timeoutMs: 30_000 },
  );
  r.ok("its screenshot loads", imgOk.ok, String(imgOk.value));
  const video = page.locator("article video").first();
  await video.waitFor({ timeout: 30_000 });
  const duration = await waitFor(
    () => video.evaluate((el) => (el as HTMLVideoElement).duration),
    (d) => Number.isFinite(d) && d > 3,
    { timeoutMs: 30_000 },
  );
  r.ok("its video loads (4 s)", duration.ok, String(duration.value));
  await video.evaluate((el) => {
    (el as HTMLVideoElement).currentTime = 3;
  });
  const seeked = await waitFor(
    () => video.evaluate((el) => (el as HTMLVideoElement).currentTime),
    (t) => t >= 2.9,
    { timeoutMs: 15_000 },
  );
  r.ok("the video seeks", seeked.ok, String(seeked.value));
  r.ok(
    "the video is served as byte ranges (206)",
    ranged.includes(206),
    ranged.join(","),
  );
  const media = (
    await db.query<{
      values: { media: { attachmentId: string; mime: string }[] };
    }>("SELECT values FROM site_feed_items WHERE id = $1", [item.id])
  )[0]?.values.media;
  const videoRef = media?.find((m) => m.mime.startsWith("video/"));
  if (videoRef === undefined) throw new Error("the item holds no video");
  const mediaPath = `/api/site-feeds/media/${item.id}/${videoRef.attachmentId}`;
  const range = await agentFetch(mediaPath, {
    headers: { range: "bytes=100-199" },
  });
  r.ok(
    "the media route answers a range request with 206 and the asked bytes",
    range.status === 206 && (await range.arrayBuffer()).byteLength === 100,
    `${range.status} ${range.headers.get("content-range")}`,
  );
  await snap(page, OUT, "tips-page");

  // 6. Edit the title: the published tip is published again.
  await page.goto(pathUrl(`/deploy/site/${deployment.id}/feeds`));
  await page.getByText(TITLE).first().click();
  const editTitle = titleBox(page);
  await editTitle.waitFor({ timeout: 30_000 });
  await editTitle.fill(TITLE_EDITED);
  await editTitle.press("Tab");
  const republished = await waitFor(
    () =>
      db.query<{ title: string }>(
        "SELECT values->>'title' AS title FROM site_feed_entries WHERE id = $1",
        [item.id],
      ),
    (rows) => rows[0]?.title === TITLE_EDITED,
    { timeoutMs: 120_000 },
  );
  r.ok("an edit to a published item reaches the box", republished.ok);
  await page.goto(pathUrl("/about/tips"));
  const updated = await waitFor(
    () => pageText(page),
    (t) => t.includes(TITLE_EDITED) && !t.includes(TITLE),
    { timeoutMs: 60_000 },
  );
  r.ok("the Tips page shows the new title", updated.ok);

  // 7. Unpublish: gone from the page, its media 404.
  await page.goto(pathUrl(`/deploy/site/${deployment.id}/feeds`));
  await page.getByText(TITLE_EDITED).first().click();
  await page.getByRole("button", { name: "Unpublish" }).click();
  const unpublished = await waitFor(
    () =>
      db.query<{ state: string; publish_state: string }>(
        "SELECT state, publish_state FROM site_feed_items WHERE id = $1",
        [item.id],
      ),
    (rows) => rows[0]?.state === "draft" && rows[0]?.publish_state === "idle",
    { timeoutMs: 120_000 },
  );
  r.ok("Unpublish takes the item off the box", unpublished.ok);
  await page.goto(pathUrl("/about/tips"));
  const gone = await waitFor(
    () => pageText(page),
    (t) => !t.includes(TITLE_EDITED) && t.includes("Small things equin can do"),
    { timeoutMs: 60_000 },
  );
  r.ok("the Tips page no longer shows it", gone.ok);
  const after = await agentFetch(mediaPath);
  r.ok(
    "its media route answers 404",
    after.status === 404,
    String(after.status),
  );
  await snap(page, OUT, "unpublished");

  await r.finish();
});
