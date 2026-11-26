import { describe, expect, it } from "bun:test";
import type {
  Mailbox,
  MailboxId,
} from "@plugins/apps/plugins/mail/plugins/provider/core";
import {
  labelColor,
  labelOfView,
  labelView,
  labelViewId,
  MAIL_BUILT_IN_VIEWS,
  MAIL_INBOX_MAILBOXES,
  MAIL_INBOX_VIEW,
} from "./views";

function box(
  id: string,
  name: string,
  parentId: string | null = null,
  color: string | null = null,
): Mailbox {
  return {
    id: id as MailboxId,
    name,
    role: null,
    kind: "user",
    parentId: parentId as MailboxId | null,
    counts: null,
    color: color === null ? null : { text: "#fff", background: color },
  };
}

describe("the built-in views", () => {
  it("lists Inbox, Sent, Drafts, Done, Spam, Trash in order", () => {
    expect(MAIL_BUILT_IN_VIEWS.map((v) => v.name)).toEqual([
      "Inbox",
      "Sent",
      "Drafts",
      "Done",
      "Spam",
      "Trash",
    ]);
  });

  it("the Inbox is its one mailbox rule and nothing else (the boot preload's window)", () => {
    expect(MAIL_INBOX_VIEW.view.filter?.children).toEqual([
      {
        kind: "rule",
        id: "inbox-in",
        fieldId: "mailboxes",
        operatorId: "contains-any-of",
        value: [...MAIL_INBOX_MAILBOXES],
      },
    ]);
    expect(MAIL_INBOX_MAILBOXES).toEqual(["role:inbox" as MailboxId]);
  });

  it("every view but Spam and Trash leaves spam and trash out", () => {
    for (const v of MAIL_BUILT_IN_VIEWS) {
      if (v.id === "inbox" || v.id === "spam" || v.id === "trash") continue;
      const leavesOut = (v.view.filter?.children ?? []).some(
        (r) =>
          r.kind === "rule" &&
          r.operatorId === "lacks-nested" &&
          Array.isArray(r.value) &&
          r.value.includes("role:spam") &&
          r.value.includes("role:trash"),
      );
      expect(leavesOut, v.id).toBe(true);
    }
  });
});

describe("label views", () => {
  const work = box("L1", "Work", null, "#3f6fd0");
  const clients = box("L2", "Clients", "L1");
  const studio = box("L3", "Design studio", "L2");
  const all = [work, clients, studio];

  it("a parent's view takes its sub-labels and never spam or trash", () => {
    const v = labelView(work, all);
    expect(v.id).toBe("label-L1");
    expect(v.name).toBe("Work");
    expect(v.view.filter?.children).toEqual([
      expect.objectContaining({ value: ["L1", "L2", "L3"] }),
      expect.objectContaining({
        operatorId: "lacks-nested",
        value: ["role:spam", "role:trash"],
      }),
    ]);
  });

  it("a sub-label wears its nearest coloured ancestor's colour", () => {
    expect(labelColor(studio, all)).toBe("#3f6fd0");
    expect(labelView(studio, all).color).toBe("#3f6fd0");
    expect(labelColor(box("X", "Loose"), [])).toBeNull();
  });

  it("reads a label back from its view id", () => {
    expect(labelOfView(labelViewId("L2" as MailboxId))).toBe("L2" as MailboxId);
    expect(labelOfView("inbox")).toBeNull();
  });
});
