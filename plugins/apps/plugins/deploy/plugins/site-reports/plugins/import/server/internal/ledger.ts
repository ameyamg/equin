import { and, eq, inArray, sql } from "drizzle-orm";
import type { ReplicaTx } from "@plugins/database/plugins/table-mirror/plugins/replica/server";
import { siteReportImports } from "./tables";

/** One handed row's recurrence facts, as the site counts them. */
export interface SiteOccurrence {
  /** `WebsiteVisitorError.siteFingerprint`. */
  siteFingerprint: string;
  /** The site's `last_seen_at`, ISO. */
  lastSeenAt: string;
  /** The site's `count`, clamped. */
  siteCount: number;
}

/**
 * The delivery ledger (`site_report_imports`, see its table): which handed
 * rows are news. Runs in the mirror page's transaction, so a page that fails
 * to commit leaves the ledger as it was.
 */
export interface SiteReportLedger {
  /**
   * Record each row's facts and answer the fingerprints that moved past what
   * the ledger held (or that it did not hold): those, and only those, are
   * recorded as reports. A row handed again with the same facts — a
   * reconcile after a column was added, a re-sent page — answers nothing.
   */
  admit(
    tx: ReplicaTx,
    deploymentId: string,
    rows: readonly SiteOccurrence[],
  ): Promise<ReadonlySet<string>>;
  /** The site forgot these fingerprints (its tombstones): so does the ledger. */
  forget(
    tx: ReplicaTx,
    deploymentId: string,
    siteFingerprints: readonly string[],
  ): Promise<void>;
}

const t = siteReportImports;

export const siteReportLedger: SiteReportLedger = {
  async admit(tx, deploymentId, rows) {
    if (rows.length === 0) return new Set();
    // A row moved when either fact grew. Both stay monotone in the ledger
    // (greatest), so a page applied out of order cannot move one back.
    const admitted = await tx
      .insert(t)
      .values(
        rows.map((r) => ({
          deploymentId,
          siteFingerprint: r.siteFingerprint,
          lastSeenAt: new Date(r.lastSeenAt),
          siteCount: r.siteCount,
        })),
      )
      .onConflictDoUpdate({
        target: [t.deploymentId, t.siteFingerprint],
        set: {
          lastSeenAt: sql`greatest(${t.lastSeenAt}, excluded.last_seen_at)`,
          siteCount: sql`greatest(${t.siteCount}, excluded.site_count)`,
        },
        setWhere: sql`excluded.last_seen_at > ${t.lastSeenAt} OR excluded.site_count > ${t.siteCount}`,
      })
      .returning({ siteFingerprint: t.siteFingerprint });
    return new Set(admitted.map((r) => r.siteFingerprint));
  },
  async forget(tx, deploymentId, siteFingerprints) {
    if (siteFingerprints.length === 0) return;
    await tx
      .delete(t)
      .where(
        and(
          eq(t.deploymentId, deploymentId),
          inArray(t.siteFingerprint, [...siteFingerprints]),
        ),
      );
  },
};
