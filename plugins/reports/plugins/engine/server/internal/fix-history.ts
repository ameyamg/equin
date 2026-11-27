import { asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db } from "@plugins/database/server";
import { formatDuration } from "@plugins/fields/plugins/duration/core";
import {
  CONVERSATION_TRAILER,
  firstTrailerValue,
  trailerPlaceholder,
} from "@plugins/infra/plugins/git/plugins/commit-trailers/core";
import { runGit } from "@plugins/primitives/plugins/commit-list/server";
import type { ReportFixFacts, ReportId } from "@plugins/reports/core";
import { _reportFixes } from "./tables";

// A report's earlier fixes, as its investigation task states them. A
// regression unlinks the old task and puts the report back on the worklist
// (`fix-ledger.ts`), so without this the next agent reads a report that came
// back as if it were brand new — and fixes the next instance of a class the
// earlier fix already missed once (D14 audit: ~40% of one-instance fixes came
// back). The ledger already holds the facts; this names them, with each
// commit's subject and conversation from main's history.

/** One earlier fix of a report: its ledger facts and what main's log says of it. */
export interface FixHistoryEntry extends ReportFixFacts {
  /** The code the first occurrence after it ran (null: it could not name its commit). */
  regressedCommit: string | null;
  /** The fixing commit's subject line. */
  subject: string;
  /** The conversation the commit came from (its conversation trailer), when it names one. */
  conversation: string | null;
}

const LOG_FORMAT = `%H%x00%s%x00${trailerPlaceholder(CONVERSATION_TRAILER, { separator: "%x2C" })}%x00`;

/**
 * Every fix the ledger holds for `reportId`, oldest first, each with its
 * commit's subject and conversation. One `git log --no-walk` for all of them;
 * a fix with no ledger row costs no git call. Throws when git cannot read a
 * ledger commit: the ledger only records commits on main.
 */
export async function readFixHistory(
  reportId: ReportId,
  repoRoot: string,
  conn: Pick<NodePgDatabase, "select"> = db,
): Promise<FixHistoryEntry[]> {
  const fixes = await conn
    .select()
    .from(_reportFixes)
    .where(eq(_reportFixes.reportId, reportId))
    .orderBy(asc(_reportFixes.landedAt), asc(_reportFixes.commit));
  if (fixes.length === 0) return [];
  const raw = await runGit(
    [
      "log",
      "--no-color",
      "--no-walk=unsorted",
      `--format=${LOG_FORMAT}`,
      ...new Set(fixes.map((f) => f.commit)),
    ],
    repoRoot,
  );
  const logged = new Map<
    string,
    { subject: string; conversation: string | null }
  >();
  for (const record of raw.split("\0\n")) {
    const [sha, subject, conv] = record.replace(/^\n/, "").split("\0");
    if (!sha || subject === undefined) continue;
    const conversation = firstTrailerValue(conv ?? "", ",");
    logged.set(sha, { subject, conversation });
  }
  return fixes.map((f) => {
    const log = logged.get(f.commit);
    if (!log) {
      throw new Error(
        `readFixHistory: git log did not return ledger commit ${f.commit} of report ${reportId}`,
      );
    }
    return {
      commit: f.commit,
      landedAt: f.landedAt,
      deployedAt: f.deployedAt,
      regressedAt: f.regressedAt,
      regressedCommit: f.regressedCommit,
      ...log,
    };
  });
}

const when = (d: Date) =>
  `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
const short = (sha: string) => `\`${sha.slice(0, 12)}\``;

function fixLine(f: FixHistoryEntry): string {
  const head =
    `${short(f.commit)} "${f.subject}"` +
    (f.conversation === null ? "" : ` (${f.conversation})`) +
    ` — landed ${when(f.landedAt)}`;
  if (f.regressedAt !== null) {
    // Came back before main ran it: never deployed when it fired (a claim
    // judged against earlier occurrences), or deployed only after — the deploy
    // stamp does not skip a fix that already regressed.
    const held =
      f.deployedAt === null || f.regressedAt < f.deployedAt
        ? "came back before it was live"
        : `held ${formatDuration(f.regressedAt.getTime() - f.deployedAt.getTime())}`;
    const by =
      f.regressedCommit === null
        ? "from code that could not name its commit"
        : `from code at ${short(f.regressedCommit)}`;
    return `${head}; ${held}, fired again ${when(f.regressedAt)} ${by}.`;
  }
  if (f.deployedAt === null) return `${head}; not live yet.`;
  return `${head}; live since ${when(f.deployedAt)}, holding.`;
}

/**
 * The **Fixed before** section of a report's task: every earlier fix, and —
 * when one of them came back — the instruction to explain why before writing
 * another, and to fix one level up. Null for a report never fixed.
 */
export function formatFixHistory(
  history: readonly FixHistoryEntry[],
): string | null {
  if (history.length === 0) return null;
  const failed = history.filter((f) => f.regressedAt !== null).length;
  const lines = history.map((f) => `- ${fixLine(f)}`).join("\n");
  const times = (n: number) => (n === 1 ? "once" : `${n} times`);
  if (failed === 0) {
    return `**Fixed before** (fixed ${times(history.length)}):\n${lines}`;
  }
  return (
    `**Fixed before — and it came back** (fixed ${times(history.length)}, came back ${times(failed)}):\n${lines}\n\n` +
    "> This is a recurrence, not a new problem. Before writing another fix, read the earlier fix and explain why it did not hold. " +
    "A fix that came back usually fixed one instance: fix it one level up — the API, primitive, gate or default that let it be written — " +
    "so the class cannot recur, and say in your outcome report why the earlier fix missed it."
  );
}
