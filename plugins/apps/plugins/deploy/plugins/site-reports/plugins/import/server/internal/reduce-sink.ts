import type { MirrorCustomSink } from "@plugins/database/plugins/table-mirror/plugins/replica/server";
import type {
  SiteMirrorPace,
  SiteMirrorSite,
} from "@plugins/apps/plugins/deploy/plugins/site-mirror/plugins/pull/server";
import { Log } from "@plugins/primitives/plugins/log-channels/server";
import { recordReportIncident } from "@plugins/reports/plugins/engine/server";
import { reduceSiteReport, websiteVisitorErrorSummary } from "../../core";
import { hashHex } from "@plugins/packages/plugins/string-hash/core";
import { importedKindOf } from "./kind";
import { siteReportLedger, type SiteReportLedger } from "./ledger";
import { SITE_REPORTS_TABLE, siteReportRecordOfRow } from "./site-row";

const log = Log.channel("site-reports-import");

/**
 * How fast a site's error rows are read (site-mirror's pace for this set):
 * one page of at most 50 rows per deployment per hourly run — a flood on the
 * site drains here at 50 an hour, from the cursor, nothing skipped — and one
 * answer at most 1 MB (a page's row JSON is cut at 250 KB on the box; the
 * envelope at most quadruples it).
 */
export const IMPORT_PACE: SiteMirrorPace = {
  rowsPerRun: 50,
  maxBytes: 250_000,
  maxAnswerBytes: 1_000_000,
  // The pull-all runs hourly; a second pull inside the hour does nothing.
  minIntervalMs: 50 * 60_000,
};

/**
 * The reduce step as the `site_reports` replica's sink: the only thing that
 * ever sees a site's raw rows on this computer, and it keeps none of them.
 *
 * - **Structured data only.** Each upsert is strictly parsed
 *   (`siteReportRecordOfRow`) and reduced (`reduceSiteReport`): typed,
 *   clamped fields, the site's payload never copied. The replica keeps only
 *   each row's key and hash (`table_mirror_keys`), never its content.
 * - **Recurrences, counted once.** A handed row is recorded only when the
 *   site's own facts (`last_seen_at`, `count`) moved past what the delivery
 *   ledger holds (`./ledger`). The replica hands a row whenever its hash
 *   moved, and a hash moves with no new occurrence: a column added to
 *   `site_reports` changes every row's hash, and the reconcile it starts
 *   re-sends the whole table (2026-11-27: ~50 rows from 11-12…11-19 re-filed
 *   at once after `split` was added). So the local `count` is the number of
 *   pulls that saw the site's count or last sighting move.
 * - **One incident per page**, one bell at most; a reconciliation (the
 *   computer was away past the box's log horizon) records its catch-up
 *   without ringing (`alert: false`).
 * - **Tombstones are not news.** The box's 30-day sweep forgetting a
 *   fingerprint files nothing: the local report is an incident record with
 *   the engine's own retention, not a copy of the box's table. The ledger
 *   forgets it too, so it stays as small as the box's table.
 *
 * Recorded inside the page's transaction, before it commits (on its own
 * connection): a page that then fails to commit is handed again on the next
 * pull — a duplicate recurrence at worst, never a lost report (the ledger
 * rolls back with the page).
 */
/** What the sink writes through: the ledger, and the reports engine. */
export interface ReduceSinkDeps {
  ledger: SiteReportLedger;
  record: typeof recordReportIncident;
}

const ENGINE: ReduceSinkDeps = {
  ledger: siteReportLedger,
  record: recordReportIncident,
};

export function reduceSink(
  site: SiteMirrorSite,
  { ledger, record }: ReduceSinkDeps = ENGINE,
): MirrorCustomSink {
  return {
    async apply(tx, batch, { reconciling }) {
      const forgotten = batch.flatMap((b) =>
        b.table === SITE_REPORTS_TABLE
          ? b.deletes.map((pk) => {
              if (typeof pk.fingerprint !== "string") {
                throw new Error(
                  `site-reports/import: a ${SITE_REPORTS_TABLE} tombstone without a text fingerprint: ${JSON.stringify(pk)}`,
                );
              }
              return hashHex(pk.fingerprint);
            })
          : [],
      );
      await ledger.forget(tx, site.deploymentId, forgotten);
      const records = batch.flatMap((b) => {
        if (b.table !== SITE_REPORTS_TABLE) {
          throw new Error(
            `site-reports/import: the reduce sink was handed table "${b.table}" — it reduces ${SITE_REPORTS_TABLE} only`,
          );
        }
        return b.upserts.map((u) => siteReportRecordOfRow(u.row));
      });
      if (records.length === 0) return;
      if (records.length > IMPORT_PACE.rowsPerRun) {
        throw new Error(
          `site-reports/import: ${records.length} rows in one page, past the pace's ${IMPORT_PACE.rowsPerRun}`,
        );
      }
      // Oldest first: the incident's significance order, as the engine spends
      // its fan-out budget in it.
      records.sort(
        (a, b) =>
          Date.parse(a.lastSeenAt) - Date.parse(b.lastSeenAt) ||
          (a.fingerprint < b.fingerprint ? -1 : 1),
      );
      const reduced = records.map((record) => ({
        record,
        data: reduceSiteReport(record, site),
      }));
      const news = await ledger.admit(
        tx,
        site.deploymentId,
        reduced.map(({ data }) => ({
          siteFingerprint: data.siteFingerprint,
          lastSeenAt: data.lastSeenAt,
          siteCount: data.siteCount,
        })),
      );
      const fresh = reduced.filter(({ data }) =>
        news.has(data.siteFingerprint),
      );
      if (fresh.length < reduced.length) {
        log.publish(
          `${site.deploymentId}: ${reduced.length - fresh.length} of ${reduced.length} handed rows already recorded (no new sighting on the site) — skipped`,
        );
      }
      if (fresh.length === 0) return;
      await record(
        fresh.map(({ record, data }) => {
          return {
            // The site kind's own category decides: a slow load is a slow op.
            kind: importedKindOf(record),
            source: "website-visitor" as const,
            message: websiteVisitorErrorSummary(data),
            data,
            // The code the visitor ran: the site's own commit, so a fix landed
            // here is judged against the right code. Never this backend's pin.
            commit: data.commit,
            occurredAt: Date.parse(data.lastSeenAt),
          };
        }),
        { alert: !reconciling },
      );
      log.publish(
        `${site.deploymentId}: recorded ${fresh.length}${reconciling ? " (reconciling, no bell)" : ""}`,
      );
    },
  };
}
