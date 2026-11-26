/**
 * A deploy refusal as data: the CLI's sentence, and — when the fix is
 * something the user does somewhere else in the app — a typed remedy the UI
 * turns into the action itself (a button to the place), so no surface has to
 * read the sentence to find out where to send the user.
 *
 * The CLI states it as transcript lines ({@link refusalLines}); the run ledger
 * reads it back from the leg's transcript tail ({@link readRefusal}). Both
 * halves live here so the line format is one declaration, not a coupling
 * between two files that have to agree.
 */
import { z } from "zod";

/**
 * What the user does to clear a refusal, as data.
 *
 * - `account`: connect or fix an account in Settings → Accounts. `accountId`
 *   is the account pane's id (an `Auth.Provider` / `Auth.Integration` id) —
 *   the consumer names the account by its own contribution, never by a title
 *   carried here.
 */
export const DeployRemedySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("account"), accountId: z.string().min(1) }),
]);
export type DeployRemedy = z.infer<typeof DeployRemedySchema>;

/** The prefix of the line stating a refusal's sentence (human-readable). */
export const DEPLOY_REFUSAL_PREFIX = "deploy: ";

/**
 * The prefix of the line carrying a refusal's remedy, as JSON. Only a refusal
 * prints it, and a refusal exits, so the last one in a transcript is the
 * refusal's.
 */
export const DEPLOY_REMEDY_PREFIX = "deploy-remedy: ";

/** The lines a refusal prints: its sentence, then its remedy when it has one. */
export function refusalLines(
  message: string,
  remedy: DeployRemedy | null,
): string[] {
  const lines = [`${DEPLOY_REFUSAL_PREFIX}${message}`];
  if (remedy !== null) {
    lines.push(`${DEPLOY_REMEDY_PREFIX}${JSON.stringify(remedy)}`);
  }
  return lines;
}

/** A transcript's refusal, as {@link readRefusal} found it. */
export type ReadRefusal =
  | { readonly kind: "none" }
  | {
      readonly kind: "refused";
      readonly message: string;
      readonly remedy: DeployRemedy | null;
    }
  /** A remedy line that does not parse: a CLI and a reader out of step. */
  | {
      readonly kind: "malformed-remedy";
      readonly message: string;
      readonly line: string;
      readonly error: string;
    };

/**
 * The refusal stated in a transcript's lines (oldest first): its first
 * refusal line's sentence, and its last remedy line parsed against
 * {@link DeployRemedySchema}.
 */
export function readRefusal(lines: readonly string[]): ReadRefusal {
  const refusal = lines.find((line) => line.startsWith(DEPLOY_REFUSAL_PREFIX));
  if (refusal === undefined) return { kind: "none" };
  const message = refusal.slice(DEPLOY_REFUSAL_PREFIX.length);
  const remedyLine = lines.findLast((line) =>
    line.startsWith(DEPLOY_REMEDY_PREFIX),
  );
  if (remedyLine === undefined) {
    return { kind: "refused", message, remedy: null };
  }
  const json = remedyLine.slice(DEPLOY_REMEDY_PREFIX.length);
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    return {
      kind: "malformed-remedy",
      message,
      line: remedyLine,
      error: err.message,
    };
  }
  const parsed = DeployRemedySchema.safeParse(value);
  if (!parsed.success) {
    return {
      kind: "malformed-remedy",
      message,
      line: remedyLine,
      error: parsed.error.message,
    };
  }
  return { kind: "refused", message, remedy: parsed.data };
}
