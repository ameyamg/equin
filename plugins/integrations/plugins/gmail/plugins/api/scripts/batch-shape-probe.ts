// ─── Gmail batch-shape probe, against the connected account (read-only) ──────
//
//   ./equin run plugins/integrations/plugins/gmail/plugins/api/scripts/batch-shape-probe.ts \
//     [--threads 50] [--shapes 50x1,25x1,10x1,10x5] [--rest 62]
//
// Sends `threads.get metadata` for the Inbox's first `--threads` threads as
// raw HTTP batches, one shape at a time, with no retry, and prints per shape
// the wall time and how many parts Google answered 2xx vs refused for rate
// (429 / 403 rateLimitExceeded). A shape `SxC` is batches of S parts, C of
// them in flight at once. `--rest` seconds pass between shapes, so each starts
// on an empty per-minute window. Counts only — no subject or address printed.
// Raw requests, outside the account's pacer: while a server reads the same
// account, its calls share Google's budget and refusals with these.

import { getGmailToken } from "@plugins/integrations/plugins/gmail/server";
import {
  decodeBatch,
  encodeBatch,
  newBatchBoundary,
  type BatchRequestPart,
} from "../core";
import { GMAIL_API_ROOT } from "../server/internal/transport";

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const threadCount = Number(flag("threads", "50"));
const shapes = flag("shapes", "50x1,25x1,10x1,10x5").split(",");
const restS = Number(flag("rest", "62"));

const t = await getGmailToken();
if (!t.ok) {
  console.error(`Gmail is not usable: ${t.message}`);
  process.exit(1);
}
const token = t.accessToken;

const listRes = await fetch(
  `${GMAIL_API_ROOT}/gmail/v1/users/me/threads?labelIds=INBOX&maxResults=${threadCount}`,
  { headers: { Authorization: `Bearer ${token}` } },
);
if (!listRes.ok)
  throw new Error(
    `threads.list HTTP ${listRes.status}: ${await listRes.text()}`,
  );
const list = (await listRes.json()) as { threads?: { id: string }[] };
const ids = (list.threads ?? []).map((x) => x.id);
if (ids.length === 0)
  throw new Error("threads.list: the Inbox lists no threads");
const parts: BatchRequestPart[] = ids.map((id) => ({
  method: "GET",
  path: `/gmail/v1/users/me/threads/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
}));

async function sendBatch(chunk: BatchRequestPart[]) {
  const boundary = newBatchBoundary();
  const res = await fetch(`${GMAIL_API_ROOT}/batch/gmail/v1`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/mixed; boundary=${boundary}`,
    },
    body: encodeBatch(chunk, boundary),
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`batch HTTP ${res.status}: ${text.slice(0, 200)}`);
  return decodeBatch(res.headers.get("content-type") ?? "", text, chunk.length);
}

for (const [si, shape] of shapes.entries()) {
  if (si > 0) await new Promise((r) => setTimeout(r, restS * 1000));
  const [size, conc] = shape.split("x").map(Number) as [number, number];
  const chunks: BatchRequestPart[][] = [];
  for (let i = 0; i < parts.length; i += size)
    chunks.push(parts.slice(i, i + size));
  const statuses = new Map<string, number>();
  const t0 = performance.now();
  let next = 0;
  await Promise.all(
    Array.from({ length: conc }, async () => {
      while (next < chunks.length) {
        const chunk = chunks[next++]!;
        for (const p of await sendBatch(chunk)) {
          let key = String(p.status);
          if (p.status >= 400) {
            const reason = /"reason":\s*"([^"]+)"/.exec(p.body)?.[1];
            if (reason) key += ` ${reason}`;
          }
          statuses.set(key, (statuses.get(key) ?? 0) + 1);
        }
      }
    }),
  );
  const ms = performance.now() - t0;
  console.log(
    `${shape.padEnd(6)} ${ms.toFixed(0).padStart(6)} ms  ${[...statuses].map(([k, n]) => `${k}: ${n}`).join(", ")}`,
  );
}
