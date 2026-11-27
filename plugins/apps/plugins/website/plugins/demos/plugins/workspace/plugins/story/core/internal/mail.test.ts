import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DEMO_MAIL } from "./mail";

const { account, labels, threads } = DEMO_MAIL;
const messages = threads.flatMap((t) => t.messages);
/** The workspace demo's `data/` folder, which every `dataPath` is below. */
const DATA_DIR = join(import.meta.dir, "../../../../data");
const ROLES = new Set([
  "inbox",
  "sent",
  "drafts",
  "trash",
  "spam",
  "important",
]);

const minutesAgo = (ago: { days?: number; hours?: number; minutes?: number }) =>
  (ago.days ?? 0) * 1440 + (ago.hours ?? 0) * 60 + (ago.minutes ?? 0);

test("every thread and message id carries demo and is unique", () => {
  const ids = [...threads.map((t) => t.id), ...messages.map((m) => m.id)];
  expect(ids.filter((id) => !id.includes("demo"))).toEqual([]);
  expect(new Set(ids).size).toBe(ids.length);
});

test("every address is on a .example domain", () => {
  const addresses = [
    account.address,
    ...messages.flatMap((m) =>
      [m.from, ...m.to, ...(m.cc ?? [])].map((p) => p.address),
    ),
  ];
  expect(addresses.filter((a) => !/@[a-z0-9.-]+\.example$/.test(a))).toEqual(
    [],
  );
});

test("no html body loads a remote image", () => {
  for (const m of messages) {
    const html = m.html ?? "";
    expect(html).not.toMatch(/src\s*=\s*["']?\s*(https?:)?\/\//i);
    expect(html).not.toMatch(/url\(\s*["']?\s*(https?:)?\/\//i);
  }
});

test("every label a message uses is declared, its parents too", () => {
  const declared = new Set(labels.map((l) => l.path));
  for (const path of declared) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++)
      expect(declared).toContain(parts.slice(0, i).join("/"));
  }
  const used = messages.flatMap((m) =>
    (m.mailboxes ?? ["inbox"]).filter((b) => !ROLES.has(b)),
  );
  expect(used.filter((p) => !declared.has(p))).toEqual([]);
});

test("a thread's messages are oldest first", () => {
  for (const t of threads) {
    const agos = t.messages.map((m) => minutesAgo(m.ago));
    expect(agos).toEqual([...agos].sort((a, b) => b - a));
    expect(new Set(agos).size).toBe(agos.length);
  }
});

test("Demo's messages are sent or drafts, and only Demo's are", () => {
  for (const m of messages) {
    const boxes = m.mailboxes ?? ["inbox"];
    const own = m.from.address === account.address;
    expect(own).toBe(boxes.includes("sent") || boxes.includes("drafts"));
    expect(m.draft === true).toBe(boxes.includes("drafts"));
  }
});

test("every cid: image has its attachment", () => {
  for (const m of messages) {
    const cids = [...(m.html ?? "").matchAll(/cid:([^"'\s)>]+)/g)].map(
      (x) => x[1],
    );
    const ids = new Set((m.attachments ?? []).map((a) => a.contentId));
    expect(cids.filter((c) => !ids.has(c))).toEqual([]);
  }
});

test("every attachment's dataPath is a file in the demo's data/", () => {
  for (const a of messages.flatMap((m) => m.attachments ?? []))
    if ("dataPath" in a.source)
      expect(existsSync(join(DATA_DIR, a.source.dataPath))).toBe(true);
});

test("three weeks of mail, the newest today", () => {
  expect(threads.length).toBeGreaterThanOrEqual(28);
  const agos = messages.map((m) => minutesAgo(m.ago));
  expect(Math.min(...agos)).toBeLessThan(6 * 60);
  expect(Math.max(...agos)).toBeLessThanOrEqual(21 * 1440);
});
