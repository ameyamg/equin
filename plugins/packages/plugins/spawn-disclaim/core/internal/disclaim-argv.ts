import { readEnv } from "@plugins/infra/plugins/launcher/plugins/env-names/core";

/**
 * Whether a spawn from THIS process should be disclaimed: on macOS, unless
 * `EQUIN_NO_SPAWN_DISCLAIM=1` (the operator escape hatch: `1` turns the
 * disclaim off everywhere). The caller that resolves the helper asks
 * this first, so a disabled or non-macOS host never builds or waits for it.
 */
export function spawnDisclaimWanted(
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "darwin" && readEnv("NO_SPAWN_DISCLAIM", env) !== "1";
}

/**
 * The argv that runs `argv` as its own responsible process: `[helper, …argv]`
 * — the helper execs `argv[0]` in place (same pid, stdio and signals) with its
 * responsibility disclaimed. `argv` unchanged when there is no helper (not
 * built, not requested) or the disclaim is not wanted here.
 */
export function disclaimArgv(
  helper: string | null,
  argv: readonly [string, ...string[]],
  wanted: boolean = spawnDisclaimWanted(),
): [string, ...string[]] {
  return helper !== null && wanted ? [helper, ...argv] : [...argv];
}

/**
 * The argv that runs `argv` under `named`'s file name: `[named, "--exec-named",
 * …argv]` — `named` being a copy of the helper under the name to show, which
 * takes that name as the process's display name and then becomes `argv[0]`
 * (same pid). Wrap the result in {@link disclaimArgv}: disclaimed INTO the
 * named copy, the process is charged and named by that copy's path in macOS
 * permission prompts, whatever program it has become. `argv` unchanged when
 * there is no named copy.
 */
export function execNamedArgv(
  named: string | null,
  argv: readonly [string, ...string[]],
): [string, ...string[]] {
  return named !== null ? [named, "--exec-named", ...argv] : [...argv];
}
