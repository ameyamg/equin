import { describe, expect, test } from "bun:test";
import { declareExecAdmission, schemaRoleFor } from "./schema-role";

// One process, one declaration: the module-global is declared once here, for
// every test below. `held` is the slot as the pool sees it: a release while
// not holding it throws, as the supervised child's admission does.
const events: string[] = [];
let held = true;
/** When set, a reacquire stays queued until it resolves. */
let reacquireGate: Promise<void> | null = null;
declareExecAdmission({
  release: () => {
    if (!held) throw new Error("gave the slot back while not holding it");
    held = false;
    events.push("release");
    return Promise.resolve();
  },
  reacquire: async () => {
    events.push("queue");
    if (reacquireGate !== null) await reacquireGate;
    held = true;
    events.push("reacquire");
  },
});

function verifier() {
  const role = schemaRoleFor("exec");
  if (role.kind !== "verifier") throw new Error("exec is not a verifier");
  return role;
}

describe("a verifier's yieldAdmission", () => {
  test("gives the admission back for the wait and takes it again after", async () => {
    events.length = 0;
    const result = await verifier().yieldAdmission(() => {
      events.push("wait");
      return Promise.resolve(42);
    });
    expect(result).toBe(42);
    expect(events).toEqual(["release", "wait", "queue", "reacquire"]);
  });

  test("waits running at once give the slot back once, and the last one out takes it again", async () => {
    events.length = 0;
    let finishFirst!: () => void;
    const firstDone = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const first = verifier().yieldAdmission(async () => {
      events.push("wait schema");
      await firstDone;
    });
    const second = verifier().yieldAdmission(async () => {
      events.push("wait config");
      await first;
      events.push("config ready");
    });
    finishFirst();
    await Promise.all([first, second]);
    expect(events).toEqual([
      "release",
      "wait schema",
      "wait config",
      "config ready",
      "queue",
      "reacquire",
    ]);
  });

  test("a wait starting while the slot is still being taken again gives it back only once it is held", async () => {
    events.length = 0;
    let open!: () => void;
    reacquireGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    // The first wait ends; its reacquire queues behind the gate.
    const first = verifier().yieldAdmission(() => Promise.resolve());
    await Bun.sleep(0);
    expect(events).toEqual(["release", "queue"]);
    const second = verifier().yieldAdmission(() => {
      events.push("second wait");
      return Promise.resolve();
    });
    await Bun.sleep(0);
    // Not released while not held.
    expect(events).toEqual(["release", "queue"]);
    open();
    reacquireGate = null;
    await Promise.all([first, second]);
    expect(events).toEqual([
      "release",
      "queue",
      "reacquire",
      "release",
      "second wait",
      "queue",
      "reacquire",
    ]);
  });

  // Last: a failed wait leaves the slot given up for the rest of the process.
  test("a wait that throws does not queue for the slot again: the boot fails", async () => {
    events.length = 0;
    let caught: unknown;
    try {
      await verifier().yieldAdmission(() => {
        events.push("wait");
        return Promise.reject(new Error("not ready"));
      });
    } catch (err) {
      caught = err;
    }
    expect(String(caught)).toContain("not ready");
    expect(events).toEqual(["release", "wait"]);
    // Nothing is held now: a later wait runs without giving anything back.
    events.length = 0;
    await verifier().yieldAdmission(() => {
      events.push("later wait");
      return Promise.resolve();
    });
    expect(events).toEqual(["later wait"]);
  });

  test("a second declaration is refused", () => {
    expect(() =>
      declareExecAdmission({
        release: () => Promise.resolve(),
        reacquire: () => Promise.resolve(),
      }),
    ).toThrow(/declared twice/);
  });
});
