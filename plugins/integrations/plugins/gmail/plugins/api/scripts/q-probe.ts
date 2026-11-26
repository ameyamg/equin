// ─── Gmail search and list-order probe, against the connected account (read-only) ─
//
//   ./equin run plugins/integrations/plugins/gmail/plugins/api/scripts/q-probe.ts
//
// Measures, on real mail, what the Mail provider (apps/mail/providers/gmail)
// and the Mail cache (apps/mail/cache) rely on:
//
// 1. the clock `after:` / `before:` compare: how far it is from a message's
//    internalDate (the summary's date) — the provider's `listOrderSlackMs`;
// 2. list order: `threads.list` vs `messages.list` against each thread's
//    latest message — why the provider lists messages;
// 3. label spellings: the hyphen form (`label:Parent-Child-name`) against
//    `labelIds`, and whether `label:Parent` matches its sub-labels;
// 4. parentheses: `(a OR b)` is the union, `-(a OR b)` the complement.
//
// Prints verdicts and counts only — never a subject, address or label name.
// About 8,000 quota units (the pacer spreads them over a minute or two).

import { getGmailToken } from "@plugins/integrations/plugins/gmail/server";
import { createQuotaPacer } from "../core";
import { createGmailClient, type GmailListQuery } from "../server";

const pacer = createQuotaPacer();
const gmail = createGmailClient({
  accessToken: async (o?: { refused?: string }) => {
    const t = await getGmailToken({ refused: o?.refused });
    if (!t.ok) throw new Error(`No Gmail token: ${t.message}`);
    return t.accessToken;
  },
  pacer,
});

async function messageIds(q: GmailListQuery, max = 3000) {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  do {
    const page = await gmail.listMessages({
      ...q,
      includeSpamTrash: true,
      maxResults: 500,
      pageToken,
    });
    for (const m of page.messages ?? []) ids.add(m.id);
    pageToken = page.nextPageToken ?? undefined;
  } while (pageToken && ids.size < max);
  return { ids, complete: pageToken === undefined };
}
const same = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((x) => b.has(x));
const line = (ok: boolean, what: string) =>
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);

// ── 1. the search clock vs internalDate ─────────────────────────────────────
const sample = [
  ...((await gmail.listMessages({ labelIds: ["INBOX"], maxResults: 8 }))
    .messages ?? []),
  ...((await gmail.listMessages({ q: "before:1600000000", maxResults: 4 }))
    .messages ?? []),
];
const offsets: number[] = [];
for (const ref of sample) {
  const m = await gmail.getMessage(ref.id, { format: "minimal" });
  const s = Math.floor(m.internalDate! / 1000);
  for (let d = -60; d <= 60; d++) {
    const r = await messageIds(
      { q: `after:${s + d} before:${s + d + 1}` },
      500,
    );
    if (r.ids.has(m.id)) {
      offsets.push(d);
      break;
    }
  }
}
console.log(
  `search second − internalDate second over ${sample.length} messages: ${offsets.join(" ")} (${sample.length - offsets.length} not found within ±60 s)`,
);

// ── 2. list order ───────────────────────────────────────────────────────────
const tl = await gmail.listThreads({
  q: "in:inbox",
  maxResults: 40,
  includeSpamTrash: true,
});
const threads = (
  await gmail.getThreads(
    (tl.threads ?? []).map((t) => t.id),
    { format: "minimal" },
  )
).map((r) => {
  if (!r.ok) throw r.error;
  return r.value;
});
const latest = (t: (typeof threads)[number]) =>
  Math.max(...t.messages.map((m) => m.internalDate!));
let threadInversions = 0;
for (let i = 1; i < threads.length; i++)
  if (latest(threads[i]!) > latest(threads[i - 1]!)) threadInversions++;
const ml = await gmail.listMessages({
  q: "in:inbox",
  maxResults: 100,
  includeSpamTrash: true,
});
const dateOf = new Map<string, number>();
for (const t of threads)
  for (const m of t.messages) dateOf.set(m.id, m.internalDate!);
const listed = (ml.messages ?? [])
  .filter((m) => dateOf.has(m.id))
  .map((m) => dateOf.get(m.id)!);
let messageInversions = 0;
for (let i = 1; i < listed.length; i++)
  if (listed[i]! > listed[i - 1]! + 60_000) messageInversions++;
console.log(
  `threads.list in:inbox: ${threadInversions}/${threads.length - 1} neighbours out of latest-message order; messages.list: ${messageInversions}/${listed.length - 1} more than 60 s out of date order`,
);

// ── 3. labels ───────────────────────────────────────────────────────────────
const user = (await gmail.listLabels()).filter((l) => l.type === "user");
const hyphen = (n: string) => n.replace(/[\s/]+/g, "-");
let spelled = 0;
for (const l of user.slice(0, 20)) {
  const byId = await messageIds({ labelIds: [l.id] });
  const byQ = await messageIds({ q: `label:${hyphen(l.name)}` });
  if (same(byId.ids, byQ.ids)) spelled++;
}
line(
  spelled === Math.min(user.length, 20),
  `label:<hyphen form> = labelIds for ${spelled}/${Math.min(user.length, 20)} labels`,
);
const parents = user.filter((p) =>
  user.some((c) => c.name.startsWith(`${p.name}/`)),
);
for (const parent of parents.slice(0, 2)) {
  const byQ = await messageIds({ q: `label:${hyphen(parent.name)}` });
  const own = await messageIds({ labelIds: [parent.id] });
  line(
    same(byQ.ids, own.ids),
    "label:Parent matches the parent's own messages only (not its sub-labels')",
  );
}

// ── 4. parentheses ──────────────────────────────────────────────────────────
const scope = `in:inbox after:${Math.floor(Date.now() / 1000) - 60 * 86400}`;
const all = await messageIds({ q: scope });
const u = await messageIds({ q: `${scope} is:unread` });
const st = await messageIds({ q: `${scope} is:starred` });
const either = await messageIds({ q: `${scope} (is:unread OR is:starred)` });
const neither = await messageIds({ q: `${scope} -(is:unread OR is:starred)` });
const union = new Set([...u.ids, ...st.ids]);
line(
  all.complete && same(either.ids, union),
  `(a OR b) is the union (${either.ids.size})`,
);
line(
  same(neither.ids, new Set([...all.ids].filter((x) => !union.has(x)))),
  `-(a OR b) is the complement (${neither.ids.size} of ${all.ids.size})`,
);
console.log(`total: ${pacer.stats().spentUnits} units`);
