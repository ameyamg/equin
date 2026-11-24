import { describe, expect, test } from "bun:test";
import { fakeCheckoutWatch } from "@plugins/infra/plugins/git/plugins/checkout-watch/server/testing";
import { gitStatusWatch } from "./status-watch";

describe("gitStatusWatch", () => {
  test("main advancing alone notifies (the merge-base moves with it)", async () => {
    const watch = fakeCheckoutWatch();
    let notified = 0;
    const release = await watch.acquire(gitStatusWatch(() => void notified++));
    watch.moveRef("refs/heads/main");
    expect(notified).toBe(1);
    release();
  });

  test("the upstream notifies; another worktree's branch does not", async () => {
    const watch = fakeCheckoutWatch();
    let notified = 0;
    const release = await watch.acquire(gitStatusWatch(() => void notified++));
    watch.moveRef("refs/heads/other-wt");
    expect(notified).toBe(0);
    watch.moveRef("refs/remotes/origin/wt-branch");
    expect(notified).toBe(1);
    release();
  });

  test("a watch that lost events re-reads the status", async () => {
    const watch = fakeCheckoutWatch();
    let notified = 0;
    const release = await watch.acquire(gitStatusWatch(() => void notified++));
    watch.loseEvents();
    expect(notified).toBe(1);
    release();
  });
});
