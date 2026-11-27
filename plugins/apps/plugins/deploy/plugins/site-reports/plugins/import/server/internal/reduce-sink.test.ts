import { describe, expect, test } from "bun:test";
import { hashHex } from "@plugins/packages/plugins/string-hash/core";
import type { SiteOccurrence, SiteReportLedger } from "./ledger";
import { IMPORT_PACE, reduceSink, type ReduceSinkDeps } from "./reduce-sink";

const site = { deploymentId: "dpl-1", hostnames: ["example.com"] };
const opts = { reconciling: false, firstCopy: false };
const upsert = (i: number, count = 1) => ({
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
    last_seen_at: "2026-11-12T00:00:00+00:00",
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
  const record: ReduceSinkDeps["record"] = async (inputs) => {
    recorded.push(inputs.map((i) => i.message));
    return [];
  };
  const sink = reduceSink(site, { ledger, record });
  const tx = {} as Parameters<typeof sink.apply>[0];
  return { ledger, recorded, sink, tx };
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
