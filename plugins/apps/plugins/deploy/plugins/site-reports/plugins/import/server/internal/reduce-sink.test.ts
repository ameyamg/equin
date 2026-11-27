import { describe, expect, test } from "bun:test";
import { hashHex } from "@plugins/packages/plugins/string-hash/core";
import type { SiteOccurrence, SiteReportLedger } from "./ledger";
import { IMPORT_PACE, reduceSink, type ReduceSinkDeps } from "./reduce-sink";

const site = { deploymentId: "dpl-1", hostnames: ["example.com"] };
const opts = { reconciling: false, firstCopy: false };
// The pulls' clock: a minute after the rows' last sighting (on time).
const NOW = Date.parse("2026-11-12T00:01:00+00:00");
const upsert = (
  i: number,
  count = 1,
  lastSeenAt = "2026-11-12T00:00:00+00:00",
) => ({
  pk: { fingerprint: `crash:${i}` },
  h: "0".repeat(32),
  row: JSON.stringify({
    fingerprint: `crash:${i}`,
    kind: "crash",
    // The site's own category: no registry lookup (none booted here).
    category: "error",
    source: "browser-error",
    message: "m",
    data: {},
    path: "/",
    build_id: null,
    commit: null,
    count,
    first_seen_at: "2026-11-12T00:00:00+00:00",
    last_seen_at: lastSeenAt,
  }),
});

/** An in-memory ledger with the real one's rule: news when a fact grew. */
function memoryLedger(): SiteReportLedger & {
  held: Map<string, SiteOccurrence>;
  forgotten: string[];
} {
  const held = new Map<string, SiteOccurrence>();
  const forgotten: string[] = [];
  return {
    held,
    forgotten,
    async admit(_tx, dep, rows) {
      const news = new Set<string>();
      for (const r of rows) {
        const key = `${dep}:${r.siteFingerprint}`;
        const prior = held.get(key);
        if (
          !prior ||
          Date.parse(r.lastSeenAt) > Date.parse(prior.lastSeenAt) ||
          r.siteCount > prior.siteCount
        ) {
          held.set(key, r);
          news.add(r.siteFingerprint);
        }
      }
      return news;
    },
    async forget(_tx, dep, fps) {
      for (const fp of fps) {
        forgotten.push(fp);
        held.delete(`${dep}:${fp}`);
      }
    },
  };
}

function harness() {
  const ledger = memoryLedger();
  const recorded: string[][] = [];
  const incidents: { fingerprints: string[]; announce: boolean }[] = [];
  const record: ReduceSinkDeps["record"] = async (inputs, opts) => {
    recorded.push(inputs.map((i) => i.message));
    incidents.push({
      fingerprints: inputs.map((i) => String(i.data?.siteFingerprint)),
      announce: opts?.announce !== false,
    });
    return [];
  };
  const sink = reduceSink(site, { ledger, record }, () => NOW);
  const tx = {} as Parameters<typeof sink.apply>[0];
  return { ledger, recorded, incidents, sink, tx };
}

describe("reduceSink", () => {
  test("nothing handed (tombstones only) records nothing and forgets the key", async () => {
    const { sink, tx, recorded, ledger } = harness();
    await sink.apply(
      tx,
      [{ table: "site_reports", upserts: [], deletes: [{ fingerprint: "x" }] }],
      opts,
    );
    expect(recorded).toEqual([]);
    expect(ledger.forgotten).toEqual([hashHex("x")]);
  });

  test("a row handed again with the same site facts is recorded once", async () => {
    const { sink, tx, recorded } = harness();
    const page = [
      { table: "site_reports", upserts: [upsert(1), upsert(2)], deletes: [] },
    ];
    await sink.apply(tx, page, opts);
    // A reconcile after a column was added re-sends every row, unchanged.
    await sink.apply(tx, page, { reconciling: true, firstCopy: false });
    expect(recorded.map((r) => r.length)).toEqual([2]);
  });

  test("a row whose site count grew is recorded again", async () => {
    const { sink, tx, recorded } = harness();
    await sink.apply(
      tx,
      [{ table: "site_reports", upserts: [upsert(1), upsert(2)], deletes: [] }],
      opts,
    );
    await sink.apply(
      tx,
      [
        {
          table: "site_reports",
          upserts: [upsert(1, 2), upsert(2)],
          deletes: [],
        },
      ],
      opts,
    );
    expect(recorded.map((r) => r.length)).toEqual([2, 1]);
  });

  test("a sighting delivered hours late is filed apart, unannounced; on-time ones as news — reconcile or not", async () => {
    const { sink, tx, incidents } = harness();
    await sink.apply(
      tx,
      [
        {
          table: "site_reports",
          upserts: [
            upsert(1),
            upsert(2, 1, "2026-11-05T00:00:00+00:00"),
            upsert(3, 1, "2026-11-11T21:59:00+00:00"),
          ],
          deletes: [],
        },
      ],
      // A reconcile hands fresh rows too: lateness is the row's own fact.
      { reconciling: true, firstCopy: false },
    );
    expect(incidents).toEqual([
      { fingerprints: [hashHex("crash:1")], announce: true },
      {
        fingerprints: [hashHex("crash:2"), hashHex("crash:3")],
        announce: false,
      },
    ]);
  });

  test("a page past the pace's flood bound throws instead of recording", () => {
    const { sink, tx } = harness();
    const upserts = Array.from({ length: IMPORT_PACE.rowsPerRun + 1 }, (_, i) =>
      upsert(i),
    );
    expect(
      sink.apply(tx, [{ table: "site_reports", upserts, deletes: [] }], opts),
    ).rejects.toThrow(/past the pace/);
  });

  test("a table other than site_reports throws", () => {
    const { sink, tx } = harness();
    expect(
      sink.apply(
        tx,
        [{ table: "other", upserts: [upsert(1)], deletes: [] }],
        opts,
      ),
    ).rejects.toThrow(/reduces site_reports only/);
  });
});
