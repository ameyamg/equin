import { GIT } from "@plugins/infra/plugins/paths/server";
import {
  isRelease,
  worktreeArtifacts,
} from "@plugins/infra/plugins/paths/core";
import { REPO_ROOT } from "@plugins/infra/plugins/paths/plugins/repo-root/core";
import { runtimeNamespace } from "@plugins/infra/plugins/runtime-identity/core";
import { spawnExpectOk } from "@plugins/infra/plugins/spawn/core";
import { readFile } from "@plugins/packages/plugins/timed-fs/core";

/**
 * Whether this main backend still runs main's current code, read off this
 * machine. Both:
 *
 * - **it is the backend main's gateway runs** — main's spec (`server`) names
 *   this backend's checkout (`REPO_ROOT`, its slot). A backend main has
 *   switched away from keeps running ~20 s after the switch, the spec already
 *   the new slot's;
 * - **its checkout is main's tip** — `refs/heads/main` is its HEAD. From
 *   main's advance until the new backend's spec is written it is not.
 *
 * A main whose deploy failed keeps serving the old code (its spec put back)
 * and answers false until the next deploy. So does a backend that ADOPTED a
 * deploy (its closure unchanged, it stays in its slot while main's tip moves
 * on) until a deploy restarts it: its checkout holds the previous commit's
 * files, and a cancel job's child would run them (rare on main: 129 builds,
 * ~130 backend boots on 2026-11-26/27). A release has no checkout to move:
 * always current. Roots are compared as git resolves them
 * (`--show-toplevel`), so both sides are spelled alike.
 */
export async function runsMainsCurrentCodeOnThisMachine(): Promise<boolean> {
  if (isRelease()) return true;
  const specPath = worktreeArtifacts.spec(runtimeNamespace());
  const spec = JSON.parse(await readFile(specPath, "utf8")) as {
    server?: unknown;
  };
  if (typeof spec.server !== "string")
    throw new Error(`[supervised-job] ${specPath} names no server`);
  const [me, specRoot] = await Promise.all([
    revParse("--show-toplevel", REPO_ROOT),
    revParse("--show-toplevel", spec.server),
  ]);
  if (specRoot !== me) return false;
  const [tip, head] = await Promise.all([
    revParse("refs/heads/main", me),
    revParse("HEAD", me),
  ]);
  return tip === head;
}

/** `git rev-parse <arg>` in `cwd`, trimmed; a failure throws. */
async function revParse(arg: string, cwd: string): Promise<string> {
  const { stdout } = await spawnExpectOk([GIT, "rev-parse", arg], {
    cwd,
    timeoutMs: 10_000,
  });
  return stdout.trim();
}
