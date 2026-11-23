import { z } from "zod";
import { openShortLivedClient } from "@plugins/database/plugins/admin/server";
import { queryRows } from "@plugins/database/plugins/sql-rows/core";
import { MAIN_WORKTREE_NAME } from "@plugins/infra/plugins/namespace/core";
import { REPORT_FIX_STATES, type ReportFixState } from "@plugins/reports/core";
import { TEST_FAILING_KIND, testFailingFingerprint } from "../../core";

/** Main's `test-failing` report about one test file. */
export interface KnownTestReport {
  path: string;
  reportId: string;
  /** The task someone took it up with (Investigate, or its supervisor), or null: none is filed automatically. */
  taskId: string | null;
  fixState: ReportFixState;
}

/**
 * Main's `test-failing` reports about `paths` (one per file at most: the
 * fingerprint is the path), read from main's database — what a CLI tells an
 * agent whose test fails: this is already known on main, here is its report
 * and its task when someone took it up. Throws when main's database cannot be read; the
 * caller says so.
 */
export async function readKnownTestReports(
  paths: readonly string[],
): Promise<Map<string, KnownTestReport>> {
  const out = new Map<string, KnownTestReport>();
  if (paths.length === 0) return out;
  const byFingerprint = new Map(
    paths.map((path) => [testFailingFingerprint({ path }), path]),
  );
  const pool = await openShortLivedClient(MAIN_WORKTREE_NAME);
  try {
    const rows = await queryRows(pool, {
      sql: "SELECT id, fingerprint, task_id, fix_state FROM reports WHERE kind = $1 AND fingerprint = ANY($2::text[]) ORDER BY last_seen_at DESC",
      params: [TEST_FAILING_KIND, [...byFingerprint.keys()]],
      row: z.object({
        id: z.string(),
        fingerprint: z.string(),
        task_id: z.string().nullable(),
        fix_state: z.enum(REPORT_FIX_STATES),
      }),
    });
    for (const r of rows) {
      const path = byFingerprint.get(r.fingerprint);
      if (path === undefined || out.has(path)) continue;
      out.set(path, {
        path,
        reportId: r.id,
        taskId: r.task_id,
        fixState: r.fix_state,
      });
    }
  } finally {
    await pool.end();
  }
  return out;
}
