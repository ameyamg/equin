// ─── What one cold Mail page costs, and what it could cost (read-only) ────────
//
//   ./equin run plugins/integrations/plugins/gmail/plugins/api/scripts/cold-page-probe.ts \
//     [--q "in:inbox"] [--rows 25] [--screen 22]
//
// Replays a cold mail.threads fill the way the Mail cache does it (one
// messages.list page of 100, then the summaries of the first `--rows` + 2
// distinct threads) and prices the alternatives for drawing those rows:
//   A. threads.get metadata per thread (what the cache does today)
//   B. messages.get metadata per listed message of those threads
//   C. messages.get metadata of each thread's newest listed message only
// Prints wall time and units per step, and the threads' message counts.
// Counts only: no subject, address or body is printed. Spends ~3,000+
// units of the account's 6,000 a minute on its own pacer, which knows nothing
// of a running Mail server's: run it with Mail idle, or expect 429s.

import { getGmailToken } from "@plugins/integrations/plugins/gmail/server";
import { createQuotaPacer } from "../core";
import { createGmailClient } from "../server";

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const q = flag("q", "in:inbox");
const rows = Number(flag("rows", "25"));
const screen = Number(flag("screen", "22"));

const pacer = createQuotaPacer();
const gmail = createGmailClient({
  accessToken: async (o?: { refused?: string }) => {
    const t = await getGmailToken({ refused: o?.refused });
    if (!t.ok) throw new Error(`No Gmail token: ${t.message}`);
    return t.accessToken;
  },
  pacer,
});

async function step<T>(
  name: string,
  run: () => Promise<T>,
  say: (v: T) => string,
) {
  const before = pacer.stats().spentUnits;
  const t0 = performance.now();
  const v = await run();
  const ms = performance.now() - t0;
  console.log(
    `${name.padEnd(48)}${ms.toFixed(0).padStart(7)} ms${String(pacer.stats().spentUnits - before).padStart(7)} u  ${say(v)}`,
  );
  return v;
}

const HEADERS = ["From", "To", "Subject", "Content-Type"];
console.log(`q=${JSON.stringify(q)} rows=${rows}`);
const list = await step(
  "messages.list max 100",
  () => gmail.listMessages({ q, maxResults: 100, includeSpamTrash: true }),
  (l) => `${l.messages?.length ?? 0} hits`,
);
const hits = list.messages ?? [];
const threads: string[] = [];
const hitsOf = new Map<string, string[]>();
for (const h of hits) {
  if (!hitsOf.has(h.threadId)) {
    if (threads.length >= rows + 2) break;
    threads.push(h.threadId);
    hitsOf.set(h.threadId, []);
  }
  hitsOf.get(h.threadId)!.push(h.id);
}
const listed = [...hitsOf.values()].flat();

const a = await step(
  `A threads.get metadata ×${threads.length}`,
  () =>
    gmail.getThreads(threads, { format: "metadata", metadataHeaders: HEADERS }),
  (r) => `${r.filter((x) => x.ok).length} ok`,
);
const counts = a.flatMap((x) => (x.ok ? [x.value.messages.length] : []));
const total = counts.reduce((s, n) => s + n, 0);
const sorted = [...counts].sort((x, y) => x - y);
console.log(
  `   messages per thread: total ${total}, mean ${(total / counts.length).toFixed(2)}, median ${sorted[sorted.length >> 1]}, max ${sorted.at(-1)}, single-message threads ${counts.filter((n) => n === 1).length}/${counts.length}`,
);
console.log(`   listed hits in those threads: ${listed.length}`);

await step(
  `B messages.get metadata ×${listed.length} (every hit)`,
  () =>
    gmail.getMessages(listed, { format: "metadata", metadataHeaders: HEADERS }),
  (r) => `${r.filter((x) => x.ok).length} ok`,
);
const newest = threads.map((t) => hitsOf.get(t)![0]!);
await step(
  `C messages.get metadata ×${newest.length} (newest hit)`,
  () =>
    gmail.getMessages(newest, { format: "metadata", metadataHeaders: HEADERS }),
  (r) => `${r.filter((x) => x.ok).length} ok`,
);
const first = threads.slice(0, screen);
await step(
  `A' threads.get metadata ×${first.length} (one screen)`,
  () =>
    gmail.getThreads(first, { format: "metadata", metadataHeaders: HEADERS }),
  (r) => `${r.filter((x) => x.ok).length} ok`,
);
console.log(`total ${pacer.stats().spentUnits} units`);
process.exit(0);
