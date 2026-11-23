import { mkdtemp, rm } from "node:fs/promises";
import { exists } from "@plugins/packages/plugins/timed-fs/core";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import {
  asAppPath,
  type AppPath,
} from "@plugins/infra/plugins/host-fs/plugins/user-path/core";
import {
  actAsCheckoutNamespace,
  checkoutAdminDir,
  checkoutNamespace,
} from "@plugins/infra/plugins/paths/core";
import { CLI_NAME } from "@plugins/framework/plugins/cli/plugins/cli-name/core";
import {
  databaseExists,
  dropDatabase,
} from "@plugins/database/plugins/admin/server";
import { spawnPassthrough } from "@plugins/infra/plugins/spawn/core";
import {
  addCheckout,
  withWorktreeMutateSlot,
} from "@plugins/infra/plugins/worktree/server";

/**
 * `fn` run in a throwaway checkout of `rev` (detached) with its own database,
 * both deleted afterwards whatever `fn` did. Made by `infra/worktree`'s crash-safe add under the
 * host-wide worktree-mutate gate, like every full-tree checkout (never `git
 * worktree add`, which dies beside another add half-way through writing its
 * entry). Its dir name is unique (random), so the namespace a command run in
 * it acts as is its own; that namespace's data dir is reaped once the checkout
 * is gone.
 *
 * The database is a fork of main's (`./equin db fork`, run in the checkout —
 * what every agent worktree starts from): suites that drive the checkout's own
 * database (the `worktree-db` harness, the tasks-core queries) fail with
 * `database "<name>" does not exist` without one, and a run at the merge base
 * that fails for its ENVIRONMENT would read as "already failing there" and
 * wave a real breakage through. Only the code may differ from a worktree's run.
 */
export async function withScratchCheckout<T>(
  repoRoot: AppPath,
  rev: string,
  fn: (dir: AppPath) => Promise<T>,
): Promise<T> {
  const parent = await mkdtemp(join(tmpdir(), "equin-gate-base-"));
  // The checkout's dir name is the namespace a command run in it acts as:
  // lowercase letters, digits and dashes only (mkdtemp's suffix is mixed-case).
  const dir = asAppPath(join(parent, `gate-base-${randomUUID().slice(0, 8)}`));
  try {
    await withWorktreeMutateSlot(() =>
      addCheckout(
        `test gate merge base ${rev.slice(0, 10)}`,
        repoRoot,
        dir,
        { kind: "detached", rev },
        { recycle: false, onStep: () => {}, tier: "foreground" },
      ),
    );
    // Stamped before anything is made in its name: a push killed from here on
    // runs no `finally`, and the worktree reaper reclaims a stamped namespace
    // (its database included) once its checkout is gone.
    await actAsCheckoutNamespace(dir);
    const forked = await spawnPassthrough([join(dir, CLI_NAME), "db", "fork"], {
      cwd: dir,
    });
    if (forked.exitCode !== 0)
      throw new Error(
        `test gate: \`./${CLI_NAME} db fork\` in the merge-base checkout ${dir} exited ${forked.exitCode} — see its output above.`,
      );
    return await fn(dir);
  } finally {
    // Each step on its own: one that fails (the cluster unreachable) must not
    // leave the tree behind, nor hide what the others or `fn` threw.
    const failures: unknown[] = [];
    for (const step of [
      () => dropScratchDatabase(dir),
      () => discardCheckout(dir),
      () => rm(parent, { recursive: true, force: true }),
    ])
      await step().catch((err: unknown) => {
        failures.push(err);
      });
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        `test gate: could not fully delete the merge-base checkout ${dir} (and its database) — remove what is left by hand`,
      );
  }
}

/** The scratch checkout's database, when its fork got as far as making it. */
async function dropScratchDatabase(dir: AppPath): Promise<void> {
  if (!(await exists(dir))) return;
  const name = await checkoutNamespace(dir);
  if (await databaseExists(name))
    await dropDatabase({
      unserved: name,
      reason:
        "the push test gate's merge-base checkout: only its test run used it, and that run has ended",
    });
}

/**
 * Delete the scratch checkout's registration (`<common git dir>/worktrees/<id>`,
 * only its own — never a repo-wide prune) under the mutate gate, then its tree.
 * A checkout `addCheckout` never made (it failed and cleaned up) has no `.git`.
 */
async function discardCheckout(dir: AppPath): Promise<void> {
  const admin = await checkoutAdminDir(dir);
  if (admin !== null) {
    const entry = dirname(admin);
    if (!dirname(entry).endsWith("/worktrees"))
      throw new Error(
        `test gate: ${dir}'s git dir ${entry} is not a linked worktree's entry — refusing to delete it`,
      );
    await withWorktreeMutateSlot(() =>
      rm(entry, { recursive: true, force: true }),
    );
  }
  await rm(dir, { recursive: true, force: true });
}
