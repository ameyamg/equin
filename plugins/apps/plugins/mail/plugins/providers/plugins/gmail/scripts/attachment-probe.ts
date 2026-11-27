// ─── What "has an attachment" means, measured on the connected account (read-only) ─
//
//   ./equin run plugins/apps/plugins/mail/plugins/providers/plugins/gmail/scripts/attachment-probe.ts \
//     [--messages 40]
//
// For the latest Inbox messages and the latest `has:attachment` matches,
// compares four answers per message:
//
// - `mixed`: the old list heuristic (a `multipart/mixed` top-level type);
// - `meta`: what a `format=metadata` read carries beyond headers (parts,
//   filenames) — whether a summary could tell files from inline images there;
// - `files`: the reader's rule over the `full` MIME tree (a part the reader
//   lists as a downloadable file, inline images excluded);
// - `q`: whether Gmail's `has:attachment` matches it.
//
// Prints counts and per-message mime-shape lines only — never a subject,
// address or filename. About 80 units per message (metadata + full), plus
// three message lists (15 units).

import { getGmailToken } from "@plugins/integrations/plugins/gmail/server";
import { createGmailClient } from "@plugins/integrations/plugins/gmail/plugins/api/server";
import {
  createQuotaPacer,
  type GmailMessagePart,
} from "@plugins/integrations/plugins/gmail/plugins/api/core";
import { header } from "../server/internal/headers";

const ai = process.argv.indexOf("--messages");
const n = ai >= 0 ? Number(process.argv[ai + 1]) : 40;
if (!Number.isInteger(n) || n < 1 || n > 500)
  throw new Error("--messages <1..500> is required to be a whole number");

const pacer = createQuotaPacer();
const gmail = createGmailClient({
  accessToken: async (o?: { refused?: string }) => {
    const t = await getGmailToken({ refused: o?.refused });
    if (!t.ok) throw new Error(`No Gmail token: ${t.message}`);
    return t.accessToken;
  },
  pacer,
});

const inbox =
  (await gmail.listMessages({ labelIds: ["INBOX"], maxResults: n })).messages ??
  [];
const withQ =
  (await gmail.listMessages({ q: "has:attachment", maxResults: n })).messages ??
  [];
const qInbox =
  (
    await gmail.listMessages({
      labelIds: ["INBOX"],
      q: "has:attachment",
      maxResults: 500,
    })
  ).messages ?? [];
const qSet = new Set([...withQ, ...qInbox].map((m) => m.id));
const ids = [...new Set([...inbox, ...withQ].map((m) => m.id))];

function leaves(p: GmailMessagePart): GmailMessagePart[] {
  if (p.mimeType.toLowerCase() === "message/rfc822") return [p];
  return p.parts && p.parts.length > 0 ? p.parts.flatMap(leaves) : [p];
}
function shape(p: GmailMessagePart): string {
  const d = (header(p.headers, "Content-Disposition") ?? "").split(";")[0];
  const cid = header(p.headers, "Content-ID") ? "+cid" : "";
  const fn = p.filename ? "+name" : "";
  const self = `${p.mimeType}${d ? `[${d.trim()}]` : ""}${cid}${fn}`;
  return p.parts && p.parts.length > 0 && p.mimeType !== "message/rfc822"
    ? `${self}(${p.parts.map(shape).join(",")})`
    : self;
}

const meta = await gmail.getMessages(ids, {
  format: "metadata",
  metadataHeaders: ["Content-Type"],
});
const full = await gmail.getMessages(ids, { format: "full" });

const tally: Record<string, number> = {};
let metaHasParts = 0;
for (let i = 0; i < ids.length; i++) {
  const mr = meta[i]!;
  const fr = full[i]!;
  if (!mr.ok) throw mr.error;
  if (!fr.ok) throw fr.error;
  const mp = mr.value.payload;
  if (mp?.parts?.length || mp?.filename) metaHasParts++;
  const type = mp?.mimeType ?? header(mp?.headers, "Content-Type") ?? "";
  const mixed = /^multipart\/mixed\b/i.test(type);
  const fp = fr.value.payload!;
  const listed = leaves(fp).filter((p) => {
    const t = p.mimeType.toLowerCase();
    const disp = header(p.headers, "Content-Disposition") ?? "";
    const attached = /^\s*attachment\b/i.test(disp);
    const named = (p.filename ?? "") !== "";
    if ((t === "text/plain" || t === "text/html") && !named && !attached)
      return false;
    if (t.startsWith("multipart/")) return false;
    const hasBytes =
      p.body?.attachmentId !== undefined || p.body?.data !== undefined;
    if (!hasBytes && t !== "message/rfc822") return false;
    const cid = header(p.headers, "Content-ID");
    return !(cid && !attached);
  });
  const files = listed.length > 0;
  const q = qSet.has(ids[i]!);
  const key = `mixed=${+mixed} files=${+files} q=${+q}`;
  tally[key] = (tally[key] ?? 0) + 1;
  if (mixed !== files || q !== files) console.log(`${key}  ${shape(fp)}`);
}
console.log(
  `\n${ids.length} messages; metadata payload carried parts/filename on ${metaHasParts}`,
);
for (const [k, v] of Object.entries(tally).sort()) console.log(`${v}\t${k}`);
console.log(`${pacer.stats().spentUnits} units`);
