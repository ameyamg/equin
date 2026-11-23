import { pickRuntimeEnv } from "@plugins/infra/plugins/launcher/plugins/runtime-env/core";
import { toolchainPin } from "@plugins/infra/plugins/paths/core";

/**
 * How a test run's output is drawn — the caller's choice, which changes no
 * test outcome, so it passes through.
 */
const OUTPUT_ENV = ["TERM", "NO_COLOR", "FORCE_COLOR", "CI"] as const;

/**
 * The environment every test process starts from: the runtime tree's declared
 * allowlist (`pickRuntimeEnv` — host facts and the installation's forwarded
 * settings, PATH with mise's shims first), this checkout's toolchain pin (as
 * every backend pins its own: a tool a suite runs from a temp dir resolves the
 * checkout's locked version), and the output-format variables. Never the
 * launching shell's whole environment.
 *
 * A test run used to inherit whoever started it, so the same file passed or
 * failed by caller: a run a backend started carried the gateway's
 * `EQUIN_GATEWAY_PORT` and `install.sh --dry-run` printed port 8700 where the
 * suite expects the port file's absence; an agent's run carried its
 * conversation id, its data-root declaration, its shell's mise activation and
 * every `CLAUDE_*` name. All of that is withheld here — the names the gateway
 * withholds from a backend, plus the shell's `MISE_*` / `BUN_*` /
 * `NODE_OPTIONS` — and the run adds back only what it hands its runners itself
 * (the grant share, the run's TMPDIR, the heartbeat).
 *
 * HOME stays the user's on purpose: it is where the user's toolchains live
 * (mise's installs, cargo, go and bun caches), which suites run for real. A
 * suite that must not touch the real home names its own HOME for its child,
 * as the install.sh stream test does.
 */
export function sealedTestEnv(
  source: Record<string, string | undefined>,
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const name of OUTPUT_ENV) {
    const value = source[name];
    if (value !== undefined) output[name] = value;
  }
  return { ...pickRuntimeEnv(source), ...toolchainPin(), ...output };
}
