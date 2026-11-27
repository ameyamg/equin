import {
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * The import's delivery ledger: per (deployment, site fingerprint), the
 * site's own `last_seen_at` and `count` as of the last row recorded as a
 * report. A row the mirror hands is recorded only when it moved past them,
 * so an occurrence is delivered once whatever the mirror re-sends.
 *
 * Why not trust what the mirror hands: the mirror hands a row whenever its
 * row hash moves, and a hash moves without any new occurrence (a column
 * added on both sides changes every row's hash, so the reconcile it starts
 * re-sends the whole table: about 50 rows from 11-12…11-19 re-filed at once
 * on 2026-11-27, after `split` was added; the same happened with `category`).
 * Recurrence is the site's own fact (`count`, `last_seen_at`), so it is read
 * from there.
 *
 * Holds no visitor content: the fingerprint is the reduced form's hash
 * (`siteFingerprint`), the rest a timestamp and a clamped count. A row goes
 * when the site forgets the fingerprint (its tombstone).
 */
export const siteReportImports = pgTable(
  "site_report_imports",
  {
    deploymentId: text("deployment_id").notNull(),
    /** `WebsiteVisitorError.siteFingerprint`: the site's fingerprint, hashed. */
    siteFingerprint: text("site_fingerprint").notNull(),
    /** The site's `last_seen_at` of the newest row recorded. */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    /** The site's `count` (clamped) of the newest row recorded. */
    siteCount: integer("site_count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.deploymentId, t.siteFingerprint] })],
);
