import { basename } from "node:path";
import type { AppPath } from "@plugins/infra/plugins/host-fs/plugins/user-path/core";
import { cloneNamedBinary } from "@plugins/packages/plugins/process-name/machine";
import { recordReport } from "@plugins/reports/plugins/engine/server";
import { conversationDisplayTitle } from "../../server/internal/rows";
import { linkName } from "./link-name";
import { agentBinDir } from "./paths";

// What an agent runs its claude through, named for its conversation: a copy of
// the disclaim-exec helper (packages/spawn-disclaim) under the name
// `equin · conv-… · Fix login bug`. The agent spawns
// `disclaim-exec <named copy> --exec-named <claude> …`: the disclaim makes the
// named copy the responsible process, and the copy then names the process
// after its own file and becomes the one shared claude (same pid).
//
// - A macOS permission prompt names the responsible process's file, and TCC
//   keys a bundle-less client's decisions by that path (measured 2026-10-24),
//   so a prompt says which agent asks and each conversation's grants are its
//   own. Both follow the named copy across the exec (measured 2026-11-24:
//   tccd's `responsible_path` stays the copy, with claude as `binary_path`).
// - Activity Monitor lists the process under the same name (its
//   LaunchServices display name); `ps` shows it as argv[0]. `top` reads the
//   kernel's name and says `claude`.
//
// Why a launcher and not a named copy of claude itself (what this was until
// 2026-11-25): macOS scans a new executable file on its first exec, and the
// scan grows with the file — 3.3 s for the 344 MB claude at every new
// conversation's first start, ~0.15 s for this 35 KB helper. The shared
// claude is scanned once per install (claude-cli/sdk's build-time scan).
//
// The name is chosen ONCE, at the conversation's first start, and kept across
// its relaunches (read back from the previous launch's options), so a grant
// lasts the whole conversation even when its title changes. The copy is
// re-made only when the helper itself changed (its source or compiler): it is
// ad-hoc signed, so TCC then sees a new program and asks again.
//
// The copy outlives the agent, so a later start finds it current and scanned.
// One a helper rebuild replaced — and the named claude copies older starts
// left — go with the daily reclaim (`agent-dirs-reclaim.ts`).

/**
 * The named launcher this start of `conversationId` runs claude through, or
 * null to run claude itself — no disclaim (the prompt names the gateway, so a
 * name would show nowhere), or a filesystem refusing the copy (reported).
 */
export async function namedLauncher(opts: {
  conversationId: string;
  disclaimExec: AppPath | null;
  previous: string | null;
}): Promise<AppPath | null> {
  const { conversationId: id } = opts;
  if (opts.disclaimExec === null) return null;
  const dir = agentBinDir(id);
  const name = opts.previous
    ? basename(opts.previous)
    : linkName(await conversationDisplayTitle(id), id);
  const named = await cloneNamedBinary({
    bin: opts.disclaimExec,
    dir,
    name,
  });
  if (named.kind === "cloned") return named.path;
  await recordReport({
    kind: "crash",
    source: "server-caught",
    message: `SDK agent ${id}: could not copy its launcher into ${dir} (${named.code}), so its macOS permission prompts and Activity Monitor name the claude binary instead of the conversation`,
    data: { errorType: "SdkAgentClaudeLink", label: "runtime-sdk.disclaim" },
  });
  return null;
}
