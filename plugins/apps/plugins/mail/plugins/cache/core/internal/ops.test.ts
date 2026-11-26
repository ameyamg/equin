import { describe, expect, test } from "bun:test";
import {
  applyMailOp,
  primaryMailAction,
  undoMailOp,
  type MailThreadOp,
} from "./ops";

const INBOX = "role:inbox";
const TRASH = "role:trash";

describe("mail ops", () => {
  test("each op sets a state: applying it twice is applying it once", () => {
    const t = { mailboxes: [INBOX, "L1"], unread: true };
    const ops: MailThreadOp[] = [
      { kind: "archive" },
      { kind: "trash" },
      { kind: "move-to-inbox" },
      { kind: "spam" },
      { kind: "not-spam" },
      { kind: "read", unread: false },
      { kind: "labels", add: ["L2"], remove: ["L1"] },
    ];
    for (const op of ops) {
      const once = applyMailOp(t, op);
      expect(applyMailOp(once, op)).toEqual(once);
    }
  });

  test("trash leaves the inbox; move to inbox brings it back out of trash", () => {
    const trashed = applyMailOp(
      { mailboxes: [INBOX], unread: false },
      {
        kind: "trash",
      },
    );
    expect(trashed.mailboxes).toEqual([TRASH]);
    expect(primaryMailAction(trashed.mailboxes)).toEqual({
      op: "move-to-inbox",
      label: "Restore",
    });
    expect(applyMailOp(trashed, { kind: "move-to-inbox" }).mailboxes).toEqual([
      INBOX,
    ]);
  });

  test("undo restores each thread as it was, grouped, and skips what did not move", () => {
    const undo = undoMailOp({ kind: "archive" }, [
      { id: "a", facts: { mailboxes: [INBOX], unread: false } },
      { id: "b", facts: { mailboxes: [INBOX, "L"], unread: true } },
      { id: "c", facts: { mailboxes: ["L"], unread: false } },
    ]);
    expect(undo).toEqual([
      { op: { kind: "labels", add: [INBOX], remove: [] }, ids: ["a", "b"] },
    ]);
    expect(
      undoMailOp({ kind: "read", unread: false }, [
        { id: "a", facts: { mailboxes: [], unread: true } },
        { id: "b", facts: { mailboxes: [], unread: false } },
      ]),
    ).toEqual([{ op: { kind: "read", unread: true }, ids: ["a"] }]);
  });
});
