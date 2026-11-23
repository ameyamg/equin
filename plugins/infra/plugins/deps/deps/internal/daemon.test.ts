import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AppPath,
  asAppPath,
  joinAppPath,
} from "@plugins/infra/plugins/host-fs/plugins/user-path/core";
import { execContextForTests } from "@plugins/infra/plugins/jobs/plugins/supervised-job/core/testing";
import { daemonStatus, markDaemonRunningGood, startDaemonDep } from "./daemon";
import { defineDep, type DepSource, type Ready } from "./dep";
import { removeDep } from "./ensure";
import { heldDep } from "./hold";
import { sweepDeps } from "./sweep";

let base: string;
let root: AppPath;
let store: { cacheRoot: AppPath; locksRoot: AppPath };
const exec = execContextForTests();

/** A source whose identity is the checkout's `version` file, installing it as `env/v`. */
const source: DepSource<"daemon-test"> = {
  kind: "daemon-test",
  label: "the version file",
  async identityInputs(r) {
    return { version: await readFile(join(r, "version"), "utf8") };
  },
  async install(ctx) {
    mkdirSync(ctx.dir, { recursive: true });
    writeFileSync(
      join(ctx.dir, "v"),
      readFileSync(join(ctx.root, "version"), "utf8"),
    );
  },
  version: {
    declared: (r) => readFile(join(r, "version"), "utf8"),
    installed: (dir) => readFile(join(dir, "v"), "utf8"),
  },
};

const dep = defineDep({
  id: "daemon-test",
  owner: "infra/deps",
  description: "",
  sizeHint: "",
  source,
  updates: { none: "test" },
  daemon: { holder: "machine-daemon-test", appliesAt: "the next restart" },
});

const version = (v: string) => writeFileSync(join(root, "version"), v);
const payload = (r: Ready<DepSource>) => readFileSync(join(r.dir, "v"), "utf8");

/** A daemon start that records what it ran, failing for the versions in `broken`. */
function daemon(broken: string[] = []) {
  const ran: string[] = [];
  return {
    ran,
    start: async (ready: Ready<DepSource>) => {
      const v = payload(ready);
      ran.push(v);
      if (broken.includes(v)) throw new Error(`${v} would not start`);
    },
  };
}

const start = (d: ReturnType<typeof daemon>) =>
  startDaemonDep(dep, exec, { start: d.start, root, store });

const held = async (holder: string) => {
  const h = await heldDep(dep, holder, { store });
  return h.kind === "held" ? payload(h.ready) : null;
};

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "deps-daemon-test-"));
  root = joinAppPath(asAppPath(base), "repo");
  store = {
    cacheRoot: joinAppPath(asAppPath(base), "cache"),
    locksRoot: joinAppPath(asAppPath(base), "locks"),
  };
  mkdirSync(root, { recursive: true });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe("startDaemonDep", () => {
  test("starts what the checkout declares, and marks it running and last-good", async () => {
    version("1");
    const d = daemon();
    expect((await start(d)).kind).toBe("started");
    expect(d.ran).toEqual(["1"]);
    expect(await held("machine-daemon-test-running")).toBe("1");
    expect(await held("machine-daemon-test")).toBe("1");
  });

  test("follows the declaration: a new version runs from the next start", async () => {
    version("1");
    await start(daemon());
    version("2");
    const d = daemon();
    const outcome = await start(d);
    expect(outcome.kind).toBe("started");
    expect(d.ran).toEqual(["2"]);
    expect(await held("machine-daemon-test")).toBe("2");
  });

  test("a failed start on a new version falls back to the last that started, once", async () => {
    version("1");
    await start(daemon());
    version("2");
    const d = daemon(["2"]);
    const outcome = await start(d);
    expect(outcome.kind).toBe("rolled-back");
    if (outcome.kind !== "rolled-back") return;
    expect(payload(outcome.ready)).toBe("1");
    expect(outcome.failed === null ? null : payload(outcome.failed)).toBe("2");
    expect(outcome.error).toBe("2 would not start");
    expect(d.ran).toEqual(["2", "1"]);
    expect(await held("machine-daemon-test-running")).toBe("1");
    expect(await held("machine-daemon-test")).toBe("1");
  });

  test("a version that failed is not tried again by a later start", async () => {
    version("1");
    await start(daemon());
    version("2");
    await start(daemon(["2"]));
    const d = daemon();
    const outcome = await start(d);
    expect(outcome.kind).toBe("kept-previous");
    expect(d.ran).toEqual(["1"]);
  });

  test("removing the failed install is the retry", async () => {
    version("1");
    await start(daemon());
    version("2");
    await start(daemon(["2"]));
    expect((await removeDep(dep, { root, store })).kind).toBe("removed");
    const d = daemon();
    expect((await start(d)).kind).toBe("started");
    expect(d.ran).toEqual(["2"]);
  });

  test("a failure with nothing to fall back to is thrown", async () => {
    version("1");
    expect(start(daemon(["1"]))).rejects.toThrow("1 would not start");
  });

  test("the fallback failing too throws both", async () => {
    version("1");
    await start(daemon());
    version("2");
    expect(start(daemon(["1", "2"]))).rejects.toThrow(
      /failed to start \(2 would not start\), and so did the previous .*\(1 would not start\)/,
    );
  });

  test("an install that cannot be made falls back without marking anything", async () => {
    version("1");
    await start(daemon());
    rmSync(join(root, "version"));
    const d = daemon();
    const outcome = await start(d);
    expect(outcome.kind).toBe("rolled-back");
    if (outcome.kind === "rolled-back") expect(outcome.failed).toBeNull();
    expect(d.ran).toEqual(["1"]);
  });

  test("a reattach makes what the daemon runs the fallback", async () => {
    version("1");
    await start(daemon());
    // A daemon started before last-good holds existed: only its running hold.
    const running = await heldDep(dep, "machine-daemon-test-running", {
      store,
    });
    if (running.kind !== "held") throw new Error("not running");
    rmSync(join(running.ready.dir, "..", "holds", "machine-daemon-test"));
    expect(await held("machine-daemon-test")).toBeNull();
    await markDaemonRunningGood(dep, { store });
    expect(await held("machine-daemon-test")).toBe("1");
  });

  test("the last install that started survives the sweep", async () => {
    version("1");
    await start(daemon());
    version("2");
    await start(daemon(["2"]));
    await sweepDeps({
      store,
      deps: [dep],
      checkouts: [root],
      now: new Date(Date.now() + 365 * 86_400_000),
      idleMs: 0,
    });
    const good = await heldDep(dep, "machine-daemon-test", { store });
    expect(good.kind === "held" && existsSync(join(good.ready.dir, "v"))).toBe(
      true,
    );
  });
});

describe("daemonStatus", () => {
  test("running, and what the checkout declares against it", async () => {
    version("1");
    expect(await daemonStatus(dep, { root, store })).toMatchObject({
      running: null,
      declared: { kind: "differs", failed: null },
    });
    await start(daemon());
    expect(await daemonStatus(dep, { root, store })).toEqual({
      running: { identity: expect.any(String), version: "1" },
      declared: { kind: "same" },
    });
    version("2");
    expect(await daemonStatus(dep, { root, store })).toMatchObject({
      running: { version: "1" },
      declared: { kind: "differs", install: { version: "2" }, failed: null },
    });
    await start(daemon(["2"]));
    expect(await daemonStatus(dep, { root, store })).toMatchObject({
      running: { version: "1" },
      declared: {
        kind: "differs",
        install: { version: "2" },
        failed: { error: "2 would not start" },
      },
    });
  });

  test("an unreadable declaration says so", async () => {
    expect(await daemonStatus(dep, { root, store })).toMatchObject({
      running: null,
      declared: { kind: "unreadable" },
    });
  });
});
