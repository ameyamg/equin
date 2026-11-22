import { PRODUCT_NAME } from "@plugins/framework/plugins/product-name/core";
import { spawnCaptured } from "@plugins/infra/plugins/spawn/core";

// The lease a branch push writes under: what this checkout believes the
// remote branch holds, so a push never overwrites a commit someone else put
// there.
//
// git's own `--force-with-lease` (no value) takes that belief from the
// remote-tracking ref, which git writes only when it SAW the push succeed. A
// push whose connection drops after the server accepted it (`RPC failed; curl
// 56`, 2026-11-22) leaves the branch on the remote and the tracking ref
// unwritten — so every retry expects the branch "not to exist", finds it, and
// is refused as `stale info`, forever.
//
// So the lease follows what this checkout actually SENT: each commit is
// recorded under `refs/<product>/push-attempts/<branch>/<sha>` before git
// sends it, and a remote tip equal to the tracking ref or to any recorded
// attempt is ours to replace. Anything else is someone else's commit, and the
// push is refused naming it. The records are dropped once a push of the
// branch succeeds (the tracking ref then holds the truth again). The lease is
// passed as an explicit sha, so a remote that moves between the read and the
// write is still refused by git itself.

const GIT_TIMEOUT_MS = 300_000;

const ATTEMPTS_ROOT = `refs/${PRODUCT_NAME}/push-attempts`;

function attemptsPrefix(branch: string): string {
  return `${ATTEMPTS_ROOT}/${branch}/`;
}

async function git(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; exitCode: number; stderr: string }> {
  const r = await spawnCaptured(["git", ...args], {
    cwd,
    timeoutMs: GIT_TIMEOUT_MS,
  });
  return { stdout: r.stdout.trim(), exitCode: r.exitCode, stderr: r.stderr };
}

async function gitOk(args: string[], cwd: string): Promise<string> {
  const r = await git(args, cwd);
  if (r.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (exit ${r.exitCode}): ${r.stderr.trim()}`,
    );
  }
  return r.stdout;
}

/** Why the remote tip may be replaced. */
export type LeaseBasis =
  | "absent" // the branch is not on the remote yet
  | "tracking" // it is where git's tracking ref says
  | "own-attempt"; // it is a commit an earlier push of this checkout sent

export type BranchLease =
  | {
      kind: "lease";
      /** The remote tip the push may replace; null = must not exist. */
      expect: string | null;
      basis: LeaseBasis;
      /** `--force-with-lease=refs/heads/<branch>:<expect>`. */
      flag: string;
    }
  | { kind: "refused"; remoteTip: string; message: string };

export async function decideBranchLease(
  remote: string,
  branch: string,
  cwd: string,
): Promise<BranchLease> {
  const remoteRef = `refs/heads/${branch}`;
  const lease = (expect: string | null, basis: LeaseBasis): BranchLease => ({
    kind: "lease",
    expect,
    basis,
    flag: `--force-with-lease=${remoteRef}:${expect ?? ""}`,
  });

  const remoteTip = await readRemoteTip(remote, remoteRef, cwd);
  if (remoteTip === null) return lease(null, "absent");

  const tracking = await readRef(`refs/remotes/${remote}/${branch}`, cwd);
  if (tracking === remoteTip) return lease(remoteTip, "tracking");

  const attempts = await listAttempts(branch, cwd);
  if (attempts.includes(remoteTip)) return lease(remoteTip, "own-attempt");

  return {
    kind: "refused",
    remoteTip,
    message: await describeForeignTip(remote, branch, remoteTip, tracking, cwd),
  };
}

/** Records `sha` as sent by this checkout, before git sends it. */
export async function recordPushAttempt(
  branch: string,
  sha: string,
  cwd: string,
): Promise<void> {
  await gitOk(["update-ref", `${attemptsPrefix(branch)}${sha}`, sha], cwd);
}

/** Drops the records once a push of `branch` landed: the tracking ref holds it now. */
export async function clearPushAttempts(
  branch: string,
  cwd: string,
): Promise<void> {
  const refs = await gitOk(
    ["for-each-ref", "--format=%(refname)", attemptsPrefix(branch)],
    cwd,
  );
  for (const ref of refs.split("\n").filter((l) => l.length > 0))
    await gitOk(["update-ref", "-d", ref], cwd);
}

async function listAttempts(branch: string, cwd: string): Promise<string[]> {
  const out = await gitOk(
    ["for-each-ref", "--format=%(objectname)", attemptsPrefix(branch)],
    cwd,
  );
  return out.split("\n").filter((l) => l.length > 0);
}

async function readRemoteTip(
  remote: string,
  remoteRef: string,
  cwd: string,
): Promise<string | null> {
  const out = await gitOk(["ls-remote", remote, remoteRef], cwd);
  for (const line of out.split("\n")) {
    const [sha, name] = line.split("\t");
    if (name === remoteRef && sha !== undefined) return sha;
  }
  return null;
}

async function readRef(ref: string, cwd: string): Promise<string | null> {
  const r = await git(["rev-parse", "--verify", "--quiet", ref], cwd);
  if (r.exitCode === 0) return r.stdout;
  if (r.exitCode === 1) return null;
  throw new Error(
    `git rev-parse ${ref} failed (exit ${r.exitCode}): ${r.stderr.trim()}`,
  );
}

// Whose commit the remote branch holds, and what to do about it. Fetched into
// FETCH_HEAD only (`--refmap=` turns off git's opportunistic tracking-ref
// update), so reading it never makes the next push accept it silently.
async function describeForeignTip(
  remote: string,
  branch: string,
  remoteTip: string,
  tracking: string | null,
  cwd: string,
): Promise<string> {
  const have = await git(["cat-file", "-e", `${remoteTip}^{commit}`], cwd);
  if (have.exitCode !== 0)
    await gitOk(
      ["fetch", "--quiet", "--refmap=", remote, `refs/heads/${branch}`],
      cwd,
    );
  const who = await gitOk(
    ["log", "-1", "--format=%h by %an <%ae>, %cr: %s", remoteTip],
    cwd,
  );
  return [
    `${remote}/${branch} holds ${who}`,
    `That is not a commit this checkout pushed: ` +
      (tracking === null
        ? `it has never seen the branch on ${remote}`
        : `its last known tip was ${tracking.slice(0, 10)}`) +
      `, and no earlier push attempt of it sent ${remoteTip.slice(0, 10)}. ` +
      `Someone else moved the branch, so this push refuses to overwrite it.`,
    `Look at it: git log ${remoteTip.slice(0, 10)}`,
    `  - to keep that work, bring it into ${branch} (git rebase ${remoteTip.slice(0, 10)}, or cherry-pick it), then re-run ./equin push;`,
    `  - to overwrite it on purpose, take it as known (git fetch ${remote} refs/heads/${branch}:refs/remotes/${remote}/${branch}), then re-run ./equin push.`,
  ].join("\n");
}
