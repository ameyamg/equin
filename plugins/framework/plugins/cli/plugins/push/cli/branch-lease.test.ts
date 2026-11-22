import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  spawnCaptured,
  spawnExpectOk,
} from "@plugins/infra/plugins/spawn/core";
import {
  clearPushAttempts,
  decideBranchLease,
  recordPushAttempt,
} from "./branch-lease";

// Real git: a bare remote, this checkout's clone, and another clone that can
// move the branch behind its back.
const BRANCH = "claude-web/att-1";
let dir = "";
let n = 0;

async function git(cwd: string, ...args: string[]): Promise<string> {
  const r = await spawnExpectOk(["git", ...args], { cwd, timeoutMs: 60_000 });
  return r.stdout.trim();
}

async function commit(cwd: string, msg: string): Promise<string> {
  await git(cwd, "commit", "-q", "--allow-empty", "-m", msg);
  return git(cwd, "rev-parse", "HEAD");
}

async function setup(): Promise<{
  remote: string;
  mine: string;
  other: string;
}> {
  const base = join(dir, `case-${n++}`);
  const remote = join(base, "remote.git");
  await spawnExpectOk(["git", "init", "-q", "--bare", remote], {
    timeoutMs: 60_000,
  });
  const clone = async (name: string): Promise<string> => {
    const path = join(base, name);
    await spawnExpectOk(["git", "clone", "-q", remote, path], {
      timeoutMs: 60_000,
    });
    await git(path, "config", "user.name", name);
    await git(path, "config", "user.email", `${name}@example.com`);
    await git(path, "checkout", "-q", "-b", BRANCH);
    return path;
  };
  return { remote, mine: await clone("mine"), other: await clone("other") };
}

// What land.ts does: record, push under the decided lease, clear on success.
async function push(cwd: string): Promise<{ exitCode: number; out: string }> {
  const lease = await decideBranchLease("origin", BRANCH, cwd);
  if (lease.kind === "refused") return { exitCode: -1, out: lease.message };
  await recordPushAttempt(BRANCH, await git(cwd, "rev-parse", "HEAD"), cwd);
  const r = await spawnCaptured(
    ["git", "push", "-q", lease.flag, "-u", "origin", BRANCH],
    { cwd, timeoutMs: 60_000 },
  );
  if (r.exitCode === 0) await clearPushAttempts(BRANCH, cwd);
  return { exitCode: r.exitCode, out: r.stderr };
}

// A push the server accepted but whose reply never arrived: the commit is on
// the remote, the tracking ref is not written.
async function droppedPush(cwd: string): Promise<string> {
  const sha = await git(cwd, "rev-parse", "HEAD");
  await recordPushAttempt(BRANCH, sha, cwd);
  await git(
    cwd,
    "push",
    "-q",
    "--no-verify",
    "origin",
    `HEAD:refs/heads/${BRANCH}`,
  );
  await git(cwd, "update-ref", "-d", `refs/remotes/origin/${BRANCH}`);
  return sha;
}

describe("branch lease (real git)", () => {
  // No user or system config: a signing or hook setting must not reach these repos.
  const saved = {
    global: process.env.GIT_CONFIG_GLOBAL,
    nosystem: process.env.GIT_CONFIG_NOSYSTEM,
  };
  beforeAll(() => {
    process.env.GIT_CONFIG_GLOBAL = "/dev/null";
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    dir = mkdtempSync(join(tmpdir(), "branch-lease-"));
  });
  afterAll(() => {
    if (saved.global === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = saved.global;
    if (saved.nosystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
    else process.env.GIT_CONFIG_NOSYSTEM = saved.nosystem;
    rmSync(dir, { recursive: true, force: true });
  });

  test("a first push expects the branch absent, then the tracking ref", async () => {
    const { mine } = await setup();
    await commit(mine, "one");
    expect(await decideBranchLease("origin", BRANCH, mine)).toMatchObject({
      kind: "lease",
      basis: "absent",
      flag: `--force-with-lease=refs/heads/${BRANCH}:`,
    });
    expect((await push(mine)).exitCode).toBe(0);

    await git(
      mine,
      "commit",
      "-q",
      "--amend",
      "--allow-empty",
      "-m",
      "rebased",
    );
    expect(await decideBranchLease("origin", BRANCH, mine)).toMatchObject({
      kind: "lease",
      basis: "tracking",
    });
    expect((await push(mine)).exitCode).toBe(0);
  });

  test("a retry after a push dropped once the remote took it succeeds", async () => {
    const { mine, remote } = await setup();
    await commit(mine, "one");
    const sent = await droppedPush(mine);

    // git's own lease (the tracking ref) is what used to refuse every retry.
    await git(
      mine,
      "commit",
      "-q",
      "--amend",
      "--allow-empty",
      "-m",
      "rebased",
    );
    const plain = await spawnCaptured(
      ["git", "push", "--force-with-lease", "origin", BRANCH],
      { cwd: mine, timeoutMs: 60_000 },
    );
    expect(plain.exitCode).not.toBe(0);
    expect(plain.stderr).toContain("stale info");

    expect(await decideBranchLease("origin", BRANCH, mine)).toMatchObject({
      kind: "lease",
      basis: "own-attempt",
      expect: sent,
    });
    expect((await push(mine)).exitCode).toBe(0);
    expect(await git(remote, "rev-parse", BRANCH)).toBe(
      await git(mine, "rev-parse", "HEAD"),
    );
    // Landed: the records are gone, the tracking ref holds the tip.
    expect(await git(mine, "for-each-ref", "refs/equin/push-attempts/")).toBe(
      "",
    );
  });

  test("a branch someone else moved is still refused, naming their commit", async () => {
    const { mine, other, remote } = await setup();
    await commit(mine, "one");
    expect((await push(mine)).exitCode).toBe(0);

    await git(other, "fetch", "-q", "origin", BRANCH);
    await git(other, "reset", "-q", "--hard", `origin/${BRANCH}`);
    const theirs = await commit(other, "their change");
    await git(other, "push", "-q", "origin", BRANCH);

    await commit(mine, "two");
    const lease = await decideBranchLease("origin", BRANCH, mine);
    expect(lease.kind).toBe("refused");
    if (lease.kind !== "refused") throw new Error("unreachable");
    expect(lease.remoteTip).toBe(theirs);
    expect(lease.message).toContain("by other <other@example.com>");
    expect(lease.message).toContain("their change");
    // Reading it did not quietly make it "known".
    expect(
      await git(mine, "rev-parse", `refs/remotes/origin/${BRANCH}`),
    ).not.toBe(theirs);
    expect(await git(remote, "rev-parse", BRANCH)).toBe(theirs);
  });

  test("someone moving it after a dropped push is refused too", async () => {
    const { mine, other } = await setup();
    await commit(mine, "one");
    await droppedPush(mine);

    await git(other, "fetch", "-q", "origin", BRANCH);
    await git(other, "reset", "-q", "--hard", `origin/${BRANCH}`);
    await commit(other, "their change");
    await git(other, "push", "-q", "origin", BRANCH);

    await git(
      mine,
      "commit",
      "-q",
      "--amend",
      "--allow-empty",
      "-m",
      "rebased",
    );
    expect((await decideBranchLease("origin", BRANCH, mine)).kind).toBe(
      "refused",
    );
  });
});
