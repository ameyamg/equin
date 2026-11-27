import { describe, expect, test } from "bun:test";
import type { ReplaySettled } from "@plugins/framework/plugins/server-core/core";
import {
  createFindingsBook,
  createRestartWindow,
  judgeFinding,
  WINDOW_PAST_FILING_MS,
  type Finding,
  type OpenEndToEnd,
} from "./findings";

const READY = 1_000_000;

function restartOf(
  outcome: ReplaySettled | "never-ready",
): () => ReturnType<ReturnType<typeof createRestartWindow>> {
  return createRestartWindow({
    readyAt: () => (outcome === "never-ready" ? null : READY),
    replaySettled: () =>
      outcome === "never-ready"
        ? Promise.reject(new Error("not ready"))
        : Promise.resolve(outcome),
  });
}

const replayed: ReplaySettled = {
  kind: "replayed",
  afterMs: 8_000,
  requests: 400,
  sockets: 3,
};

function server(startMs: number, endMs: number): Finding {
  return { source: "slow-op", what: "db x 900ms", ms: 900, startMs, endMs };
}

describe("judgeFinding", () => {
  test("a tab's item during its wait is evidence, whatever the server knows", async () => {
    expect(
      await judgeFinding(
        { ...server(0, 1), during: "page-load-1" },
        restartOf("never-ready"),
      ),
    ).toEqual({ kind: "evidence", via: "tab" });
  });

  test("a server finding inside the replay is evidence of the restart", async () => {
    expect(
      await judgeFinding(
        server(READY + 1_000, READY + 3_000),
        restartOf(replayed),
      ),
    ).toEqual({ kind: "evidence", via: "restart" });
  });

  test("one that only ended inside the replay is evidence too (it overlapped)", async () => {
    expect(
      await judgeFinding(
        server(READY - 5_000, READY + 500),
        restartOf(replayed),
      ),
    ).toEqual({ kind: "evidence", via: "restart" });
  });

  test("before ready, the predecessor served every tab: standalone", async () => {
    expect(
      await judgeFinding(
        server(READY - 5_000, READY - 100),
        restartOf(replayed),
      ),
    ).toEqual({ kind: "standalone" });
  });

  test("after the replay settled: background, standalone", async () => {
    expect(
      await judgeFinding(
        server(READY + 9_000, READY + 10_000),
        restartOf(replayed),
      ),
    ).toEqual({ kind: "standalone" });
  });

  test("a boot nobody replayed holds nothing", async () => {
    expect(
      await judgeFinding(
        server(READY + 100, READY + 200),
        restartOf({ kind: "no-replay", afterMs: 3_000 }),
      ),
    ).toEqual({ kind: "standalone" });
  });

  test("background work spanning the replay still files (nobody waits on it)", async () => {
    expect(
      await judgeFinding(
        { ...server(READY - 60_000, READY + 600_000), background: true },
        restartOf(replayed),
      ),
    ).toEqual({ kind: "standalone" });
  });

  test("a host that never serves: standalone", async () => {
    expect(await judgeFinding(server(1, 2), restartOf("never-ready"))).toEqual({
      kind: "standalone",
    });
  });

  test("while the replay is unsettled the judgement waits for it", async () => {
    let settle!: (r: ReplaySettled) => void;
    const restart = createRestartWindow({
      readyAt: () => READY,
      replaySettled: () =>
        new Promise<ReplaySettled>((r) => {
          settle = r;
        }),
    });
    const verdict = judgeFinding(server(READY + 100, READY + 200), restart);
    let done = false;
    void verdict.then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    settle(replayed);
    expect(await verdict).toEqual({ kind: "evidence", via: "restart" });
  });
});

describe("findings book", () => {
  function book(now: { t: number }) {
    const restated: { e: OpenEndToEnd; total: number }[] = [];
    const b = createFindingsBook({
      now: () => now.t,
      restate: (e, f) => restated.push({ e, total: f.total }),
      restateDelayMs: 0,
    });
    return { b, restated };
  }

  test("a wait's evidence: its tab's items, the restart's, and the server's inside it", () => {
    const now = { t: READY + 20_000 };
    const { b } = book(now);
    b.note(
      { ...server(READY + 1_000, READY + 2_000), during: "w1", ms: 2_000 },
      { kind: "evidence", via: "tab" },
    );
    // Another tab's wait: not this one's.
    b.note(
      { ...server(READY + 1_000, READY + 2_000), during: "w2" },
      { kind: "evidence", via: "tab" },
    );
    b.note(server(READY + 500, READY + 900), {
      kind: "evidence",
      via: "restart",
    });
    b.note(
      server(READY + 3_000, READY + 4_000),
      { kind: "standalone" },
      "report-x",
    );
    // A standalone finding after the filing is not listed.
    b.note(server(READY + 12_000, READY + 13_000), { kind: "standalone" }, "r");
    const ev = b.evidenceFor("w1", READY, READY + 10_000);
    expect(ev.total).toBe(3);
    expect(ev.items.map((i) => i.via)).toEqual(["tab", "restart", "window"]);
    expect(ev.items[2]!.reportId).toBe("report-x");
  });

  test("a held finding up to the ledger's cap past the filing still counts", () => {
    const now = { t: READY };
    const { b } = book(now);
    const filedAt = READY + 10_000;
    b.note(
      server(
        filedAt + WINDOW_PAST_FILING_MS - 1,
        filedAt + WINDOW_PAST_FILING_MS,
      ),
      { kind: "evidence", via: "restart" },
    );
    b.note(
      server(
        filedAt + WINDOW_PAST_FILING_MS + 1,
        filedAt + WINDOW_PAST_FILING_MS + 2,
      ),
      { kind: "evidence", via: "restart" },
    );
    expect(b.evidenceFor("w", READY, filedAt).total).toBe(1);
  });

  test("a finding that arrives after the report restates it", async () => {
    const now = { t: READY + 10_000 };
    const { b, restated } = book(now);
    b.open({
      reportId: "report-e2e",
      occurredAt: READY + 10_000,
      message: "live-again /agents …",
      data: {},
      waitId: "w1",
      startedAt: READY,
    });
    // boot-budget judges at its minute tick: an onReady hook in the replay.
    b.note(
      {
        source: "boot-budget",
        what: "onReady:conversations — 1800ms boot",
        ms: 1_800,
        startMs: READY + 100,
        endMs: READY + 1_900,
      },
      { kind: "evidence", via: "restart" },
    );
    // Unrelated: another tab's item.
    b.note(
      { ...server(READY, READY + 1), during: "w9" },
      { kind: "evidence", via: "tab" },
    );
    await new Promise((r) => setTimeout(r, 5));
    expect(restated).toHaveLength(1);
    expect(restated[0]!.e.reportId).toBe("report-e2e");
    expect(restated[0]!.total).toBe(1);
  });

  test("the largest findings first, a count after every timed one", () => {
    const now = { t: READY };
    const { b } = book(now);
    b.note(
      {
        source: "op-rate",
        what: "db q — 900 calls",
        startMs: READY - 1,
        endMs: READY + 5,
      },
      { kind: "evidence", via: "restart" },
    );
    b.note(
      { ...server(READY, READY + 1), ms: 100 },
      { kind: "evidence", via: "restart" },
    );
    b.note(
      { ...server(READY, READY + 1), ms: 3_000 },
      { kind: "evidence", via: "restart" },
    );
    expect(b.evidenceFor("w", READY, READY + 1).items.map((i) => i.ms)).toEqual(
      [3_000, 100, undefined],
    );
  });
});
