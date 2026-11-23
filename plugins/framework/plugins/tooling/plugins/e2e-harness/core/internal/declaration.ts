import { z } from "zod";

/**
 * What an e2e script is, declared in the script itself:
 *
 * ```ts
 * import type { E2eScript } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/core";
 *
 * export const e2e = {
 *   kind: "test",
 *   target: "build",
 *   writes: true,
 *   run: "auto",
 * } satisfies E2eScript;
 * ```
 *
 * A runner (and a person) selects scripts by this, never by a name pattern:
 * `*-verify.ts` and a `finish()` call say nothing reliable about what a script
 * does. `e2e-harness:scripts-declared` holds every module under a plugin's
 * `e2e/` to it: a module nothing imports declares itself; a module something
 * imports is a helper by that fact and declares nothing. The value is read
 * STATICALLY (importing a script runs it), so it is written as literals.
 */
export type E2eScript = z.infer<typeof e2eScriptSchema>;

/**
 * Why a script must not run unattended. A closed list, so a runner can decide
 * per reason (a nightly job may run `heavy` scripts a push gate may not).
 */
export const MANUAL_REASONS = [
  /** Files real reports, posts to an outside service, touches the user's real data. */
  "external-effects",
  /** Needs a real sign-in, OAuth grant, API key (Google Maps, Gmail, GitHub…). */
  "accounts",
  /** Asserts a latency / frame / perf budget that flakes under load. */
  "timing",
  /** Leak tests, film renders, soaks, big benchmarks: minutes of CPU. */
  "heavy",
  /** Mutates shared or host state beyond its deploy (git, push, ~/.equin, the checkout, other worktrees), or needs fragile pre-existing state. */
  "stateful",
  /** Needs a native helper or binary (menu-bar helper, installer window, extension). */
  "native-helper",
  /** Needs caller-chosen arguments with no sensible default (a page id, a URL). */
  "arguments",
  /** Needs a human: watching, headed, manual steps. */
  "interactive",
] as const;

export type ManualReason = (typeof MANUAL_REASONS)[number];

const runSchema = z.union([
  /** Safe and meaningful unattended, with no arguments, on an agent build. */
  z.literal("auto"),
  z.strictObject({
    manual: z
      .array(z.enum(MANUAL_REASONS))
      .readonly()
      .refine((r) => r.length > 0, "name at least one reason"),
    /** One specific sentence: what makes it manual. */
    why: z.string().min(1),
  }),
]);

const targetSchema = z.union([
  /** This checkout's own deploy (the harness's default target). */
  z.literal("build"),
  /** A composition build of this checkout (`--composition <id>`). */
  z.strictObject({ composition: z.string().min(1) }),
  /** No app deploy: local computation, temp clones, a native binary, a file render. */
  z.literal("none"),
]);

export const e2eScriptSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    /**
     * `test`: the exit code IS the answer (a pass/fail verdict).
     * `tool`: its purpose is an artifact or a measurement for a person —
     * screenshots, diffs, recordings, renders, profiles — even if it also
     * prints a verdict.
     */
    kind: z.enum(["test", "tool"]),
    target: targetSchema,
    /**
     * Changes state in the deploy it targets (app data, config documents, its
     * database) — so it needs a writable build, never main. `false` for a
     * `target: "none"` script (host-side effects are a `run` reason).
     */
    writes: z.boolean(),
    run: runSchema,
  }),
  z.strictObject({
    /**
     * Not run directly and imported by nobody: loaded BY PATH by something
     * else (a bundler entry, a spawned child, an init script). A module some
     * other module imports is a helper by that fact and declares nothing.
     */
    kind: z.literal("helper"),
    /** Who loads it, and how. */
    why: z.string().min(1),
  }),
]);
