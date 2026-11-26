// ─── Gmail API client probe, against the connected account (read-only) ────────
//
//   ./equin run plugins/integrations/plugins/gmail/plugins/api/scripts/probe.ts \
//     [--threads 50] [--label INBOX]
//
// Exercises the client end to end on the Google account connected in Settings
// (Gmail access on): profile, labels and their counts, one page of `--threads`
// thread ids from `--label`, those threads' metadata in one batch, the history
// since the profile's cursor, one thread in `full`, one attachment if that
// thread has one, and the drafts list. Every call is a read: nothing in the
// mailbox changes.
//
// Prints, per step, the wall time and the quota units it spent (read off the
// pacer), and what came back as counts only — no subject, address or body is
// ever printed, so the output can be pasted into a report.

import { getGmailToken } from "@plugins/integrations/plugins/gmail/server";
import { createQuotaPacer, type GmailMessagePart } from "../core";
import { createGmailClient } from "../server";

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const threadCount = Number(flag("threads", "50"));
const label = flag("label", "INBOX");

const pacer = createQuotaPacer();
const gmail = createGmailClient({
  accessToken: async (o?: { refused?: string }) => {
    const t = await getGmailToken({ refused: o?.refused });
    if (!t.ok) throw new Error(`No Gmail token: ${t.message}`);
    return t.accessToken;
  },
  pacer,
});

const rows: { step: string; ms: number; units: number; result: string }[] = [];

async function step<T>(
  name: string,
  run: () => Promise<T>,
  describe: (v: T) => string,
): Promise<T> {
  const before = pacer.stats().spentUnits;
  const t0 = performance.now();
  const v = await run();
  const ms = performance.now() - t0;
  rows.push({
    step: name,
    ms,
    units: pacer.stats().spentUnits - before,
    result: describe(v),
  });
  return v;
}

function firstAttachment(part: GmailMessagePart | undefined): string | null {
  if (!part) return null;
  if (part.body?.attachmentId && part.filename) return part.body.attachmentId;
  for (const p of part.parts ?? []) {
    const a = firstAttachment(p);
    if (a) return a;
  }
  return null;
}

// The token fetch is timed apart: it is central's, not Gmail's.
const tokenT0 = performance.now();
const token = await getGmailToken();
if (!token.ok) {
  console.error(
    `Gmail is not usable: ${token.message}${token.needsConsent ? " (grant Gmail access in Settings)" : ""}`,
  );
  process.exit(1);
}
const tokenMs = performance.now() - tokenT0;

const profile = await step(
  "users.getProfile",
  () => gmail.getProfile(),
  (p) => `${p.threadsTotal} threads, ${p.messagesTotal} messages`,
);
const labels = await step(
  "labels.list",
  () => gmail.listLabels(),
  (l) =>
    `${l.length} labels (${l.filter((x) => x.type === "user").length} user)`,
);
await step(
  "labels.get ×N (batch)",
  () =>
    gmail.getLabels(labels.filter((l) => l.type === "system").map((l) => l.id)),
  (r) =>
    `${r.filter((x) => x.ok).length}/${r.length} system labels with counts`,
);
const list = await step(
  `threads.list ${label} max ${threadCount}`,
  () => gmail.listThreads({ labelIds: [label], maxResults: threadCount }),
  (l) =>
    `${l.threads?.length ?? 0} ids, estimate ${l.resultSizeEstimate}, more: ${l.nextPageToken ? "yes" : "no"}`,
);
const ids = (list.threads ?? []).map((t) => t.id);
const metas = await step(
  `threads.get metadata ×${ids.length} (batch)`,
  () =>
    gmail.getThreads(ids, {
      format: "metadata",
      metadataHeaders: ["From", "To", "Subject", "Date"],
    }),
  (r) => {
    const ok = r.filter((x) => x.ok);
    const msgs = ok.reduce(
      (n, x) => n + (x.ok ? x.value.messages.length : 0),
      0,
    );
    return `${ok.length}/${r.length} threads, ${msgs} messages`;
  },
);
await step(
  "history.list since profile cursor",
  () => gmail.listHistory({ startHistoryId: profile.historyId }),
  (h) =>
    h.kind === "expired"
      ? "expired"
      : `${h.history.length} records, cursor ${h.historyId === profile.historyId ? "unchanged" : "moved"}`,
);
const first = metas.find((m) => m.ok);
if (first?.ok) {
  const full = await step(
    "threads.get full ×1",
    () => gmail.getThread(first.value.id, { format: "full" }),
    (t) =>
      `${t.messages.length} messages, ${t.messages.reduce((n, m) => n + (m.sizeEstimate ?? 0), 0)} bytes estimated`,
  );
  const withAttachment = full.messages
    .map((m) => ({ m, a: firstAttachment(m.payload) }))
    .find((x) => x.a);
  if (withAttachment) {
    await step(
      "messages.attachments.get ×1",
      () => gmail.getAttachment(withAttachment.m.id, withAttachment.a!),
      (b) => `${b.length} bytes`,
    );
  }
}
await step(
  "drafts.list max 10",
  () => gmail.listDrafts({ maxResults: 10 }),
  (d) => `${d.drafts.length} drafts`,
);

console.log(`token (central): ${tokenMs.toFixed(0)} ms`);
console.log(
  ["step".padEnd(44), "ms".padStart(7), "units".padStart(6), "  result"].join(
    "",
  ),
);
for (const r of rows) {
  console.log(
    [
      r.step.padEnd(44),
      r.ms.toFixed(0).padStart(7),
      String(r.units).padStart(6),
      `  ${r.result}`,
    ].join(""),
  );
}
const total = pacer.stats();
console.log(
  `total: ${total.spentUnits} units (${((total.spentUnits / 6000) * 100).toFixed(1)}% of one minute's per-user budget)`,
);
