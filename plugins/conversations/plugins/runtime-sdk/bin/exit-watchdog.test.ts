import { afterAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each case runs a stand-in agent: a bun process that starts the watchdog,
// writes a pid file and spawns a long-lived child (its "CLI"), then ends one
// way. The helper inherits the stand-in's stdout, so the test's read of that
// pipe ends only once the helper has exited too — no polling.

const root = mkdtempSync(join(tmpdir(), "exit-watchdog-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const GRACE_S = 2;
/** Stands in for `sample`: always succeeds. */
const TRUE_BIN = Bun.which("true") ?? "true";

type Ending = "wedged-exit" | "clean-exit" | "killed-unarmed";

/**
 * Stands in for `sysctl -n kern.waketime`: the wake the test's `wake` file
 * holds (epoch seconds), in sysctl's own format. A machine sleep is never
 * real here — only the kernel's word that one ended.
 */
function fakeSysctl(dir: string): string {
  const bin = join(dir, "sysctl");
  writeFileSync(
    bin,
    `#!/bin/sh\necho "{ sec = $(cat ${JSON.stringify(join(dir, "wake"))}), usec = 0 } Mon Nov 23 00:00:00 2026"\n`,
    { mode: 0o755 },
  );
  return bin;
}

/**
 * `wakeAfterArmS`: the machine "woke" that many seconds after the exit was
 * armed (null: its last wake long before).
 */
function fixture(
  ending: Ending,
  dir: string,
  wakeAfterArmS: number | null,
): string {
  return `
import { spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { startExitWatchdog } from ${JSON.stringify(join(import.meta.dir, "exit-watchdog.ts"))};
const dir = ${JSON.stringify(dir)};
const watchdog = startExitWatchdog({ graceSeconds: ${GRACE_S}, sampleBin: ${JSON.stringify(TRUE_BIN)}, sysctlBin: ${JSON.stringify(fakeSysctl(dir))} });
const wakeAfterArmS = ${JSON.stringify(wakeAfterArmS)};
writeFileSync(dir + "/wake", "1");
const cli = spawn("/bin/sleep", ["60"], { stdio: "ignore" });
writeFileSync(dir + "/pid", String(process.pid));
writeFileSync(dir + "/events.jsonl", JSON.stringify({ seq: 7, t: 0, kind: "agent", payload: { event: "exited", reason: "x" } }) + "\\n");
console.log(JSON.stringify({ agent: process.pid, cli: cli.pid, watchdog: watchdog.pid }));
const arm = () => {
  if (wakeAfterArmS !== null)
    writeFileSync(dir + "/wake", String(Math.floor(Date.now() / 1000) + wakeAfterArmS));
  watchdog.arm({
  eventsPath: dir + "/events.jsonl",
  seqFloor: 3,
  samplePath: dir + "/sample.txt",
  sampledTail: '"t":1,"kind":"agent","payload":{"event":"exit_stalled","sampled":true}}',
  unsampledTail: '"t":1,"kind":"agent","payload":{"event":"exit_stalled","sampled":false}}',
  });
};
switch (${JSON.stringify(ending)}) {
  case "wedged-exit":
    // The 2026-11-08 shape: the exit listener arms and removes the pid file,
    // then the exit never completes and no JavaScript runs again.
    process.on("exit", () => {
      arm();
      rmSync(dir + "/pid");
      for (;;) {}
    });
    process.exit(0);
    break;
  case "clean-exit":
    arm();
    cli.kill("SIGKILL");
    process.exit(0);
    break;
  case "killed-unarmed":
    // The CLI outlives it here: were the arm pipe inherited, the helper would
    // never see the agent end.
    process.kill(process.pid, "SIGKILL");
}
`;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw err;
  }
}

async function run(ending: Ending, wakeAfterArmS: number | null = null) {
  const dir = mkdtempSync(join(root, `${ending}-`));
  const script = join(dir, "agent.ts");
  writeFileSync(script, fixture(ending, dir, wakeAfterArmS));
  const started = Date.now();
  const proc = spawn(process.execPath, [script], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  let out = "";
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk: string) => (out += chunk));
  const exit = new Promise<NodeJS.Signals | number | null>((resolve) =>
    proc.on("exit", (code, signal) => resolve(signal ?? code)),
  );
  // Ends once the stand-in AND the helper (which shares the pipe) are gone.
  await new Promise<void>((resolve) => proc.stdout.on("end", resolve));
  const ended = await exit;
  const pids = JSON.parse(out.split("\n")[0]!) as {
    agent: number;
    cli: number;
    watchdog: number;
  };
  return {
    dir,
    out,
    pids,
    ended,
    elapsedMs: Date.now() - started,
    events: readFileSync(join(dir, "events.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean),
  };
}

describe("exit watchdog", () => {
  test("an exit wedged after the pid file went is killed, the CLI with it, and reported", async () => {
    const r = await run("wedged-exit");
    expect(existsSync(join(r.dir, "pid"))).toBe(false);
    expect(r.ended).toBe("SIGKILL");
    expect(alive(r.pids.cli)).toBe(false);
    expect(r.elapsedMs).toBeGreaterThanOrEqual(GRACE_S * 1000);
    expect(r.out).toContain("exit watchdog: agent");
    // Numbered past the file's last seq (7), above the floor (3).
    expect(JSON.parse(r.events.at(-1)!)).toEqual({
      seq: 8,
      t: 1,
      kind: "agent",
      payload: { event: "exit_stalled", sampled: true },
    });
  }, 20_000);

  test("a wake inside the grace restarts it: the nap is not stall time", async () => {
    // The kernel says the machine woke 3 s after the arm — past the 2 s grace
    // the wall clock already counted. The helper restarts the grace from the
    // wake, so the kill comes a full grace after it, not at once.
    const r = await run("wedged-exit", GRACE_S + 1);
    expect(r.ended).toBe("SIGKILL");
    expect(r.elapsedMs).toBeGreaterThanOrEqual((2 * GRACE_S + 1) * 1000 - 1000);
    expect(r.out).toContain("exit watchdog: agent");
  }, 30_000);

  test("an exit that completes after arming is left alone", async () => {
    const r = await run("clean-exit");
    expect(r.ended).toBe(0);
    expect(r.events).toHaveLength(1);
    expect(r.out).not.toContain("exit watchdog");
    expect(r.elapsedMs).toBeLessThan(GRACE_S * 1000);
  }, 20_000);

  test("an agent that dies without arming takes the watchdog with it", async () => {
    const r = await run("killed-unarmed");
    expect(r.events).toHaveLength(1);
    expect(r.out).not.toContain("exit watchdog");
    expect(alive(r.pids.watchdog)).toBe(false);
    process.kill(r.pids.cli, "SIGKILL");
  }, 20_000);
});
