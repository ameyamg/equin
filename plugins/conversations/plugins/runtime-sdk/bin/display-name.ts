import { spawn } from "node:child_process";
import type { DisplayNameUnset } from "../core";

// The read-back of an agent's Activity Monitor name. The named launcher
// (`machine/internal/named-launcher.ts`, the helper's `--exec-named` mode)
// sets the process's LaunchServices display name through private macOS calls
// and then becomes claude; when that fails it can only print a line on
// stderr (agent.log), which nothing reads. So the agent asks the registry
// itself, once claude is up, what the pid is registered as — one check for
// both ways it goes wrong: the call failed, or it "succeeded" and the name
// did not stick. Measured 2026-11-25: two `lsappinfo` runs, ~20 ms wall in
// all, run off the start path (after `ready`, never awaited by it).

/** One `lsappinfo` run: its exit code and output. */
export type LsAppInfo = (
  args: readonly string[],
) => Promise<{ code: number | null; stdout: string; stderr: string }>;

/** Runs the real `lsappinfo` at `bin`. Rejects only if it cannot be spawned. */
export function lsAppInfoAt(bin: string): LsAppInfo {
  return (args) =>
    new Promise((resolve, reject) => {
      const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (d: string) => {
        stdout += d;
      });
      child.stderr.setEncoding("utf8").on("data", (d: string) => {
        stderr += d;
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
}

const NAME_PREFIX = '"LSDisplayName"="';

/**
 * What `pid` is registered as, against the name it should carry: null when it
 * carries `expected`, else why not (the `display_name_unset` line's body).
 * `lsappinfo` prints the name raw (a `"` in it is not escaped), so the value is
 * everything between the prefix and the line's last quote.
 */
export async function checkDisplayName(opts: {
  pid: number;
  expected: string;
  lsappinfo: LsAppInfo | null;
}): Promise<Omit<DisplayNameUnset, "event"> | null> {
  const { pid, expected } = opts;
  const unreadable = (detail: string) => ({
    cause: "unreadable" as const,
    expected,
    registered: null,
    detail,
  });
  if (opts.lsappinfo === null) {
    return unreadable("lsappinfo is not in /usr/bin on this machine");
  }
  const run = async (args: readonly string[]) => {
    const out = await opts.lsappinfo!(args);
    if (out.code !== 0) {
      throw new Error(
        `lsappinfo ${args.join(" ")} exited ${String(out.code)}: ${out.stderr.trim() || "(no output)"}`,
      );
    }
    return out.stdout.trim();
  };
  let asn: string;
  let info: string;
  try {
    asn = await run(["find", `pid=${String(pid)}`]);
    if (asn === "") {
      return {
        cause: "unregistered",
        expected,
        registered: null,
        detail: null,
      };
    }
    info = await run(["info", "-only", "name", asn]);
  } catch (err) {
    return unreadable(err instanceof Error ? err.message : String(err));
  }
  const line = info.split("\n").find((l) => l.startsWith(NAME_PREFIX));
  if (line === undefined || !line.endsWith('"')) {
    return { cause: "unnamed", expected, registered: null, detail: null };
  }
  const registered = line.slice(NAME_PREFIX.length, -1);
  if (registered === expected) return null;
  return { cause: "other-name", expected, registered, detail: null };
}
