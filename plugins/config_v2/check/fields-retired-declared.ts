import type { Check } from "@plugins/framework/plugins/tooling/core";
import { codegenPassOver } from "@plugins/framework/plugins/tooling/plugins/codegen/core";
import {
  getWorktreeRoot,
  spawnCaptured,
  spawnExpectOk,
} from "@plugins/infra/plugins/spawn/core";
import { loadConfigRegistrations } from "./config-registrations";
import { originRelPath, undeclaredFieldRemovals } from "./fields-retired";

// Wedge-breaker for local git metadata reads.
const GIT_TIMEOUT_MS = 60_000;

/** `git merge-base HEAD main` — the commit main's users' saved config was written against. */
async function mergeBaseWithMain(root: string): Promise<string> {
  const out = await spawnExpectOk(["git", "merge-base", "HEAD", "main"], {
    cwd: root,
    timeoutMs: GIT_TIMEOUT_MS,
  });
  return out.stdout.trim();
}

/**
 * The text of each `paths` entry at `rev` (absent when the rev has no such
 * file), in ONE `git cat-file --batch`. Sizes are in bytes, so the output is
 * split on its bytes, never its decoded text.
 */
async function filesAt(
  root: string,
  rev: string,
  paths: readonly string[],
): Promise<Map<string, string>> {
  const result = await spawnCaptured(["git", "cat-file", "--batch"], {
    cwd: root,
    timeoutMs: GIT_TIMEOUT_MS,
    stdin: paths.map((p) => `${rev}:${p}\n`).join(""),
  });
  if (result.timedOut || result.exitCode !== 0) {
    throw new Error(
      `git cat-file --batch failed in ${root} (exit ${result.exitCode}${result.timedOut ? ", timed out" : ""}): ${result.stderr.trim()}`,
    );
  }
  const bytes = result.stdoutBytes;
  const decoder = new TextDecoder();
  const out = new Map<string, string>();
  let at = 0;
  for (const path of paths) {
    const eol = bytes.indexOf(0x0a, at);
    if (eol < 0) {
      throw new Error(`git cat-file --batch ended before ${rev}:${path}`);
    }
    const header = decoder.decode(bytes.subarray(at, eol));
    at = eol + 1;
    if (header.endsWith(" missing")) continue;
    const [, type, size] = header.split(" ");
    if (type !== "blob" || size === undefined) {
      throw new Error(
        `git cat-file --batch: ${rev}:${path} is not a blob (${header})`,
      );
    }
    const end = at + Number(size);
    out.set(path, decoder.decode(bytes.subarray(at, end)));
    at = end + 1; // the newline after the content
  }
  return out;
}

/**
 * A field key a config's committed origin held at the merge base with main
 * that the code no longer declares must be declared retired — on the
 * descriptor (`retiredFields`: renamed to a field, or removed with a reason)
 * or by a migration that rewrites saved documents (`renames` / `removes`).
 *
 * Why: a config's schema is `.passthrough()`, so a user's saved value under a
 * key the code stopped reading is never flagged; the new key backfills its
 * default and the setting silently reverts. The merge base's origins are what
 * users' saved config was written against, read with git (the working tree's
 * origins may not be regenerated yet). Modelled on
 * `published-migrations-immutable`: not input-keyed, the merge base part of
 * the cache signature.
 */
const check: Check = {
  id: "config-v2:fields-retired-declared",
  description:
    "every config field key present at the merge base with main and gone from its descriptor is declared retired (retiredFields) or named by a migration (renames / removes)",
  async cacheSignature(): Promise<string> {
    return `merge-base=${await mergeBaseWithMain(await getWorktreeRoot())}`;
  },
  async run(ctx) {
    const root = await getWorktreeRoot();
    const loaded = await loadConfigRegistrations(
      codegenPassOver(await ctx.repo()),
    );
    if (!loaded.ok) return loaded;
    const storePaths = [
      ...new Set(loaded.registrations.map((r) => r.storePath)),
    ];
    const base = await mergeBaseWithMain(root);
    const files = await filesAt(root, base, storePaths.map(originRelPath));
    const originAt = new Map<string, string>();
    for (const storePath of storePaths) {
      const text = files.get(originRelPath(storePath));
      if (text !== undefined) originAt.set(storePath, text);
    }
    const removals = undeclaredFieldRemovals(loaded.registrations, originAt);
    if (removals.length === 0) return { ok: true };
    return {
      ok: false,
      message:
        `${removals.length} config field key(s) present at the merge base with main (${base.slice(0, 10)}) are gone from their descriptor, undeclared — a user's saved value under them would be silently stranded:\n` +
        removals.map((r) => `    ${r.storePath}: ${r.path}`).join("\n"),
      hint:
        'Declare each on its defineConfig: `retiredFields: { "<old>": { renamedTo: "<new>", reason } }` for a rename ' +
        "(an automatic merge carries the user's value over) or `{ reason }` for a removal (the merge drops it and says why); " +
        'or add a `defineConfigMigration({ id, renames: { "<old>": "<new>" } | removes: ["<old>"], apply })` that rewrites saved documents.',
    };
  },
};

export default check;
