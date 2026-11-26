// push's pre-rebase stub (./rebase-first.sh), run as `./equin` runs it — but
// in a temp repo holding none of this tree, with only git, sh and cat on PATH.
// That is the stub's stability rule made executable: a stub that reached bun,
// `./equin` or any repo file would fail here.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnCaptured } from "@plugins/infra/plugins/spawn/core";

const STUB = join(import.meta.dir, "rebase-first.sh");
const REBASED = 10;
const TIMEOUT_MS = 30_000;

let tmp: string;
let repo: string;
let bin: string;

async function which(tool: string): Promise<string> {
  const r = await spawnCaptured(["sh", "-c", `command -v ${tool}`], {
    timeoutMs: TIMEOUT_MS,
  });
  if (r.exitCode !== 0) throw new Error(`${tool} not found`);
  return r.stdout.trim();
}

const env = (): Record<string, string> => ({
  PATH: bin,
  HOME: tmp,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t.t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t.t",
});

async function git(...args: string[]): Promise<string> {
  const r = await spawnCaptured(["git", ...args], {
    cwd: repo,
    env: env(),
    timeoutMs: TIMEOUT_MS,
  });
  if (r.exitCode !== 0)
    throw new Error(`git ${args.join(" ")}: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

async function stub(...args: string[]) {
  return spawnCaptured(["sh", STUB, "push", ...args], {
    cwd: repo,
    env: env(),
    timeoutMs: TIMEOUT_MS,
  });
}

async function commitFile(name: string, body: string, message = name) {
  writeFileSync(join(repo, name), body);
  await git("add", name);
  await git("commit", "-q", "-m", message);
}

const isAncestor = async (a: string, b: string) =>
  (
    await spawnCaptured(["git", "merge-base", "--is-ancestor", a, b], {
      cwd: repo,
      env: env(),
      timeoutMs: TIMEOUT_MS,
    })
  ).exitCode === 0;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "push-rebase-first-"));
  repo = join(tmp, "repo");
  bin = join(tmp, "bin");
  mkdirSync(repo);
  mkdirSync(bin);
  for (const tool of ["git", "sh", "cat"])
    symlinkSync(await which(tool), join(bin, tool));
  await git("init", "-q", "-b", "main");
  await commitFile("base", "base\n");
  await git("checkout", "-q", "-b", "work");
  await commitFile("one", "1\n");
  await commitFile("two", "2\n");
  await git("checkout", "-q", "main");
  await commitFile("moved", "main moved\n");
  await git("checkout", "-q", "work");
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("rebase-first.sh", () => {
  test("a branch main moved past is rebased onto it, commits intact", async () => {
    const r = await stub();
    expect(r.exitCode).toBe(REBASED);
    expect(await isAncestor("main", "HEAD")).toBe(true);
    expect(await git("log", "--format=%s", "main..HEAD")).toBe("two\none");
    expect(await git("status", "--porcelain")).toBe("");
  });

  test("uncommitted work rides the rebase and comes back uncommitted", async () => {
    writeFileSync(join(repo, "two"), "2 edited\n");
    writeFileSync(join(repo, "new"), "untracked\n");
    const r = await stub("-m", "msg");
    expect(r.exitCode).toBe(REBASED);
    expect(await isAncestor("main", "HEAD")).toBe(true);
    expect(await git("log", "-1", "--format=%s")).toBe("two");
    expect(await git("diff", "--cached", "--name-only")).toBe("");
    expect(await git("diff", "--name-only")).toBe("two");
    expect(await git("ls-files", "--others", "--exclude-standard")).toBe("new");
    // The driver's mark: the HEAD this stub rebased to.
    expect(await git("rev-parse", "refs/equin/push-rebased/work")).toBe(
      await git("rev-parse", "HEAD"),
    );
  });

  test("a dirty tree without -m is left alone (nothing would land)", async () => {
    writeFileSync(join(repo, "two"), "2 edited\n");
    const before = await git("rev-parse", "HEAD");
    expect((await stub()).exitCode).toBe(0);
    expect(await git("rev-parse", "HEAD")).toBe(before);
  });

  test("a conflict aborts and restores the branch and the work", async () => {
    await git("checkout", "-q", "main");
    await commitFile("two", "main's two\n", "main two");
    await git("checkout", "-q", "work");
    writeFileSync(join(repo, "one"), "1 edited\n");
    const before = await git("rev-parse", "HEAD");
    const r = await stub("--message=msg");
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Rebase of work onto main failed (aborted)");
    expect(await git("rev-parse", "HEAD")).toBe(before);
    expect(await git("diff", "--cached", "--name-only")).toBe("");
    expect(await git("diff", "--name-only")).toBe("one");
    expect(r.stderr).toContain("Commit your uncommitted work first");
    expect(await git("for-each-ref", "refs/equin/push-rebased")).toBe("");
  });

  test("leaves alone: contains main, merges, main itself, help", async () => {
    // help
    expect((await stub("--help")).exitCode).toBe(0);
    // a merge commit in main..HEAD
    await git("merge", "-q", "--no-ff", "-m", "merge", "main");
    await git("checkout", "-q", "-b", "merged", "HEAD~1");
    await commitFile("three", "3\n");
    await git("merge", "-q", "--no-ff", "-m", "merge2", "work");
    const merged = await git("rev-parse", "HEAD");
    await git("checkout", "-q", "main");
    await commitFile("moved2", "again\n");
    await git("checkout", "-q", "merged");
    expect((await stub()).exitCode).toBe(0);
    expect(await git("rev-parse", "HEAD")).toBe(merged);
    // already contains main
    await git("checkout", "-q", "-b", "fresh", "main");
    await commitFile("four", "4\n");
    expect((await stub()).exitCode).toBe(0);
    // on main
    await git("checkout", "-q", "main");
    expect((await stub()).exitCode).toBe(0);
  });
});
