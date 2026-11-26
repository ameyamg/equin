import { describe, expect, it } from "bun:test";
import type {
  Mailbox,
  MailboxId,
} from "@plugins/apps/plugins/mail/plugins/provider/core";
import { labelLines } from "./label-lines";

function box(
  id: string,
  name: string,
  parentId: string | null,
  unread: number,
): Mailbox {
  return {
    id: id as MailboxId,
    name,
    role: null,
    kind: "user",
    parentId: parentId as MailboxId | null,
    counts: { threads: unread, unread },
    color: null,
  };
}

describe("the label tree's lines", () => {
  const labels = [
    box("w", "Work", null, 1),
    box("c", "Clients", "w", 2),
    box("d", "Design", "c", 3),
    box("a", "Admin", null, 0),
  ];

  it("walks depth first, names in order", () => {
    expect(
      labelLines(labels, new Set()).map((l) => [l.label.name, l.depth]),
    ).toEqual([
      ["Admin", 0],
      ["Work", 0],
      ["Clients", 1],
      ["Design", 2],
    ]);
  });

  it("a folded parent hides its subtree and rolls its unread up", () => {
    const lines = labelLines(labels, new Set(["w" as MailboxId]));
    expect(lines.map((l) => l.label.name)).toEqual(["Admin", "Work"]);
    expect(lines[1]!.rolledUnread).toBe(6);
    expect(lines[0]!.rolledUnread).toBeNull();
  });
});
