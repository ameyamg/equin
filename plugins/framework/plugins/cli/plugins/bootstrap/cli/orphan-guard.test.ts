import { readEnv } from "@plugins/infra/plugins/launcher/plugins/env-names/core";
import { withEnv } from "@plugins/infra/plugins/launcher/plugins/env-names/core/testing";
import { afterEach, expect, test } from "bun:test";
import {
  disarmOrphanGuard,
  handOffOwnerPid,
  installOrphanGuard,
  ORPHAN_EXIT_CODE,
} from "./orphan-guard";

/**
 * The guard's decision is "has this process been reparented", read from
 * `process.ppid` on a 2s poll. These tests cover the two edges that are cheap to
 * get wrong and expensive to discover in production — arming at all, and
 * disarming for a command that is MEANT to be detached — without waiting on real
 * poll ticks. The end-to-end reparent behaviour is verified by orphaning a real
 * `./equin` invocation, which no unit test can stand in for.
 */

// Every test must leave the runner with no live poll, or an unref'd interval
// would survive into the next test and (worse) into an unrelated suite.
afterEach(() => disarmOrphanGuard());

test("arming under a live parent does not fire", () => {
  // The test runner has a real parent, so ppid !== 1 and the immediate-orphan
  // branch must not be taken.
  expect(process.ppid).not.toBe(1);
  let fired = false;
  installOrphanGuard(() => {
    fired = true;
  });
  expect(fired).toBe(false);
});

test("arming installs a poll that disarm removes", () => {
  installOrphanGuard(() => {});
  // A live poll keeps a handle on the loop even when unref'd, so the observable
  // difference is whether disarm is a no-op the second time around.
  disarmOrphanGuard();
  // Idempotent: a command may disarm without first checking whether it armed.
  expect(() => disarmOrphanGuard()).not.toThrow();
});

test("BUILD_DETACHED skips arming entirely", async () => {
  await withEnv({ BUILD_DETACHED: "1" }, () => {
    let fired = false;
    installOrphanGuard(() => {
      fired = true;
    });
    expect(fired).toBe(false);
    // Nothing was installed, so disarm has nothing to cancel and must not throw.
    expect(() => disarmOrphanGuard()).not.toThrow();
  });
});

test("a handed-off op whose owning agent is gone ends at once", async () => {
  // A pid that WAS a process: spawned, exited and reaped.
  const gone = Bun.spawn(["true"]);
  await gone.exited;
  await withEnv({ OP_HANDED_OFF: String(gone.pid) }, () => {
    let fired = false;
    installOrphanGuard(() => {
      fired = true;
    });
    expect(fired).toBe(true);
  });
});

test("a handed-off op lives on while its owning agent does, whoever its parent is", async () => {
  await withEnv({ OP_HANDED_OFF: String(process.pid) }, () => {
    let fired = false;
    installOrphanGuard(() => {
      fired = true;
    });
    expect(fired).toBe(false);
    // Read once: what this op starts follows the op, not the agent.
    expect(readEnv("OP_HANDED_OFF")).toBeUndefined();
  });
});

test("a hand-off that names no owner is refused", () => {
  expect(() => handOffOwnerPid("1")).toThrow("OP_HANDED_OFF");
  expect(() => handOffOwnerPid("yes")).toThrow("OP_HANDED_OFF");
  expect(handOffOwnerPid("4242")).toBe(4242);
});

test("ORPHAN_EXIT_CODE is the documented 128 + 12", () => {
  // Callers key on this number to tell an orphan-kill apart from a real failure,
  // so it is part of the CLI's contract rather than an implementation detail.
  expect(ORPHAN_EXIT_CODE).toBe(140);
});
