import { CLI_NAME } from "@plugins/framework/plugins/cli/plugins/cli-name/core";
import { defineGuard } from "../define-guard";
import { operandPath } from "../argv";
import { classifyRepo } from "../git-target";
import { findCall, type ShellCall } from "../parse-shell";
import type { BashInput } from "../types";

// Compensates for: an agent's shell can start a whole-repo TypeScript program
// that no host admission sees — agent Bash children are neither admitted nor
// reserved (task-1795648323-aq17ba). `./equin check type-check`
// takes a host CPU grant, is reserved its measured weight, and checks only what
// changed against host-wide stores; a bare `tsc -p .` loads the one ~11k-file
// project from scratch: 4.1–4.5 GB of footprint grown in under 30 s. On
// 2026-11-25 agents ran it 17 times, and every minute the host compressor
// went past 20k decompressions/s (11:35, 12:15, 15:04, 18:21, 22:49 UTC —
// three of them duress episodes) had one running beside an admitted build.

/** Flags that only print something: no program is loaded. */
const INFO_FLAGS = new Set([
  "-v",
  "--version",
  "-h",
  "--help",
  "--all",
  "--init",
  "--showConfig",
]);

/** Package runners whose first operand is the bin they run. */
const BIN_RUNNERS = new Set(["npx", "bunx", "pnpx"]);
/** Package managers that run a bin after a subcommand (`npm exec tsc`, `bun x tsc`) — pnpm/yarn also bare (`yarn tsc`). */
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const RUN_SUBCOMMANDS = new Set(["exec", "x", "dlx", "run"]);
/** Runners' own flags whose value is the next token (`npx -p typescript tsc`). */
const RUNNER_VALUE_FLAGS = new Set([
  "-p",
  "--package",
  "-c",
  "--call",
  "--cwd",
]);
const TSC_SCRIPT = /(^|\/)(tsc|typescript\/lib\/tsc\.js)$/;
/** A runner's bin operand naming tsc, a pinned version included (`tsc@5.6`). */
const TSC_BIN = /^tsc(@.+)?$/;
/** A source file operand: given one, tsc ignores tsconfig and loads only those files' closure. */
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

/** Skip a runner's own flags (and `--`) to its first operand's index. */
function firstOperand(args: string[], from = 0): number {
  for (let i = from; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--") continue;
    if (a.startsWith("-")) {
      if (!a.includes("=") && RUNNER_VALUE_FLAGS.has(a)) i++;
      continue;
    }
    return i;
  }
  return args.length;
}

/** The arguments the TypeScript compiler gets, when `call` runs it; else undefined. */
export function tscArgs(call: ShellCall): string[] | undefined {
  const { name, args } = call;
  if (name === "tsc") return args;
  if (BIN_RUNNERS.has(name)) {
    const at = firstOperand(args);
    return TSC_BIN.test(args[at] ?? "") ? args.slice(at + 1) : undefined;
  }
  if (PACKAGE_MANAGERS.has(name)) {
    let at = firstOperand(args);
    if (RUN_SUBCOMMANDS.has(args[at] ?? "")) at = firstOperand(args, at + 1);
    else if (name === "npm" || name === "bun") {
      // `npm tsc` is not a command; `bun <file>` is a script run.
      return name === "bun" && TSC_SCRIPT.test(args[at] ?? "")
        ? args.slice(at + 1)
        : undefined;
    }
    return TSC_BIN.test(args[at] ?? "") || TSC_SCRIPT.test(args[at] ?? "")
      ? args.slice(at + 1)
      : undefined;
  }
  if (name === "node") {
    const at = firstOperand(args);
    return TSC_SCRIPT.test(args[at] ?? "") ? args.slice(at + 1) : undefined;
  }
  return undefined;
}

/**
 * What the compiler loads: with `-p <dir|file>`, that project; else with source
 * file operands, only those files (and what they import); else the cwd's
 * tsconfig. Each returned path is judged by the checkout it sits in.
 */
function loadedPaths(args: string[], cwd: string): string[] {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if ((a === "-p" || a === "--project") && args[i + 1] !== undefined)
      return [operandPath(args[i + 1]!, cwd)];
  }
  const files = args.filter((a) => !a.startsWith("-") && SOURCE_FILE.test(a));
  return files.length > 0 ? files.map((f) => operandPath(f, cwd)) : [cwd];
}

function heavyTsc(call: ShellCall, cwd: string): boolean {
  const args = tscArgs(call);
  if (args === undefined) return false;
  if (args.some((a) => INFO_FLAGS.has(a))) return false;
  return loadedPaths(args, call.cwd || cwd).some(
    (p) => classifyRepo(p).kind === "equin",
  );
}

export const bareTscGuard = defineGuard<BashInput>({
  name: "bare-tsc",
  matcher: "Bash",
  check(input, ctx) {
    const cmd = input.command;
    if (!cmd) return null;
    const offending = findCall(cmd, (c) => heavyTsc(c, ctx.cwd), ctx.cwd);
    if (!offending) return null;
    return {
      blocked: `\`${offending.name} ${offending.args.join(" ")}\` runs the TypeScript compiler over an equin checkout outside host admission.`,
      why: "A checkout's tsconfig is one ~11k-file project: a bare `tsc` loads all of it from scratch, 4.1–4.5 GB grown in under 30 s, and no host grant sees it coming. Beside a running build that is ~8–10 GB of new demand at once; the kernel compresses other processes' pages at 1–2 GB/s to supply it, and every git read, Postgres flush and page load on main stalls 3–7 s (the 2026-11-25 duress episodes at 15:05, 18:21 and 22:50 UTC each had one running).",
      hint: `Run \`./${CLI_NAME} check type-check\` — the same one program, under a host CPU grant reserved its measured weight, checking only what changed against host-wide stores (it prints each diagnostic with its file and line). tsc over files outside any checkout (a scratch file) is fine. \`tsc --version\` / \`--help\` are not blocked.`,
    };
  },
});
