import { describe, expect, test } from "bun:test";
import { and, clause } from "@plugins/network/plugins/live/plugins/filter/core";
import { mailInboxView } from "./mailbox-view";
import { mailThreads } from "./threads";

// The Inbox's first page is preloaded into Mail's boot snapshot as the tuple
// `codec.encode({ ...mailInboxView, limit: step })`; the thread list's Inbox
// view must subscribe the very same tuple, or the preload lands beside it.
describe("mailInboxView", () => {
  const codec = mailThreads.window.window;
  const page0 = (q: object) =>
    codec.encode({ ...q, limit: codec.defaultLimit });

  test("the view's page 0 is the tuple a DataView's Inbox rule sends", () => {
    // A filter group of one rule lowers to a one-child `and`; the codec's
    // canonical form flattens it, and the default order is left out.
    const fromDataView = page0({
      where: and(clause("mailboxes", "hasAny", ["role:inbox"])),
      orderBy: [["date", "desc"]],
    });
    expect(page0(mailInboxView)).toEqual(fromDataView);
  });

  test("names the inbox alone, in the default order", () => {
    expect(page0(mailInboxView)).toEqual({
      limit: String(codec.defaultLimit),
      where: expect.any(String),
    });
  });
});
